import asyncio
import os
import subprocess
import time
from datetime import datetime, timezone
from typing import Literal

import redis.asyncio as redis
from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.services.storage_service import storage_service


router = APIRouter()

HealthLevel = Literal["green", "yellow", "red"]
_LEVEL_WEIGHT: dict[HealthLevel, int] = {"green": 0, "yellow": 1, "red": 2}
_PROCESS_STARTED_AT = time.monotonic()
_CACHE_TTL_SECONDS = 15.0
_cached_at = 0.0
_cached_result: dict | None = None
_cache_lock = asyncio.Lock()


def _worse(current: HealthLevel, candidate: HealthLevel) -> HealthLevel:
    return candidate if _LEVEL_WEIGHT[candidate] > _LEVEL_WEIGHT[current] else current


def _memory_percent() -> float | None:
    try:
        cgroup_current = int(open("/sys/fs/cgroup/memory.current", encoding="utf-8").read().strip())
        cgroup_max_raw = open("/sys/fs/cgroup/memory.max", encoding="utf-8").read().strip()
        if cgroup_max_raw != "max":
            cgroup_max = int(cgroup_max_raw)
            if cgroup_max > 0:
                return round(cgroup_current / cgroup_max * 100, 1)
    except (OSError, ValueError):
        pass

    try:
        values: dict[str, int] = {}
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, raw = line.split(":", 1)
                values[key] = int(raw.strip().split()[0])
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", 0)
        if total > 0:
            return round((total - available) / total * 100, 1)
    except (OSError, ValueError, IndexError):
        pass
    return None


def _effective_cpu_count() -> float:
    detected = float(max(os.cpu_count() or 1, 1))
    try:
        quota_raw, period_raw = open("/sys/fs/cgroup/cpu.max", encoding="utf-8").read().split()
        if quota_raw != "max":
            quota_count = int(quota_raw) / int(period_raw)
            if quota_count > 0:
                return min(detected, quota_count)
    except (OSError, ValueError, ZeroDivisionError):
        pass
    return detected


def _gpu_metrics() -> dict:
    try:
        output = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            check=True,
            text=True,
            timeout=2,
        ).stdout.strip().splitlines()
        rows = [[float(value.strip()) for value in line.split(",")] for line in output if line.strip()]
        if not rows:
            return {"available": False, "utilization_percent": None, "memory_percent": None}
        utilization = max(row[0] for row in rows)
        memory_percent = max((row[1] / row[2] * 100) if row[2] else 0 for row in rows)
        return {
            "available": True,
            "utilization_percent": round(utilization, 1),
            "memory_percent": round(memory_percent, 1),
        }
    except FileNotFoundError:
        return {"available": None, "utilization_percent": None, "memory_percent": None}
    except (subprocess.SubprocessError, ValueError, IndexError):
        return {"available": False, "utilization_percent": None, "memory_percent": None}


async def _check_database() -> tuple[bool, float]:
    started = time.perf_counter()
    try:
        async with AsyncSessionLocal() as session:
            await asyncio.wait_for(session.execute(text("SELECT 1")), timeout=2.5)
        return True, round((time.perf_counter() - started) * 1000, 1)
    except Exception:
        return False, round((time.perf_counter() - started) * 1000, 1)


async def _check_redis() -> tuple[bool, float]:
    started = time.perf_counter()
    client = redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
    try:
        await asyncio.wait_for(client.ping(), timeout=2.5)
        return True, round((time.perf_counter() - started) * 1000, 1)
    except Exception:
        return False, round((time.perf_counter() - started) * 1000, 1)
    finally:
        await client.aclose()


async def _check_storage() -> bool:
    try:
        return bool(await asyncio.wait_for(
            asyncio.to_thread(storage_service.client.bucket_exists, storage_service.bucket),
            timeout=2.5,
        ))
    except Exception:
        return False


async def _collect_health() -> dict:
    database, redis_status, storage = await asyncio.gather(
        _check_database(),
        _check_redis(),
        _check_storage(),
    )
    database_ok, database_ms = database
    redis_ok, redis_ms = redis_status

    cpu_count = _effective_cpu_count()
    try:
        cpu_percent = round(min(os.getloadavg()[0] / cpu_count * 100, 999.9), 1)
    except OSError:
        cpu_percent = None
    memory_percent = _memory_percent()
    gpu = await asyncio.to_thread(_gpu_metrics)

    level: HealthLevel = "green"
    reasons: list[str] = []

    uptime_seconds = time.monotonic() - _PROCESS_STARTED_AT
    if uptime_seconds < 90:
        level = "red"
        reasons.append("Servizi appena riavviati o aggiornamento in corso")
    if not database_ok:
        level = "red"
        reasons.append("Database non raggiungibile")
    if not redis_ok:
        level = "red"
        reasons.append("Servizi in tempo reale non raggiungibili")
    if not storage:
        level = _worse(level, "yellow")
        reasons.append("Archivio documenti degradato")

    if cpu_percent is not None:
        if cpu_percent >= 95:
            level = "red"
            reasons.append("CPU in sofferenza")
        elif cpu_percent >= 75:
            level = _worse(level, "yellow")
            reasons.append("CPU molto utilizzata")
    if memory_percent is not None:
        if memory_percent >= 95:
            level = "red"
            reasons.append("Memoria quasi esaurita")
        elif memory_percent >= 85:
            level = _worse(level, "yellow")
            reasons.append("Memoria molto utilizzata")

    gpu_pressure = max(gpu["utilization_percent"] or 0, gpu["memory_percent"] or 0)
    if settings.PLATFORM_GPU_REQUIRED and gpu["available"] is not True:
        level = "red"
        reasons.append("GPU richiesta ma non disponibile")
    elif gpu["available"] is True:
        if gpu_pressure >= 95:
            level = "red"
            reasons.append("GPU in sofferenza")
        elif gpu_pressure >= 85:
            level = _worse(level, "yellow")
            reasons.append("GPU molto utilizzata")

    override = (settings.PLATFORM_HEALTH_OVERRIDE or "").strip().lower()
    if override in _LEVEL_WEIGHT:
        level = override  # type: ignore[assignment]
        reasons = [settings.PLATFORM_HEALTH_MESSAGE or "Stato impostato dagli amministratori"]

    if not reasons:
        reasons.append("Tutti i servizi monitorati sono operativi")

    summaries = {
        "green": "Server operativo",
        "yellow": "Carico elevato: possibili rallentamenti",
        "red": "Servizi degradati o aggiornamento in corso",
    }
    return {
        "status": level,
        "summary": summaries[level],
        "reasons": reasons,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "cpu_percent": cpu_percent,
            "memory_percent": memory_percent,
            "gpu_available": gpu["available"],
            "gpu_percent": gpu["utilization_percent"],
            "gpu_memory_percent": gpu["memory_percent"],
            "database_ms": database_ms,
            "redis_ms": redis_ms,
        },
    }


@router.get("/health")
async def platform_health():
    global _cached_at, _cached_result
    now = time.monotonic()
    if _cached_result is not None and now - _cached_at < _CACHE_TTL_SECONDS:
        return _cached_result
    async with _cache_lock:
        now = time.monotonic()
        if _cached_result is None or now - _cached_at >= _CACHE_TTL_SECONDS:
            _cached_result = await _collect_health()
            _cached_at = now
    return _cached_result
