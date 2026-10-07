"""The teacher's view of what their chatbot remembers: list, add, edit, delete, pause."""
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_teacher
from app.core.database import get_db
from app.models.teacher_memory import TeacherMemoryItem
from app.models.user import User
from app.services import teacher_memory

router = APIRouter()
Teacher = Annotated[User, Depends(get_current_teacher)]
Db = Annotated[AsyncSession, Depends(get_db)]


class ItemCreate(BaseModel):
    text: str = Field(min_length=3, max_length=400)
    kind: Literal["preference", "style", "subject", "project", "fact"] = "preference"


class ItemUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=3, max_length=400)
    pinned: bool | None = None


class Settings(BaseModel):
    enabled: bool


def _serialize(item: TeacherMemoryItem) -> dict:
    return {"id": str(item.id), "kind": item.kind, "text": item.text, "source": item.source, "pinned": item.pinned,
            "created_at": item.created_at, "updated_at": item.updated_at}


async def _own(db: AsyncSession, teacher: User, item_id: UUID) -> TeacherMemoryItem:
    item = await db.get(TeacherMemoryItem, item_id)
    if not item or item.teacher_id != teacher.id:
        raise HTTPException(status_code=404, detail="Voce non trovata")
    return item


@router.get("")
async def get_memory(teacher: Teacher, db: Db) -> dict:
    items = (await db.execute(select(TeacherMemoryItem).where(TeacherMemoryItem.teacher_id == teacher.id)
                              .order_by(desc(TeacherMemoryItem.pinned), desc(TeacherMemoryItem.updated_at)))).scalars().all()
    return {"enabled": await teacher_memory.is_enabled(db, teacher.id), "items": [_serialize(i) for i in items], "max_items": teacher_memory.MAX_ITEMS}


@router.put("/settings")
async def update_settings(payload: Settings, teacher: Teacher, db: Db) -> dict:
    await teacher_memory.set_enabled(db, teacher.id, payload.enabled)
    return {"enabled": payload.enabled}


@router.post("", status_code=201)
async def add_item(payload: ItemCreate, teacher: Teacher, db: Db) -> dict:
    text = teacher_memory.clean_text(payload.text)
    if not text:
        raise HTTPException(status_code=422, detail="Testo troppo breve oppure contiene email o numeri di telefono")
    count = (await db.execute(select(func.count(TeacherMemoryItem.id)).where(TeacherMemoryItem.teacher_id == teacher.id))).scalar_one()
    if count >= teacher_memory.MAX_ITEMS + 20:
        raise HTTPException(status_code=409, detail="Memoria piena: elimina qualche voce")
    item = TeacherMemoryItem(tenant_id=teacher.tenant_id, teacher_id=teacher.id, kind=payload.kind, text=text, source="manual", pinned=True)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _serialize(item)


@router.patch("/{item_id}")
async def update_item(item_id: UUID, payload: ItemUpdate, teacher: Teacher, db: Db) -> dict:
    item = await _own(db, teacher, item_id)
    if payload.text is not None:
        text = teacher_memory.clean_text(payload.text)
        if not text:
            raise HTTPException(status_code=422, detail="Testo troppo breve oppure contiene email o numeri di telefono")
        item.text = text
        item.source = "manual"  # edited by the teacher: the extractor must not overwrite it
    if payload.pinned is not None:
        item.pinned = payload.pinned
    await db.commit()
    return _serialize(item)


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: UUID, teacher: Teacher, db: Db) -> None:
    await db.delete(await _own(db, teacher, item_id))
    await db.commit()


@router.delete("")
async def clear_memory(teacher: Teacher, db: Db) -> dict:
    return {"deleted": await teacher_memory.clear_all(db, teacher.id)}
