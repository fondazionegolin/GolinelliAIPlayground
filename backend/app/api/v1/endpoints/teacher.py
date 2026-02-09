from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from typing import Annotated, Optional
from datetime import datetime, timedelta
from uuid import UUID
from pydantic import BaseModel, EmailStr

from app.core.database import get_db
from app.core.security import generate_join_code
from app.core.permissions import (
    teacher_can_access_class,
    teacher_can_access_session,
    teacher_is_class_owner,
    teacher_is_session_owner,
    get_class_with_access_check,
    get_session_with_access_check,
)
from app.api.deps import get_current_teacher
from app.models.user import User
from app.models.session import Class, Session, SessionModule, SessionStudent
from app.models.invitation import ClassTeacher, ClassInvitation, SessionTeacher, SessionInvitation
from app.models.llm import AuditEvent
from app.models.chat import ChatRoom, ChatMessage
from app.models.enums import SessionStatus, ChatRoomType, SenderType, InvitationStatus, UserRole
from app.models.task import Task, TaskSubmission, TaskStatus, TaskType
from app.models.document_draft import DocumentDraft
from app.schemas.document_draft import DocumentDraftCreate, DocumentDraftUpdate
from app.realtime.gateway import sio
from app.schemas.session import (
    ClassCreate, ClassResponse,
    SessionCreate, SessionUpdate, SessionResponse,
    SessionModulesRequest, SessionModuleResponse,
    SessionStudentResponse, SessionLiveSnapshot,
    TaskCreate,
)
from app.schemas.invitation import (
    InviteTeacherRequest,
    InvitationResponseRequest,
    ClassInvitationResponse,
    SessionInvitationResponse,
    ClassTeacherResponse,
    SessionTeacherResponse,
    InvitationsListResponse,
    TeacherBasicInfo,
)

router = APIRouter()
TEACHER_ACCENTS = {"red", "indigo", "gray", "green", "slateblue"}


