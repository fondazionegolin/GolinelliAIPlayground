from unittest.mock import AsyncMock

import pytest

from app.realtime import gateway


@pytest.mark.asyncio
async def test_student_view_state_is_relayed_only_to_observers(monkeypatch):
    sid = "subjective-student-sid"
    gateway.connected_users[sid] = {
        "id": "student-1",
        "type": "student",
        "session_id": "session-1",
    }
    emit = AsyncMock()
    monkeypatch.setattr(gateway.sio, "emit", emit)

    try:
        result = await gateway.student_view_state(
            sid,
            {"module_key": "chatbot", "context": {"prompt": "Sto scrivendo"}},
        )
    finally:
        gateway.connected_users.pop(sid, None)
        gateway.subjective_view_states.pop("student-1", None)

    assert result == {"success": True}
    relayed = emit.await_args.args[1]
    assert relayed["student_id"] == "student-1"
    assert relayed["module_key"] == "chatbot"
    assert relayed["context"] == {"prompt": "Sto scrivendo"}
    assert emit.await_args.kwargs == {"room": "subjective-observer:student-1"}


@pytest.mark.asyncio
async def test_subjective_observer_can_send_bounded_commands(monkeypatch):
    sid = "subjective-observer-sid"
    gateway.connected_users[sid] = {
        "id": "student-1",
        "type": "student",
        "session_id": "session-1",
        "subjective_observer": True,
        "observer_teacher_id": "teacher-1",
    }
    emit = AsyncMock()
    monkeypatch.setattr(gateway.sio, "emit", emit)

    try:
        result = await gateway.subjective_command(
            sid,
            {"module_key": "coding", "context": {"prompt": "x" * 25000}},
        )
    finally:
        gateway.connected_users.pop(sid, None)

    assert result == {"success": True}
    command = emit.await_args.args[1]
    assert command["observer_teacher_id"] == "teacher-1"
    assert len(command["context"]["prompt"]) == 20000
    assert emit.await_args.kwargs == {"room": "subjective-student:student-1"}


@pytest.mark.asyncio
async def test_regular_student_cannot_send_subjective_commands(monkeypatch):
    sid = "regular-student-sid"
    gateway.connected_users[sid] = {
        "id": "student-1",
        "type": "student",
        "session_id": "session-1",
    }
    emit = AsyncMock()
    monkeypatch.setattr(gateway.sio, "emit", emit)

    try:
        result = await gateway.subjective_command(sid, {"module_key": "chatbot"})
    finally:
        gateway.connected_users.pop(sid, None)

    assert result == {"error": "Observer access required"}
    emit.assert_not_awaited()
