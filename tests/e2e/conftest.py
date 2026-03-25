"""E2E test configuration — tests run against a live Docker stack."""

import os

import pytest

# Base URL for the running API (docker-compose.dev.yml exposes on port 80 via Traefik)
E2E_BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost/api/v1")

# Credentials for a pre-seeded teacher (must exist in the running DB)
E2E_TEACHER_EMAIL = os.environ.get("E2E_TEACHER_EMAIL", "teacher@test.com")
E2E_TEACHER_PASSWORD = os.environ.get("E2E_TEACHER_PASSWORD", "testpass123")


def pytest_collection_modifyitems(config, items):
    """Skip E2E tests unless --run-e2e flag is passed."""
    if not config.getoption("--run-e2e", default=False):
        skip = pytest.mark.skip(reason="E2E tests require --run-e2e flag and running Docker stack")
        for item in items:
            if "e2e" in item.keywords:
                item.add_marker(skip)


def pytest_addoption(parser):
    parser.addoption(
        "--run-e2e",
        action="store_true",
        default=False,
        help="Run E2E tests (requires running Docker stack)",
    )
