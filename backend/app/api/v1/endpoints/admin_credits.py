from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, or_, and_
from typing import Annotated, List, Optional
from datetime import datetime, timedelta, timezone
import uuid
import csv
import io
import secrets

from app.core.database import get_db
from app.core.config import settings
from app.core.url_utils import resolve_frontend_url
from app.core.security import get_password_hash
from app.api.deps import get_current_admin, get_current_user
from app.services.email_service import email_service
from app.models.user import User, ActivationToken
from app.models.tenant import Tenant
from app.models.session import Session, SessionStudent, Class as TeacherClass
from app.models.invitation import PlatformInvitation
from app.models.credits import CreditLimit, CreditTransaction, CreditRequest, CreditAlert
from app.models.enums import LimitLevel, CreditRequestStatus, InvitationStatus, CreditTransactionType, UserRole, TenantType
from app.services.credit_service import credit_service, effective_cap, from_credits, reset_if_due, to_credits, LOW_BALANCE_RATIO
from app.realtime.gateway import sio
from pydantic import BaseModel, Field
import re
from app.schemas.credits import (
    CreditLimitResponse, CreditLimitUpdate, CreditLimitBase,
    CreditTransactionResponse, ConsumptionStats,
    CreditRequestResponse, CreditRequestReview, CreditRequestCreate,
    CreditBalanceResponse, CreditUsageHistoryItem,
    PlatformInvitationCreate, PlatformInvitationResponse, BulkInvitationCreate
)

router = APIRouter()


def _tenant_template_args(tenant: Tenant | None, template_key: str) -> dict:
    if not tenant:
        return {}
    templates = tenant.email_templates_json or {}
    activation = templates.get(template_key) or {}
    return {
        "subject_template": activation.get("subject"),
        "html_template": activation.get("html"),
        "text_template": activation.get("text"),
    }


async def _create_activation_token_for_user(db: AsyncSession, user: User) -> tuple[ActivationToken, str]:
    old_tokens = (await db.execute(
        select(ActivationToken).where(
            ActivationToken.user_id == user.id,
            ActivationToken.is_used == False,  # noqa: E712
        )
    )).scalars().all()
    for tok in old_tokens:
        tok.is_used = True
        tok.used_at = datetime.utcnow()

    temp_password = secrets.token_urlsafe(12)
    activation_token = secrets.token_urlsafe(48)
    activation = ActivationToken(
        user_id=user.id,
        token=activation_token,
        temporary_password=temp_password,
        expires_at=datetime.utcnow() + timedelta(hours=72),
    )
    user.password_hash = get_password_hash(temp_password)
    db.add(activation)
    await db.flush()
    return activation, activation_token


async def _send_platform_invitation_email(
    *,
    db: AsyncSession,
    request: Request,
    admin: User,
    invitation: PlatformInvitation,
    activation_token: str,
) -> bool:
    """Send the invitation email. Returns True only if SMTP delivery succeeded."""
    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
    templates = _tenant_template_args(tenant, "teacher_invitation")
    activation_link = f"{resolve_frontend_url(request.headers.get('origin'))}/activate/{activation_token}"
    return await email_service.send_invitation_email(
        to_email=invitation.email,
        first_name=invitation.first_name or "Docente",
        link=activation_link,
        custom_message=invitation.custom_message,
        group_tag=invitation.group_tag,
        subject_template=templates.get("subject_template"),
        html_template=templates.get("html_template"),
        text_template=templates.get("text_template"),
    )

# ==================== ANALYTICS ====================

