from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from typing import Annotated, Optional
from datetime import datetime, timedelta, timezone
from uuid import UUID
import secrets

from app.core.database import get_db
from app.core.security import get_password_hash
from app.core.config import settings
from app.core.url_utils import resolve_frontend_url
from app.api.deps import get_current_admin
from app.models.user import User, TeacherRequest, ActivationToken
from app.models.tenant import Tenant
from app.models.template_version import TenantTemplateVersion
from app.models.session import Session, SessionStudent
from app.models.llm import ConversationMessage, TeacherConversation, TeacherConversationMessage
from app.models.credits import CreditTransaction
from app.models.invitation import PlatformInvitation
from app.models.enums import UserRole, TeacherRequestStatus, TenantStatus
from app.schemas.tenant import TenantCreate, TenantUpdate, TenantResponse
from app.schemas.auth import TeacherRequestResponse
from app.services.email_service import email_service

router = APIRouter()


DEFAULT_TEMPLATE_CATALOG = {
    "teacher_activation": {
        "label": "Messaggio di conferma utente",
        "description": "Invio automatico quando un docente viene approvato e deve attivare l'account.",
        "subject": "🎓 Il tuo account EduAI è stato approvato!",
        "html": "",
        "text": "",
        "placeholders": ["{first_name}", "{last_name}", "{activation_link}"],
    },
    "teacher_invitation": {
        "label": "Messaggio invito docente",
        "description": "Invio automatico quando un docente riceve un invito diretto alla piattaforma.",
        "subject": "👋 Sei stato invitato su EduAI Platform",
        "html": "",
        "text": "",
        "placeholders": ["{first_name}", "{invitation_link}"],
    },
    "password_reset": {
        "label": "Messaggio cambio password",
        "description": "Invio automatico quando un admin resetta la password di un utente.",
        "subject": "🔐 Reset password account EduAI",
        "html": "",
        "text": "",
        "placeholders": ["{first_name}", "{last_name}", "{temporary_password}", "{login_url}"],
    },
    "beta_disclaimer": {
        "label": "Disclaimer beta login",
        "description": "Messaggio mostrato nella landing/login (privacy, AI Act, limiti beta, bug noti).",
        "subject": "",
        "html": (
            "<p><strong>Versione beta.</strong> La piattaforma è in evoluzione continua. "
            "Per uso scolastico con approccio Teacher-in-the-loop, senza scoring o valutazioni automatiche.</p>"
            "<p>I dati inviati ai provider LLM sono configurati con policy di minimizzazione e retention ridotta/zero, "
            "in base ai contratti attivi. Possono verificarsi bug o comportamenti inattesi.</p>"
        ),
        "text": "",
        "placeholders": [],
    },
}


def _catalog_with_tenant_values(tenant: Tenant) -> dict:
    current = tenant.email_templates_json or {}
    merged: dict = {}
    for key, default_meta in DEFAULT_TEMPLATE_CATALOG.items():
        saved = current.get(key) or {}
        merged[key] = {
            "label": default_meta["label"],
            "description": default_meta["description"],
            "placeholders": default_meta["placeholders"],
            "subject": saved.get("subject", default_meta.get("subject", "")),
            "html": saved.get("html", default_meta.get("html", "")),
            "text": saved.get("text", default_meta.get("text", "")),
        }
    return merged


def _template_args(catalog: dict, template_key: str) -> dict:
    template = catalog.get(template_key) or {}
    return {
        "subject_template": template.get("subject"),
        "html_template": template.get("html"),
        "text_template": template.get("text"),
    }


async def _save_template_version(
    db: AsyncSession,
    tenant_id: UUID,
    template_key: str,
    subject: str,
    html: str,
    text: str,
    updated_by_id: UUID | None,
) -> None:
    max_version = (
        await db.execute(
            select(func.coalesce(func.max(TenantTemplateVersion.version), 0)).where(
                TenantTemplateVersion.tenant_id == tenant_id,
                TenantTemplateVersion.template_key == template_key,
            )
        )
    ).scalar() or 0
    db.add(
        TenantTemplateVersion(
            tenant_id=tenant_id,
            template_key=template_key,
            version=int(max_version) + 1,
            subject=subject,
            html=html,
            text=text,
            updated_by_id=updated_by_id,
        )
    )


