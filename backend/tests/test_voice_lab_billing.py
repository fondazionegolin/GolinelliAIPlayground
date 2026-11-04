import io
import json
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.services import voice_lab_billing as billing, voice_lab as eleven
from app.api.v1.endpoints import voice_lab as routes


@pytest.mark.parametrize("action,kwargs,credits", [
    ("tts", {"characters": 1000, "model": "eleven_multilingual_v2"}, 6.88),
    ("tts", {"characters": 1000, "model": "eleven_flash_v2_5"}, 3.44),
    ("dialogue", {"characters": 1000}, 6.88), ("music", {"seconds": 60}, 12.9),
    ("convert", {"seconds": 60}, 10.32), ("isolate", {"seconds": 60}, 10.32),
    ("sound_effects", {"seconds": 30}, 5.16), ("transcribe", {"seconds": 3600}, 18.92),
    ("dubbing", {"seconds": 60}, 43), ("alignment", {"seconds": 3600}, 18.92),
    ("voice_design", {"characters": 3000}, 20.64),
])
def test_standard_rate_conversion(action, kwargs, credits):
    result = billing.quote(action, **kwargs)
    assert result["credits"] == pytest.approx(credits)
    assert result["cost"] > 0


@pytest.mark.asyncio
async def test_duration_is_measured_from_media_not_client_claim():
    audio = io.BytesIO()
    with wave.open(audio, "wb") as writer:
        writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(8000)
        writer.writeframes(b"\0\0" * 16000)
    assert await billing.duration(audio.getvalue()) == pytest.approx(2)
    with pytest.raises(HTTPException):
        await billing.duration(b"not media")


@pytest.mark.asyncio
@pytest.mark.parametrize("failure,refund", [(HTTPException(422, "Invalid"), True), (eleven.UncertainGeneration(504, "Uncertain"), False)])
async def test_failed_generation_refunds_known_failure_but_preserves_uncertain_charge(monkeypatch, failure, refund):
    db = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
    teacher = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    tx = SimpleNamespace(id=uuid4())
    reserve, settle = AsyncMock(return_value=tx), AsyncMock()
    monkeypatch.setattr(routes, "budget", AsyncMock())
    monkeypatch.setattr(billing, "reserve", reserve)
    monkeypatch.setattr(billing, "settle", settle)
    monkeypatch.setattr(eleven, "request", AsyncMock(side_effect=failure))
    with pytest.raises(HTTPException):
        await routes.generate(db, teacher, json.dumps({"action": "music", "text": "Piano", "seconds": 30}), None)
    assert reserve.await_count == 1
    assert settle.await_count == int(refund)
    if refund:
        assert settle.call_args.kwargs["status"] == "refunded"


@pytest.mark.asyncio
async def test_insufficient_credits_does_not_contact_provider(monkeypatch):
    db = SimpleNamespace()
    teacher = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    request = AsyncMock()
    monkeypatch.setattr(routes, "budget", AsyncMock())
    monkeypatch.setattr(billing, "reserve", AsyncMock(side_effect=HTTPException(402, "No credit")))
    monkeypatch.setattr(eleven, "request", request)
    with pytest.raises(HTTPException) as exc:
        await routes.generate(db, teacher, '{"action":"music","text":"Piano"}', None)
    assert exc.value.status_code == 402
    request.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure,expected", [(httpx.ConnectError("connect"), 503), (httpx.ConnectTimeout("connect"), 503), (httpx.ReadTimeout("read"), 504)])
async def test_connection_failures_are_distinct_from_ambiguous_paid_requests(monkeypatch, failure, expected):
    client = SimpleNamespace(request=AsyncMock(side_effect=failure))
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return client
        async def __aexit__(self, *args): return False
    monkeypatch.setattr(eleven.httpx, "AsyncClient", Client)
    monkeypatch.setattr(eleven.podcasts, "api_key", lambda: "test-key")
    with pytest.raises(HTTPException) as exc:
        await eleven.request("POST", "/v1/music", json={})
    assert exc.value.status_code == expected
    assert isinstance(exc.value, eleven.UncertainGeneration) == (expected == 504)
