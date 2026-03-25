"""Integration tests for chat endpoints."""

import pytest
from httpx import AsyncClient

from app.core.config import settings

API = settings.API_V1_PREFIX


class TestSessionChat:
    async def test_get_messages_empty(
        self, student_client: AsyncClient, seed_session
    ):
        resp = await student_client.get(
            f"{API}/chat/session/{seed_session.id}/messages"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["messages"] == []
        assert data["has_more"] is False

    async def test_send_and_receive_message(
        self, student_client: AsyncClient, seed_session
    ):
        # Send a message
        send_resp = await student_client.post(
            f"{API}/chat/session/{seed_session.id}/messages",
            json={"text": "Hello class!"},
        )
        assert send_resp.status_code == 200
        msg = send_resp.json()
        assert msg["text"] == "Hello class!"
        assert msg["sender_type"] == "STUDENT"

        # Fetch messages
        get_resp = await student_client.get(
            f"{API}/chat/session/{seed_session.id}/messages"
        )
        assert get_resp.status_code == 200
        messages = get_resp.json()["messages"]
        assert len(messages) == 1
        assert messages[0]["text"] == "Hello class!"

    async def test_teacher_sends_message(
        self, teacher_client: AsyncClient, seed_session
    ):
        resp = await teacher_client.post(
            f"{API}/chat/session/{seed_session.id}/messages",
            json={"text": "Welcome everyone!"},
        )
        assert resp.status_code == 200
        assert resp.json()["sender_type"] == "TEACHER"

    async def test_student_cannot_access_other_session(
        self, student_client: AsyncClient
    ):
        """Student should not access messages for a session they're not in."""
        import uuid

        fake_session_id = uuid.uuid4()
        resp = await student_client.get(
            f"{API}/chat/session/{fake_session_id}/messages"
        )
        assert resp.status_code == 403

    async def test_message_pagination(
        self, student_client: AsyncClient, seed_session
    ):
        # Send several messages
        for i in range(5):
            await student_client.post(
                f"{API}/chat/session/{seed_session.id}/messages",
                json={"text": f"Message {i}"},
            )

        # Fetch with limit
        resp = await student_client.get(
            f"{API}/chat/session/{seed_session.id}/messages",
            params={"limit": 3},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["messages"]) == 3
        assert data["has_more"] is True
