"""
UDA (Unità Didattica) API endpoints
Teacher creates and manages class-level teaching units through a 5-phase agent workflow.
Students see published UDAs as folders in their tasks module.
"""

import json
import uuid as uuid_module
import logging
from typing import Annotated, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.core.database import get_db
from app.api.deps import get_current_teacher, get_current_student
from app.models.user import User
from app.models.session import Class, Session, SessionStudent
from app.models.task import Task, TaskStatus, TaskType
from app.services.uda_agent import generate_kb, generate_plan, generate_item_content, chat_iterate
from app.services.document_processor import DocumentProcessor

logger = logging.getLogger(__name__)
router = APIRouter()

document_processor = DocumentProcessor()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _get_class_for_teacher(class_id: str, teacher: User, db: AsyncSession) -> Class:
    from sqlalchemy import or_
    from app.models.invitation import ClassTeacher

    result = await db.execute(
        select(Class).where(Class.id == uuid_module.UUID(class_id), Class.tenant_id == teacher.tenant_id)
    )
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    # Check teacher owns or co-teaches the class
    if cls.teacher_id != teacher.id:
        ct_result = await db.execute(
            select(ClassTeacher).where(
                ClassTeacher.class_id == cls.id,
                ClassTeacher.teacher_id == teacher.id,
            )
        )
        if not ct_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="No access to this class")
    return cls


def _uda_to_dict(uda: Task, children: list[Task] | None = None) -> dict:
    kb = {}
    plan = {}
    try:
        content = json.loads(uda.content_json or "{}")
        kb = content.get("kb", {})
        plan = content.get("plan", {})
    except Exception:
        pass

    return {
        "id": str(uda.id),
        "title": uda.title,
        "description": uda.description,
        "status": uda.status.value,
        "uda_phase": uda.uda_phase,
        "kb": kb,
        "plan": plan,
        "created_at": uda.created_at.isoformat() if uda.created_at else None,
        "updated_at": uda.updated_at.isoformat() if uda.updated_at else None,
        "children": [_child_to_dict(c) for c in (children or [])],
    }


