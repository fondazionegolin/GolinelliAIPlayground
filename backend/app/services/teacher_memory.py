"""Long-term memory of the teacher chatbot.

Three layers feed every teacher chat, so the assistant stays aligned across conversations:

1. **Memory items** (``teacher_memory_items``): durable facts about the teacher (subjects, preferences, style, ongoing
   projects) distilled by a light LLM after each exchange, or written by the teacher. Visible, editable and deletable by
   the teacher; can be paused entirely.
2. **Activity digest**: computed from the database on every request (sessions the teacher owns *or* co-teaches, live
   activities they created, documents, teacherbots, notebooks), so the assistant knows what the teacher is doing now.
3. **Recent conversations**: titles and the teacher's last request of their latest conversations, for continuity.

The extractor is told never to store student data or secrets, and a regex guard rejects e-mail addresses and phone numbers.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import delete, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.document_draft import DocumentDraft
from app.models.enums import SessionStatus
from app.models.invitation import ClassTeacher, SessionTeacher
from app.models.live_interaction import LiveInteraction
from app.models.llm import TeacherConversation, TeacherConversationMessage
from app.models.notebook import Notebook
from app.models.session import Class as TeacherClass, Session
from app.models.teacher_memory import TeacherMemoryItem, TeacherMemoryPrefs
from app.models.teacherbot import Teacherbot
from app.models.user import User
from app.services import model_roles

logger = logging.getLogger(__name__)

KINDS = ("preference", "style", "subject", "project", "fact")
KIND_LABEL = {"preference": "preferenza", "style": "stile", "subject": "materia", "project": "progetto", "fact": "informazione"}
MAX_ITEMS = 60
MAX_ITEM_CHARS = 220
MIN_USER_CHARS = 25
PII_PATTERN = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+|(?:\+?\d[\s./-]?){9,}")

EXTRACT_PROMPT = """Sei il modulo di memoria di un assistente per docenti. Ricevi l'ultimo scambio tra il docente e l'assistente e la memoria attuale.
Decidi cosa vale la pena ricordare A LUNGO TERMINE SUL DOCENTE, per capirlo meglio nelle conversazioni future:
- materie, livelli/classi che insegna, contesto scolastico
- preferenze di formato, lunghezza, tono, lingua, strumenti
- progetti o percorsi in corso, obiettivi ricorrenti, vincoli

NON memorizzare mai: nomi, voti o giudizi su singoli studenti, dati personali o sensibili, email, telefoni, password o chiavi,
richieste una tantum, né il contenuto dei documenti generati. Se lo scambio non rivela nulla di duraturo, non aggiungere nulla.

Ogni voce: una frase breve in italiano (max 200 caratteri), in terza persona neutra, es. «Insegna matematica in una terza media».
Preferisci AGGIORNARE una voce esistente invece di duplicarla; rimuovi le voci che lo scambio contraddice.
Rispondi SOLO con JSON valido:
{"add":[{"kind":"preference|style|subject|project|fact","text":"..."}],"update":[{"id":"...","text":"..."}],"remove":["id"]}
Liste vuote se non c'è nulla da cambiare."""


# ── preferences ───────────────────────────────────────────────────────────────

async def is_enabled(db: AsyncSession, teacher_id: UUID) -> bool:
    prefs = await db.get(TeacherMemoryPrefs, teacher_id)
    return True if prefs is None else bool(prefs.enabled)


async def set_enabled(db: AsyncSession, teacher_id: UUID, enabled: bool) -> None:
    prefs = await db.get(TeacherMemoryPrefs, teacher_id)
    if prefs:
        prefs.enabled = enabled
    else:
        db.add(TeacherMemoryPrefs(teacher_id=teacher_id, enabled=enabled))
    await db.commit()


def clean_text(text: str) -> str | None:
    value = " ".join((text or "").split())[:MAX_ITEM_CHARS].strip()
    if len(value) < 6 or PII_PATTERN.search(value):
        return None
    return value


# ── reading: what is injected into every chat ────────────────────────────────

