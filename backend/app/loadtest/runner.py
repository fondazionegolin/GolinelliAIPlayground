"""Virtual students, scenarios, measurements and the live event bus of one stress-test run.

Every virtual user goes through nginx (`LOADTEST_TARGET`, default http://nginx) with the same requests,
headers and streaming reads as the real Vibe Lab page, so the test exercises the real routing (api-pool for
login, gateway for generation, SSE relay). Each request is timed per step; each generation stream is timed
to the first byte, to the first event, between events (the longest silence = the «lag» a student sees) and
to the end. All of it — plus container logs and platform readings — is published on one ordered event bus
that the admin page follows over SSE and that is saved as a JSON report when the run ends.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import random
import secrets
import time
import uuid
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.loadtest import monitor

logger = logging.getLogger(__name__)

TARGET = os.environ.get("LOADTEST_TARGET", "http://nginx").rstrip("/")
REPORT_DIR = Path(os.environ.get("LOADTEST_REPORT_DIR", "/app/loadtest_reports"))
LOG_LINES_PER_SECOND = 150  # per container: beyond this lines are counted, not shipped
MAX_USERS = 500

DEFAULT_PROMPT = (
    "Crea una piccola app per la classe: una lista di attivita da completare con un contatore dei completamenti, "
    "un filtro tra attivita fatte e da fare e un pulsante per azzerare la lista."
)

SCENARIOS: dict[str, dict[str, Any]] = {
    "vibe_access": {
        "label": "Accesso a Vibe Lab",
        "description": "Login studente (join), dati di sessione, crediti, apertura del modulo (progetti, brief, design system); "
                       "poi resta sulla pagina e aggiorna la lista progetti e i job come la UI.",
    },
    "vibe_generate": {
        "label": "Generazione progetti Vibe Lab",
        "description": "Login, apertura del modulo, creazione di un progetto e generazione del codice in streaming (architetto + "
                       "agenti paralleli, build gate), fino alla versione pronta.",
    },
    "vibe_ai_chat": {
        "label": "Chat AI dentro le app Vibe Lab",
        "description": "Login e chiamate ripetute all'assistente AI che le app generate usano (/coding/ai/chat).",
    },
}

STEP_LABELS = {
    "join": "Login studente (POST /student/join)",
    "session": "Dati sessione (GET /student/session)",
    "credits": "Crediti (GET /student/credits/balance)",
    "open_projects": "Lista progetti (GET /coding/projects)",
    "open_briefs": "Brief (GET /coding/briefs)",
    "open_design": "Design system (GET /coding/design-systems)",
    "poll_projects": "Aggiornamento lista progetti",
    "poll_jobs": "Indicatore job (GET /jobs)",
    "create_project": "Creazione progetto (POST /coding/projects)",
    "gen_ttfb": "Generazione: risposta iniziale (header)",
    "gen_first_event": "Generazione: primo evento dello stream",
    "gen_total": "Generazione: durata totale",
    "gen_max_gap": "Generazione: silenzio massimo nello stream",
    "reload_project": "Riapertura progetto (GET /coding/projects/{id})",
    "gen_valid": "Verifica del risultato (versione salvata, file, build)",
    "ai_chat": "Chat AI app (POST /coding/ai/chat)",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def percentile(values: list[float], p: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo), 1)


class EventBus:
    """Ordered, bounded event log; any number of SSE listeners replay it from a sequence number, then follow live."""

    def __init__(self, maxlen: int = 60000):
        self.seq = 0
        self.items: deque[tuple[int, str]] = deque(maxlen=maxlen)
        self.closed = False
        self._cond = asyncio.Condition()

    def publish(self, kind: str, payload: dict) -> None:
        self.seq += 1
        self.items.append((self.seq, json.dumps({"seq": self.seq, "kind": kind, **payload}, default=str)))
        asyncio.get_running_loop().create_task(self._wake())

    async def _wake(self) -> None:
        async with self._cond:
            self._cond.notify_all()

    async def close(self) -> None:
        self.closed = True
        await self._wake()

    async def follow(self, after: int):
        last = after
        while True:
            backlog = [item for item in list(self.items) if item[0] > last]
            for seq, data in backlog:
                last = seq
                yield data
            if self.closed and not backlog:
                return
            async with self._cond:
                try:
                    await asyncio.wait_for(self._cond.wait(), timeout=10)
                except asyncio.TimeoutError:
                    yield None  # keep-alive tick


@dataclass
class StepStats:
    durations: list[float] = field(default_factory=list)
    ok: int = 0
    errors: Counter = field(default_factory=Counter)
    finished: deque = field(default_factory=lambda: deque(maxlen=20000))  # (monotonic, ms, ok)

    def summary(self) -> dict:
        d = self.durations
        return {"count": self.ok + sum(self.errors.values()), "ok": self.ok, "failed": sum(self.errors.values()),
                "p50": percentile(d, 0.5), "p95": percentile(d, 0.95), "p99": percentile(d, 0.99),
                "max": round(max(d), 1) if d else None, "mean": round(sum(d) / len(d), 1) if d else None,
                "errors": dict(self.errors.most_common(8))}


@dataclass
class VUser:
    index: int
    scenario: str
    nickname: str
    state: str = "waiting"
    detail: str = ""
    student_id: Optional[str] = None
    token: Optional[str] = None
    project_id: Optional[str] = None
    job_id: Optional[str] = None
    started: Optional[float] = None
    ended: Optional[float] = None
    error: Optional[str] = None
    files_done: int = 0
    events: int = 0
    done_event: dict = field(default_factory=dict)  # the stream's final «done» event (not published)
    valid: Optional[bool] = None  # None = not checked (no generation finished)
    problems: list = field(default_factory=list)

    def public(self) -> dict:
        return {"i": self.index, "scenario": self.scenario, "nick": self.nickname, "state": self.state,
                "detail": self.detail[:160], "error": self.error, "files": self.files_done, "events": self.events,
                "project_id": self.project_id, "job_id": self.job_id, "valid": self.valid, "problems": self.problems}


@dataclass
class RunConfig:
    scenarios: dict[str, int]
    ramp_seconds: float = 10.0
    llm_mode: str = "simulated"  # simulated | real
    sim: dict = field(default_factory=lambda: {"ttft_ms": 2500, "tokens_per_s": 70, "pad_lines": 40, "error_rate": 0.0})
    prompt: str = DEFAULT_PROMPT
    stay_seconds: int = 120
    chat_requests: int = 5
    log_services: list[str] = field(default_factory=lambda: ["api", "api-pool", "nginx", "vibe-qa", "postgres"])
    log_access: bool = True
    label: str = ""

    @classmethod
    def from_payload(cls, data: dict) -> "RunConfig":
        scenarios = {k: max(0, min(int(v or 0), MAX_USERS)) for k, v in (data.get("scenarios") or {}).items() if k in SCENARIOS}
        scenarios = {k: v for k, v in scenarios.items() if v}
        if not scenarios:
            raise ValueError("Scegli almeno una sezione con un numero di utenti maggiore di zero")
        if sum(scenarios.values()) > MAX_USERS:
            raise ValueError(f"Al massimo {MAX_USERS} utenti virtuali per prova")
        mode = data.get("llm_mode") if data.get("llm_mode") in ("simulated", "real") else "simulated"
        sim = {**cls.__dataclass_fields__["sim"].default_factory(), **(data.get("sim") or {})}
        return cls(
            scenarios=scenarios,
            ramp_seconds=max(0.0, min(float(data.get("ramp_seconds", 10)), 600.0)),
            llm_mode=mode, sim=sim,
            prompt=(str(data.get("prompt") or "").strip() or DEFAULT_PROMPT)[:4000],
            stay_seconds=max(0, min(int(data.get("stay_seconds", 120)), 3600)),
            chat_requests=max(1, min(int(data.get("chat_requests", 5)), 50)),
            log_services=[s for s in (data.get("log_services") or []) if s in monitor.WATCHED],
            log_access=bool(data.get("log_access", True)),
            label=str(data.get("label") or "")[:120],
        )


class Run:
    def __init__(self, config: RunConfig, *, join_code: str, session_id: str, started_by: str):
        self.id = datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(2)
        self.config = config
        self.join_code = join_code
        self.session_id = session_id
        self.started_by = started_by
        self.status = "preparing"
        self.created_at = _now_iso()
        self.ended_at: Optional[str] = None
        self.t0 = time.monotonic()
        self.bus = EventBus()
        self.stats: dict[str, StepStats] = {}
        self.users: list[VUser] = []
        self.timeline: list[dict] = []
        self.peaks: dict[str, Any] = {}
        self.log_counts: Counter = Counter()
        self.log_errors: Counter = Counter()
        self.dropped_logs: Counter = Counter()
        self._log_window: dict[str, tuple[int, int]] = {}
        self.stop_event = asyncio.Event()
        self.sampler = monitor.Sampler()
        self.task: Optional[asyncio.Task] = None
        self.report: Optional[dict] = None
        self.created: dict[str, list[str]] = {"student_ids": [], "project_ids": [], "job_ids": []}
        self.cost: Optional[dict] = None

    # ── publishing ──────────────────────────────────────────────────────────────
    def t(self) -> float:
        return round(time.monotonic() - self.t0, 2)

    def log(self, source: str, level: str, message: str, user: Optional[int] = None) -> None:
        self.log_counts[source] += 1
        if level == "error":
            self.log_errors[source] += 1
        self.bus.publish("log", {"t": self.t(), "source": source, "level": level, "msg": message[:1200], "user": user})

    def container_line(self, service: str, line: str) -> None:
        if not self.config.log_access and monitor.access_path(line) and monitor.classify(line) == "info":
            return
        second = int(time.monotonic())
        window, count = self._log_window.get(service, (second, 0))
        if window != second:
            if count > LOG_LINES_PER_SECOND:
                self.log("runner", "warn", f"{service}: {count - LOG_LINES_PER_SECOND} righe di log omesse nell'ultimo secondo")
            window, count = second, 0
        count += 1
        self._log_window[service] = (window, count)
        if count > LOG_LINES_PER_SECOND:
            self.dropped_logs[service] += 1
            return
        self.log(service, monitor.classify(line), line)

    def set_user(self, user: VUser, state: Optional[str] = None, detail: Optional[str] = None) -> None:
        if state:
            user.state = state
        if detail is not None:
            user.detail = detail
        self.bus.publish("user", {"t": self.t(), **user.public()})

    def stat(self, step: str) -> StepStats:
        return self.stats.setdefault(step, StepStats())

    def record(self, step: str, ms: float, ok: bool, error: Optional[str] = None) -> None:
        s = self.stat(step)
        s.finished.append((time.monotonic(), ms, ok))
        if ok:
            s.ok += 1
            s.durations.append(ms)
        else:
            s.errors[error or "errore"] += 1

    # ── HTTP helpers ────────────────────────────────────────────────────────────
    def headers(self, user: VUser) -> dict:
        h = {"Accept-Language": "it", "X-App-Language": "it"}
        if settings.LOAD_TEST_SECRET:
            h["X-Load-Test"] = settings.LOAD_TEST_SECRET
            if self.config.llm_mode == "simulated":
                h["X-Load-Test-Sim"] = json.dumps(self.config.sim)
        if user.token:
            h["student-token"] = user.token
        return h

    async def call(self, client: httpx.AsyncClient, user: VUser, step: str, method: str, path: str, **kw) -> Optional[httpx.Response]:
        start = time.perf_counter()
        try:
            response = await client.request(method, TARGET + path, headers=self.headers(user), **kw)
        except Exception as exc:
            ms = (time.perf_counter() - start) * 1000
            reason = f"{type(exc).__name__}"
            self.record(step, ms, False, reason)
            self.log("client", "error", f"#{user.index} {method} {path} → {reason} dopo {ms:.0f} ms", user.index)
            return None
        ms = (time.perf_counter() - start) * 1000
        if response.status_code >= 400:
            detail = _detail(response)
            self.record(step, ms, False, f"HTTP {response.status_code}: {detail[:90]}")
            self.log("client", "error", f"#{user.index} {method} {path} → {response.status_code} in {ms:.0f} ms · {detail[:300]}", user.index)
            return None
        self.record(step, ms, True)
        self.log("client", "warn" if ms > 2000 else "info", f"#{user.index} {method} {path} → {response.status_code} in {ms:.0f} ms", user.index)
        return response

    # ── scenarios ───────────────────────────────────────────────────────────────
    async def login_and_open(self, client: httpx.AsyncClient, user: VUser) -> bool:
        self.set_user(user, "login", "Login nella sessione di test")
        password = secrets.token_urlsafe(12)
        r = await self.call(client, user, "join", "POST", "/api/v1/student/join",
                            json={"join_code": self.join_code, "nickname": user.nickname, "password": password})
        if r is None:
            return False
        data = r.json()
        user.token, user.student_id = data.get("join_token"), str(data.get("student_id"))
        self.created["student_ids"].append(user.student_id)
        await self.call(client, user, "session", "GET", "/api/v1/student/session")
        await self.call(client, user, "credits", "GET", "/api/v1/student/credits/balance")
        self.set_user(user, "open", "Apre Vibe Lab")
        results = await asyncio.gather(
            self.call(client, user, "open_projects", "GET", "/api/v1/coding/projects"),
            self.call(client, user, "open_briefs", "GET", "/api/v1/coding/briefs"),
            self.call(client, user, "open_design", "GET", "/api/v1/coding/design-systems"),
        )
        return results[0] is not None

    async def scenario_access(self, client: httpx.AsyncClient, user: VUser) -> None:
        if not await self.login_and_open(client, user):
            raise _UserFailed("apertura di Vibe Lab non riuscita")
        deadline = time.monotonic() + self.config.stay_seconds
        self.set_user(user, "idle", "Sulla pagina di Vibe Lab")
        while time.monotonic() < deadline and not self.stop_event.is_set():
            await _sleep(self.stop_event, random.uniform(12, 18))
            if self.stop_event.is_set():
                break
            await asyncio.gather(
                self.call(client, user, "poll_projects", "GET", "/api/v1/coding/projects"),
                self.call(client, user, "poll_jobs", "GET", "/api/v1/jobs"),
            )

    async def scenario_chat(self, client: httpx.AsyncClient, user: VUser) -> None:
        if not await self.login_and_open(client, user):
            raise _UserFailed("apertura di Vibe Lab non riuscita")
        for n in range(self.config.chat_requests):
            if self.stop_event.is_set():
                return
            self.set_user(user, "chat", f"Domanda {n + 1}/{self.config.chat_requests} all'assistente")
            await self.call(client, user, "ai_chat", "POST", "/api/v1/coding/ai/chat", timeout=180,
                            json={"content": "Dammi un consiglio breve per studiare le frazioni.", "history": []})
            await _sleep(self.stop_event, random.uniform(2, 6))

    async def scenario_generate(self, client: httpx.AsyncClient, user: VUser) -> None:
        if not await self.login_and_open(client, user):
            raise _UserFailed("apertura di Vibe Lab non riuscita")
        self.set_user(user, "creating", "Crea il progetto")
        prompt = self.config.prompt
        r = await self.call(client, user, "create_project", "POST", "/api/v1/coding/projects", json={
            "title": f"Stress test {self.id} #{user.index}", "template_key": "vite-react", "initial_prompt": prompt,
            "kb_files": [{"path": "description.md", "content": prompt}],
        })
        if r is None:
            raise _UserFailed("creazione del progetto non riuscita")
        user.project_id = str(r.json().get("id"))
        self.created["project_ids"].append(user.project_id)
        await self.generate(client, user, prompt)
        if user.state == "done":
            r = await self.call(client, user, "reload_project", "GET", f"/api/v1/coding/projects/{user.project_id}")
            try:
                problems = validate_generation(r.json() if r is not None else None, user.done_event)
            except Exception as exc:  # a malformed answer is itself a failed check
                problems = [f"risposta del progetto non leggibile ({type(exc).__name__})"]
            user.problems = problems
            user.valid = not problems
            self.record("gen_valid", 0.0, user.valid, None if user.valid else _short(problems[0]))
            if user.valid:
                self.set_user(user, detail=f"Valido · {user.done_event.get('files', 0)} file · build superata")
            else:
                self.log("client", "error", f"#{user.index} generazione NON valida: {'; '.join(problems)}", user.index)
                self.set_user(user, detail="Generato ma non valido: " + problems[0])

    async def generate(self, client: httpx.AsyncClient, user: VUser, prompt: str) -> None:
        self.set_user(user, "generating", "Avvio della generazione")
        path = f"/api/v1/coding/projects/{user.project_id}/generate-stream"
        start = time.perf_counter()
        last = start
        max_gap = 0.0
        first_event: Optional[float] = None
        outcome: Optional[str] = None
        try:
            async with client.stream("POST", TARGET + path, headers={**self.headers(user), "Content-Type": "application/json"},
                                     json={"prompt": prompt}, timeout=httpx.Timeout(30, read=180)) as response:
                ttfb = (time.perf_counter() - start) * 1000
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", errors="replace")
                    detail = _detail_text(body)
                    self.record("gen_ttfb", ttfb, False, f"HTTP {response.status_code}: {detail[:90]}")
                    raise _UserFailed(f"generazione rifiutata: HTTP {response.status_code} · {detail[:200]}")
                self.record("gen_ttfb", ttfb, True)
                user.job_id = response.headers.get("X-Job-Id")
                if user.job_id:
                    self.created["job_ids"].append(user.job_id)
                self.log("client", "info", f"#{user.index} generazione avviata in {ttfb:.0f} ms (job {user.job_id or '?'})", user.index)
                async for line in response.aiter_lines():
                    now = time.perf_counter()
                    max_gap = max(max_gap, now - last)
                    last = now
                    if not line.startswith("data: "):
                        continue
                    try:
                        event = json.loads(line[6:])
                    except ValueError:
                        continue
                    user.events += 1
                    if first_event is None:
                        first_event = (now - start) * 1000
                        self.record("gen_first_event", first_event, True)
                    kind = event.get("type")
                    if kind == "status":
                        self.set_user(user, detail=str(event.get("message") or ""))
                        self.log("client", "info", f"#{user.index} ▸ {event.get('message')}", user.index)
                    elif kind == "plan":
                        self.log("client", "info", f"#{user.index} piano: {len(event.get('files') or [])} file", user.index)
                    elif kind == "file_done":
                        user.files_done += 1
                        self.set_user(user, detail=f"{user.files_done} file pronti · {event.get('path')}")
                    elif kind == "error":
                        outcome = f"{event.get('code') or 'error'}: {event.get('message')}"
                    elif kind == "done":
                        outcome = "done"
                        user.done_event = {"version_number": event.get("version_number"), "needs_review": bool(event.get("needs_review")),
                                           "files": len(event.get("files") or [])}
                        gate = event.get("gate") or {}
                        self.log("client", "info", f"#{user.index} ✔ versione {event.get('version_number')} · "
                                 f"{len(event.get('files') or [])} file · build gate {'eseguito' if gate.get('ran') else 'non eseguito'}"
                                 f"{' · da rivedere' if event.get('needs_review') else ''}", user.index)
        except _UserFailed:
            raise
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            outcome = outcome or f"stream interrotto: {type(exc).__name__}"
        total = (time.perf_counter() - start) * 1000
        self.record("gen_max_gap", max_gap * 1000, True)
        if outcome == "done":
            self.record("gen_total", total, True)
            self.set_user(user, "done", f"Pronto in {total / 1000:.1f} s")
        else:
            outcome = outcome or "stream terminato senza esito"
            self.record("gen_total", total, False, outcome[:90])
            raise _UserFailed(outcome)

    # ── orchestration ───────────────────────────────────────────────────────────
    async def run_user(self, client: httpx.AsyncClient, user: VUser, delay: float) -> None:
        await _sleep(self.stop_event, delay)
        if self.stop_event.is_set():
            self.set_user(user, "stopped", "Non avviato")
            return
        user.started = time.monotonic()
        handler = {"vibe_access": self.scenario_access, "vibe_generate": self.scenario_generate, "vibe_ai_chat": self.scenario_chat}[user.scenario]
        try:
            await handler(client, user)
            if user.state not in ("done",):
                self.set_user(user, "done", "Completato")
        except _UserFailed as exc:
            user.error = str(exc)
            self.set_user(user, "error", str(exc))
        except asyncio.CancelledError:
            self.set_user(user, "stopped", "Interrotto")
        except Exception as exc:
            user.error = f"{type(exc).__name__}: {exc}"
            self.set_user(user, "error", user.error)
            logger.exception("load test user %s crashed", user.index)
        finally:
            user.ended = time.monotonic()

    async def ticker(self) -> None:
        """One reading per second until `_finish` cancels it."""
        while True:
            await asyncio.sleep(1.0)
            now = time.monotonic()
            window: list[float] = []
            errors_1s = 0
            done_1s = 0
            for step, s in self.stats.items():
                if step.startswith("gen_") and step != "gen_ttfb":
                    continue  # stream durations are not request latencies
                for ts, ms, ok in reversed(s.finished):
                    if now - ts > 5:
                        break
                    if ok:
                        window.append(ms)
                    if now - ts <= 1:
                        done_1s += 1
                        errors_1s += 0 if ok else 1
            point = {
                "t": self.t(), "rps": done_1s, "errors": errors_1s,
                "lat_p50": percentile(window, 0.5), "lat_p95": percentile(window, 0.95),
                "states": dict(Counter(u.state for u in self.users)), "probes": dict(self.sampler.probes),
                "containers": self.sampler.stats, "db": self.sampler.db,
                "log_errors": dict(self.log_errors),
            }
            self.timeline.append(point)
            self._track_peaks(point)
            self.bus.publish("metrics", point)

    def _track_peaks(self, point: dict) -> None:
        p = self.peaks
        for service, ms in (point.get("probes") or {}).items():
            key = f"probe_{service}"
            p[key] = max(p.get(key) or 0, ms or 0)
            if ms is None:
                p[f"probe_{service}_failures"] = p.get(f"probe_{service}_failures", 0) + 1
        for service, s in (point.get("containers") or {}).items():
            if "cpu" in s:
                p.setdefault("cpu", {})[service] = max(p.get("cpu", {}).get(service, 0), s["cpu"])
                p.setdefault("mem_mb", {})[service] = max(p.get("mem_mb", {}).get(service, 0), s["mem_mb"])
        db = point.get("db") or {}
        for key in ("total", "active", "idle_in_tx", "lock_wait", "jobs_running"):
            if key in db:
                p[f"db_{key}"] = max(p.get(f"db_{key}", 0), db[key])
        if "max" in db:
            p["db_max"] = db["max"]

    async def execute(self) -> None:
        self.status = "running"
        self.bus.publish("status", {"t": self.t(), "status": self.status})
        cfg = self.config
        total = sum(cfg.scenarios.values())
        self.log("runner", "info", f"Avvio prova {self.id}: {total} utenti virtuali · LLM {'simulato' if cfg.llm_mode == 'simulated' else 'REALE'} · "
                 f"ramp-up {cfg.ramp_seconds:.0f} s · bersaglio {TARGET}")
        if cfg.llm_mode == "simulated" and not settings.LOAD_TEST_SECRET:
            self.log("runner", "error", "LOAD_TEST_SECRET non configurato: l'API non può simulare il modello, le chiamate sarebbero reali. Prova annullata.")
            self.status = "failed"
            return await self._finish()
        index = 0
        for scenario, count in cfg.scenarios.items():
            for _ in range(count):
                index += 1
                self.users.append(VUser(index=index, scenario=scenario, nickname=f"lt{self.id[-4:]}{index:03d}"))
        for user in self.users:
            self.bus.publish("user", {"t": 0, **user.public()})

        try:
            self.sampler.containers = await monitor.list_containers()
        except Exception as exc:
            self.log("runner", "warn", f"Docker non raggiungibile ({type(exc).__name__}): niente CPU/log dei container")
        if self.sampler.containers:
            self.log("runner", "info", "Container osservati: " + ", ".join(sorted(c.service for c in self.sampler.containers)))
        log_tasks = [asyncio.create_task(monitor.follow_logs(c, self.container_line, self.stop_event))
                     for c in self.sampler.containers if c.service in cfg.log_services]
        monitor_stop = asyncio.Event()
        sampler_task = asyncio.create_task(self.sampler.loop(monitor_stop, self.t0))
        ticker_task = asyncio.create_task(self.ticker())

        limits = httpx.Limits(max_connections=2000, max_keepalive_connections=500)
        async with httpx.AsyncClient(limits=limits, timeout=httpx.Timeout(60, connect=15)) as client:
            spacing = cfg.ramp_seconds / max(total - 1, 1) if total > 1 else 0
            user_tasks = [asyncio.create_task(self.run_user(client, u, i * spacing)) for i, u in enumerate(self.users)]
            done_wait = asyncio.gather(*user_tasks, return_exceptions=True)
            stop_wait = asyncio.create_task(self.stop_event.wait())
            await asyncio.wait([done_wait, stop_wait], return_when=asyncio.FIRST_COMPLETED)
            if self.stop_event.is_set() and not done_wait.done():
                self.status = "stopping"
                self.bus.publish("status", {"t": self.t(), "status": self.status})
                self.log("runner", "warn", "Interruzione richiesta: chiudo gli stream e annullo i job ancora in corso sul server")
                await self.cancel_server_jobs(client)
                for task in user_tasks:
                    task.cancel()
                await asyncio.gather(*user_tasks, return_exceptions=True)
                self.status = "stopped"
            else:
                self.status = "completed"
            stop_wait.cancel()
        # A few seconds of tail so the logs and readings of the last requests are captured too.
        await asyncio.sleep(3)
        self.stop_event.set()
        monitor_stop.set()
        for task in log_tasks:
            task.cancel()
        await asyncio.gather(sampler_task, *log_tasks, return_exceptions=True)
        await self._finish(ticker_task)

    async def cancel_server_jobs(self, client: httpx.AsyncClient) -> None:
        running = [u for u in self.users if u.job_id and u.state == "generating"]
        await asyncio.gather(*(client.post(f"{TARGET}/api/v1/jobs/{u.job_id}/cancel", headers=self.headers(u), timeout=10)
                               for u in running), return_exceptions=True)
        if running:
            self.log("runner", "info", f"Richiesto l'annullamento di {len(running)} generazioni sul server")

    async def _finish(self, ticker_task: Optional[asyncio.Task] = None) -> None:
        self.stop_event.set()
        if ticker_task:
            ticker_task.cancel()
            await asyncio.gather(ticker_task, return_exceptions=True)
        self.ended_at = _now_iso()
        try:
            self.cost = await test_cost(self.created.get("student_ids") or [])
        except Exception as exc:
            self.cost = None
            self.log("runner", "warn", f"Costo non calcolato: {type(exc).__name__}: {exc}")
        self.report = self.build_report()
        try:
            REPORT_DIR.mkdir(parents=True, exist_ok=True)
            (REPORT_DIR / f"{self.id}.json").write_text(json.dumps(self.report, default=str))
        except Exception as exc:
            self.log("runner", "warn", f"Report non salvato su disco: {exc}")
        self.log("runner", "info", f"Prova terminata ({self.status}). Report pronto.")
        self.bus.publish("status", {"t": self.t(), "status": self.status})
        self.bus.publish("report", {"report": self.report})
        await self.bus.close()

    # ── report ──────────────────────────────────────────────────────────────────
    def build_report(self) -> dict:
        steps = {step: {**s.summary(), "label": STEP_LABELS.get(step, step)} for step, s in self.stats.items()}
        by_scenario: dict[str, dict] = {}
        for u in self.users:
            row = by_scenario.setdefault(u.scenario, {"users": 0, "done": 0, "error": 0, "stopped": 0, "other": 0, "errors": Counter(),
                                                      "valid": 0, "invalid": 0, "problems": Counter()})
            row["users"] += 1
            if u.valid is True:
                row["valid"] += 1
            elif u.valid is False:
                row["invalid"] += 1
                for problem in u.problems:
                    row["problems"][_short(problem)] += 1
            key = u.state if u.state in ("done", "error", "stopped") else "other"
            row[key] += 1
            if u.error:
                row["errors"][_short(u.error)] += 1
        for row in by_scenario.values():
            row["errors"] = dict(row["errors"].most_common(10))
            row["problems"] = dict(row["problems"].most_common(10))
        probe_values: dict[str, list[float]] = {}
        probe_failures: Counter = Counter()
        for _, service, ms in self.sampler.probe_history:
            if ms is None:
                probe_failures[service] += 1
            else:
                probe_values.setdefault(service, []).append(ms)
        probes = {s: {"p50": percentile(v, .5), "p95": percentile(v, .95), "max": max(v) if v else None,
                      "failures": probe_failures.get(s, 0)} for s, v in probe_values.items()}
        report = {
            "id": self.id, "label": self.config.label, "status": self.status, "created_at": self.created_at,
            "ended_at": self.ended_at, "duration_s": self.t(), "started_by": self.started_by, "target": TARGET,
            "config": self.config.__dict__, "scenarios": by_scenario, "steps": steps, "probes": probes,
            "peaks": self.peaks, "logs": {"lines": dict(self.log_counts), "errors": dict(self.log_errors), "dropped": dict(self.dropped_logs)},
            "created": self.created, "users": [u.public() for u in self.users],
            "timeline": self.timeline[-3600:], "cost": self.cost,
        }
        report["findings"] = findings(report)
        return report

    def snapshot(self) -> dict:
        return {"id": self.id, "status": self.status, "created_at": self.created_at, "ended_at": self.ended_at,
                "config": self.config.__dict__, "label": self.config.label, "users": len(self.users), "seq": self.bus.seq}


class _UserFailed(Exception):
    pass


def _detail(response: httpx.Response) -> str:
    try:
        return _detail_text(response.text)
    except Exception:
        return ""


def _detail_text(body: str) -> str:
    try:
        data = json.loads(body)
        detail = data.get("detail", data) if isinstance(data, dict) else data
        if isinstance(detail, dict):
            detail = detail.get("message") or detail.get("code") or json.dumps(detail)
        return str(detail)
    except ValueError:
        return body.strip().replace("\n", " ")[:300]


def _short(text: str) -> str:
    return text[:140]


async def _sleep(stop: asyncio.Event, seconds: float) -> None:
    if seconds <= 0:
        return
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except asyncio.TimeoutError:
        pass


def validate_generation(project: Optional[dict], done: dict) -> list[str]:
    """What «the project was really generated» means: the saved current version is the one the stream announced,
    carries a non-empty entry file and real source files, and the platform's own build check passed.
    Returns the list of problems (empty = valid)."""
    if not project:
        return ["progetto non riaperto dopo la generazione"]
    problems: list[str] = []
    if project.get("status") != "generated":
        problems.append(f"stato del progetto «{project.get('status')}» invece di «generated»")
    versions = project.get("versions") or []
    current = next((v for v in versions if v.get("id") == project.get("current_version_id")), None) or (versions[-1] if versions else None)
    if not current:
        return problems + ["nessuna versione salvata"]
    announced = done.get("version_number")
    if announced is not None and current.get("version_number") != announced:
        problems.append(f"versione salvata {current.get('version_number')} diversa da quella annunciata {announced}")
    elif announced is None and (current.get("version_number") or 0) < 2:
        problems.append("nessuna versione nuova creata dalla generazione")
    files = [f for f in ((current.get("source_manifest_json") or {}).get("files") or []) if isinstance(f, dict)]
    filled = [f for f in files if str(f.get("content") or "").strip()]
    if not files:
        problems.append("la versione salvata non contiene file")
    elif len(filled) < len(files):
        problems.append(f"{len(files) - len(filled)} file vuoti su {len(files)}")
    if files and not any(str(f.get("path") or "").rsplit("/", 1)[-1] in ("App.tsx", "App.jsx") and str(f.get("content") or "").strip() for f in files):
        problems.append("manca il file principale App.tsx")
    if current.get("build_status") != "build_passed":
        problems.append(f"build «{current.get('build_status')}» invece di «build_passed»")
    if done.get("needs_review") and current.get("build_status") == "build_passed":
        problems.append("la piattaforma ha segnalato il progetto «da rivedere»")
    return problems


async def test_cost(student_ids: list[str]) -> dict:
    """What the run really cost: the credit transactions of exactly the students it created."""
    empty = {"total": 0.0, "calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "by_model": [], "unit": "USD"}
    if not student_ids:
        return empty
    from sqlalchemy import text
    from app.core.database import AsyncSessionLocal
    ids = [uuid.UUID(i) for i in student_ids]
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT coalesce(provider, '?') AS provider, coalesce(model, '?') AS model, count(*) AS calls, coalesce(sum(cost), 0) AS cost,
                   coalesce(sum((usage_details->>'prompt_tokens')::bigint), 0) AS pt,
                   coalesce(sum((usage_details->>'completion_tokens')::bigint), 0) AS ct
            FROM credit_transactions WHERE student_id = ANY(:ids) GROUP BY 1, 2 ORDER BY 4 DESC
        """), {"ids": ids})).all()
    by_model = [{"provider": r.provider, "model": r.model, "calls": int(r.calls), "cost": round(float(r.cost), 5),
                 "prompt_tokens": int(r.pt), "completion_tokens": int(r.ct)} for r in rows]
    return {"total": round(sum(m["cost"] for m in by_model), 5), "calls": sum(m["calls"] for m in by_model),
            "prompt_tokens": sum(m["prompt_tokens"] for m in by_model), "completion_tokens": sum(m["completion_tokens"] for m in by_model),
            "by_model": by_model, "unit": "USD"}


