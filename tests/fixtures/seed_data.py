"""
Reusable factory functions for creating test entities directly via SQLAlchemy.

Use these when you need to create entities beyond what the standard fixtures
provide (e.g. multiple classes, sessions with specific states, etc.).
"""

import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    create_access_token,
    create_student_join_token,
    generate_join_code,
    get_password_hash,
)
from app.models.chat import ChatMessage, ChatRoom
from app.models.enums import (
    ChatRoomType,
    SenderType,
    SessionStatus,
    TenantStatus,
    UserRole,
)
from app.models.session import Class, Session, SessionModule, SessionStudent
from app.models.task import Task, TaskStatus, TaskType
from app.models.tenant import Tenant
from app.models.user import User


async def create_tenant(
    db: AsyncSession,
    name: str = "Test School",
    slug: str = "test-school",
) -> Tenant:
    tenant = Tenant(
        id=uuid.uuid4(),
        name=name,
        slug=slug,
        status=TenantStatus.ACTIVE,
    )
    db.add(tenant)
    await db.flush()
    return tenant


async def create_teacher(
    db: AsyncSession,
    tenant: Tenant,
    email: str = "teacher@test.com",
    password: str = "testpass123",
    first_name: str = "Test",
    last_name: str = "Teacher",
) -> User:
    teacher = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=email,
        password_hash=get_password_hash(password),
        role=UserRole.TEACHER,
        first_name=first_name,
        last_name=last_name,
        institution=tenant.name,
        is_active=True,
        is_verified=True,
    )
    db.add(teacher)
    await db.flush()
    return teacher


async def create_admin(
    db: AsyncSession,
    tenant: Tenant,
    email: str = "admin@test.com",
    password: str = "adminpass123",
) -> User:
    admin = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=email,
        password_hash=get_password_hash(password),
        role=UserRole.ADMIN,
        first_name="Test",
        last_name="Admin",
        is_active=True,
        is_verified=True,
    )
    db.add(admin)
    await db.flush()
    return admin


async def create_class(
    db: AsyncSession,
    tenant: Tenant,
    teacher: User,
    name: str = "Test Class",
    school_grade: str = "5A",
) -> Class:
    cls = Class(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        teacher_id=teacher.id,
        name=name,
        school_grade=school_grade,
    )
    db.add(cls)
    await db.flush()
    return cls


async def create_session(
    db: AsyncSession,
    tenant: Tenant,
    class_: Class,
    title: str = "Test Session",
    status: SessionStatus = SessionStatus.ACTIVE,
) -> Session:
    session = Session(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        class_id=class_.id,
        title=title,
        join_code=generate_join_code(),
        status=status,
    )
    db.add(session)
    await db.flush()
    return session


async def create_student(
    db: AsyncSession,
    tenant: Tenant,
    session: Session,
    nickname: str = "TestStudent",
) -> SessionStudent:
    student_id = uuid.uuid4()
    token = create_student_join_token(
        session_id=str(session.id),
        student_id=str(student_id),
        nickname=nickname,
    )
    student = SessionStudent(
        id=student_id,
        tenant_id=tenant.id,
        session_id=session.id,
        nickname=nickname,
        join_token=token,
    )
    db.add(student)
    await db.flush()
    return student


async def create_task(
    db: AsyncSession,
    tenant: Tenant,
    session: Session,
    title: str = "Test Task",
    task_type: TaskType = TaskType.QUIZ,
    status: TaskStatus = TaskStatus.PUBLISHED,
    content_json: Optional[str] = None,
) -> Task:
    task = Task(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        session_id=session.id,
        title=title,
        task_type=task_type,
        status=status,
        content_json=content_json,
    )
    db.add(task)
    await db.flush()
    return task


async def create_chat_room(
    db: AsyncSession,
    tenant: Tenant,
    session: Session,
    room_type: ChatRoomType = ChatRoomType.PUBLIC,
    student_id: Optional[uuid.UUID] = None,
    teacher_id: Optional[uuid.UUID] = None,
) -> ChatRoom:
    room = ChatRoom(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        session_id=session.id,
        room_type=room_type,
        student_id=student_id,
        teacher_id=teacher_id,
    )
    db.add(room)
    await db.flush()
    return room


async def create_chat_message(
    db: AsyncSession,
    tenant: Tenant,
    session: Session,
    room: ChatRoom,
    message_text: str = "Hello!",
    sender_type: SenderType = SenderType.STUDENT,
    sender_student_id: Optional[uuid.UUID] = None,
    sender_teacher_id: Optional[uuid.UUID] = None,
) -> ChatMessage:
    msg = ChatMessage(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        session_id=session.id,
        room_id=room.id,
        sender_type=sender_type,
        sender_student_id=sender_student_id,
        sender_teacher_id=sender_teacher_id,
        message_text=message_text,
    )
    db.add(msg)
    await db.flush()
    return msg