@router.get("/tenants", response_model=list[TenantResponse])
async def list_tenants(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))
    tenants = result.scalars().all()
    return tenants


@router.post("/tenants", response_model=TenantResponse)
async def create_tenant(
    request: TenantCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    # Check slug uniqueness
    result = await db.execute(select(Tenant).where(Tenant.slug == request.slug))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant slug already exists",
        )
    
    tenant = Tenant(name=request.name, slug=request.slug)
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.patch("/tenants/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: UUID,
    request: TenantUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    
    if request.name is not None:
        tenant.name = request.name
    if request.status is not None:
        tenant.status = TenantStatus(request.status)
    
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.get("/teacher-requests", response_model=list[TeacherRequestResponse])
async def list_teacher_requests(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    status_filter: Optional[str] = Query(None, alias="status"),
):
    query = select(TeacherRequest).order_by(TeacherRequest.created_at.desc())
    if status_filter:
        query = query.where(TeacherRequest.status == TeacherRequestStatus(status_filter))
    
    result = await db.execute(query)
    requests = result.scalars().all()
    
    return [
        TeacherRequestResponse(
            id=r.id,
            email=r.email,
            first_name=r.first_name,
            last_name=r.last_name,
            status=r.status.value,
            tenant_id=r.tenant_id,
            created_at=r.created_at.isoformat(),
        )
        for r in requests
    ]


@router.post("/teacher-requests/{request_id}/approve")
async def approve_teacher_request(
    request_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(
        select(TeacherRequest).where(TeacherRequest.id == request_id)
    )
    teacher_request = result.scalar_one_or_none()
    if not teacher_request:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    
    if teacher_request.status != TeacherRequestStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request already processed")
    
    # Generate random temporary password
    temp_password = secrets.token_urlsafe(12)
    
    # Create user
    user = User(
        tenant_id=teacher_request.tenant_id,
        email=teacher_request.email,
        password_hash=get_password_hash(temp_password),
        role=UserRole.TEACHER,
        first_name=teacher_request.first_name,
        last_name=teacher_request.last_name,
        is_verified=True,
    )
    db.add(user)
    await db.flush()  # Get user.id before commit
    
    # Create activation token
    activation_token = secrets.token_urlsafe(48)
    token_record = ActivationToken(
        user_id=user.id,
        token=activation_token,
        temporary_password=temp_password,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.ACTIVATION_TOKEN_EXPIRE_HOURS),
    )
    db.add(token_record)
    
    # Update request
    teacher_request.status = TeacherRequestStatus.APPROVED
    teacher_request.reviewed_by_admin_id = admin.id
    teacher_request.reviewed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    tenant = (await db.execute(select(Tenant).where(Tenant.id == teacher_request.tenant_id))).scalar_one_or_none()
    template_args = _template_args(_catalog_with_tenant_values(tenant), "teacher_activation") if tenant else {}
    activation_link = f"{resolve_frontend_url(request.headers.get('origin'))}/activate/{activation_token}"
    email_sent = await email_service.send_teacher_activation_email(
        to_email=teacher_request.email,
        first_name=teacher_request.first_name,
        last_name=teacher_request.last_name,
        activation_link=activation_link,
        subject_template=template_args.get("subject_template"),
        html_template=template_args.get("html_template"),
        text_template=template_args.get("text_template"),
    )
    
    return {
        "message": "Teacher approved" + (" and email sent" if email_sent else " (email not sent - check SMTP config)"),
        "user_id": str(user.id),
        "email": teacher_request.email,
        "email_sent": email_sent,
    }


@router.post("/teacher-requests/{request_id}/reject")
async def reject_teacher_request(
    request_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(
        select(TeacherRequest).where(TeacherRequest.id == request_id)
    )
    teacher_request = result.scalar_one_or_none()
    if not teacher_request:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    
    if teacher_request.status != TeacherRequestStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request already processed")
    
    teacher_request.status = TeacherRequestStatus.REJECTED
    teacher_request.reviewed_by_admin_id = admin.id
    teacher_request.reviewed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {"message": "Teacher request rejected"}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    import secrets
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    # Generate new temporary password
    temp_password = secrets.token_urlsafe(12)
    user.password_hash = get_password_hash(temp_password)
    
    await db.commit()

    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
    template_args = _template_args(_catalog_with_tenant_values(tenant), "password_reset") if tenant else {}
    login_url = f"{resolve_frontend_url(request.headers.get('origin'))}/login"
    email_sent = await email_service.send_password_reset_email(
        to_email=user.email or "",
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        temporary_password=temp_password,
        login_url=login_url,
        subject_template=template_args.get("subject_template"),
        html_template=template_args.get("html_template"),
        text_template=template_args.get("text_template"),
    )
    
    return {
        "message": "Password reset successful" + (" and email sent" if email_sent else " (email not sent)"),
        "email": user.email,
        "temporary_password": temp_password,
        "email_sent": email_sent,
    }


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    # Prevent admin from deleting themselves
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    
    # Prevent deleting other admins
    if user.role == UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete admin users")
    
    user_email = user.email
    user_name = f"{user.first_name} {user.last_name}"
    
    await db.delete(user)
    await db.commit()
    
    return {
        "message": f"User {user_name} ({user_email}) deleted successfully",
    }


@router.get("/users", response_model=list[dict])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    role: Optional[str] = None,
):
    query = select(User).order_by(User.created_at.desc())
    if role:
        query = query.where(User.role == UserRole(role))
    
    result = await db.execute(query)
    users = result.scalars().all()
    
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "role": u.role.value,
            "tenant_id": str(u.tenant_id) if u.tenant_id else None,
            "is_verified": u.is_verified,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.get("/usage")
async def get_usage_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    tenant_id: Optional[UUID] = None,
):
    # Count sessions
    sessions_query = select(func.count(Session.id))
    if tenant_id:
        sessions_query = sessions_query.where(Session.tenant_id == tenant_id)
    sessions_result = await db.execute(sessions_query)
    total_sessions = sessions_result.scalar()
    
    # Count students
    students_query = select(func.count(SessionStudent.id))
    if tenant_id:
        students_query = students_query.where(SessionStudent.tenant_id == tenant_id)
    students_result = await db.execute(students_query)
    total_students = students_result.scalar()
    
    # Count LLM messages
    messages_query = select(func.count(ConversationMessage.id))
    if tenant_id:
        messages_query = messages_query.where(ConversationMessage.tenant_id == tenant_id)
    messages_result = await db.execute(messages_query)
    total_messages = messages_result.scalar()
    
    return {
        "total_sessions": total_sessions,
        "total_students": total_students,
        "total_llm_messages": total_messages,
    }


