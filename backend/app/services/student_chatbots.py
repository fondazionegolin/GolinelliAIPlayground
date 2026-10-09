"""Which built-in chatbot profiles students see in Spazio AI (admin-managed)."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform_setting import PlatformSetting
from app.services.chatbot_profiles import CHATBOT_PROFILES

SETTING_KEY = "student_default_chatbots"
# One generalist assistant by default; everything else lives in Teacherbot.
DEFAULT_KEYS = ["tutor"]


def selectable_keys() -> list[str]:
    return [k for k, p in CHATBOT_PROFILES.items() if not p.get("teacher_only", False)]


async def get_enabled_keys(db: AsyncSession) -> list[str]:
    row = (await db.execute(select(PlatformSetting).where(PlatformSetting.key == SETTING_KEY))).scalar_one_or_none()
    stored = row.value if row and isinstance(row.value, list) else DEFAULT_KEYS
    allowed = set(selectable_keys())
    keys = [k for k in stored if k in allowed]
    return keys or DEFAULT_KEYS


async def set_enabled_keys(db: AsyncSession, keys: list[str]) -> None:
    row = (await db.execute(select(PlatformSetting).where(PlatformSetting.key == SETTING_KEY))).scalar_one_or_none()
    if row:
        row.value = keys
    else:
        db.add(PlatformSetting(key=SETTING_KEY, value=keys))
    await db.commit()
