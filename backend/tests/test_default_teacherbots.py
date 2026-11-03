from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import admin_chatbots, teacherbots
from app.services import default_teacherbots


def bot():
    return SimpleNamespace(id=uuid4(), tenant_id=uuid4(), teacher_id=uuid4(), creator_student_id=None, name="Starter", synopsis="Tutor",
        description="Teacherbot iniziale", icon="bot", color="indigo", is_proactive=False, proactive_message=None,
        enable_live_voice=False, enable_inquiry=False, enable_escape_room=False, system_prompt="Private instructions")


@pytest.mark.asyncio
async def test_admin_cannot_add_someone_elses_teacherbot(monkeypatch):
    monkeypatch.setattr(default_teacherbots, "settings", AsyncMock(return_value={"student": [], "teacher": []}))
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))))
    with pytest.raises(HTTPException) as exc:
        await admin_chatbots.set_teacherbot_defaults(admin_chatbots.DefaultTeacherbotsUpdate(student=[uuid4()]), SimpleNamespace(id=uuid4()), db)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_global_bots_appear_once_before_class_publications(monkeypatch):
    starter, published = bot(), bot()
    student = SimpleNamespace(id=uuid4(), tenant_id=uuid4(), session_id=uuid4())
    responses = [SimpleNamespace(scalar_one=lambda: SimpleNamespace(class_id=uuid4())),
                 SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [starter, published])),
                 SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))]
    db = SimpleNamespace(execute=AsyncMock(side_effect=responses))
    monkeypatch.setattr(default_teacherbots, "list_bots", AsyncMock(return_value=[starter]))
    result = await teacherbots.list_available_teacherbots(db, student)
    assert [item.id for item in result] == [starter.id, published.id]


@pytest.mark.asyncio
async def test_teacher_chat_metadata_shares_no_prompt_or_owner_information(monkeypatch):
    starter = bot()
    db = SimpleNamespace(scalar=AsyncMock(return_value=None))
    monkeypatch.setattr(default_teacherbots, "list_bots", AsyncMock(return_value=[starter]))
    info = await teacherbots.teacherbot_chat_info(starter.id, db, SimpleNamespace(id=uuid4()))
    assert info["name"] == starter.name
    assert "system_prompt" not in info and "tenant_id" not in info and "teacher_id" not in info


@pytest.mark.asyncio
async def test_shared_default_configuration_cannot_be_overridden_by_teacher(monkeypatch):
    starter = bot()
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: None)))
    monkeypatch.setattr(default_teacherbots, "list_bots", AsyncMock(return_value=[starter]))
    with pytest.raises(HTTPException) as exc:
        await teacherbots.test_teacherbot(starter.id, teacherbots.TeacherbotTestMessage(content="Ciao", system_prompt="Changed"), None, db, SimpleNamespace(id=uuid4()))
    assert exc.value.status_code == 422