# Profile schemas
class ProfileResponse(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    institution: str | None = None
    avatar_url: str | None = None
    ui_accent: str | None = None


class ProfileUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    institution: str | None = None
    avatar_url: str | None = None
    ui_accent: str | None = None


# Profile endpoints
@router.get("/profile", response_model=ProfileResponse)
async def get_profile(
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get current teacher's profile"""
    return ProfileResponse(
        first_name=teacher.first_name,
        last_name=teacher.last_name,
        email=teacher.email,
        institution=teacher.institution,
        avatar_url=teacher.avatar_url,
        ui_accent=teacher.ui_accent,
    )


@router.put("/profile", response_model=ProfileResponse)
async def update_profile(
    request: ProfileUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Update current teacher's profile"""
    if request.first_name is not None:
        teacher.first_name = request.first_name
    if request.last_name is not None:
        teacher.last_name = request.last_name
    if request.institution is not None:
        teacher.institution = request.institution
    if request.avatar_url is not None:
        teacher.avatar_url = request.avatar_url
    if request.ui_accent is not None:
        if request.ui_accent not in TEACHER_ACCENTS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ui_accent")
        teacher.ui_accent = request.ui_accent

    await db.commit()
    await db.refresh(teacher)

    return ProfileResponse(
        first_name=teacher.first_name,
        last_name=teacher.last_name,
        email=teacher.email,
        institution=teacher.institution,
        avatar_url=teacher.avatar_url,
        ui_accent=teacher.ui_accent,
    )

DEFAULT_MODULES = ["chatbot", "classification", "self_assessment", "chat"]


class ClassWithRoleResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    teacher_id: UUID
    name: str
    created_at: datetime
    role: str  # 'owner' or 'invited'
    owner_name: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("/classes")
async def list_classes(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """List all classes the teacher owns or has been invited to"""
    # Get owned classes
    result = await db.execute(
        select(Class)
        .where(Class.teacher_id == teacher.id)
        .where(Class.tenant_id == teacher.tenant_id)
        .order_by(Class.created_at.desc())
    )
    owned_classes = result.scalars().all()

    classes_response = []
    for cls in owned_classes:
        classes_response.append({
            "id": cls.id,
            "tenant_id": cls.tenant_id,
            "teacher_id": cls.teacher_id,
            "name": cls.name,
            "created_at": cls.created_at,
            "role": "owner",
            "owner_name": None,
        })

    # Get shared classes (via ClassTeacher)
    result = await db.execute(
        select(Class, User)
        .join(ClassTeacher, ClassTeacher.class_id == Class.id)
        .join(User, Class.teacher_id == User.id)
        .where(ClassTeacher.teacher_id == teacher.id)
        .where(Class.tenant_id == teacher.tenant_id)
        .order_by(Class.created_at.desc())
    )
    for cls, owner in result.all():
        owner_name = f"{owner.first_name or ''} {owner.last_name or ''}".strip() or owner.email
        classes_response.append({
            "id": cls.id,
            "tenant_id": cls.tenant_id,
            "teacher_id": cls.teacher_id,
            "name": cls.name,
            "created_at": cls.created_at,
            "role": "invited",
            "owner_name": owner_name,
        })

    # Sort by created_at desc
    classes_response.sort(key=lambda x: x["created_at"], reverse=True)

    return classes_response


@router.post("/classes", response_model=ClassResponse)
async def create_class(
    request: ClassCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    class_ = Class(
        tenant_id=teacher.tenant_id,
        teacher_id=teacher.id,
        name=request.name,
    )
    db.add(class_)
    await db.commit()
    await db.refresh(class_)
    return class_


@router.patch("/classes/{class_id}", response_model=ClassResponse)
async def update_class(
    class_id: UUID,
    request: ClassCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Allow access if owner or invited
    class_ = await get_class_with_access_check(db, teacher, class_id)
    if not class_:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    class_.name = request.name
    await db.commit()
    await db.refresh(class_)
    return class_


@router.get("/classes/{class_id}/sessions", response_model=list[SessionResponse])
async def list_sessions(
    class_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify class access (owner or invited)
    class_ = await get_class_with_access_check(db, teacher, class_id)
    if not class_:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    result = await db.execute(
        select(Session)
        .where(Session.class_id == class_id)
        .order_by(Session.created_at.desc())
    )
    return result.scalars().all()


@router.post("/classes/{class_id}/sessions", response_model=SessionResponse)
async def create_session(
    class_id: UUID,
    request: SessionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify class access (owner or invited can create sessions)
    class_ = await get_class_with_access_check(db, teacher, class_id)
    if not class_:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")
    
    # Generate unique join code
    join_code = generate_join_code()
    while True:
        result = await db.execute(select(Session).where(Session.join_code == join_code))
        if not result.scalar_one_or_none():
            break
        join_code = generate_join_code()
    
    session = Session(
        tenant_id=teacher.tenant_id,
        class_id=class_id,
        title=request.title,
        join_code=join_code,
        is_persistent=request.is_persistent,
        starts_at=request.starts_at,
        ends_at=request.ends_at,
    )
    db.add(session)
    await db.flush()
    
    # Create default modules
    for module_key in DEFAULT_MODULES:
        module = SessionModule(
            tenant_id=teacher.tenant_id,
            session_id=session.id,
            module_key=module_key,
            is_enabled=True,
            config_json={},
        )
        db.add(module)
    
    await db.commit()
    await db.refresh(session)
    return session


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: UUID,
    request: SessionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify session access (via class or direct invite)
    session_data = await get_session_with_access_check(db, teacher, session_id)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session, _ = session_data
    
    if request.title is not None:
        session.title = request.title
    if request.status is not None:
        session.status = SessionStatus(request.status)
    if request.is_persistent is not None:
        session.is_persistent = request.is_persistent
    if request.starts_at is not None:
        session.starts_at = request.starts_at
    if request.ends_at is not None:
        session.ends_at = request.ends_at
    if request.default_llm_provider is not None:
        session.default_llm_provider = request.default_llm_provider
    if request.default_llm_model is not None:
        session.default_llm_model = request.default_llm_model
    
    await db.commit()
    await db.refresh(session)
    return session


@router.post("/sessions/{session_id}/modules", response_model=list[SessionModuleResponse])
async def update_session_modules(
    session_id: UUID,
    request: SessionModulesRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify session access
    session_data = await get_session_with_access_check(db, teacher, session_id)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session, _ = session_data
    
    updated_modules = []
    for module_update in request.modules:
        result = await db.execute(
            select(SessionModule)
            .where(SessionModule.session_id == session_id)
            .where(SessionModule.module_key == module_update.module_key)
        )
        module = result.scalar_one_or_none()
        
        if module:
            module.is_enabled = module_update.is_enabled
            if module_update.config_json is not None:
                module.config_json = module_update.config_json
        else:
            module = SessionModule(
                tenant_id=session.tenant_id,
                session_id=session_id,
                module_key=module_update.module_key,
                is_enabled=module_update.is_enabled,
                config_json=module_update.config_json or {},
            )
            db.add(module)
        
        updated_modules.append(module)
    
    await db.commit()
    for m in updated_modules:
        await db.refresh(m)
    
    return updated_modules


@router.get("/sessions/{session_id}/live")
async def get_session_live(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify session access and get class name
    session_data = await get_session_with_access_check(db, teacher, session_id)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session, class_ = session_data
    
    # Get all students for this session
    result = await db.execute(
        select(SessionStudent)
        .where(SessionStudent.session_id == session_id)
        .order_by(SessionStudent.created_at.desc())
    )
    students = result.scalars().all()
    
    # Get enabled modules
    result = await db.execute(
        select(SessionModule)
        .where(SessionModule.session_id == session_id)
    )
    modules = result.scalars().all()
    
    return {
        "session": {
            "id": str(session.id),
            "title": session.title,
            "join_code": session.join_code,
            "status": session.status.value,
            "class_name": class_.name,
            "default_llm_provider": session.default_llm_provider,
            "default_llm_model": session.default_llm_model,
        },
        "students": [
            {
                "id": str(s.id),
                "nickname": s.nickname,
                "is_frozen": s.is_frozen,
                "joined_at": s.created_at.isoformat() if s.created_at else None,
                "last_activity_at": s.last_seen_at.isoformat() if s.last_seen_at else None,
            }
            for s in students
        ],
        "modules": [
            {
                "module_key": m.module_key,
                "is_enabled": m.is_enabled,
            }
            for m in modules
        ],
    }


@router.patch("/sessions/{session_id}/modules/{module_key}")
async def toggle_module(
    session_id: UUID,
    module_key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    is_enabled: bool = True,
):
    """Enable or disable a module for a session"""
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    # Find or create module entry
    result = await db.execute(
        select(SessionModule)
        .where(SessionModule.session_id == session_id)
        .where(SessionModule.module_key == module_key)
    )
    module = result.scalar_one_or_none()
    
    if module:
        module.is_enabled = is_enabled
    else:
        module = SessionModule(
            session_id=session_id,
            module_key=module_key,
            is_enabled=is_enabled,
        )
        db.add(module)
    
    await db.commit()
    return {"message": f"Module {module_key} {'enabled' if is_enabled else 'disabled'}", "module_key": module_key, "is_enabled": is_enabled}


@router.post("/sessions/{session_id}/freeze/{student_id}")
async def freeze_student(
    session_id: UUID,
    student_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    reason: str = "Frozen by teacher",
):
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    result = await db.execute(
        select(SessionStudent)
        .where(SessionStudent.id == student_id)
        .where(SessionStudent.session_id == session_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    
    student.is_frozen = True
    student.frozen_reason = reason
    
    # Log audit event
    audit = AuditEvent(
        tenant_id=student.tenant_id,
        session_id=session_id,
        actor_type="TEACHER",
        actor_user_id=teacher.id,
        event_type="USER_FROZEN",
        payload_json={"student_id": str(student_id), "reason": reason},
    )
    db.add(audit)
    
    await db.commit()
    return {"message": "Student frozen", "student_id": str(student_id)}


@router.post("/sessions/{session_id}/unfreeze/{student_id}")
async def unfreeze_student(
    session_id: UUID,
    student_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    result = await db.execute(
        select(SessionStudent)
        .where(SessionStudent.id == student_id)
        .where(SessionStudent.session_id == session_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    
    student.is_frozen = False
    student.frozen_reason = None
    
    await db.commit()
    return {"message": "Student unfrozen", "student_id": str(student_id)}


@router.delete("/sessions/{session_id}/students/{student_id}")
async def remove_student(
    session_id: UUID,
    student_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Remove a student from a session (hard delete)"""
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    result = await db.execute(
        select(SessionStudent)
        .where(SessionStudent.id == student_id)
        .where(SessionStudent.session_id == session_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    
    student_nickname = student.nickname
    
    # Log audit event before deletion
    audit = AuditEvent(
        tenant_id=student.tenant_id,
        session_id=session_id,
        actor_type="TEACHER",
        actor_user_id=teacher.id,
        event_type="USER_REMOVED",
        payload_json={"student_id": str(student_id), "nickname": student_nickname},
    )
    db.add(audit)
    
    # Delete the student (cascade will handle related records)
    await db.delete(student)
    await db.commit()
    
    return {"message": "Student removed", "student_id": str(student_id), "nickname": student_nickname}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    confirm: bool = False,
):
    if not confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation required. Set confirm=true to delete.",
        )

    # Only owner can delete sessions
    if not await teacher_is_session_owner(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the class owner can delete sessions")

    result = await db.execute(
        select(Session).where(Session.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    # Delete related records first (those without cascade)
    from app.models.task import Task, TaskSubmission
    from app.models.chat import ChatMessage
    
    # Delete task submissions first, then tasks
    await db.execute(
        TaskSubmission.__table__.delete().where(
            TaskSubmission.task_id.in_(
                select(Task.id).where(Task.session_id == session_id)
            )
        )
    )
    await db.execute(Task.__table__.delete().where(Task.session_id == session_id))
    
    # Delete chat messages
    await db.execute(ChatMessage.__table__.delete().where(ChatMessage.session_id == session_id))
    
    # Now delete the session (cascade will handle modules, students, chat_rooms, conversations)
    await db.delete(session)
    await db.commit()
    
    return {"message": "Session deleted", "session_id": str(session_id)}


@router.post("/sessions/{session_id}/export")
async def export_session(
    session_id: UUID,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    # TODO: Enqueue export job via Celery
    export_id = str(session_id)  # Placeholder
    
    return {"message": "Export queued", "export_id": export_id}


@router.get("/sessions/{session_id}/audit")
async def get_session_audit(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    cursor: Optional[str] = None,
    limit: int = Query(50, le=100),
):
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    query = (
        select(AuditEvent)
        .where(AuditEvent.session_id == session_id)
        .order_by(AuditEvent.created_at.desc())
        .limit(limit)
    )
    
    if cursor:
        query = query.where(AuditEvent.created_at < datetime.fromisoformat(cursor))
    
    result = await db.execute(query)
    events = result.scalars().all()
    
    next_cursor = None
    if events and len(events) == limit:
        next_cursor = events[-1].created_at.isoformat()
    
    return {
        "events": [
            {
                "id": str(e.id),
                "event_type": e.event_type,
                "actor_type": e.actor_type,
                "payload": e.payload_json,
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ],
        "next_cursor": next_cursor,
    }


# ==================== TASK ENDPOINTS ====================

# ==================== DOCUMENT DRAFTS ====================

@router.get("/documents/drafts")
async def list_document_drafts(
    session_id: UUID | None = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    teacher: Annotated[User, Depends(get_current_teacher)] = None,
):
    query = select(DocumentDraft).where(DocumentDraft.owner_teacher_id == teacher.id)
    if session_id:
        if not await teacher_can_access_session(db, teacher, session_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        query = query.where(DocumentDraft.session_id == session_id)
    result = await db.execute(query.order_by(DocumentDraft.updated_at.desc()))
    drafts = result.scalars().all()
    return [
        {
            "id": str(d.id),
            "title": d.title,
            "doc_type": d.doc_type,
            "content_json": d.content_json,
            "session_id": str(d.session_id) if d.session_id else None,
            "created_at": d.created_at.isoformat(),
            "updated_at": d.updated_at.isoformat(),
        }
        for d in drafts
    ]


@router.post("/documents/drafts")
async def create_document_draft(
    request: DocumentDraftCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    if request.session_id and not await teacher_can_access_session(db, teacher, request.session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    draft = DocumentDraft(
        tenant_id=teacher.tenant_id,
        session_id=request.session_id,
        owner_teacher_id=teacher.id,
        title=request.title,
        doc_type=request.doc_type,
        content_json=request.content_json,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return {
        "id": str(draft.id),
        "title": draft.title,
        "doc_type": draft.doc_type,
        "content_json": draft.content_json,
        "session_id": str(draft.session_id) if draft.session_id else None,
        "created_at": draft.created_at.isoformat(),
        "updated_at": draft.updated_at.isoformat(),
    }


@router.patch("/documents/drafts/{draft_id}")
async def update_document_draft(
    draft_id: UUID,
    request: DocumentDraftUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    result = await db.execute(
        select(DocumentDraft)
        .where(DocumentDraft.id == draft_id)
        .where(DocumentDraft.owner_teacher_id == teacher.id)
    )
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    if request.session_id and not await teacher_can_access_session(db, teacher, request.session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if request.title is not None:
        draft.title = request.title
    if request.doc_type is not None:
        draft.doc_type = request.doc_type
    if request.content_json is not None:
        draft.content_json = request.content_json
    if request.session_id is not None:
        draft.session_id = request.session_id
    await db.commit()
    await db.refresh(draft)
    return {
        "id": str(draft.id),
        "title": draft.title,
        "doc_type": draft.doc_type,
        "content_json": draft.content_json,
        "session_id": str(draft.session_id) if draft.session_id else None,
        "created_at": draft.created_at.isoformat(),
        "updated_at": draft.updated_at.isoformat(),
    }


@router.delete("/documents/drafts/{draft_id}")
async def delete_document_draft(
    draft_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    result = await db.execute(
        select(DocumentDraft)
        .where(DocumentDraft.id == draft_id)
        .where(DocumentDraft.owner_teacher_id == teacher.id)
    )
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    await db.delete(draft)
    await db.commit()
    return {"status": "deleted"}

@router.get("/sessions/{session_id}/tasks")
async def list_tasks(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """List all tasks for a session"""
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    result = await db.execute(
        select(Task)
        .where(Task.session_id == session_id)
        .order_by(Task.created_at.desc())
    )
    tasks = result.scalars().all()
    
    return [
        {
            "id": str(t.id),
            "title": t.title,
            "description": t.description,
            "task_type": t.task_type.value if t.task_type else "exercise",
            "status": t.status.value if t.status else "draft",
            "due_at": t.due_at.isoformat() if t.due_at else None,
            "points": t.points,
            "content_json": t.content_json,
            "created_at": t.created_at.isoformat(),
        }
        for t in tasks
    ]


@router.post("/sessions/{session_id}/tasks")
async def create_task(
    session_id: UUID,
    request: TaskCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Create a new task for a session"""
    # Verify session access
    session_data = await get_session_with_access_check(db, teacher, session_id)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session, _ = session_data

    # Determine if this should be auto-published (lessons and presentations)
    task_type = TaskType(request.task_type) if request.task_type in [t.value for t in TaskType] else TaskType.EXERCISE
    auto_publish = task_type in [TaskType.LESSON, TaskType.PRESENTATION]

    task = Task(
        tenant_id=session.tenant_id,
        session_id=session_id,
        title=request.title,
        description=request.description,
        task_type=task_type,
        status=TaskStatus.PUBLISHED if auto_publish else TaskStatus.DRAFT,
        due_at=request.due_at,
        points=request.points,
        content_json=request.content_json,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # If auto-published (lesson/presentation), create chat message and emit socket event
    if auto_publish:
        # Get or create public chat room
        result = await db.execute(
            select(ChatRoom)
            .where(ChatRoom.session_id == session_id)
            .where(ChatRoom.room_type == ChatRoomType.PUBLIC)
        )
        room = result.scalar_one_or_none()
        if not room:
            room = ChatRoom(
                tenant_id=session.tenant_id,
                session_id=session_id,
                room_type=ChatRoomType.PUBLIC,
            )
            db.add(room)
            await db.commit()
            await db.refresh(room)

        # Determine message text and icon based on type
        if task_type == TaskType.PRESENTATION:
            msg_text = f"📊 Nuova presentazione disponibile: {task.title}"
            type_label = "presentation"
        else:
            msg_text = f"📄 Nuovo documento disponibile: {task.title}"
            type_label = "lesson"

        # Create chat message
        import json
        chat_message = ChatMessage(
            tenant_id=session.tenant_id,
            session_id=session_id,
            room_id=room.id,
            sender_type=SenderType.TEACHER,
            sender_teacher_id=teacher.id,
            message_text=msg_text,
            attachments=json.dumps([{
                "type": "task_link",
                "task_id": str(task.id),
                "task_type": type_label,
                "title": task.title
            }])
        )
        db.add(chat_message)
        await db.commit()
        await db.refresh(chat_message)

        # Emit socket event to notify students
        await sio.emit(
            "chat_message",
            {
                "room_type": "PUBLIC",
                "session_id": str(session_id),
                "message": {
                    "id": str(chat_message.id),
                    "sender_type": "TEACHER",
                    "sender_id": str(teacher.id),
                    "sender_name": "Docente",
                    "text": msg_text,
                    "created_at": chat_message.created_at.isoformat(),
                    "is_notification": True,
                    "notification_type": type_label,
                    "notification_data": {
                        "task_id": str(task.id),
                        "title": task.title,
                        "task_type": type_label
                    },
                },
            },
            room=f"session:{session_id}",
        )

    return {
        "id": str(task.id),
        "title": task.title,
        "description": task.description,
        "task_type": task.task_type.value,
        "status": task.status.value,
        "due_at": task.due_at.isoformat() if task.due_at else None,
        "points": task.points,
        "content_json": task.content_json,
        "created_at": task.created_at.isoformat(),
    }


@router.patch("/sessions/{session_id}/tasks/{task_id}")
async def update_task(
    session_id: UUID,
    task_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    title: str = None,
    description: str = None,
    new_status: str = None,
    due_at: datetime = None,
    points: str = None,
):
    """Update a task"""
    # Verify session access
    session_data = await get_session_with_access_check(db, teacher, session_id)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session, _ = session_data
    
    result = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .where(Task.session_id == session_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    
    old_status = task.status
    
    if title is not None:
        task.title = title
    if description is not None:
        task.description = description
    if new_status is not None and new_status in [s.value for s in TaskStatus]:
        task.status = TaskStatus(new_status)
    if due_at is not None:
        task.due_at = due_at
    if points is not None:
        task.points = points
    
    await db.commit()
    await db.refresh(task)
    
    # If task was just published, send notification to students
    if old_status != TaskStatus.PUBLISHED and task.status == TaskStatus.PUBLISHED:
        # Get or create public chat room
        result = await db.execute(
            select(ChatRoom)
            .where(ChatRoom.session_id == session_id)
            .where(ChatRoom.room_type == ChatRoomType.PUBLIC)
        )
        room = result.scalar_one_or_none()
        if not room:
            room = ChatRoom(
                tenant_id=session.tenant_id,
                session_id=session_id,
                room_type=ChatRoomType.PUBLIC,
            )
            db.add(room)
            await db.commit()
            await db.refresh(room)
        
        # Save notification message to chat
        notification_text = f"📋 Nuovo compito: {task.title}"
        chat_message = ChatMessage(
            tenant_id=session.tenant_id,
            session_id=session_id,
            room_id=room.id,
            sender_type=SenderType.TEACHER,
            sender_teacher_id=teacher.id,
            message_text=notification_text,
            attachments={
                "is_notification": True,
                "notification_type": task.task_type.value if task.task_type else "exercise",
                "notification_data": {
                    "task_id": str(task.id),
                    "title": task.title,
                    "task_type": task.task_type.value if task.task_type else "exercise",
                },
            },
        )
        db.add(chat_message)
        await db.commit()
        
        # Emit Socket.IO event to all students in session
        # Only emit task_published - the frontend will create the notification message
        await sio.emit(
            "task_published",
            {
                "task_id": str(task.id),
                "title": task.title,
                "task_type": task.task_type.value if task.task_type else "exercise",
            },
            room=f"session:{session_id}",
        )
    
    return {
        "id": str(task.id),
        "title": task.title,
        "description": task.description,
        "task_type": task.task_type.value,
        "status": task.status.value,
        "due_at": task.due_at.isoformat() if task.due_at else None,
        "points": task.points,
    }


@router.delete("/sessions/{session_id}/tasks/{task_id}")
async def delete_task(
    session_id: UUID,
    task_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Delete a task"""
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    result = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .where(Task.session_id == session_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    
    await db.delete(task)
    await db.commit()
    
    return {"message": "Task deleted"}


@router.get("/sessions/{session_id}/tasks/{task_id}/submissions")
async def get_task_submissions(
    session_id: UUID,
    task_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get all submissions for a task"""
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    result = await db.execute(
        select(TaskSubmission, SessionStudent)
        .join(SessionStudent, TaskSubmission.student_id == SessionStudent.id)
        .where(TaskSubmission.task_id == task_id)
        .order_by(TaskSubmission.submitted_at.desc())
    )
    rows = result.all()
    
    return [
        {
            "id": str(sub.id),
            "student_id": str(sub.student_id),
            "student_nickname": student.nickname,
            "content": sub.content,
            "content_json": sub.content_json,
            "submitted_at": sub.submitted_at.isoformat(),
            "score": sub.score,
            "feedback": sub.feedback,
        }
        for sub, student in rows
    ]


@router.patch("/sessions/{session_id}/tasks/{task_id}/submissions/{submission_id}")
async def grade_submission(
    session_id: UUID,
    task_id: UUID,
    submission_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    score: str = None,
    feedback: str = None,
):
    """Grade a task submission"""
    # Verify session access
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    result = await db.execute(
        select(TaskSubmission)
        .where(TaskSubmission.id == submission_id)
        .where(TaskSubmission.task_id == task_id)
    )
    submission = result.scalar_one_or_none()
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    
    if score is not None:
        submission.score = score
    if feedback is not None:
        submission.feedback = feedback

    await db.commit()

    return {"message": "Submission graded", "score": score, "feedback": feedback}


# ==================== INVITATION ENDPOINTS ====================

def _teacher_to_basic_info(user: User) -> TeacherBasicInfo:
    """Convert User to TeacherBasicInfo"""
    return TeacherBasicInfo(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        avatar_url=user.avatar_url,
    )


@router.get("/invitations", response_model=InvitationsListResponse)
async def get_invitations(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get all pending invitations for the current teacher"""
    # Get pending class invitations
    result = await db.execute(
        select(ClassInvitation, Class, User)
        .join(Class, ClassInvitation.class_id == Class.id)
        .join(User, ClassInvitation.inviter_id == User.id)
        .where(ClassInvitation.invitee_id == teacher.id)
        .where(ClassInvitation.status == InvitationStatus.PENDING)
        .where(ClassInvitation.tenant_id == teacher.tenant_id)
        .order_by(ClassInvitation.created_at.desc())
    )
    class_invitations_data = result.all()

    class_invitations = [
        ClassInvitationResponse(
            id=inv.id,
            class_id=cls.id,
            class_name=cls.name,
            inviter=_teacher_to_basic_info(inviter),
            status=inv.status.value,
            created_at=inv.created_at,
            responded_at=inv.responded_at,
        )
        for inv, cls, inviter in class_invitations_data
    ]

    # Get pending session invitations
    result = await db.execute(
        select(SessionInvitation, Session, Class, User)
        .join(Session, SessionInvitation.session_id == Session.id)
        .join(Class, Session.class_id == Class.id)
        .join(User, SessionInvitation.inviter_id == User.id)
        .where(SessionInvitation.invitee_id == teacher.id)
        .where(SessionInvitation.status == InvitationStatus.PENDING)
        .where(SessionInvitation.tenant_id == teacher.tenant_id)
        .order_by(SessionInvitation.created_at.desc())
    )
    session_invitations_data = result.all()

    session_invitations = [
        SessionInvitationResponse(
            id=inv.id,
            session_id=sess.id,
            session_title=sess.title,
            class_name=cls.name,
            inviter=_teacher_to_basic_info(inviter),
            status=inv.status.value,
            created_at=inv.created_at,
            responded_at=inv.responded_at,
        )
        for inv, sess, cls, inviter in session_invitations_data
    ]

    return InvitationsListResponse(
        class_invitations=class_invitations,
        session_invitations=session_invitations,
        total_pending=len(class_invitations) + len(session_invitations),
    )


@router.post("/invitations/class/{invitation_id}/respond")
async def respond_to_class_invitation(
    invitation_id: UUID,
    request: InvitationResponseRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Accept or decline a class invitation"""
    result = await db.execute(
        select(ClassInvitation)
        .where(ClassInvitation.id == invitation_id)
        .where(ClassInvitation.invitee_id == teacher.id)
        .where(ClassInvitation.tenant_id == teacher.tenant_id)
    )
    invitation = result.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation already responded to")

    invitation.responded_at = datetime.utcnow()

    if request.accept:
        invitation.status = InvitationStatus.ACCEPTED
        # Add teacher to class
        class_teacher = ClassTeacher(
            tenant_id=teacher.tenant_id,
            class_id=invitation.class_id,
            teacher_id=teacher.id,
            added_by_id=invitation.inviter_id,
        )
        db.add(class_teacher)
    else:
        invitation.status = InvitationStatus.DECLINED

    await db.commit()

    return {
        "message": "Invitation accepted" if request.accept else "Invitation declined",
        "status": invitation.status.value,
    }


@router.post("/invitations/session/{invitation_id}/respond")
async def respond_to_session_invitation(
    invitation_id: UUID,
    request: InvitationResponseRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Accept or decline a session invitation"""
    result = await db.execute(
        select(SessionInvitation)
        .where(SessionInvitation.id == invitation_id)
        .where(SessionInvitation.invitee_id == teacher.id)
        .where(SessionInvitation.tenant_id == teacher.tenant_id)
    )
    invitation = result.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation already responded to")

    invitation.responded_at = datetime.utcnow()

    if request.accept:
        invitation.status = InvitationStatus.ACCEPTED
        # Add teacher to session
        session_teacher = SessionTeacher(
            tenant_id=teacher.tenant_id,
            session_id=invitation.session_id,
            teacher_id=teacher.id,
            added_by_id=invitation.inviter_id,
        )
        db.add(session_teacher)
    else:
        invitation.status = InvitationStatus.DECLINED

    await db.commit()

    return {
        "message": "Invitation accepted" if request.accept else "Invitation declined",
        "status": invitation.status.value,
    }


# ==================== CLASS TEACHERS MANAGEMENT ====================

@router.get("/classes/{class_id}/teachers")
async def get_class_teachers(
    class_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get all teachers for a class (owner + invited)"""
    # Verify access to class
    class_ = await get_class_with_access_check(db, teacher, class_id)
    if not class_:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    # Get class owner
    result = await db.execute(
        select(User).where(User.id == class_.teacher_id)
    )
    owner = result.scalar_one()

    teachers_list = [
        {
            "id": None,  # No ClassTeacher record for owner
            "teacher": _teacher_to_basic_info(owner),
            "added_at": class_.created_at,
            "added_by": _teacher_to_basic_info(owner),
            "is_owner": True,
        }
    ]

    # Get invited teachers
    result = await db.execute(
        select(ClassTeacher, User)
        .join(User, ClassTeacher.teacher_id == User.id)
        .where(ClassTeacher.class_id == class_id)
    )
    for ct, invited_teacher in result.all():
        # Get who added this teacher
        result_added_by = await db.execute(
            select(User).where(User.id == ct.added_by_id)
        )
        added_by = result_added_by.scalar_one()

        teachers_list.append({
            "id": str(ct.id),
            "teacher": _teacher_to_basic_info(invited_teacher),
            "added_at": ct.added_at,
            "added_by": _teacher_to_basic_info(added_by),
            "is_owner": False,
        })

    # Get pending invitations (for owner to see)
    pending_invitations = []
    if class_.teacher_id == teacher.id:
        result = await db.execute(
            select(ClassInvitation, User)
            .join(User, ClassInvitation.invitee_id == User.id)
            .where(ClassInvitation.class_id == class_id)
            .where(ClassInvitation.status == InvitationStatus.PENDING)
        )
        for inv, invitee in result.all():
            pending_invitations.append({
                "id": str(inv.id),
                "invitee": _teacher_to_basic_info(invitee),
                "created_at": inv.created_at,
            })

    return {
        "teachers": teachers_list,
        "pending_invitations": pending_invitations,
        "is_owner": class_.teacher_id == teacher.id,
    }


@router.post("/classes/{class_id}/teachers/invite")
async def invite_teacher_to_class(
    class_id: UUID,
    request: InviteTeacherRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Invite a teacher to a class"""
    # Verify access to class (any teacher with access can invite)
    class_ = await get_class_with_access_check(db, teacher, class_id)
    if not class_:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    # Find the teacher to invite by email
    result = await db.execute(
        select(User)
        .where(User.email == request.email)
        .where(User.tenant_id == teacher.tenant_id)
        .where(User.role == UserRole.TEACHER)
    )
    invitee = result.scalar_one_or_none()
    if not invitee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found in this tenant")

    # Cannot invite self
    if invitee.id == teacher.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot invite yourself")

    # Cannot invite the owner
    if invitee.id == class_.teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already the class owner")

    # Check if already a member
    result = await db.execute(
        select(ClassTeacher)
        .where(ClassTeacher.class_id == class_id)
        .where(ClassTeacher.teacher_id == invitee.id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teacher is already a member")

    # Check if there's a pending invitation
    result = await db.execute(
        select(ClassInvitation)
        .where(ClassInvitation.class_id == class_id)
        .where(ClassInvitation.invitee_id == invitee.id)
        .where(ClassInvitation.status == InvitationStatus.PENDING)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation already pending")

    # Create invitation
    invitation = ClassInvitation(
        tenant_id=teacher.tenant_id,
        class_id=class_id,
        inviter_id=teacher.id,
        invitee_id=invitee.id,
    )
    db.add(invitation)
    await db.commit()

    return {
        "message": "Invitation sent",
        "invitee": _teacher_to_basic_info(invitee),
    }


@router.delete("/classes/{class_id}/teachers/{teacher_id}")
async def remove_teacher_from_class(
    class_id: UUID,
    teacher_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Remove a teacher from a class (only owner can do this)"""
    # Only owner can remove teachers
    if not await teacher_is_class_owner(db, teacher, class_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the class owner can remove teachers")

    # Cannot remove the owner
    result = await db.execute(
        select(Class).where(Class.id == class_id)
    )
    class_ = result.scalar_one()
    if class_.teacher_id == teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove the class owner")

    # Find and remove the teacher
    result = await db.execute(
        select(ClassTeacher)
        .where(ClassTeacher.class_id == class_id)
        .where(ClassTeacher.teacher_id == teacher_id)
    )
    class_teacher = result.scalar_one_or_none()
    if not class_teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found in class")

    await db.delete(class_teacher)
    await db.commit()

    return {"message": "Teacher removed from class"}


# ==================== SESSION TEACHERS MANAGEMENT ====================

@router.get("/sessions/{session_id}/teachers")
async def get_session_teachers(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get all teachers for a session"""
    # Verify access to session
    session_data = await get_session_with_access_check(db, teacher, session_id)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session, class_ = session_data

    # Get class owner (also session owner)
    result = await db.execute(
        select(User).where(User.id == class_.teacher_id)
    )
    owner = result.scalar_one()

    teachers_list = [
        {
            "id": None,
            "teacher": _teacher_to_basic_info(owner),
            "added_at": session.created_at,
            "added_by": _teacher_to_basic_info(owner),
            "is_owner": True,
            "via_class": True,
        }
    ]

    # Get class teachers (they have access to all sessions in the class)
    result = await db.execute(
        select(ClassTeacher, User)
        .join(User, ClassTeacher.teacher_id == User.id)
        .where(ClassTeacher.class_id == class_.id)
    )
    for ct, class_teacher_user in result.all():
        result_added_by = await db.execute(
            select(User).where(User.id == ct.added_by_id)
        )
        added_by = result_added_by.scalar_one()

        teachers_list.append({
            "id": str(ct.id),
            "teacher": _teacher_to_basic_info(class_teacher_user),
            "added_at": ct.added_at,
            "added_by": _teacher_to_basic_info(added_by),
            "is_owner": False,
            "via_class": True,
        })

    # Get direct session teachers
    result = await db.execute(
        select(SessionTeacher, User)
        .join(User, SessionTeacher.teacher_id == User.id)
        .where(SessionTeacher.session_id == session_id)
    )
    for st, session_teacher_user in result.all():
        result_added_by = await db.execute(
            select(User).where(User.id == st.added_by_id)
        )
        added_by = result_added_by.scalar_one()

        teachers_list.append({
            "id": str(st.id),
            "teacher": _teacher_to_basic_info(session_teacher_user),
            "added_at": st.added_at,
            "added_by": _teacher_to_basic_info(added_by),
            "is_owner": False,
            "via_class": False,
        })

    # Get pending invitations
    pending_invitations = []
    if class_.teacher_id == teacher.id or await teacher_can_access_class(db, teacher, class_.id):
        result = await db.execute(
            select(SessionInvitation, User)
            .join(User, SessionInvitation.invitee_id == User.id)
            .where(SessionInvitation.session_id == session_id)
            .where(SessionInvitation.status == InvitationStatus.PENDING)
        )
        for inv, invitee in result.all():
            pending_invitations.append({
                "id": str(inv.id),
                "invitee": _teacher_to_basic_info(invitee),
                "created_at": inv.created_at,
            })

    return {
        "teachers": teachers_list,
        "pending_invitations": pending_invitations,
        "is_owner": class_.teacher_id == teacher.id,
    }


@router.post("/sessions/{session_id}/teachers/invite")
async def invite_teacher_to_session(
    session_id: UUID,
    request: InviteTeacherRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Invite a teacher to a specific session"""
    # Verify access to session
    session_data = await get_session_with_access_check(db, teacher, session_id)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session, class_ = session_data

    # Find the teacher to invite by email
    result = await db.execute(
        select(User)
        .where(User.email == request.email)
        .where(User.tenant_id == teacher.tenant_id)
        .where(User.role == UserRole.TEACHER)
    )
    invitee = result.scalar_one_or_none()
    if not invitee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found in this tenant")

    # Cannot invite self
    if invitee.id == teacher.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot invite yourself")

    # Check if already has access via class
    if invitee.id == class_.teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already the class owner")

    result = await db.execute(
        select(ClassTeacher)
        .where(ClassTeacher.class_id == class_.id)
        .where(ClassTeacher.teacher_id == invitee.id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teacher already has access via class membership")

    # Check if already a direct session member
    result = await db.execute(
        select(SessionTeacher)
        .where(SessionTeacher.session_id == session_id)
        .where(SessionTeacher.teacher_id == invitee.id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teacher is already a member")

    # Check if there's a pending invitation
    result = await db.execute(
        select(SessionInvitation)
        .where(SessionInvitation.session_id == session_id)
        .where(SessionInvitation.invitee_id == invitee.id)
        .where(SessionInvitation.status == InvitationStatus.PENDING)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation already pending")

    # Create invitation
    invitation = SessionInvitation(
        tenant_id=teacher.tenant_id,
        session_id=session_id,
        inviter_id=teacher.id,
        invitee_id=invitee.id,
    )
    db.add(invitation)
    await db.commit()

    return {
        "message": "Invitation sent",
        "invitee": _teacher_to_basic_info(invitee),
    }


@router.delete("/sessions/{session_id}/teachers/{teacher_id}")
async def remove_teacher_from_session(
    session_id: UUID,
    teacher_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Remove a teacher from a session (only owner can do this)"""
    # Only class owner can remove teachers
    if not await teacher_is_session_owner(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the class owner can remove teachers")

    # Find and remove the teacher from session (direct membership only)
    result = await db.execute(
        select(SessionTeacher)
        .where(SessionTeacher.session_id == session_id)
        .where(SessionTeacher.teacher_id == teacher_id)
    )
    session_teacher = result.scalar_one_or_none()
    if not session_teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found in session (may have access via class)")

    await db.delete(session_teacher)
    await db.commit()

    return {"message": "Teacher removed from session"}


# ==================== TEACHER CONVERSATIONS (AI Chat) ====================

class TeacherConversationCreate(BaseModel):
    title: Optional[str] = None
    agent_mode: Optional[str] = "default"


class TeacherConversationResponse(BaseModel):
    id: UUID
    title: Optional[str]
    agent_mode: Optional[str]
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    class Config:
        from_attributes = True


class TeacherMessageCreate(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str
    provider: Optional[str] = None
    model: Optional[str] = None
    attachments_json: Optional[dict] = None


class TeacherMessageResponse(BaseModel):
    id: UUID
    role: str
    content: Optional[str]
    provider: Optional[str]
    model: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/conversations", response_model=list[TeacherConversationResponse])
async def list_teacher_conversations(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    limit: int = Query(50, le=100),
):
    """List all AI chat conversations for the current teacher"""
    from app.models import TeacherConversation, TeacherConversationMessage
    
    # Get conversations with message count
    result = await db.execute(
        select(
            TeacherConversation,
            func.count(TeacherConversationMessage.id).label('message_count')
        )
        .outerjoin(TeacherConversationMessage)
        .where(TeacherConversation.teacher_id == teacher.id)
        .group_by(TeacherConversation.id)
        .order_by(TeacherConversation.updated_at.desc())
        .limit(limit)
    )
    rows = result.all()
    
    return [
        TeacherConversationResponse(
            id=conv.id,
            title=conv.title,
            agent_mode=conv.agent_mode,
            created_at=conv.created_at,
            updated_at=conv.updated_at,
            message_count=msg_count
        )
        for conv, msg_count in rows
    ]


@router.post("/conversations", response_model=TeacherConversationResponse)
async def create_teacher_conversation(
    request: TeacherConversationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Create a new AI chat conversation"""
    from app.models import TeacherConversation
    
    conversation = TeacherConversation(
        tenant_id=teacher.tenant_id,
        teacher_id=teacher.id,
        title=request.title,
        agent_mode=request.agent_mode,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    
    return TeacherConversationResponse(
        id=conversation.id,
        title=conversation.title,
        agent_mode=conversation.agent_mode,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        message_count=0
    )


@router.get("/conversations/{conversation_id}", response_model=dict)
async def get_teacher_conversation(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get a conversation with all its messages"""
    from app.models import TeacherConversation, TeacherConversationMessage
    
    result = await db.execute(
        select(TeacherConversation)
        .where(TeacherConversation.id == conversation_id)
        .where(TeacherConversation.teacher_id == teacher.id)
    )
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    # Get messages
    msg_result = await db.execute(
        select(TeacherConversationMessage)
        .where(TeacherConversationMessage.conversation_id == conversation_id)
        .order_by(TeacherConversationMessage.created_at.asc())
    )
    messages = msg_result.scalars().all()
    
    return {
        "id": conversation.id,
        "title": conversation.title,
        "agent_mode": conversation.agent_mode,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "provider": m.provider,
                "model": m.model,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ]
    }


@router.post("/conversations/{conversation_id}/messages", response_model=TeacherMessageResponse)
async def add_message_to_conversation(
    conversation_id: UUID,
    request: TeacherMessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Add a message to a conversation"""
    from app.models import TeacherConversation, TeacherConversationMessage
    
    # Verify ownership
    result = await db.execute(
        select(TeacherConversation)
        .where(TeacherConversation.id == conversation_id)
        .where(TeacherConversation.teacher_id == teacher.id)
    )
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    message = TeacherConversationMessage(
        tenant_id=teacher.tenant_id,
        conversation_id=conversation_id,
        role=request.role,
        content=request.content,
        provider=request.provider,
        model=request.model,
        attachments_json=request.attachments_json,
    )
    db.add(message)
    
    # Update conversation title if first user message and no title
    if not conversation.title and request.role == 'user':
        conversation.title = request.content[:50] + ('...' if len(request.content) > 50 else '')
    
    # Update conversation timestamp
    conversation.updated_at = func.now()
    
    await db.commit()
    await db.refresh(message)
    
    return message


@router.delete("/conversations/{conversation_id}")
async def delete_teacher_conversation(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Delete a conversation and all its messages"""
    from app.models import TeacherConversation
    
    result = await db.execute(
        select(TeacherConversation)
        .where(TeacherConversation.id == conversation_id)
        .where(TeacherConversation.teacher_id == teacher.id)
    )
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    await db.delete(conversation)  # Cascade deletes messages
    await db.commit()
    
    return {"message": "Conversation deleted"}


@router.patch("/conversations/{conversation_id}")
async def update_teacher_conversation(
    conversation_id: UUID,
    request: TeacherConversationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Update conversation title or mode"""
    from app.models import TeacherConversation
    
    result = await db.execute(
        select(TeacherConversation)
        .where(TeacherConversation.id == conversation_id)
        .where(TeacherConversation.teacher_id == teacher.id)
    )
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    if request.title is not None:
        conversation.title = request.title
    if request.agent_mode is not None:
        conversation.agent_mode = request.agent_mode
    
    await db.commit()
    await db.refresh(conversation)
    
    return {"id": conversation.id, "title": conversation.title, "agent_mode": conversation.agent_mode}
