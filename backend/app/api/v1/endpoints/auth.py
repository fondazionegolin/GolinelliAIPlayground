from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated
from datetime import datetime

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_password_hash
from app.models.user import User, TeacherRequest
from app.models.tenant import Tenant
from app.models.enums import UserRole, TeacherRequestStatus
from app.schemas.auth import LoginRequest, LoginResponse, TeacherRequestCreate, TeacherRequestResponse

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
