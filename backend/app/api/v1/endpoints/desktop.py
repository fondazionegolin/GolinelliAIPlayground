from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, List, Optional, Any
from uuid import UUID
from pydantic import BaseModel
import uuid
import json
import logging

from app.core.database import get_db
from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.models.desktop import UserDesktop, DesktopWidget, AdminDesktopWidgetTemplate
from app.models.calendar import SessionCalendarEvent
from app.models.session import Session as SessionModel
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_DESKTOPS = 10


# ── Helpers ──────────────────────────────────────────────────────────────────

def _owner_filter(actor: StudentOrTeacher):
    """Return (teacher_id, student_id, tenant_id) for ownership queries."""
    if actor.is_teacher:
        return actor.teacher.id, None, actor.teacher.tenant_id
    return None, actor.student.id, actor.student.tenant_id


def _desktop_to_dict(d: UserDesktop) -> dict:
    return {
        "id": str(d.id),
        "title": d.title,
        "wallpaper_key": d.wallpaper_key,
        "sort_order": d.sort_order,
        "created_at": d.created_at.isoformat(),
        "updated_at": d.updated_at.isoformat(),
    }


def _widget_to_dict(w: DesktopWidget) -> dict:
    return {
        "id": str(w.id),
        "desktop_id": str(w.desktop_id),
        "widget_type": w.widget_type,
        "grid_x": w.grid_x,
        "grid_y": w.grid_y,
        "grid_w": w.grid_w,
        "grid_h": w.grid_h,
        "config_json": w.config_json,
        "source_template_id": str(w.source_template_id) if w.source_template_id else None,
        "is_locked": bool(w.is_locked),
        "created_at": w.created_at.isoformat(),
        "updated_at": w.updated_at.isoformat(),
    }


def _template_audiences(actor: StudentOrTeacher) -> list[str]:
    return ["all", "teacher"] if actor.is_teacher else ["all", "student"]


async def _sync_admin_templates(
    actor: StudentOrTeacher,
    desktops: list[UserDesktop],
    db: AsyncSession,
) -> None:
    if not desktops:
        return

    _, _, tenant_id = _owner_filter(actor)
    template_result = await db.execute(
        select(AdminDesktopWidgetTemplate)
        .where(
            AdminDesktopWidgetTemplate.tenant_id == tenant_id,
            AdminDesktopWidgetTemplate.is_active == True,
            AdminDesktopWidgetTemplate.audience.in_(_template_audiences(actor)),
        )
        .order_by(
            AdminDesktopWidgetTemplate.target_desktop_index.asc(),
            AdminDesktopWidgetTemplate.created_at.asc(),
        )
    )
    templates = template_result.scalars().all()

    desktop_by_index = {idx: desktop for idx, desktop in enumerate(desktops)}
    desktop_ids = [desktop.id for desktop in desktops]
    existing_result = await db.execute(
        select(DesktopWidget).where(
            DesktopWidget.desktop_id.in_(desktop_ids),
            DesktopWidget.source_template_id.is_not(None),
        )
    )
    existing_widgets = existing_result.scalars().all()
    existing_by_template: dict[UUID, DesktopWidget] = {
        widget.source_template_id: widget
        for widget in existing_widgets
        if widget.source_template_id
    }
    active_template_ids = {template.id for template in templates}
    dirty = False

    for widget in existing_widgets:
        if widget.source_template_id not in active_template_ids:
            await db.delete(widget)
            dirty = True

    for template in templates:
        target_desktop = desktop_by_index.get(template.target_desktop_index)
        if not target_desktop:
            continue
        existing = existing_by_template.get(template.id)
        payload = {
            "widget_type": template.widget_type,
            "grid_x": template.grid_x,
            "grid_y": template.grid_y,
            "grid_w": template.grid_w,
            "grid_h": template.grid_h,
            "config_json": template.config_json or {},
            "is_locked": True,
        }
        if not existing:
            db.add(
                DesktopWidget(
                    tenant_id=tenant_id,
                    desktop_id=target_desktop.id,
                    source_template_id=template.id,
                    **payload,
                )
            )
            dirty = True
            continue

        if existing.desktop_id != target_desktop.id:
            existing.desktop_id = target_desktop.id
            dirty = True
        for field, value in payload.items():
            if getattr(existing, field) != value:
                setattr(existing, field, value)
                dirty = True

    if dirty:
        await db.flush()


