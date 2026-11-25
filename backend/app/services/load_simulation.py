"""Simulated LLM for platform load tests (admin «Stress test», `app/loadtest`).

A load test must measure the PLATFORM (event loop, DB pool, background jobs, SSE relay, build gate)
under many simultaneous users without paying 100 real generations. Requests sent by the load-test
runner carry `X-Load-Test: <LOAD_TEST_SECRET>` and, for the simulated mode, `X-Load-Test-Sim: {json}`.
The ASGI middleware below turns that into a ContextVar; `llm_service` then answers from this module with
realistic timing (time to first token + tokens/s) and output in the exact formats the Vibe Lab pipeline
parses (architect plan, parallel workers, single-call files). Background jobs copy the context when
their task is created, so the detached generation stays simulated too.

Without LOAD_TEST_SECRET configured the header is ignored: production never simulates.
"""
from __future__ import annotations

import asyncio
import contextvars
import hmac
import json
import random
import re
from dataclasses import dataclass
from typing import AsyncIterator, Optional

from app.core.config import settings


@dataclass(frozen=True)
class SimConfig:
    ttft_ms: int = 2500          # mean time to first token
    tokens_per_s: float = 70.0   # streaming speed of one call
    pad_lines: int = 40          # filler lines per generated file (output size)
    error_rate: float = 0.0      # share of calls that fail like an overloaded provider (0..1)

    @classmethod
    def parse(cls, raw: str) -> "SimConfig":
        try:
            data = json.loads(raw) if raw else {}
        except ValueError:
            data = {}
        def num(key, lo, hi, default):
            try:
                return min(max(type(default)(data.get(key, default)), lo), hi)
            except (TypeError, ValueError):
                return default
        return cls(
            ttft_ms=num("ttft_ms", 0, 120_000, cls.ttft_ms),
            tokens_per_s=num("tokens_per_s", 1.0, 5000.0, cls.tokens_per_s),
            pad_lines=num("pad_lines", 0, 2000, cls.pad_lines),
            error_rate=num("error_rate", 0.0, 1.0, cls.error_rate),
        )


_sim: contextvars.ContextVar[Optional[SimConfig]] = contextvars.ContextVar("load_test_sim", default=None)
_tagged: contextvars.ContextVar[bool] = contextvars.ContextVar("load_test_tagged", default=False)


def active() -> Optional[SimConfig]:
    return _sim.get()


def is_load_test() -> bool:
    return _tagged.get()


class LoadTestMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so the ContextVar reaches the endpoint and its background tasks."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        secret = settings.LOAD_TEST_SECRET
        if scope["type"] != "http" or not secret:
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        given = headers.get(b"x-load-test", b"").decode("latin-1")
        if not given or not hmac.compare_digest(given, secret):
            await self.app(scope, receive, send)
            return
        tag = _tagged.set(True)
        raw_sim = headers.get(b"x-load-test-sim")
        token = _sim.set(SimConfig.parse(raw_sim.decode("latin-1"))) if raw_sim else None
        try:
            await self.app(scope, receive, send)
        finally:
            if token is not None:
                _sim.reset(token)
            _tagged.reset(tag)


# ── Simulated output ─────────────────────────────────────────────────────────────────────────

_PLAN = [
    ("1", "App.tsx", "composizione e navigazione", "export default function App()"),
    ("2", "components/Counter.tsx", "contatore interattivo", "export default function Counter(props: { start: number })"),
    ("3", "components/TaskList.tsx", "lista di attivita", "export default function TaskList(props: { title: string })"),
]

_SHARED = """=== FILE: types.ts ===
export type Task = { id: number; text: string; done: boolean }
export const START_TASKS: Task[] = [{ id: 1, text: 'Prima attivita', done: false }]
=== FILE: styles.css ===
:root { --bg: #f7f7fb; --ink: #1d1b26; --accent: #6d5bd0; --radius: 14px; --space: 16px; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, sans-serif; }
.container { max-width: 960px; margin: 0 auto; padding: 0 clamp(16px, 4vw, 40px); }
.btn-primary { background: var(--accent); color: #fff; border: 0; border-radius: var(--radius); padding: 8px 16px; }
.card { background: #fff; border-radius: var(--radius); padding: var(--space); }
=== END ==="""


def _pad(n: int, prefix: str = "//") -> str:
    return "\n".join(f"{prefix} riga simulata {i + 1} per il test di carico{' */' if prefix == '/*' else ''}" for i in range(n))


