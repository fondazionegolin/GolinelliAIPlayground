"""Opt-in checks against the migrated development PostgreSQL, all data rolled back.
Run with VOICE_LAB_DB_TESTS=1; no provider calls or permanent file writes.
"""
import os
from contextlib import asynccontextmanager
from uuid import uuid4, UUID

import pytest
from unittest.mock import AsyncMock
from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.deps import StudentOrTeacher
from app.api.v1.endpoints import voice_lab, voice_playlists, drive as drive_routes
from app.core.config import settings
engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
from app.models.credits import CreditLimit, CreditTransaction
from app.models.drive import DriveItem, DriveShare
from app.models.enums import UserRole, SessionStatus, LimitLevel
from app.models.session import Class, Session, SessionStudent
from app.models.tenant import Tenant
from app.models.user import User
from app.models.voice_lab import VoiceLabItem
from app.services import drive_service as drive, voice_lab_billing as billing

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(os.getenv("VOICE_LAB_DB_TESTS") != "1", reason="Opt-in development PostgreSQL checks")]


@pytest.fixture(autouse=True)
def no_test_email(monkeypatch):
    monkeypatch.setattr(billing.credit_service, "_email_admins", AsyncMock())


@asynccontextmanager
async def isolated():
    async with engine.connect() as connection:
        outer = await connection.begin()
        db = AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        try:
            tenant = Tenant(id=uuid4(), name="Voice Lab test", slug=f"voice-test-{uuid4()}")
            db.add(tenant); await db.flush()
            teacher = User(id=uuid4(), tenant_id=tenant.id, email=f"{uuid4()}@example.invalid", role=UserRole.TEACHER, is_verified=True, is_active=True)
            db.add(teacher); await db.flush()
            yield db, teacher
        finally:
            await db.close(); await outer.rollback()


