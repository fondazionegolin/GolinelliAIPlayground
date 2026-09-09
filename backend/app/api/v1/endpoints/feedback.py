from typing import Annotated, List, Optional
import asyncio
import json
import uuid as _uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from pydantic import BaseModel
import logging

from app.core.database import get_db
from app.api.deps import get_current_admin, get_current_teacher, get_current_user, get_student_or_teacher, security, StudentOrTeacher
from app.core.config import settings
from app.core.security import create_access_token, decode_token
from app.models.feedback import FeedbackReport, FeedbackBoardCollaborator, FeedbackBoardConfig
from app.models.user import User
from app.models.enums import UserRole
from app.services.email_service import email_service
from app.services.llm_service import LLMService

logger = logging.getLogger(__name__)

router = APIRouter()

FEEDBACK_NOTIFICATION_EMAIL = "a.saracino@fondazionegolinelli.it"

# ── Board taxonomy (shared front+back contract) ──────────────────────────────
BOARD_STATUSES = ["inbox", "triage", "ready", "in_progress", "qa", "approved", "released"]
CATEGORIES = ["bug", "feature", "ui", "ux"]
URGENCIES = ["alta", "media", "bassa"]

DEFAULT_BOARD_COLUMNS = [
    {"id": "inbox", "label": "Inbox / Nuovi", "hint": "Segnalazioni e task appena creati", "color": "#64748b"},
    {"id": "triage", "label": "In Analisi / Triage", "hint": "Qualifica, priorità e contesto", "color": "#0ea5e9"},
    {"id": "qa", "label": "In Revisione / QA", "hint": "Verifica tecnica e qualitativa", "color": "#a855f7"},
    {"id": "released", "label": "Rilasciato / Chiuso", "hint": "Completato o comunicato", "color": "#10b981"},
]

BOARD_TEMPLATES = [
    {"id": "kanban", "label": "Kanban", "columns": DEFAULT_BOARD_COLUMNS},
    {
        "id": "swot",
        "label": "SWOT",
        "columns": [
            {"id": "strengths", "label": "Punti di forza", "hint": "Cosa funziona bene", "color": "#10b981"},
            {"id": "weaknesses", "label": "Debolezze", "hint": "Limiti e problemi", "color": "#f59e0b"},
            {"id": "opportunities", "label": "Opportunità", "hint": "Miglioramenti possibili", "color": "#0ea5e9"},
            {"id": "threats", "label": "Rischi", "hint": "Blocchi o criticità", "color": "#ef4444"},
        ],
    },
    {
        "id": "roadmap",
        "label": "Roadmap",
        "columns": [
            {"id": "ideas", "label": "Idee", "hint": "Proposte non ancora selezionate", "color": "#64748b"},
            {"id": "next", "label": "Prossime", "hint": "Priorità vicine", "color": "#0ea5e9"},
            {"id": "building", "label": "In sviluppo", "hint": "Lavoro attivo", "color": "#a855f7"},
            {"id": "done", "label": "Fatto", "hint": "Completato", "color": "#10b981"},
        ],
    },
]


