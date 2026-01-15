from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated
from datetime import datetime
from uuid import UUID

from app.core.database import get_db
from app.core.security import create_student_join_token
from app.api.deps import get_current_student
from app.models.session import Session, SessionStudent, SessionModule
from app.models.task import Task, TaskSubmission, TaskStatus
from app.models.enums import SessionStatus
from app.schemas.auth import StudentJoinRequest, StudentJoinResponse
from app.schemas.session import SessionResponse, SessionModuleResponse
from app.realtime.gateway import sio

router = APIRouter()


@router.post("/join", response_model=StudentJoinResponse)
async def join_session(
    request: StudentJoinRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Find session by join code
    result = await db.execute(
        select(Session).where(Session.join_code == request.join_code.upper())
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid join code",
        )
    
    if session.status != SessionStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session is not active",
        )
    
    # Check if nickname already exists in session
    result = await db.execute(
        select(SessionStudent)
        .where(SessionStudent.session_id == session.id)
        .where(SessionStudent.nickname == request.nickname)
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Return existing token if student rejoins
        if existing.is_frozen:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Account frozen: {existing.frozen_reason or 'Contact teacher'}",
            )
        
        existing.last_seen_at = datetime.utcnow()
        await db.commit()
        
        join_token = create_student_join_token(str(session.id), str(existing.id), existing.nickname)
        
        return StudentJoinResponse(
            join_token=join_token,
            student_id=existing.id,
            session_id=session.id,
            session_title=session.title,
        )
    
    # Create new student
    join_token_placeholder = "pending"
    student = SessionStudent(
        tenant_id=session.tenant_id,
        session_id=session.id,
        nickname=request.nickname,
        join_token=join_token_placeholder,
        last_seen_at=datetime.utcnow(),
    )
    db.add(student)
    await db.flush()
    
    # Generate actual token
    join_token = create_student_join_token(str(session.id), str(student.id), student.nickname)
    student.join_token = join_token
    
    await db.commit()
    await db.refresh(student)
    
    return StudentJoinResponse(
        join_token=join_token,
        student_id=student.id,
        session_id=session.id,
        session_title=session.title,
    )


@router.get("/session")
async def get_session_info(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    result = await db.execute(
        select(Session).where(Session.id == student.session_id)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    # Get enabled modules
    result = await db.execute(
        select(SessionModule)
        .where(SessionModule.session_id == session.id)
        .where(SessionModule.is_enabled == True)
    )
    modules = result.scalars().all()
    
    return {
        "session": SessionResponse.model_validate(session),
        "student": {
            "id": str(student.id),
            "nickname": student.nickname,
            "is_frozen": student.is_frozen,
        },
        "enabled_modules": [
            {
                "key": m.module_key,
                "config": m.config_json,
            }
            for m in modules
        ],
    }


@router.post("/heartbeat")
async def heartbeat(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    student.last_seen_at = datetime.utcnow()
    await db.commit()
    return {"status": "ok", "last_seen_at": student.last_seen_at.isoformat()}


@router.get("/tasks")
async def get_student_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Get all published tasks for the student's session"""
    result = await db.execute(
        select(Task)
        .where(Task.session_id == student.session_id)
        .where(Task.status == TaskStatus.PUBLISHED)
        .order_by(Task.created_at.desc())
    )
    tasks = result.scalars().all()
    
    # Get student's submissions
    task_ids = [t.id for t in tasks]
    submissions = {}
    if task_ids:
        result = await db.execute(
            select(TaskSubmission)
            .where(TaskSubmission.task_id.in_(task_ids))
            .where(TaskSubmission.student_id == student.id)
        )
        for sub in result.scalars().all():
            submissions[str(sub.task_id)] = {
                "id": str(sub.id),
                "content": sub.content,
                "submitted_at": sub.submitted_at.isoformat(),
                "score": sub.score,
                "feedback": sub.feedback,
            }
    
    return [
        {
            "id": str(t.id),
            "title": t.title,
            "description": t.description,
            "task_type": t.task_type.value if t.task_type else "exercise",
            "due_at": t.due_at.isoformat() if t.due_at else None,
            "points": t.points,
            "content_json": t.content_json,
            "created_at": t.created_at.isoformat(),
            "submission": submissions.get(str(t.id)),
        }
        for t in tasks
    ]


@router.post("/tasks/{task_id}/submit")
async def submit_task(
    task_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
    content: str = None,
    content_json: str = None,
):
    """Submit a task response"""
    # Verify task exists and is published
    result = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .where(Task.session_id == student.session_id)
        .where(Task.status == TaskStatus.PUBLISHED)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    
    # Check if already submitted
    result = await db.execute(
        select(TaskSubmission)
        .where(TaskSubmission.task_id == task_id)
        .where(TaskSubmission.student_id == student.id)
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Update existing submission
        existing.content = content
        existing.content_json = content_json
        existing.submitted_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing)
        return {
            "id": str(existing.id),
            "content": existing.content,
            "content_json": existing.content_json,
            "submitted_at": existing.submitted_at.isoformat(),
        }
    
    # Create new submission
    submission = TaskSubmission(
        task_id=task_id,
        student_id=student.id,
        content=content,
        content_json=content_json,
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    
    # Notify teacher about new submission
    await sio.emit(
        "task_submission",
        {
            "task_id": str(task_id),
            "task_title": task.title,
            "student_id": str(student.id),
            "student_name": student.nickname,
            "submission_id": str(submission.id),
        },
        room=f"session:{student.session_id}",
    )
    
    return {
        "id": str(submission.id),
        "content": submission.content,
        "content_json": submission.content_json,
        "submitted_at": submission.submitted_at.isoformat(),
    }