async def test_playlist_order_share_revocation_removal_and_original_preservation(monkeypatch, tmp_path):
    monkeypatch.setattr(drive, "write_blob", lambda key, data: None)
    monkeypatch.setattr(drive, "blob_path", lambda key: None)
    monkeypatch.setattr(drive, "read_blob", lambda key: b"test audio")
    async with isolated() as (db, teacher):
        first = await voice_lab.save_blob(db, teacher, "Prima", "music", b"audio1", "audio/mpeg", "mp3", {})
        second = await voice_lab.save_blob(db, teacher, "Seconda", "tts", b"audio2", "audio/mpeg", "mp3", {})
        playlist = await voice_playlists.create_playlist(voice_playlists.PlaylistWrite(title="Lezione", track_ids=[first.id, second.id]), db, teacher)
        assert [v["source_item_id"] for v in playlist["tracks"]] == [str(first.id), str(second.id)]
        folder = await db.get(DriveItem, UUID(playlist["folder_id"]))
        cls = Class(id=uuid4(), tenant_id=teacher.tenant_id, teacher_id=teacher.id, name="Classe test")
        db.add(cls); await db.flush()
        session = Session(id=uuid4(), tenant_id=teacher.tenant_id, class_id=cls.id, title="Test", join_code=str(uuid4())[:5], status=SessionStatus.ACTIVE)
        db.add(session); await db.flush()
        student = SessionStudent(id=uuid4(), tenant_id=teacher.tenant_id, session_id=session.id, nickname="Test", join_token=str(uuid4()))
        db.add(student); await db.flush()
        auth = StudentOrTeacher(student=student)
        with pytest.raises(HTTPException) as exc:
            await voice_playlists.playlist_details(UUID(playlist["id"]), db, auth)
        assert exc.value.status_code == 404
        # Exercise existing target validation, not an invented public access path.
        await drive_routes.put_shares(folder.id, drive_routes.SharesUpdate(shares=[drive_routes.ShareEntry(target_type="class", target_id=cls.id)]), db, teacher)
        shared = await voice_playlists.playlist_details(UUID(playlist["id"]), db, auth)
        principal = await drive.principal_for(db, None, student)
        child = await db.get(DriveItem, UUID(shared["tracks"][0]["id"]))
        assert (await drive.resolve_role(db, principal, child))[0] == "viewer"
        response = await drive_routes.item_content(child.id, db, auth, Request({"type": "http", "headers": []}), True)
        assert response.body == b"test audio"
        assert "attachment" in response.headers["content-disposition"]
        original = await db.get(DriveItem, UUID(first.details["drive_item_id"]))
        assert (await drive.resolve_role(db, principal, original))[0] is None
        await voice_playlists.update_playlist(UUID(playlist["id"]), voice_playlists.PlaylistWrite(title="Ordine inverso", track_ids=[second.id, first.id]), db, teacher)
        reordered = await voice_playlists.playlist_details(UUID(playlist["id"]), db, auth)
        assert reordered["tracks"][0]["source_item_id"] == str(second.id)
        await drive_routes.update_item(folder.id, drive_routes.ItemUpdate(name="Rinominata dai Files"), db, StudentOrTeacher(teacher=teacher))
        assert (await voice_playlists.playlist_details(UUID(playlist["id"]), db, auth))["title"] == "Rinominata dai Files"
        await voice_playlists.update_playlist(UUID(playlist["id"]), voice_playlists.PlaylistWrite(title="Una traccia", track_ids=[second.id]), db, teacher)
        assert await db.get(DriveItem, child.id) is None
        assert await db.get(VoiceLabItem, first.id) is not None
        assert await db.get(DriveItem, original.id) is not None
        await drive_routes.put_shares(folder.id, drive_routes.SharesUpdate(shares=[]), db, teacher)
        with pytest.raises(HTTPException):
            await voice_playlists.playlist_details(UUID(playlist["id"]), db, auth)
        await voice_playlists.delete_playlist(UUID(playlist["id"]), db, teacher)
        assert (await db.get(DriveItem, original.id)).trashed_at is None
        reference = await db.scalar(select(DriveItem).where(DriveItem.parent_id == folder.id, DriveItem.source_type == "voice_track"))
        await drive.purge_items(db, [reference]); await db.commit()
        assert await db.get(DriveItem, reference.id) is None
        assert await db.get(DriveItem, UUID(second.details["drive_item_id"])) is not None


async def test_reservation_settlement_and_refund_are_idempotent_and_update_limits():
    async with isolated() as (db, teacher):
        price = billing.quote("music", seconds=60)
        tx = await billing.reserve(db, teacher, price)
        limit = await db.scalar(select(CreditLimit).where(CreditLimit.teacher_id == teacher.id, CreditLimit.level == LimitLevel.TEACHER))
        assert limit.current_usage == pytest.approx(price["cost"])
        await billing.settle(db, tx.id, price)
        await billing.settle(db, tx.id, price)
        assert limit.current_usage == pytest.approx(price["cost"])
        assert (await db.get(CreditTransaction, tx.id)).usage_details["billing_status"] == "settled"
        failed = await billing.reserve(db, teacher, price)
        await billing.settle(db, failed.id, status="refunded")
        await billing.settle(db, failed.id, status="refunded")
        assert limit.current_usage == pytest.approx(price["cost"])
        assert failed.cost == 0
        limit.amount_cap = price["cost"] + .001
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await billing.reserve(db, teacher, price)
        assert exc.value.status_code == 402


async def test_cannot_add_foreign_audio_or_edit_someone_elses_playlist(monkeypatch):
    monkeypatch.setattr(drive, "write_blob", lambda key, data: None)
    async with isolated() as (db, teacher):
        other = User(id=uuid4(), tenant_id=teacher.tenant_id, role=UserRole.TEACHER, is_verified=True, is_active=True)
        db.add(other); await db.flush()
        audio = await voice_lab.save_blob(db, other, "Privato", "tts", b"audio", "audio/mpeg", "mp3", {})
        own = await voice_playlists.create_playlist(voice_playlists.PlaylistWrite(title="Test"), db, teacher)
        with pytest.raises(HTTPException) as exc:
            await voice_playlists.update_playlist(UUID(own["id"]), voice_playlists.PlaylistWrite(title="Test", track_ids=[audio.id]), db, teacher)
        assert exc.value.status_code == 422
        with pytest.raises(HTTPException):
            await voice_playlists.update_playlist(UUID(own["id"]), voice_playlists.PlaylistWrite(title="Hack"), db, other)


