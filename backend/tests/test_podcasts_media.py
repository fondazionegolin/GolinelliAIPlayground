import io
import json
import subprocess
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from app.api.v1.endpoints import podcasts as endpoints
from app.services import podcasts
from app.services.media_http import media_response


@pytest.mark.parametrize('value,status,body,content_range', [
    (None, 200, b'0123456789', None), ('bytes=2-5', 206, b'2345', 'bytes 2-5/10'),
    ('bytes=6-', 206, b'6789', 'bytes 6-9/10'), ('bytes=-3', 206, b'789', 'bytes 7-9/10'),
    ('bytes=7-999', 206, b'789', 'bytes 7-9/10'), ('bytes=20-', 416, b'', 'bytes */10'),
    ('bytes=8-2', 416, b'', 'bytes */10'), ('bytes=0-1,4-5', 416, b'', 'bytes */10'),
    ('bytes=-0', 416, b'', 'bytes */10'), ('bytes=-', 416, b'', 'bytes */10'),
    ('bytes=' + '9'*5000 + '-', 416, b'', 'bytes */10'),
])
def test_seekable_media(value, status, body, content_range):
    response = media_response(b'0123456789', 'audio/mpeg', value)
    assert response.status_code == status
    assert response.body == body
    assert response.headers.get('content-range') == content_range
    assert response.headers['accept-ranges'] == 'bytes'
    assert response.headers['cache-control'] == 'private, no-store'


def test_speech_chunks_retain_all_words_and_stay_below_provider_limit():
    text = ('La fotosintesi trasforma energia luminosa. Le piante producono ossigeno!\n' * 190).strip()
    parts = podcasts.speech_chunks(text)
    assert len(parts) > 1
    assert all(0 < len(p) <= 4500 for p in parts)
    assert ' '.join(' '.join(parts).split()) == ' '.join(text.split())
    assert all(len(p) <= 4500 for p in podcasts.speech_chunks('x' * 11000))


@pytest.mark.parametrize('patch', [{'duration_minutes': 60}, {'speed': 4}, {'voice_id': '../bad'}, {'language': 'bad'}, {'stability': -1}])
def test_options_bound_costs_and_reject_invalid_provider_parameters(patch):
    with pytest.raises(ValidationError):
        podcasts.PodcastOptions.model_validate({'voice_id': 'voice-123', **patch})


@pytest.mark.asyncio
async def test_voice_list_never_returns_key_or_account_fields(monkeypatch):
    real_client = httpx.AsyncClient
    def handler(request):
        assert request.url.path == '/v2/voices'
        assert request.headers['xi-api-key'] == 'private-test-key'
        return httpx.Response(200, json={'voices': [{'voice_id': 'voice123', 'name': 'Ada', 'labels': {'language': 'it'}, 'billing_secret': 'do-not-return'}]})
    monkeypatch.setattr(podcasts.settings, 'ELEVENLABS_API_KEY', 'private-test-key')
    monkeypatch.setattr(podcasts, '_voice_cache', (0, []))
    monkeypatch.setattr(podcasts.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    result = await podcasts.list_voices()
    assert result[0]['name'] == 'Ada'
    assert 'private-test-key' not in json.dumps(result)
    assert 'billing_secret' not in json.dumps(result)


@pytest.mark.asyncio
async def test_synthesis_uses_selected_voice_and_parameters(monkeypatch):
    real_client = httpx.AsyncClient
    def handler(request):
        assert request.url.path == '/v1/text-to-speech/voice123'
        payload = json.loads(request.content)
        assert payload['language_code'] == 'it'
        assert payload['voice_settings']['speed'] == .8
        assert payload['voice_settings']['stability'] == .6
        assert request.url.params['output_format'] == 'mp3_44100_128'
        return httpx.Response(200, content=b'mp3-test', headers={'content-type': 'audio/mpeg'})
    monkeypatch.setattr(podcasts.settings, 'ELEVENLABS_API_KEY', 'test-key')
    monkeypatch.setattr(podcasts, 'list_voices', AsyncMock(return_value=[{'voice_id': 'voice123'}]))
    monkeypatch.setattr(podcasts.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    data = await podcasts.synthesize('Un riassunto.', podcasts.PodcastOptions(voice_id='voice123', speed=.8, stability=.6))
    assert data == b'mp3-test'


@pytest.mark.parametrize('status,expected', [(401, 502), (403, 502), (429, 503), (500, 502)])
def test_provider_errors_are_sanitized(status, expected):
    with pytest.raises(HTTPException) as error:
        podcasts.provider_error(httpx.Response(status, text='secret billing details and api key'))
    assert error.value.status_code == expected
    assert 'secret' not in error.value.detail


@pytest.mark.asyncio
async def test_missing_key_does_not_make_network_calls(monkeypatch):
    monkeypatch.setattr(podcasts.settings, 'ELEVENLABS_API_KEY', None)
    with pytest.raises(HTTPException) as error:
        await podcasts.list_voices()
    assert error.value.status_code == 503


@pytest.mark.asyncio
async def test_foreign_conversation_denied_before_reading_uploaded_document():
    db = SimpleNamespace(scalar=AsyncMock(return_value=None))
    teacher = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    upload = UploadFile(filename='private.txt', file=io.BytesIO(b'private contents'))
    upload.read = AsyncMock(side_effect=AssertionError('must not read this document'))
    with pytest.raises(HTTPException) as error:
        await endpoints.configure(db, teacher, uuid4(), 'crea podcast', [upload])
    assert error.value.status_code == 404
    upload.read.assert_not_called()


@pytest.mark.asyncio
async def test_podcast_lookup_filters_owner_and_tenant():
    db = SimpleNamespace(scalar=AsyncMock(return_value=None))
    teacher = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    with pytest.raises(HTTPException):
        await endpoints.owned_message(db, teacher, uuid4())
    stmt = db.scalar.call_args.args[0]
    compiled = stmt.compile(dialect=postgresql.dialect())
    assert 'teacher_conversations.teacher_id =' in str(compiled)
    assert 'teacher_conversations.tenant_id =' in str(compiled)
    assert teacher.id in compiled.params.values()
    assert teacher.tenant_id in compiled.params.values()
    assert 'NOWAIT' in str(compiled)


@pytest.mark.asyncio
async def test_ready_podcast_retry_does_not_bill_twice(monkeypatch):
    message = SimpleNamespace(id=uuid4(), role='assistant', content='Pronto', created_at=datetime.now(timezone.utc),
        attachments_json={'podcast': {'phase': 'ready', 'audio_url': '/private.mp3'}})
    monkeypatch.setattr(endpoints, 'owned_message', AsyncMock(return_value=message))
    synth = AsyncMock(side_effect=AssertionError('duplicate provider call'))
    monkeypatch.setattr(podcasts, 'synthesize', synth)
    result = await endpoints.generate(message.id, endpoints.GenerateAudio(script='test'), None, None)
    assert result['podcast']['phase'] == 'ready'
    synth.assert_not_called()


def test_mp3_chunks_are_remuxed_into_a_seekable_file():
    result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-f', 'mp3', '-'], capture_output=True, check=True)
    audio = podcasts.join_mp3([result.stdout, result.stdout])
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '-'], input=audio, capture_output=True, check=True)
    assert audio.startswith(b'ID3') or audio.startswith(b'\xff')
    # FFprobe's piped MP3 may report no duration; the file must still decode all chunks.
    decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', '-', '-f', 's16le', '-'], input=audio, capture_output=True, check=True)
    assert len(decoded.stdout) > 30000