@router.get("/balance", response_model=CreditBalanceResponse)
async def get_my_credit_balance(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the current user's visible credit balance, in credits."""
    return await credit_service.get_balance(
        db,
        user.tenant_id,
        teacher_id=user.id,
    )


@router.get("/student-pool/balance")
async def get_my_student_pool_balance(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the current teacher's monthly pool for student usage."""
    _teacher_limit, pool_limit = await credit_service.ensure_default_teacher_credit_setup(db, user.tenant_id, user.id)
    reset_if_due(pool_limit, datetime.now(timezone.utc))
    await db.commit()
    payload = credit_service.limit_balance_payload(pool_limit)
    payload["limit_level"] = LimitLevel.STUDENT_POOL.value

    # Limiti per classe del docente: visibili subito accanto al pool.
    class_limits = (await db.execute(
        select(CreditLimit, TeacherClass.name)
        .join(TeacherClass, TeacherClass.id == CreditLimit.class_id)
        .where(
            CreditLimit.level == LimitLevel.CLASS,
            CreditLimit.tenant_id == user.tenant_id,
            TeacherClass.teacher_id == user.id,
            CreditLimit.amount_cap > 0,
        )
        .order_by(TeacherClass.name)
    )).all()
    payload["classes"] = [
        {
            "class_id": str(lim.class_id),
            "class_name": name,
            **{k: v for k, v in credit_service.limit_balance_payload(lim).items()
               if k in ("credits_remaining", "credits_used", "credits_cap", "low_balance", "exhausted", "period_end")},
        }
        for lim, name in class_limits
    ]
    return payload


@router.get("/history", response_model=List[CreditUsageHistoryItem])
async def get_my_credit_history(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(20, ge=1, le=50),
):
    """Return recent API calls for the current teacher/admin user in user-facing credits."""
    rows = (await db.execute(
        select(CreditTransaction)
        .where(
            CreditTransaction.tenant_id == user.tenant_id,
            CreditTransaction.teacher_id == user.id,
            CreditTransaction.student_id.is_(None),
            CreditTransaction.transaction_type == CreditTransactionType.API_CALL,
        )
        .order_by(desc(CreditTransaction.timestamp))
        .limit(limit)
    )).scalars().all()

    return [
        CreditUsageHistoryItem(
            id=tx.id,
            timestamp=tx.timestamp,
            provider=tx.provider,
            model=tx.model,
            service=credit_service.classify_service(tx.provider, tx.model, tx.usage_details),
            cost_credits=round(float(tx.cost or 0.0) * 100, 6),
            usage_details=tx.usage_details,
        )
        for tx in rows
    ]


@router.get("/student-pool/history")
async def get_my_student_pool_history(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(50, ge=1, le=200),
):
    """Return recent student calls charged to this teacher's student pool."""
    await credit_service.ensure_default_teacher_credit_setup(db, user.tenant_id, user.id)
    rows = (await db.execute(
        select(
            CreditTransaction,
            SessionStudent.nickname,
            TeacherClass.name.label("class_name"),
            Session.title.label("session_title"),
        )
        .outerjoin(SessionStudent, SessionStudent.id == CreditTransaction.student_id)
        .outerjoin(TeacherClass, TeacherClass.id == CreditTransaction.class_id)
        .outerjoin(Session, Session.id == CreditTransaction.session_id)
        .where(
            CreditTransaction.tenant_id == user.tenant_id,
            CreditTransaction.teacher_id == user.id,
            CreditTransaction.student_id.is_not(None),
            CreditTransaction.transaction_type == CreditTransactionType.API_CALL,
        )
        .order_by(desc(CreditTransaction.timestamp))
        .limit(limit)
    )).all()

    return [
        {
            "id": str(tx.id),
            "timestamp": tx.timestamp,
            "student_id": str(tx.student_id) if tx.student_id else None,
            "student_name": nickname or "Studente",
            "class_name": class_name,
            "session_title": session_title,
            "provider": tx.provider,
            "model": tx.model,
            "service": credit_service.classify_service(tx.provider, tx.model, tx.usage_details),
            "cost_credits": round(float(tx.cost or 0.0) * 100, 6),
            "usage_details": tx.usage_details or {},
        }
        for tx, nickname, class_name, session_title in rows
    ]


@router.get("/stats", response_model=ConsumptionStats)
async def get_consumption_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
):
    """Get consumption analytics"""
    conditions = [CreditTransaction.tenant_id == admin.tenant_id]
    if start_date:
        conditions.append(CreditTransaction.timestamp >= start_date)
    if end_date:
        conditions.append(CreditTransaction.timestamp <= end_date)
        
    # Total Cost
    stmt = select(func.sum(CreditTransaction.cost)).where(*conditions)
    total_cost = (await db.execute(stmt)).scalar() or 0.0
    
    # Provider Breakdown
    stmt = select(CreditTransaction.provider, func.sum(CreditTransaction.cost)).where(*conditions).group_by(CreditTransaction.provider)
    rows = (await db.execute(stmt)).all()
    provider_breakdown = {r[0] or "unknown": r[1] for r in rows}
    
    # Model Breakdown
    stmt = select(CreditTransaction.model, func.sum(CreditTransaction.cost)).where(*conditions).group_by(CreditTransaction.model)
    rows = (await db.execute(stmt)).all()
    model_breakdown = {r[0] or "unknown": r[1] for r in rows}
    
    # Daily Usage
    # This is postgres specific date truncation
    stmt = select(
        func.date_trunc('day', CreditTransaction.timestamp).label('day'),
        func.sum(CreditTransaction.cost)
    ).where(*conditions).group_by('day').order_by('day')
    rows = (await db.execute(stmt)).all()
    daily_usage = [{"date": r[0].isoformat(), "cost": r[1]} for r in rows]
    
    return ConsumptionStats(
        total_cost=total_cost,
        provider_breakdown=provider_breakdown,
        model_breakdown=model_breakdown,
        daily_usage=daily_usage
    )

# ==================== LIMITS ====================

@router.get("/limits", response_model=List[CreditLimitResponse])
async def list_limits(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    level: Optional[LimitLevel] = None,
):
    """List credit limits"""
    stmt = select(CreditLimit).where(CreditLimit.tenant_id == admin.tenant_id)
    if level:
        stmt = stmt.where(CreditLimit.level == level)
    stmt = stmt.order_by(CreditLimit.level, CreditLimit.id)
    
    result = await db.execute(stmt)
    return result.scalars().all()

@router.put("/limits/{limit_id}", response_model=CreditLimitResponse)
async def update_limit(
    limit_id: uuid.UUID,
    update: CreditLimitUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Update a specific limit"""
    stmt = select(CreditLimit).where(CreditLimit.id == limit_id, CreditLimit.tenant_id == admin.tenant_id)
    limit = (await db.execute(stmt)).scalar_one_or_none()
    
    if not limit:
        raise HTTPException(status_code=404, detail="Limit not found")
        
    limit.amount_cap = update.amount_cap
    if update.reset_frequency:
        limit.reset_frequency = update.reset_frequency
    
    limit.last_updated = datetime.utcnow()
    await db.commit()
    await db.refresh(limit)
    return limit

@router.post("/limits", response_model=CreditLimitResponse)
async def create_global_limit(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    amount_cap: float = Query(..., gt=0),
):
    """Create or update the GLOBAL limit (convenience endpoint)"""
    stmt = select(CreditLimit).where(CreditLimit.tenant_id == admin.tenant_id, CreditLimit.level == LimitLevel.GLOBAL)
    limit = (await db.execute(stmt)).scalar_one_or_none()
    
    if limit:
        limit.amount_cap = amount_cap
    else:
        limit = CreditLimit(
            tenant_id=admin.tenant_id,
            level=LimitLevel.GLOBAL,
            amount_cap=amount_cap,
            reset_frequency="MONTHLY",
            period_start=datetime.utcnow()
        )
        db.add(limit)
    
    await db.commit()
    await db.refresh(limit)
    return limit

# ==================== REQUESTS ====================

def _level_value(limit: CreditLimit) -> str:
    return limit.level.value if hasattr(limit.level, "value") else str(limit.level)


def _limit_row(limit: CreditLimit, *, title: str, subtitle: str = "", class_name: str | None = None,
               teacher_name: str | None = None, school_name: str | None = None) -> dict:
    cap = float(limit.amount_cap or 0.0)
    bonus = float(limit.bonus_credits or 0.0)
    used = float(limit.current_usage or 0.0)
    eff = cap + bonus
    remaining = max(eff - used, 0.0)
    if cap <= 0:
        state = "unlimited"
    elif remaining <= 0:
        state = "exhausted"
    elif remaining / eff <= LOW_BALANCE_RATIO:
        state = "low"
    else:
        state = "ok"
    return {
        "limit_id": str(limit.id) if limit.id else None,
        "level": _level_value(limit),
        "tenant_id": str(limit.tenant_id) if limit.tenant_id else None,
        "teacher_id": str(limit.teacher_id) if limit.teacher_id else None,
        "class_id": str(limit.class_id) if limit.class_id else None,
        "title": title,
        "subtitle": subtitle,
        "teacher_name": teacher_name,
        "school_name": school_name,
        "cap_credits": to_credits(cap),
        "bonus_credits": to_credits(bonus),
        "used_credits": to_credits(used),
        "remaining_credits": to_credits(remaining) if cap > 0 else None,
        "effective_cap_credits": to_credits(eff) if cap > 0 else None,
        "used_pct": round(used / eff * 100, 1) if eff > 0 else 0.0,
        "state": state,
        "period_end": limit.period_end,
    }


class LimitTarget(BaseModel):
    """Identifica un limite per ambito; viene creato al volo se non esiste."""
    limit_id: Optional[uuid.UUID] = None
    level: Optional[LimitLevel] = None
    tenant_id: Optional[uuid.UUID] = None
    teacher_id: Optional[uuid.UUID] = None
    class_id: Optional[uuid.UUID] = None


class LimitSetBody(LimitTarget):
    cap_credits: float = Field(..., ge=0)


class BundleBody(LimitTarget):
    credits: float = Field(..., gt=0)
    note: Optional[str] = None


async def _resolve_limit(db: AsyncSession, target: LimitTarget, *, create_cap: float | None = None) -> CreditLimit:
    """Trova (o crea) il limite indicato dall'admin."""
    if target.limit_id:
        limit = (await db.execute(select(CreditLimit).where(CreditLimit.id == target.limit_id))).scalar_one_or_none()
        if not limit:
            raise HTTPException(status_code=404, detail="Limite non trovato")
        return limit
    if not target.level:
        raise HTTPException(status_code=422, detail="Specifica limit_id oppure level")

    level = target.level
    tenant_id = target.tenant_id
    if level == LimitLevel.CLASS:
        if not target.class_id:
            raise HTTPException(status_code=422, detail="class_id obbligatorio per i limiti di classe")
        cls = (await db.execute(select(TeacherClass).where(TeacherClass.id == target.class_id))).scalar_one_or_none()
        if not cls:
            raise HTTPException(status_code=404, detail="Classe non trovata")
        tenant_id = cls.tenant_id
        stmt = select(CreditLimit).where(CreditLimit.level == LimitLevel.CLASS, CreditLimit.class_id == cls.id)
        extra = {"class_id": cls.id, "teacher_id": cls.teacher_id}
    elif level == LimitLevel.TEACHER:
        if not target.teacher_id:
            raise HTTPException(status_code=422, detail="teacher_id obbligatorio")
        teacher = (await db.execute(select(User).where(User.id == target.teacher_id))).scalar_one_or_none()
        if not teacher or not teacher.tenant_id:
            raise HTTPException(status_code=404, detail="Docente non trovato o privo di tenant")
        tenant_id = teacher.tenant_id
        stmt = select(CreditLimit).where(
            CreditLimit.level == LimitLevel.TEACHER, CreditLimit.teacher_id == teacher.id,
            CreditLimit.tenant_id == tenant_id,
        )
        extra = {"teacher_id": teacher.id}
    elif level in (LimitLevel.GLOBAL, LimitLevel.STUDENT_POOL):
        if not tenant_id:
            raise HTTPException(status_code=422, detail="tenant_id obbligatorio")
        stmt = select(CreditLimit).where(CreditLimit.level == level, CreditLimit.tenant_id == tenant_id)
        if level == LimitLevel.STUDENT_POOL:
            if target.teacher_id:
                stmt = stmt.where(CreditLimit.teacher_id == target.teacher_id)
            else:
                stmt = stmt.where(CreditLimit.teacher_id.is_(None))
        extra = {"teacher_id": target.teacher_id} if level == LimitLevel.STUDENT_POOL else {}
    else:
        raise HTTPException(status_code=422, detail="Livello non gestibile da qui")

    limit = (await db.execute(stmt.order_by(CreditLimit.last_updated.desc()).limit(1))).scalar_one_or_none()
    if limit:
        return limit
    limit = credit_service._make_monthly_limit(tenant_id, level, create_cap or 0.0, **extra)
    db.add(limit)
    await db.flush()
    return limit


async def _sync_tenant_defaults(db: AsyncSession, limit: CreditLimit, cap: float) -> None:
    """Allinea i default di tenant quando si cambia il pool di un istituto/individuale."""
    level = limit.level
    if level in (LimitLevel.GLOBAL, LimitLevel.STUDENT_POOL) and limit.tenant_id and limit.teacher_id is None:
        tenant = (await db.execute(select(Tenant).where(Tenant.id == limit.tenant_id))).scalar_one_or_none()
        if tenant:
            tenant.monthly_credit_pool = cap


@router.post("/requests", status_code=201)
async def create_credit_request(
    body: CreditRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Il docente chiede un nuovo bundle: arriva all'admin che può autorizzarlo."""
    limit: CreditLimit | None = None
    if body.limit_id:
        limit = (await db.execute(select(CreditLimit).where(
            CreditLimit.id == body.limit_id, CreditLimit.tenant_id == user.tenant_id,
        ))).scalar_one_or_none()
        if not limit:
            raise HTTPException(status_code=404, detail="Limite non trovato")
    else:
        limits = await credit_service.get_applicable_limits(db, user.tenant_id, teacher_id=user.id)
        constrained = [l for l in limits if float(l.amount_cap or 0) > 0]
        if constrained:
            limit = min(constrained, key=lambda l: effective_cap(l) - float(l.current_usage or 0.0))

    duplicate = (await db.execute(
        select(CreditRequest.id).where(
            CreditRequest.requester_id == user.id,
            CreditRequest.status == CreditRequestStatus.PENDING,
            CreditRequest.limit_id == (limit.id if limit else None),
        )
    )).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Hai già una richiesta di crediti in attesa")

    req = CreditRequest(
        tenant_id=user.tenant_id,
        requester_id=user.id,
        amount_requested=from_credits(body.credits),
        reason=(body.reason or "").strip() or None,
        limit_id=limit.id if limit else None,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return {"id": str(req.id), "status": req.status.value, "credits": body.credits}


@router.get("/requests")
async def list_credit_requests(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    status: Optional[CreditRequestStatus] = None,
):
    """Richieste di bundle (cross-tenant) con scope leggibile."""
    stmt = select(CreditRequest, User, CreditLimit).join(User, User.id == CreditRequest.requester_id) \
        .outerjoin(CreditLimit, CreditLimit.id == CreditRequest.limit_id)
    if status:
        stmt = stmt.where(CreditRequest.status == status)
    stmt = stmt.order_by(desc(CreditRequest.created_at)).limit(300)
    rows = (await db.execute(stmt)).all()
    items = []
    for req, requester, limit in rows:
        scope = await credit_service.describe_limit(db, limit) if limit else {"title": "Cap docente", "subtitle": ""}
        items.append({
            "id": str(req.id),
            "status": req.status.value,
            "requester_id": str(req.requester_id),
            "requester_name": f"{requester.first_name or ''} {requester.last_name or ''}".strip() or requester.email,
            "requester_email": requester.email,
            "credits": to_credits(req.amount_requested),
            "reason": req.reason,
            "limit_id": str(req.limit_id) if req.limit_id else None,
            "level": _level_value(limit) if limit else "TEACHER",
            "scope_title": scope["title"],
            "scope_subtitle": scope["subtitle"],
            "remaining_credits": to_credits(max(effective_cap(limit) - float(limit.current_usage or 0), 0)) if limit and float(limit.amount_cap or 0) > 0 else None,
            "created_at": req.created_at,
            "reviewed_at": req.reviewed_at,
            "admin_notes": req.admin_notes,
        })
    return items


class RequestReviewBody(BaseModel):
    status: CreditRequestStatus
    admin_notes: Optional[str] = None
    credits: Optional[float] = Field(None, gt=0)  # se diverso dal richiesto


@router.post("/requests/{request_id}/review")
async def review_credit_request(
    request_id: uuid.UUID,
    review: RequestReviewBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Approva (accredita il bundle subito) o rifiuta una richiesta."""
    req = (await db.execute(select(CreditRequest).where(CreditRequest.id == request_id))).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != CreditRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail="Request already reviewed")
    if review.status == CreditRequestStatus.PENDING:
        raise HTTPException(status_code=422, detail="Stato non valido")

    req.status = review.status
    req.admin_notes = review.admin_notes
    req.reviewed_by_id = admin.id
    req.reviewed_at = datetime.now(timezone.utc)

    granted = None
    if review.status == CreditRequestStatus.APPROVED:
        granted = review.credits if review.credits else to_credits(req.amount_requested)
        if req.limit_id:
            limit = (await db.execute(select(CreditLimit).where(CreditLimit.id == req.limit_id))).scalar_one_or_none()
        else:
            limit = None
        if not limit:
            limit = await _resolve_limit(db, LimitTarget(level=LimitLevel.TEACHER, teacher_id=req.requester_id))
        await credit_service.add_bundle(
            db, limit, granted, admin_id=admin.id, note=review.admin_notes, request_id=req.id,
        )
    await db.commit()
    await db.refresh(req)

    try:
        await sio.emit(
            "teacher_notification",
            {
                "type": "credit_request_reviewed",
                "message": (
                    f"Richiesta crediti approvata: +{round(granted)} crediti"
                    if granted else "Richiesta crediti non approvata"
                ),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            room=f"user:{req.requester_id}",
        )
    except Exception:
        pass
    return {"id": str(req.id), "status": req.status.value, "credits_granted": granted}


# ==================== ADMIN HUB: set / bundle / alerts ====================

@router.get("/admin/overview")
async def admin_credit_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Tutti i budget della piattaforma in crediti: istituti, docenti, classi."""
    now = datetime.now(timezone.utc)
    limits = (await db.execute(select(CreditLimit))).scalars().all()
    changed = False
    for lim in limits:
        if reset_if_due(lim, now):
            db.add(lim)
            changed = True
    if changed:
        await db.commit()

    tenants = {t.id: t for t in (await db.execute(select(Tenant))).scalars().all()}
    teachers = {u.id: u for u in (await db.execute(
        select(User).where(User.role.in_([UserRole.TEACHER, UserRole.ADMIN]), User.is_active == True)  # noqa: E712
    )).scalars().all()}
    classes = (await db.execute(
        select(TeacherClass).where(TeacherClass.is_system == False, TeacherClass.archived_at.is_(None))  # noqa: E712
    )).scalars().all()

    def tname(u: User | None) -> str | None:
        if not u:
            return None
        return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email

    schools, pools, teacher_rows = [], [], []
    class_limit_by_id: dict = {}
    teacher_limit_ids: set = set()
    for lim in limits:
        lvl = lim.level
        tenant = tenants.get(lim.tenant_id)
        t_name = tenant.name if tenant else None
        if lvl == LimitLevel.GLOBAL:
            schools.append(_limit_row(lim, title=t_name or "Istituto", subtitle="Pool crediti istituto", school_name=t_name))
        elif lvl == LimitLevel.STUDENT_POOL:
            owner = teachers.get(lim.teacher_id) if lim.teacher_id else None
            pools.append(_limit_row(
                lim, title=f"Pool studenti · {tname(owner)}" if owner else f"Pool studenti · {t_name or '—'}",
                subtitle=t_name or "", teacher_name=tname(owner), school_name=t_name,
            ))
        elif lvl == LimitLevel.TEACHER:
            owner = teachers.get(lim.teacher_id)
            teacher_limit_ids.add(lim.teacher_id)
            teacher_rows.append(_limit_row(
                lim, title=tname(owner) or "Docente", subtitle=(owner.email if owner else "") or "",
                teacher_name=tname(owner), school_name=t_name,
            ))
        elif lvl == LimitLevel.CLASS:
            class_limit_by_id[lim.class_id] = lim

    # Docenti senza limite creato: li mostriamo comunque, con il default del tenant.
    for tid, owner in teachers.items():
        if tid in teacher_limit_ids or owner.role != UserRole.TEACHER or not owner.tenant_id:
            continue
        owner_tenant = tenants.get(owner.tenant_id)
        stub = CreditLimit(
            tenant_id=owner.tenant_id, level=LimitLevel.TEACHER, teacher_id=tid,
            # Default che verrà creato al primo utilizzo (cap del tenant)
            amount_cap=float(getattr(owner_tenant, "teacher_monthly_cap", 3.0) or 3.0),
            current_usage=0.0, bonus_credits=0.0, period_end=None,
        )
        row = _limit_row(stub, title=tname(owner) or "Docente", subtitle=owner.email or "",
                         teacher_name=tname(owner), school_name=tenants.get(owner.tenant_id).name if tenants.get(owner.tenant_id) else None)
        row["limit_id"] = None
        teacher_rows.append(row)

    class_rows = []
    for cls in classes:
        owner = teachers.get(cls.teacher_id)
        school = tenants.get(cls.school_tenant_id) or tenants.get(cls.tenant_id)
        lim = class_limit_by_id.get(cls.id)
        if lim is None:
            lim = CreditLimit(
                tenant_id=cls.tenant_id, level=LimitLevel.CLASS, class_id=cls.id, teacher_id=cls.teacher_id,
                amount_cap=0.0, current_usage=0.0, bonus_credits=0.0,
            )
            row = _limit_row(lim, title=cls.name, subtitle=tname(owner) or "", class_name=cls.name,
                             teacher_name=tname(owner), school_name=school.name if school else None)
            row["limit_id"] = None
        else:
            row = _limit_row(lim, title=cls.name, subtitle=tname(owner) or "", class_name=cls.name,
                             teacher_name=tname(owner), school_name=school.name if school else None)
        row["class_id"] = str(cls.id)
        class_rows.append(row)

    all_rows = schools + pools + teacher_rows + class_rows
    counts = {
        "exhausted": sum(1 for r in all_rows if r["state"] == "exhausted"),
        "low": sum(1 for r in all_rows if r["state"] == "low"),
    }
    return {
        "schools": schools,
        "student_pools": pools,
        "teachers": teacher_rows,
        "classes": class_rows,
        "counts": counts,
    }


@router.put("/admin/limits")
async def admin_set_limit(
    body: LimitSetBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Imposta il cap mensile (in crediti) di un istituto, docente o classe. 0 = nessun limite."""
    cap = from_credits(body.cap_credits)
    limit = await _resolve_limit(db, body, create_cap=cap)
    limit.amount_cap = cap
    limit.last_updated = datetime.now(timezone.utc)
    db.add(limit)
    await _sync_tenant_defaults(db, limit, cap)
    await credit_service.sync_alert(db, limit)
    await db.commit()
    await db.refresh(limit)
    return {"limit_id": str(limit.id), "cap_credits": to_credits(limit.amount_cap)}


@router.post("/admin/bundle")
async def admin_force_bundle(
    body: BundleBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Forza l'aggiunta di un bundle di crediti, valido da subito anche a metà mese."""
    limit = await _resolve_limit(db, body)
    if float(limit.amount_cap or 0.0) <= 0:
        raise HTTPException(
            status_code=409,
            detail="Questo ambito non ha un limite impostato: imposta prima un cap mensile.",
        )
    await credit_service.add_bundle(db, limit, body.credits, admin_id=admin.id, note=body.note)
    await db.commit()
    await db.refresh(limit)
    return _limit_row(limit, title="")


@router.get("/admin/alerts")
async def admin_list_alerts(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    include_resolved: bool = False,
):
    stmt = select(CreditAlert, CreditLimit).join(CreditLimit, CreditLimit.id == CreditAlert.limit_id)
    if not include_resolved:
        stmt = stmt.where(CreditAlert.status == "OPEN")
    rows = (await db.execute(stmt.order_by(desc(CreditAlert.created_at)).limit(200))).all()
    items = []
    for alert, limit in rows:
        scope = await credit_service.describe_limit(db, limit)
        items.append({
            "id": str(alert.id),
            "severity": alert.severity,
            "status": alert.status,
            "message": alert.message,
            "limit_id": str(limit.id),
            "level": _level_value(limit),
            "tenant_id": str(limit.tenant_id) if limit.tenant_id else None,
            "teacher_id": str(limit.teacher_id) if limit.teacher_id else None,
            "class_id": str(limit.class_id) if limit.class_id else None,
            "scope_title": scope["title"],
            "scope_subtitle": scope["subtitle"],
            "cap_credits": to_credits(alert.cap_snapshot),
            "used_credits": to_credits(alert.usage_snapshot),
            "created_at": alert.created_at,
            "resolved_at": alert.resolved_at,
        })
    return items


@router.get("/admin/badge")
async def admin_credit_badge(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Contatori per il badge della sidebar admin."""
    alerts = (await db.execute(
        select(func.count()).select_from(CreditAlert).where(CreditAlert.status == "OPEN")
    )).scalar() or 0
    exhausted = (await db.execute(
        select(func.count()).select_from(CreditAlert).where(CreditAlert.status == "OPEN", CreditAlert.severity == "EXHAUSTED")
    )).scalar() or 0
    pending = (await db.execute(
        select(func.count()).select_from(CreditRequest).where(CreditRequest.status == CreditRequestStatus.PENDING)
    )).scalar() or 0
    return {"open_alerts": alerts, "exhausted": exhausted, "pending_requests": pending, "total": alerts + pending}


# ==================== INVITATIONS ====================

@router.post("/invitations", response_model=PlatformInvitationResponse)
async def invite_teacher(
    invitation: PlatformInvitationCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """
    Invite a new teacher via email.
    Il docente invitato viene inserito nella scuola dell'admin (admin.tenant_id),
    NON in un tenant individuale separato. La licenza resta individuale:
    - CreditLimit TEACHER €3/mese (cap mensile personale del docente)
    """
    email = invitation.email.strip().lower()

    # Scade inviti pending precedenti
    existing_pending_invitations = (await db.execute(
        select(PlatformInvitation).where(
            PlatformInvitation.email == email,
            PlatformInvitation.status == InvitationStatus.PENDING.value,
        )
    )).scalars().all()
    for existing_inv in existing_pending_invitations:
        existing_inv.status = InvitationStatus.EXPIRED.value
        existing_inv.responded_at = datetime.utcnow()

    # Controlla se esiste già un utente attivo con questa email
    existing_user = (await db.execute(
        select(User).where(User.email == email).order_by(desc(User.created_at)).limit(1)
    )).scalar_one_or_none()

    # I docenti invitati vengono inseriti nella scuola (tenant dell'admin) e NON
    # creano più un tenant individuale separato a testa. La licenza resta però
    # individuale: ogni docente riceve un proprio cap mensile personale.
    if existing_user and existing_user.is_active:
        # Reuse existing active user — aggiorna i dati ma mantieni il tenant esistente
        user = existing_user
        user.role = UserRole.TEACHER
        user.first_name = invitation.first_name
        user.last_name = invitation.last_name
        user.institution = invitation.school
        user.is_verified = True
        await db.flush()
    else:
        if existing_user and not existing_user.is_active:
            user = existing_user
            user.tenant_id = admin.tenant_id
            user.role = UserRole.TEACHER
            user.first_name = invitation.first_name
            user.last_name = invitation.last_name
            user.institution = invitation.school
            user.is_verified = True
            user.is_active = True
            user.deactivated_at = None
            user.deactivated_by_admin_id = None
        else:
            user = User(
                tenant_id=admin.tenant_id,
                email=email,
                password_hash="",
                role=UserRole.TEACHER,
                first_name=invitation.first_name,
                last_name=invitation.last_name,
                institution=invitation.school,
                is_verified=True,
            )
            db.add(user)
        await db.flush()

        # Licenza individuale: cap mensile personale del docente (default 3€,
        # o il teacher_monthly_cap configurato sulla scuola).
        tenant_obj = (await db.execute(
            select(Tenant).where(Tenant.id == admin.tenant_id)
        )).scalar_one_or_none()
        teacher_cap = float(getattr(tenant_obj, "teacher_monthly_cap", 3.0) or 3.0)
        await credit_service.ensure_teacher_limit(db, admin.tenant_id, user.id, teacher_cap)

    _activation, activation_token = await _create_activation_token_for_user(db, user)

    inv = PlatformInvitation(
        tenant_id=admin.tenant_id,
        email=email,
        first_name=invitation.first_name,
        last_name=invitation.last_name,
        school=invitation.school,
        group_tag=invitation.group_tag,
        custom_message=invitation.custom_message,
        role="TEACHER",
        token=secrets.token_urlsafe(32),
        status="pending",
        invited_by_id=admin.id,
        expires_at=datetime.utcnow() + timedelta(days=7)
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)

    email_sent = await _send_platform_invitation_email(
        db=db,
        request=request,
        admin=admin,
        invitation=inv,
        activation_token=activation_token,
    )
    inv.email_sent = email_sent

    return inv


@router.post("/invitations/{invitation_id}/resend", response_model=PlatformInvitationResponse)
async def resend_teacher_invitation(
    invitation_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    same_tenant_users = select(User.id).where(User.tenant_id == admin.tenant_id)
    invitation = (await db.execute(
        select(PlatformInvitation).where(
            PlatformInvitation.id == invitation_id,
            or_(
                PlatformInvitation.tenant_id == admin.tenant_id,
                PlatformInvitation.invited_by_id.in_(same_tenant_users),
            ),
        )
    )).scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    user = (await db.execute(
        select(User).where(User.email == invitation.email).order_by(desc(User.created_at)).limit(1)
    )).scalar_one_or_none()
    if user and not user.is_active:
        user.is_active = True
        user.deactivated_at = None
        user.deactivated_by_admin_id = None
    if user:
        user.tenant_id = admin.tenant_id
        user.role = UserRole.TEACHER
        user.first_name = invitation.first_name
        user.last_name = invitation.last_name
        user.institution = invitation.school
        user.is_verified = True
        await db.flush()
    else:
        user = User(
            tenant_id=admin.tenant_id,
            email=invitation.email,
            password_hash="",
            role=UserRole.TEACHER,
            first_name=invitation.first_name,
            last_name=invitation.last_name,
            institution=invitation.school,
            is_verified=True,
        )
        db.add(user)
        await db.flush()

    # Licenza individuale del docente nella scuola (cap mensile personale).
    tenant_obj = (await db.execute(
        select(Tenant).where(Tenant.id == admin.tenant_id)
    )).scalar_one_or_none()
    teacher_cap = float(getattr(tenant_obj, "teacher_monthly_cap", 3.0) or 3.0)
    await credit_service.ensure_teacher_limit(db, admin.tenant_id, user.id, teacher_cap)

    _activation, activation_token = await _create_activation_token_for_user(db, user)

    invitation.status = InvitationStatus.PENDING.value
    invitation.responded_at = None
    invitation.expires_at = datetime.utcnow() + timedelta(days=7)
    invitation.token = secrets.token_urlsafe(32)
    invitation.invited_by_id = admin.id
    # Riallinea l'invito alla scuola dell'admin così resta visibile in elenco.
    invitation.tenant_id = admin.tenant_id

    await db.commit()
    await db.refresh(invitation)

    email_sent = await _send_platform_invitation_email(
        db=db,
        request=request,
        admin=admin,
        invitation=invitation,
        activation_token=activation_token,
    )
    invitation.email_sent = email_sent

    return invitation


@router.delete("/invitations/{invitation_id}")
async def delete_teacher_invitation(
    invitation_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    same_tenant_users = select(User.id).where(User.tenant_id == admin.tenant_id)
    invitation = (await db.execute(
        select(PlatformInvitation).where(
            PlatformInvitation.id == invitation_id,
            or_(
                PlatformInvitation.tenant_id == admin.tenant_id,
                PlatformInvitation.invited_by_id.in_(same_tenant_users),
            ),
        )
    )).scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    user = (await db.execute(
        select(User).where(User.email == invitation.email).order_by(desc(User.created_at)).limit(1)
    )).scalar_one_or_none()

    if user and not user.last_login_at:
        # Never logged in → safe to deactivate the account and cancel tokens
        user.is_active = False
        user.deactivated_at = datetime.utcnow()
        user.deactivated_by_admin_id = admin.id
        old_tokens = (await db.execute(
            select(ActivationToken).where(
                ActivationToken.user_id == user.id,
                ActivationToken.is_used == False,  # noqa: E712
            )
        )).scalars().all()
        for tok in old_tokens:
            tok.is_used = True
            tok.used_at = datetime.utcnow()
    # If user has logged in, only remove the invitation record — leave the account intact.

    await db.delete(invitation)
    await db.commit()

    return {"message": f"Invito rimosso per {invitation.email}"}

@router.post("/invitations/bulk", response_model=List[PlatformInvitationResponse])
async def bulk_invite_teachers(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    file: UploadFile = File(...),
):
    """Bulk invite teachers via CSV (email, first_name, last_name, school)"""
    content = await file.read()
    text = content.decode("utf-8")
    
    csv_reader = csv.DictReader(io.StringIO(text))
    invitations = []
    
    for row in csv_reader:
        email = row.get("email")
        if not email:
            continue
            
        # Basic check
        stmt = select(User).where(User.email == email).order_by(desc(User.created_at)).limit(1)
        existing_user = (await db.execute(stmt)).scalar_one_or_none()
        if existing_user and existing_user.is_active:
            continue
            
        token = secrets.token_urlsafe(32)
        temp_password = secrets.token_urlsafe(12)
        activation_token = secrets.token_urlsafe(48)

        if existing_user and not existing_user.is_active:
            user = existing_user
            user.tenant_id = admin.tenant_id
            user.password_hash = get_password_hash(temp_password)
            user.role = UserRole.TEACHER
            user.first_name = row.get("first_name")
            user.last_name = row.get("last_name")
            user.institution = row.get("school")
            user.is_verified = True
            user.is_active = True
            user.deactivated_at = None
            user.deactivated_by_admin_id = None
            await db.flush()
        else:
            user = User(
                tenant_id=admin.tenant_id,
                email=email,
                password_hash=get_password_hash(temp_password),
                role=UserRole.TEACHER,
                first_name=row.get("first_name"),
                last_name=row.get("last_name"),
                institution=row.get("school"),
                is_verified=True,
            )
            db.add(user)
            await db.flush()

        activation = ActivationToken(
            user_id=user.id,
            token=activation_token,
            temporary_password=temp_password,
            expires_at=datetime.utcnow() + timedelta(hours=72),
        )
        db.add(activation)

        inv = PlatformInvitation(
            tenant_id=admin.tenant_id,
            email=email,
            first_name=row.get("first_name"),
            last_name=row.get("last_name"),
            school=row.get("school"),
            role="TEACHER",
            token=token,
            status="pending",
            invited_by_id=admin.id,
            expires_at=datetime.utcnow() + timedelta(days=7)
        )
        db.add(inv)
        invitations.append((inv, activation_token))
    
    if invitations:
        await db.commit()
        tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
        templates = _tenant_template_args(tenant, "teacher_invitation")
        base_frontend = resolve_frontend_url(request.headers.get("origin"))
        for inv, activation_token in invitations:
            await db.refresh(inv)
            try:
                activation_link = f"{base_frontend}/activate/{activation_token}"
                await email_service.send_invitation_email(
                    to_email=inv.email,
                    first_name=inv.first_name or "Docente",
                    link=activation_link,
                    subject_template=templates.get("subject_template"),
                    html_template=templates.get("html_template"),
                    text_template=templates.get("text_template"),
                )
            except Exception as e:
                # logger.error(f"Failed to send email to {inv.email}: {e}")
                pass

    return [inv for inv, _activation_token in invitations]

@router.post("/invitations/bulk-json", response_model=List[PlatformInvitationResponse])
async def bulk_invite_teachers_json(
    payload: BulkInvitationCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Bulk invite teachers from parsed JSON (CSV parsed client-side).
    Accepts group_tag and custom_message applied to all rows."""
    group_tag = payload.group_tag
    custom_message = payload.custom_message

    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
    templates = _tenant_template_args(tenant, "teacher_invitation")
    base_frontend = resolve_frontend_url(request.headers.get("origin"))

    created: list[tuple[PlatformInvitation, str]] = []

    for item in payload.teachers:
        email = str(item.email).lower().strip()

        stmt = select(User).where(User.email == email).order_by(desc(User.created_at)).limit(1)
        existing_user = (await db.execute(stmt)).scalar_one_or_none()
        if existing_user and existing_user.is_active:
            continue

        stmt = select(PlatformInvitation).where(
            PlatformInvitation.email == email,
            PlatformInvitation.status == "pending",
        )
        if (await db.execute(stmt)).scalar_one_or_none():
            continue

        token = secrets.token_urlsafe(32)
        temp_password = secrets.token_urlsafe(12)
        activation_token = secrets.token_urlsafe(48)

        if existing_user and not existing_user.is_active:
            user = existing_user
            user.tenant_id = admin.tenant_id
            user.password_hash = get_password_hash(temp_password)
            user.role = UserRole.TEACHER
            user.first_name = item.first_name
            user.last_name = item.last_name
            user.institution = item.school
            user.is_verified = True
            user.is_active = True
            user.deactivated_at = None
            user.deactivated_by_admin_id = None
            await db.flush()
        else:
            user = User(
                tenant_id=admin.tenant_id,
                email=email,
                password_hash=get_password_hash(temp_password),
                role=UserRole.TEACHER,
                first_name=item.first_name,
                last_name=item.last_name,
                institution=item.school,
                is_verified=True,
            )
            db.add(user)
            await db.flush()

        activation = ActivationToken(
            user_id=user.id,
            token=activation_token,
            temporary_password=temp_password,
            expires_at=datetime.utcnow() + timedelta(hours=72),
        )
        db.add(activation)

        inv = PlatformInvitation(
            tenant_id=admin.tenant_id,
            email=email,
            first_name=item.first_name,
            last_name=item.last_name,
            school=item.school,
            group_tag=group_tag,
            custom_message=custom_message,
            role="TEACHER",
            token=token,
            status="pending",
            invited_by_id=admin.id,
            expires_at=datetime.utcnow() + timedelta(days=7),
        )
        db.add(inv)
        created.append((inv, activation_token))

    if created:
        await db.commit()
        for inv, act_token in created:
            await db.refresh(inv)
            try:
                activation_link = f"{base_frontend}/activate/{act_token}"
                await email_service.send_invitation_email(
                    to_email=inv.email,
                    first_name=inv.first_name or "Docente",
                    link=activation_link,
                    custom_message=custom_message,
                    group_tag=group_tag,
                    subject_template=templates.get("subject_template"),
                    html_template=templates.get("html_template"),
                    text_template=templates.get("text_template"),
                )
            except Exception:
                pass

    return [inv for inv, _ in created]


@router.get("/invitations", response_model=List[PlatformInvitationResponse])
async def list_invitations(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    # Mostra gli inviti della scuola dell'admin. Include anche eventuali inviti
    # "legacy" agganciati a tenant individuali orfani, riconoscendoli dal fatto
    # che sono stati creati da un admin della stessa scuola.
    same_tenant_users = select(User.id).where(User.tenant_id == admin.tenant_id)
    stmt = select(PlatformInvitation).where(
        or_(
            PlatformInvitation.tenant_id == admin.tenant_id,
            PlatformInvitation.invited_by_id.in_(same_tenant_users),
        )
    ).order_by(desc(PlatformInvitation.created_at))
    invitations = (await db.execute(stmt)).scalars().all()

    changed = False
    from datetime import timezone as _tz
    now = datetime.now(_tz.utc)
    for invitation in invitations:
        if invitation.status != InvitationStatus.PENDING.value:
            continue

        user = (await db.execute(
            select(User).where(func.lower(User.email) == invitation.email.lower()).order_by(desc(User.created_at)).limit(1)
        )).scalar_one_or_none()

        if user and user.last_login_at:
            invitation.status = InvitationStatus.ACCEPTED.value
            invitation.responded_at = user.last_login_at
            changed = True
            continue

        if invitation.expires_at and invitation.expires_at < now:
            invitation.status = InvitationStatus.EXPIRED.value
            invitation.responded_at = invitation.responded_at or invitation.expires_at
            changed = True

    if changed:
        await db.commit()
        for invitation in invitations:
            await db.refresh(invitation)

    return invitations
