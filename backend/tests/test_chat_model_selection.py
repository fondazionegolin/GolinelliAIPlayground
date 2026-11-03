from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import admin_models, llm
from app.models.ai_model import AIModel
from app.services import model_selection


@pytest.mark.asyncio
async def test_chat_menu_never_inserts_unchecked_default_or_hardcoded_providers(monkeypatch):
    monkeypatch.setattr(model_selection, "offered_models", AsyncMock(return_value=[]))
    response = await llm.list_available_models(db=None)
    assert response == {"models": [], "default_provider": None, "default_model": None}


@pytest.mark.asyncio
async def test_menu_default_is_chosen_from_admin_flags(monkeypatch):
    row = AIModel(provider="openrouter", model_id="vendor/chosen", display_name="Chosen", input_usd=2, output_usd=6)
    monkeypatch.setattr(model_selection, "offered_models", AsyncMock(return_value=[row]))
    response = await llm.list_available_models(db=None)
    assert [(m["provider"], m["model"]) for m in response["models"]] == [("openrouter", "vendor/chosen")]
    assert response["default_model"] == "vendor/chosen"


@pytest.mark.asyncio
async def test_teacherbot_choice_must_be_one_of_the_offered_models(monkeypatch):
    monkeypatch.setattr(model_selection, "offered_models", AsyncMock(return_value=[SimpleNamespace(provider="openrouter", model_id="vendor/chosen")]))
    assert await model_selection.validate_selection(None, "openrouter", "vendor/chosen") == ("openrouter", "vendor/chosen")
    assert await model_selection.validate_selection(None, None, None) is None
    for pair in [("openrouter", "vendor/hidden"), ("openai", "vendor/chosen"), (None, "vendor/chosen")]:
        with pytest.raises(HTTPException) as error:
            await model_selection.validate_selection(None, *pair)
        assert error.value.status_code == 422


@pytest.mark.asyncio
async def test_admin_checkbox_activates_priced_discovered_model_and_can_hide_default(monkeypatch):
    from app.core.config import settings

    row = AIModel(id=uuid4(), provider=settings.DEFAULT_LLM_PROVIDER, model_id=settings.DEFAULT_LLM_MODEL,
                  display_name="Model", kind="text", status="available", input_usd=1, output_usd=2, offered=False)
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [row]))), commit=AsyncMock())
    monkeypatch.setattr(admin_models, "_reapply", AsyncMock())
    response = await admin_models.set_offered(admin_models.OfferedBulk(ids=[row.id], offered=True), None, db)
    assert response == {"changed": 1, "skipped": []}
    assert row.status == "active" and row.offered
    response = await admin_models.set_offered(admin_models.OfferedBulk(ids=[row.id], offered=False), None, db)
    assert response == {"changed": 1, "skipped": []} and not row.offered


@pytest.mark.asyncio
async def test_admin_cannot_offer_unpriced_or_deprecated_models(monkeypatch):
    rows = [AIModel(id=uuid4(), display_name="Unpriced", kind="text", status="available", offered=False),
            AIModel(id=uuid4(), display_name="Deprecated", kind="text", status="deprecated", input_usd=1, output_usd=2, offered=False)]
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))), commit=AsyncMock())
    monkeypatch.setattr(admin_models, "_reapply", AsyncMock())
    response = await admin_models.set_offered(admin_models.OfferedBulk(ids=[r.id for r in rows], offered=True), None, db)
    assert response == {"changed": 0, "skipped": ["Unpriced", "Deprecated"]}
    assert not any(row.offered for row in rows)
