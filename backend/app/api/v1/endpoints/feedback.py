from typing import Annotated, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
import logging

from app.core.database import get_db
from app.api.deps import get_current_admin, get_student_or_teacher, StudentOrTeacher
from app.models.feedback import FeedbackReport
from app.models.user import User
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

router = APIRouter()

FEEDBACK_NOTIFICATION_EMAIL = "a.saracino@fondazionegolinelli.it"


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


class FeedbackResponse(BaseModel):
    id: str
    user_type: str
    user_display_name: Optional[str]
    message: str
    page_url: Optional[str]
    browser_info: dict
    console_errors: list
    status: str
    created_at: str

    class Config:
        from_attributes = True


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
    else:
        user_type = "teacher"
        user_id_ref = str(actor.teacher.id)
        user_display_name = f"{actor.teacher.first_name or ''} {actor.teacher.last_name or ''}".strip() or actor.teacher.email

    report = FeedbackReport(
        user_type=user_type,
        user_id_ref=user_id_ref,
        user_display_name=user_display_name,
        message=body.message.strip(),
        page_url=body.page_url,
        browser_info=body.browser_info.model_dump() if body.browser_info else {},
        console_errors=body.console_errors or [],
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
      <tr><td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Pagina</strong></td>
          <td style="padding: 6px 0; font-size: 13px;">{body.page_url or 'N/A'}</td></tr>
      <tr><td style="padding: 6px 0; color: #666; font-size: 13px; vertical-align: top;"><strong>Messaggio</strong></td>
          <td style="padding: 6px 0; font-size: 13px;">{body.message.strip()}</td></tr>
    </table>
    {'<div style="margin-top: 16px; padding: 12px; background: #fff5f5; border-left: 3px solid #e85c8d; border-radius: 4px;"><strong style="font-size: 12px; color: #c0392b;">Errori console:</strong><pre style="font-size: 11px; color: #555; margin: 6px 0 0; white-space: pre-wrap;">' + chr(10).join(body.console_errors[:10]) + '</pre></div>' if body.console_errors else ''}
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
            text_content=f"Nuovo feedback da {user_display_name} ({user_type})\n\nPagina: {body.page_url}\n\nMessaggio:\n{body.message.strip()}",
        )
    except Exception as e:
        logger.warning(f"Failed to send feedback notification email: {e}")

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
    return [
        FeedbackResponse(
            id=str(r.id),
            user_type=r.user_type,
            user_display_name=r.user_display_name,
            message=r.message,
            page_url=r.page_url,
            browser_info=r.browser_info or {},
            console_errors=r.console_errors or [],
            status=r.status,
            created_at=r.created_at.isoformat(),
        )
        for r in reports
    ]


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
