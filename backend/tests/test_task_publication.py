from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.exc import MultipleResultsFound

from app.api.v1.endpoints import teacher as endpoint
from app.models.chat import ChatMessage, ChatRoom
from app.models.task import Task, TaskStatus, TaskType
from app.schemas.session import TaskCreate


@pytest.fixture
def publication(monkeypatch):
    session = SimpleNamespace(id=uuid4(), tenant_id=uuid4(), class_id=uuid4())
    teacher = SimpleNamespace(id=uuid4())
    task = Task(
        id=uuid4(), tenant_id=session.tenant_id, session_id=session.id,
        title="Esercizio generato", task_type=TaskType.EXERCISE,
        status=TaskStatus.DRAFT, created_at=datetime.utcnow(),
    )
    rooms = [ChatRoom(id=uuid4()), ChatRoom(id=uuid4())]
    db = SimpleNamespace(
        execute=AsyncMock(), commit=AsyncMock(), refresh=AsyncMock(),
        flush=AsyncMock(), add=Mock(),
    )

    async def execute(statement):
        model = statement.column_descriptions[0]["entity"]
        if model is Task:
            return SimpleNamespace(scalar_one_or_none=lambda: task)
        assert model is ChatRoom
        # Model the legacy session with two public rooms: an unbounded
        # scalar_one_or_none lookup raises the production error.
        limit = statement.compile().params.get("param_1")
        if len(rooms) > 1 and limit != 1:
            raise MultipleResultsFound()
        return SimpleNamespace(scalar_one_or_none=lambda: rooms[0] if rooms else None)

    db.execute.side_effect = execute

    async def refresh(instance):
        if instance.id is None:
            instance.id = uuid4()
        if instance.created_at is None:
            instance.created_at = datetime.utcnow()

    db.refresh.side_effect = refresh
    monkeypatch.setattr(endpoint, "get_session_with_access_check", AsyncMock(return_value=(session, None)))
    monkeypatch.setattr(endpoint, "_emit_platform_change", AsyncMock())
    monkeypatch.setattr(endpoint.sio, "emit", AsyncMock())
    return session, teacher, task, rooms, db


@pytest.mark.asyncio
@pytest.mark.parametrize("has_room", [True, False])
async def test_publish_task_commits_notification_with_status(publication, has_room):
    session, teacher, task, rooms, db = publication
    if not has_room:
        rooms.clear()

    async def commit():
        notifications = [call.args[0] for call in db.add.call_args_list if isinstance(call.args[0], ChatMessage)]
        assert task.status == TaskStatus.PUBLISHED
        assert len(notifications) == 1
        assert notifications[0].attachments["notification_data"]["task_id"] == str(task.id)
        endpoint.sio.emit.assert_not_awaited()

    db.commit.side_effect = commit
    response = await endpoint.update_task(session.id, task.id, db, teacher, new_status="published")
    assert response["status"] == "published"
    db.commit.assert_awaited_once()
    endpoint.sio.emit.assert_awaited_once()


@pytest.mark.asyncio
async def test_notification_failure_does_not_commit_published_status(publication):
    session, teacher, task, _, db = publication
    db.add.side_effect = RuntimeError("notification storage failed")
    with pytest.raises(RuntimeError, match="notification storage failed"):
        await endpoint.update_task(session.id, task.id, db, teacher, new_status="published")
    db.commit.assert_not_awaited()
    endpoint.sio.emit.assert_not_awaited()


@pytest.mark.asyncio
async def test_auto_publish_document_handles_multiple_public_rooms(publication):
    session, teacher, _, _, db = publication
    response = await endpoint.create_task(
        session.id, TaskCreate(title="Documento", task_type="lesson"), db, teacher,
    )
    assert response["status"] == "published"
    assert any(isinstance(call.args[0], ChatMessage) for call in db.add.call_args_list)
