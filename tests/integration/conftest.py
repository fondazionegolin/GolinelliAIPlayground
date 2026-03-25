"""Integration test fixtures — additional helpers specific to API endpoint testing."""

import sys
import pytest_asyncio
from unittest.mock import AsyncMock, patch


@pytest_asyncio.fixture(autouse=True)
async def mock_email_service():
    """Prevent real emails from being sent during tests."""
    # The module is already loaded by the time the app starts via the client fixture.
    # We patch the object in the module where it's used.
    mod = sys.modules.get("app.api.v1.endpoints.auth")
    if mod is None:
        # Force-load via the app (triggers all endpoint imports)
        from app.main import app as _  # noqa: F401
        mod = sys.modules["app.api.v1.endpoints.auth"]

    mock_svc = AsyncMock()
    with patch.object(mod, "email_service", mock_svc):
        yield mock_svc


@pytest_asyncio.fixture(autouse=True)
async def mock_socketio():
    """Prevent Socket.IO events from firing during tests."""
    from app.main import app as _  # noqa: F401

    mock_sio = AsyncMock()
    patches = []
    for mod_name in [
        "app.api.v1.endpoints.student",
        "app.api.v1.endpoints.chat",
        "app.api.v1.endpoints.teacher",
    ]:
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, "sio"):
            p = patch.object(mod, "sio", mock_sio)
            p.start()
            patches.append(p)

    yield mock_sio

    for p in patches:
        p.stop()