async def classify_feedback(message: str, page_url: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Best-effort auto-classification of a feedback report.

    Returns (category, urgency). Tries a small LLM call; on any failure falls
    back to a keyword heuristic so the board is never left blank.
    """
    text = (message or "").strip()

    def _heuristic() -> tuple[str, str]:
        low = text.lower()
        bug_kw = ("errore", "error", "crash", "bug", "non funziona", "non va", "rotto", "blocca", "bloccato", "exception", "fallisce", "non carica")
        feature_kw = ("vorrei", "sarebbe utile", "sarebbe bello", "potreste", "si potrebbe", "aggiungere", "manca", "richiesta", "suggerimento", "feature")
        ui_kw = ("colore", "pulsante", "bottone", "layout", "grafica", "design", "testo", "font", "icona", "schermo", "visualizz")
        if any(k in low for k in bug_kw):
            cat = "bug"
        elif any(k in low for k in feature_kw):
            cat = "feature"
        elif any(k in low for k in ui_kw):
            cat = "ui"
        else:
            cat = "ux"
        urg = "alta" if any(k in low for k in ("urgente", "subito", "grave", "non riesco", "bloccato", "blocca")) else "media"
        return cat, urg

    try:
        llm = LLMService()
        prompt = (
            "Classifica questa segnalazione utente di una piattaforma educativa.\n"
            f"Pagina: {page_url or 'N/A'}\n"
            f"Messaggio: {text[:1500]}\n\n"
            "Rispondi SOLO con un oggetto JSON, senza testo aggiuntivo, nel formato:\n"
            '{\"category\": \"bug|feature|ui|ux\", \"urgency\": \"alta|media|bassa\"}\n'
            "- category: bug = malfunzionamento; feature = nuova funzionalità richiesta; "
            "ui = aspetto/grafica/layout; ux = esperienza d'uso o errore di utilizzo.\n"
            "- urgency: alta = blocca l'uso; media = fastidioso; bassa = cosmetico/minore."
        )
        resp = await llm.generate(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=60,
            allow_web_search=False,
        )
        raw = (resp.content or "").strip()
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end != -1:
            data = json.loads(raw[start:end + 1])
            cat = str(data.get("category", "")).strip().lower()
            urg = str(data.get("urgency", "")).strip().lower()
            if cat not in CATEGORIES or urg not in URGENCIES:
                raise ValueError("LLM returned out-of-range labels")
            return cat, urg
        raise ValueError("No JSON object in LLM response")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"classify_feedback fell back to heuristic: {e}")
        return _heuristic()


async def _ensure_feedback_board_member(db: AsyncSession, current_user: User) -> User:
    """Allow admins, or teachers explicitly invited as board collaborators."""
    if current_user.role == UserRole.ADMIN:
        return current_user
    if current_user.role == UserRole.TEACHER:
        res = await db.execute(
            select(FeedbackBoardCollaborator).where(FeedbackBoardCollaborator.teacher_id == current_user.id)
        )
        if res.scalar_one_or_none():
            return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso alla board non consentito")


async def get_feedback_board_member(
    db: Annotated[AsyncSession, Depends(get_db)],
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)] = None,
    access_token: Annotated[Optional[str], Cookie()] = None,
) -> User:
    """Authenticate board calls with a normal login or a scoped MCP token."""
    token = credentials.credentials if credentials else access_token
    payload = decode_token(token) if token else None
    token_type = payload.get("type") if payload else None
    if token_type not in {"access", "feedback_board_mcp"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if token_type == "feedback_board_mcp" and payload.get("scope") != "feedback_board":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token scope")

    try:
        user_id = _uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload") from exc

    current_user = await db.get(User, user_id)
    if not current_user or not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return await _ensure_feedback_board_member(db, current_user)


class BrowserInfo(BaseModel):
    user_agent: Optional[str] = None
    screen_width: Optional[int] = None
    screen_height: Optional[int] = None
    language: Optional[str] = None
    platform: Optional[str] = None
    viewport_width: Optional[int] = None
    viewport_height: Optional[int] = None


class FeedbackSubmit(BaseModel):
    message: str
    page_url: Optional[str] = None
    browser_info: Optional[BrowserInfo] = None
    console_errors: Optional[List[str]] = None
    screenshot_base64: Optional[str] = None  # data URI for attached screenshot


class FeedbackResponse(BaseModel):
    id: str
    user_type: str
    user_display_name: Optional[str]
    user_email: Optional[str]
    message: str
    page_url: Optional[str]
    browser_info: dict
    console_errors: list
    status: str
    source: str = "feedback"
    created_by_display_name: Optional[str] = None
    last_actor_display_name: Optional[str] = None
    board_status: str
    category: Optional[str]
    urgency: Optional[str]
    internal_note: Optional[str]
    auto_classified: bool
    created_at: str

    class Config:
        from_attributes = True


def _serialize_report(r: FeedbackReport) -> FeedbackResponse:
    return FeedbackResponse(
        id=str(r.id),
        user_type=r.user_type,
        user_display_name=r.user_display_name,
        user_email=r.user_email,
        message=r.message,
        page_url=r.page_url,
        browser_info=r.browser_info or {},
        console_errors=r.console_errors or [],
        status=r.status,
        source=r.source or "feedback",
        created_by_display_name=r.created_by_display_name,
        last_actor_display_name=r.last_actor_display_name,
        board_status=r.board_status or "inbox",
        category=r.category,
        urgency=r.urgency,
        internal_note=r.internal_note,
        auto_classified=bool(r.auto_classified),
        created_at=r.created_at.isoformat(),
    )


class FeedbackReplyBody(BaseModel):
    reply_type: str  # "in_progress" | "resolved"


class BoardColumn(BaseModel):
    id: str
    label: str
    hint: Optional[str] = ""
    color: Optional[str] = "#64748b"


class BoardConfigUpdate(BaseModel):
    title: Optional[str] = None
    columns: Optional[List[BoardColumn]] = None
    template_id: Optional[str] = None
    is_shared_with_class: Optional[bool] = None
    students_can_contribute: Optional[bool] = None


class BoardManualCardCreate(BaseModel):
    message: str
    board_status: Optional[str] = None
    category: Optional[str] = None
    urgency: Optional[str] = None
    internal_note: Optional[str] = None


def _actor_display_name(user: User) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email


def _normalize_board_columns(columns: list[dict] | None) -> list[dict]:
    raw = columns or DEFAULT_BOARD_COLUMNS
    normalized: list[dict] = []
    seen: set[str] = set()
    for idx, col in enumerate(raw[:12]):
        col_id = str(col.get("id") or "").strip().lower().replace(" ", "_")
        label = str(col.get("label") or "").strip()
        if not col_id or not label or col_id in seen:
            col_id = f"col_{idx + 1}"
        seen.add(col_id)
        normalized.append({
            "id": col_id[:20],
            "label": label[:80] or f"Colonna {idx + 1}",
            "hint": str(col.get("hint") or "")[:180],
            "color": str(col.get("color") or "#64748b")[:24],
        })
    return normalized or DEFAULT_BOARD_COLUMNS


async def _get_board_config(db: AsyncSession) -> FeedbackBoardConfig:
    result = await db.execute(select(FeedbackBoardConfig).where(FeedbackBoardConfig.scope == "global"))
    config = result.scalar_one_or_none()
    if config:
        if not config.columns_json:
            config.columns_json = DEFAULT_BOARD_COLUMNS
        return config
    config = FeedbackBoardConfig(scope="global", title="Board sviluppo", columns_json=DEFAULT_BOARD_COLUMNS)
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return config


def _configured_statuses(config: FeedbackBoardConfig) -> set[str]:
    return {str(col.get("id")) for col in _normalize_board_columns(config.columns_json)} | set(BOARD_STATUSES)


@router.post("/", status_code=201)
async def submit_feedback(
    body: FeedbackSubmit,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="Il messaggio non può essere vuoto")

    if actor.is_student:
        user_type = "student"
        user_id_ref = str(actor.student.id)
        user_display_name = actor.student.nickname or "Studente"
        user_email = actor.student.email if hasattr(actor.student, "email") else None
    else:
        user_type = "teacher"
        user_id_ref = str(actor.teacher.id)
        user_display_name = f"{actor.teacher.first_name or ''} {actor.teacher.last_name or ''}".strip() or actor.teacher.email
        user_email = actor.teacher.email

    browser_info_dict = body.browser_info.model_dump() if body.browser_info else {}
    if body.screenshot_base64:
        browser_info_dict['screenshot_base64'] = body.screenshot_base64

    config = await _get_board_config(db)
    board_status = _normalize_board_columns(config.columns_json)[0]["id"]

    report = FeedbackReport(
        user_type=user_type,
        user_id_ref=user_id_ref,
        user_display_name=user_display_name,
        user_email=user_email,
        message=body.message.strip(),
        page_url=body.page_url,
        browser_info=browser_info_dict,
        console_errors=body.console_errors or [],
        source="feedback",
        created_by_display_name=user_display_name,
        last_actor_display_name=user_display_name,
        board_status=board_status,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    # Send email notification
    try:
        html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1a1a2e 0%, #e85c8d 100%); padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px;">🐛 Nuovo Feedback Beta</h1>
  </div>
  <div style="background: #ffffff; padding: 24px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 6px 0; color: #666; font-size: 13px; width: 130px;"><strong>Utente</strong></td>
          <td style="padding: 6px 0; font-size: 13px;">{user_display_name} ({user_type})</td></tr>
      {'<tr><td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Email</strong></td><td style="padding: 6px 0; font-size: 13px;"><a href="mailto:' + user_email + '">' + user_email + '</a></td></tr>' if user_email else ''}
      <tr><td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Pagina</strong></td>
          <td style="padding: 6px 0; font-size: 13px;">{body.page_url or 'N/A'}</td></tr>
      <tr><td style="padding: 6px 0; color: #666; font-size: 13px; vertical-align: top;"><strong>Messaggio</strong></td>
          <td style="padding: 6px 0; font-size: 13px;">{body.message.strip()}</td></tr>
    </table>
    {'<div style="margin-top: 16px; padding: 12px; background: #fff5f5; border-left: 3px solid #e85c8d; border-radius: 4px;"><strong style="font-size: 12px; color: #c0392b;">Errori console:</strong><pre style="font-size: 11px; color: #555; margin: 6px 0 0; white-space: pre-wrap;">' + chr(10).join(body.console_errors[:10]) + '</pre></div>' if body.console_errors else ''}
    {'<div style="margin-top: 16px;"><strong style="font-size: 12px; color: #555;">Screenshot allegato:</strong><br><img src="' + body.screenshot_base64 + '" style="max-width: 100%; border-radius: 6px; margin-top: 8px; border: 1px solid #e0e0e0;" /></div>' if body.screenshot_base64 else ''}
    <p style="color: #999; font-size: 11px; margin-top: 20px; text-align: center;">
      Golinelli.ai — Sistema di feedback beta automatico
    </p>
  </div>
</body>
</html>
"""
        await email_service.send_email(
            to_email=FEEDBACK_NOTIFICATION_EMAIL,
            subject=f"[Feedback Beta] {user_display_name} — {(body.message[:60] + '…') if len(body.message) > 60 else body.message}",
            html_content=html,
            text_content=f"Nuovo feedback da {user_display_name} ({user_type})\nEmail: {user_email or 'N/A'}\n\nPagina: {body.page_url}\n\nMessaggio:\n{body.message.strip()}",
        )
    except Exception as e:
        logger.warning(f"Failed to send feedback notification email: {e}")

    # Auto-classify (best effort) so the board card lands pre-tagged in Inbox
    try:
        cat, urg = await classify_feedback(report.message, report.page_url)
        report.category = cat
        report.urgency = urg
        report.auto_classified = True
        await db.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Failed to auto-classify feedback {report.id}: {e}")

    return {"id": str(report.id), "status": "received"}


@router.get("/admin", response_model=List[FeedbackResponse])
async def list_feedback(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    limit: int = 100,
    offset: int = 0,
    status_filter: Optional[str] = None,
):
    q = select(FeedbackReport).order_by(desc(FeedbackReport.created_at)).limit(limit).offset(offset)
    if status_filter:
        q = q.where(FeedbackReport.status == status_filter)
    result = await db.execute(q)
    reports = result.scalars().all()
    return [_serialize_report(r) for r in reports]


@router.patch("/admin/{feedback_id}/status")
async def update_feedback_status(
    feedback_id: str,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    import uuid as _uuid
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == _uuid.UUID(feedback_id)))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Feedback non trovato")
    new_status = body.get("status", "reviewed")
    if new_status not in ("new", "reviewed"):
        raise HTTPException(status_code=400, detail="Status non valido")
    report.status = new_status
    await db.commit()
    return {"id": feedback_id, "status": report.status}


