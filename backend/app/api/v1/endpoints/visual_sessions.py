import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from app.api.deps import get_current_admin
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.visual_comprehension import VisualComprehensionSession
from app.services import visual_sessions as sessions
from app.services.storage_service import storage_service
from app.services.visual_dialogue import MAX_NOTES, StudentNote
from app.services.visual_selection import Selection

router = APIRouter()
Admin = Annotated[User, Depends(get_current_admin)]


class CreateSession(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    image: str = Field(min_length=30, max_length=11_200_000)
    image_name: str = Field(min_length=1, max_length=250)
    title: str = Field(default="Nuova sessione visuale", min_length=1, max_length=200)


class UpdateSession(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    draft: str | None = Field(default=None, max_length=4000)
    revision: int | None = Field(default=None, ge=0)
    notes: list[StudentNote] | None = Field(default=None, max_length=MAX_NOTES)

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value):
        return value.strip() if isinstance(value, str) else value


class SendMessage(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    request_id: uuid.UUID
    revision: int = Field(ge=0)
    content: str = Field(min_length=1, max_length=4000)
    selection: Selection | None = None
    notes: list[StudentNote] | None = Field(default=None, max_length=MAX_NOTES)


class ReviewDrawing(BaseModel):
    image: str = Field(min_length=30, max_length=11_200_000, description="PNG del disegno renderizzato dal browser")
    issues: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("issues")
    @classmethod
    def short_issues(cls, value):
        return [item[:200] for item in value]


@router.get("")
async def list_sessions(admin: Admin, query: str = Query(default="", max_length=200), limit: int = Query(default=60, ge=1, le=100)):
    async with AsyncSessionLocal() as db:
        statement = select(VisualComprehensionSession).where(VisualComprehensionSession.owner_id == admin.id)
        if query.strip():
            statement = statement.where(VisualComprehensionSession.title.ilike(f"%{query.strip()}%"))
        rows = (await db.execute(statement.order_by(VisualComprehensionSession.updated_at.desc()).limit(limit))).scalars().all()
        return [sessions.serialize(row, full=False) for row in rows]


@router.post("", status_code=201)
async def create_session(body: CreateSession, admin: Admin):
    return await sessions.create_session(admin, body.image, body.image_name, body.title)


@router.get("/{session_id}")
async def get_session(session_id: uuid.UUID, admin: Admin):
    async with AsyncSessionLocal() as db:
        s = await sessions.owned(db, session_id, admin.id, lock=True)
        if sessions.recover_stale(s):
            await db.commit()
            await db.refresh(s)
        return sessions.serialize(s)


@router.get("/{session_id}/image")
async def get_image(session_id: uuid.UUID, admin: Admin):
    async with AsyncSessionLocal() as db:
        s = await sessions.owned(db, session_id, admin.id)
        key = s.image_key
    try:
        data = await asyncio.to_thread(storage_service.download_file, key)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Immagine non disponibile") from exc
    return Response(data, media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.patch("/{session_id}")
async def update_session(session_id: uuid.UUID, body: UpdateSession, admin: Admin):
    async with AsyncSessionLocal() as db:
        s = await sessions.owned(db, session_id, admin.id, lock=True)
        if body.draft is not None and (body.revision is None or body.revision != s.revision):
            raise HTTPException(status_code=409, detail="Bozza superata da un nuovo messaggio")
        if body.title is not None:
            s.title = body.title
        if body.draft is not None:
            s.draft = body.draft
        if body.notes is not None:
            s.dialogue = sessions.with_notes(s.dialogue, body.notes)
        await db.commit()
        await db.refresh(s)
        return sessions.serialize(s)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: uuid.UUID, admin: Admin):
    async with AsyncSessionLocal() as db:
        s = await sessions.owned(db, session_id, admin.id, lock=True)
        sessions.recover_stale(s)
        if s.active_request_id:
            raise HTTPException(status_code=409, detail="Attendi la risposta del tutor prima di eliminare questa sessione.")
        key = s.image_key
        # Keep the row if the private source could not be removed; deletion can be retried.
        await asyncio.to_thread(storage_service.delete_file, key)
        await db.delete(s)
        await db.commit()
    return Response(status_code=204)


@router.post("/{session_id}/messages")
async def send_message(session_id: uuid.UUID, body: SendMessage, admin: Admin):
    return await sessions.send_message(admin, session_id, body.request_id, body.revision, body.content, body.selection, body.notes)


@router.post("/{session_id}/messages/{message_id}/review")
async def review_message(session_id: uuid.UUID, message_id: uuid.UUID, body: ReviewDrawing, admin: Admin):
    return await sessions.review_message(admin, session_id, message_id, body.image, body.issues)


@router.post("/{session_id}/messages/{message_id}/redraw")
async def redraw_message(session_id: uuid.UUID, message_id: uuid.UUID, admin: Admin):
    return await sessions.redraw_message(admin, session_id, message_id)
