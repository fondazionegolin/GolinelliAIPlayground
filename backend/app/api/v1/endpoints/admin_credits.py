from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, or_, and_
from typing import Annotated, List, Optional
from datetime import datetime, timedelta
import uuid
import csv
import io
import secrets

from app.core.database import get_db
from app.core.config import settings
from app.core.url_utils import resolve_frontend_url
from app.core.security import get_password_hash
from app.api.deps import get_current_admin
from app.services.email_service import email_service
from app.models.user import User, ActivationToken
from app.models.tenant import Tenant
from app.models.invitation import PlatformInvitation
from app.models.credits import CreditLimit, CreditTransaction, CreditRequest
from app.models.enums import LimitLevel, CreditRequestStatus, InvitationStatus, CreditTransactionType, UserRole
from app.schemas.credits import (
    CreditLimitResponse, CreditLimitUpdate, CreditLimitBase,
    CreditTransactionResponse, ConsumptionStats,
    CreditRequestResponse, CreditRequestReview,
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
) -> None:
    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
    templates = _tenant_template_args(tenant, "teacher_invitation")
    activation_link = f"{resolve_frontend_url(request.headers.get('origin'))}/activate/{activation_token}"
    await email_service.send_invitation_email(
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

@router.get("/requests", response_model=List[CreditRequestResponse])
async def list_credit_requests(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    status: Optional[CreditRequestStatus] = None,
):
    """List credit requests"""
    stmt = select(CreditRequest).where(CreditRequest.tenant_id == admin.tenant_id)
    if status:
        stmt = stmt.where(CreditRequest.status == status)
    stmt = stmt.order_by(desc(CreditRequest.created_at))
    
    result = await db.execute(stmt)
    return result.scalars().all()

@router.post("/requests/{request_id}/review", response_model=CreditRequestResponse)
async def review_credit_request(
    request_id: uuid.UUID,
    review: CreditRequestReview,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Approve or reject a credit request"""
    stmt = select(CreditRequest).where(CreditRequest.id == request_id, CreditRequest.tenant_id == admin.tenant_id)
    req = (await db.execute(stmt)).scalar_one_or_none()
    
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    
    if req.status != CreditRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail="Request already reviewed")
    
    req.status = review.status
    req.admin_notes = review.admin_notes
    req.reviewed_by_id = admin.id
    req.reviewed_at = datetime.utcnow()
    
    if review.status == CreditRequestStatus.APPROVED:
        # If approved, we should ideally increase the teacher's limit or allocate credits
        # For now, we assume this is a manual process or we automate it here
        # Let's find the teacher's limit
        stmt = select(CreditLimit).where(
            CreditLimit.teacher_id == req.requester_id, 
            CreditLimit.level == LimitLevel.TEACHER
        )
        limit = (await db.execute(stmt)).scalar_one_or_none()
        if limit:
            limit.amount_cap += req.amount_requested
            # Also reset usage if they were blocked? Or just increasing cap is enough.
        else:
            # Create limit if missing
             limit = CreditLimit(
                tenant_id=req.tenant_id,
                level=LimitLevel.TEACHER,
                teacher_id=req.requester_id,
                amount_cap=req.amount_requested, # Start with requested amount? Or base + requested
                reset_frequency="MONTHLY",
                period_start=datetime.utcnow()
            )
             db.add(limit)
        
        # Log allocation transaction
        tx = CreditTransaction(
            tenant_id=req.tenant_id,
            transaction_type=CreditTransactionType.ALLOCATION,
            cost=-req.amount_requested, # Negative cost = credit? Or just log amount. Cost usually positive for expense.
            # If cost is expense, then allocation is... weird. 
            # Let's say cost is strictly expense. 
            # We don't store "balance", we store "usage" vs "cap".
            # So Request is just to increase Cap.
            # We don't need a transaction for increasing cap, but audit is good.
            usage_details={"request_id": str(req.id), "notes": "Credit Request Approved"},
            teacher_id=req.requester_id
        )
        db.add(tx)

    await db.commit()
    await db.refresh(req)
    return req

# ==================== INVITATIONS ====================

@router.post("/invitations", response_model=PlatformInvitationResponse)
async def invite_teacher(
    invitation: PlatformInvitationCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Invite a new teacher via email"""
    email = invitation.email.strip().lower()

    # Check if user already exists — use .limit(1) to avoid MultipleResultsFound
    stmt = select(User).where(User.email == email).order_by(desc(User.created_at)).limit(1)
    existing_user = (await db.execute(stmt)).scalar_one_or_none()
    # Any active user can be reinvited; their role will be set/confirmed to TEACHER
    can_reinvite_existing_user = bool(existing_user and existing_user.is_active)

    existing_pending_invitations = (await db.execute(
        select(PlatformInvitation).where(
            PlatformInvitation.email == email,
            PlatformInvitation.status == InvitationStatus.PENDING.value,
        )
    )).scalars().all()
    for existing_inv in existing_pending_invitations:
        existing_inv.status = InvitationStatus.EXPIRED.value
        existing_inv.responded_at = datetime.utcnow()

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
        await db.flush()
    elif can_reinvite_existing_user and existing_user:
        user = existing_user
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
        token=token,
        status="pending",
        invited_by_id=admin.id,
        expires_at=datetime.utcnow() + timedelta(days=7)
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)

    await _send_platform_invitation_email(
        db=db,
        request=request,
        admin=admin,
        invitation=inv,
        activation_token=activation_token,
    )

    return inv


@router.post("/invitations/{invitation_id}/resend", response_model=PlatformInvitationResponse)
async def resend_teacher_invitation(
    invitation_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    invitation = (await db.execute(
        select(PlatformInvitation).where(
            PlatformInvitation.id == invitation_id,
            PlatformInvitation.tenant_id == admin.tenant_id,
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

    _activation, activation_token = await _create_activation_token_for_user(db, user)

    invitation.status = InvitationStatus.PENDING.value
    invitation.responded_at = None
    invitation.expires_at = datetime.utcnow() + timedelta(days=7)
    invitation.token = secrets.token_urlsafe(32)
    invitation.invited_by_id = admin.id

    await db.commit()
    await db.refresh(invitation)

    await _send_platform_invitation_email(
        db=db,
        request=request,
        admin=admin,
        invitation=invitation,
        activation_token=activation_token,
    )

    return invitation


@router.delete("/invitations/{invitation_id}")
async def delete_teacher_invitation(
    invitation_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    invitation = (await db.execute(
        select(PlatformInvitation).where(
            PlatformInvitation.id == invitation_id,
            PlatformInvitation.tenant_id == admin.tenant_id,
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
    stmt = select(PlatformInvitation).where(PlatformInvitation.tenant_id == admin.tenant_id).order_by(desc(PlatformInvitation.created_at))
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
