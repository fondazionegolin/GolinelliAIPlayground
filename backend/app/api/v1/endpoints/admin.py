from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, Query, Request, Body, Response
from html import escape
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, delete as sa_delete, update as sa_update, cast, Integer, case, or_
from typing import Annotated, Optional
from datetime import date, datetime, timedelta, timezone
from uuid import UUID
import secrets
import csv
import io

from app.core.database import get_db
from app.core.security import get_password_hash, verify_password
from app.core.config import settings
from app.core.legal_documents import LEGAL_DOCUMENTS
from app.core.url_utils import resolve_frontend_url
from app.api.deps import get_current_admin
from app.models.user import User, TeacherRequest, ActivationToken, PasswordResetToken, LegalDocumentAcceptance
from app.models.tenant import Tenant
from app.models.teacher_school import TeacherSchoolInvitation, TeacherSchoolMembership
from app.models.template_version import TenantTemplateVersion
from app.models.session import Session, SessionStudent, Class as TeacherClass
from app.models.chat import ChatMessage
from app.models.llm import Conversation, ConversationMessage, TeacherConversation, TeacherConversationMessage
from app.models.credits import CreditLimit, CreditTransaction, CreditRequest
from app.models.invitation import PlatformInvitation
from app.models.task import Task
from app.models.teacherbot import Teacherbot, TeacherbotConversation
from app.models.coding import CodingProject
from app.models.notebook import Notebook
from app.models.ml import MLExperiment
from app.models.enums import UserRole, TeacherRequestStatus, TenantStatus, LimitLevel, CreditTransactionType, InvitationStatus
from app.schemas.tenant import (
    TenantCreate, TenantUpdate, TenantResponse, TenantLimitsUpdate, SchoolTenantCreate,
    TeacherSchoolBulkUpdate, TeacherCreditLimitBulkUpdate,
)
from app.models.enums import TenantType
from app.services.credit_service import credit_service
from app.schemas.auth import TeacherRequestResponse
from app.services.email_service import email_service
from app.realtime.gateway import sio

router = APIRouter()


async def _send_school_invitation_email(teacher: User, school: Tenant) -> None:
    link = f"{settings.FRONTEND_URL.rstrip('/')}/teacher/classes?invitations=open"
    await email_service.send_email(
        to_email=teacher.email,
        subject=f"Invito all'istituto {school.name} su Golinelli.ai",
        html_content=(
            '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">'
            '<h2>Hai ricevuto un invito a un istituto</h2>'
            f'<p>Sei stato invitato a entrare in <strong>{escape(school.name)}</strong> su Golinelli.ai.</p>'
            '<p>Apri la sezione Classi per accettare o rifiutare.</p>'
            f'<p><a href="{link}" style="display:inline-block;padding:12px 20px;background:#172033;color:white;text-decoration:none;border-radius:8px">Apri invito</a></p>'
            '</div>'
        ),
        text_content=f"Sei stato invitato all'istituto {school.name} su Golinelli.ai. Apri l'invito: {link}",
    )


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


def _json_int(json_column, key: str):
    return func.coalesce(cast(func.nullif(json_column[key].astext, ""), Integer), 0)


def _bucket_start_for(day: date, granularity: str) -> date:
    if granularity == "week":
        return day - timedelta(days=day.weekday())
    if granularity == "month":
        return day.replace(day=1)
    return day


def _next_bucket_start(day: date, granularity: str) -> date:
    if granularity == "week":
        return day + timedelta(days=7)
    if granularity == "month":
        if day.month == 12:
            return day.replace(year=day.year + 1, month=1, day=1)
        return day.replace(month=day.month + 1, day=1)
    return day + timedelta(days=1)


def _coerce_bucket_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    return value


