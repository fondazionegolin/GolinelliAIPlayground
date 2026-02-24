from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.api.deps import get_current_teacher
from app.models.user import User
from app.models.alert import ContentAlert
from app.models.session import Session, Class

router = APIRouter()


@router.get("")
async def list_alerts(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    session_id: Optional[UUID] = None,
    status_filter: Optional[str] = None,
):
    """List content alerts for sessions owned by this teacher."""
    sessions_q = (
        select(Session.id)
        .join(Class, Session.class_id == Class.id)
        .where(Class.teacher_id == teacher.id)
    )

    query = select(ContentAlert).where(ContentAlert.session_id.in_(sessions_q))

    if session_id:
        query = query.where(ContentAlert.session_id == session_id)
    if status_filter:
        query = query.where(ContentAlert.status == status_filter)

    query = query.order_by(ContentAlert.created_at.desc()).limit(200)
    result = await db.execute(query)
    alerts = result.scalars().all()

    return [_serialize(a) for a in alerts]


@router.put("/{alert_id}/status")
async def update_alert_status(
    alert_id: UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Set alert status to acknowledged / blocked / accepted."""
    new_status = body.get("status")
    if new_status not in ("acknowledged", "blocked", "accepted"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")

    result = await db.execute(select(ContentAlert).where(ContentAlert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")

    # Verify teacher owns this alert's session
    sess_result = await db.execute(
        select(Session)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == alert.session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not sess_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    alert.status = new_status
    alert.resolved_at = datetime.utcnow()
    await db.commit()
    await db.refresh(alert)
    return _serialize(alert)


def _serialize(alert: ContentAlert) -> dict:
    return {
        "id": str(alert.id),
        "session_id": str(alert.session_id),
        "student_id": str(alert.student_id),
        "alert_type": alert.alert_type,
        "status": alert.status,
        "original_message": alert.original_message,
        "masked_message": alert.masked_message,
        "risk_score": alert.risk_score,
        "details": alert.details,
        "created_at": alert.created_at.isoformat(),
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
    }
