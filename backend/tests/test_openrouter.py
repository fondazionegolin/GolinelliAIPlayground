from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.config import settings
from app.models.ai_model import AIModel
from app.services import model_catalog, openrouter
from app.services.llm_service import LLMService


@pytest.mark.parametrize("value, expected", [("0.000002", 2), ("0", 0), (None, None),
                                            ("-1", None), ("NaN", None), ("Infinity", None), ("bad", None)])
def test_prices_are_converted_without_treating_unknown_as_free(value, expected):
    assert openrouter.token_price(value) == expected


@pytest.mark.asyncio
async def test_discovery_separates_chat_and_video_and_reads_official_prices(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test-key")

    def handle(request):
        assert request.headers["Authorization"] == "Bearer test-key"
        if request.url.path.endswith("/videos/models"):
            return httpx.Response(200, json={"data": [{"id": "google/video", "pricing_skus": {"per-video-second": "0.5"}}]})
        return httpx.Response(200, json={"data": [
            {"id": "vendor/chat", "name": "Chat", "architecture": {"output_modalities": ["text"]},
             "pricing": {"prompt": "0.000002", "completion": "0.000006"}, "context_length": 100000},
            {"id": "vendor/image", "architecture": {"output_modalities": ["image"]}},
        ]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        models = await openrouter.discover(client)
    assert [m["kind"] for m in models] == ["text", "video"]
    assert models[0]["input_usd"] == 2
    assert models[0]["output_usd"] == 6
    assert models[1]["price_note"] == "per-video-second: $0.5"


@pytest.mark.asyncio
async def test_scan_requires_activation_and_keeps_price_changes_as_proposals(monkeypatch):
    current = AIModel(provider="openrouter", model_id="vendor/old", kind="text", display_name="Old",
                      status="active", offered=True, input_usd=1, output_usd=3)
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [current]))),
                         add=lambda row: added.append(row), commit=AsyncMock())
    added = []
    monkeypatch.setattr(model_catalog, "seed_if_empty", AsyncMock())
    monkeypatch.setattr(model_catalog, "apply_runtime_prices", lambda models: None)
    monkeypatch.setattr(model_catalog, "PRICING_URLS", {"openrouter": "https://openrouter.ai/models"})
    monkeypatch.setattr(model_catalog, "_discover", AsyncMock(return_value=[
        {"id": "vendor/old", "name": "Old", "kind": "text", "input_usd": 2, "output_usd": 6},
        {"id": "vendor/new", "name": "New", "kind": "text", "input_usd": 0, "output_usd": 0},
        {"id": "vendor/video", "name": "Video", "kind": "video", "price_note": "$0.5/s"},
    ]))
    summary = await model_catalog.run_scan(db)
    new = next(row for row in added if isinstance(row, AIModel) and row.model_id == "vendor/new")
    assert new.status == "available" and not new.offered
    assert new.input_usd == new.output_usd == 0
    assert current.input_usd == 1 and current.proposed_input_usd == 2
    assert len(summary["price_changes"]) == 1
    assert summary["errors"] == {}


@pytest.mark.asyncio
async def test_chat_routes_to_openrouter_and_preserves_model_and_usage():
    service = object.__new__(LLMService)
    create = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Ciao"))],
                                                  usage=SimpleNamespace(prompt_tokens=10, completion_tokens=2)))
    service.openrouter_client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    response = await service.generate([{"role": "user", "content": "Ciao"}], provider="openrouter", model="vendor/chat",
                                      system_prompt="Italiano", allow_web_search=False)
    assert (response.provider, response.model, response.prompt_tokens) == ("openrouter", "vendor/chat", 10)
    assert create.call_args.kwargs["messages"][0] == {"role": "system", "content": "Italiano"}
    assert create.call_args.kwargs["model"] == "vendor/chat"


@pytest.mark.asyncio
async def test_chat_stream_skips_metadata_and_closes_stream():
    class Stream:
        closed = False

        async def __aiter__(self):
            for text in (None, "Ciao", " mondo"):
                yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text))])

        async def close(self):
            self.closed = True

    stream = Stream()
    service = object.__new__(LLMService)
    service.openrouter_client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=stream))))
    chunks = [c async for c in service.generate_stream([{"role": "user", "content": "Ciao"}], provider="openrouter",
                                                      model="vendor/chat", allow_web_search=False)]
    assert chunks == ["Ciao", " mondo"] and stream.closed


def test_video_rejects_unsupported_parameters_before_submission():
    model = {"supported_durations": [4, 8], "supported_aspect_ratios": ["16:9"], "supported_resolutions": ["720p"]}
    openrouter.validate_video_options(model, 4, "16:9", "720p")
    for args in [(5, "16:9", "720p"), (4, "1:1", "720p"), (4, "16:9", "4K")]:
        with pytest.raises(ValueError):
            openrouter.validate_video_options(model, *args)


@pytest.mark.asyncio
async def test_completed_video_download_never_sends_key_to_response_urls(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test-key")
    seen = []

    def handle(request):
        seen.append(str(request.url))
        if request.url.host == "cdn.example":
            assert "authorization" not in request.headers
            return httpx.Response(200, content=b"video")
        assert request.headers["Authorization"] == "Bearer test-key"
        if request.url.path.endswith("/content"):
            return httpx.Response(302, headers={"Location": "https://cdn.example/video.mp4"})
        return httpx.Response(200, json={"status": "completed", "unsigned_urls": ["https://evil.example"], "usage": {"cost": 0.25}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        data, cost = await openrouter.wait_video(client, "job-123")
    assert (data, cost) == (b"video", 0.25)
    assert not any("evil.example" in url for url in seen)


@pytest.mark.asyncio
async def test_failed_video_is_terminal(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"status": "failed"}))) as client:
        with pytest.raises(openrouter.VideoJobFailed):
            await openrouter.wait_video(client, "job-123")
