import base64
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from pydantic import ValidationError
from starlette.datastructures import Headers

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.voice_lab import VoiceLabItem
from app.api.v1.endpoints import voice_lab as routes
from app.services import voice_lab as eleven


def actor():
    return SimpleNamespace(id=uuid4(), tenant_id=uuid4())


def saved_item(teacher, *, kind="audio", details=None):
    return VoiceLabItem(id=uuid4(), owner_id=teacher.id, tenant_id=teacher.tenant_id, title="Risultato",
                        kind=kind, service="test", provider_id="voice123", storage_key="drive/test.mp3",
                        mime_type="audio/mpeg", details=details or {})


def db_stub():
    return SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock(), flush=AsyncMock(), delete=AsyncMock(), add=lambda item: None)


@pytest.fixture
def billing_spies(monkeypatch):
    from app.services import voice_lab_billing as billing
    reserve = AsyncMock(return_value=SimpleNamespace(id=uuid4(), usage_details={"billing_status": "reserved"}))
    settle = AsyncMock()
    monkeypatch.setattr(billing, "reserve", reserve)
    monkeypatch.setattr(billing, "settle", settle)
    monkeypatch.setattr(billing, "duration", AsyncMock(return_value=60))
    return reserve, settle


@pytest.mark.parametrize("data", [
    {"action": "tts", "text": "ciao"}, {"action": "tts", "voice_id": "voice123"},
    {"action": "dialogue", "dialogue": []}, {"action": "music", "text": "Jazz", "seconds": 2},
    {"action": "sound_effects", "text": "Tuono", "seconds": 31},
    {"action": "tts", "text": "ciao", "voice_id": "../../foreign"},
    {"action": "tts", "text": "ciao", "voice_id": "valid123", "url": "https://evil.example"},
])
def test_invalid_requests_are_rejected_before_paid_requests(data):
    with pytest.raises(ValidationError):
        routes.Generation.model_validate(data)


@pytest.mark.asyncio
async def test_student_role_cannot_enter_voice_lab():
    app = FastAPI()
    app.include_router(routes.router, prefix="/voice-lab")

    async def db():
        yield db_stub()

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role="STUDENT")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for path in ("config", "items", "voices", "models"):
            assert (await client.get(f"/voice-lab/{path}")).status_code == 403
        assert (await client.post("/voice-lab/generate", data={"payload": '{"action":"tts"}'})).status_code == 403


@pytest.mark.asyncio
async def test_other_teachers_private_voices_are_hidden(monkeypatch):
    teacher = actor()
    own = saved_item(teacher, kind="voice")
    foreign = saved_item(actor(), kind="voice")
    foreign.provider_id = "foreign123"
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [own, foreign]))))
    monkeypatch.setattr(eleven, "account_voices", AsyncMock(return_value=[
        {"voice_id": "voice123", "name": "Mine"}, {"voice_id": "foreign123", "name": "Private"}, {"voice_id": "preset123", "name": "Preset"},
    ]))
    voices = await eleven.visible_voices(db, teacher)
    assert {v["voice_id"] for v in voices} == {"voice123", "preset123"}
    assert next(v for v in voices if v["voice_id"] == "voice123")["owned"]
    with pytest.raises(HTTPException) as exc:
        await routes.require_voices(db, teacher, {"foreign123"})
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_speech_generation_uses_fixed_endpoint_and_saves_usage(monkeypatch, billing_spies):
    teacher, db = actor(), db_stub()
    monkeypatch.setattr(routes, "budget", AsyncMock(return_value=0))
    monkeypatch.setattr(routes, "require_voices", AsyncMock())
    monkeypatch.setattr(eleven, "models", AsyncMock(return_value=[{"model_id": "tts-model", "tts": True, "max_characters": 5000}]))
    request = AsyncMock(return_value=httpx.Response(200, content=b"ID3audio", headers={"content-type": "audio/mpeg", "character-cost": "4"}))
    monkeypatch.setattr(eleven, "request", request)
    item = saved_item(teacher)
    save = AsyncMock(return_value=item)
    monkeypatch.setattr(routes, "save_blob", save)
    monkeypatch.setattr(routes.credit_service, "track_usage", AsyncMock())
    result = await routes.generate(db, teacher, json.dumps({"action": "tts", "text": "Ciao", "voice_id": "voice123", "model_id": "tts-model"}), None)
    assert result["id"] == str(item.id)
    assert request.call_args.args == ("POST", "/v1/text-to-speech/voice123")
    assert request.call_args.kwargs["json"]["text"] == "Ciao"
    assert save.call_args.args[4] == b"ID3audio"
    assert save.call_args.args[7]["characters"] == 4
    assert billing_spies[0].call_args.args[2]["cost"] > 0
    assert billing_spies[1].await_count == 1


