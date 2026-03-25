"""Integration tests for teacher CRUD endpoints (classes, sessions, tasks, modules)."""

import pytest
from httpx import AsyncClient

from app.core.config import settings

API = settings.API_V1_PREFIX


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------


class TestClassCRUD:
    async def test_create_class(self, teacher_client: AsyncClient):
        resp = await teacher_client.post(
            f"{API}/teacher/classes",
            json={"name": "Matematica 3B"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Matematica 3B"
        assert "id" in data

    async def test_list_classes(self, teacher_client: AsyncClient, seed_class):
        resp = await teacher_client.get(f"{API}/teacher/classes")
        assert resp.status_code == 200
        classes = resp.json()
        assert any(c["id"] == str(seed_class.id) for c in classes)

    async def test_update_class(self, teacher_client: AsyncClient, seed_class):
        resp = await teacher_client.patch(
            f"{API}/teacher/classes/{seed_class.id}",
            json={"name": "Updated Class Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Class Name"


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


class TestSessionCRUD:
    async def test_create_session(self, teacher_client: AsyncClient, seed_class):
        resp = await teacher_client.post(
            f"{API}/teacher/classes/{seed_class.id}/sessions",
            json={"title": "Lezione 1"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Lezione 1"
        assert len(data["join_code"]) == 5
        assert data["status"] == "draft"

    async def test_list_sessions(
        self, teacher_client: AsyncClient, seed_class, seed_session
    ):
        resp = await teacher_client.get(
            f"{API}/teacher/classes/{seed_class.id}/sessions"
        )
        assert resp.status_code == 200
        sessions = resp.json()
        assert any(s["id"] == str(seed_session.id) for s in sessions)

    async def test_update_session_status(
        self, teacher_client: AsyncClient, seed_session
    ):
        """Activate then end a session."""
        # Session is already active from fixture; end it
        resp = await teacher_client.patch(
            f"{API}/teacher/sessions/{seed_session.id}",
            json={"status": "ended"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ended"

    async def test_get_session_live(
        self, teacher_client: AsyncClient, seed_session
    ):
        resp = await teacher_client.get(
            f"{API}/teacher/sessions/{seed_session.id}/live"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["session"]["join_code"] == seed_session.join_code


# ---------------------------------------------------------------------------
# Modules
# ---------------------------------------------------------------------------


class TestSessionModules:
    async def test_configure_modules(
        self, teacher_client: AsyncClient, seed_session
    ):
        resp = await teacher_client.post(
            f"{API}/teacher/sessions/{seed_session.id}/modules",
            json={
                "modules": [
                    {"module_key": "chatbot", "is_enabled": True},
                    {"module_key": "classification", "is_enabled": False},
                ]
            },
        )
        assert resp.status_code == 200
        modules = resp.json()
        keys = {m["module_key"]: m["is_enabled"] for m in modules}
        assert keys["chatbot"] is True
        assert keys["classification"] is False


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


class TestTaskCRUD:
    async def test_create_task(self, teacher_client: AsyncClient, seed_session):
        resp = await teacher_client.post(
            f"{API}/teacher/sessions/{seed_session.id}/tasks",
            json={
                "title": "Quiz Chapter 1",
                "task_type": "quiz",
                "description": "Test your knowledge",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Quiz Chapter 1"
        assert data["status"] == "draft"

    async def test_create_lesson_auto_published(
        self, teacher_client: AsyncClient, seed_session
    ):
        """Lessons are auto-published on creation."""
        resp = await teacher_client.post(
            f"{API}/teacher/sessions/{seed_session.id}/tasks",
            json={
                "title": "Auto Published Lesson",
                "task_type": "lesson",
                "content_json": '{"blocks":[]}',
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "published"

    async def test_list_tasks(self, teacher_client: AsyncClient, seed_session):
        # Create a task first
        await teacher_client.post(
            f"{API}/teacher/sessions/{seed_session.id}/tasks",
            json={"title": "Listed Task", "task_type": "exercise"},
        )

        resp = await teacher_client.get(
            f"{API}/teacher/sessions/{seed_session.id}/tasks"
        )
        assert resp.status_code == 200
        assert len(resp.json()) >= 1