async def test_late_refund_preserves_usage_in_new_billing_period():
    from datetime import timedelta
    async with isolated() as (db, teacher):
        price = billing.quote("music", seconds=60)
        tx = await billing.reserve(db, teacher, price)
        limit = await db.scalar(select(CreditLimit).where(CreditLimit.teacher_id == teacher.id, CreditLimit.level == LimitLevel.TEACHER))
        limit.period_start += timedelta(days=32)
        limit.current_usage = .02
        await db.commit()
        await billing.settle(db, tx.id, status="refunded")
        assert limit.current_usage == pytest.approx(.02)
        assert tx.cost == 0


async def test_rename_track_preserves_artist_and_syncs_file_playlist_and_library(monkeypatch):
    from app.models.file import File
    monkeypatch.setattr(drive, "write_blob", lambda key, data: None)
    async with isolated() as (db, teacher):
        teacher.first_name, teacher.last_name = "Ada", "Lovelace"
        first = await voice_lab.save_blob(db, teacher, "Prima", "music", b"audio", "audio/mpeg", "mp3", {})
        await db.commit()
        playlist = await voice_playlists.create_playlist(voice_playlists.PlaylistWrite(title="Musica", track_ids=[first.id]), db, teacher)
        assert first.details["artist_name"] == "Ada Lovelace"
        teacher.first_name = "Nome aggiornato"
        result = await voice_lab.update_track(first.id, voice_lab.TrackUpdate(title="  Notte / jazz  "), db, teacher)
        assert result["title"] == "Notte / jazz"
        assert result["artist_name"] == "Ada Lovelace"
        original = await db.get(DriveItem, UUID(first.details["drive_item_id"]))
        assert original.name == "Notte - jazz.mp3"
        assert (await db.get(File, original.file_id)).filename == original.name
        reference = await db.get(DriveItem, UUID(playlist["tracks"][0]["id"]))
        assert reference.name == original.name
        updated = await voice_playlists.playlist_details(UUID(playlist["id"]), db, teacher)
        assert updated["tracks"][0]["title"] == "Notte / jazz"
        assert updated["tracks"][0]["artist_name"] == "Ada Lovelace"
        assert next(row for row in await voice_lab.items(db, teacher) if row["id"] == str(first.id))["title"] == "Notte / jazz"


async def test_rename_is_owner_scoped_and_legacy_artist_uses_original_owner(monkeypatch):
    monkeypatch.setattr(drive, "write_blob", lambda key, data: None)
    async with isolated() as (db, teacher):
        teacher.first_name, teacher.last_name = "Nina", "Simone"
        first = await voice_lab.save_blob(db, teacher, "Vecchio brano", "music", b"audio", "audio/mpeg", "mp3", {})
        first.details = {k: v for k, v in first.details.items() if k != "artist_name"}
        other = User(id=uuid4(), tenant_id=teacher.tenant_id, email=f"{uuid4()}@example.invalid", role=UserRole.TEACHER, first_name="Altro", is_active=True)
        db.add(other); await db.commit()
        with pytest.raises(HTTPException) as exc:
            await voice_lab.update_track(first.id, voice_lab.TrackUpdate(title="Non autorizzato"), db, other)
        assert exc.value.status_code == 404
        assert first.title == "Vecchio brano"
        details = await voice_lab.item_details(first.id, db, teacher)
        assert details["artist_name"] == "Nina Simone"
        metadata = await voice_playlists.track_metadata(db, [str(first.id), first.details["drive_item_id"]])
        assert metadata[first.details["drive_item_id"]]["artist_name"] == "Nina Simone"
        assert metadata[str(first.id)]["title"] == "Vecchio brano"