@router.get("/dashboard/overview")
async def get_dashboard_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    days: int = Query(30, ge=1, le=180),
):
    start_at = datetime.now(timezone.utc) - timedelta(days=days)

    sessions_result = await db.execute(
        select(func.count(Session.id)).where(Session.tenant_id == admin.tenant_id)
    )
    students_result = await db.execute(
        select(func.count(SessionStudent.id)).where(SessionStudent.tenant_id == admin.tenant_id)
    )
    messages_result = await db.execute(
        select(func.count(ConversationMessage.id)).where(
            ConversationMessage.tenant_id == admin.tenant_id,
            ConversationMessage.created_at >= start_at,
        )
    )

    costs_result = await db.execute(
        select(
            func.coalesce(func.sum(CreditTransaction.cost), 0.0),
            func.count(CreditTransaction.id),
        ).where(
            CreditTransaction.tenant_id == admin.tenant_id,
            CreditTransaction.timestamp >= start_at,
        )
    )
    total_cost, total_api_calls = costs_result.one()

    provider_rows = (
        await db.execute(
            select(
                CreditTransaction.provider,
                func.coalesce(func.sum(CreditTransaction.cost), 0.0),
            )
            .where(
                CreditTransaction.tenant_id == admin.tenant_id,
                CreditTransaction.timestamp >= start_at,
            )
            .group_by(CreditTransaction.provider)
            .order_by(func.coalesce(func.sum(CreditTransaction.cost), 0.0).desc())
        )
    ).all()
    model_rows = (
        await db.execute(
            select(
                CreditTransaction.model,
                func.coalesce(func.sum(CreditTransaction.cost), 0.0),
            )
            .where(
                CreditTransaction.tenant_id == admin.tenant_id,
                CreditTransaction.timestamp >= start_at,
            )
            .group_by(CreditTransaction.model)
            .order_by(func.coalesce(func.sum(CreditTransaction.cost), 0.0).desc())
        )
    ).all()

    daily_rows = (
        await db.execute(
            select(
                func.date_trunc("day", CreditTransaction.timestamp).label("day"),
                func.coalesce(func.sum(CreditTransaction.cost), 0.0).label("cost"),
                func.count(CreditTransaction.id).label("calls"),
            )
            .where(
                CreditTransaction.tenant_id == admin.tenant_id,
                CreditTransaction.timestamp >= start_at,
            )
            .group_by("day")
            .order_by("day")
        )
    ).all()

    active_teachers_result = await db.execute(
        select(func.count(func.distinct(CreditTransaction.teacher_id))).where(
            CreditTransaction.tenant_id == admin.tenant_id,
            CreditTransaction.timestamp >= start_at,
            CreditTransaction.teacher_id.is_not(None),
        )
    )
    pending_invites_result = await db.execute(
        select(func.count(PlatformInvitation.id)).where(
            PlatformInvitation.tenant_id == admin.tenant_id,
            PlatformInvitation.status == "pending",
        )
    )

    return {
        "summary": {
            "total_sessions": sessions_result.scalar() or 0,
            "total_students": students_result.scalar() or 0,
            "llm_messages_period": messages_result.scalar() or 0,
            "total_cost_period": float(total_cost or 0.0),
            "total_api_calls_period": int(total_api_calls or 0),
            "active_teachers_period": int(active_teachers_result.scalar() or 0),
            "pending_invites": int(pending_invites_result.scalar() or 0),
            "period_days": days,
        },
        "provider_breakdown": [
            {"provider": provider or "unknown", "cost": float(cost or 0.0)}
            for provider, cost in provider_rows
        ],
        "model_breakdown": [
            {"model": model or "unknown", "cost": float(cost or 0.0)}
            for model, cost in model_rows
        ],
        "daily_history": [
            {
                "date": day.date().isoformat() if day else None,
                "cost": float(cost or 0.0),
                "calls": int(calls or 0),
            }
            for day, cost, calls in daily_rows
        ],
    }


