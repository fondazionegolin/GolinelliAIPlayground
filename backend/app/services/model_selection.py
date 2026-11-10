"""The admin's catalogue flags are the single source for every model menu of the platform.

Chat menus follow ``AIModel.offered``; every other section has a *scope* listed in ``AIModel.scopes``. An empty
choice always means "the model assigned to the section's role" (Admin → Modelli → funzioni), so a section works
even before the admin enables anything for it. Scoped lists are cached in memory and refreshed by the model-roles
loop, so synchronous code paths (workflow nodes) can read them too.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.models.ai_model import AIModel


@dataclass(frozen=True)
class Scope:
    id: str
    label: str
    group: str
    role: str  # model used when the user keeps "Predefinito"
    providers: tuple[str, ...] = ()  # allowed providers; empty = any
    hint: str = ""


SCOPES: dict[str, Scope] = {s.id: s for s in [
    Scope("chat", "Chat", "Chat", "chat.default", hint="Chat docente, chat di sessione e chatbot degli studenti"),
    Scope("vibelab", "Vibe Lab · docenti", "Vibe Lab", "coding.teacher"),
    Scope("vibelab_students", "Vibe Lab · studenti", "Vibe Lab", "coding.student"),
    Scope("models3d", "AI 3D · docenti", "AI 3D", "chat.default"),
    Scope("models3d_students", "AI 3D · studenti", "AI 3D", "chat.default"),
    Scope("notebook", "Coding Lab (Notebook)", "Coding Lab", "chat.fast", hint="Tutor AI dei notebook Python, p5.js, micro:bit"),
    Scope("canvas", "Canvas intelligente", "Canvas", "vision.canvas", providers=("openai", "anthropic"), hint="Serve un modello che legge le immagini"),
    Scope("documents", "Documenti", "Documenti", "presentations.outline", hint="Scaletta del Presentation Studio"),
    Scope("agentic", "Agentic β", "Agentic", "chat.default", hint="Nodi AI dei flussi di lavoro"),
]}

_cache: dict[str, list[tuple[str, str, str]]] = {}


def provider_keys() -> dict[str, bool]:
    return {"openai": bool(settings.OPENAI_API_KEY), "anthropic": bool(settings.ANTHROPIC_API_KEY),
            "deepseek": bool(settings.DEEPSEEK_API_KEY), "openrouter": bool(settings.OPENROUTER_API_KEY),
            "gemini": bool(settings.GEMINI_API_KEY), "ollama": bool(settings.OLLAMA_BASE_URL),
            "elevenlabs": bool(settings.ELEVENLABS_API_KEY), "runware": bool(settings.RUNWARE_API_KEY)}


def _usable(db_rows: list[AIModel], scope: Scope | None = None) -> list[AIModel]:
    ready = provider_keys()
    return [row for row in db_rows if ready.get(row.provider) and (not scope or not scope.providers or row.provider in scope.providers)]


def _base_query():
    return select(AIModel).where(
        AIModel.kind == "text", AIModel.status == "active",
        AIModel.input_usd.isnot(None), AIModel.output_usd.isnot(None),
    ).order_by(AIModel.provider, AIModel.input_usd)


async def offered_models(db) -> list[AIModel]:
    return _usable(list((await db.execute(_base_query().where(AIModel.offered.is_(True)))).scalars().all()))


async def scoped_models(db, scope_id: str) -> list[AIModel]:
    if scope_id == "chat":
        return await offered_models(db)
    scope = SCOPES[scope_id]
    rows = (await db.execute(_base_query().where(AIModel.scopes.contains([scope_id])))).scalars().all()
    return _usable(list(rows), scope)


def default_pair(scope_id: str) -> tuple[str, str]:
    from app.services import model_roles
    return model_roles.pair_for(SCOPES[scope_id].role)


async def resolve_scoped(db, scope_id: str, provider: str | None, model: str | None) -> tuple[str, str]:
    """(provider, model) to use for a request of ``scope_id``: the user's choice if the admin enabled it, else the default."""
    if not provider or not model:
        return default_pair(scope_id)
    if (provider, model) == default_pair(scope_id) or any((row.provider, row.model_id) == (provider, model) for row in await scoped_models(db, scope_id)):
        return provider, model
    raise HTTPException(status_code=422, detail="Modello non disponibile in questa sezione: scegli uno dei modelli abilitati dall'amministratore")


async def validate_selection(db, provider: str | None, model: str | None) -> tuple[str, str] | None:
    if not provider and not model:
        return None
    if not provider or not model:
        raise HTTPException(status_code=422, detail="Specifica sia il provider sia il modello")
    if not any((row.provider, row.model_id) == (provider, model) for row in await offered_models(db)):
        raise HTTPException(status_code=422, detail="Modello non disponibile: scegli uno dei modelli abilitati dall'amministratore")
    return provider, model


async def refresh_cache() -> None:
    from app.core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        for scope_id in SCOPES:
            _cache[scope_id] = [(row.provider, row.model_id, row.display_name) for row in await scoped_models(db, scope_id)]


def cached_scope(scope_id: str) -> list[tuple[str, str, str]]:
    """Last known (provider, model, display name) list of a scope, for synchronous callers."""
    return list(_cache.get(scope_id, []))
