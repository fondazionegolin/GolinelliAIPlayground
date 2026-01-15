from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import Annotated, Optional
from datetime import datetime, timedelta
from uuid import UUID

from app.core.database import get_db
from app.core.security import generate_join_code
from app.api.deps import get_current_teacher
from app.models.user import User
from app.models.session import Class, Session, SessionModule, SessionStudent
from app.models.llm import AuditEvent
from app.models.chat import ChatRoom, ChatMessage
from app.models.enums import SessionStatus, ChatRoomType, SenderType
from app.models.task import Task, TaskSubmission, TaskStatus, TaskType
from app.realtime.gateway import sio
from app.schemas.session import (
    ClassCreate, ClassResponse,
    SessionCreate, SessionUpdate, SessionResponse,
    SessionModulesRequest, SessionModuleResponse,
    SessionStudentResponse, SessionLiveSnapshot,
)

router = APIRouter()

DEFAULT_MODULES = ["chatbot", "classification", "self_assessment", "chat"]


@router.get("/classes", response_model=list[ClassResponse])
async def list_classes(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    result = await db.execute(
        select(Class)
        .where(Class.teacher_id == teacher.id)
        .order_by(Class.created_at.desc())
    )
    return result.scalars().all()


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
    result = await db.execute(
        select(Class)
        .where(Class.id == class_id)
        .where(Class.teacher_id == teacher.id)
    )
    class_ = result.scalar_one_or_none()
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
    # Verify class ownership
    result = await db.execute(
        select(Class)
        .where(Class.id == class_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
    # Verify class ownership
    result = await db.execute(
        select(Class)
        .where(Class.id == class_id)
        .where(Class.teacher_id == teacher.id)
    )
    class_ = result.scalar_one_or_none()
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
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
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
    # Verify session ownership and get class name
    result = await db.execute(
        select(Session, Class)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    session, class_ = row
    
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
    
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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

@router.get("/sessions/{session_id}/tasks")
async def list_tasks(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """List all tasks for a session"""
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    title: str,
    description: str = None,
    task_type: str = "exercise",
    due_at: datetime = None,
    points: str = None,
    content_json: str = None,
):
    """Create a new task for a session"""
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    task = Task(
        tenant_id=session.tenant_id,
        session_id=session_id,
        title=title,
        description=description,
        task_type=TaskType(task_type) if task_type in [t.value for t in TaskType] else TaskType.EXERCISE,
        status=TaskStatus.DRAFT,
        due_at=due_at,
        points=points,
        content_json=content_json,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
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