@pytest.mark.asyncio
async def test_disk_media_streams_only_requested_bytes(tmp_path):
    from fastapi import FastAPI, Header
    from app.services.media_http import media_file_response
    path = tmp_path / 'video.mp4'
    path.write_bytes(b'A' * 300000 + b'BCDE')
    app = FastAPI()
    @app.get('/video')
    async def video(range: str | None = Header(default=None)):
        return media_file_response(path, 'video/mp4', range)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        r = await client.get('/video', headers={'Range': 'bytes=300000-'})
        assert r.status_code == 206
        assert r.content == b'BCDE'
        assert r.headers['content-length'] == '4'
        assert r.headers['content-range'] == 'bytes 300000-300003/300004'
        full = await client.get('/video')
        assert full.status_code == 200
        assert len(full.content) == 300004
        invalid = await client.get('/video', headers={'Range': 'bytes=999999-'})
        assert invalid.status_code == 416


@pytest.mark.asyncio
async def test_student_media_upload_does_not_require_teacher_drive_write_access(monkeypatch, tmp_path):
    from app.api.deps import StudentOrTeacher
    from app.api.v1.endpoints import files
    from app.services import drive_service
    student = SimpleNamespace(id=uuid4(), tenant_id=uuid4(), session_id=uuid4())
    added = []
    db = SimpleNamespace(scalar=AsyncMock(return_value=0), add=added.append, flush=AsyncMock(), commit=AsyncMock())
    monkeypatch.setattr(drive_service, 'UPLOADS_ROOT', tmp_path)
    from starlette.datastructures import Headers
    upload = UploadFile(filename='voice.mp3', file=io.BytesIO(b'mp3-fixture'), headers=Headers({'content-type': 'audio/mpeg'}))
    result = await files.upload_chat_media(db, StudentOrTeacher(student=student), upload)
    assert result['url'].startswith('/api/v1/files/media/')
    assert len(added) == 1  # No write to the teacher's private drive root.
    stored = added[0]
    assert stored.owner_student_id == student.id
    assert stored.owner_teacher_id is None
    assert drive_service.blob_path(stored.storage_key).read_bytes() == b'mp3-fixture'


@pytest.mark.asyncio
async def test_chat_media_owner_and_foreign_student_permissions(monkeypatch, tmp_path):
    from app.api.deps import StudentOrTeacher, get_student_or_teacher
    from app.api.v1.endpoints import files
    from app.core.database import get_db
    from app.models.enums import Scope
    from app.services import drive_service
    from fastapi import FastAPI
    file_id, student_id, tenant_id, session_id = uuid4(), uuid4(), uuid4(), uuid4()
    stored = SimpleNamespace(id=file_id, tenant_id=tenant_id, owner_student_id=student_id, owner_teacher_id=None,
        scope=Scope.USER, session_id=session_id, storage_key='drive/test/voice.mp3', filename='voice.mp3', mime_type='audio/mpeg')
    monkeypatch.setattr(drive_service, 'UPLOADS_ROOT', tmp_path)
    path = tmp_path / stored.storage_key;path.parent.mkdir(parents=True);path.write_bytes(b'0123456789')
    db = SimpleNamespace(get=AsyncMock(return_value=stored))
    principal = StudentOrTeacher(student=SimpleNamespace(id=student_id, tenant_id=tenant_id, session_id=session_id))
    app = FastAPI();app.include_router(files.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_student_or_teacher] = lambda: principal
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        ok = await client.get(f'/media/{file_id}', headers={'Range': 'bytes=2-4'})
        assert ok.status_code == 206
        assert ok.content == b'234'
        principal.student.id = uuid4()
        denied = await client.get(f'/media/{file_id}')
        assert denied.status_code == 404
