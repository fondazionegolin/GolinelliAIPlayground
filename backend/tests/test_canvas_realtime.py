from unittest.mock import AsyncMock

import pytest

from app.realtime import gateway


@pytest.mark.asyncio
async def test_canvas_transform_relays_only_valid_bounded_values(monkeypatch):
    user = {
        "id": "teacher-1",
        "type": "teacher",
        "tenant_id": "tenant-1",
    }
    gateway.connected_users["canvas-test-sid"] = user
    access = AsyncMock(return_value=True)
    emit = AsyncMock()
    monkeypatch.setattr(gateway, "can_user_access_session", access)
    monkeypatch.setattr(gateway.sio, "emit", emit)

    try:
        result = await gateway.canvas_item_transform(
            "canvas-test-sid",
            {
                "session_id": "session-1",
                "item_id": "item-1",
                "transform": {"x": 120.5, "y": -10, "w": 50_000, "ignored": "value"},
            },
        )
    finally:
        gateway.connected_users.pop("canvas-test-sid", None)

    assert result == {"success": True}
    access.assert_awaited_once_with(user, "session-1")
    emit.assert_awaited_once_with(
        "canvas_item_transform",
        {
            "session_id": "session-1",
            "item_id": "item-1",
            "user_id": "teacher-1",
            "transform": {"x": 120.5, "y": -10.0, "w": 10_000.0},
        },
        room="session:session-1",
        skip_sid="canvas-test-sid",
    )


@pytest.mark.asyncio
async def test_canvas_transform_rejects_unauthorized_user(monkeypatch):
    user = {"id": "student-1", "type": "student", "session_id": "other-session"}
    gateway.connected_users["canvas-test-sid"] = user
    access = AsyncMock(return_value=False)
    emit = AsyncMock()
    monkeypatch.setattr(gateway, "can_user_access_session", access)
    monkeypatch.setattr(gateway.sio, "emit", emit)

    try:
        result = await gateway.canvas_item_transform(
            "canvas-test-sid",
            {"session_id": "session-1", "item_id": "item-1", "transform": {"x": 1, "y": 2}},
        )
    finally:
        gateway.connected_users.pop("canvas-test-sid", None)

    assert result == {"error": "Forbidden"}
    emit.assert_not_awaited()