@router.get("/dashboard/top-consumers")
async def get_top_consumers(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    days: int = Query(30, ge=1, le=180),
    limit: int = Query(25, ge=1, le=100),
):
    start_at = datetime.now(timezone.utc) - timedelta(days=days)

    rows = (
        await db.execute(
            select(
                User.id,
                User.first_name,
                User.last_name,
                User.email,
                User.institution,
                func.coalesce(func.sum(CreditTransaction.cost), 0.0).label("cost"),
                func.count(CreditTransaction.id).label("calls"),
            )
            .join(CreditTransaction, CreditTransaction.teacher_id == User.id)
            .where(
                User.tenant_id == admin.tenant_id,
                User.role == UserRole.TEACHER,
                CreditTransaction.timestamp >= start_at,
            )
            .group_by(User.id, User.first_name, User.last_name, User.email, User.institution)
            .order_by(func.coalesce(func.sum(CreditTransaction.cost), 0.0).desc())
            .limit(limit)
        )
    ).all()

    return {
        "items": [
            {
                "teacher_id": str(teacher_id),
                "name": " ".join([p for p in [first_name, last_name] if p]).strip() or email,
                "email": email,
                "institution": institution,
                "cost": float(cost or 0.0),
                "calls": int(calls or 0),
            }
            for teacher_id, first_name, last_name, email, institution, cost, calls in rows
        ]
    }


@router.get("/teachers/status")
async def get_teachers_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    days: int = Query(30, ge=1, le=180),
):
    start_at = datetime.now(timezone.utc) - timedelta(days=days)
    teachers = (
        await db.execute(
            select(User).where(
                User.tenant_id == admin.tenant_id,
                User.role == UserRole.TEACHER,
            ).order_by(User.created_at.desc())
        )
    ).scalars().all()

    aggregates = (
        await db.execute(
            select(
                CreditTransaction.teacher_id,
                func.coalesce(func.sum(CreditTransaction.cost), 0.0),
                func.count(CreditTransaction.id),
            )
            .where(
                CreditTransaction.tenant_id == admin.tenant_id,
                CreditTransaction.timestamp >= start_at,
                CreditTransaction.teacher_id.is_not(None),
            )
            .group_by(CreditTransaction.teacher_id)
        )
    ).all()
    by_teacher = {
        str(teacher_id): {"cost": float(cost or 0.0), "calls": int(calls or 0)}
        for teacher_id, cost, calls in aggregates
    }

    return {
        "items": [
            {
                "id": str(t.id),
                "first_name": t.first_name,
                "last_name": t.last_name,
                "email": t.email,
                "institution": t.institution,
                "is_verified": bool(t.is_verified),
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "last_login_at": t.last_login_at.isoformat() if t.last_login_at else None,
                "period_cost": by_teacher.get(str(t.id), {}).get("cost", 0.0),
                "period_calls": by_teacher.get(str(t.id), {}).get("calls", 0),
            }
            for t in teachers
        ]
    }