@pytest.mark.asyncio
async def test_transcription_upload_uses_real_multipart_field_names(monkeypatch, billing_spies):
    teacher, db = actor(), db_stub()
    monkeypatch.setattr(routes, "budget", AsyncMock(return_value=0))
    request = AsyncMock(return_value=httpx.Response(200, json={"text": "Lezione", "words": []}))
    monkeypatch.setattr(eleven, "request", request)
    save = AsyncMock(return_value=saved_item(teacher, kind="transcript"))
    monkeypatch.setattr(routes, "save_blob", save)
    upload = UploadFile(file=io.BytesIO(b"audio"), filename="lesson.wav", headers=Headers({"content-type": "audio/wav"}))
    await routes.generate(db, teacher, '{"action":"transcribe","diarize":true}', upload)
    assert request.call_args.args == ("POST", "/v1/speech-to-text")
    assert request.call_args.kwargs["data"]["diarize"] == "true"
    assert request.call_args.kwargs["files"]["file"][1] == b"audio"
    assert json.loads(save.call_args.args[4])["text"] == "Lezione"
    assert billing_spies[0].call_args.args[2]["cost"] > 0
    assert save.call_args.args[7]["credits"] == pytest.approx(.32)


@pytest.mark.asyncio
async def test_clone_requires_consent_without_contacting_provider(monkeypatch):
    request = AsyncMock()
    monkeypatch.setattr(eleven, "request", request)
    with pytest.raises(HTTPException) as exc:
        await routes.clone_voice(db_stub(), actor(), "Mine", False, "", False, [])
    assert exc.value.status_code == 422
    request.assert_not_called()


@pytest.mark.asyncio
async def test_voice_design_produces_private_saveable_previews(monkeypatch, billing_spies):
    teacher, db = actor(), db_stub()
    monkeypatch.setattr(routes, "budget", AsyncMock(return_value=0))
    request = AsyncMock(return_value=httpx.Response(200, json={"text": "Preview text", "previews": [
        {"audio_base_64": base64.b64encode(b"ID3audio").decode(), "generated_voice_id": "preview123"},
    ]}))
    monkeypatch.setattr(eleven, "request", request)
    save = AsyncMock(return_value=saved_item(teacher, kind="preview"))
    monkeypatch.setattr(routes, "save_blob", save)
    results = await routes.design_voice(routes.VoiceDesign(description="Una voce calda e profonda, dal ritmo lento."), db, teacher)
    assert results[0]["kind"] == "preview"
    assert request.call_args.kwargs["json"]["auto_generate_text"] is True
    assert save.call_args.kwargs["provider_id"] == "preview123"


@pytest.mark.asyncio
async def test_completed_dubbing_is_saved_only_once(monkeypatch):
    teacher, db = actor(), db_stub()
    item = saved_item(teacher, kind="dubbing", details={"language": "it", "status": "processing"})
    monkeypatch.setattr(routes, "owned", AsyncMock(return_value=item))
    request = AsyncMock(side_effect=[httpx.Response(200, json={"status": "dubbed"}), httpx.Response(200, content=b"audio", headers={"content-type": "audio/mpeg"})])
    monkeypatch.setattr(eleven, "request", request)
    save = AsyncMock(return_value=saved_item(teacher, details={"drive_item_id": "drive123"}))
    monkeypatch.setattr(routes, "save_blob", save)
    first = await routes.refresh_dubbing(item.id, db, teacher)
    second = await routes.refresh_dubbing(item.id, db, teacher)
    assert first["status"] == second["status"] == "ready"
    assert item.kind == "audio"
    assert save.await_count == 1 and request.await_count == 2


@pytest.mark.asyncio
async def test_foreign_item_never_reaches_provider_or_storage(monkeypatch):
    request = AsyncMock()
    monkeypatch.setattr(eleven, "request", request)
    db = SimpleNamespace(scalar=AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await routes.item_content(uuid4(), db, actor())
    assert exc.value.status_code == 404
    request.assert_not_called()


def test_playlist_names_are_safe_drive_folder_names_and_tracks_are_unique():
    from app.api.v1.endpoints.voice_playlists import PlaylistWrite
    assert PlaylistWrite(title="Musica/voce\\classe").title == "Musica_voce_classe"
    with pytest.raises(ValidationError):
        PlaylistWrite(title=" ... ")
    track_id = uuid4()
    with pytest.raises(ValidationError):
        PlaylistWrite(title="Test", track_ids=[track_id, track_id])
