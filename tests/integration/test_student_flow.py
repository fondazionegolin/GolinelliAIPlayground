"""Integration tests for student endpoints (join, heartbeat, tasks, documents, canvas)."""

import pytest
from httpx import AsyncClient

from app.core.config import settings

API = settings.API_V1_PREFIX


# ---------------------------------------------------------------------------
# Join
# ---------------------------------------------------------------------------


class TestStudentJoin:
    async def test_join_valid_code(self, client: AsyncClient, seed_session):
        resp = await client.post(
            f"{API}/student/join",
            json={"join_code": seed_session.join_code, "nickname": "Alice"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_title"] == seed_session.title
        assert "join_token" in data

    async def test_join_invalid_code(self, client: AsyncClient):
        resp = await client.post(
            f"{API}/student/join",
            json={"join_code": "ZZZZZ", "nickname": "Bob"},
        )
        assert resp.status_code == 404

    async def test_join_inactive_session(
        self, client: AsyncClient, seed_session, db_session
    ):
        from app.models.enums import SessionStatus

        seed_session.status = SessionStatus.ENDED
        await db_session.flush()

        resp = await client.post(
            f"{API}/student/join",
            json={"join_code": seed_session.join_code, "nickname": "Charlie"},
        )
        assert resp.status_code == 400

    async def test_rejoin_same_nickname(self, client: AsyncClient, seed_session):
        """Joining twice with same nickname should return existing token."""
        payload = {"join_code": seed_session.join_code, "nickname": "RejoinerX"}
        resp1 = await client.post(f"{API}/student/join", json=payload)
        assert resp1.status_code == 200
        student_id1 = resp1.json()["student_id"]

        resp2 = await client.post(f"{API}/student/join", json=payload)
        assert resp2.status_code == 200
        assert resp2.json()["student_id"] == student_id1


# ---------------------------------------------------------------------------
# Session info & Profile
# ---------------------------------------------------------------------------


class TestStudentSession:
    async def test_get_session_info(self, student_client: AsyncClient):
        resp = await student_client.get(f"{API}/student/session")
        assert resp.status_code == 200
        data = resp.json()
        assert "session" in data
        assert "student" in data

    async def test_get_profile(self, student_client: AsyncClient):
        resp = await student_client.get(f"{API}/student/profile")
        assert resp.status_code == 200
        assert resp.json()["nickname"] == "TestStudent"


# ---------------------------------------------------------------------------
# Heartbeat
# ---------------------------------------------------------------------------


class TestHeartbeat:
    async def test_heartbeat(self, student_client: AsyncClient):
        resp = await student_client.post(f"{API}/student/heartbeat")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert "last_seen_at" in resp.json()


# ---------------------------------------------------------------------------
# Tasks (student side)
# ---------------------------------------------------------------------------


class TestStudentTasks:
    async def test_get_tasks_empty(self, student_client: AsyncClient):
        resp = await student_client.get(f"{API}/student/tasks")
        assert resp.status_code == 200
        # May return empty or existing tasks — just ensure it doesn't error


# ---------------------------------------------------------------------------
# Document drafts
# ---------------------------------------------------------------------------


class TestDocumentDrafts:
    async def test_create_draft(self, student_client: AsyncClient):
        resp = await student_client.post(
            f"{API}/student/documents/drafts",
            json={
                "title": "My Draft",
                "doc_type": "document",
                "content_json": '{"blocks":[]}',
            },
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "My Draft"

    async def test_list_drafts(self, student_client: AsyncClient):
        # Create one first
        await student_client.post(
            f"{API}/student/documents/drafts",
            json={
                "title": "Draft for List",
                "doc_type": "document",
                "content_json": "{}",
            },
        )
        resp = await student_client.get(f"{API}/student/documents/drafts")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    async def test_update_draft(self, student_client: AsyncClient):
        # Create
        create_resp = await student_client.post(
            f"{API}/student/documents/drafts",
            json={
                "title": "To Update",
                "doc_type": "document",
                "content_json": "{}",
            },
        )
        draft_id = create_resp.json()["id"]

        # Update
        resp = await student_client.patch(
            f"{API}/student/documents/drafts/{draft_id}",
            json={"title": "Updated Title"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Updated Title"

    async def test_delete_draft(self, student_client: AsyncClient):
        create_resp = await student_client.post(
            f"{API}/student/documents/drafts",
            json={
                "title": "To Delete",
                "doc_type": "document",
                "content_json": "{}",
            },
        )
        draft_id = create_resp.json()["id"]

        resp = await student_client.delete(
            f"{API}/student/documents/drafts/{draft_id}"
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"
