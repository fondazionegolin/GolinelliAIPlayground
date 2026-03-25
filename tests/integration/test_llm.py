"""Integration tests for LLM endpoints — conversations, chatbot profiles, messaging."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.llm import Conversation, ConversationMessage
from app.models.enums import MessageRole

API = settings.API_V1_PREFIX


# ---------------------------------------------------------------------------
# Chatbot profiles & available models (public)
# ---------------------------------------------------------------------------


class TestChatbotProfiles:
    async def test_list_chatbot_profiles(self, client: AsyncClient):
        resp = await client.get(f"{API}/llm/chatbot-profiles")
        assert resp.status_code == 200
        profiles = resp.json()
        assert isinstance(profiles, dict)
        assert len(profiles) > 0

    async def test_list_available_models(self, client: AsyncClient):
        resp = await client.get(f"{API}/llm/available-models")
        assert resp.status_code == 200
        data = resp.json()
        assert "models" in data
        assert "default_provider" in data
        assert "default_model" in data


# ---------------------------------------------------------------------------
# Conversation CRUD
# ---------------------------------------------------------------------------


class TestConversationCRUD:
    async def test_create_conversation(
        self, student_client: AsyncClient, seed_session, seed_student
    ):
        resp = await student_client.post(
            f"{API}/llm/conversations",
            json={
                "session_id": str(seed_session.id),
                "profile_key": "tutor",
                "title": "Math Help",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["profile_key"] == "tutor"
        assert data["title"] == "Math Help"
        assert data["student_id"] == str(seed_student.id)

    async def test_create_conversation_wrong_session(
        self, student_client: AsyncClient, seed_tenant, seed_teacher, db_session
    ):
        """Student cannot create conversation for a session they're not in."""
        from app.models.session import Session, Class
        from app.core.security import generate_join_code

        other_class = Class(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            teacher_id=seed_teacher.id,
            name="Other Class",
        )
        db_session.add(other_class)
        await db_session.flush()

        other_session = Session(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            class_id=other_class.id,
            title="Other Session",
            join_code=generate_join_code(),
            status="active",
        )
        db_session.add(other_session)
        await db_session.flush()

        resp = await student_client.post(
            f"{API}/llm/conversations",
            json={
                "session_id": str(other_session.id),
                "profile_key": "tutor",
            },
        )
        assert resp.status_code == 403

    async def test_list_conversations_student(
        self, student_client: AsyncClient, seed_session, seed_student, seed_tenant, db_session
    ):
        """Student sees only their own conversations."""
        conv = Conversation(
            tenant_id=seed_tenant.id,
            session_id=seed_session.id,
            student_id=seed_student.id,
            profile_key="tutor",
            title="My Conv",
        )
        db_session.add(conv)
        await db_session.flush()

        resp = await student_client.get(f"{API}/llm/conversations")
        assert resp.status_code == 200
        convs = resp.json()
        assert any(c["id"] == str(conv.id) for c in convs)

    async def test_list_conversations_teacher(
        self, teacher_client: AsyncClient, seed_session, seed_student, seed_tenant, db_session
    ):
        """Teacher can list conversations for a session."""
        conv = Conversation(
            tenant_id=seed_tenant.id,
            session_id=seed_session.id,
            student_id=seed_student.id,
            profile_key="tutor",
            title="Student Conv",
        )
        db_session.add(conv)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{API}/llm/conversations",
            params={"session_id": str(seed_session.id)},
        )
        assert resp.status_code == 200

    async def test_delete_conversation(
        self, student_client: AsyncClient, seed_session, seed_student, seed_tenant, db_session
    ):
        conv = Conversation(
            tenant_id=seed_tenant.id,
            session_id=seed_session.id,
            student_id=seed_student.id,
            profile_key="tutor",
            title="To Delete",
        )
        db_session.add(conv)
        await db_session.flush()

        resp = await student_client.delete(f"{API}/llm/conversations/{conv.id}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

    async def test_delete_all_session_conversations(
        self, student_client: AsyncClient, seed_session, seed_student, seed_tenant, db_session
    ):
        for i in range(3):
            db_session.add(Conversation(
                tenant_id=seed_tenant.id,
                session_id=seed_session.id,
                student_id=seed_student.id,
                profile_key="tutor",
                title=f"Conv {i}",
            ))
        await db_session.flush()

        resp = await student_client.delete(
            f"{API}/llm/sessions/{seed_session.id}/conversations"
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 3


# ---------------------------------------------------------------------------
# Messaging — student talks to AI
# ---------------------------------------------------------------------------


class TestLLMMessaging:
    async def _create_conversation(self, client, session_id):
        resp = await client.post(
            f"{API}/llm/conversations",
            json={"session_id": str(session_id), "profile_key": "tutor"},
        )
        assert resp.status_code == 200
        return resp.json()

    async def test_send_message_and_get_ai_response(
        self, student_client: AsyncClient, seed_session
    ):
        """Student sends a message and gets a mocked AI response."""
        conv = await self._create_conversation(student_client, seed_session.id)

        resp = await student_client.post(
            f"{API}/llm/conversations/{conv['id']}/message",
            json={"content": "What is photosynthesis?"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "assistant"
        assert len(data["content"]) > 0

    async def test_get_conversation_messages(
        self, student_client: AsyncClient, seed_session
    ):
        conv = await self._create_conversation(student_client, seed_session.id)

        # Send a message first
        await student_client.post(
            f"{API}/llm/conversations/{conv['id']}/message",
            json={"content": "Hello AI"},
        )

        resp = await student_client.get(
            f"{API}/llm/conversations/{conv['id']}/messages"
        )
        assert resp.status_code == 200
        messages = resp.json()
        # Should have at least user + assistant messages
        assert len(messages) >= 2
        roles = [m["role"] for m in messages]
        assert "user" in roles
        assert "assistant" in roles

    async def test_send_message_nonexistent_conversation(
        self, student_client: AsyncClient
    ):
        fake_id = uuid.uuid4()
        resp = await student_client.post(
            f"{API}/llm/conversations/{fake_id}/message",
            json={"content": "Hello"},
        )
        assert resp.status_code == 404

    async def test_teacher_can_view_student_messages(
        self, teacher_client: AsyncClient, seed_session, seed_student, seed_tenant, db_session
    ):
        """Teacher can view conversation messages for their session's students."""
        conv = Conversation(
            tenant_id=seed_tenant.id,
            session_id=seed_session.id,
            student_id=seed_student.id,
            profile_key="tutor",
            title="Viewable by teacher",
        )
        db_session.add(conv)
        await db_session.flush()

        msg = ConversationMessage(
            tenant_id=seed_tenant.id,
            conversation_id=conv.id,
            role=MessageRole.USER,
            content="Student question",
        )
        db_session.add(msg)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{API}/llm/conversations/{conv.id}/messages"
        )
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    async def test_session_conversations_detailed_teacher(
        self, teacher_client: AsyncClient, seed_session, seed_student, seed_tenant, db_session
    ):
        """Teacher gets detailed conversation list for a session."""
        conv = Conversation(
            tenant_id=seed_tenant.id,
            session_id=seed_session.id,
            student_id=seed_student.id,
            profile_key="tutor",
            title="Detailed view",
        )
        db_session.add(conv)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{API}/llm/sessions/{seed_session.id}/conversations"
        )
        assert resp.status_code == 200
        convs = resp.json()
        assert len(convs) >= 1
        assert convs[0]["student_nickname"] == "TestStudent"
