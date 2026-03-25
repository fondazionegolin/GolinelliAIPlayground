"""Performance test configuration."""

import json
import os
from pathlib import Path

import pytest

REPORTS_DIR = Path(__file__).parent.parent.parent / "reports"


def pytest_collection_modifyitems(config, items):
    """Skip benchmark tests unless --run-benchmark flag is passed."""
    if not config.getoption("--run-benchmark", default=False):
        skip = pytest.mark.skip(reason="Benchmark tests require --run-benchmark flag")
        for item in items:
            if "benchmark" in item.keywords:
                item.add_marker(skip)


def pytest_addoption(parser):
    parser.addoption(
        "--run-benchmark",
        action="store_true",
        default=False,
        help="Run performance benchmark tests",
    )
    parser.addoption(
        "--benchmark-iterations",
        type=int,
        default=50,
        help="Number of iterations for latency benchmarks (default: 50)",
    )
