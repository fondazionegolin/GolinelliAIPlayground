"""Integration test fixtures — additional helpers specific to API endpoint testing."""

import sys
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch


@pytest_asyncio.fixture(autouse=True)
async def mock_email_service():
    """Prevent real emails from being sent during tests."""
    mod = sys.modules.get("app.api.v1.endpoints.auth")
    if mod is None:
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
        "app.api.v1.endpoints.llm",
        "app.api.v1.endpoints.teacherbots",
        "app.api.v1.endpoints.assessment",
    ]:
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, "sio"):
            p = patch.object(mod, "sio", mock_sio)
            p.start()
            patches.append(p)

    # Also mock notify_teacher_content_alert in llm module
    llm_mod = sys.modules.get("app.api.v1.endpoints.llm")
    if llm_mod and hasattr(llm_mod, "notify_teacher_content_alert"):
        p = patch.object(llm_mod, "notify_teacher_content_alert", AsyncMock())
        p.start()
        patches.append(p)

    yield mock_sio

    for p in patches:
        p.stop()


@pytest_asyncio.fixture(autouse=True)
async def mock_llm_service():
    """Mock the LLM service to avoid real API calls."""
    from app.main import app as _  # noqa: F401

    mock = AsyncMock()
    # Default: return a simple text response
    response = MagicMock()
    response.content = "This is a mocked AI response."
    response.provider = "openai"
    response.model = "gpt-5-mini"
    response.prompt_tokens = 10
    response.completion_tokens = 20
    response.usage = MagicMock(prompt_tokens=10, completion_tokens=20, total_tokens=30)
    mock.generate.return_value = response
    mock.generate_image.return_value = "https://example.com/generated-image.png"

    patches = []
    for mod_name in [
        "app.api.v1.endpoints.llm",
        "app.api.v1.endpoints.teacherbots",
        "app.api.v1.endpoints.assessment",
        "app.api.v1.endpoints.rag",
    ]:
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, "llm_service"):
            p = patch.object(mod, "llm_service", mock)
            p.start()
            patches.append(p)

    yield mock

    for p in patches:
        p.stop()


@pytest_asyncio.fixture(autouse=True)
async def mock_credit_service():
    """Mock the credit service — always allow spending."""
    from app.main import app as _  # noqa: F401

    mock = AsyncMock()
    mock.check_availability.return_value = True
    mock.track_usage.return_value = None
    mock.calculate_cost_for_model.return_value = 0.001

    patches = []
    for mod_name in [
        "app.api.v1.endpoints.llm",
        "app.api.v1.endpoints.teacherbots",
    ]:
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, "credit_service"):
            p = patch.object(mod, "credit_service", mock)
            p.start()
            patches.append(p)

    yield mock

    for p in patches:
        p.stop()


@pytest_asyncio.fixture(autouse=True)
async def mock_moderation_service():
    """Mock the moderation service — all content is safe by default."""
    from app.main import app as _  # noqa: F401

    mock = AsyncMock()
    result = MagicMock()
    result.is_safe = True
    result.flagged = False
    result.masked_text = None
    result.pii_found = []
    result.flagged_categories = []
    result.alert_type = None
    result.risk_score = 0.0
    mock.check.return_value = result

    mod = sys.modules.get("app.api.v1.endpoints.llm")
    if mod and hasattr(mod, "moderation_service"):
        with patch.object(mod, "moderation_service", mock):
            yield mock
    else:
        yield mock


@pytest_asyncio.fixture(autouse=True)
async def mock_minio():
    """Mock MinIO client for file upload/download tests."""
    from app.main import app as _  # noqa: F401

    mock = MagicMock()
    mock.presigned_put_object.return_value = "https://minio.test/upload?signed=1"
    mock.presigned_get_object.return_value = "https://minio.test/download?signed=1"

    mod = sys.modules.get("app.api.v1.endpoints.files")
    if mod and hasattr(mod, "minio_client"):
        with patch.object(mod, "minio_client", mock):
            yield mock
    else:
        yield mock
