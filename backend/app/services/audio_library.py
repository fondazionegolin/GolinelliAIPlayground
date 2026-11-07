"""Shared identity and naming for saved Audio Lab tracks."""
from uuid import UUID

from sqlalchemy import select
from app.models.drive import DriveItem
from app.models.file import File


def artist_name(user) -> str:
    name = " ".join(str(getattr(user, field, None) or "").strip() for field in ("first_name", "last_name")).strip()
    return name or str(getattr(user, "email", None) or "").split("@")[0] or "Artista"


async def rename_track(db, item, title: str) -> None:
    item.title = title
    drive_id = (item.details or {}).get("drive_item_id")
    if not drive_id:
        return
    original = await db.get(DriveItem, UUID(drive_id))
    if not original or original.owner_teacher_id != item.owner_id or original.tenant_id != item.tenant_id:
        return
    stored = await db.get(File, original.file_id) if original.file_id else None
    extension = (item.storage_key or "audio.mp3").rsplit(".", 1)[-1]
    filename = f"{title[:160].replace('/', '-').replace(chr(92), '-')}.{extension}"
    original.name = filename
    if stored:
        stored.filename = filename
    references = (await db.scalars(select(DriveItem).where(DriveItem.source_type == "voice_track",
        DriveItem.source_id.in_([original.id, item.id])))).all()
    for reference in references:
        reference.name = filename