@router.get("/realtime/status")
async def get_realtime_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    from app.realtime.gateway import connected_users, session_presence

    session_ids = list(session_presence.keys())
    session_ids_uuid: list[UUID] = []
    for sid in session_ids:
        try:
            session_ids_uuid.append(UUID(str(sid)))
        except Exception:
            continue
    allowed_session_ids: set[str] = set()
    if session_ids_uuid:
        result = await db.execute(
            select(Session.id).where(
                Session.tenant_id == admin.tenant_id,
                Session.id.in_(session_ids_uuid),
            )
        )
        allowed_session_ids = {str(session_id) for session_id in result.scalars().all()}

    now = datetime.now(timezone.utc)
    recent_students_cutoff = now - timedelta(minutes=2)
    recent_teachers_cutoff = now - timedelta(minutes=10)

    online_student_ids: set[str] = set()
    sessions = []
    for session_id, sids in session_presence.items():
        sid_str = str(session_id)
        if sid_str not in allowed_session_ids:
            continue
        session_student_ids: set[str] = set()
        for sid in sids:
            user = connected_users.get(sid)
            if not user or user.get("type") != "student":
                continue
            student_id = str(user.get("id"))
            session_student_ids.add(student_id)
            online_student_ids.add(student_id)
        sessions.append({
            "session_id": sid_str,
            "online_students": len(session_student_ids),
        })

    online_teacher_ids = {
        str(user.get("id"))
        for user in connected_users.values()
        if user.get("type") == "teacher" and str(user.get("tenant_id")) == str(admin.tenant_id)
    }

    recent_students_count = (
        await db.execute(
            select(func.count(SessionStudent.id)).where(
                SessionStudent.tenant_id == admin.tenant_id,
                SessionStudent.last_seen_at.is_not(None),
                SessionStudent.last_seen_at >= recent_students_cutoff,
            )
        )
    ).scalar() or 0

    teachers_by_cost = (
        await db.execute(
            select(func.count(func.distinct(CreditTransaction.teacher_id))).where(
                CreditTransaction.tenant_id == admin.tenant_id,
                CreditTransaction.teacher_id.is_not(None),
                CreditTransaction.timestamp >= recent_teachers_cutoff,
            )
        )
    ).scalar() or 0

    teachers_by_chat = (
        await db.execute(
            select(func.count(func.distinct(TeacherConversation.teacher_id)))
            .join(TeacherConversationMessage, TeacherConversationMessage.conversation_id == TeacherConversation.id)
            .where(
                TeacherConversation.tenant_id == admin.tenant_id,
                TeacherConversationMessage.created_at >= recent_teachers_cutoff,
            )
        )
    ).scalar() or 0

    teacher_ids = {UUID(tid) for tid in online_teacher_ids if tid}
    teacher_lookup: dict[str, User] = {}
    if teacher_ids:
        teacher_rows = (
            await db.execute(
                select(User).where(
                    User.tenant_id == admin.tenant_id,
                    User.id.in_(teacher_ids),
                )
            )
        ).scalars().all()
        teacher_lookup = {str(t.id): t for t in teacher_rows}

    online_users = []
    for sid, user in connected_users.items():
        if user.get("type") == "teacher":
            uid = str(user.get("id") or "")
            if uid not in online_teacher_ids:
                continue
            teacher = teacher_lookup.get(uid)
            online_users.append(
                {
                    "sid": sid,
                    "type": "teacher",
                    "id": uid,
                    "name": (
                        " ".join(
                            [p for p in [(teacher.first_name if teacher else None), (teacher.last_name if teacher else None)] if p]
                        ).strip()
                        or (teacher.email if teacher else uid)
                    ),
                    "email": teacher.email if teacher else None,
                    "session_id": str(user.get("session_id") or ""),
                }
            )
        elif user.get("type") == "student":
            sid_session = str(user.get("session_id") or "")
            if sid_session not in allowed_session_ids:
                continue
            online_users.append(
                {
                    "sid": sid,
                    "type": "student",
                    "id": str(user.get("id") or ""),
                    "name": user.get("nickname") or "Studente",
                    "email": None,
                    "session_id": sid_session,
                }
            )

    return {
        "online_students": len(online_student_ids),
        "online_teachers": len(online_teacher_ids),
        "online_total": len(online_student_ids) + len(online_teacher_ids),
        "recent_students_2m": int(recent_students_count),
        "recent_active_teachers_10m": int(max(teachers_by_cost, teachers_by_chat, len(online_teacher_ids))),
        "sessions_active": sorted(sessions, key=lambda s: s["online_students"], reverse=True),
        "users_online": online_users,
        "generated_at": now.isoformat(),
    }


