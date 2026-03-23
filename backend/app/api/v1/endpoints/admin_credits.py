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
    # Check if user already exists
    stmt = select(User).where(User.email == invitation.email).order_by(desc(User.created_at))
    existing_user = (await db.execute(stmt)).scalar_one_or_none()
    if existing_user and existing_user.is_active:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    
    # Check if invitation already exists — if the user was deleted/deactivated, cancel the old invite and allow re-invite
    stmt = select(PlatformInvitation).where(PlatformInvitation.email == invitation.email, PlatformInvitation.status == "pending")
    existing_inv = (await db.execute(stmt)).scalar_one_or_none()
    if existing_inv:
        user_is_active = existing_user is not None and existing_user.is_active
        if user_is_active:
            raise HTTPException(status_code=400, detail="Invitation already pending")
        # User was deleted/deactivated — cancel old invite so a new one can be sent
        existing_inv.status = "cancelled"
        await db.flush()
    
    token = secrets.token_urlsafe(32)
    temp_password = secrets.token_urlsafe(12)
    activation_token = secrets.token_urlsafe(48)

    if existing_user and not existing_user.is_active:
        user = existing_user
        user.tenant_id = admin.tenant_id
        user.password_hash = get_password_hash(temp_password)
        user.role = UserRole.TEACHER
        user.first_name = invitation.first_name
        user.last_name = invitation.last_name
        user.institution = invitation.school
        user.is_verified = True
        user.is_active = True
        user.deactivated_at = None
        user.deactivated_by_admin_id = None
        await db.flush()
    else:
        user = User(
            tenant_id=admin.tenant_id,
            email=invitation.email,
            password_hash=get_password_hash(temp_password),
            role=UserRole.TEACHER,
            first_name=invitation.first_name,
            last_name=invitation.last_name,
            institution=invitation.school,
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
        email=invitation.email,
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

    return inv

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
        stmt = select(User).where(User.email == email).order_by(desc(User.created_at))
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

        stmt = select(User).where(User.email == email).order_by(desc(User.created_at))
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
    result = await db.execute(stmt)
    return result.scalars().all()
