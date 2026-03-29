from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
import secrets
import re
import unicodedata

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_password_hash
from app.core.config import settings
from app.core.url_utils import resolve_frontend_url
from app.models.user import User, TeacherRequest, ActivationToken, PasswordResetToken
from app.models.tenant import Tenant
from app.models.enums import UserRole, TeacherRequestStatus
from app.schemas.auth import LoginRequest, LoginResponse, TeacherRequestCreate, TeacherRequestResponse
from app.services.email_service import email_service


class ActivationInfoResponse(BaseModel):
    first_name: str
    last_name: str
    email: str
    temporary_password: str
    is_used: bool


class ChangePasswordRequest(BaseModel):
    new_password: str

router = APIRouter()
DEFAULT_BETA_DISCLAIMER_HTML = (
    "<p><strong>Beta disclaimer.</strong> Questa piattaforma è in fase beta: possono verificarsi bug e comportamenti non previsti.</p>"
    "<p>Uso scolastico con supervisione docente (Teacher in the Loop), senza scoring o valutazioni automatiche ai sensi delle policy AI Act adottate.</p>"
    "<p>Trattamento dati orientato a minimizzazione, privacy-by-design e anonimizzazione ove applicabile.</p>"
)


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    normalized = normalized.strip().lower()
    return re.sub(r"\s+", " ", normalized)


def _slugify_text(value: str) -> str:
    normalized = _normalize_text(value)
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return re.sub(r"-{2,}", "-", slug)


@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(User).where(User.email == request.email)
    )
    user = result.scalar_one_or_none()
    
    if not user or not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account disattivato. Contatta l'amministratore.",
        )
    
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    
    user.last_login_at = datetime.utcnow()
    await db.commit()
    
    access_token = create_access_token(
        subject=str(user.id),
        extra_claims={"role": user.role.value, "tenant_id": str(user.tenant_id) if user.tenant_id else None},
    )
    
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=60 * 60 * 24,
    )
    
    return LoginResponse(
        access_token=access_token,
        user_id=user.id,
        role=user.role.value,
        tenant_id=user.tenant_id,
    )


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token")
    return {"message": "Logged out successfully"}


@router.get("/public-settings")
async def get_public_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    tenant_slug: str | None = None,
):
    query = select(Tenant)
    if tenant_slug:
        query = query.where(Tenant.slug == tenant_slug)
    query = query.order_by(Tenant.created_at.asc()).limit(1)
    tenant = (await db.execute(query)).scalar_one_or_none()
    if not tenant:
        return {"beta_disclaimer_html": DEFAULT_BETA_DISCLAIMER_HTML}

    templates = tenant.email_templates_json or {}
    disclaimer = templates.get("beta_disclaimer") or {}
    return {
        "beta_disclaimer_html": disclaimer.get("html") or DEFAULT_BETA_DISCLAIMER_HTML
    }


@router.post("/teachers/request", response_model=TeacherRequestResponse)
async def request_teacher_account(
    request: TeacherRequestCreate,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Resolve tenant by explicit slug, school name, or default.
    tenant = None
    if request.tenant_slug:
        result = await db.execute(
            select(Tenant).where(Tenant.slug == request.tenant_slug)
        )
        tenant = result.scalar_one_or_none()
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found",
            )
    elif request.school_name:
        normalized_school = _normalize_text(request.school_name)
        school_slug_guess = _slugify_text(request.school_name)
        tenants = (await db.execute(select(Tenant))).scalars().all()
        tenant = next(
            (
                t for t in tenants
                if _normalize_text(t.name) == normalized_school or _normalize_text(t.slug) == school_slug_guess
            ),
            None,
        )
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Nessun istituto trovato per il nome scuola indicato",
            )
    else:
        # Get first active tenant as default (for demo)
        result = await db.execute(select(Tenant).limit(1))
        tenant = result.scalar_one_or_none()
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No tenant available",
            )
    tenant_id = tenant.id
    
    # Check if request already exists
    result = await db.execute(
        select(TeacherRequest)
        .where(TeacherRequest.email == request.email)
        .where(TeacherRequest.status == TeacherRequestStatus.PENDING)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A pending request already exists for this email",
        )
    
    # Check if user already exists
    result = await db.execute(
        select(User).where(User.email == request.email)
    )
    existing_user = result.scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists",
        )
    
    # Auto-approve only when provided school name matches resolved tenant.
    school_matches_tenant = bool(
        request.school_name
        and (
            _normalize_text(tenant.name) == _normalize_text(request.school_name)
            or _normalize_text(tenant.slug) == _slugify_text(request.school_name)
        )
    )
    is_auto_approved = school_matches_tenant
    teacher_request = TeacherRequest(
        tenant_id=tenant_id,
        email=request.email,
        first_name=request.first_name,
        last_name=request.last_name,
        status=TeacherRequestStatus.APPROVED if is_auto_approved else TeacherRequestStatus.PENDING,
        reviewed_at=datetime.now(timezone.utc) if is_auto_approved else None,
    )
    db.add(teacher_request)

    if is_auto_approved:
        temp_password = secrets.token_urlsafe(12)
        user = User(
            tenant_id=tenant_id,
            email=request.email,
            password_hash=get_password_hash(temp_password),
            role=UserRole.TEACHER,
            first_name=request.first_name,
            last_name=request.last_name,
            institution=tenant.name,
            is_verified=True,
        )
        db.add(user)
        await db.flush()

        activation_token = secrets.token_urlsafe(48)
        token_record = ActivationToken(
            user_id=user.id,
            token=activation_token,
            temporary_password=temp_password,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.ACTIVATION_TOKEN_EXPIRE_HOURS),
        )
        db.add(token_record)

    await db.commit()
    await db.refresh(teacher_request)

    if is_auto_approved:
        templates = (tenant.email_templates_json or {}).get("teacher_activation", {})
        activation_link = f"{resolve_frontend_url(http_request.headers.get('origin'))}/activate/{activation_token}"
        await email_service.send_teacher_activation_email(
            to_email=request.email,
            first_name=request.first_name,
            last_name=request.last_name,
            activation_link=activation_link,
            subject_template=templates.get("subject"),
            html_template=templates.get("html"),
            text_template=templates.get("text"),
        )
    
    return TeacherRequestResponse(
        id=teacher_request.id,
        email=teacher_request.email,
        first_name=teacher_request.first_name,
        last_name=teacher_request.last_name,
        status=teacher_request.status.value,
        tenant_id=teacher_request.tenant_id,
        created_at=teacher_request.created_at.isoformat(),
    )


