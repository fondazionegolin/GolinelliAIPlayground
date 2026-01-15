from typing import Optional, Annotated
from fastapi import Depends, HTTPException, status, Cookie, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.session import SessionStudent, Session
from app.models.enums import UserRole

security = HTTPBearer(auto_error=False)


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)] = None,
    access_token: Annotated[Optional[str], Cookie()] = None,
) -> User:
    token = None
    if credentials:
        token = credentials.credentials
    elif access_token:
        token = access_token
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    
    return user


async def get_current_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


async def get_current_teacher(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.role != UserRole.TEACHER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher access required",
        )
    if not current_user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher account not verified",
        )
    return current_user


async def get_current_student(
    db: Annotated[AsyncSession, Depends(get_db)],
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)] = None,
    student_token: Annotated[Optional[str], Header()] = None,
) -> SessionStudent:
    token = None
    if credentials:
        token = credentials.credentials
    elif student_token:
        token = student_token
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    
    payload = decode_token(token)
    if not payload or payload.get("type") != "student":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid student token",
        )
    
    student_id = payload.get("sub")
    session_id = payload.get("session_id")
    
    if not student_id or not session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    
    result = await db.execute(
        select(SessionStudent)
        .where(SessionStudent.id == uuid.UUID(student_id))
        .where(SessionStudent.session_id == uuid.UUID(session_id))
    )
    student = result.scalar_one_or_none()
    
    if not student:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Student not found",
        )
    
    if student.is_frozen:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account frozen: {student.frozen_reason or 'Contact teacher'}",
        )
    
    return student


class StudentOrTeacher:
    def __init__(self, student: Optional[SessionStudent] = None, teacher: Optional[User] = None):
        self.student = student
        self.teacher = teacher
        self.is_student = student is not None
        self.is_teacher = teacher is not None


async def get_student_or_teacher(
    db: Annotated[AsyncSession, Depends(get_db)],
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)] = None,
    student_token: Annotated[Optional[str], Header()] = None,
    access_token: Annotated[Optional[str], Cookie()] = None,
) -> StudentOrTeacher:
    token = None
    if credentials:
        token = credentials.credentials
    elif student_token:
        token = student_token
    elif access_token:
        token = access_token
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    
    token_type = payload.get("type")
    
    if token_type == "student":
        student_id = payload.get("sub")
        session_id = payload.get("session_id")
        result = await db.execute(
            select(SessionStudent)
            .where(SessionStudent.id == uuid.UUID(student_id))
            .where(SessionStudent.session_id == uuid.UUID(session_id))
        )
        student = result.scalar_one_or_none()
        if not student:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Student not found")
        if student.is_frozen:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account frozen")
        return StudentOrTeacher(student=student)
    
    elif token_type == "access":
        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = result.scalar_one_or_none()
        if not user or user.role != UserRole.TEACHER:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")
        return StudentOrTeacher(teacher=user)
    
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
