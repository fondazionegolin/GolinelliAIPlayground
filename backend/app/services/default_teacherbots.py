"""Admin-created starter teacherbots explicitly shared with each platform audience."""
from uuid import UUID

from sqlalchemy import select
from app.models.platform_setting import PlatformSetting
from app.models.teacherbot import Teacherbot, TeacherbotStatus
from app.models.user import User
from app.models.enums import UserRole

SETTING_KEY = "default_teacherbots"


async def settings(db) -> dict[str, list[str]]:
    row = await db.scalar(select(PlatformSetting).where(PlatformSetting.key == SETTING_KEY))
    value = row.value if row and isinstance(row.value, dict) else {}
    return {audience: list(dict.fromkeys(value.get(audience, []))) for audience in ("student", "teacher")}


async def list_bots(db, audience: str) -> list[Teacherbot]:
    ids = (await settings(db)).get(audience, [])
    valid = []
    for value in ids:
        try:
            valid.append(UUID(value))
        except (ValueError, TypeError):
            continue
    if not valid:
        return []
    bots = (await db.execute(select(Teacherbot).join(User, User.id == Teacherbot.teacher_id).where(
        Teacherbot.id.in_(valid), Teacherbot.status != TeacherbotStatus.ARCHIVED,
        User.role == UserRole.ADMIN, User.is_active.is_(True),
    ))).scalars().all()
    by_id = {str(bot.id): bot for bot in bots}
    return [by_id[value] for value in ids if value in by_id]


async def is_default(db, bot_id: UUID, audience: str) -> bool:
    return any(bot.id == bot_id for bot in await list_bots(db, audience))


def public_info(bot) -> dict:
    return {"id": str(bot.id), "name": bot.name, "synopsis": bot.synopsis, "description": bot.description,
            "icon": bot.icon, "color": bot.color, "is_proactive": bot.is_proactive,
            "proactive_message": bot.proactive_message if bot.is_proactive else None,
            "enable_live_voice": bot.enable_live_voice, "enable_inquiry": bot.enable_inquiry,
            "enable_escape_room": bot.enable_escape_room}