@router.get("/activate/{token}", response_model=ActivationInfoResponse)
async def get_activation_info(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Get activation info for a teacher account (shows temporary password)"""
    result = await db.execute(
        select(ActivationToken).where(ActivationToken.token == token)
    )
    token_record = result.scalar_one_or_none()
    
    if not token_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token non valido o scaduto",
        )
    
    if token_record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Il link di attivazione è scaduto",
        )
    
    # Get user info
    result = await db.execute(
        select(User).where(User.id == token_record.user_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utente non trovato",
        )
    
    return ActivationInfoResponse(
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        email=user.email or "",
        temporary_password=token_record.temporary_password,
        is_used=token_record.is_used,
    )


@router.post("/activate/{token}/change-password")
async def change_password_with_token(
    token: str,
    request: ChangePasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Change password using activation token"""
    result = await db.execute(
        select(ActivationToken).where(ActivationToken.token == token)
    )
    token_record = result.scalar_one_or_none()
    
    if not token_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token non valido",
        )
    
    if token_record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Il link di attivazione è scaduto",
        )
    
    # Validate password
    if len(request.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La password deve essere di almeno 8 caratteri",
        )
    
    # Get user and update password
    result = await db.execute(
        select(User).where(User.id == token_record.user_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utente non trovato",
        )
    
    user.password_hash = get_password_hash(request.new_password)
    
    # Mark token as used
    token_record.is_used = True
    token_record.used_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "message": "Password aggiornata con successo",
        "email": user.email,
    }


# ── Self-service password reset (token sent by admin) ────────────────────────

class ResetPasswordInfoResponse(BaseModel):
    first_name: str
    email: str


class SetNewPasswordRequest(BaseModel):
    new_password: str
    confirm_password: str


@router.get("/reset-password/{token}", response_model=ResetPasswordInfoResponse)
async def get_reset_password_info(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Validate a password-reset token and return the user's display name."""
    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token == token)
    )
    token_record = result.scalar_one_or_none()

    if not token_record or token_record.is_used:
        raise HTTPException(status_code=404, detail="Link non valido o già utilizzato")

    if token_record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Link scaduto. Chiedi un nuovo reset all'amministratore.")

    user = (await db.execute(select(User).where(User.id == token_record.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    return ResetPasswordInfoResponse(first_name=user.first_name or "", email=user.email or "")


@router.post("/reset-password/{token}")
async def set_new_password(
    token: str,
    request: SetNewPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set a new password using a valid reset token."""
    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token == token)
    )
    token_record = result.scalar_one_or_none()

    if not token_record or token_record.is_used:
        raise HTTPException(status_code=404, detail="Link non valido o già utilizzato")

    if token_record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Link scaduto")

    if request.new_password != request.confirm_password:
        raise HTTPException(status_code=400, detail="Le password non coincidono")

    if len(request.new_password) < 8:
        raise HTTPException(status_code=400, detail="La password deve essere di almeno 8 caratteri")

    user = (await db.execute(select(User).where(User.id == token_record.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    user.password_hash = get_password_hash(request.new_password)
    token_record.is_used = True
    token_record.used_at = datetime.now(timezone.utc)

    await db.commit()
    return {"message": "Password aggiornata con successo"}
