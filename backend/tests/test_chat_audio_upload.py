import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.api.deps import StudentOrTeacher
from app.api.v1.endpoints import chat
from app.models.enums import Scope


@pytest.mark.asyncio
async def test_podcast_mp3_can_be_shared_as_session_attachment(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    teacher = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    session_id = uuid4()
    access = AsyncMock(return_value=True)
    monkeypatch.setattr(chat, 'teacher_can_access_session', access)
    rows = []
    db = SimpleNamespace(add=rows.append, commit=AsyncMock())
    audio = b'ID3-test-podcast-original-bytes'
    file = UploadFile(filename='Podcast di scienze.mp3', file=io.BytesIO(audio), headers=Headers({'content-type': 'audio/mpeg'}))
    result = await chat.upload_chat_files(str(session_id), [file], db, StudentOrTeacher(teacher=teacher))
    assert len(result['urls']) == 1
    assert result['urls'][0].startswith(f'/uploads/chat/{session_id}/')
    assert Path(result['urls'][0].lstrip('/')).read_bytes() == audio
    assert len(rows) == 1
    assert rows[0].scope == Scope.SESSION
    assert rows[0].session_id == session_id
    assert rows[0].owner_teacher_id == teacher.id
    assert rows[0].filename == 'Podcast di scienze.mp3'
    assert rows[0].mime_type == 'audio/mpeg'
    access.assert_awaited_once_with(db, teacher, session_id)


@pytest.mark.asyncio
async def test_sharing_podcast_requires_access_to_destination_class(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(chat, 'teacher_can_access_session', AsyncMock(return_value=False))
    teacher = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    upload = UploadFile(filename='podcast.mp3', file=io.BytesIO(b'audio'), headers=Headers({'content-type': 'audio/mpeg'}))
    upload.read = AsyncMock(side_effect=AssertionError('must not read without permission'))
    with pytest.raises(HTTPException) as error:
        await chat.upload_chat_files(str(uuid4()), [upload], None, StudentOrTeacher(teacher=teacher))
    assert error.value.status_code == 403
    upload.read.assert_not_called()
    assert not (tmp_path / 'uploads').exists()


@pytest.mark.asyncio
async def test_student_cannot_upload_audio_to_another_session(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    student = SimpleNamespace(id=uuid4(), tenant_id=uuid4(), session_id=uuid4())
    with pytest.raises(HTTPException) as error:
        await chat.upload_chat_files(str(uuid4()), [], None, StudentOrTeacher(student=student))
    assert error.value.status_code == 403
    assert not (tmp_path / 'uploads').exists()
