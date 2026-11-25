"""What the platform does while it is under load: container CPU/memory and logs (Docker API over the mounted
socket), Postgres connections and lock waits, running background jobs, and the response time of the API
processes themselves (a slow /health under load = a saturated event loop, i.e. the «lag» users feel)."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import httpx
from sqlalchemy import text

from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

DOCKER_SOCKET = "/var/run/docker.sock"
PROJECT = os.environ.get("LOADTEST_COMPOSE_PROJECT") or os.environ.get("COMPOSE_PROJECT_NAME") or ""
WATCHED = ("api", "api-pool", "nginx", "postgres", "redis", "vibe-qa", "frontend", "pxt-compiler")
PROBES = {"api": "http://api:8000/health", "api-pool": "http://api-pool:8000/health"}

_LEVEL_ERROR = re.compile(r"\b(ERROR|CRITICAL|FATAL|Traceback|Exception)\b|\" [5]\d\d |\s[5]\d\d\s+\d", re.I)
_LEVEL_WARN = re.compile(r"\b(WARN|WARNING)\b|\" 4(?:0[0-9]|29) |\s4(?:0[0-9]|29)\s+\d")
_ACCESS = re.compile(r'"(GET|POST|PUT|PATCH|DELETE) ([^ ?"]+)')


def classify(line: str) -> str:
    if _LEVEL_ERROR.search(line):
        return "error"
    if _LEVEL_WARN.search(line):
        return "warn"
    return "info"


def docker_available() -> bool:
    return os.path.exists(DOCKER_SOCKET)


def _docker() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds=DOCKER_SOCKET), base_url="http://docker", timeout=10)


@dataclass
class Container:
    id: str
    service: str
    name: str


async def list_containers() -> list[Container]:
    if not docker_available():
        return []
    filters = {"label": [f"com.docker.compose.project={PROJECT}"]} if PROJECT else {}
    async with _docker() as client:
        response = await client.get("/containers/json", params={"filters": json.dumps(filters)})
        response.raise_for_status()
    out = []
    for item in response.json():
        service = (item.get("Labels") or {}).get("com.docker.compose.service") or ""
        if service in WATCHED:
            out.append(Container(id=item["Id"], service=service, name=(item.get("Names") or [""])[0].lstrip("/")))
    return out


def _cpu_percent(stats: dict) -> float:
    cpu, pre = stats.get("cpu_stats") or {}, stats.get("precpu_stats") or {}
    delta = (cpu.get("cpu_usage", {}).get("total_usage", 0) - pre.get("cpu_usage", {}).get("total_usage", 0))
    system = (cpu.get("system_cpu_usage", 0) or 0) - (pre.get("system_cpu_usage", 0) or 0)
    cpus = cpu.get("online_cpus") or len(cpu.get("cpu_usage", {}).get("percpu_usage") or []) or 1
    return round(delta / system * cpus * 100, 1) if system > 0 and delta >= 0 else 0.0


async def container_stats(containers: list[Container]) -> dict[str, dict]:
    if not containers:
        return {}
    async with _docker() as client:
        async def one(c: Container):
            try:
                r = await client.get(f"/containers/{c.id}/stats", params={"stream": "false"})
                s = r.json()
                mem = s.get("memory_stats") or {}
                used = (mem.get("usage") or 0) - ((mem.get("stats") or {}).get("inactive_file") or 0)
                return c.service, {"cpu": _cpu_percent(s), "mem_mb": round(max(used, 0) / 1048576, 1),
                                   "mem_limit_mb": round((mem.get("limit") or 0) / 1048576)}
            except Exception as exc:
                return c.service, {"error": type(exc).__name__}
        pairs = await asyncio.gather(*(one(c) for c in containers))
    return dict(pairs)


async def follow_logs(container: Container, emit: Callable[[str, str], None], stop: asyncio.Event) -> None:
    """Stream a container's stdout/stderr from now on. Docker multiplexes both streams with 8-byte frame headers."""
    params = {"follow": "1", "stdout": "1", "stderr": "1", "since": str(int(time.time())), "tail": "0"}
    while not stop.is_set():
        try:
            async with httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds=DOCKER_SOCKET), base_url="http://docker",
                                         timeout=httpx.Timeout(10, read=None)) as client:
                async with client.stream("GET", f"/containers/{container.id}/logs", params=params) as response:
                    buffer = b""
                    pending = ""
                    async for chunk in response.aiter_bytes():
                        if stop.is_set():
                            return
                        buffer += chunk
                        while len(buffer) >= 8:
                            if buffer[0] in (0, 1, 2) and buffer[1:4] == b"\x00\x00\x00":
                                size = int.from_bytes(buffer[4:8], "big")
                                if len(buffer) < 8 + size:
                                    break
                                payload, buffer = buffer[8:8 + size], buffer[8 + size:]
                            else:  # TTY container: raw stream
                                payload, buffer = buffer, b""
                            pending += payload.decode("utf-8", errors="replace")
                            while "\n" in pending:
                                line, pending = pending.split("\n", 1)
                                if line.strip():
                                    emit(container.service, line.rstrip())
        except Exception as exc:
            emit("runner", f"log stream {container.service} interrotto ({type(exc).__name__}), riprovo")
        params["since"] = str(int(time.time()))
        try:
            await asyncio.wait_for(stop.wait(), timeout=2)
        except asyncio.TimeoutError:
            pass