def _child_to_dict(t: Task) -> dict:
    content = {}
    try:
        content = json.loads(t.content_json or "{}")
    except Exception:
        pass
    return {
        "id": str(t.id),
        "title": t.title,
        "task_type": t.task_type.value,
        "status": t.status.value,
        "content": content,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Teacher endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/teacher/classes/{class_id}/udas")
async def list_udas(
    class_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """List all UDAs for a class."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(
        select(Task)
        .where(Task.class_id == cls.id, Task.task_type == TaskType.UDA, Task.parent_uda_id.is_(None))
        .order_by(Task.created_at.desc())
    )
    udas = result.scalars().all()

    # Load children for each UDA
    out = []
    for uda in udas:
        cr = await db.execute(select(Task).where(Task.parent_uda_id == uda.id).order_by(Task.created_at))
        children = cr.scalars().all()
        out.append(_uda_to_dict(uda, list(children)))
    return out


@router.post("/teacher/classes/{class_id}/udas")
async def create_uda(
    class_id: str,
    title: Annotated[str, Form()],
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new empty UDA (phase: briefing)."""
    cls = await _get_class_for_teacher(class_id, teacher, db)

    uda = Task(
        id=uuid_module.uuid4(),
        tenant_id=teacher.tenant_id,
        class_id=cls.id,
        session_id=None,
        title=title,
        task_type=TaskType.UDA,
        status=TaskStatus.DRAFT,
        uda_phase="briefing",
        content_json=json.dumps({"kb": {}, "plan": {}, "chat_history": []}),
    )
    db.add(uda)
    await db.commit()
    await db.refresh(uda)
    return _uda_to_dict(uda)


@router.post("/teacher/classes/{class_id}/udas/{uda_id}/generate-kb")
async def api_generate_kb(
    class_id: str,
    uda_id: str,
    prompt: Annotated[str, Form()],
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    files: list[UploadFile] = File(default=[]),
):
    """Phase 1: Generate / update the knowledge base from prompt + optional documents."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(select(Task).where(Task.id == uuid_module.UUID(uda_id), Task.class_id == cls.id))
    uda = result.scalar_one_or_none()
    if not uda:
        raise HTTPException(status_code=404, detail="UDA not found")

    # Extract text from uploaded documents
    doc_texts: list[str] = []
    for upload in files:
        file_bytes = await upload.read()
        mime = upload.content_type or ""
        filename = upload.filename or ""
        try:
            text, _, _ = await document_processor._extract_content(file_bytes, filename, mime, [])
            if text:
                doc_texts.append(text)
        except Exception as e:
            logger.warning(f"Could not extract text from {filename}: {e}")

    existing = {}
    try:
        existing = json.loads(uda.content_json or "{}").get("kb", {})
    except Exception:
        pass

    kb = await generate_kb(prompt, doc_texts, existing_kb=existing or None)

    content = json.loads(uda.content_json or "{}")
    content["kb"] = kb
    uda.content_json = json.dumps(content, ensure_ascii=False)
    uda.uda_phase = "kb"
    uda.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(uda)
    return {"kb": kb, "uda_phase": uda.uda_phase}


@router.post("/teacher/classes/{class_id}/udas/{uda_id}/generate-plan")
async def api_generate_plan(
    class_id: str,
    uda_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Phase 2: Generate the plan (list of items to produce)."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(select(Task).where(Task.id == uuid_module.UUID(uda_id), Task.class_id == cls.id))
    uda = result.scalar_one_or_none()
    if not uda:
        raise HTTPException(status_code=404, detail="UDA not found")

    content = json.loads(uda.content_json or "{}")
    kb = content.get("kb", {})
    if not kb:
        raise HTTPException(status_code=400, detail="KB not yet generated")

    plan = await generate_plan(kb)
    content["plan"] = plan
    uda.content_json = json.dumps(content, ensure_ascii=False)
    uda.uda_phase = "plan"
    uda.updated_at = datetime.utcnow()
    await db.commit()
    return {"plan": plan, "uda_phase": uda.uda_phase}


@router.put("/teacher/classes/{class_id}/udas/{uda_id}/kb")
async def update_kb(
    class_id: str,
    uda_id: str,
    body: dict,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Manually update the knowledge base."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(select(Task).where(Task.id == uuid_module.UUID(uda_id), Task.class_id == cls.id))
    uda = result.scalar_one_or_none()
    if not uda:
        raise HTTPException(status_code=404, detail="UDA not found")

    content = json.loads(uda.content_json or "{}")
    content["kb"] = body
    uda.content_json = json.dumps(content, ensure_ascii=False)
    uda.updated_at = datetime.utcnow()
    await db.commit()
    return {"kb": body}


@router.put("/teacher/classes/{class_id}/udas/{uda_id}/plan")
async def update_plan(
    class_id: str,
    uda_id: str,
    body: dict,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Manually update the plan (add/remove/edit items)."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(select(Task).where(Task.id == uuid_module.UUID(uda_id), Task.class_id == cls.id))
    uda = result.scalar_one_or_none()
    if not uda:
        raise HTTPException(status_code=404, detail="UDA not found")

    content = json.loads(uda.content_json or "{}")
    content["plan"] = body
    uda.content_json = json.dumps(content, ensure_ascii=False)
    uda.updated_at = datetime.utcnow()
    await db.commit()
    return {"plan": body}


@router.post("/teacher/classes/{class_id}/udas/{uda_id}/generate-content")
async def api_generate_content(
    class_id: str,
    uda_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Phase 3: Generate all content items in the plan. Returns SSE stream."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(select(Task).where(Task.id == uuid_module.UUID(uda_id), Task.class_id == cls.id))
    uda = result.scalar_one_or_none()
    if not uda:
        raise HTTPException(status_code=404, detail="UDA not found")

    content = json.loads(uda.content_json or "{}")
    kb = content.get("kb", {})
    plan = content.get("plan", {})
    items = plan.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="Plan not yet generated or empty")

    # Mark as generating
    uda.uda_phase = "generating"
    uda.updated_at = datetime.utcnow()
    await db.commit()

    async def _stream():
        for i, item in enumerate(items):
            try:
                yield f"data: {json.dumps({'event': 'item_start', 'index': i, 'title': item['title'], 'type': item['type']})}\n\n"
                raw_content = await generate_item_content(item, kb)

                # Determine task_type
                type_map = {
                    "lesson": TaskType.LESSON,
                    "quiz": TaskType.QUIZ,
                    "exercise": TaskType.EXERCISE,
                    "presentation": TaskType.PRESENTATION,
                }
                task_type = type_map.get(item.get("type", "lesson"), TaskType.LESSON)

                # Store content as JSON for structured types, HTML for lesson
                if task_type == TaskType.LESSON:
                    task_content = json.dumps({"html": raw_content})
                else:
                    # Strip code fences if present
                    stripped = raw_content.strip()
                    if stripped.startswith("```"):
                        stripped = stripped.split("```")[1]
                        if stripped.startswith("json"):
                            stripped = stripped[4:]
                    try:
                        parsed = json.loads(stripped)
                        task_content = json.dumps(parsed, ensure_ascii=False)
                    except Exception:
                        task_content = json.dumps({"raw": raw_content})

                child = Task(
                    id=uuid_module.uuid4(),
                    tenant_id=teacher.tenant_id,
                    class_id=cls.id,
                    session_id=None,
                    parent_uda_id=uda.id,
                    title=item["title"],
                    description=item.get("description", ""),
                    task_type=task_type,
                    status=TaskStatus.DRAFT,
                    content_json=task_content,
                )
                db.add(child)
                await db.commit()
                await db.refresh(child)

                yield f"data: {json.dumps({'event': 'item_done', 'index': i, 'task_id': str(child.id), 'title': child.title, 'type': child.task_type.value})}\n\n"
            except Exception as e:
                logger.error(f"Error generating item {i}: {e}")
                yield f"data: {json.dumps({'event': 'item_error', 'index': i, 'error': str(e)})}\n\n"

        # Finalize UDA phase → review
        result2 = await db.execute(select(Task).where(Task.id == uda.id))
        uda2 = result2.scalar_one_or_none()
        if uda2:
            uda2.uda_phase = "review"
            uda2.updated_at = datetime.utcnow()
            await db.commit()
        yield f"data: {json.dumps({'event': 'done', 'uda_phase': 'review'})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.post("/teacher/classes/{class_id}/udas/{uda_id}/chat")
async def uda_chat(
    class_id: str,
    uda_id: str,
    body: dict,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Iterate on the UDA via natural language. Can modify KB/plan or answer questions."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(select(Task).where(Task.id == uuid_module.UUID(uda_id), Task.class_id == cls.id))
    uda = result.scalar_one_or_none()
    if not uda:
        raise HTTPException(status_code=404, detail="UDA not found")

    user_message = body.get("message", "")
    if not user_message.strip():
        raise HTTPException(status_code=400, detail="Message required")

    content = json.loads(uda.content_json or "{}")
    uda_state = {"kb": content.get("kb", {}), "plan": content.get("plan", {}), "phase": uda.uda_phase}
    history = content.get("chat_history", [])

    reply = await chat_iterate(user_message, uda_state, history)

    # Check if model returned a structured action
    updated_kb = None
    updated_plan = None
    reply_text = reply
    if reply.strip().startswith("{"):
        try:
            action_data = json.loads(reply)
            action = action_data.get("action")
            if action == "update_kb":
                updated_kb = action_data.get("kb", {})
                content["kb"] = updated_kb
                uda.uda_phase = "kb"
                reply_text = "Ho aggiornato la knowledge base come richiesto."
            elif action == "update_plan":
                updated_plan = action_data.get("plan", {})
                content["plan"] = updated_plan
                uda.uda_phase = "plan"
                reply_text = "Ho aggiornato il piano come richiesto."
        except Exception:
            pass

    # Persist chat history (keep last 20 turns)
    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": reply_text})
    content["chat_history"] = history[-40:]

    uda.content_json = json.dumps(content, ensure_ascii=False)
    uda.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "reply": reply_text,
        "updated_kb": updated_kb,
        "updated_plan": updated_plan,
        "uda_phase": uda.uda_phase,
    }


@router.patch("/teacher/classes/{class_id}/udas/{uda_id}/children/{child_id}")
async def update_child(
    class_id: str,
    uda_id: str,
    child_id: str,
    body: dict,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a single child task (title, content, etc.) before publishing."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(
        select(Task).where(
            Task.id == uuid_module.UUID(child_id),
            Task.parent_uda_id == uuid_module.UUID(uda_id),
            Task.class_id == cls.id,
        )
    )
    child = result.scalar_one_or_none()
    if not child:
        raise HTTPException(status_code=404, detail="Child task not found")

    if "title" in body:
        child.title = body["title"]
    if "content" in body:
        child.content_json = json.dumps(body["content"], ensure_ascii=False) if isinstance(body["content"], dict) else body["content"]

    child.updated_at = datetime.utcnow()
    await db.commit()
    return _child_to_dict(child)


@router.delete("/teacher/classes/{class_id}/udas/{uda_id}/children/{child_id}")
async def delete_child(
    class_id: str,
    uda_id: str,
    child_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Remove a child task from the UDA before publishing."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(
        select(Task).where(
            Task.id == uuid_module.UUID(child_id),
            Task.parent_uda_id == uuid_module.UUID(uda_id),
            Task.class_id == cls.id,
        )
    )
    child = result.scalar_one_or_none()
    if not child:
        raise HTTPException(status_code=404, detail="Child task not found")
    await db.delete(child)
    await db.commit()
    return {"message": "Deleted"}


@router.post("/teacher/classes/{class_id}/udas/{uda_id}/publish")
async def publish_uda(
    class_id: str,
    uda_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Publish the UDA: propagate to all sessions of the class."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(select(Task).where(Task.id == uuid_module.UUID(uda_id), Task.class_id == cls.id))
    uda = result.scalar_one_or_none()
    if not uda:
        raise HTTPException(status_code=404, detail="UDA not found")

    # Fetch children
    cr = await db.execute(select(Task).where(Task.parent_uda_id == uda.id))
    children = cr.scalars().all()

    # Fetch all sessions of the class
    sr = await db.execute(select(Session).where(Session.class_id == cls.id))
    sessions = sr.scalars().all()

    # Publish the UDA container task itself
    uda.status = TaskStatus.PUBLISHED
    uda.uda_phase = "published"
    uda.updated_at = datetime.utcnow()

    # Publish all children
    for child in children:
        child.status = TaskStatus.PUBLISHED

    await db.commit()

    return {
        "message": f"UDA pubblicata su {len(sessions)} sessioni",
        "session_count": len(sessions),
        "item_count": len(children),
    }


@router.delete("/teacher/classes/{class_id}/udas/{uda_id}")
async def delete_uda(
    class_id: str,
    uda_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a UDA (cascade deletes children)."""
    cls = await _get_class_for_teacher(class_id, teacher, db)
    result = await db.execute(select(Task).where(Task.id == uuid_module.UUID(uda_id), Task.class_id == cls.id))
    uda = result.scalar_one_or_none()
    if not uda:
        raise HTTPException(status_code=404, detail="UDA not found")
    await db.delete(uda)
    await db.commit()
    return {"message": "UDA eliminata"}


# ─────────────────────────────────────────────────────────────────────────────
# Student endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/student/udas")
async def student_get_udas(
    student: Annotated[SessionStudent, Depends(get_current_student)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all published UDAs for the student's class."""
    # Find class_id from student's session
    sr = await db.execute(select(Session).where(Session.id == student.session_id))
    session = sr.scalar_one_or_none()
    if not session:
        return []

    result = await db.execute(
        select(Task).where(
            Task.class_id == session.class_id,
            Task.task_type == TaskType.UDA,
            Task.status == TaskStatus.PUBLISHED,
            Task.parent_uda_id.is_(None),
        ).order_by(Task.created_at.desc())
    )
    udas = result.scalars().all()

    out = []
    for uda in udas:
        cr = await db.execute(
            select(Task).where(
                Task.parent_uda_id == uda.id,
                Task.status == TaskStatus.PUBLISHED,
            ).order_by(Task.created_at)
        )
        children = cr.scalars().all()
        out.append(_uda_to_dict(uda, list(children)))
    return out
