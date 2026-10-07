"""Per-feature model assignment («roles»), editable by the admin without a deploy.

Every place of the platform that used to hard-code a model asks ``model_for("<role>")`` instead. The default of a role is
the value the code used before this registry existed; an admin override (table ``ai_model_roles``) replaces it. Roles
backed by a ``settings`` attribute are applied by updating that attribute, so code that already reads ``settings.X``
at call time follows automatically. Overrides are re-read every 30 s so every API worker converges.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import delete, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)
REFRESH_SECONDS = 30


@dataclass(frozen=True)
class Role:
    id: str
    group: str  # chat | vision | image | voice
    label: str
    description: str
    kind: str  # text | image | realtime | transcribe
    default: tuple[str, str]
    providers: tuple[str, ...] = ()  # allowed providers; empty = any
    provider_attr: Optional[str] = None  # settings attribute mirrored from the override
    model_attr: Optional[str] = None
    where: tuple[str, ...] = field(default_factory=tuple)


ROLES: dict[str, Role] = {r.id: r for r in [
    Role("chat.default", "chat", "Chatbot predefinito",
         "Modello di partenza di chat di sessione, chatbot docente, agenti e classificazione delle intenzioni.", "text",
         (settings.DEFAULT_LLM_PROVIDER, settings.DEFAULT_LLM_MODEL), provider_attr="DEFAULT_LLM_PROVIDER", model_attr="DEFAULT_LLM_MODEL",
         where=("Chat di sessione", "Chatbot docente", "Agente docente")),
    Role("chat.fast", "chat", "Assistente veloce", "Risposte rapide ed economiche: tutor dei Notebook, Turing, controlli di formato.", "text",
         ("anthropic", "claude-haiku-4-5-20251001"), where=("Notebook", "Esperimenti Turing")),
    Role("chat.light", "chat", "Elaborazioni leggere", "Ricerca nei documenti (RAG), riformulazione di query, agente di matematica.", "text",
         ("openai", "gpt-4o-mini"), providers=("openai",), where=("RAG", "Agente di matematica")),
    Role("desktop.assistant", "chat", "Assistente del desktop", "Interazioni di interfaccia del desktop (chiamata diretta all'SDK Anthropic).", "text",
         ("anthropic", "claude-haiku-4-5-20251001"), providers=("anthropic",), where=("Desktop",)),
    Role("codegen.tools", "chat", "Generazione con strumenti", "Generazioni che usano tool-calling (SDK Anthropic): modelli e contenuti strutturati.", "text",
         ("anthropic", "claude-sonnet-4-6"), providers=("anthropic",), where=("Generazione contenuti",)),
    Role("coding.teacher", "chat", "Vibe Lab · docenti", "Generazione di codice e interfacce per i docenti.", "text",
         (settings.CODING_LLM_PROVIDER, settings.CODING_LLM_MODEL), provider_attr="CODING_LLM_PROVIDER", model_attr="CODING_LLM_MODEL", where=("Vibe Lab",)),
    Role("coding.student", "chat", "Vibe Lab · studenti", "Modello predefinito del Vibe Lab per gli studenti (oggi limitati a DeepSeek).", "text",
         ("deepseek", "deepseek-v4-flash"), where=("Vibe Lab",)),
    Role("vision", "vision", "Analisi di immagini e documenti", "Descrizione di immagini, lettura di pagine di PDF, revisione visiva delle anteprime.", "text",
         ("openai", "gpt-4o"), providers=("openai",), where=("Documenti", "Vibe Lab", "Chatbot docente")),
    Role("image.generation", "image", "Generazione di immagini", "Generatore di immagini di piattaforma (anche nei flussi agentici).", "image",
         ("openai", settings.OPENAI_IMAGE_MODEL), providers=("openai",), model_attr="OPENAI_IMAGE_MODEL", where=("Immagini AI", "Flussi agentici")),
    Role("realtime.voice", "voice", "Voce in tempo reale · interrogazione", "Chatbot vocale dell'interrogazione (WebRTC).", "realtime",
         ("openai", settings.OPENAI_REALTIME_MODEL), providers=("openai",), model_attr="OPENAI_REALTIME_MODEL", where=("Interrogazione vocale",)),
    Role("realtime.inquiry", "voice", "Voce in tempo reale · indagine", "Intervista agli NPC nella modalità indagine dei teacherbot.", "realtime",
         ("openai", settings.OPENAI_REALTIME_INQUIRY_MODEL), providers=("openai",), model_attr="OPENAI_REALTIME_INQUIRY_MODEL", where=("Teacherbot",)),
    Role("realtime.transcribe", "voice", "Trascrizione in tempo reale", "Trascrizione del parlato durante le sessioni vocali.", "transcribe",
         ("openai", settings.OPENAI_REALTIME_TRANSCRIBE_MODEL), providers=("openai",), model_attr="OPENAI_REALTIME_TRANSCRIBE_MODEL", where=("Interrogazione vocale",)),
    Role("stt.whisper", "voice", "Dettatura e trascrizione di file", "Trascrizione di registrazioni audio caricate e dettatura vocale.", "transcribe",
         ("openai", "whisper-1"), providers=("openai",), where=("Dettatura", "Teacherbot")),
]}

# Not editable here: changing them needs a data migration or a code path of their own.
FIXED_MODELS = [
    {"label": "Embedding documenti", "model": settings.EMBEDDING_MODEL, "reason": "Cambiarlo richiede di rigenerare tutti gli indici dei documenti."},
    {"label": "Modelli 3D", "model": "Meshy (text/image-to-3D)", "reason": "Servizio a crediti Meshy, scelto nell'editor 3D."},
    {"label": "Selettore Gemini", "model": "gemini-3.8-flash", "reason": "Voce del selettore modelli, attiva solo con la chiave Gemini."},
]

_overrides: dict[str, tuple[str, str]] = {}


def role_ids() -> list[str]:
    return list(ROLES)


def default_of(role: str) -> tuple[str, str]:
    return ROLES[role].default


def pair_for(role: str) -> tuple[str, str]:
    """(provider, model) currently assigned to ``role``."""
    return _overrides.get(role) or ROLES[role].default


def provider_for(role: str) -> str:
    return pair_for(role)[0]


def model_for(role: str) -> str:
    return pair_for(role)[1]


def is_overridden(role: str) -> bool:
    return role in _overrides


def _mirror_to_settings(role: Role) -> None:
    provider, model = pair_for(role.id)
    if role.provider_attr:
        setattr(settings, role.provider_attr, provider)
    if role.model_attr:
        setattr(settings, role.model_attr, model)


def set_local(role: str, provider: str, model: str) -> None:
    _overrides[role] = (provider, model)
    _mirror_to_settings(ROLES[role])


def clear_local(role: str) -> None:
    _overrides.pop(role, None)
    _mirror_to_settings(ROLES[role])


async def load_overrides() -> None:
    """Sync the in-memory assignment with the database (startup and periodic refresh)."""
    async with AsyncSessionLocal() as db:
        from app.models.ai_model import AIModelRole
        rows = {row.role: (row.provider, row.model_id) for row in (await db.execute(select(AIModelRole))).scalars().all() if row.role in ROLES}
    for role_id in ROLES:
        if role_id in rows:
            if _overrides.get(role_id) != rows[role_id]:
                set_local(role_id, *rows[role_id])
        elif role_id in _overrides:
            clear_local(role_id)


async def save_override(role: str, provider: str, model: str, admin: str) -> None:
    from app.models.ai_model import AIModelRole
    async with AsyncSessionLocal() as db:
        row = await db.get(AIModelRole, role)
        if row:
            row.provider, row.model_id, row.updated_by = provider, model, admin
        else:
            db.add(AIModelRole(role=role, provider=provider, model_id=model, updated_by=admin))
        await db.commit()
    set_local(role, provider, model)


async def reset_override(role: str) -> None:
    from app.models.ai_model import AIModelRole
    async with AsyncSessionLocal() as db:
        await db.execute(delete(AIModelRole).where(AIModelRole.role == role))
        await db.commit()
    clear_local(role)


async def refresh_loop() -> None:
    while True:
        try:
            await load_overrides()
        except Exception:
            logger.warning("Model roles refresh failed", exc_info=True)
        await asyncio.sleep(REFRESH_SECONDS)