@router.post("/admin/{feedback_id}/reply")
async def reply_to_feedback(
    feedback_id: str,
    body: FeedbackReplyBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    import uuid as _uuid
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == _uuid.UUID(feedback_id)))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Feedback non trovato")

    return await _send_feedback_reply(db, report, body.reply_type)


async def _send_feedback_reply(db: AsyncSession, report: FeedbackReport, reply_type: str) -> dict:
    """Send the 'in progress' / 'resolved' notification email to the reporter."""
    if not report.user_email:
        raise HTTPException(status_code=400, detail="Nessuna email disponibile per questo utente")

    if reply_type not in ("in_progress", "resolved"):
        raise HTTPException(status_code=400, detail="Tipo di risposta non valido")

    if reply_type == "in_progress":
        subject = "Il tuo feedback è in lavorazione — Golinelli.ai"
        action_text = "Abbiamo preso in carico la tua segnalazione e il nostro team è al lavoro per risolvere il problema."
        badge_color = "#f59e0b"
        badge_text = "In lavorazione"
        icon = "🔧"
    else:
        subject = "Il tuo feedback è stato risolto — Golinelli.ai"
        action_text = "Siamo felici di comunicarti che il problema che hai segnalato è stato risolto. Grazie per averci aiutato a migliorare la piattaforma!"
        badge_color = "#10b981"
        badge_text = "Risolto"
        icon = "✅"

    message_preview = (report.message[:80] + "…") if len(report.message) > 80 else report.message
    user_name = report.user_display_name or "Utente"

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1a1a2e 0%, #e85c8d 100%); padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px;">{icon} Aggiornamento sul tuo feedback</h1>
  </div>
  <div style="background: #ffffff; padding: 24px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 15px; color: #333;">Ciao <strong>{user_name}</strong>,</p>
    <p style="font-size: 14px; color: #444;">{action_text}</p>
    <div style="margin: 20px 0; padding: 16px; background: #f8f8f8; border-radius: 8px; border-left: 4px solid {badge_color};">
      <p style="margin: 0 0 6px; font-size: 11px; font-weight: bold; color: #888; text-transform: uppercase; letter-spacing: 0.05em;">La tua segnalazione</p>
      <p style="margin: 0; font-size: 13px; color: #555; font-style: italic;">"{message_preview}"</p>
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <span style="display: inline-block; background: {badge_color}; color: white; font-weight: bold; font-size: 13px; padding: 8px 20px; border-radius: 20px;">{badge_text}</span>
    </div>
    <p style="font-size: 13px; color: #666;">Grazie per contribuire a migliorare Golinelli.ai!</p>
    <p style="color: #999; font-size: 11px; margin-top: 20px; text-align: center; border-top: 1px solid #eee; padding-top: 16px;">
      Golinelli.ai — Non rispondere a questa email
    </p>
  </div>
