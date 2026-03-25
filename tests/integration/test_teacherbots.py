"""Integration tests for teacherbot endpoints — CRUD, test, publish, conversations."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import MagicMock

from app.core.config import settings
from app.models.teacherbot import (
    Teacherbot,
    TeacherbotStatus,
    TeacherbotPublication,
    TeacherbotConversation,
    TeacherbotMessage,
)

API = settings.API_V1_PREFIX


# ---------------------------------------------------------------------------
# Teacherbot CRUD
# ---------------------------------------------------------------------------


class TestTeacherbotCRUD:
    async def test_create_teacherbot(self, teacher_client: AsyncClient):
        resp = await teacher_client.post(
            f"{API}/teacherbots",
            json={
                "name": "Math Tutor",
                "synopsis": "Helps students with math",
                "system_prompt": "You are a friendly math tutor.",
                "temperature": 0.5,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Math Tutor"
        assert data["status"] == "draft"
        assert data["temperature"] == 0.5
        assert "id" in data

    async def test_list_teacherbots(
        self, teacher_client: AsyncClient, seed_teacher, seed_tenant, db_session
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="History Bot",
            system_prompt="You teach history.",
        )
        db_session.add(bot)
        await db_session.flush()

        resp = await teacher_client.get(f"{API}/teacherbots")
        assert resp.status_code == 200
        bots = resp.json()
        assert any(b["name"] == "History Bot" for b in bots)

    async def test_get_teacherbot(
        self, teacher_client: AsyncClient, seed_teacher, seed_tenant, db_session
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Science Bot",
            system_prompt="You teach science.",
        )
        db_session.add(bot)
        await db_session.flush()

        resp = await teacher_client.get(f"{API}/teacherbots/{bot.id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Science Bot"

    async def test_update_teacherbot(
        self, teacher_client: AsyncClient, seed_teacher, seed_tenant, db_session
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Old Name",
            system_prompt="Original prompt.",
        )
        db_session.add(bot)
        await db_session.flush()

        resp = await teacher_client.patch(
            f"{API}/teacherbots/{bot.id}",
            json={"name": "New Name", "temperature": 0.3},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"
        assert resp.json()["temperature"] == 0.3

    async def test_delete_teacherbot(
        self, teacher_client: AsyncClient, seed_teacher, seed_tenant, db_session
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="To Delete",
            system_prompt="Goodbye.",
        )
        db_session.add(bot)
        await db_session.flush()

        resp = await teacher_client.delete(f"{API}/teacherbots/{bot.id}")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Testing a teacherbot (send test message)
# ---------------------------------------------------------------------------


class TestTeacherbotTest:
    async def test_send_test_message(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        db_session,
        mock_llm_service,
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Testable Bot",
            system_prompt="You are a test bot.",
        )
        db_session.add(bot)
        await db_session.flush()

        response_mock = MagicMock()
        response_mock.content = "I am the test bot, how can I help?"
        response_mock.provider = "openai"
        response_mock.model = "gpt-5-mini"
        response_mock.prompt_tokens = 5
        response_mock.completion_tokens = 10
        response_mock.usage = MagicMock(prompt_tokens=5, completion_tokens=10, total_tokens=15)
        mock_llm_service.generate.return_value = response_mock

        resp = await teacher_client.post(
            f"{API}/teacherbots/{bot.id}/test",
            json={"content": "Hello bot!"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "content" in data
        assert len(data["content"]) > 0


# ---------------------------------------------------------------------------
# Publishing a teacherbot to a class
# ---------------------------------------------------------------------------


class TestTeacherbotPublish:
    async def test_publish_to_class(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        seed_class,
        seed_session,
        db_session,
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Publishable Bot",
            system_prompt="You are published.",
            status=TeacherbotStatus.TESTING,
        )
        db_session.add(bot)
        await db_session.flush()

        resp = await teacher_client.post(
            f"{API}/teacherbots/{bot.id}/publish",
            json={"class_id": str(seed_class.id)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["class_id"] == str(seed_class.id)
        assert data["is_active"] is True

    async def test_publish_duplicate_rejected(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        seed_class,
        db_session,
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Dup Bot",
            system_prompt="Prompt",
            status=TeacherbotStatus.TESTING,
        )
        db_session.add(bot)
        await db_session.flush()

        pub = TeacherbotPublication(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacherbot_id=bot.id,
            class_id=seed_class.id,
            published_by_id=seed_teacher.id,
            is_active=True,
        )
        db_session.add(pub)
        await db_session.flush()

        resp = await teacher_client.post(
            f"{API}/teacherbots/{bot.id}/publish",
            json={"class_id": str(seed_class.id)},
        )
        assert resp.status_code in (400, 409)

    async def test_list_publications(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        seed_class,
        db_session,
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Listed Bot",
            system_prompt="Prompt",
        )
        db_session.add(bot)
        await db_session.flush()

        pub = TeacherbotPublication(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacherbot_id=bot.id,
            class_id=seed_class.id,
            published_by_id=seed_teacher.id,
        )
        db_session.add(pub)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{API}/teacherbots/{bot.id}/publications"
        )
        assert resp.status_code == 200
        pubs = resp.json()
        assert len(pubs) >= 1

    async def test_unpublish(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        seed_class,
        db_session,
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Unpublish Bot",
            system_prompt="Prompt",
        )
        db_session.add(bot)
        await db_session.flush()

        pub = TeacherbotPublication(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacherbot_id=bot.id,
            class_id=seed_class.id,
            published_by_id=seed_teacher.id,
        )
        db_session.add(pub)
        await db_session.flush()

        resp = await teacher_client.delete(
            f"{API}/teacherbots/{bot.id}/publications/{pub.id}"
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Session teacherbots (student-facing)
# ---------------------------------------------------------------------------


class TestSessionTeacherbots:
    async def test_list_session_teacherbots(
        self,
        teacher_client: AsyncClient,
        seed_teacher,
        seed_tenant,
        seed_class,
        seed_session,
        db_session,
    ):
        bot = Teacherbot(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Session Bot",
            system_prompt="Prompt",
            status=TeacherbotStatus.PUBLISHED,
        )
        db_session.add(bot)
        await db_session.flush()

        pub = TeacherbotPublication(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacherbot_id=bot.id,
            class_id=seed_class.id,
            published_by_id=seed_teacher.id,
        )
        db_session.add(pub)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{API}/teacher/sessions/{seed_session.id}/teacherbots"
        )
        assert resp.status_code == 200
        bots = resp.json()
        assert any(b["name"] == "Session Bot" for b in bots)
