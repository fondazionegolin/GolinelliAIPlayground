"""
Pytest plugin that ties app-level and Docker-level profiling together.

Usage:
    pytest --profile          # enable profiling for all tests
    pytest --profile-docker   # also collect Docker container stats

Collected data is stored in the global stores and saved to reports/ after the session.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from tests.profiling.app_profiler import profile_store, ProfilingMiddleware
from tests.profiling.docker_collector import docker_collector

REPORTS_DIR = Path(__file__).parent.parent.parent / "reports" / "profiling"


def pytest_addoption(parser):
    group = parser.getgroup("profiling", "Resource profiling options")
    group.addoption(
        "--profile",
        action="store_true",
        default=False,
        help="Enable per-request app-level profiling (CPU, memory via psutil)",
    )
    group.addoption(
        "--profile-docker",
        action="store_true",
        default=False,
        help="Also poll Docker stats per test (requires Docker running)",
    )


_middleware_added = False


def pytest_configure(config):
    config.addinivalue_line("markers", "profile: mark test for resource profiling")


def _ensure_middleware():
    """Add ProfilingMiddleware to the FastAPI app (once)."""
    global _middleware_added
    if _middleware_added:
        return
    from app.main import app
    app.add_middleware(ProfilingMiddleware)
    _middleware_added = True


@pytest.fixture(autouse=True)
def _profiling_hook(request):
    """Start/stop profiling around each test when --profile is active."""
    do_profile = request.config.getoption("--profile", default=False)
    do_docker = request.config.getoption("--profile-docker", default=False)

    if not do_profile:
        yield
        return

    _ensure_middleware()

    test_name = request.node.nodeid

    # Start app-level profiling
    profile_store.start_test(test_name)

    # Start Docker stats collection if requested
    if do_docker:
        docker_collector.start_test(test_name)

    yield

    # Stop everything
    profile_store.stop_test()
    if do_docker:
        docker_collector.stop_test()


def pytest_sessionfinish(session, exitstatus):
    """Dump all collected profiling data to JSON after the test session."""
    do_profile = session.config.getoption("--profile", default=False)
    if not do_profile:
        return

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # App-level profiles
    app_data = {}
    for test_name, profiles in profile_store.all_profiles().items():
        app_data[test_name] = [p.to_dict() for p in profiles]

    if app_data:
        out = REPORTS_DIR / "app_profiles.json"
        out.write_text(json.dumps(app_data, indent=2))

    # Docker stats timeseries
    do_docker = session.config.getoption("--profile-docker", default=False)
    if do_docker:
        docker_data = {}
        for test_name, ts in docker_collector.all_timeseries().items():
            docker_data[test_name] = {}
            for container, snaps in ts.snapshots.items():
                docker_data[test_name][container] = [
                    {
                        "timestamp": s.timestamp,
                        "cpu_percent": s.cpu_percent,
                        "mem_usage_mb": round(s.mem_usage_mb, 2),
                        "mem_percent": s.mem_percent,
                        "net_in_mb": round(s.net_in_mb, 3),
                        "net_out_mb": round(s.net_out_mb, 3),
                    }
                    for s in snaps
                ]

        if docker_data:
            out = REPORTS_DIR / "docker_stats.json"
            out.write_text(json.dumps(docker_data, indent=2))

    # Auto-generate charts
    try:
        from tests.profiling.charts import generate_all_charts
        charts_dir = REPORTS_DIR / "charts"
        generate_all_charts(REPORTS_DIR, charts_dir)
    except Exception as e:
        print(f"\n[profiling] Chart generation failed: {e}")
