"""Opt-in permission, ownership and synchronized timeline checks; all rows rolled back."""
import os
from contextlib import asynccontextmanager
from uuid import UUID, uuid4
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.deps import StudentOrTeacher
from app.api.v1.endpoints import drive as routes, voice_playlists as audio, voice_lab
from app.core.config import settings
from app.models.tenant import Tenant
from app.models.user import User
from app.models.enums import UserRole, SessionStatus
from app.models.session import Class, Session, SessionStudent
from app.models.drive import DriveItem
from app.models.file import File
from app.models.voice_lab import SessionAudioPlayback
from app.services import drive_service as drive

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(os.getenv('VOICE_LAB_DB_TESTS') != '1', reason='Development PostgreSQL only')]
engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)


@asynccontextmanager
async def isolated(monkeypatch):
    monkeypatch.setattr(drive, 'write_blob', lambda *args: None)
    monkeypatch.setattr(drive, 'read_blob', lambda *args: b'test-audio')
    async with engine.connect() as connection:
        outer = await connection.begin()
        db = AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode='create_savepoint')
        try:
            tenant = Tenant(id=uuid4(), name='Audio test', slug=f'audio-{uuid4()}')
            db.add(tenant); await db.flush()
            teacher = User(id=uuid4(), tenant_id=tenant.id, email=f'{uuid4()}@example.invalid', role=UserRole.TEACHER, is_active=True, is_verified=True)
            db.add(teacher); await db.flush()
            cls = Class(id=uuid4(), tenant_id=tenant.id, teacher_id=teacher.id, name='Audio class')
            db.add(cls); await db.flush()
            session = Session(id=uuid4(), tenant_id=tenant.id, class_id=cls.id, title='Audio session', join_code=str(uuid4())[:5], status=SessionStatus.ACTIVE)
            db.add(session); await db.flush()
            students = [SessionStudent(id=uuid4(), tenant_id=tenant.id, session_id=session.id, nickname=f'Student {i}', join_token=str(uuid4())) for i in range(2)]
            db.add_all(students); await db.flush()
            yield db, teacher, cls, session, students
        finally:
            await db.close(); await outer.rollback()


async def uploaded(db, auth, name='sound.mp3'):
    result = await routes.upload(db, auth, [UploadFile(file=BytesIO(b'audio'), filename=name, headers=Headers({'content-type': 'audio/mpeg'}))], None, None)
    item = await db.get(DriveItem, UUID(result['items'][0]['id']))
    stored = await db.get(File, item.file_id)
    stored.audio_duration = 10
    await db.flush()
    return item


async def test_student_upload_personal_files_share_and_playlist_reuse(monkeypatch):
    async with isolated(monkeypatch) as (db, teacher, cls, session, students):
        first, second = [StudentOrTeacher(student=v) for v in students]
        own = await uploaded(db, first)
        parent = await db.get(DriveItem, own.parent_id)
        assert parent.name == 'Musica'
        assert own.owner_student_id == students[0].id
        assert own.file_id is not None
        listing = await routes.list_items(db, first, 'folder', None, None, False)
        assert listing['role'] == 'owner'
        assert any(v['name'] == 'Musica' for v in listing['items'])
        assert (await drive.resolve_role(db, await drive.principal_for(db, None, students[1]), own))[0] is None
        with pytest.raises(HTTPException):
            await audio.create_playlist(audio.PlaylistWrite(title='Forbidden', track_ids=[own.id]), db, second)
        await audio.share_audio_class(own.id, db, first)
        assert any(v['id'] == str(own.id) for v in await audio.audio_files(db, second))
        assert any(v['id'] == str(own.id) for v in await audio.audio_files(db, StudentOrTeacher(teacher=teacher)))
        playlist = await audio.create_playlist(audio.PlaylistWrite(title='Personal', track_ids=[own.id]), db, second)
        assert playlist['tracks'][0]['source_item_id'] == str(own.id)
        assert len(await audio.playlists(db, second)) == 1
        assert await audio.playlists(db, first) == []
        with pytest.raises(HTTPException):
            await audio.update_playlist(UUID(playlist['id']), audio.PlaylistWrite(title='Hijack'), db, first)
        with pytest.raises(HTTPException):
            await audio.share_audio_class(own.id, db, second)