</body>
</html>"""

    text = f"Ciao {user_name},\n\n{action_text}\n\nLa tua segnalazione: \"{message_preview}\"\n\nStato: {badge_text}\n\nGrazie,\nTeam Golinelli.ai"

    sent = await email_service.send_email(
        to_email=report.user_email,
        subject=subject,
        html_content=html,
        text_content=text,
    )

    if not sent:
        raise HTTPException(status_code=500, detail="Invio email fallito")

    # Auto-mark as reviewed when resolved
    if reply_type == "resolved":
        report.status = "reviewed"
        await db.commit()

    return {"sent": True, "to": report.user_email, "reply_type": reply_type}


# ── Project-management board ─────────────────────────────────────────────────

class BoardCardUpdate(BaseModel):
    board_status: Optional[str] = None
    category: Optional[str] = None
    urgency: Optional[str] = None
    internal_note: Optional[str] = None


class CollaboratorAdd(BaseModel):
    email: str


async def _get_report_or_404(db: AsyncSession, feedback_id: str) -> FeedbackReport:
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == _uuid.UUID(feedback_id)))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Feedback non trovato")
    return report


@router.post("/board/mcp-token")
async def create_feedback_board_mcp_token(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Exchange a normal login for a long-lived, board-scoped MCP token."""
    await _ensure_feedback_board_member(db, current_user)
    expires_delta = timedelta(days=settings.FEEDBACK_MCP_TOKEN_EXPIRE_DAYS)
    token = create_access_token(
        subject=str(current_user.id),
        token_type="feedback_board_mcp",
        expires_delta=expires_delta,
        extra_claims={
            "scope": "feedback_board",
            "role": current_user.role.value,
            "tenant_id": str(current_user.tenant_id) if current_user.tenant_id else None,
        },
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "scope": "feedback_board",
        "expires_in_days": settings.FEEDBACK_MCP_TOKEN_EXPIRE_DAYS,
        "expires_at": (datetime.utcnow() + expires_delta).isoformat(),
    }


