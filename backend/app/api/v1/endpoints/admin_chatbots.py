"""Admin «Chatbot»: choose the built-in chatbots students see in Spazio AI."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.user import User
from app.services import student_chatbots
from app.services.chatbot_profiles import CHATBOT_PROFILES
from app.services import default_teacherbots
from app.models.platform_setting import PlatformSetting
from app.models.teacherbot import Teacherbot, TeacherbotStatus

router = APIRouter()
Admin = Annotated[User, Depends(get_current_admin)]
Db = Annotated[AsyncSession, Depends(get_db)]


class EnabledUpdate(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=50)


class DefaultTeacherbotsUpdate(BaseModel):
    student: list[UUID] = Field(default_factory=list, max_length=30)
    teacher: list[UUID] = Field(default_factory=list, max_length=30)


@router.get("/teacherbot-defaults")
async def get_teacherbot_defaults(admin: Admin, db: Db):
    candidates = (await db.execute(select(Teacherbot).where(
        Teacherbot.teacher_id == admin.id, Teacherbot.creator_student_id.is_(None),
        Teacherbot.status != TeacherbotStatus.ARCHIVED,
    ).order_by(Teacherbot.name))).scalars().all()
    return {"candidates": [default_teacherbots.public_info(bot) for bot in candidates],
            "student": [default_teacherbots.public_info(bot) for bot in await default_teacherbots.list_bots(db, "student")],
            "teacher": [default_teacherbots.public_info(bot) for bot in await default_teacherbots.list_bots(db, "teacher")]}


@router.put("/teacherbot-defaults")
async def set_teacherbot_defaults(body: DefaultTeacherbotsUpdate, admin: Admin, db: Db):
    previous = await default_teacherbots.settings(db)
    existing = set(previous["student"] + previous["teacher"])
    ids = list(dict.fromkeys(body.student + body.teacher))
    own = set((await db.execute(select(Teacherbot.id).where(
        Teacherbot.id.in_(ids), Teacherbot.teacher_id == admin.id,
        Teacherbot.status != TeacherbotStatus.ARCHIVED,
    ))).scalars().all()) if ids else set()
    if any(bot_id not in own and str(bot_id) not in existing for bot_id in ids):
        raise HTTPException(422, "Scegli tra i teacherbot creati dal tuo account amministratore")
    value = {audience: list(dict.fromkeys(str(v) for v in getattr(body, audience))) for audience in ("student", "teacher")}
    row = await db.get(PlatformSetting, default_teacherbots.SETTING_KEY)
    if row:
        row.value = value
    else:
        db.add(PlatformSetting(key=default_teacherbots.SETTING_KEY, value=value))
    await db.commit()
    return await get_teacherbot_defaults(admin, db)


async def _payload(db: AsyncSession) -> dict:
    enabled = set(await student_chatbots.get_enabled_keys(db))
    return {
        "profiles": [
            {
                "key": key,
                "name": CHATBOT_PROFILES[key]["name"],
                "description": CHATBOT_PROFILES[key]["description"],
                "enabled": key in enabled,
            }
            for key in student_chatbots.selectable_keys()
        ]
    }


@router.get("")
async def get_student_chatbots(_: Admin, db: Db):
    return await _payload(db)


@router.put("")
async def set_student_chatbots(body: EnabledUpdate, _: Admin, db: Db):
    allowed = set(student_chatbots.selectable_keys())
    unknown = [k for k in body.keys if k not in allowed]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Chatbot sconosciuti: {', '.join(unknown)}")
    await student_chatbots.set_enabled_keys(db, list(dict.fromkeys(body.keys)))
    return await _payload(db)
