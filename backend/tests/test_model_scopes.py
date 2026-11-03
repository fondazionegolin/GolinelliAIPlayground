from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import admin_models, agentic, coding
from app.models.ai_model import AIModel
from app.services import agentic_runtime, model_selection


def _db(rows):
    return SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))), commit=AsyncMock())


@pytest.mark.asyncio
async def test_section_choice_must_be_enabled_for_that_section(monkeypatch):
    enabled = SimpleNamespace(provider="openrouter", model_id="qwen/coder")
    monkeypatch.setattr(model_selection, "scoped_models", AsyncMock(return_value=[enabled]))
    monkeypatch.setattr(model_selection, "default_pair", lambda scope: ("anthropic", "claude-default"))
    assert await model_selection.resolve_scoped(None, "notebook", "openrouter", "qwen/coder") == ("openrouter", "qwen/coder")
    assert await model_selection.resolve_scoped(None, "notebook", None, None) == ("anthropic", "claude-default")
    assert await model_selection.resolve_scoped(None, "notebook", "anthropic", "claude-default") == ("anthropic", "claude-default")
    with pytest.raises(HTTPException) as error:
        await model_selection.resolve_scoped(None, "notebook", "openai", "gpt-hidden")
    assert error.value.status_code == 422


@pytest.mark.asyncio
async def test_vibelab_falls_back_to_default_for_disabled_or_legacy_choices(monkeypatch):
    monkeypatch.setattr(model_selection, "scoped_models", AsyncMock(return_value=[SimpleNamespace(provider="deepseek", model_id="deepseek-v4-pro")]))
    monkeypatch.setattr(model_selection, "default_pair", lambda scope: ("x", scope))
    assert await coding._resolve_vibelab_model(None, "deepseek|deepseek-v4-pro", is_student=True) == ("deepseek", "deepseek-v4-pro")
    assert await coding._resolve_vibelab_model(None, "deepseek-pro", is_student=False) == ("deepseek", "deepseek-v4-pro")  # legacy key
    assert await coding._resolve_vibelab_model(None, "openai|gpt-off", is_student=True) == ("x", "vibelab_students")
    assert await coding._resolve_vibelab_model(None, "", is_student=False) == ("x", "vibelab")


@pytest.mark.asyncio
async def test_admin_scope_toggle_keeps_chat_on_offered_and_respects_section_providers(monkeypatch):
    monkeypatch.setattr(admin_models, "_reapply", AsyncMock())
    row = AIModel(id=uuid4(), provider="deepseek", model_id="m", display_name="DS", kind="text", status="available", input_usd=1, output_usd=2, offered=False, scopes=[])
    db = _db([row])
    assert await admin_models._set_scope(db, [row.id], "notebook", True) == {"changed": 1, "skipped": []}
    assert row.scopes == ["notebook"] and row.status == "active" and not row.offered
    assert await admin_models._set_scope(db, [row.id], "chat", True) == {"changed": 1, "skipped": []}
    assert row.offered and row.scopes == ["notebook"]
    # The canvas reads images: only OpenAI / Anthropic models may be enabled there.
    assert await admin_models._set_scope(db, [row.id], "canvas", True) == {"changed": 0, "skipped": ["DS"]}
    assert await admin_models._set_scope(db, [row.id], "notebook", False) == {"changed": 1, "skipped": []}
    assert row.scopes == []
    with pytest.raises(HTTPException):
        await admin_models._set_scope(db, [row.id], "unknown", True)


def test_agentic_nodes_offer_only_enabled_models(monkeypatch):
    monkeypatch.setattr(model_selection, "_cache", {"agentic": [("openrouter", "qwen/q3", "Qwen 3")]})
    models = agentic_runtime.configured_models()
    assert models == [{"provider": "openrouter", "model": "qwen/q3", "name": "Qwen 3"}]
    assert agentic_runtime._pick_model("ai.transform", {"model": "openrouter|qwen/q3"}) == ("openrouter", "qwen/q3")
    with pytest.raises(ValueError):
        agentic_runtime._pick_model("ai.transform", {"model": "openai|gpt-off"})
    node = agentic._with_model_menu({"params": [{"name": "provider"}, {"name": "model", "type": "STRING"}, {"name": "rows"}]}, models)
    assert [p["name"] for p in node["params"]] == ["model", "rows"]
    assert node["params"][0]["type"] == "SELECT" and node["params"][0]["options"] == ["", "openrouter|qwen/q3"]