def _peak_row(rows: list[dict], field: str) -> dict:
    if not rows:
        return {"period_start": None, "period_end": None, "value": 0}
    row = max(rows, key=lambda item: item.get(field) or 0)
    return {
        "period_start": row["period_start"],
        "period_end": row["period_end"],
        "value": row.get(field) or 0,
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


@router.patch("/tenants/{tenant_id}/limits", response_model=TenantResponse)
async def update_tenant_limits(
    tenant_id: UUID,
    request: TenantLimitsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Aggiorna i limiti strutturali e di credito di un tenant."""
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if request.max_teachers is not None:
        tenant.max_teachers = request.max_teachers
    if request.max_students_per_teacher is not None:
        tenant.max_students_per_teacher = request.max_students_per_teacher
    if request.max_students_per_class is not None:
        tenant.max_students_per_class = request.max_students_per_class
    if request.monthly_credit_pool is not None:
        tenant.monthly_credit_pool = request.monthly_credit_pool
        # Aggiorna anche il CreditLimit corrispondente
        from app.models.enums import LimitLevel
        if tenant.tenant_type == TenantType.SCHOOL.value:
            await credit_service.set_limit_cap(db, tenant_id, LimitLevel.GLOBAL, request.monthly_credit_pool)
        else:
            await credit_service.set_limit_cap(db, tenant_id, LimitLevel.STUDENT_POOL, request.monthly_credit_pool)
    if request.teacher_monthly_cap is not None:
        tenant.teacher_monthly_cap = request.teacher_monthly_cap
        # Per INDIVIDUAL: aggiorna il limite del docente (unico docente nel tenant)
        if tenant.tenant_type == TenantType.INDIVIDUAL.value:
            from app.models.enums import LimitLevel
            await credit_service.set_limit_cap(db, tenant_id, LimitLevel.TEACHER, request.teacher_monthly_cap)

    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.post("/tenants/school")
async def create_school_tenant(
    payload: SchoolTenantCreate,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """
    Crea un tenant SCHOOL con un owner (persona fisica che potrà invitare colleghi).
    Crea: Tenant + User owner + ActivationToken + CreditLimit GLOBAL + invia email di attivazione.
    """
    # Verifica slug univoco
    if (await db.execute(select(Tenant).where(Tenant.slug == payload.slug))).scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Slug già in uso")

    # Verifica email owner non duplicata
    owner_email = payload.owner_email.strip().lower()
    if (await db.execute(select(User).where(User.email == owner_email))).scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email già registrata")

    # Crea tenant SCHOOL
    tenant = Tenant(
        name=payload.school_name,
        slug=payload.slug,
        tenant_type=TenantType.SCHOOL.value,
        max_teachers=payload.max_teachers or 5,
        max_students_per_teacher=payload.max_students_per_teacher or 100,
        max_students_per_class=payload.max_students_per_class or 30,
        monthly_credit_pool=payload.monthly_credit_pool or 10.0,
    )
    db.add(tenant)
    await db.flush()

    # Crea owner
    temp_password = secrets.token_urlsafe(12)
    owner = User(
        tenant_id=tenant.id,
        email=owner_email,
        password_hash=get_password_hash(temp_password),
        role=UserRole.TEACHER,
        first_name=payload.owner_first_name,
        last_name=payload.owner_last_name,
        institution=payload.school_name,
        is_verified=True,
        is_school_owner=True,
    )
    db.add(owner)
    await db.flush()

    # Collega owner al tenant
    tenant.owner_user_id = owner.id

    # Token di attivazione
    activation_token = secrets.token_urlsafe(48)
    db.add(ActivationToken(
        user_id=owner.id,
        token=activation_token,
        temporary_password=temp_password,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.ACTIVATION_TOKEN_EXPIRE_HOURS),
    ))

    # Limite globale crediti per la scuola
    await credit_service.ensure_school_global_limit(db, tenant.id, payload.monthly_credit_pool or 10.0)

    await db.commit()
    await db.refresh(tenant)

    # Invia email di attivazione
    activation_link = f"{resolve_frontend_url(http_request.headers.get('origin'))}/activate/{activation_token}"
    await email_service.send_teacher_activation_email(
        to_email=owner_email,
        first_name=payload.owner_first_name,
        last_name=payload.owner_last_name,
        activation_link=activation_link,
    )

    return {
        "tenant_id": str(tenant.id),
        "owner_id": str(owner.id),
        "slug": tenant.slug,
        "message": f"Tenant '{payload.school_name}' creato. Email di attivazione inviata a {owner_email}.",
    }


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
    
    # Ogni docente parte da 300 crediti (€3) o dal default configurato sul tenant.
    # L'admin puo' poi modificare il limite del singolo docente.
    tenant_obj = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    await credit_service.ensure_teacher_limit(
        db,
        user.tenant_id,
        user.id,
        tenant_obj.teacher_monthly_cap if tenant_obj else 3.0,
    )
    if tenant_obj and getattr(tenant_obj, 'tenant_type', TenantType.INDIVIDUAL.value) == TenantType.INDIVIDUAL.value:
        await credit_service.ensure_student_pool_limit(db, user.tenant_id, tenant_obj.monthly_credit_pool)

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
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Invalidate any previous unused reset tokens for this user
    old_tokens = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user_id,
            PasswordResetToken.is_used == False,
        )
    )
    for tok in old_tokens.scalars().all():
        tok.is_used = True

    # Generate a new secure token (valid 24 h)
    reset_token = secrets.token_urlsafe(32)
    token_record = PasswordResetToken(
        user_id=user.id,
        token=reset_token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(token_record)
    await db.commit()

    # Build reset link and send email
    frontend_base = resolve_frontend_url(request.headers.get("origin"))
    reset_link = f"{frontend_base}/reset-password/{reset_token}"

    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one_or_none()
    template_args = _template_args(_catalog_with_tenant_values(tenant), "password_reset") if tenant else {}

    email_sent = await email_service.send_password_reset_link_email(
        to_email=user.email or "",
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        reset_link=reset_link,
        subject_template=template_args.get("subject_template"),
        html_template=template_args.get("html_template"),
    )

    return {
        "message": "Link di reset inviato" + (" via email" if email_sent else " (email non inviata — verifica SMTP)"),
        "email": user.email,
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
    
    user.is_active = False
    user.deactivated_at = datetime.now(timezone.utc)
    user.deactivated_by_admin_id = admin.id

    user_email = user.email
    user_name = f"{user.first_name} {user.last_name}"

    await db.commit()
    
    return {
        "message": f"User {user_name} ({user_email}) deactivated successfully",
    }


@router.delete("/users/{user_id}/permanent")
async def permanently_delete_user(
    user_id: UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Hard-delete a user from the database. Irreversible. Requires email confirmation."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Non puoi eliminare te stesso")
    if user.role == UserRole.ADMIN:
        raise HTTPException(status_code=400, detail="Non puoi eliminare altri amministratori")

    confirm_email = (body.get("confirm_email") or "").strip().lower()
    if confirm_email != (user.email or "").strip().lower():
        raise HTTPException(status_code=400, detail="Email di conferma non corretta")

    # Block if teacher owns classes (content would be orphaned)
    class_count = (
        await db.execute(
            select(func.count(TeacherClass.id)).where(TeacherClass.teacher_id == user_id)
        )
    ).scalar() or 0
    if class_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Il docente ha {class_count} class{'i' if class_count > 1 else 'e'}. "
                   "Elimina prima le classi dalla piattaforma, poi riprova.",
        )

    user_email = user.email or ""
    user_name = f"{user.first_name or ''} {user.last_name or ''}".strip()

    # Delete activation and password-reset tokens
    await db.execute(sa_delete(ActivationToken).where(ActivationToken.user_id == user_id))
    await db.execute(sa_delete(PasswordResetToken).where(PasswordResetToken.user_id == user_id))

    # Nullify credit transactions (keep financial history, just remove user ref)
    await db.execute(
        sa_update(CreditTransaction)
        .where(CreditTransaction.teacher_id == user_id)
        .values(teacher_id=None)
    )

    # Delete credit limits for this teacher
    await db.execute(sa_delete(CreditLimit).where(CreditLimit.teacher_id == user_id))

    # Delete credit requests submitted by this teacher; nullify reviewed_by
    await db.execute(
        sa_update(CreditRequest)
        .where(CreditRequest.reviewed_by_id == user_id)
        .values(reviewed_by_id=None)
    )
    await db.execute(sa_delete(CreditRequest).where(CreditRequest.requester_id == user_id))

    # Delete platform invitations for this email
    await db.execute(
        sa_delete(PlatformInvitation).where(PlatformInvitation.email == user_email)
    )

    # Nullify back-references from other records
    await db.execute(
        sa_update(TeacherRequest)
        .where(TeacherRequest.reviewed_by_admin_id == user_id)
        .values(reviewed_by_admin_id=None)
    )
    await db.execute(
        sa_update(User)
        .where(User.deactivated_by_admin_id == user_id)
        .values(deactivated_by_admin_id=None)
    )

    await db.delete(user)
    await db.commit()

    return {"message": f"Utente {user_name} ({user_email}) eliminato definitivamente dal database"}


@router.post("/users/{user_id}/reactivate")
async def reactivate_user(
    user_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot reactivate admin users via this action")

    user.is_active = True
    user.deactivated_at = None
    user.deactivated_by_admin_id = None
    await db.commit()
    return {"message": f"User {user.email} reactivated successfully"}


@router.post("/change-password")
async def admin_change_password(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Admin changes their own password (requires current password)."""
    current_password = body.get("current_password", "")
    new_password = body.get("new_password", "")

    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Entrambe le password sono obbligatorie")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="La nuova password deve avere almeno 8 caratteri")

    result = await db.execute(select(User).where(User.id == admin.id))
    user = result.scalar_one()

    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password attuale non corretta")

    user.password_hash = get_password_hash(new_password)
    await db.commit()
    return {"message": "Password aggiornata con successo"}


@router.post("/users/{user_id}/promote-admin")
async def promote_to_admin(
    user_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Promote a teacher to admin role."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Non puoi modificare il tuo stesso ruolo")
    if user.role == UserRole.ADMIN:
        raise HTTPException(status_code=400, detail="L'utente è già amministratore")
    if user.role != UserRole.TEACHER:
        raise HTTPException(status_code=400, detail="Solo i docenti possono essere promossi ad amministratore")

    user.role = UserRole.ADMIN
    user.is_verified = True
    await db.commit()
    return {"message": f"{user.email} è ora amministratore"}


@router.get("/users", response_model=list[dict])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    role: Optional[str] = None,
    include_inactive: bool = False,
):
    query = select(User).order_by(User.created_at.desc())
    if role:
        query = query.where(User.role == UserRole(role))
    if not include_inactive:
        query = query.where(User.is_active == True)
    
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
            "is_active": bool(u.is_active),
            "deactivated_at": u.deactivated_at.isoformat() if u.deactivated_at else None,
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
                User.is_active == True,
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


@router.get("/analytics/report")
async def get_admin_analytics_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    granularity: str = Query("day"),
    teacher_id: Optional[UUID] = None,
    class_id: Optional[UUID] = None,
    session_id: Optional[UUID] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    include_empty: bool = True,
):
    if granularity not in {"day", "week", "month"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid granularity")

    today = datetime.now(timezone.utc).date()
    end_day = end_date or today
    start_day = start_date or (end_day - timedelta(days=29))
    if start_day > end_day:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date must be before end_date")
    if (end_day - start_day).days > 730:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum report range is 730 days")

    start_at = datetime.combine(start_day, datetime.min.time(), tzinfo=timezone.utc)
    end_exclusive = datetime.combine(end_day + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

    rows_by_key: dict[str, dict] = {}
    connected_users_by_key: dict[str, dict[str, dict]] = {}
    students_by_key: dict[str, set[str]] = {}
    active_user_ids_period: set[str] = set()
    active_student_ids_period: set[str] = set()

    def ensure_row(bucket_value) -> dict:
        bucket_day = _coerce_bucket_date(bucket_value)
        key = bucket_day.isoformat()
        if key not in rows_by_key:
            next_start = _next_bucket_start(bucket_day, granularity)
            display_start = max(bucket_day, start_day)
            display_end = min(next_start - timedelta(days=1), end_day)
            rows_by_key[key] = {
                "bucket_start": key,
                "period_start": display_start.isoformat(),
                "period_end": display_end.isoformat(),
                "period_label": display_start.isoformat() if display_start == display_end else f"{display_start.isoformat()} / {display_end.isoformat()}",
                "active_users": 0,
                "active_students": 0,
                "connected_user_emails": [],
                "connected_users": [],
                "api_calls": 0,
                "cost": 0.0,
                "teacher_api_calls": 0,
                "teacher_cost": 0.0,
                "teacher_tokens": 0,
                "student_api_calls": 0,
                "student_cost": 0.0,
                "student_tokens": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "avg_tokens_per_call": 0.0,
            }
        return rows_by_key[key]

    if include_empty:
        bucket_day = _bucket_start_for(start_day, granularity)
        while bucket_day <= end_day:
            ensure_row(bucket_day)
            bucket_day = _next_bucket_start(bucket_day, granularity)

    prompt_tokens = _json_int(CreditTransaction.usage_details, "prompt_tokens")
    completion_tokens = _json_int(CreditTransaction.usage_details, "completion_tokens")
    total_tokens = func.coalesce(
        cast(func.nullif(CreditTransaction.usage_details["total_tokens"].astext, ""), Integer),
        prompt_tokens + completion_tokens,
        0,
    )

    tx_conditions = [
        CreditTransaction.tenant_id == admin.tenant_id,
        CreditTransaction.transaction_type == CreditTransactionType.API_CALL,
        CreditTransaction.timestamp >= start_at,
        CreditTransaction.timestamp < end_exclusive,
    ]
    if teacher_id:
        tx_conditions.append(CreditTransaction.teacher_id == teacher_id)
    if class_id:
        tx_conditions.append(CreditTransaction.class_id == class_id)
    if session_id:
        tx_conditions.append(CreditTransaction.session_id == session_id)
    if provider:
        tx_conditions.append(CreditTransaction.provider == provider)
    if model:
        tx_conditions.append(CreditTransaction.model == model)

    tx_bucket = func.date_trunc(granularity, CreditTransaction.timestamp).label("bucket")
    daily_tx_rows = (
        await db.execute(
            select(
                tx_bucket,
                func.count(CreditTransaction.id).label("api_calls"),
                func.coalesce(func.sum(CreditTransaction.cost), 0.0).label("cost"),
                func.coalesce(func.sum(prompt_tokens), 0).label("prompt_tokens"),
                func.coalesce(func.sum(completion_tokens), 0).label("completion_tokens"),
                func.coalesce(func.sum(total_tokens), 0).label("total_tokens"),
            )
            .where(*tx_conditions)
            .group_by(tx_bucket)
            .order_by(tx_bucket)
        )
    ).all()

    for bucket, api_calls, cost, prompt_count, completion_count, total_count in daily_tx_rows:
        row = ensure_row(bucket)
        row["api_calls"] = int(api_calls or 0)
        row["cost"] = float(cost or 0.0)
        row["prompt_tokens"] = int(prompt_count or 0)
        row["completion_tokens"] = int(completion_count or 0)
        row["total_tokens"] = int(total_count or 0)
        row["avg_tokens_per_call"] = (
            round(row["total_tokens"] / row["api_calls"], 2)
            if row["api_calls"]
            else 0.0
        )

    actor_role_expr = case(
        (CreditTransaction.student_id.is_not(None), "student"),
        else_="teacher",
    ).label("actor_role")
    role_daily_rows = (
        await db.execute(
            select(
                tx_bucket,
                actor_role_expr,
                func.count(CreditTransaction.id).label("api_calls"),
                func.coalesce(func.sum(CreditTransaction.cost), 0.0).label("cost"),
                func.coalesce(func.sum(total_tokens), 0).label("total_tokens"),
            )
            .where(*tx_conditions)
            .group_by(tx_bucket, actor_role_expr)
            .order_by(tx_bucket)
        )
    ).all()
    for bucket, actor_role, api_calls, cost, token_count in role_daily_rows:
        row = ensure_row(bucket)
        if actor_role == "student":
            row["student_api_calls"] = int(api_calls or 0)
            row["student_cost"] = float(cost or 0.0)
            row["student_tokens"] = int(token_count or 0)
        else:
            row["teacher_api_calls"] = int(api_calls or 0)
            row["teacher_cost"] = float(cost or 0.0)
            row["teacher_tokens"] = int(token_count or 0)

    def add_connected_user(bucket_value, user_id, email, first_name=None, last_name=None) -> None:
        if not user_id:
            return
        row = ensure_row(bucket_value)
        key = row["bucket_start"]
        user_key = str(user_id)
        full_name = " ".join([p for p in [first_name, last_name] if p]).strip()
        connected_users_by_key.setdefault(key, {})[user_key] = {
            "id": user_key,
            "email": email,
            "name": full_name or email or user_key,
        }
        active_user_ids_period.add(user_key)

    def add_active_student(bucket_value, student_id) -> None:
        if not student_id:
            return
        row = ensure_row(bucket_value)
        key = row["bucket_start"]
        student_key = str(student_id)
        students_by_key.setdefault(key, set()).add(student_key)
        active_student_ids_period.add(student_key)

    user_roles = [UserRole.TEACHER, UserRole.ADMIN]

    active_tx_rows = (
        await db.execute(
            select(
                tx_bucket,
                User.id,
                User.email,
                User.first_name,
                User.last_name,
            )
            .join(User, User.id == CreditTransaction.teacher_id)
            .where(
                *tx_conditions,
                CreditTransaction.teacher_id.is_not(None),
                User.tenant_id == admin.tenant_id,
                User.role.in_(user_roles),
                User.is_active == True,
            )
        )
    ).all()
    for bucket, user_id, email, first_name, last_name in active_tx_rows:
        add_connected_user(bucket, user_id, email, first_name, last_name)

    if not class_id and not session_id:
        teacher_message_conditions = [
            TeacherConversation.tenant_id == admin.tenant_id,
            TeacherConversationMessage.created_at >= start_at,
            TeacherConversationMessage.created_at < end_exclusive,
        ]
        if teacher_id:
            teacher_message_conditions.append(TeacherConversation.teacher_id == teacher_id)
        if provider:
            teacher_message_conditions.append(TeacherConversationMessage.provider == provider)
        if model:
            teacher_message_conditions.append(TeacherConversationMessage.model == model)

        teacher_message_bucket = func.date_trunc(granularity, TeacherConversationMessage.created_at).label("bucket")
        active_teacher_message_rows = (
            await db.execute(
                select(
                    teacher_message_bucket,
                    User.id,
                    User.email,
                    User.first_name,
                    User.last_name,
                )
                .join(TeacherConversation, TeacherConversation.id == TeacherConversationMessage.conversation_id)
                .join(User, User.id == TeacherConversation.teacher_id)
                .where(
                    *teacher_message_conditions,
                    User.tenant_id == admin.tenant_id,
                    User.role.in_(user_roles),
                    User.is_active == True,
                )
            )
        ).all()
        for bucket, user_id, email, first_name, last_name in active_teacher_message_rows:
            add_connected_user(bucket, user_id, email, first_name, last_name)

    if not class_id and not session_id and not provider and not model:
        login_conditions = [
            User.tenant_id == admin.tenant_id,
            User.role.in_(user_roles),
            User.is_active == True,
            User.last_login_at.is_not(None),
            User.last_login_at >= start_at,
            User.last_login_at < end_exclusive,
        ]
        if teacher_id:
            login_conditions.append(User.id == teacher_id)
        login_bucket = func.date_trunc(granularity, User.last_login_at).label("bucket")
        login_rows = (
            await db.execute(
                select(login_bucket, User.id, User.email, User.first_name, User.last_name)
                .where(*login_conditions)
            )
        ).all()
        for bucket, user_id, email, first_name, last_name in login_rows:
            add_connected_user(bucket, user_id, email, first_name, last_name)

    student_tx_rows = (
        await db.execute(
            select(tx_bucket, CreditTransaction.student_id).where(
                *tx_conditions,
                CreditTransaction.student_id.is_not(None),
            )
        )
    ).all()
    for bucket, student_id in student_tx_rows:
        add_active_student(bucket, student_id)

    student_message_conditions = [
        ConversationMessage.tenant_id == admin.tenant_id,
        ConversationMessage.created_at >= start_at,
        ConversationMessage.created_at < end_exclusive,
    ]
    if session_id:
        student_message_conditions.append(Conversation.session_id == session_id)
    if class_id:
        student_message_conditions.append(Session.class_id == class_id)
    if teacher_id:
        student_message_conditions.append(TeacherClass.teacher_id == teacher_id)
    if provider:
        student_message_conditions.append(ConversationMessage.provider == provider)
    if model:
        student_message_conditions.append(ConversationMessage.model == model)

    student_message_bucket = func.date_trunc(granularity, ConversationMessage.created_at).label("bucket")
    student_message_rows = (
        await db.execute(
            select(student_message_bucket, Conversation.student_id)
            .join(Conversation, Conversation.id == ConversationMessage.conversation_id)
            .join(Session, Session.id == Conversation.session_id)
            .join(TeacherClass, TeacherClass.id == Session.class_id)
            .where(*student_message_conditions)
        )
    ).all()
    for bucket, student_id in student_message_rows:
        add_active_student(bucket, student_id)

    if not provider and not model:
        student_seen_conditions = [
            SessionStudent.tenant_id == admin.tenant_id,
            SessionStudent.last_seen_at.is_not(None),
            SessionStudent.last_seen_at >= start_at,
            SessionStudent.last_seen_at < end_exclusive,
        ]
        if session_id:
            student_seen_conditions.append(SessionStudent.session_id == session_id)
        if class_id:
            student_seen_conditions.append(Session.class_id == class_id)
        if teacher_id:
            student_seen_conditions.append(TeacherClass.teacher_id == teacher_id)

        student_seen_bucket = func.date_trunc(granularity, SessionStudent.last_seen_at).label("bucket")
        student_seen_rows = (
            await db.execute(
                select(student_seen_bucket, SessionStudent.id)
                .join(Session, Session.id == SessionStudent.session_id)
                .join(TeacherClass, TeacherClass.id == Session.class_id)
                .where(*student_seen_conditions)
            )
        ).all()
        for bucket, student_id in student_seen_rows:
            add_active_student(bucket, student_id)

    for key, users in connected_users_by_key.items():
        row = rows_by_key[key]
        connected_users = sorted(users.values(), key=lambda item: (item.get("email") or item["name"] or "").lower())
        row["connected_users"] = connected_users
        row["connected_user_emails"] = [item["email"] for item in connected_users if item.get("email")]
        row["active_users"] = len(connected_users)

    for key, student_ids in students_by_key.items():
        rows_by_key[key]["active_students"] = len(student_ids)

    rows = sorted(rows_by_key.values(), key=lambda item: item["bucket_start"])
    bucket_count = max(len(rows), 1)
    total_api_calls = sum(row["api_calls"] for row in rows)
    total_cost = sum(row["cost"] for row in rows)
    total_prompt_tokens = sum(row["prompt_tokens"] for row in rows)
    total_completion_tokens = sum(row["completion_tokens"] for row in rows)
    total_token_count = sum(row["total_tokens"] for row in rows)

    if session_id:
        registered_users_result = await db.execute(
            select(func.count(func.distinct(TeacherClass.teacher_id)))
            .join(Session, Session.class_id == TeacherClass.id)
            .where(
                Session.tenant_id == admin.tenant_id,
                Session.id == session_id,
            )
        )
    elif class_id:
        registered_users_result = await db.execute(
            select(func.count(func.distinct(TeacherClass.teacher_id))).where(
                TeacherClass.tenant_id == admin.tenant_id,
                TeacherClass.id == class_id,
            )
        )
    else:
        registered_user_conditions = [
            User.tenant_id == admin.tenant_id,
            User.role.in_(user_roles),
            User.is_active == True,
        ]
        if teacher_id:
            registered_user_conditions.append(User.id == teacher_id)
        registered_users_result = await db.execute(select(func.count(User.id)).where(*registered_user_conditions))

    student_scope_conditions = [SessionStudent.tenant_id == admin.tenant_id]
    if session_id:
        student_scope_conditions.append(SessionStudent.session_id == session_id)
    if class_id:
        student_scope_conditions.append(Session.class_id == class_id)
    if teacher_id:
        student_scope_conditions.append(TeacherClass.teacher_id == teacher_id)

    registered_students_result = await db.execute(
        select(func.count(SessionStudent.id))
        .join(Session, Session.id == SessionStudent.session_id)
        .join(TeacherClass, TeacherClass.id == Session.class_id)
        .where(*student_scope_conditions)
    )
    students_joined_result = await db.execute(
        select(func.count(SessionStudent.id))
        .join(Session, Session.id == SessionStudent.session_id)
        .join(TeacherClass, TeacherClass.id == Session.class_id)
        .where(
            *student_scope_conditions,
            SessionStudent.created_at >= start_at,
            SessionStudent.created_at < end_exclusive,
        )
    )

    provider_rows = (
        await db.execute(
            select(
                CreditTransaction.provider,
                func.count(CreditTransaction.id),
                func.coalesce(func.sum(CreditTransaction.cost), 0.0),
                func.coalesce(func.sum(total_tokens), 0),
            )
            .where(*tx_conditions)
            .group_by(CreditTransaction.provider)
            .order_by(func.coalesce(func.sum(CreditTransaction.cost), 0.0).desc())
        )
    ).all()
    role_rows = (
        await db.execute(
            select(
                actor_role_expr,
                func.count(CreditTransaction.id),
                func.coalesce(func.sum(CreditTransaction.cost), 0.0),
                func.coalesce(func.sum(total_tokens), 0),
            )
            .where(*tx_conditions)
            .group_by(actor_role_expr)
            .order_by(func.coalesce(func.sum(CreditTransaction.cost), 0.0).desc())
        )
    ).all()
    model_rows = (
        await db.execute(
            select(
                CreditTransaction.model,
                func.count(CreditTransaction.id),
                func.coalesce(func.sum(CreditTransaction.cost), 0.0),
                func.coalesce(func.sum(total_tokens), 0),
            )
            .where(*tx_conditions)
            .group_by(CreditTransaction.model)
            .order_by(func.coalesce(func.sum(CreditTransaction.cost), 0.0).desc())
        )
    ).all()

    active_days_expr = func.count(func.distinct(func.date_trunc("day", CreditTransaction.timestamp)))
    top_user_rows = (
        await db.execute(
            select(
                User.id,
                User.first_name,
                User.last_name,
                User.email,
                func.count(CreditTransaction.id).label("api_calls"),
                func.coalesce(func.sum(CreditTransaction.cost), 0.0).label("cost"),
                func.coalesce(func.sum(total_tokens), 0).label("total_tokens"),
                active_days_expr.label("active_days"),
                func.max(CreditTransaction.timestamp).label("last_activity_at"),
            )
            .join(User, User.id == CreditTransaction.teacher_id)
            .where(
                *tx_conditions,
                CreditTransaction.teacher_id.is_not(None),
                User.tenant_id == admin.tenant_id,
                User.role.in_(user_roles),
                User.is_active == True,
            )
            .group_by(User.id, User.first_name, User.last_name, User.email)
            .order_by(func.coalesce(func.sum(total_tokens), 0).desc(), func.coalesce(func.sum(CreditTransaction.cost), 0.0).desc())
            .limit(50)
        )
    ).all()

    provider_options = sorted({provider for provider, *_ in provider_rows if provider})
    model_options = sorted({model for model, *_ in model_rows if model})

    return {
        "filters": {
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "granularity": granularity,
            "teacher_id": str(teacher_id) if teacher_id else None,
            "class_id": str(class_id) if class_id else None,
            "session_id": str(session_id) if session_id else None,
            "provider": provider,
            "model": model,
            "include_empty": include_empty,
        },
        "summary": {
            "registered_users_scope": int(registered_users_result.scalar() or 0),
            "registered_students_scope": int(registered_students_result.scalar() or 0),
            "students_joined_period": int(students_joined_result.scalar() or 0),
            "active_users_period": len(active_user_ids_period),
            "active_students_period": len(active_student_ids_period),
            "total_api_calls": int(total_api_calls),
            "total_cost": float(total_cost),
            "prompt_tokens": int(total_prompt_tokens),
            "completion_tokens": int(total_completion_tokens),
            "total_tokens": int(total_token_count),
            "average_active_users_per_bucket": round(sum(row["active_users"] for row in rows) / bucket_count, 2),
            "average_active_students_per_bucket": round(sum(row["active_students"] for row in rows) / bucket_count, 2),
            "average_api_calls_per_bucket": round(total_api_calls / bucket_count, 2),
            "average_tokens_per_bucket": round(total_token_count / bucket_count, 2),
            "average_tokens_per_call": round(total_token_count / total_api_calls, 2) if total_api_calls else 0.0,
            "peak_active_users": _peak_row(rows, "active_users"),
            "peak_active_students": _peak_row(rows, "active_students"),
            "peak_api_calls": _peak_row(rows, "api_calls"),
            "peak_tokens": _peak_row(rows, "total_tokens"),
            "peak_cost": _peak_row(rows, "cost"),
        },
        "rows": rows,
        "provider_breakdown": [
            {
                "provider": item_provider or "unknown",
                "calls": int(calls or 0),
                "cost": float(cost or 0.0),
                "total_tokens": int(tokens or 0),
            }
            for item_provider, calls, cost, tokens in provider_rows
        ],
        "model_breakdown": [
            {
                "model": item_model or "unknown",
                "calls": int(calls or 0),
                "cost": float(cost or 0.0),
                "total_tokens": int(tokens or 0),
            }
            for item_model, calls, cost, tokens in model_rows
        ],
        "role_breakdown": [
            {
                "role": actor_role,
                "calls": int(calls or 0),
                "cost": float(cost or 0.0),
                "total_tokens": int(tokens or 0),
            }
            for actor_role, calls, cost, tokens in role_rows
        ],
        "top_users": [
            {
                "user_id": str(user_id),
                "name": " ".join([p for p in [first_name, last_name] if p]).strip() or email,
                "email": email,
                "api_calls": int(api_calls or 0),
                "cost": float(cost or 0.0),
                "total_tokens": int(tokens or 0),
                "active_days": int(active_days or 0),
                "last_activity_at": last_activity_at.isoformat() if last_activity_at else None,
            }
            for user_id, first_name, last_name, email, api_calls, cost, tokens, active_days, last_activity_at in top_user_rows
        ],
        "filter_options": {
            "providers": provider_options,
            "models": model_options,
        },
    }


def _usage_json_int(details: dict | None, key: str) -> int:
    if not isinstance(details, dict):
        return 0
    try:
        return int(details.get(key) or 0)
    except (TypeError, ValueError):
        return 0


def _format_usage_actor(tx: CreditTransaction, teacher: User | None, student: SessionStudent | None) -> dict:
    teacher_name = " ".join([p for p in [getattr(teacher, "first_name", None), getattr(teacher, "last_name", None)] if p]).strip()
    teacher_email = getattr(teacher, "email", None)
    student_name = getattr(student, "nickname", None)
    if tx.student_id:
        actor_role = "student"
        actor_name = student_name or f"Studente {str(tx.student_id)[:8]}"
    else:
        teacher_role = getattr(getattr(teacher, "role", None), "value", getattr(teacher, "role", None))
        actor_role = "admin" if teacher_role == UserRole.ADMIN.value else "teacher"
        actor_name = teacher_name or teacher_email or f"Utente {str(tx.teacher_id)[:8] if tx.teacher_id else 'sconosciuto'}"
    return {
        "actor_role": actor_role,
        "actor_name": actor_name,
        "teacher_name": teacher_name or teacher_email,
        "teacher_email": teacher_email,
        "student_name": student_name,
    }


def _usage_transaction_dict(tx: CreditTransaction, teacher: User | None, student: SessionStudent | None, class_name: str | None, session_title: str | None) -> dict:
    details = tx.usage_details or {}
    prompt_tokens = _usage_json_int(details, "prompt_tokens")
    completion_tokens = _usage_json_int(details, "completion_tokens")
    total_tokens = _usage_json_int(details, "total_tokens") or prompt_tokens + completion_tokens
    actor = _format_usage_actor(tx, teacher, student)
    return {
        "id": str(tx.id),
        "timestamp": tx.timestamp.isoformat() if tx.timestamp else None,
        "transaction_type": tx.transaction_type.value if hasattr(tx.transaction_type, "value") else str(tx.transaction_type),
        "provider": tx.provider or "unknown",
        "model": tx.model or "unknown",
        "cost": float(tx.cost or 0.0),
        "cost_credits": int(round(float(tx.cost or 0.0) * 100)),
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "usage_type": details.get("type") or details.get("usage_type") or "api_call",
        "teacher_id": str(tx.teacher_id) if tx.teacher_id else None,
        "student_id": str(tx.student_id) if tx.student_id else None,
        "class_id": str(tx.class_id) if tx.class_id else None,
        "session_id": str(tx.session_id) if tx.session_id else None,
        "class_name": class_name,
        "session_title": session_title,
        **actor,
    }


def _usage_transaction_conditions(
    admin: User,
    start_date: Optional[date],
    end_date: Optional[date],
    teacher_id: Optional[UUID],
    class_id: Optional[UUID],
    session_id: Optional[UUID],
    provider: Optional[str],
    model: Optional[str],
    actor_role: Optional[str],
    search: Optional[str],
) -> list:
    end_day = end_date or datetime.now(timezone.utc).date()
    start_day = start_date or (end_day - timedelta(days=29))
    start_at = datetime.combine(start_day, datetime.min.time(), tzinfo=timezone.utc)
    end_exclusive = datetime.combine(end_day + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    conditions = [
        CreditTransaction.tenant_id == admin.tenant_id,
        CreditTransaction.transaction_type == CreditTransactionType.API_CALL,
        CreditTransaction.timestamp >= start_at,
        CreditTransaction.timestamp < end_exclusive,
    ]
    if provider:
        conditions.append(CreditTransaction.provider == provider)
    if model:
        conditions.append(CreditTransaction.model == model)
    if teacher_id:
        conditions.append(CreditTransaction.teacher_id == teacher_id)
    if class_id:
        conditions.append(CreditTransaction.class_id == class_id)
    if session_id:
        conditions.append(CreditTransaction.session_id == session_id)
    if actor_role == "student":
        conditions.append(CreditTransaction.student_id.is_not(None))
    elif actor_role in {"teacher", "admin"}:
        conditions.append(CreditTransaction.student_id.is_(None))
        if actor_role == "admin":
            conditions.append(User.role == UserRole.ADMIN)
        else:
            conditions.append(User.role != UserRole.ADMIN)
    if search:
        needle = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(func.coalesce(User.email, "")).like(needle),
                func.lower(func.coalesce(User.first_name, "")).like(needle),
                func.lower(func.coalesce(User.last_name, "")).like(needle),
                func.lower(func.coalesce(SessionStudent.nickname, "")).like(needle),
                func.lower(func.coalesce(TeacherClass.name, "")).like(needle),
                func.lower(func.coalesce(Session.title, "")).like(needle),
                func.lower(func.coalesce(CreditTransaction.provider, "")).like(needle),
                func.lower(func.coalesce(CreditTransaction.model, "")).like(needle),
            )
        )
    return conditions


def _usage_transactions_from_clause(statement):
    return (
        statement
        .outerjoin(User, User.id == CreditTransaction.teacher_id)
        .outerjoin(SessionStudent, SessionStudent.id == CreditTransaction.student_id)
        .outerjoin(TeacherClass, TeacherClass.id == CreditTransaction.class_id)
        .outerjoin(Session, Session.id == CreditTransaction.session_id)
    )


@router.get("/usage/transactions")
async def list_usage_transactions(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    teacher_id: Optional[UUID] = Query(None),
    class_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    provider: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    actor_role: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date must be before end_date")
    if start_date and end_date and (end_date - start_date).days > 730:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum report range is 730 days")

    conditions = _usage_transaction_conditions(admin, start_date, end_date, teacher_id, class_id, session_id, provider, model, actor_role, q)
    base_columns = (
        CreditTransaction,
        User,
        SessionStudent,
        TeacherClass.name.label("class_name"),
        Session.title.label("session_title"),
    )
    rows = (
        await db.execute(
            _usage_transactions_from_clause(select(*base_columns))
            .options()
            .where(*conditions)
            .order_by(CreditTransaction.timestamp.desc(), CreditTransaction.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    count_result = await db.execute(
        _usage_transactions_from_clause(select(func.count(CreditTransaction.id))).where(*conditions)
    )
    total_result = await db.execute(
        _usage_transactions_from_clause(
            select(
                func.coalesce(func.sum(CreditTransaction.cost), 0.0),
                func.count(CreditTransaction.id),
            )
        ).where(*conditions)
    )
    total_cost, total_calls = total_result.one()

    # Load relationship objects from the ORM identity map when present.
    items = []
    for tx, teacher, student, class_name, session_title in rows:
        items.append(_usage_transaction_dict(tx, teacher, student, class_name, session_title))

    return {
        "items": items,
        "total": int(count_result.scalar() or 0),
        "limit": limit,
        "offset": offset,
        "summary": {
            "calls": int(total_calls or 0),
            "cost": float(total_cost or 0.0),
        },
    }


@router.get("/usage/transactions.csv")
async def download_usage_transactions_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    teacher_id: Optional[UUID] = Query(None),
    class_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    provider: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    actor_role: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date must be before end_date")
    if start_date and end_date and (end_date - start_date).days > 730:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum report range is 730 days")

    conditions = _usage_transaction_conditions(admin, start_date, end_date, teacher_id, class_id, session_id, provider, model, actor_role, q)
    rows = (
        await db.execute(
            _usage_transactions_from_clause(
                select(
                    CreditTransaction,
                    User,
                    SessionStudent,
                    TeacherClass.name.label("class_name"),
                    Session.title.label("session_title"),
                )
            )
            .where(*conditions)
            .order_by(CreditTransaction.timestamp.desc(), CreditTransaction.id.desc())
            .limit(20000)
        )
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "timestamp",
        "ruolo",
        "utente",
        "studente",
        "docente_pool",
        "email_docente",
        "classe",
        "sessione",
        "provider",
        "modello",
        "tipo_uso",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "costo_eur",
        "crediti",
    ])
    for tx, teacher, student, class_name, session_title in rows:
        item = _usage_transaction_dict(tx, teacher, student, class_name, session_title)
        writer.writerow([
            item["timestamp"] or "",
            item["actor_role"],
            item["actor_name"],
            item["student_name"] or "",
            item["teacher_name"] or "",
            item["teacher_email"] or "",
            item["class_name"] or "",
            item["session_title"] or "",
            item["provider"],
            item["model"],
            item["usage_type"],
            item["prompt_tokens"],
            item["completion_tokens"],
            item["total_tokens"],
            f'{item["cost"]:.6f}',
            item["cost_credits"],
        ])

    filename_parts = ["admin-credit-ledger"]
    if start_date:
        filename_parts.append(start_date.isoformat())
    if end_date:
        filename_parts.append(end_date.isoformat())
    filename = "-".join(filename_parts) + ".csv"
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/usage/teacher-report.csv")
async def download_teacher_usage_report_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    include_inactive: bool = Query(True),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date must be before end_date")
    if start_date and end_date and (end_date - start_date).days > 730:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum report range is 730 days")

    start_at = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc) if start_date else None
    end_exclusive = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc) if end_date else None
    start_at_naive = start_at.replace(tzinfo=None) if start_at else None
    end_exclusive_naive = end_exclusive.replace(tzinfo=None) if end_exclusive else None

    def period_conditions(column):
        conditions = []
        if start_at:
            conditions.append(column >= start_at)
        if end_exclusive:
            conditions.append(column < end_exclusive)
        return conditions

    def period_conditions_naive(column):
        conditions = []
        if start_at_naive:
            conditions.append(column >= start_at_naive)
        if end_exclusive_naive:
            conditions.append(column < end_exclusive_naive)
        return conditions

    def add_count(bucket: dict[str, dict[str, int]], teacher_id, key, count) -> None:
        if teacher_id is None:
            return
        bucket.setdefault(str(teacher_id), {})[str(key or "unknown")] = int(count or 0)

    def add_metric(bucket: dict[str, dict[str, float]], teacher_id, values: dict[str, float]) -> None:
        if teacher_id is None:
            return
        item = bucket.setdefault(str(teacher_id), {"calls": 0, "cost": 0.0, "tokens": 0})
        item["calls"] += int(values.get("calls") or 0)
        item["cost"] += float(values.get("cost") or 0.0)
        item["tokens"] += int(values.get("tokens") or 0)

    def format_counts(values: dict[str, int] | None) -> str:
        if not values:
            return ""
        return "; ".join(f"{key}:{values[key]}" for key in sorted(values))

    def format_money(value: float) -> str:
        return f"{float(value or 0.0):.6f}"

    teacher_roles = [UserRole.TEACHER, UserRole.ADMIN]
    teacher_conditions = [
        User.tenant_id == admin.tenant_id,
        User.role.in_(teacher_roles),
    ]
    if not include_inactive:
        teacher_conditions.append(User.is_active == True)
    teachers = (
        await db.execute(
            select(User)
            .where(*teacher_conditions)
            .order_by(User.last_name.asc().nulls_last(), User.first_name.asc().nulls_last(), User.email.asc())
        )
    ).scalars().all()
    teacher_ids = [teacher.id for teacher in teachers]
    teacher_id_strings = {str(teacher.id) for teacher in teachers}

    class_counts: dict[str, int] = {}
    session_counts: dict[str, int] = {}
    student_counts: dict[str, int] = {}
    student_nicknames: dict[str, dict[str, int]] = {}
    task_counts: dict[str, dict[str, int]] = {}
    activity_counts: dict[str, dict[str, int]] = {}
    teacher_call_metrics: dict[str, dict[str, float]] = {}
    student_call_metrics: dict[str, dict[str, float]] = {}
    teacher_call_types: dict[str, dict[str, int]] = {}
    student_call_types: dict[str, dict[str, int]] = {}

    if teacher_ids:
        class_rows = (
            await db.execute(
                select(TeacherClass.teacher_id, func.count(TeacherClass.id))
                .where(
                    TeacherClass.tenant_id == admin.tenant_id,
                    TeacherClass.teacher_id.in_(teacher_ids),
                    *period_conditions(TeacherClass.created_at),
                )
                .group_by(TeacherClass.teacher_id)
            )
        ).all()
        class_counts = {str(tid): int(count or 0) for tid, count in class_rows}

        session_rows = (
            await db.execute(
                select(TeacherClass.teacher_id, func.count(Session.id))
                .join(Session, Session.class_id == TeacherClass.id)
                .where(
                    TeacherClass.tenant_id == admin.tenant_id,
                    TeacherClass.teacher_id.in_(teacher_ids),
                    *period_conditions(Session.created_at),
                )
                .group_by(TeacherClass.teacher_id)
            )
        ).all()
        session_counts = {str(tid): int(count or 0) for tid, count in session_rows}

        nickname_rows = (
            await db.execute(
                select(
                    TeacherClass.teacher_id,
                    SessionStudent.nickname,
                    func.count(func.distinct(SessionStudent.id)),
                )
                .join(Session, Session.class_id == TeacherClass.id)
                .join(SessionStudent, SessionStudent.session_id == Session.id)
                .where(
                    TeacherClass.tenant_id == admin.tenant_id,
                    TeacherClass.teacher_id.in_(teacher_ids),
                    *period_conditions(SessionStudent.created_at),
                )
                .group_by(TeacherClass.teacher_id, SessionStudent.nickname)
                .order_by(TeacherClass.teacher_id, SessionStudent.nickname)
            )
        ).all()
        for teacher_id_value, nickname, count in nickname_rows:
            teacher_key = str(teacher_id_value)
            nick = (nickname or "Senza nickname").strip() or "Senza nickname"
            student_nicknames.setdefault(teacher_key, {})[nick] = int(count or 0)
        student_counts = {
            teacher_key: sum(nicks.values())
            for teacher_key, nicks in student_nicknames.items()
        }

        task_session_rows = (
            await db.execute(
                select(TeacherClass.teacher_id, Task.task_type, func.count(Task.id))
                .join(Session, Task.session_id == Session.id)
                .join(TeacherClass, Session.class_id == TeacherClass.id)
                .where(
                    TeacherClass.tenant_id == admin.tenant_id,
                    TeacherClass.teacher_id.in_(teacher_ids),
                    *period_conditions_naive(Task.created_at),
                )
                .group_by(TeacherClass.teacher_id, Task.task_type)
            )
        ).all()
        for teacher_id_value, task_type, count in task_session_rows:
            add_count(task_counts, teacher_id_value, getattr(task_type, "value", task_type), count)

        task_class_rows = (
            await db.execute(
                select(TeacherClass.teacher_id, Task.task_type, func.count(Task.id))
                .join(TeacherClass, Task.class_id == TeacherClass.id)
                .where(
                    TeacherClass.tenant_id == admin.tenant_id,
                    TeacherClass.teacher_id.in_(teacher_ids),
                    Task.session_id.is_(None),
                    *period_conditions_naive(Task.created_at),
                )
                .group_by(TeacherClass.teacher_id, Task.task_type)
            )
        ).all()
        for teacher_id_value, task_type, count in task_class_rows:
            add_count(task_counts, teacher_id_value, getattr(task_type, "value", task_type), count)

        prompt_tokens = _json_int(CreditTransaction.usage_details, "prompt_tokens")
        completion_tokens = _json_int(CreditTransaction.usage_details, "completion_tokens")
        total_tokens = func.coalesce(
            cast(func.nullif(CreditTransaction.usage_details["total_tokens"].astext, ""), Integer),
            prompt_tokens + completion_tokens,
            0,
        )
        usage_type = func.coalesce(CreditTransaction.usage_details["type"].astext, "api_call")

        teacher_tx_conditions = [
            CreditTransaction.tenant_id == admin.tenant_id,
            CreditTransaction.transaction_type == CreditTransactionType.API_CALL,
            CreditTransaction.teacher_id.in_(teacher_ids),
            CreditTransaction.student_id.is_(None),
            *period_conditions(CreditTransaction.timestamp),
        ]
        teacher_tx_rows = (
            await db.execute(
                select(
                    CreditTransaction.teacher_id,
                    func.count(CreditTransaction.id),
                    func.coalesce(func.sum(CreditTransaction.cost), 0.0),
                    func.coalesce(func.sum(total_tokens), 0),
                )
                .where(*teacher_tx_conditions)
                .group_by(CreditTransaction.teacher_id)
            )
        ).all()
        for teacher_id_value, calls, cost, tokens in teacher_tx_rows:
            add_metric(teacher_call_metrics, teacher_id_value, {"calls": calls, "cost": cost, "tokens": tokens})

        teacher_tx_type_rows = (
            await db.execute(
                select(CreditTransaction.teacher_id, usage_type, func.count(CreditTransaction.id))
                .where(*teacher_tx_conditions)
                .group_by(CreditTransaction.teacher_id, usage_type)
            )
        ).all()
        for teacher_id_value, tx_type, count in teacher_tx_type_rows:
            add_count(teacher_call_types, teacher_id_value, tx_type, count)
            add_count(activity_counts, teacher_id_value, f"docente:{tx_type}", count)

        student_tx_conditions = [
            CreditTransaction.tenant_id == admin.tenant_id,
            CreditTransaction.transaction_type == CreditTransactionType.API_CALL,
            CreditTransaction.teacher_id.in_(teacher_ids),
            CreditTransaction.student_id.is_not(None),
            *period_conditions(CreditTransaction.timestamp),
        ]
        student_tx_rows = (
            await db.execute(
                select(
                    CreditTransaction.teacher_id,
                    func.count(CreditTransaction.id),
                    func.coalesce(func.sum(CreditTransaction.cost), 0.0),
                    func.coalesce(func.sum(total_tokens), 0),
                )
                .where(*student_tx_conditions)
                .group_by(CreditTransaction.teacher_id)
            )
        ).all()
        for teacher_id_value, calls, cost, tokens in student_tx_rows:
            add_metric(student_call_metrics, teacher_id_value, {"calls": calls, "cost": cost, "tokens": tokens})

        student_tx_type_rows = (
            await db.execute(
                select(CreditTransaction.teacher_id, usage_type, func.count(CreditTransaction.id))
                .where(*student_tx_conditions)
                .group_by(CreditTransaction.teacher_id, usage_type)
            )
        ).all()
        for teacher_id_value, tx_type, count in student_tx_type_rows:
            add_count(student_call_types, teacher_id_value, tx_type, count)
            add_count(activity_counts, teacher_id_value, f"studenti:{tx_type}", count)

        teacherbot_rows = (
            await db.execute(
                select(Teacherbot.teacher_id, func.count(Teacherbot.id))
                .where(
                    Teacherbot.tenant_id == admin.tenant_id,
                    Teacherbot.teacher_id.in_(teacher_ids),
                    *period_conditions(Teacherbot.created_at),
                )
                .group_by(Teacherbot.teacher_id)
            )
        ).all()
        for teacher_id_value, count in teacherbot_rows:
            add_count(activity_counts, teacher_id_value, "teacherbot_creati", count)

        class_chat_rows = (
            await db.execute(
                select(ChatMessage.sender_teacher_id, func.count(ChatMessage.id))
                .where(
                    ChatMessage.tenant_id == admin.tenant_id,
                    ChatMessage.sender_teacher_id.in_(teacher_ids),
                    *period_conditions(ChatMessage.created_at),
                )
                .group_by(ChatMessage.sender_teacher_id)
            )
        ).all()
        for teacher_id_value, count in class_chat_rows:
            add_count(activity_counts, teacher_id_value, "messaggi_chat_classe", count)

        teacher_conversation_rows = (
            await db.execute(
                select(TeacherConversation.teacher_id, func.count(func.distinct(TeacherConversation.id)))
                .where(
                    TeacherConversation.tenant_id == admin.tenant_id,
                    TeacherConversation.teacher_id.in_(teacher_ids),
                    *period_conditions(TeacherConversation.created_at),
                )
                .group_by(TeacherConversation.teacher_id)
            )
        ).all()
        for teacher_id_value, count in teacher_conversation_rows:
            add_count(activity_counts, teacher_id_value, "conversazioni_chatbot_docente", count)

        student_conversation_rows = (
            await db.execute(
                select(TeacherClass.teacher_id, func.count(func.distinct(Conversation.id)))
                .join(Session, Conversation.session_id == Session.id)
                .join(TeacherClass, Session.class_id == TeacherClass.id)
                .where(
                    Conversation.tenant_id == admin.tenant_id,
                    TeacherClass.teacher_id.in_(teacher_ids),
                    *period_conditions(Conversation.created_at),
                )
                .group_by(TeacherClass.teacher_id)
            )
        ).all()
        for teacher_id_value, count in student_conversation_rows:
            add_count(activity_counts, teacher_id_value, "conversazioni_chatbot_studenti", count)

        teacherbot_conversation_rows = (
            await db.execute(
                select(TeacherClass.teacher_id, func.count(func.distinct(TeacherbotConversation.id)))
                .join(Session, TeacherbotConversation.session_id == Session.id)
                .join(TeacherClass, Session.class_id == TeacherClass.id)
                .where(
                    TeacherbotConversation.tenant_id == admin.tenant_id,
                    TeacherClass.teacher_id.in_(teacher_ids),
                    *period_conditions(TeacherbotConversation.created_at),
                )
                .group_by(TeacherClass.teacher_id)
            )
        ).all()
        for teacher_id_value, count in teacherbot_conversation_rows:
            add_count(activity_counts, teacher_id_value, "conversazioni_teacherbot_studenti", count)

        coding_teacher_rows = (
            await db.execute(
                select(CodingProject.owner_user_id, func.count(CodingProject.id))
                .where(
                    CodingProject.tenant_id == admin.tenant_id,
                    CodingProject.owner_user_id.in_(teacher_ids),
                    *period_conditions(CodingProject.created_at),
                )
                .group_by(CodingProject.owner_user_id)
            )
        ).all()
        for teacher_id_value, count in coding_teacher_rows:
            add_count(activity_counts, teacher_id_value, "coding_projects_docente", count)

        coding_student_rows = (
            await db.execute(
                select(TeacherClass.teacher_id, func.count(CodingProject.id))
                .join(Session, CodingProject.session_id == Session.id)
                .join(TeacherClass, Session.class_id == TeacherClass.id)
                .where(
                    CodingProject.tenant_id == admin.tenant_id,
                    TeacherClass.teacher_id.in_(teacher_ids),
                    CodingProject.owner_student_id.is_not(None),
                    *period_conditions(CodingProject.created_at),
                )
                .group_by(TeacherClass.teacher_id)
            )
        ).all()
        for teacher_id_value, count in coding_student_rows:
            add_count(activity_counts, teacher_id_value, "coding_projects_studenti", count)

        notebook_teacher_rows = (
            await db.execute(
                select(Notebook.owner_id, func.count(Notebook.id))
                .where(
                    Notebook.tenant_id == admin.tenant_id,
                    Notebook.owner_id.in_(teacher_ids),
                    *period_conditions(Notebook.created_at),
                )
                .group_by(Notebook.owner_id)
            )
        ).all()
        for teacher_id_value, count in notebook_teacher_rows:
            add_count(activity_counts, teacher_id_value, "notebook_docente", count)

        ml_rows = (
            await db.execute(
                select(MLExperiment.teacher_id, func.count(MLExperiment.id))
                .where(
                    MLExperiment.tenant_id == admin.tenant_id,
                    MLExperiment.teacher_id.in_(teacher_ids),
                    *period_conditions(MLExperiment.created_at),
                )
                .group_by(MLExperiment.teacher_id)
            )
        ).all()
        for teacher_id_value, count in ml_rows:
            add_count(activity_counts, teacher_id_value, "esperimenti_ml", count)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "utente_id",
        "email",
        "nome",
        "cognome",
        "ruolo",
        "attivo",
        "data_iscrizione",
        "ultimo_accesso",
        "classi_create",
        "sessioni_create",
        "tipologie_attivita_fatte",
        "task_per_tipo",
        "studenti_gestiti_totale",
        "studenti_gestiti_per_nickname",
        "chiamate_docente",
        "costo_docente_eur",
        "token_docente",
        "tipi_chiamate_docente",
        "chiamate_studenti",
        "costo_studenti_eur",
        "token_studenti",
        "tipi_chiamate_studenti",
    ])

    for teacher in teachers:
        teacher_key = str(teacher.id)
        if teacher_key not in teacher_id_strings:
            continue
        teacher_metrics = teacher_call_metrics.get(teacher_key, {"calls": 0, "cost": 0.0, "tokens": 0})
        student_metrics = student_call_metrics.get(teacher_key, {"calls": 0, "cost": 0.0, "tokens": 0})
        nick_counts = student_nicknames.get(teacher_key, {})
        nick_detail = "; ".join(
            f"{nickname} ({nick_counts[nickname]})"
            for nickname in sorted(nick_counts, key=lambda item: item.lower())
        )
        writer.writerow([
            str(teacher.id),
            teacher.email or "",
            teacher.first_name or "",
            teacher.last_name or "",
            teacher.role.value if hasattr(teacher.role, "value") else str(teacher.role),
            "si" if teacher.is_active else "no",
            teacher.created_at.isoformat() if teacher.created_at else "",
            teacher.last_login_at.isoformat() if teacher.last_login_at else "",
            class_counts.get(teacher_key, 0),
            session_counts.get(teacher_key, 0),
            format_counts(activity_counts.get(teacher_key)),
            format_counts(task_counts.get(teacher_key)),
            student_counts.get(teacher_key, 0),
            nick_detail,
            int(teacher_metrics["calls"]),
            format_money(teacher_metrics["cost"]),
            int(teacher_metrics["tokens"]),
            format_counts(teacher_call_types.get(teacher_key)),
            int(student_metrics["calls"]),
            format_money(student_metrics["cost"]),
            int(student_metrics["tokens"]),
            format_counts(student_call_types.get(teacher_key)),
        ])

    filename_parts = ["admin-teacher-usage"]
    if start_date:
        filename_parts.append(start_date.isoformat())
    if end_date:
        filename_parts.append(end_date.isoformat())
    filename = "-".join(filename_parts) + ".csv"
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
                User.role.in_([UserRole.TEACHER, UserRole.ADMIN]),
                User.is_active == True,
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

    sessions_agg = (
        await db.execute(
            select(
                TeacherClass.teacher_id,
                func.count(Session.id).label("session_count"),
            )
            .join(Session, Session.class_id == TeacherClass.id)
            .group_by(TeacherClass.teacher_id)
        )
    ).all()
    sessions_by_teacher = {str(tid): int(cnt) for tid, cnt in sessions_agg}

    students_agg = (
        await db.execute(
            select(
                TeacherClass.teacher_id,
                func.count(SessionStudent.id).label("student_count"),
            )
            .join(Session, Session.class_id == TeacherClass.id)
            .join(SessionStudent, SessionStudent.session_id == Session.id)
            .group_by(TeacherClass.teacher_id)
        )
    ).all()
    students_by_teacher = {str(tid): int(cnt) for tid, cnt in students_agg}

    limits_rows = (
        await db.execute(
            select(CreditLimit).where(
                CreditLimit.level == LimitLevel.TEACHER,
                CreditLimit.teacher_id.in_([t.id for t in teachers]),
            )
        )
    ).scalars().all()
    limits_by_teacher = {str(lim.teacher_id): lim for lim in limits_rows}

    membership_rows = (
        await db.execute(
            select(TeacherSchoolMembership, Tenant)
            .join(Tenant, Tenant.id == TeacherSchoolMembership.school_tenant_id)
            .where(TeacherSchoolMembership.teacher_id.in_([t.id for t in teachers]))
            .order_by(Tenant.name.asc())
        )
    ).all() if teachers else []
    schools_by_teacher: dict[str, list[dict]] = {}
    for membership, school in membership_rows:
        schools_by_teacher.setdefault(str(membership.teacher_id), []).append({
            "id": str(school.id),
            "name": school.name,
            "slug": school.slug,
        })

    return {
        "items": [
            {
                "id": str(t.id),
                "first_name": t.first_name,
                "last_name": t.last_name,
                "email": t.email,
                "institution": t.institution,
                "tenant_id": str(t.tenant_id) if t.tenant_id else None,
                "schools": schools_by_teacher.get(str(t.id), []),
                "role": t.role.value,
                "is_verified": bool(t.is_verified),
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "last_login_at": t.last_login_at.isoformat() if t.last_login_at else None,
                "period_cost": by_teacher.get(str(t.id), {}).get("cost", 0.0),
                "period_calls": by_teacher.get(str(t.id), {}).get("calls", 0),
                "session_count": sessions_by_teacher.get(str(t.id), 0),
                "total_student_count": students_by_teacher.get(str(t.id), 0),
                "monthly_cap": float(limits_by_teacher[str(t.id)].amount_cap) if str(t.id) in limits_by_teacher else 3.0,
                "monthly_usage": float(limits_by_teacher[str(t.id)].current_usage) if str(t.id) in limits_by_teacher else 0.0,
                "limit_id": str(limits_by_teacher[str(t.id)].id) if str(t.id) in limits_by_teacher else None,
            }
            for t in teachers
        ]
    }