async def db_stats() -> dict:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT coalesce(state, 'unknown') AS state, (wait_event_type = 'Lock') AS waiting, count(*)
            FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'
            GROUP BY 1, 2
        """))).all()
        max_conn = int((await db.execute(text("SHOW max_connections"))).scalar_one())
        jobs = (await db.execute(text(
            "SELECT count(*) FROM background_jobs WHERE status = 'running' AND kind = 'vibe_generate'"
        ))).scalar_one()
    out = {"total": 0, "active": 0, "idle": 0, "idle_in_tx": 0, "lock_wait": 0, "max": max_conn, "jobs_running": int(jobs)}
    for state, waiting, count in rows:
        out["total"] += count
        if state == "active":
            out["active"] += count
        elif state == "idle":
            out["idle"] += count
        elif state.startswith("idle in transaction"):
            out["idle_in_tx"] += count
        if waiting:
            out["lock_wait"] += count
    return out


async def probe(client: httpx.AsyncClient) -> dict[str, Optional[float]]:
    async def one(url: str) -> Optional[float]:
        start = time.perf_counter()
        try:
            r = await client.get(url, timeout=10)
            return round((time.perf_counter() - start) * 1000, 1) if r.status_code == 200 else None
        except Exception:
            return None
    names = list(PROBES)
    values = await asyncio.gather(*(one(PROBES[n]) for n in names))
    return dict(zip(names, values))


@dataclass
class Sampler:
    """Background loops that keep the latest platform readings for the metrics ticker."""
    containers: list[Container] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    db: dict = field(default_factory=dict)
    probes: dict = field(default_factory=dict)
    probe_history: list = field(default_factory=list)  # (t, service, ms|None)
    error: Optional[str] = None

    async def loop(self, stop: asyncio.Event, started: float) -> None:
        async with httpx.AsyncClient() as client:
            async def probes_loop():
                while not stop.is_set():
                    self.probes = await probe(client)
                    t = round(time.monotonic() - started, 1)
                    for service, ms in self.probes.items():
                        self.probe_history.append((t, service, ms))
                    await _sleep(stop, 1.0)

            async def stats_loop():
                while not stop.is_set():
                    try:
                        self.stats = await container_stats(self.containers)
                    except Exception as exc:
                        self.stats = {}
                        self.error = f"docker stats: {type(exc).__name__}"
                    await _sleep(stop, 1.5)

            async def db_loop():
                while not stop.is_set():
                    try:
                        self.db = await db_stats()
                    except Exception as exc:
                        self.db = {"error": type(exc).__name__}
                    await _sleep(stop, 2.0)

            await asyncio.gather(probes_loop(), stats_loop(), db_loop())


async def _sleep(stop: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except asyncio.TimeoutError:
        pass


def access_path(line: str) -> Optional[str]:
    match = _ACCESS.search(line)
    return f"{match.group(1)} {match.group(2)}" if match else None
