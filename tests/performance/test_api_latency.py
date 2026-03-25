"""
API latency benchmarks — measures p50/p95/p99 for key endpoints.

Runs against the in-process FastAPI app using the test DB.
"""

import statistics
import time
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import settings

API = settings.API_V1_PREFIX

# Collected results for reporting
_latency_results: dict[str, list[float]] = {}


def _summarize(values: list[float]) -> dict[str, float]:
    if not values:
        return {"count": 0, "p50": 0, "p95": 0, "p99": 0, "max": 0, "avg": 0}
    n = len(values)
    return {
        "count": n,
        "avg": sum(values) / n,
        "p50": statistics.quantiles(values, n=100)[49] if n >= 2 else values[0],
        "p95": statistics.quantiles(values, n=100)[94] if n >= 20 else max(values),
        "p99": statistics.quantiles(values, n=100)[98] if n >= 100 else max(values),
        "max": max(values),
    }


async def _measure(client: AsyncClient, method: str, url: str, iterations: int, **kwargs) -> list[float]:
    """Make `iterations` requests and return list of durations in ms."""
    durations = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        resp = await getattr(client, method)(url, **kwargs)
        ms = (time.perf_counter() - t0) * 1000
        assert resp.status_code < 500, f"Server error: {resp.status_code}"
        durations.append(ms)
    return durations


@pytest.mark.benchmark
class TestApiLatency:
    """Benchmark key API endpoints and assert latency thresholds."""

    ITERATIONS = 50  # Override via --benchmark-iterations

    async def test_login_latency(self, client: AsyncClient, seed_teacher):
        durations = await _measure(
            client, "post", f"{API}/auth/login",
            iterations=self.ITERATIONS,
            json={"email": "teacher@test.com", "password": "testpass123"},
        )
        summary = _summarize(durations)
        _latency_results["POST /auth/login"] = durations
        print(f"\n  POST /auth/login — p50={summary['p50']:.1f}ms p95={summary['p95']:.1f}ms max={summary['max']:.1f}ms")
        assert summary["p95"] < 500, f"Login p95 too slow: {summary['p95']:.1f}ms"

    async def test_student_join_latency(self, client: AsyncClient, seed_session):
        durations = []
        for i in range(self.ITERATIONS):
            t0 = time.perf_counter()
            resp = await client.post(
                f"{API}/student/join",
                json={"join_code": seed_session.join_code, "nickname": f"BenchUser{i}"},
            )
            ms = (time.perf_counter() - t0) * 1000
            assert resp.status_code < 500
            durations.append(ms)

        summary = _summarize(durations)
        _latency_results["POST /student/join"] = durations
        print(f"\n  POST /student/join — p50={summary['p50']:.1f}ms p95={summary['p95']:.1f}ms max={summary['max']:.1f}ms")
        assert summary["p95"] < 1000, f"Join p95 too slow: {summary['p95']:.1f}ms"

    async def test_teacher_classes_latency(self, teacher_client: AsyncClient):
        durations = await _measure(
            teacher_client, "get", f"{API}/teacher/classes",
            iterations=self.ITERATIONS,
        )
        summary = _summarize(durations)
        _latency_results["GET /teacher/classes"] = durations
        print(f"\n  GET /teacher/classes — p50={summary['p50']:.1f}ms p95={summary['p95']:.1f}ms max={summary['max']:.1f}ms")
        assert summary["p95"] < 300, f"Classes p95 too slow: {summary['p95']:.1f}ms"

    async def test_student_heartbeat_latency(self, student_client: AsyncClient):
        durations = await _measure(
            student_client, "post", f"{API}/student/heartbeat",
            iterations=self.ITERATIONS,
        )
        summary = _summarize(durations)
        _latency_results["POST /student/heartbeat"] = durations
        print(f"\n  POST /student/heartbeat — p50={summary['p50']:.1f}ms p95={summary['p95']:.1f}ms max={summary['max']:.1f}ms")
        assert summary["p95"] < 200, f"Heartbeat p95 too slow: {summary['p95']:.1f}ms"

    async def test_health_latency(self, client: AsyncClient):
        durations = await _measure(
            client, "get", "/health",
            iterations=self.ITERATIONS,
        )
        summary = _summarize(durations)
        _latency_results["GET /health"] = durations
        print(f"\n  GET /health — p50={summary['p50']:.1f}ms p95={summary['p95']:.1f}ms max={summary['max']:.1f}ms")
        assert summary["p95"] < 50, f"Health p95 too slow: {summary['p95']:.1f}ms"