async def _activity_digest(db: AsyncSession, teacher: User) -> str:
    lines: list[str] = []
    since = datetime.now(timezone.utc) - timedelta(days=45)
    try:
        co_classes = select(ClassTeacher.class_id).where(ClassTeacher.teacher_id == teacher.id)
        co_sessions = select(SessionTeacher.session_id).where(SessionTeacher.teacher_id == teacher.id)
        rows = (await db.execute(
            select(Session, TeacherClass)
            .join(TeacherClass, TeacherClass.id == Session.class_id)
            .where(or_(TeacherClass.teacher_id == teacher.id, TeacherClass.id.in_(co_classes), Session.id.in_(co_sessions)))
            .where(or_(Session.status != SessionStatus.ENDED, Session.created_at >= since))
            .order_by(desc(Session.created_at)).limit(10)
        )).all()
        session_titles = {}
        for session, klass in rows:
            session_titles[session.id] = session.title
            role = "proprietario" if klass.teacher_id == teacher.id else "co-docente"
            lines.append(f"- Sessione «{session.title}» (classe {klass.name}, {session.status.value}, ruolo: {role})")
        if lines:
            lines.insert(0, "Sessioni:")
    except Exception:
        logger.debug("memory digest: sessions failed", exc_info=True)
        session_titles = {}
    try:
        lives = (await db.execute(
            select(LiveInteraction).where(LiveInteraction.created_by == teacher.id).order_by(desc(LiveInteraction.created_at)).limit(6)
        )).scalars().all()
        if lives:
            lines.append("Attività live create:")
            lines += [f"- «{li.title}» ({li.interaction_type}, {li.status.lower()})" for li in lives]
    except Exception:
        logger.debug("memory digest: live failed", exc_info=True)
    try:
        drafts = (await db.execute(
            select(DocumentDraft).where(DocumentDraft.owner_teacher_id == teacher.id).order_by(desc(DocumentDraft.updated_at)).limit(6)
        )).scalars().all()
        if drafts:
            lines.append("Documenti recenti:")
            lines += [f"- «{d.title}» ({d.doc_type})" for d in drafts]
    except Exception:
        logger.debug("memory digest: documents failed", exc_info=True)
    try:
        bots = (await db.execute(
            select(Teacherbot).where(Teacherbot.teacher_id == teacher.id).order_by(desc(Teacherbot.updated_at)).limit(5)
        )).scalars().all()
        if bots:
            lines.append("Chatbot creati:")
            lines += [f"- «{b.name}»" for b in bots]
    except Exception:
        logger.debug("memory digest: teacherbots failed", exc_info=True)
    try:
        notebooks = (await db.execute(
            select(Notebook).where(Notebook.owner_id == teacher.id).order_by(desc(Notebook.updated_at)).limit(4)
        )).scalars().all()
        if notebooks:
            lines.append("Notebook recenti:")
            lines += [f"- «{n.title}»" for n in notebooks]
    except Exception:
        logger.debug("memory digest: notebooks failed", exc_info=True)
    return "\n".join(lines)


async def _recent_conversations(db: AsyncSession, teacher: User, exclude: UUID | None) -> str:
    try:
        query = select(TeacherConversation).where(TeacherConversation.teacher_id == teacher.id).order_by(desc(TeacherConversation.updated_at)).limit(7)
        conversations = [c for c in (await db.execute(query)).scalars().all() if c.id != exclude][:6]
        lines = []
        for conversation in conversations:
            last = (await db.execute(
                select(TeacherConversationMessage.content)
                .where(TeacherConversationMessage.conversation_id == conversation.id, TeacherConversationMessage.role == "user")
                .order_by(desc(TeacherConversationMessage.created_at)).limit(1)
            )).scalar_one_or_none()
            snippet = " ".join((last or "").split())[:140]
            when = conversation.updated_at.strftime("%d/%m") if conversation.updated_at else ""
            lines.append(f"- [{when}] «{conversation.title or 'Senza titolo'}»" + (f" — ultima richiesta: {snippet}" if snippet else ""))
        return "\n".join(lines)
    except Exception:
        logger.debug("memory digest: conversations failed", exc_info=True)
        return ""


async def render_memory_block(db: AsyncSession, teacher: User, exclude_conversation: UUID | None = None) -> str:
    """Text injected into the teacher chat system context (empty when the teacher paused the memory)."""
    try:
        if not await is_enabled(db, teacher.id):
            return ""
        items = (await db.execute(
            select(TeacherMemoryItem).where(TeacherMemoryItem.teacher_id == teacher.id)
            .order_by(desc(TeacherMemoryItem.pinned), desc(TeacherMemoryItem.updated_at)).limit(40)
        )).scalars().all()
        parts = ["## MEMORIA DEL DOCENTE (cosa sai già di questo docente da conversazioni precedenti e dalla sua attività)"]
        if items:
            parts.append("Informazioni ricordate:")
            parts += [f"- [{KIND_LABEL.get(item.kind, item.kind)}] {item.text}" for item in items]
        activity = await _activity_digest(db, teacher)
        if activity:
            parts.append("\nAttività recente del docente in piattaforma:\n" + activity)
        recent = await _recent_conversations(db, teacher, exclude_conversation)
        if recent:
            parts.append("\nConversazioni recenti con il docente:\n" + recent)
        if len(parts) == 1:
            return ""
        parts.append(
            "\nUsa queste informazioni per capire meglio ciò che il docente vuole e fa: adatta livello, formato e tono, e collega le richieste "
            "alle sue sessioni e ai suoi progetti. Non elencarle né citarle se non servono; se contraddicono la richiesta attuale, vale la richiesta attuale."
        )
        return "\n".join(parts)
    except Exception:
        logger.warning("Teacher memory block failed", exc_info=True)
        return ""


