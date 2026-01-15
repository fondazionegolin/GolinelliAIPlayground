from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Annotated, Optional
from datetime import datetime
from uuid import UUID

from app.core.database import get_db
from app.core.security import get_password_hash
from app.api.deps import get_current_admin
from app.models.user import User, TeacherRequest
from app.models.tenant import Tenant
from app.models.session import Session, SessionStudent
from app.models.llm import ConversationMessage
from app.models.enums import UserRole, TeacherRequestStatus, TenantStatus
from app.schemas.tenant import TenantCreate, TenantUpdate, TenantResponse
from app.schemas.auth import TeacherRequestResponse

router = APIRouter()


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
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    import secrets
    
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
    
    # Update request
    teacher_request.status = TeacherRequestStatus.APPROVED
    teacher_request.reviewed_by_admin_id = admin.id
    teacher_request.reviewed_at = datetime.utcnow()
    
    await db.commit()
    
    return {
        "message": "Teacher approved",
        "user_id": str(user.id),
        "email": teacher_request.email,
        "temporary_password": temp_password,
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
    teacher_request.reviewed_at = datetime.utcnow()
    
    await db.commit()
    
    return {"message": "Teacher request rejected"}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: UUID,
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
    
    return {
        "message": "Password reset successful",
        "email": user.email,
        "temporary_password": temp_password,
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
