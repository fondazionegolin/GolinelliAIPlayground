"""Admin «Chatbot»: choose the built-in chatbots students see in Spazio AI."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.user import User
from app.services import student_chatbots
from app.services.chatbot_profiles import CHATBOT_PROFILES

router = APIRouter()
Admin = Annotated[User, Depends(get_current_admin)]
Db = Annotated[AsyncSession, Depends(get_db)]


class EnabledUpdate(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=50)


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