@router.get("/email-templates")
async def get_email_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return _catalog_with_tenant_values(tenant)


@router.put("/email-templates")
async def update_email_templates(
    payload: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload")

    templates = tenant.email_templates_json or {}
    for key, defaults in DEFAULT_TEMPLATE_CATALOG.items():
        incoming = payload.get(key)
        if incoming is None:
            continue
        if not isinstance(incoming, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid template block: {key}")
        subject = str(incoming.get("subject", defaults.get("subject", ""))).strip()
        html = str(incoming.get("html", defaults.get("html", "")))
        text = str(incoming.get("text", defaults.get("text", "")))
        if key != "beta_disclaimer" and not subject:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Subject is required for {key}")
        current = templates.get(key) or {}
        if (
            str(current.get("subject", "")) != subject
            or str(current.get("html", "")) != html
            or str(current.get("text", "")) != text
        ):
            await _save_template_version(
                db=db,
                tenant_id=tenant.id,
                template_key=key,
                subject=subject,
                html=html,
                text=text,
                updated_by_id=admin.id,
            )
        templates[key] = {"subject": subject, "html": html, "text": text}

    tenant.email_templates_json = templates
    await db.commit()

    await db.refresh(tenant)
    return _catalog_with_tenant_values(tenant)


@router.post("/email-templates/{template_key}/reset-default")
async def reset_email_template_to_default(
    template_key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    if template_key not in DEFAULT_TEMPLATE_CATALOG:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    defaults = DEFAULT_TEMPLATE_CATALOG[template_key]
    subject = str(defaults.get("subject", ""))
    html = str(defaults.get("html", ""))
    text = str(defaults.get("text", ""))

    templates = tenant.email_templates_json or {}
    await _save_template_version(
        db=db,
        tenant_id=tenant.id,
        template_key=template_key,
        subject=subject,
        html=html,
        text=text,
        updated_by_id=admin.id,
    )
    templates[template_key] = {"subject": subject, "html": html, "text": text}
    tenant.email_templates_json = templates
    await db.commit()
    await db.refresh(tenant)
    return _catalog_with_tenant_values(tenant)


@router.get("/email-templates/history")
async def list_email_template_history(
    template_key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    limit: int = Query(20, ge=1, le=200),
):
    if template_key not in DEFAULT_TEMPLATE_CATALOG:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    rows = (
        await db.execute(
            select(TenantTemplateVersion, User)
            .outerjoin(User, User.id == TenantTemplateVersion.updated_by_id)
            .where(
                TenantTemplateVersion.tenant_id == admin.tenant_id,
                TenantTemplateVersion.template_key == template_key,
            )
            .order_by(desc(TenantTemplateVersion.version))
            .limit(limit)
        )
    ).all()

    return {
        "template_key": template_key,
        "items": [
            {
                "id": str(version.id),
                "version": int(version.version),
                "subject": version.subject or "",
                "html": version.html or "",
                "text": version.text or "",
                "created_at": version.created_at.isoformat() if version.created_at else None,
                "updated_by": {
                    "id": str(user.id) if user else None,
                    "email": user.email if user else None,
                    "name": (
                        " ".join([p for p in [user.first_name if user else None, user.last_name if user else None] if p]).strip()
                        if user
                        else None
                    ),
                },
            }
            for version, user in rows
        ],
    }