# ── writing: learning from each exchange ─────────────────────────────────────

def _parse_ops(raw: str) -> dict[str, Any]:
    cleaned = (raw or "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        data = json.loads(cleaned[start:end + 1])
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def learn_from_exchange(teacher_id: UUID, tenant_id: UUID, user_text: str, assistant_text: str) -> None:
    """Fire-and-forget: distil durable facts from one exchange. Never raises."""
    try:
        if len((user_text or "").strip()) < MIN_USER_CHARS:
            return
        async with AsyncSessionLocal() as db:
            if not await is_enabled(db, teacher_id):
                return
            items = list((await db.execute(
                select(TeacherMemoryItem).where(TeacherMemoryItem.teacher_id == teacher_id).order_by(desc(TeacherMemoryItem.updated_at)).limit(MAX_ITEMS + 20)
            )).scalars().all())
            by_id = {str(item.id): item for item in items}
            memory = "\n".join(f"{item.id} | {item.kind} | {item.text}{' (fissata dal docente)' if item.pinned else ''}" for item in items) or "(vuota)"
            provider, model = model_roles.pair_for("chat.fast")
            from app.services.llm_service import llm_service
            response = await llm_service.generate(
                messages=[{"role": "user", "content": f"MEMORIA ATTUALE:\n{memory}\n\nDOCENTE:\n{user_text.strip()[:2000]}\n\nASSISTENTE:\n{(assistant_text or '').strip()[:1200]}"}],
                system_prompt=EXTRACT_PROMPT, provider=provider, model=model, temperature=0.0, max_tokens=600,
            )
            ops = _parse_ops(response.content)
            changed = False
            for entry in (ops.get("update") or [])[:5]:
                item = by_id.get(str((entry or {}).get("id")))
                text = clean_text((entry or {}).get("text", ""))
                if item and text and not item.pinned and item.source == "chat":
                    item.text, changed = text, True
            for item_id in (ops.get("remove") or [])[:5]:
                item = by_id.get(str(item_id))
                if item and not item.pinned and item.source == "chat":
                    await db.delete(item)
                    by_id.pop(str(item_id), None)
                    changed = True
            existing_texts = {i.text.lower() for i in by_id.values()}
            for entry in (ops.get("add") or [])[:5]:
                text = clean_text((entry or {}).get("text", ""))
                kind = (entry or {}).get("kind") if (entry or {}).get("kind") in KINDS else "fact"
                if text and text.lower() not in existing_texts:
                    db.add(TeacherMemoryItem(tenant_id=tenant_id, teacher_id=teacher_id, kind=kind, text=text, source="chat"))
                    existing_texts.add(text.lower())
                    changed = True
            if changed:
                await db.flush()
                # Keep the store bounded: drop the oldest unpinned chat-learned items beyond the cap.
                rows = list((await db.execute(
                    select(TeacherMemoryItem).where(TeacherMemoryItem.teacher_id == teacher_id).order_by(desc(TeacherMemoryItem.pinned), desc(TeacherMemoryItem.updated_at))
                )).scalars().all())
                for stale in [r for r in rows[MAX_ITEMS:] if not r.pinned]:
                    await db.delete(stale)
            await _track_cost(db, tenant_id, teacher_id, response)
            await db.commit()
    except Exception:
        logger.warning("Teacher memory learning failed", exc_info=True)


async def _track_cost(db: AsyncSession, tenant_id: UUID, teacher_id: UUID, response: Any) -> None:
    try:
        from app.api.v1.endpoints.llm import safe_track_usage
        from app.services.credit_service import credit_service
        cost = credit_service.calculate_cost_for_model(response.provider, response.model, response.prompt_tokens, response.completion_tokens)
        await safe_track_usage(db, tenant_id, response.provider, response.model, cost,
                               {"prompt_tokens": response.prompt_tokens, "completion_tokens": response.completion_tokens, "type": "teacher_memory"},
                               teacher_id=teacher_id, context="teacher_memory")
    except Exception:
        logger.debug("Teacher memory cost tracking failed", exc_info=True)


async def clear_all(db: AsyncSession, teacher_id: UUID) -> int:
    result = await db.execute(delete(TeacherMemoryItem).where(TeacherMemoryItem.teacher_id == teacher_id))
    await db.commit()
    return result.rowcount or 0