@router.get("/legal-consents")
async def list_legal_consents(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    teachers = (
        await db.execute(
            select(User).where(
                User.tenant_id == admin.tenant_id,
                User.role == UserRole.TEACHER,
                User.is_active == True,
            ).order_by(User.last_name.asc().nulls_last(), User.first_name.asc().nulls_last(), User.email.asc())
        )
    ).scalars().all()

    teacher_ids = [teacher.id for teacher in teachers]
    acceptance_rows = []
    if teacher_ids:
        acceptance_rows = (
            await db.execute(
                select(LegalDocumentAcceptance)
                .where(
                    LegalDocumentAcceptance.user_id.in_(teacher_ids),
                    LegalDocumentAcceptance.document_key.in_([doc["key"] for doc in LEGAL_DOCUMENTS]),
                )
                .order_by(LegalDocumentAcceptance.accepted_at.desc())
            )
        ).scalars().all()

    by_teacher: dict[str, list[LegalDocumentAcceptance]] = {}
    for row in acceptance_rows:
        by_teacher.setdefault(str(row.user_id), []).append(row)

    return {
        "required_documents": LEGAL_DOCUMENTS,
        "items": [
            {
                "teacher": {
                    "id": str(teacher.id),
                    "first_name": teacher.first_name,
                    "last_name": teacher.last_name,
                    "email": teacher.email,
                    "institution": teacher.institution,
                    "created_at": teacher.created_at.isoformat() if teacher.created_at else None,
                    "last_login_at": teacher.last_login_at.isoformat() if teacher.last_login_at else None,
                },
                "acceptances": [
                    {
                        "document_key": doc["key"],
                        "document_title": doc["title"],
                        "document_version": doc["version"],
                        "accepted_at": (
                            match.accepted_at.isoformat()
                            if match and match.accepted_at
                            else None
                        ),
                    }
                    for doc in LEGAL_DOCUMENTS
                    for match in [
                        next(
                            (
                                row for row in by_teacher.get(str(teacher.id), [])
                                if row.document_key == doc["key"] and row.document_version == doc["version"]
                            ),
                            None,
                        )
                    ]
                ],
            }
            for teacher in teachers
        ],
    }


@router.put("/teachers/{teacher_id}/credit-limit")
async def set_teacher_credit_limit(
    teacher_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    amount_cap: float = Body(..., embed=True),
):
    target_teacher = (
        await db.execute(select(User).where(User.id == teacher_id, User.role == UserRole.TEACHER))
    ).scalar_one_or_none()
    if not target_teacher or not target_teacher.tenant_id:
        raise HTTPException(status_code=404, detail="Docente non trovato o privo di tenant operativo")

    existing = (
        await db.execute(
            select(CreditLimit).where(
                CreditLimit.teacher_id == teacher_id,
                CreditLimit.level == LimitLevel.TEACHER,
                CreditLimit.tenant_id == target_teacher.tenant_id,
            )
        )
    ).scalar_one_or_none()

    now_utc = datetime.now(timezone.utc)
    if existing:
        existing.amount_cap = amount_cap
        db.add(existing)
    else:
        try:
            limit_end = now_utc.replace(month=now_utc.month + 1, day=1)
        except ValueError:
            limit_end = now_utc.replace(year=now_utc.year + 1, month=1, day=1)
        db.add(CreditLimit(
            tenant_id=target_teacher.tenant_id,
            level=LimitLevel.TEACHER,
            teacher_id=teacher_id,
            amount_cap=amount_cap,
            current_usage=0.0,
            period_start=now_utc,
            period_end=limit_end,
            reset_frequency="MONTHLY",
        ))
    await db.commit()
    return {"ok": True, "amount_cap": amount_cap}


@router.put("/teachers/schools/bulk")
async def update_teacher_schools_bulk(
    payload: TeacherSchoolBulkUpdate,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Add or remove several teachers from one school without moving their data tenant."""
    if payload.action not in {"add", "remove"}:
        raise HTTPException(status_code=422, detail="action deve essere 'add' oppure 'remove'")

    school = (
        await db.execute(select(Tenant).where(Tenant.id == payload.school_tenant_id))
    ).scalar_one_or_none()
    if not school or school.tenant_type != TenantType.SCHOOL:
        raise HTTPException(status_code=404, detail="Istituto non trovato")

    teacher_ids = list(dict.fromkeys(payload.teacher_ids))
    valid_teachers = (await db.execute(
        select(User).where(User.id.in_(teacher_ids), User.role == UserRole.TEACHER, User.is_active == True)
    )).scalars().all()
    valid_teacher_ids = {teacher.id for teacher in valid_teachers}
    if len(valid_teacher_ids) != len(teacher_ids):
        raise HTTPException(status_code=404, detail="Uno o più docenti non sono stati trovati")

    if payload.action == "add":
        existing_ids = set((await db.execute(
            select(TeacherSchoolMembership.teacher_id).where(
                TeacherSchoolMembership.teacher_id.in_(teacher_ids),
                TeacherSchoolMembership.school_tenant_id == school.id,
            )
        )).scalars().all())
        invite_targets = valid_teacher_ids - existing_ids
        existing_invites = {
            invitation.teacher_id: invitation
            for invitation in (await db.execute(
                select(TeacherSchoolInvitation).where(
                    TeacherSchoolInvitation.teacher_id.in_(teacher_ids),
                    TeacherSchoolInvitation.school_tenant_id == school.id,
                )
            )).scalars().all()
        }
        now = datetime.now(timezone.utc)
        for teacher_id_value in invite_targets:
            invitation = existing_invites.get(teacher_id_value)
            if invitation:
                invitation.status = InvitationStatus.PENDING
                invitation.invited_by_admin_id = admin.id
                invitation.created_at = now
                invitation.responded_at = None
            else:
                db.add(TeacherSchoolInvitation(
                    teacher_id=teacher_id_value,
                    school_tenant_id=school.id,
                    invited_by_admin_id=admin.id,
                ))
        changed = len(invite_targets)
    else:
        result = await db.execute(sa_delete(TeacherSchoolMembership).where(
            TeacherSchoolMembership.teacher_id.in_(teacher_ids),
            TeacherSchoolMembership.school_tenant_id == school.id,
        ))
        changed = result.rowcount or 0
        await db.execute(sa_delete(TeacherSchoolInvitation).where(
            TeacherSchoolInvitation.teacher_id.in_(teacher_ids),
            TeacherSchoolInvitation.school_tenant_id == school.id,
        ))

    await db.commit()
    if payload.action == "add":
        teachers_by_id = {teacher.id: teacher for teacher in valid_teachers}
        for teacher_id_value in invite_targets:
            target = teachers_by_id[teacher_id_value]
            background_tasks.add_task(_send_school_invitation_email, target, school)
            await sio.emit(
                "teacher_notification",
                {
                    "type": "school_invitation",
                    "message": f"Nuovo invito all'istituto {school.name}",
                    "school_id": str(school.id),
                    "school_name": school.name,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                room=f"user:{teacher_id_value}",
            )
    return {"ok": True, "changed": changed, "selected": len(teacher_ids)}


@router.put("/teachers/credit-limits/bulk")
async def set_teacher_credit_limits_bulk(
    payload: TeacherCreditLimitBulkUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    teachers = (await db.execute(
        select(User).where(
            User.id.in_(list(dict.fromkeys(payload.teacher_ids))),
            User.role == UserRole.TEACHER,
            User.is_active == True,
        )
    )).scalars().all()
    if len(teachers) != len(set(payload.teacher_ids)):
        raise HTTPException(status_code=404, detail="Uno o più docenti non sono stati trovati")
    if any(not teacher.tenant_id for teacher in teachers):
        raise HTTPException(status_code=422, detail="Un docente non ha un tenant operativo")

    for teacher in teachers:
        await credit_service.set_limit_cap(
            db, teacher.tenant_id, LimitLevel.TEACHER, payload.amount_cap, teacher_id=teacher.id
        )
    await db.commit()
    return {"ok": True, "updated": len(teachers), "amount_cap": payload.amount_cap}


@router.get("/classes")
async def list_admin_classes(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    classes_rows = (
        await db.execute(
            select(TeacherClass, User, Tenant)
            .join(User, User.id == TeacherClass.teacher_id)
            .outerjoin(Tenant, Tenant.id == TeacherClass.school_tenant_id)
            .order_by(TeacherClass.created_at.desc())
        )
    ).all()

    if not classes_rows:
        return {"items": []}

    class_ids = [cls.id for cls, _, _ in classes_rows]

    sessions = (
        await db.execute(
            select(Session)
            .where(Session.class_id.in_(class_ids))
            .order_by(Session.created_at.desc())
        )
    ).scalars().all()

    sessions_by_class: dict = {}
    for s in sessions:
        sessions_by_class.setdefault(str(s.class_id), []).append(s)

    session_ids = [s.id for s in sessions]
    students: list = []
    cost_by_session: dict = {}

    if session_ids:
        students = (
            await db.execute(
                select(SessionStudent).where(SessionStudent.session_id.in_(session_ids))
            )
        ).scalars().all()

        credit_agg = (
            await db.execute(
                select(
                    CreditTransaction.session_id,
                    func.coalesce(func.sum(CreditTransaction.cost), 0.0).label("total_cost"),
                )
                .where(
                    CreditTransaction.session_id.in_(session_ids),
                )
                .group_by(CreditTransaction.session_id)
            )
        ).all()
        cost_by_session = {str(sid): float(cost) for sid, cost in credit_agg}

    students_by_session: dict = {}
    for s in students:
        students_by_session.setdefault(str(s.session_id), []).append(s)

    result = []
    for cls, teacher, school in classes_rows:
        sess_list = []
        for sess in sessions_by_class.get(str(cls.id), []):
            sess_students = students_by_session.get(str(sess.id), [])
            sess_list.append({
                "session_id": str(sess.id),
                "title": sess.title,
                "status": sess.status.value if hasattr(sess.status, "value") else str(sess.status),
                "join_code": sess.join_code,
                "student_count": len(sess_students),
                "period_cost": cost_by_session.get(str(sess.id), 0.0),
                "students": [
                    {
                        "id": str(s.id),
                        "nickname": s.nickname,
                        "created_at": s.created_at.isoformat() if s.created_at else None,
                        "last_seen_at": s.last_seen_at.isoformat() if s.last_seen_at else None,
                    }
                    for s in sess_students
                ],
            })
        result.append({
            "class_id": str(cls.id),
            "class_name": cls.name,
            "school_grade": cls.school_grade,
            "teacher_id": str(teacher.id),
            "teacher_name": f"{teacher.first_name or ''} {teacher.last_name or ''}".strip() or teacher.email,
            "teacher_email": teacher.email,
            "school_id": str(school.id) if school else None,
            "school_name": school.name if school else None,
            "session_count": len(sess_list),
            "sessions": sess_list,
        })

    return {"items": result}


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
                    User.is_active == True,
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

    # Copy into a fresh dict so SQLAlchemy detects the change on the JSONB column.
    # Mutating tenant.email_templates_json in place and reassigning the same object
    # is NOT flagged as dirty, so the UPDATE would never be emitted.
    templates = dict(tenant.email_templates_json or {})
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

    # Fresh dict so the JSONB column is flagged dirty (see update_email_templates).
    templates = dict(tenant.email_templates_json or {})
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
