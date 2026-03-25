"""Integration tests for file management endpoints — upload, complete, download."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.file import File
from app.models.enums import OwnerType, Scope

API = settings.API_V1_PREFIX


# ---------------------------------------------------------------------------
# Upload URL generation
# ---------------------------------------------------------------------------


class TestFileUpload:
    async def test_student_get_upload_url(
        self, student_client: AsyncClient, seed_session
    ):
        resp = await student_client.post(
            f"{API}/files/upload-url",
            json={
                "filename": "homework.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 1024 * 100,  # 100 KB
                "scope": "USER",
                "session_id": str(seed_session.id),
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "upload_url" in data
        assert "file_id" in data
        assert "storage_key" in data
        assert data["expires_in"] > 0

    async def test_teacher_get_upload_url_session_scope(
        self, teacher_client: AsyncClient, seed_session
    ):
        resp = await teacher_client.post(
            f"{API}/files/upload-url",
            json={
                "filename": "lecture_notes.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 1024 * 500,
                "scope": "SESSION",
                "session_id": str(seed_session.id),
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "upload_url" in data

    async def test_upload_url_invalid_mime_type(
        self, student_client: AsyncClient, seed_session
    ):
        resp = await student_client.post(
            f"{API}/files/upload-url",
            json={
                "filename": "virus.exe",
                "mime_type": "application/x-msdownload",
                "size_bytes": 1024,
                "scope": "USER",
                "session_id": str(seed_session.id),
            },
        )
        assert resp.status_code in (400, 422)

    async def test_upload_url_file_too_large(
        self, student_client: AsyncClient, seed_session
    ):
        resp = await student_client.post(
            f"{API}/files/upload-url",
            json={
                "filename": "huge.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 200 * 1024 * 1024,  # 200 MB, over 50 MB limit
                "scope": "USER",
                "session_id": str(seed_session.id),
            },
        )
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# File completion + download
# ---------------------------------------------------------------------------


class TestFileComplete:
    async def test_complete_upload(
        self,
        student_client: AsyncClient,
        seed_session,
        seed_student,
        seed_tenant,
        db_session,
    ):
        """Mark file upload as complete with checksum."""
        file_record = File(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            owner_type=OwnerType.STUDENT,
            owner_student_id=seed_student.id,
            scope=Scope.USER,
            session_id=seed_session.id,
            storage_key=f"test/{uuid.uuid4()}/doc.pdf",
            filename="doc.pdf",
            mime_type="application/pdf",
            size_bytes=1024,
            checksum_sha256="pending",
        )
        db_session.add(file_record)
        await db_session.flush()

        resp = await student_client.post(
            f"{API}/files/complete",
            json={
                "file_id": str(file_record.id),
                "checksum_sha256": "abc123def456",
            },
        )
        assert resp.status_code == 200


class TestFileDownload:
    async def test_get_download_url(
        self,
        student_client: AsyncClient,
        seed_session,
        seed_student,
        seed_tenant,
        db_session,
    ):
        file_record = File(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            owner_type=OwnerType.STUDENT,
            owner_student_id=seed_student.id,
            scope=Scope.USER,
            session_id=seed_session.id,
            storage_key=f"test/{uuid.uuid4()}/doc.pdf",
            filename="doc.pdf",
            mime_type="application/pdf",
            size_bytes=1024,
            checksum_sha256="abc123",
        )
        db_session.add(file_record)
        await db_session.flush()

        resp = await student_client.get(
            f"{API}/files/{file_record.id}/download-url"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "download_url" in data

    async def test_download_nonexistent_file(self, student_client: AsyncClient):
        resp = await student_client.get(
            f"{API}/files/{uuid.uuid4()}/download-url"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Session files listing
# ---------------------------------------------------------------------------


class TestSessionFiles:
    async def test_list_session_files(
        self,
        teacher_client: AsyncClient,
        seed_session,
        seed_teacher,
        seed_tenant,
        db_session,
    ):
        file_record = File(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            owner_type=OwnerType.TEACHER,
            owner_teacher_id=seed_teacher.id,
            scope=Scope.SESSION,
            session_id=seed_session.id,
            storage_key=f"test/{uuid.uuid4()}/notes.pdf",
            filename="notes.pdf",
            mime_type="application/pdf",
            size_bytes=2048,
            checksum_sha256="xyz789",
        )
        db_session.add(file_record)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{API}/files/session/{seed_session.id}"
        )
        assert resp.status_code == 200
        files = resp.json()
        assert any(f["filename"] == "notes.pdf" for f in files)
