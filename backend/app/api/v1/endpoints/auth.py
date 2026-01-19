from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated
from datetime import datetime, timezone
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_password_hash
from app.models.user import User, TeacherRequest, ActivationToken
from app.models.tenant import Tenant
from app.models.enums import UserRole, TeacherRequestStatus
from app.schemas.auth import LoginRequest, LoginResponse, TeacherRequestCreate, TeacherRequestResponse


class ActivationInfoResponse(BaseModel):
    first_name: str
    last_name: str
    email: str
    temporary_password: str
    is_used: bool


class ChangePasswordRequest(BaseModel):
    new_password: str

router = APIRouter()


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


@router.post("/teachers/request", response_model=TeacherRequestResponse)
async def request_teacher_account(
    request: TeacherRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Find tenant by slug if provided
    tenant_id = None
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
        tenant_id = tenant.id
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
    
    teacher_request = TeacherRequest(
        tenant_id=tenant_id,
        email=request.email,
        first_name=request.first_name,
        last_name=request.last_name,
    )
    db.add(teacher_request)
    await db.commit()
    await db.refresh(teacher_request)
    
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