@router.get("/board/access")
async def board_access(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Whether the current teacher (or admin) can see the feedback board."""
    if teacher.role == UserRole.ADMIN:
        return {"has_access": True, "is_admin": True}
    res = await db.execute(
        select(FeedbackBoardCollaborator).where(FeedbackBoardCollaborator.teacher_id == teacher.id)
    )
    return {"has_access": res.scalar_one_or_none() is not None, "is_admin": False}


@router.get("/board", response_model=List[FeedbackResponse])
async def list_board(
    db: Annotated[AsyncSession, Depends(get_db)],
    member: Annotated[User, Depends(get_feedback_board_member)],
):
    result = await db.execute(select(FeedbackReport).order_by(desc(FeedbackReport.created_at)))
    return [_serialize_report(r) for r in result.scalars().all()]


@router.get("/board/config")
async def get_board_config(
    db: Annotated[AsyncSession, Depends(get_db)],
    member: Annotated[User, Depends(get_feedback_board_member)],
):
    config = await _get_board_config(db)
    return {
        "title": config.title,
        "columns": _normalize_board_columns(config.columns_json),
        "templates": BOARD_TEMPLATES,
        "is_shared_with_class": bool(config.is_shared_with_class),
        "students_can_contribute": bool(config.students_can_contribute),
    }


@router.put("/board/config")
async def update_board_config(
    body: BoardConfigUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    member: Annotated[User, Depends(get_feedback_board_member)],
):
    config = await _get_board_config(db)
    if body.title is not None:
        config.title = body.title.strip()[:160] or "Board sviluppo"
    if body.template_id:
        template = next((t for t in BOARD_TEMPLATES if t["id"] == body.template_id), None)
        if not template:
            raise HTTPException(status_code=400, detail="Template non valido")
        config.columns_json = template["columns"]
    if body.columns is not None:
        config.columns_json = _normalize_board_columns([c.dict() for c in body.columns])
    if body.is_shared_with_class is not None:
        config.is_shared_with_class = bool(body.is_shared_with_class)
    if body.students_can_contribute is not None:
        config.students_can_contribute = bool(body.students_can_contribute)
    config.updated_by_id = member.id
    await db.commit()
    await db.refresh(config)
    return {
        "title": config.title,
        "columns": _normalize_board_columns(config.columns_json),
        "templates": BOARD_TEMPLATES,
        "is_shared_with_class": bool(config.is_shared_with_class),
        "students_can_contribute": bool(config.students_can_contribute),
    }


@router.post("/board/cards", response_model=FeedbackResponse, status_code=201)
async def create_board_card(
    body: BoardManualCardCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    member: Annotated[User, Depends(get_feedback_board_member)],
):
    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="Testo task obbligatorio")
    config = await _get_board_config(db)
    valid_statuses = _configured_statuses(config)
    board_status = body.board_status or _normalize_board_columns(config.columns_json)[0]["id"]
    if board_status not in valid_statuses:
        raise HTTPException(status_code=400, detail="board_status non valido")
    if body.category is not None and body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="category non valida")
    if body.urgency is not None and body.urgency not in URGENCIES:
        raise HTTPException(status_code=400, detail="urgency non valida")
    actor_name = _actor_display_name(member)
    report = FeedbackReport(
        user_type="teacher",
        user_id_ref=str(member.id),
        user_display_name=actor_name,
        user_email=member.email,
        message=body.message.strip(),
        page_url=None,
        browser_info={},
        console_errors=[],
        status="new",
        source="manual",
        created_by_display_name=actor_name,
        last_actor_display_name=actor_name,
        board_status=board_status,
        category=body.category,
        urgency=body.urgency,
        internal_note=body.internal_note,
        auto_classified=False,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return _serialize_report(report)


@router.patch("/board/{feedback_id}", response_model=FeedbackResponse)
async def update_board_card(
    feedback_id: str,
    body: BoardCardUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    member: Annotated[User, Depends(get_feedback_board_member)],
):
    report = await _get_report_or_404(db, feedback_id)
    config = await _get_board_config(db)

    if body.board_status is not None:
        if body.board_status not in _configured_statuses(config):
            raise HTTPException(status_code=400, detail="board_status non valido")
        report.board_status = body.board_status
        # Keep the legacy list status roughly in sync
        if body.board_status in ("released", "approved"):
            report.status = "reviewed"
    if body.category is not None:
        if body.category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="category non valida")
        report.category = body.category
        report.auto_classified = False
    if body.urgency is not None:
        if body.urgency not in URGENCIES:
            raise HTTPException(status_code=400, detail="urgency non valida")
        report.urgency = body.urgency
        report.auto_classified = False
    if body.internal_note is not None:
        report.internal_note = body.internal_note
    report.last_actor_display_name = _actor_display_name(member)

    await db.commit()
    await db.refresh(report)
    return _serialize_report(report)


@router.post("/board/{feedback_id}/classify", response_model=FeedbackResponse)
async def reclassify_board_card(
    feedback_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    member: Annotated[User, Depends(get_feedback_board_member)],
):
    report = await _get_report_or_404(db, feedback_id)
    cat, urg = await classify_feedback(report.message, report.page_url)
    report.category = cat
    report.urgency = urg
    report.auto_classified = True
    await db.commit()
    await db.refresh(report)
    return _serialize_report(report)


@router.post("/board/classify-all")
async def classify_all_board_cards(
    db: Annotated[AsyncSession, Depends(get_db)],
    member: Annotated[User, Depends(get_feedback_board_member)],
):
    """Auto-classify every feedback that is still missing a category or urgency.

    Already-labelled cards (both category and urgency set) are left untouched.
    """
    result = await db.execute(
        select(FeedbackReport).where(
            (FeedbackReport.category.is_(None)) | (FeedbackReport.urgency.is_(None))
        )
    )
    reports = result.scalars().all()
    if not reports:
        return {"classified": 0, "total": 0}

    sem = asyncio.Semaphore(5)

    async def _work(r: FeedbackReport):
        async with sem:
            return r, await classify_feedback(r.message, r.page_url)

    pairs = await asyncio.gather(*[_work(r) for r in reports])
    for r, (cat, urg) in pairs:
        r.category = cat
        r.urgency = urg
        r.auto_classified = True
    await db.commit()
    return {"classified": len(reports), "total": len(reports)}


@router.post("/board/{feedback_id}/reply")
async def reply_board_card(
    feedback_id: str,
    body: FeedbackReplyBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    member: Annotated[User, Depends(get_feedback_board_member)],
):
    report = await _get_report_or_404(db, feedback_id)
    return await _send_feedback_reply(db, report, body.reply_type)


@router.get("/board/collaborators")
async def list_collaborators(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(
        select(FeedbackBoardCollaborator, User)
        .join(User, User.id == FeedbackBoardCollaborator.teacher_id)
        .order_by(FeedbackBoardCollaborator.added_at)
    )
    out = []
    for collab, user in result.all():
        full_name = f"{user.first_name or ''} {user.last_name or ''}".strip()
        out.append({
            "teacher_id": str(user.id),
            "name": full_name or user.email,
            "email": user.email,
            "added_at": collab.added_at.isoformat(),
        })
    return out


@router.get("/board/eligible-collaborators")
async def list_eligible_collaborators(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Registered teachers in the school who can be added as board collaborators."""
    existing = await db.execute(select(FeedbackBoardCollaborator.teacher_id))
    taken = {row[0] for row in existing.all()}

    result = await db.execute(
        select(User)
        .where(User.tenant_id == admin.tenant_id)
        .where(User.role.in_((UserRole.TEACHER, UserRole.ADMIN)))
        .order_by(User.first_name, User.last_name, User.email)
    )
    out = []
    for user in result.scalars().all():
        if user.id in taken or user.id == admin.id:
            continue
        full_name = f"{user.first_name or ''} {user.last_name or ''}".strip()
        out.append({
            "teacher_id": str(user.id),
            "name": full_name or user.email,
            "email": user.email,
        })
    return out


@router.post("/board/collaborators", status_code=201)
async def add_collaborator(
    body: CollaboratorAdd,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    email = (body.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email obbligatoria")
    res = await db.execute(select(User).where(func.lower(User.email) == email))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Nessun utente con questa email")
    if user.role not in (UserRole.TEACHER, UserRole.ADMIN):
        raise HTTPException(status_code=400, detail="L'utente non è un docente")
    existing = await db.execute(
        select(FeedbackBoardCollaborator).where(FeedbackBoardCollaborator.teacher_id == user.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Docente già collaboratore")
    collab = FeedbackBoardCollaborator(teacher_id=user.id, added_by_id=admin.id)
    db.add(collab)
    await db.commit()
    full_name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return {"teacher_id": str(user.id), "name": full_name or user.email, "email": user.email}


@router.delete("/board/collaborators/{teacher_id}", status_code=204)
async def remove_collaborator(
    teacher_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    res = await db.execute(
        select(FeedbackBoardCollaborator).where(FeedbackBoardCollaborator.teacher_id == _uuid.UUID(teacher_id))
    )
    collab = res.scalar_one_or_none()
    if collab:
        await db.delete(collab)
        await db.commit()
    return None