def findings(report: dict) -> list[dict]:
    """Plain-language verdicts for the admin, from the measured numbers. severity: ok | warn | critical."""
    out: list[dict] = []
    steps, peaks, probes = report["steps"], report["peaks"], report["probes"]

    for scenario, row in report["scenarios"].items():
        label = SCENARIOS.get(scenario, {}).get("label", scenario)
        finished = row["done"] + row["error"]
        if not finished:
            continue
        rate = row["done"] / finished
        top = next(iter(row["errors"]), None)
        if rate >= 0.99:
            out.append({"severity": "ok", "title": f"{label}: {row['done']}/{finished} utenti completati",
                        "detail": "Nessun errore significativo per questa sezione."})
        else:
            out.append({"severity": "critical" if rate < 0.9 else "warn",
                        "title": f"{label}: solo il {rate * 100:.0f}% degli utenti è arrivato in fondo",
                        "detail": f"{row['error']} utenti falliti." + (f" Errore più frequente: «{top}»." if top else "")})

    for scenario, row in report["scenarios"].items():
        checked = row.get("valid", 0) + row.get("invalid", 0)
        if not checked:
            continue
        top = next(iter(row.get("problems") or {}), None)
        if row["invalid"] == 0:
            out.append({"severity": "ok", "title": f"{row['valid']}/{checked} progetti generati davvero (salvati, con file e build superata)",
                        "detail": "Per ogni progetto concluso ho riaperto la versione salvata e verificato versione, file, App.tsx e build."})
        else:
            out.append({"severity": "critical" if row["invalid"] / checked >= 0.1 else "warn",
                        "title": f"{row['invalid']}/{checked} progetti conclusi ma NON validi",
                        "detail": "Lo stream è terminato con successo ma il risultato salvato non è utilizzabile." + (f" Problema più frequente: «{top}»." if top else "")})

    gen = steps.get("gen_total")
    if gen and gen.get("p95"):
        out.append({"severity": "warn" if gen["p95"] > 240_000 else "ok",
                    "title": f"Generazione: mediana {gen['p50'] / 1000:.0f} s, 95° percentile {gen['p95'] / 1000:.0f} s",
                    "detail": "Tempo dall'invio della richiesta alla versione pronta, per studente."})
    ttfb = steps.get("gen_ttfb")
    if ttfb and (ttfb.get("p95") or 0) > 5000:
        out.append({"severity": "warn", "title": f"Avvio lento delle generazioni (p95 {ttfb['p95'] / 1000:.1f} s)",
                    "detail": "La richiesta di generazione impiega secondi solo per partire: contesa sul pool DB o sull'avvio dei job."})
    gap = steps.get("gen_max_gap")
    if gap and (gap.get("p95") or 0) > 20_000:
        out.append({"severity": "warn", "title": f"Stream fermi fino a {gap['max'] / 1000:.0f} s",
                    "detail": "Per il 5% degli studenti l'avanzamento resta immobile per più di 20 s: è il «lag» percepito."})

    for service, p in probes.items():
        if p.get("failures"):
            out.append({"severity": "critical", "title": f"{service}: {p['failures']} controlli di salute falliti",
                        "detail": "Il processo non ha risposto entro 10 s: per qualche istante la piattaforma era irraggiungibile."})
        elif (p.get("p95") or 0) > 500:
            out.append({"severity": "critical" if p["p95"] > 2000 else "warn",
                        "title": f"{service} rallentato: /health p95 {p['p95']:.0f} ms (max {p['max']:.0f} ms)",
                        "detail": "Una richiesta banale aspetta il turno: l'event loop è saturo e TUTTE le pagine servite da questo processo rallentano."})
        elif p.get("p95") is not None:
            out.append({"severity": "ok", "title": f"{service} reattivo: /health p95 {p['p95']:.0f} ms",
                        "detail": "Il processo è rimasto responsivo durante il carico."})

    if peaks.get("db_max"):
        used = peaks.get("db_total", 0) / peaks["db_max"]
        if used >= 0.8:
            out.append({"severity": "critical", "title": f"Connessioni Postgres al {used * 100:.0f}% del massimo ({peaks['db_total']}/{peaks['db_max']})",
                        "detail": "Vicini al limite: nuove richieste rischiano di attendere o fallire."})
        if peaks.get("db_lock_wait", 0) > 0:
            out.append({"severity": "warn", "title": f"Fino a {peaks['db_lock_wait']} query in attesa di lock",
                        "detail": "Contesa su righe/tabelle condivise durante il carico."})
        if peaks.get("db_idle_in_tx", 0) >= 10:
            out.append({"severity": "warn", "title": f"Fino a {peaks['db_idle_in_tx']} connessioni «idle in transaction»",
                        "detail": "Connessioni tenute aperte mentre si aspetta altro (es. il modello): consumano il pool senza lavorare."})
    for service, cpu in (peaks.get("cpu") or {}).items():
        if cpu >= 90 and service in ("api", "vibe-qa", "postgres"):
            out.append({"severity": "warn", "title": f"CPU di {service} al {cpu:.0f}% (picco)",
                        "detail": "Un processo che arriva a saturare un core diventa il collo di bottiglia." if service == "api"
                        else "Componente saturo durante il carico."})
    errors_in_logs = sum(report["logs"]["errors"].get(s, 0) for s in report["logs"]["errors"] if s not in ("client", "runner"))
    if errors_in_logs:
        out.append({"severity": "warn", "title": f"{errors_in_logs} righe di errore nei log dei container",
                    "detail": "Filtra i log per livello «errore» per vederle."})
    cost = report.get("cost")
    if cost and cost.get("calls"):
        n = max(1, sum(r.get("valid", 0) + r.get("invalid", 0) for r in report["scenarios"].values()))
        out.append({"severity": "ok", "title": f"Costo della prova: {cost['total']:.3f} $ ({cost['calls']} chiamate AI)",
                    "detail": f"Circa {cost['total'] / n:.3f} $ per progetto generato." if report["config"].get("llm_mode") == "real"
                    else "Modelli simulati: nessun costo reale."})
    order = {"critical": 0, "warn": 1, "ok": 2}
    return sorted(out, key=lambda f: order[f["severity"]])
