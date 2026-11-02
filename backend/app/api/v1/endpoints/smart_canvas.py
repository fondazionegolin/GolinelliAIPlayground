"""Smart canvases: Figma-like boards with an AI that reads and draws on them.

A board is private to its teacher, or shared with a session. A shared board's content lives in `session_canvas`
(under `canvas_key`), so it reuses the real-time layer: sync, cursors, item locks and the single students-can-write
flag. Students of the session may also own boards. The assistant is for the teacher always, and for students only
while the teacher allows them to edit that board.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.api.v1.endpoints.llm import safe_track_usage
from app.core.database import AsyncSessionLocal, get_db
from app.core.permissions import teacher_can_access_session
from app.models.invitation import ClassTeacher, SessionTeacher
from app.models.session import Class, Session, SessionModule, SessionStudent
from app.models.session_canvas import SessionCanvas
from app.models.smart_canvas import SmartCanvas
from app.models.user import User
from app.realtime.gateway import sio
from app.services import motion
from app.services import smart_canvas as ai
from app.services.credit_service import credit_service
from app.services.visual_comprehension import normalize_image

logger = logging.getLogger(__name__)
router = APIRouter()
MODULE_KEY = "smart_canvas"
MAX_CONTENT = 12_000_000
EMPTY = '{"type":"canvas_v1","items":[]}'


async def canvas_actor(actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> StudentOrTeacher:
    """Any teacher; students only while their session enables the module."""
    if actor.is_student:
        enabled = await db.scalar(select(SessionModule.is_enabled).where(
            SessionModule.session_id == actor.student.session_id, SessionModule.module_key == MODULE_KEY))
        if not enabled:
            raise HTTPException(status_code=403, detail="Le lavagne intelligenti non sono attive in questa sessione")
    return actor


Actor = Annotated[StudentOrTeacher, Depends(canvas_actor)]
Db = Annotated[AsyncSession, Depends(get_db)]


def tenant_id(actor: StudentOrTeacher):
    return actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id


def credit_scope(actor: StudentOrTeacher) -> dict:
    if actor.is_student:
        return {"session_id": actor.student.session_id, "student_id": actor.student.id}
    return {"teacher_id": actor.teacher.id}


def actor_name(actor: StudentOrTeacher) -> str:
    if actor.is_student:
        return actor.student.nickname
    return (f"{actor.teacher.first_name or ''} {actor.teacher.last_name or ''}".strip()) or "Docente"


# ─── Access ────────────────────────────────────────────────────────────────────

async def teacher_sessions(db: AsyncSession, teacher: User):
    """Sessions the teacher can reach (own classes, invited classes, direct invites), newest first."""
    class_ids = select(Class.id).where(Class.teacher_id == teacher.id)
    invited = select(ClassTeacher.class_id).where(ClassTeacher.teacher_id == teacher.id)
    direct = select(SessionTeacher.session_id).where(SessionTeacher.teacher_id == teacher.id)
    rows = (await db.execute(
        select(Session, Class.name).join(Class, Class.id == Session.class_id)
        .where(Session.deleted_at.is_(None), or_(Session.class_id.in_(class_ids), Session.class_id.in_(invited), Session.id.in_(direct)))
        .order_by(Session.created_at.desc()).limit(200))).all()
    return rows


async def can_read(db: AsyncSession, row: SmartCanvas, actor: StudentOrTeacher) -> bool:
    if actor.is_student:
        s = actor.student
        return row.session_id == s.session_id and (row.owner_student_id == s.id or row.owner_id is not None)
    if row.owner_id == actor.teacher.id:
        return True
    return bool(row.session_id) and await teacher_can_access_session(db, actor.teacher, row.session_id)


def is_owner(row: SmartCanvas, actor: StudentOrTeacher) -> bool:
    return row.owner_student_id == actor.student.id if actor.is_student else row.owner_id == actor.teacher.id


async def load(db: AsyncSession, canvas_id: uuid.UUID, actor: StudentOrTeacher, lock: bool = False) -> SmartCanvas:
    query = select(SmartCanvas).where(SmartCanvas.id == canvas_id)
    row = (await db.execute(query.with_for_update() if lock else query)).scalar_one_or_none()
    if not row or not await can_read(db, row, actor):
        raise HTTPException(status_code=404, detail="Lavagna non trovata")
    return row


async def session_canvas(db: AsyncSession, row: SmartCanvas) -> SessionCanvas | None:
    if not row.session_id or not row.canvas_key:
        return None
    return (await db.execute(select(SessionCanvas).where(
        SessionCanvas.session_id == row.session_id, SessionCanvas.canvas_key == row.canvas_key))).scalar_one_or_none()


async def broadcast(canvas: SessionCanvas, by: dict):
    await sio.emit("canvas_updated", {
        "session_id": str(canvas.session_id), "canvas_key": canvas.canvas_key, "title": canvas.title,
        "content_json": canvas.content_json, "version": canvas.version,
        "updated_at": canvas.updated_at.isoformat() if canvas.updated_at else None,
        "updated_by": by, "students_can_write": canvas.students_can_write,
    }, room=f"session:{canvas.session_id}")


async def owner_names(db: AsyncSession, rows: list[SmartCanvas]) -> dict:
    users = {r.owner_id for r in rows if r.owner_id}
    students = {r.owner_student_id for r in rows if r.owner_student_id}
    names: dict = {}
    if users:
        for u in (await db.execute(select(User).where(User.id.in_(users)))).scalars():
            names[("t", u.id)] = (f"{u.first_name or ''} {u.last_name or ''}".strip()) or "Docente"
    if students:
        for s in (await db.execute(select(SessionStudent).where(SessionStudent.id.in_(students)))).scalars():
            names[("s", s.id)] = s.nickname
    return names


async def serialize_many(db: AsyncSession, rows: list[SmartCanvas], actor: StudentOrTeacher, full: bool = False) -> list[dict]:
    names = await owner_names(db, rows)
    session_ids = {r.session_id for r in rows if r.session_id}
    titles = {}
    if session_ids:
        titles = {sid: title for sid, title in (await db.execute(select(Session.id, Session.title).where(Session.id.in_(session_ids)))).all()}
    shared = {}
    if session_ids:
        for c in (await db.execute(select(SessionCanvas).where(SessionCanvas.session_id.in_(session_ids)))).scalars():
            shared[(c.session_id, c.canvas_key)] = c
    out = []
    for r in rows:
        live = shared.get((r.session_id, r.canvas_key)) if r.session_id else None
        can_write = bool(live.students_can_write) if live else False
        item = {
            "id": str(r.id), "title": r.title, "updated_at": (live.updated_at if live and live.updated_at and live.updated_at > r.updated_at else r.updated_at).isoformat(),
            "preview": r.preview, "message_count": len(r.messages or []), "session_id": str(r.session_id) if r.session_id else None,
            "session_title": titles.get(r.session_id), "canvas_key": r.canvas_key, "students_can_write": can_write,
            "mine": is_owner(r, actor), "owner_type": "student" if r.owner_student_id else "teacher",
            "owner_name": names.get(("s", r.owner_student_id)) if r.owner_student_id else names.get(("t", r.owner_id)),
            "can_chat": (not actor.is_student) or (r.session_id == actor.student.session_id and can_write),
        }
        if full:
            item.update(content_json=r.content_json if not r.session_id else (live.content_json if live else EMPTY), messages=r.messages or [])
        out.append(item)
    return out


# ─── Boards ────────────────────────────────────────────────────────────────────

class CreateCanvas(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(default="Nuova lavagna intelligente", min_length=1, max_length=200)
    session_id: uuid.UUID | None = None
    students_can_write: bool = False


class UpdateCanvas(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content_json: str | None = Field(default=None, max_length=MAX_CONTENT)


class ShareCanvas(BaseModel):
    session_id: uuid.UUID | None = None
    students_can_write: bool | None = None


class ChatBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    request_id: uuid.UUID
    content: str = Field(min_length=1, max_length=4000)
    overview: str = Field(min_length=30, max_length=11_200_000, description="PNG della lavagna intera renderizzata dal browser")
    images: list[str] = Field(default_factory=list, max_length=3)
    images_meta: list[ai.ImageMeta] = Field(default_factory=list, max_length=3)
    items: list[ai.SceneItem] = Field(default_factory=list, max_length=400)
    changes: list[str] = Field(default_factory=list, max_length=40)
    selected: list[str] = Field(default_factory=list, max_length=60)
    near: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("changes")
    @classmethod
    def short_changes(cls, value):
        return [item[:240] for item in value]


@router.get("/sessions")
async def sessions_for_sharing(actor: Actor, db: Db):
    """Where a teacher can share a board."""
    if actor.is_student:
        raise HTTPException(status_code=403, detail="Solo per i docenti")
    return [{"id": str(s.id), "title": s.title, "class_name": class_name, "status": s.status.value if s.status else None}
            for s, class_name in await teacher_sessions(db, actor.teacher)]


@router.get("")
async def list_canvases(actor: Actor, db: Db, query: str = Query(default="", max_length=200), limit: int = Query(default=100, ge=1, le=200)):
    if actor.is_student:
        s = actor.student
        cond = (SmartCanvas.session_id == s.session_id) & ((SmartCanvas.owner_student_id == s.id) | SmartCanvas.owner_id.is_not(None))
    else:
        ids = [sess.id for sess, _ in await teacher_sessions(db, actor.teacher)]
        cond = (SmartCanvas.owner_id == actor.teacher.id) | (SmartCanvas.session_id.in_(ids) if ids else False)
    statement = select(SmartCanvas).where(cond)
    if query.strip():
        statement = statement.where(SmartCanvas.title.ilike(f"%{query.strip()}%"))
    rows = (await db.execute(statement.order_by(SmartCanvas.updated_at.desc()).limit(limit))).scalars().all()
    return await serialize_many(db, list(rows), actor)


@router.post("", status_code=201)
async def create_canvas(body: CreateCanvas, actor: Actor, db: Db):
    row = SmartCanvas(id=uuid.uuid4(), title=body.title, content_json=EMPTY, messages=[], version=1)
    if actor.is_student:
        row.owner_student_id, row.session_id = actor.student.id, actor.student.session_id
        flag = True  # a student edits their own board
    else:
        row.owner_id = actor.teacher.id
        if body.session_id and not await teacher_can_access_session(db, actor.teacher, body.session_id):
            raise HTTPException(status_code=404, detail="Sessione non trovata")
        row.session_id = body.session_id
        flag = body.students_can_write
    if row.session_id:
        row.canvas_key = f"smart:{row.id}"
        db.add(SessionCanvas(tenant_id=tenant_id(actor), session_id=row.session_id, canvas_key=row.canvas_key, title=row.title,
                             content_json=EMPTY, version=1, students_can_write=flag,
                             updated_by_teacher_id=None if actor.is_student else actor.teacher.id,
                             updated_by_student_id=actor.student.id if actor.is_student else None))
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return (await serialize_many(db, [row], actor, full=True))[0]


@router.get("/{canvas_id}")
async def get_canvas(canvas_id: uuid.UUID, actor: Actor, db: Db):
    row = await load(db, canvas_id, actor)
    return (await serialize_many(db, [row], actor, full=True))[0]


@router.patch("/{canvas_id}")
async def update_canvas(canvas_id: uuid.UUID, body: UpdateCanvas, actor: Actor, db: Db):
    row = await load(db, canvas_id, actor, lock=True)
    if not is_owner(row, actor):
        raise HTTPException(status_code=403, detail="Solo chi ha creato la lavagna può modificarla qui")
    if body.title is not None:
        row.title = body.title
        live = await session_canvas(db, row)
        if live:
            live.title = body.title
    if body.content_json is not None:
        if row.session_id:
            raise HTTPException(status_code=409, detail="Il contenuto di una lavagna condivisa si salva in tempo reale")
        row.content_json = body.content_json
        row.version += 1
    await db.commit()
    await db.refresh(row)
    return {"id": str(row.id), "title": row.title, "version": row.version, "updated_at": row.updated_at.isoformat()}


class PreviewBody(BaseModel):
    image: str = Field(min_length=40, max_length=260_000)


@router.post("/{canvas_id}/preview", status_code=204)
async def set_preview(canvas_id: uuid.UUID, body: PreviewBody, actor: Actor, db: Db):
    """The thumbnail on the landing page: a small JPEG the browser draws from the board (cosmetic, any reader may refresh it)."""
    if not body.image.startswith("data:image/jpeg;base64,"):
        raise HTTPException(status_code=422, detail="Anteprima non valida")
    row = await load(db, canvas_id, actor, lock=True)
    row.preview = body.image
    await db.commit()


@router.post("/{canvas_id}/share")
async def share_canvas(canvas_id: uuid.UUID, body: ShareCanvas, actor: Actor, db: Db):
    """Teacher: share with a session (or stop sharing) and set the one edit flag for students."""
    if actor.is_student:
        raise HTTPException(status_code=403, detail="Solo il docente può condividere")
    row = await load(db, canvas_id, actor, lock=True)
    if row.owner_id != actor.teacher.id:
        raise HTTPException(status_code=403, detail="Solo chi ha creato la lavagna può condividerla")
    live = await session_canvas(db, row)
    fields = body.model_fields_set
    if "session_id" in fields and body.session_id != row.session_id:
        content = live.content_json if live else row.content_json
        flag = live.students_can_write if live else False
        if live:
            await db.delete(live)
        if body.session_id:
            if not await teacher_can_access_session(db, actor.teacher, body.session_id):
                raise HTTPException(status_code=404, detail="Sessione non trovata")
            row.session_id, row.canvas_key = body.session_id, f"smart:{row.id}"
            live = SessionCanvas(tenant_id=tenant_id(actor), session_id=row.session_id, canvas_key=row.canvas_key, title=row.title,
                                 content_json=content, version=1, students_can_write=flag, updated_by_teacher_id=actor.teacher.id)
            db.add(live)
        else:
            row.content_json, row.session_id, row.canvas_key, live = content, None, None, None
    if body.students_can_write is not None and live:
        live.students_can_write = body.students_can_write
        live.version = (live.version or 0) + 1
    await db.commit()
    await db.refresh(row)
    if live:
        await db.refresh(live)
        await broadcast(live, {"type": "teacher", "id": str(actor.teacher.id)})
    return (await serialize_many(db, [row], actor, full=False))[0]


@router.delete("/{canvas_id}", status_code=204)
async def delete_canvas(canvas_id: uuid.UUID, actor: Actor, db: Db):
    row = await load(db, canvas_id, actor, lock=True)
    if not is_owner(row, actor):
        raise HTTPException(status_code=403, detail="Solo chi ha creato la lavagna può eliminarla")
    live = await session_canvas(db, row)
    if live:
        await db.delete(live)
    await db.delete(row)
    await db.commit()


# ─── Assistant ─────────────────────────────────────────────────────────────────

async def tracker(actor: StudentOrTeacher):
    scope = credit_scope(actor)
    async with AsyncSessionLocal() as db:
        if not await credit_service.check_availability(db, tenant_id(actor), estimated_cost=0.05, **scope):
            raise HTTPException(status_code=402, detail="Crediti AI esauriti.")

    async def track(response, stage):
        cost = credit_service.calculate_cost_for_model(response.provider, response.model, response.prompt_tokens, response.completion_tokens)
        async with AsyncSessionLocal() as db:
            await safe_track_usage(db, tenant_id(actor), response.provider, response.model, cost,
                                   {"type": "smart_canvas", "stage": stage, "prompt_tokens": response.prompt_tokens,
                                    "completion_tokens": response.completion_tokens}, **scope)
    return track


class RefineBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    content: str = Field(min_length=1, max_length=4000)
    answer: str = Field(default="", max_length=6000)
    crop: str = Field(min_length=30, max_length=11_200_000, description="Ritaglio ingrandito dell'immagine, con griglia")
    boxes: list[ai.RefineInput] = Field(min_length=1, max_length=30)


@router.post("/{canvas_id}/refine")
async def refine_annotations(canvas_id: uuid.UUID, body: RefineBody, actor: Actor, db: Db):
    """Second look at highlights on small targets: a zoomed crop lets the model tighten each box."""
    row = await load(db, canvas_id, actor)
    live = await session_canvas(db, row)
    if actor.is_student and not (live and live.students_can_write):
        raise HTTPException(status_code=403, detail="L'assistente è disponibile agli studenti solo quando il docente abilita la modifica")
    try:
        crop = await asyncio.to_thread(normalize_image, body.crop)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    track = await tracker(actor)
    try:
        boxes = await ai.refine(crop, body.content, body.answer, body.boxes, track)
    except Exception:
        logger.exception("Smart canvas refine failed")
        return {"boxes": []}  # the first placement is still a valid answer
    return {"boxes": [b.model_dump() for b in boxes]}


class AnimateBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    brief: str = Field(min_length=3, max_length=3000, description="Cosa deve mostrare l'animazione, fase per fase")
    content: str = Field(default="", max_length=4000, description="La richiesta originale dell'utente")
    width: int = Field(default=800, ge=400, le=1600)
    height: int = Field(default=450, ge=225, le=900)
    previous: dict | None = None


@router.post("/{canvas_id}/animate")
async def animate(canvas_id: uuid.UUID, body: AnimateBody, actor: Actor, db: Db):
    """Direct a scientific animation (a declarative scene the browser plays) from a plain-language brief."""
    row = await load(db, canvas_id, actor)
    live = await session_canvas(db, row)
    if actor.is_student and not (live and live.students_can_write):
        raise HTTPException(status_code=403, detail="L'assistente è disponibile agli studenti solo quando il docente abilita la modifica")
    track = await tracker(actor)
    try:
        async with asyncio.timeout(175):
            scene = await motion.generate_scene(body.brief, body.content or body.brief, body.width, body.height, body.previous, track)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Motion scene failed")
        raise HTTPException(status_code=504 if isinstance(exc, TimeoutError) else 502,
                            detail=str(exc) if isinstance(exc, ValueError) else "Non sono riuscito a creare l'animazione. Riprova.") from exc
    return {"scene": scene.model_dump(exclude_none=True)}


@router.post("/{canvas_id}/chat")
async def chat(canvas_id: uuid.UUID, body: ChatBody, actor: Actor, db: Db):
    """One AI turn: the browser sends what it sees; the reply carries drawing ops the browser applies to the board."""
    row = await load(db, canvas_id, actor)
    live = await session_canvas(db, row)
    if actor.is_student and not (live and live.students_can_write):
        raise HTTPException(status_code=403, detail="L'assistente è disponibile agli studenti solo quando il docente abilita la modifica")
    history = list(row.messages or [])
    author = actor_name(actor)
    replay = next((m for m in history if m.get("request_id") == str(body.request_id) and m.get("role") == "assistant"), None)
    if replay:  # a lost response retried: same answer, no second charge
        return {"message": replay, "duplicate": True}
    try:
        overview = await asyncio.to_thread(normalize_image, body.overview)
        extras = [await asyncio.to_thread(normalize_image, image) for image in body.images]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    track = await tracker(actor)
    try:
        async with asyncio.timeout(170):
            who = f"[{author}] {body.content}" if row.session_id else body.content  # on a shared board the model must tell people apart
            reply = await ai.converse(overview, extras, body.items, body.changes, body.selected, history, who, track, near=body.near, images_meta=body.images_meta[:len(extras)])
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Smart canvas turn failed")
        raise HTTPException(status_code=504 if isinstance(exc, TimeoutError) else 502,
                            detail="L'assistente non ha completato la risposta. Riprova.") from exc
    now = datetime.now(timezone.utc).isoformat()
    user_message = {"id": str(uuid.uuid4()), "request_id": str(body.request_id), "role": "user", "content": body.content,
                    "author": author, "created_at": now}
    assistant = {"id": str(uuid.uuid4()), "request_id": str(body.request_id), "role": "assistant", "content": reply.message,
                 "ops": [op.model_dump(exclude_none=True) for op in reply.ops], "focus": reply.focus, "created_at": now}
    async with AsyncSessionLocal() as db2:
        stored = (await db2.execute(select(SmartCanvas).where(SmartCanvas.id == canvas_id).with_for_update())).scalar_one()
        stored.messages = [*(stored.messages or []), user_message, assistant][-200:]
        await db2.commit()
    return {"message": assistant, "user_message": user_message}
