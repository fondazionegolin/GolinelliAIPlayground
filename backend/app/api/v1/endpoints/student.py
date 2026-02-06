from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import create_student_join_token
from app.api.deps import get_current_student
from app.models.session import Session, SessionStudent, SessionModule
from app.models.task import Task, TaskSubmission, TaskStatus
from app.models.document_draft import DocumentDraft
from app.schemas.document_draft import DocumentDraftCreate, DocumentDraftUpdate
from app.models.enums import SessionStatus
from app.schemas.auth import StudentJoinRequest, StudentJoinResponse
from app.schemas.session import SessionResponse, SessionModuleResponse
from app.realtime.gateway import sio

router = APIRouter()

STUDENT_ACCENTS = {"pink", "blue", "cyan", "orange", "mustard"}


class UpdateProfileRequest(BaseModel):
    avatar_url: str | None = None
    ui_accent: str | None = None


class SubmitDocumentRequest(BaseModel):
    title: str
    content_type: str  # 'document' or 'presentation'
    content_json: str


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


@router.get("/profile")
async def get_profile(
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Get student profile"""
    return {
        "id": str(student.id),
        "nickname": student.nickname,
        "avatar_url": student.avatar_url,
        "ui_accent": student.ui_accent,
        "created_at": student.created_at.isoformat() if student.created_at else None,
    }


@router.patch("/profile")
async def update_profile(
    request: UpdateProfileRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Update student profile (avatar, etc)"""
    if request.avatar_url is not None:
        student.avatar_url = request.avatar_url
    if request.ui_accent is not None:
        if request.ui_accent not in STUDENT_ACCENTS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ui_accent")
        student.ui_accent = request.ui_accent
    
    await db.commit()
    await db.refresh(student)
    
    return {
        "id": str(student.id),
        "nickname": student.nickname,
        "avatar_url": student.avatar_url,
        "ui_accent": student.ui_accent,
    }


@router.post("/heartbeat")
async def heartbeat(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    student.last_seen_at = datetime.utcnow()
    await db.commit()
    return {"status": "ok", "last_seen_at": student.last_seen_at.isoformat()}


# ==================== DOCUMENT DRAFTS ====================

@router.get("/documents/drafts")
async def list_document_drafts(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    result = await db.execute(
        select(DocumentDraft)
        .where(DocumentDraft.owner_student_id == student.id)
        .order_by(DocumentDraft.updated_at.desc())
    )
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
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    draft = DocumentDraft(
        tenant_id=student.tenant_id,
        session_id=student.session_id,
        owner_student_id=student.id,
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
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    result = await db.execute(
        select(DocumentDraft)
        .where(DocumentDraft.id == draft_id)
        .where(DocumentDraft.owner_student_id == student.id)
    )
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    if request.title is not None:
        draft.title = request.title
    if request.doc_type is not None:
        draft.doc_type = request.doc_type
    if request.content_json is not None:
        draft.content_json = request.content_json
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
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    result = await db.execute(
        select(DocumentDraft)
        .where(DocumentDraft.id == draft_id)
        .where(DocumentDraft.owner_student_id == student.id)
    )
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    await db.delete(draft)
    await db.commit()
    return {"status": "deleted"}


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
    content: str | None = None,
    content_json: str | None = None,
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
    
    # Send teacher notification for task submission
    await sio.emit(
        "teacher_notification",
        {
            "type": "task_submitted",
            "session_id": str(student.session_id),
            "student_id": str(student.id),
            "nickname": student.nickname,
            "task_id": str(task_id),
            "task_title": task.title,
            "message": f"{student.nickname} ha completato il compito \"{task.title}\"",
            "timestamp": datetime.utcnow().isoformat(),
        },
        room=f"session:{student.session_id}",
    )
    
    return {
        "id": str(submission.id),
        "content": submission.content,
        "content_json": submission.content_json,
        "submitted_at": submission.submitted_at.isoformat(),
    }


@router.post("/documents/submit")
async def submit_document(
    request: SubmitDocumentRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """
    Submit a student-created document to the teacher.
    This creates a task of type 'student_submission' and auto-submits it.
    The teacher will see it in their tasks/submissions view.
    """
    from app.models.task import TaskType

    # Create a task for this submission
    task = Task(
        session_id=student.session_id,
        title=f"[Studente] {request.title}",
        description=f"Documento inviato da {student.nickname}",
        task_type=TaskType.STUDENT_SUBMISSION,
        status=TaskStatus.PUBLISHED,  # Auto-publish so teacher sees it
        content_json=request.content_json,
    )
    db.add(task)
    await db.flush()

    # Create the submission
    submission = TaskSubmission(
        task_id=task.id,
        student_id=student.id,
        content=f"{request.content_type}: {request.title}",
        content_json=request.content_json,
    )
    db.add(submission)
    await db.commit()
    await db.refresh(task)
    await db.refresh(submission)

    # Notify teacher about new student document
    await sio.emit(
        "teacher_notification",
        {
            "type": "student_document",
            "session_id": str(student.session_id),
            "student_id": str(student.id),
            "nickname": student.nickname,
            "task_id": str(task.id),
            "document_title": request.title,
            "content_type": request.content_type,
            "message": f"{student.nickname} ha inviato un {request.content_type}: \"{request.title}\"",
            "timestamp": datetime.utcnow().isoformat(),
        },
        room=f"session:{student.session_id}",
    )

    return {
        "id": str(submission.id),
        "task_id": str(task.id),
        "title": request.title,
        "submitted_at": submission.submitted_at.isoformat(),
    }