async def test_class_timeline_continues_without_teacher_and_rejects_other_classes(monkeypatch):
    async with isolated(monkeypatch) as (db, teacher, cls, session, students):
        auth = StudentOrTeacher(teacher=teacher)
        tracks = [await uploaded(db, auth, name=f'track-{i}.mp3') for i in range(2)]
        playlist = await audio.create_playlist(audio.PlaylistWrite(title='Class', track_ids=[v.id for v in tracks]), db, auth)
        start = await audio.set_session_playback(session.id, audio.PlaybackWrite(playlist_id=UUID(playlist['id'])), db, teacher)
        state = await db.get(SessionAudioPlayback, session.id)
        started = state.state['updated_at']
        monkeypatch.setattr(audio.time, 'time', lambda: started + 14)
        student = StudentOrTeacher(student=students[0])
        value = await audio.session_playback(db, student, session.id)
        assert value['index'] == 1
        assert value['position'] == pytest.approx(4)
        assert value['paused'] is False
        content = await audio.session_track_content(session.id, UUID(value['playlist']['tracks'][1]['id']), db, student)
        assert content.body == b'test-audio'
        assert 'no-store' in content.headers['cache-control']
        with pytest.raises(HTTPException) as exc:
            await audio.session_playback(db, student, uuid4())
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException):
            await audio.session_track_content(session.id, tracks[0].id, db, student)
        monkeypatch.setattr(audio.time, 'time', lambda: started + 24)
        ended = await audio.session_playback(db, student, session.id)
        assert ended['paused'] is True
        assert ended['position'] == 10
        await audio.set_session_playback(session.id, audio.PlaybackWrite(playlist_id=None, expected_revision=start['revision']), db, teacher)
        assert await audio.session_playback(db, student, session.id) is None
        with pytest.raises(HTTPException):
            await audio.session_track_content(session.id, UUID(value['playlist']['tracks'][0]['id']), db, student)
        with pytest.raises(HTTPException) as exc:
            await audio.set_session_playback(session.id, audio.PlaybackWrite(playlist_id=UUID(playlist['id']), expected_revision=start['revision']), db, teacher)
        assert exc.value.status_code == 409


async def test_generated_voice_music_and_existing_files_are_categorized_without_moving_custom_folders(monkeypatch):
    async with isolated(monkeypatch) as (db, teacher, cls, session, students):
        voice = await voice_lab.save_blob(db, teacher, 'Reading', 'tts', b'audio', 'audio/mpeg', 'mp3', {})
        music = await voice_lab.save_blob(db, teacher, 'Music', 'music', b'audio', 'audio/mpeg', 'mp3', {})
        for item, expected in [(voice, 'Voci'), (music, 'Musica')]:
            row = await db.get(DriveItem, UUID(item.details['drive_item_id']))
            assert (await db.get(DriveItem, row.parent_id)).name == expected
        loose = DriveItem(owner_teacher_id=teacher.id, tenant_id=teacher.tenant_id, kind='file', name='slides.pptx', mime_type='application/vnd.openxmlformats-officedocument.presentationml.presentation')
        folder = DriveItem(id=uuid4(), owner_teacher_id=teacher.id, tenant_id=teacher.tenant_id, kind='folder', name='Custom')
        custom = DriveItem(owner_teacher_id=teacher.id, tenant_id=teacher.tenant_id, parent_id=folder.id, kind='file', name='custom.pdf', mime_type='application/pdf')
        db.add_all([loose, folder, custom]); await db.flush()
        await drive.organize_loose_files(db, teacher); await db.flush()
        assert (await db.get(DriveItem, loose.parent_id)).name == 'Presentazioni'
        assert custom.parent_id == folder.id
        parent = loose.parent_id
        await drive.organize_loose_files(db, teacher); await db.flush()
        assert loose.parent_id == parent


async def test_enriching_live_playlist_preserves_position_and_generated_audio_is_personal(monkeypatch):
    async with isolated(monkeypatch) as (db, teacher, cls, session, students):
        auth = StudentOrTeacher(teacher=teacher)
        first = await uploaded(db, auth, 'first.mp3')
        second = await uploaded(db, auth, 'second.mp3')
        playlist = await audio.create_playlist(audio.PlaylistWrite(title='Live', track_ids=[first.id]), db, auth)
        started = await audio.set_session_playback(session.id, audio.PlaybackWrite(playlist_id=UUID(playlist['id'])), db, teacher)
        start = (await db.get(SessionAudioPlayback, session.id)).state['updated_at']
        monkeypatch.setattr(audio.time, 'time', lambda: start + 4)
        await audio.update_playlist(UUID(playlist['id']), audio.PlaylistWrite(title='Live', track_ids=[first.id, second.id]), db, auth)
        current = await audio.session_playback(db, StudentOrTeacher(student=students[0]), session.id)
        assert current['index'] == 0
        assert current['position'] == pytest.approx(4)
        assert current['revision'] != started['revision']
        monkeypatch.setattr(audio.time, 'time', lambda: start + 14)
        current = await audio.session_playback(db, StudentOrTeacher(student=students[0]), session.id)
        assert current['index'] == 1
        assert current['position'] == pytest.approx(4)
        from app.models.enums import OwnerType, Scope
        generated = File(id=uuid4(), tenant_id=teacher.tenant_id, owner_type=OwnerType.STUDENT,
            owner_student_id=students[0].id, scope=Scope.USER, storage_key='generated/audio.mp3',
            filename='My generated song.mp3', mime_type='audio/mpeg', size_bytes=123, checksum_sha256='test')
        db.add(generated); await db.flush()
        await drive.sync_student_audio(db, students[0])
        mirror = await db.scalar(select(DriveItem).where(DriveItem.file_id == generated.id, DriveItem.owner_student_id == students[0].id))
        assert mirror is not None
        assert (await db.get(DriveItem, mirror.parent_id)).name == 'Musica'
        assert (await drive.resolve_role(db, await drive.principal_for(db, None, students[1]), mirror))[0] is None
        await drive.sync_student_audio(db, students[0])
        from sqlalchemy import func
        assert await db.scalar(select(func.count()).select_from(DriveItem).where(DriveItem.file_id == generated.id, DriveItem.owner_student_id == students[0].id)) == 1
