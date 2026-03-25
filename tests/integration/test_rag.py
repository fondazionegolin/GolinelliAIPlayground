"""Integration tests for RAG endpoints — document CRUD, status, listing."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.file import File
from app.models.rag import RAGDocument, RAGChunk
from app.models.enums import OwnerType, Scope, DocumentStatus

API = settings.API_V1_PREFIX


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_file(tenant_id, teacher_id=None, student_id=None):
    """Create a File record for RAG document tests."""
    return File(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        owner_type=OwnerType.TEACHER if teacher_id else OwnerType.STUDENT,
        owner_teacher_id=teacher_id,
        owner_student_id=student_id,
        scope=Scope.SESSION if teacher_id else Scope.USER,
        storage_key=f"test/{uuid.uuid4()}/doc.pdf",
        filename="doc.pdf",
        mime_type="application/pdf",
        size_bytes=2048,
        checksum_sha256="abc123",
    )


# ---------------------------------------------------------------------------
# RAG Document CRUD
# ---------------------------------------------------------------------------


class TestRAGDocumentCRUD:
    async def test_create_rag_document_teacher(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        seed_session,
        db_session,
    ):
        file_record = _make_file(seed_tenant.id, teacher_id=seed_teacher.id)
        file_record.session_id = seed_session.id
        db_session.add(file_record)
        await db_session.flush()

        resp = await teacher_client.post(
            f"{API}/rag/documents",
            json={
                "scope": "SESSION",
                "session_id": str(seed_session.id),
                "file_id": str(file_record.id),
                "title": "Lecture Notes",
                "doc_type": "pdf",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Lecture Notes"
        assert data["status"] == "queued"

    async def test_create_rag_document_student(
        self,
        student_client: AsyncClient,
        seed_student,
        seed_tenant,
        seed_session,
        db_session,
    ):
        file_record = _make_file(seed_tenant.id, student_id=seed_student.id)
        file_record.session_id = seed_session.id
        db_session.add(file_record)
        await db_session.flush()

        resp = await student_client.post(
            f"{API}/rag/documents",
            json={
                "scope": "USER",
                "session_id": str(seed_session.id),
                "file_id": str(file_record.id),
                "title": "My Notes",
                "doc_type": "pdf",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "My Notes"

    async def test_list_rag_documents_teacher(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        seed_session,
        db_session,
    ):
        file_record = _make_file(seed_tenant.id, teacher_id=seed_teacher.id)
        file_record.session_id = seed_session.id
        db_session.add(file_record)
        await db_session.flush()

        doc = RAGDocument(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            scope=Scope.SESSION,
            session_id=seed_session.id,
            owner_teacher_id=seed_teacher.id,
            file_id=file_record.id,
            title="Indexed Doc",
            doc_type="pdf",
        )
        db_session.add(doc)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{API}/rag/documents",
            params={"session_id": str(seed_session.id)},
        )
        assert resp.status_code == 200
        docs = resp.json()
        assert any(d["title"] == "Indexed Doc" for d in docs)


# ---------------------------------------------------------------------------
# Document status
# ---------------------------------------------------------------------------


class TestRAGDocumentStatus:
    async def test_get_document_status(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        seed_session,
        db_session,
    ):
        file_record = _make_file(seed_tenant.id, teacher_id=seed_teacher.id)
        file_record.session_id = seed_session.id
        db_session.add(file_record)
        await db_session.flush()

        doc = RAGDocument(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            scope=Scope.SESSION,
            session_id=seed_session.id,
            owner_teacher_id=seed_teacher.id,
            file_id=file_record.id,
            title="Status Check",
            doc_type="pdf",
            status=DocumentStatus.READY,
        )
        db_session.add(doc)
        await db_session.flush()

        # Add a chunk to verify chunk_count
        chunk = RAGChunk(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            document_id=doc.id,
            chunk_index=0,
            text="Sample chunk text.",
        )
        db_session.add(chunk)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{API}/rag/documents/{doc.id}/status"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ready"
        assert data["chunk_count"] >= 1
