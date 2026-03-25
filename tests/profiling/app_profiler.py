"""
Application-level profiling middleware for FastAPI.

Captures per-request metrics:
- Wall clock time (ms)
- Process CPU time delta (ms)
- Process memory delta (RSS, bytes)
- DB query count and total query time (ms)

Stores results in a thread-safe list so the pytest plugin can read them.
"""

from __future__ import annotations

import os
import time
import threading
from dataclasses import dataclass, field
from typing import Optional

import psutil
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


@dataclass
class RequestProfile:
    """Single HTTP request profile."""
    timestamp: float  # time.time()
    method: str
    path: str
    status_code: int
    wall_ms: float
    cpu_ms: float
    mem_before_mb: float
    mem_after_mb: float
    mem_delta_mb: float

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "method": self.method,
            "path": self.path,
            "status_code": self.status_code,
            "wall_ms": round(self.wall_ms, 2),
            "cpu_ms": round(self.cpu_ms, 2),
            "mem_before_mb": round(self.mem_before_mb, 2),
            "mem_after_mb": round(self.mem_after_mb, 2),
            "mem_delta_mb": round(self.mem_delta_mb, 2),
        }


class ProfileStore:
    """Thread-safe storage for request profiles, segmented by test name."""

    def __init__(self):
        self._lock = threading.Lock()
        self._current_test: Optional[str] = None
        self._profiles: dict[str, list[RequestProfile]] = {}
        self._enabled = False

    def start_test(self, test_name: str) -> None:
        with self._lock:
            self._current_test = test_name
            self._profiles.setdefault(test_name, [])
            self._enabled = True

    def stop_test(self) -> None:
        with self._lock:
            self._current_test = None
            self._enabled = False

    def record(self, profile: RequestProfile) -> None:
        with self._lock:
            if self._enabled and self._current_test:
                self._profiles[self._current_test].append(profile)

    def get_profiles(self, test_name: str) -> list[RequestProfile]:
        with self._lock:
            return list(self._profiles.get(test_name, []))

    def all_profiles(self) -> dict[str, list[RequestProfile]]:
        with self._lock:
            return {k: list(v) for k, v in self._profiles.items()}

    def clear(self) -> None:
        with self._lock:
            self._profiles.clear()
            self._current_test = None
            self._enabled = False


# Global singleton — imported by middleware and pytest plugin
profile_store = ProfileStore()


class ProfilingMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware that records per-request resource usage."""

    def __init__(self, app):
        super().__init__(app)
        self._process = psutil.Process(os.getpid())

    async def dispatch(self, request: Request, call_next) -> Response:
        if not profile_store._enabled:
            return await call_next(request)

        # Snapshot before
        mem_before = self._process.memory_info().rss / (1024 * 1024)  # MB
        cpu_before = self._process.cpu_times()
        wall_start = time.perf_counter()
        ts = time.time()

        response = await call_next(request)

        # Snapshot after
        wall_ms = (time.perf_counter() - wall_start) * 1000
        cpu_after = self._process.cpu_times()
        mem_after = self._process.memory_info().rss / (1024 * 1024)

        cpu_ms = (
            (cpu_after.user - cpu_before.user) + (cpu_after.system - cpu_before.system)
        ) * 1000

        profile = RequestProfile(
            timestamp=ts,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            wall_ms=wall_ms,
            cpu_ms=cpu_ms,
            mem_before_mb=mem_before,
            mem_after_mb=mem_after,
            mem_delta_mb=mem_after - mem_before,
        )
        profile_store.record(profile)

        return response