async def _get_desktop_or_404(
    desktop_id: UUID,
    actor: StudentOrTeacher,
    db: AsyncSession,
) -> UserDesktop:
    teacher_id, student_id, _ = _owner_filter(actor)
    result = await db.execute(select(UserDesktop).where(UserDesktop.id == desktop_id))
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")
    if teacher_id and desktop.owner_teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if student_id and desktop.owner_student_id != student_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return desktop


# ── Desktop CRUD ─────────────────────────────────────────────────────────────

@router.get("/desktop", response_model=List[dict])
async def list_desktops(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    teacher_id, student_id, _ = _owner_filter(actor)
    if teacher_id:
        q = select(UserDesktop).where(UserDesktop.owner_teacher_id == teacher_id)
    else:
        q = select(UserDesktop).where(UserDesktop.owner_student_id == student_id)
    result = await db.execute(q.order_by(UserDesktop.sort_order))
    desktops = result.scalars().all()

    # Auto-create default desktop on first access
    if not desktops:
        teacher_id2, student_id2, tenant_id = _owner_filter(actor)
        desktop = UserDesktop(
            tenant_id=tenant_id,
            owner_teacher_id=teacher_id2,
            owner_student_id=student_id2,
            title="Desktop",
            sort_order=0,
        )
        db.add(desktop)
        await db.flush()  # get desktop.id before creating widgets

        # For students: pre-populate with useful default widgets
        if actor.is_student:
            session_id = str(actor.student.session_id)
            default_widgets = [
                DesktopWidget(
                    tenant_id=tenant_id,
                    desktop_id=desktop.id,
                    widget_type="WEEKLY_CALENDAR",
                    grid_x=0, grid_y=0, grid_w=24, grid_h=6,
                    config_json={"session_id": session_id},
                ),
                DesktopWidget(
                    tenant_id=tenant_id,
                    desktop_id=desktop.id,
                    widget_type="CLOCK",
                    grid_x=0, grid_y=6, grid_w=6, grid_h=3,
                    config_json={"style": "digital", "show_seconds": True, "show_date": True},
                ),
                DesktopWidget(
                    tenant_id=tenant_id,
                    desktop_id=desktop.id,
                    widget_type="NOTE",
                    grid_x=6, grid_y=6, grid_w=6, grid_h=4,
                    config_json={"text": "", "color": "#fef08a"},
                ),
            ]
            for w in default_widgets:
                db.add(w)

        await db.commit()
        await db.refresh(desktop)
        desktops = [desktop]

    await _sync_admin_templates(actor, desktops, db)
    await db.commit()

    # Attach widgets
    desktop_ids = [d.id for d in desktops]
    w_result = await db.execute(
        select(DesktopWidget).where(DesktopWidget.desktop_id.in_(desktop_ids))
    )
    widgets = w_result.scalars().all()
    widgets_by_desktop: dict = {}
    for w in widgets:
        widgets_by_desktop.setdefault(str(w.desktop_id), []).append(_widget_to_dict(w))

    return [
        {**_desktop_to_dict(d), "widgets": widgets_by_desktop.get(str(d.id), [])}
        for d in desktops
    ]


@router.post("/desktop", response_model=dict, status_code=201)
async def create_desktop(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    teacher_id, student_id, tenant_id = _owner_filter(actor)
    if teacher_id:
        count_q = select(UserDesktop).where(UserDesktop.owner_teacher_id == teacher_id)
    else:
        count_q = select(UserDesktop).where(UserDesktop.owner_student_id == student_id)
    result = await db.execute(count_q)
    existing = result.scalars().all()
    if len(existing) >= MAX_DESKTOPS:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_DESKTOPS} desktops allowed")

    desktop = UserDesktop(
        tenant_id=tenant_id,
        owner_teacher_id=teacher_id,
        owner_student_id=student_id,
        title=request.get("title", f"Desktop {len(existing) + 1}"),
        wallpaper_key=request.get("wallpaper_key", "solid_neutral"),
        sort_order=len(existing),
    )
    db.add(desktop)
    await db.commit()
    await db.refresh(desktop)
    return {**_desktop_to_dict(desktop), "widgets": []}


@router.patch("/desktop/{desktop_id}", response_model=dict)
async def update_desktop(
    desktop_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    desktop = await _get_desktop_or_404(desktop_id, actor, db)
    if "title" in request:
        desktop.title = str(request["title"])[:100]
    if "wallpaper_key" in request:
        desktop.wallpaper_key = str(request["wallpaper_key"])[:200]
    await db.commit()
    await db.refresh(desktop)
    return _desktop_to_dict(desktop)


@router.delete("/desktop/{desktop_id}", status_code=204)
async def delete_desktop(
    desktop_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    desktop = await _get_desktop_or_404(desktop_id, actor, db)
    teacher_id, student_id, _ = _owner_filter(actor)
    if teacher_id:
        count_q = select(UserDesktop).where(UserDesktop.owner_teacher_id == teacher_id)
    else:
        count_q = select(UserDesktop).where(UserDesktop.owner_student_id == student_id)
    result = await db.execute(count_q)
    if len(result.scalars().all()) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last desktop")
    await db.delete(desktop)
    await db.commit()


@router.patch("/desktop/reorder", response_model=List[dict])
async def reorder_desktops(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """request body: {"ids": ["uuid1", "uuid2", ...]} in new order"""
    ids: List[str] = request.get("ids", [])
    teacher_id, student_id, _ = _owner_filter(actor)
    for i, did in enumerate(ids):
        result = await db.execute(select(UserDesktop).where(UserDesktop.id == uuid.UUID(did)))
        desktop = result.scalar_one_or_none()
        if not desktop:
            continue
        if teacher_id and desktop.owner_teacher_id != teacher_id:
            continue
        if student_id and desktop.owner_student_id != student_id:
            continue
        desktop.sort_order = i
    await db.commit()
    return await list_desktops(db=db, actor=actor)


# ── Widget CRUD ───────────────────────────────────────────────────────────────

@router.post("/desktop/{desktop_id}/widgets", response_model=dict, status_code=201)
async def add_widget(
    desktop_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    desktop = await _get_desktop_or_404(desktop_id, actor, db)
    _, _, tenant_id = _owner_filter(actor)
    widget = DesktopWidget(
        tenant_id=tenant_id,
        desktop_id=desktop.id,
        widget_type=request.get("widget_type", "NOTE"),
        grid_x=request.get("grid_x", 0),
        grid_y=request.get("grid_y", 0),
        grid_w=request.get("grid_w", 4),
        grid_h=request.get("grid_h", 3),
        config_json=request.get("config_json", {}),
    )
    db.add(widget)
    await db.commit()
    await db.refresh(widget)
    return _widget_to_dict(widget)


@router.patch("/desktop/{desktop_id}/widgets/{widget_id}", response_model=dict)
async def update_widget(
    desktop_id: UUID,
    widget_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _get_desktop_or_404(desktop_id, actor, db)
    result = await db.execute(
        select(DesktopWidget).where(
            DesktopWidget.id == widget_id,
            DesktopWidget.desktop_id == desktop_id,
        )
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")
    if widget.is_locked:
        raise HTTPException(status_code=403, detail="This widget is managed by the platform admin")

    for field in ("grid_x", "grid_y", "grid_w", "grid_h"):
        if field in request:
            setattr(widget, field, int(request[field]))
    if "config_json" in request:
        widget.config_json = request["config_json"]

    await db.commit()
    await db.refresh(widget)
    return _widget_to_dict(widget)


@router.delete("/desktop/{desktop_id}/widgets/{widget_id}", status_code=204)
async def delete_widget(
    desktop_id: UUID,
    widget_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _get_desktop_or_404(desktop_id, actor, db)
    result = await db.execute(
        select(DesktopWidget).where(
            DesktopWidget.id == widget_id,
            DesktopWidget.desktop_id == desktop_id,
        )
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")
    if widget.is_locked:
        raise HTTPException(status_code=403, detail="This widget is managed by the platform admin")
    await db.delete(widget)
    await db.commit()


# ── Desktop Agent ─────────────────────────────────────────────────────────────

WIDGET_REGISTRY_PROMPT = """
### NOTE — Post-it colorato
Nota libera con testo. Config: {text: string, color: "#fef08a"|"#bfdbfe"|"#bbf7d0"|"#fecaca"|"#e9d5ff"|qualsiasi hex}. Default: 4×4.

### TASKLIST — Lista compiti
Lista checkbox. Config: {title: string, items: [{text: string, done: boolean}]}. Default: 5×5.

### CLOCK — Orologio
Orologio digitale. Config: {show_seconds: boolean, show_date: boolean}. Default: 6×3.

### CALENDAR — Calendario mensile personale
Note personali per giorno. Config: {notes: {"YYYY-MM-DD": "testo"}}. Default: 6×5.
NOTA: usa questo per eventi/appuntamenti personali degli studenti.

### WEEKLY_CALENDAR — Calendario sessione (solo se session_id presente)
Calendario settimanale condiviso. Config: {session_id: string}. Default: 24×6.

La griglia ha 24 colonne. rowHeight ≈ 40px. Posizioni: grid_x, grid_y, grid_w, grid_h.
"""

AGENT_SYSTEM_PROMPT = """Sei l'assistente AI del desktop personale di {user_name} ({user_role}).
Il desktop è privato e personale. Il tuo obiettivo è aiutare l'utente a personalizzare e organizzare il suo spazio di lavoro.

STATO ATTUALE DEL DESKTOP:
{desktop_state}

EVENTI CALENDARIO (settimana corrente):
{calendar_state}

INFO SESSIONE:
{session_info}

WIDGET DISPONIBILI:
{widget_registry}

SFONDI: qualsiasi colore esadecimale (es. #1a1a2e, #0f172a, #1e3a2f) o data URL di un'immagine compressa.

REGOLE:
- Rispondi SEMPRE in italiano, in modo naturale e amichevole
- Sei INTERATTIVO: proponi sempre le azioni e chiedi conferma PRIMA di eseguire
- Se l'utente conferma o dice "sì / vai / fallo", esegui senza chiedere di nuovo
- Per operazioni complesse o non supportate (es. widget meteo, crypto), spiega gentilmente i limiti e suggerisci alternative
- NON puoi eliminare widget o eventi — solo creare e modificare
- Gli studenti possono creare widget personali e note nel calendario personale (CALENDAR widget)
- I docenti possono creare eventi nella sessione attiva (WEEKLY_CALENDAR / session events)
- Se non c'è sessione attiva, non proporre WEEKLY_CALENDAR
- Per i post-it, scegli colori appropriati al contesto (studio=giallo, importante=rosso, ecc.)
- Quando proponi azioni, elencale chiaramente all'utente

Rispondi con JSON valido nel seguente formato:
{{
  "reply": "messaggio conversazionale all'utente (markdown ok)",
  "actions": [
    // lista vuota se solo rispondi senza fare nulla
    // oppure lista di azioni da eseguire
  ],
  "requires_confirmation": true/false
}}

Formato azioni:
- Crea widget: {{"type": "create_widget", "widget_type": "NOTE", "config": {{}}, "grid_w": 4, "grid_h": 4}}
- Modifica widget: {{"type": "update_widget", "widget_id": "uuid", "config": {{}}}}
- Cambia sfondo: {{"type": "update_wallpaper", "wallpaper_key": "#1a1a2e"}}
- Crea evento sessione (solo docente): {{"type": "create_calendar_event", "title": "...", "event_date": "YYYY-MM-DD", "event_time": "HH:MM", "description": "...", "color": "#6366f1"}}
- Aggiungi nota calendario personale: {{"type": "update_calendar_note", "date": "YYYY-MM-DD", "note": "testo"}}
"""


class AgentContextWidget(BaseModel):
    id: str
    widget_type: str
    config_json: dict
    grid_x: int
    grid_y: int
    grid_w: int
    grid_h: int


class AgentContextCalendarEvent(BaseModel):
    id: str
    title: str
    event_date: str
    event_time: Optional[str] = None
    description: Optional[str] = None
    color: str


class AgentContextSession(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    class_name: Optional[str] = None


class AgentRequestContext(BaseModel):
    desktop_id: str
    wallpaper_key: str
    widgets: list[AgentContextWidget]
    calendar_events: list[AgentContextCalendarEvent] = []
    session: Optional[AgentContextSession] = None
    user_name: str
    user_role: str  # "teacher" | "student"


class AgentRequest(BaseModel):
    message: str
    context: AgentRequestContext


class AgentAction(BaseModel):
    type: str
    model_config = {"extra": "allow"}


class AgentResponse(BaseModel):
    reply: str
    actions: list[dict]
    requires_confirmation: bool


def _build_desktop_state(ctx: AgentRequestContext) -> str:
    if not ctx.widgets:
        return "Desktop vuoto (nessun widget)."
    lines = [f"Desktop ID: {ctx.desktop_id}, Sfondo: {ctx.wallpaper_key}"]
    for w in ctx.widgets:
        config_summary = json.dumps(w.config_json, ensure_ascii=False)[:200]
        lines.append(f"- [{w.widget_type}] id={w.id} pos=({w.grid_x},{w.grid_y}) size={w.grid_w}×{w.grid_h} config={config_summary}")
    return "\n".join(lines)


def _build_calendar_state(ctx: AgentRequestContext) -> str:
    if not ctx.calendar_events:
        return "Nessun evento questa settimana."
    lines = []
    for ev in ctx.calendar_events:
        time_str = f" alle {ev.event_time}" if ev.event_time else ""
        desc_str = f" — {ev.description}" if ev.description else ""
        lines.append(f"- {ev.event_date}{time_str}: {ev.title}{desc_str}")
    return "\n".join(lines)


def _build_session_info(ctx: AgentRequestContext) -> str:
    if not ctx.session or not ctx.session.id:
        return "Nessuna sessione attiva."
    parts = [f"ID: {ctx.session.id}"]
    if ctx.session.name:
        parts.append(f"Nome: {ctx.session.name}")
    if ctx.session.class_name:
        parts.append(f"Classe: {ctx.session.class_name}")
    return ", ".join(parts)


@router.post("/desktop/agent", response_model=AgentResponse)
async def desktop_agent(
    body: AgentRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if not llm_service.anthropic_client:
        raise HTTPException(status_code=503, detail="AI service not available")

    ctx = body.context

    # Build system prompt
    system = AGENT_SYSTEM_PROMPT.format(
        user_name=ctx.user_name,
        user_role="Docente" if ctx.user_role == "teacher" else "Studente",
        desktop_state=_build_desktop_state(ctx),
        calendar_state=_build_calendar_state(ctx),
        session_info=_build_session_info(ctx),
        widget_registry=WIDGET_REGISTRY_PROMPT,
    )

    messages = [{"role": "user", "content": body.message}]

    try:
        response = await llm_service.anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",  # fast and cheap for UI interactions
            system=system,
            messages=messages,
            max_tokens=1024,
            temperature=0.3,
        )

        raw_text = ""
        for block in response.content:
            if hasattr(block, "text"):
                raw_text += block.text

        # Parse JSON from response
        # Claude might wrap in ```json ... ``` or return raw JSON
        raw_text = raw_text.strip()
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
        raw_text = raw_text.strip().rstrip("`").strip()

        parsed = json.loads(raw_text)
        return AgentResponse(
            reply=parsed.get("reply", ""),
            actions=parsed.get("actions", []),
            requires_confirmation=parsed.get("requires_confirmation", True),
        )

    except json.JSONDecodeError as e:
        logger.warning("Agent response JSON parse error: %s | raw: %s", e, raw_text[:300])
        # Return raw text as reply with no actions
        return AgentResponse(
            reply=raw_text or "Non ho capito. Prova a riformulare la richiesta.",
            actions=[],
            requires_confirmation=False,
        )
    except Exception as e:
        logger.error("Agent error: %s", e)
        raise HTTPException(status_code=500, detail="Agent error")