def _component(path: str, pad: int) -> str:
    stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    name = re.sub(r"[^A-Za-z0-9]", "", stem) or "Widget"
    name = name[0].upper() + name[1:]
    css = f"import './{stem}.css'\n"
    filler = _pad(pad)
    if name == "App":
        return (f"{css}import Counter from './components/Counter'\nimport TaskList from './components/TaskList'\n{filler}\n"
                "export default function App() {\n  return (\n    <main className=\"container app\">\n"
                "      <h1>Progetto di prova</h1>\n      <Counter start={0} />\n      <TaskList title=\"Attivita\" />\n"
                "    </main>\n  )\n}\n")
    if name == "Counter":
        return (f"import {{ useState }} from 'react'\n{css}{filler}\n"
                "export default function Counter(props: { start: number }) {\n  const [value, setValue] = useState(props.start)\n"
                "  return (\n    <section className=\"card counter\">\n      <p>Valore: {value}</p>\n"
                "      <button className=\"btn-primary\" onClick={() => setValue(value + 1)}>Aggiungi</button>\n"
                "    </section>\n  )\n}\n")
    if name == "TaskList":
        return (f"import {{ useState }} from 'react'\nimport {{ START_TASKS, type Task }} from '../types'\n{css}{filler}\n"
                "export default function TaskList(props: { title: string }) {\n  const [tasks, setTasks] = useState<Task[]>(START_TASKS)\n"
                "  return (\n    <section className=\"card task-list\">\n      <h2>{props.title}</h2>\n      <ul>\n"
                "        {tasks.map((task) => (\n          <li key={task.id} onClick={() => setTasks(tasks.map((t) => t.id === task.id ? { ...t, done: !t.done } : t))}>\n"
                "            {task.done ? 'Fatto: ' : ''}{task.text}\n          </li>\n        ))}\n      </ul>\n"
                "    </section>\n  )\n}\n")
    return f"{css}{filler}\nexport default function {name}() {{\n  return <div className=\"card\">{name}</div>\n}}\n"


def _css(path: str, pad: int) -> str:
    stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()
    return (f"{_pad(min(pad, 30), '/*')}\n.{stem} {{ display: grid; gap: var(--space); }}\n"
            f"@media (max-width: 720px) {{ .{stem} {{ gap: 8px; }} }}\n")


def _file_block(path: str, pad: int) -> str:
    body = _css(path, pad) if path.lower().endswith(".css") else _component(path, pad)
    return f"=== FILE: {path} ===\n{body}"


def _last_user_text(messages: list[dict]) -> str:
    for message in reversed(messages or []):
        if message.get("role") == "user":
            content = message.get("content")
            return content if isinstance(content, str) else ""
    return ""


def _response_for(messages: list[dict], system_prompt: str | None, cfg: SimConfig) -> str:
    prompt = _last_user_text(messages)
    if "@@PLAN@@" in prompt and "ARCHITETTO" in prompt:
        plan = "\n".join(" | ".join(row) for row in _PLAN)
        return ("Piano: tre viste leggere, stato locale, stile dal brief.\n"
                "Separo contatore e lista per lavorare in parallelo.\n@@PLAN@@\n" + plan + "\n@@SHARED@@\n" + _SHARED + "\n")
    worker = re.search(r"Scrivi SOLO questi file:\s*(.+?)\.\s*\n", prompt)
    if worker and "WORKER" in prompt:
        paths = [p.strip() for p in worker.group(1).split(",") if p.strip()]
        return "\n".join(_file_block(p, cfg.pad_lines) for p in paths) + "\n=== END ===\n"
    if "@@FILES@@" in prompt or "@@FILES@@" in (system_prompt or ""):
        return ("Realizzo una mini app con contatore e lista.\nFile:\n- App.tsx: composizione\n"
                "- components/Counter.tsx: contatore\n- components/TaskList.tsx: lista\n@@FILES@@\n"
                + _SHARED.replace("=== END ===", "").strip() + "\n"
                + "\n".join(_file_block(p, cfg.pad_lines) for _, p, _, _ in _PLAN)
                + "\n" + "\n".join(_file_block(p.rsplit(".", 1)[0] + ".css", cfg.pad_lines) for _, p, _, _ in _PLAN)
                + "\n=== END ===\n")
    if "json" in prompt.lower() or "json" in (system_prompt or "").lower():
        return '{"ok": true, "issues": [], "missing": [], "score": 1}'
    return "Risposta simulata dal test di carico: nessun modello reale e' stato chiamato."


def _maybe_fail(cfg: SimConfig) -> None:
    if cfg.error_rate and random.random() < cfg.error_rate:
        raise RuntimeError("Simulated provider error: 529 overloaded (load test)")


async def _first_token_wait(cfg: SimConfig) -> None:
    await asyncio.sleep(max(0.0, random.gauss(cfg.ttft_ms, cfg.ttft_ms * 0.25)) / 1000)


async def stream(messages: list[dict], system_prompt: str | None, cfg: SimConfig) -> AsyncIterator[str]:
    text = _response_for(messages, system_prompt, cfg)
    await _first_token_wait(cfg)
    _maybe_fail(cfg)
    tick = 0.1
    step = max(4, int(cfg.tokens_per_s * 4 * tick))  # ~4 characters per token
    for start in range(0, len(text), step):
        yield text[start:start + step]
        await asyncio.sleep(tick)


async def complete(messages: list[dict], system_prompt: str | None, cfg: SimConfig) -> str:
    text = _response_for(messages, system_prompt, cfg)
    await _first_token_wait(cfg)
    _maybe_fail(cfg)
    await asyncio.sleep(len(text) / 4 / cfg.tokens_per_s)
    return text
