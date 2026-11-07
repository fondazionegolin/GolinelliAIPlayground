"""Personal and shared audio playlists, backed by permission-checked Drive files."""
import re
import asyncio
import time
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import String, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher, get_current_teacher
from app.core.database import get_db
from app.core.permissions import teacher_can_access_class
from app.models.drive import DriveItem, DriveShare
from app.models.file import File
from app.models.invitation import ClassTeacher
from app.models.session import Class, Session
from app.models.user import User
from app.models.voice_lab import VoiceLabItem, VoiceLabPlaylist, SessionAudioPlayback
from app.services.audio_library import artist_name
from app.services import drive_service as drive

router = APIRouter()
Db = Annotated[AsyncSession, Depends(get_db)]
Teacher = Annotated[User, Depends(get_current_teacher)]
Auth = Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]


def as_auth(auth):
    return auth if isinstance(auth, StudentOrTeacher) else StudentOrTeacher(teacher=auth)


class PlaylistWrite(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    track_ids: list[UUID] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def unique_tracks(self):
        self.title = re.sub(r"[\\/\x00-\x1f]", "_", self.title).strip().strip(".")
        if not self.title or len(set(self.track_ids)) != len(self.track_ids):
            raise ValueError("Titolo obbligatorio e tracce senza duplicati")
        return self


async def accessible(db, playlist_id, auth, *, edit=False):
    auth = as_auth(auth)
    query = select(VoiceLabPlaylist).where(VoiceLabPlaylist.id == playlist_id)
    playlist = await db.scalar(query.with_for_update() if edit else query)
    if not playlist:
        raise HTTPException(404, "Playlist non trovata")
    folder = await db.get(DriveItem, playlist.folder_id)
    if not folder or folder.trashed_at or folder.is_hidden:
        raise HTTPException(404, "Playlist non trovata")
    principal = await drive.principal_for(db, auth.teacher, auth.student)
    role, _ = await drive.resolve_role(db, principal, folder)
    if role is None or (edit and role != "owner"):
        raise HTTPException(404, "Playlist non trovata")
    return playlist, folder


async def track_metadata(db, drive_ids: list[str]) -> dict[str, dict]:
    if not drive_ids:
        return {}
    # Join the original owner, so shared tracks never acquire the listener's artist credit.
    rows = (await db.execute(select(VoiceLabItem, User).join(User, VoiceLabItem.owner_id == User.id).where(
        or_(VoiceLabItem.details["drive_item_id"].astext.in_(drive_ids), VoiceLabItem.id.cast(String).in_(drive_ids))))).all()
    metadata = {}
    for item, owner in rows:
        details = item.details or {}
        key = details.get("cover_key")
        value = {"title": item.title, "artist_name": details.get("artist_name") or artist_name(owner),
            "cover_url": f"/voice-lab/audio-files/{details['drive_item_id']}/cover?v={key[-12:-4]}" if key and details.get("drive_item_id") else None}
        metadata[str(item.id)] = value
        if details.get("drive_item_id"):
            metadata[details["drive_item_id"]] = value
    return metadata


async def cover_urls(db, drive_ids: list[str]) -> dict[str, str]:
    """Cover-only metadata for the Files browser."""
    metadata = await track_metadata(db, drive_ids)
    return {key: value["cover_url"] for key, value in metadata.items() if value.get("cover_url")}


async def serialize(db, playlist):
    children = (await db.scalars(select(DriveItem).where(DriveItem.parent_id == playlist.folder_id,
        DriveItem.source_type == "voice_track", DriveItem.trashed_at.is_(None), DriveItem.is_hidden.is_(False)))).all()
    by_source = {str(v.source_id): v for v in children}
    metadata = await track_metadata(db, [v for v in playlist.track_ids if v in by_source])
    tracks = [{"id": str(by_source[v].id), "source_item_id": v, "title": by_source[v].name,
               "mime_type": by_source[v].mime_type, **metadata.get(v, {})} for v in playlist.track_ids if v in by_source]
    return {"id": str(playlist.id), "title": playlist.title, "folder_id": str(playlist.folder_id), "tracks": tracks}


async def write_tracks(db, auth, playlist, body):
    auth = as_auth(auth)
    principal = await drive.principal_for(db, auth.teacher, auth.student)
    children = (await db.scalars(select(DriveItem).where(DriveItem.parent_id == playlist.folder_id,
        DriveItem.source_type == "voice_track").with_for_update())).all()
    existing = {str(v.source_id): v for v in children}
    originals = {}
    for item_id in body.track_ids:
        original = await db.get(DriveItem, item_id)
        if original is None:
            # Compatibility with playlists saved before Files became the audio library.
            item = await db.get(VoiceLabItem, item_id)
            if item and item.details.get("drive_item_id"):
                original = await db.get(DriveItem, UUID(item.details["drive_item_id"]))
        if original is None:
            original = existing.get(str(item_id))
        if not original or original.trashed_at or original.is_hidden or not original.file_id or not (original.mime_type or "").startswith("audio/"):
            raise HTTPException(422, "Una traccia non è più disponibile nei Files")
        role, _ = await drive.resolve_role(db, principal, original)
        if not role:
            raise HTTPException(422, "Audio non disponibile")
        originals[str(item_id)] = original
    for child in children:
        if str(child.source_id) not in originals:
            await db.delete(child)
    for item_id in body.track_ids:
        original = originals[str(item_id)]
        child = existing.get(str(item_id))
        if child is None:
            child = DriveItem(id=uuid4(), tenant_id=playlist.tenant_id, owner_teacher_id=playlist.owner_id,
                owner_student_id=playlist.owner_student_id, parent_id=playlist.folder_id, kind="file", file_id=original.file_id,
                source_type="voice_track", source_id=item_id, mime_type=original.mime_type, size_bytes=original.size_bytes)
            db.add(child)
        child.name = original.name[:255]
        child.trashed_at = None
    playlist.title = body.title
    playlist.track_ids = [str(v) for v in body.track_ids]
    await db.flush()


async def track_durations(db, value, known=None):
    from app.services.audio_metadata import duration_seconds
    durations = dict(known or {})
    for track in value["tracks"]:
        if track["id"] in durations:
            continue
        item = await db.get(DriveItem, UUID(track["id"]))
        stored = await db.get(File, item.file_id)
        if stored.audio_duration is None:
            stored.audio_duration = await asyncio.to_thread(duration_seconds, stored.storage_key)
        if not stored.audio_duration:
            raise HTTPException(422, f"Audio non valido o durata non leggibile: {track['title']}")
        durations[track["id"]] = stored.audio_duration
    return durations


@router.get("/audio-files")
async def audio_files(db: Db, auth: Auth):
    principal = await drive.principal_for(db, auth.teacher, auth.student)
    if auth.teacher:
        await drive.sync_teacher_drive(db, auth.teacher)
        owned = (DriveItem.owner_teacher_id == auth.teacher.id) & DriveItem.owner_student_id.is_(None)
    else:
        root = await drive.sync_student_audio(db, auth.student)
        custodian = await db.get(User, root.owner_teacher_id)
        await drive.sync_teacher_drive(db, custodian)
        await db.commit()
        owned = DriveItem.owner_student_id == auth.student.id
    targets = principal.share_targets()
    roots = list((await db.scalars(select(DriveShare.item_id).where(or_(*[
        (DriveShare.target_type == kind) & (DriveShare.target_id == target) for kind, target in targets])))).all())
    shared = roots + await drive.descendant_ids(db, roots) if roots else []
    # Students may reuse their generated session audio even before sharing it.
    if auth.student:
        stored_ids = select(File.id).where(File.owner_student_id == auth.student.id, File.mime_type.startswith("audio/"))
        owned = or_(owned, DriveItem.file_id.in_(stored_ids))
    rows = (await db.scalars(select(DriveItem).where(or_(owned, DriveItem.id.in_(shared)),
        DriveItem.kind == "file", DriveItem.mime_type.startswith("audio/"), DriveItem.trashed_at.is_(None),
        DriveItem.is_hidden.is_(False), DriveItem.source_type != "voice_track").order_by(DriveItem.created_at.desc()))).all()
    result = []
    seen = set()
    metadata = await track_metadata(db, [str(v.id) for v in rows])
    for row in rows:
        # resolve_role also checks hidden/trashed ancestors of shared files.
        role, _ = await drive.resolve_role(db, principal, row)
        if role and row.file_id not in seen:
            seen.add(row.file_id)
            result.append({"id": str(row.id), "title": row.name, "mime_type": row.mime_type,
                "owned": role == "owner", "shared": row.id in shared, **metadata.get(str(row.id), {})})
    return result


@router.get("/audio-files/{item_id}/cover")
async def audio_cover(item_id: UUID, db: Db, auth: Auth):
    auth = as_auth(auth)
    row = await db.get(DriveItem, item_id)
    if not row or row.trashed_at or row.is_hidden:
        raise HTTPException(404, "Copertina non disponibile")
    principal = await drive.principal_for(db, auth.teacher, auth.student)
    if (await drive.resolve_role(db, principal, row))[0] is None:
        raise HTTPException(404, "Copertina non disponibile")
    source = str(row.source_id) if row.source_type == "voice_track" and row.source_id else str(row.id)
    item = await db.scalar(select(VoiceLabItem).where(VoiceLabItem.details["drive_item_id"].astext == source))
    key = (item.details or {}).get("cover_key") if item else None
    if not key:
        raise HTTPException(404, "Copertina non disponibile")
    try:
        data = await asyncio.to_thread(drive.read_blob, key)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(404, "Copertina non disponibile") from exc
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})


@router.get("/playlists")
async def playlists(db: Db, auth: Auth):
    auth = as_auth(auth)
    owned = (VoiceLabPlaylist.owner_id == auth.teacher.id) & VoiceLabPlaylist.owner_student_id.is_(None) if auth.teacher else VoiceLabPlaylist.owner_student_id == auth.student.id
    rows = (await db.scalars(select(VoiceLabPlaylist).join(DriveItem, DriveItem.id == VoiceLabPlaylist.folder_id).where(
        owned, DriveItem.trashed_at.is_(None), DriveItem.is_hidden.is_(False)).order_by(VoiceLabPlaylist.created_at.desc()))).all()
    return [await serialize(db, v) for v in rows]


@router.post("/playlists")
async def create_playlist(body: PlaylistWrite, db: Db, auth: Auth):
    async with db.begin_nested():
        auth = as_auth(auth)
        root = await drive.student_root(db, auth.student) if auth.student else None
        owner = auth.teacher.id if auth.teacher else root.owner_teacher_id
        tenant = auth.teacher.tenant_id if auth.teacher else root.tenant_id
        student_id = auth.student.id if auth.student else None
        parent = await drive.type_folder(db, owner, tenant, "Playlist", parent=root, student_id=student_id)
        playlist_id, folder_id = uuid4(), uuid4()
        folder = DriveItem(id=folder_id, tenant_id=tenant, owner_teacher_id=owner, owner_student_id=student_id,
            parent_id=parent.id, kind="folder", name=body.title, source_type="voice_playlist", source_id=playlist_id)
        db.add(folder)
        await db.flush()
        playlist = VoiceLabPlaylist(id=playlist_id, tenant_id=tenant, owner_id=owner, owner_student_id=student_id,
            title=body.title, folder_id=folder_id, track_ids=[])
        db.add(playlist)
        await write_tracks(db, auth, playlist, body)
    await db.commit()
    return await serialize(db, playlist)


@router.get("/playlists/{playlist_id}")
async def playlist_details(playlist_id: UUID, db: Db, auth: Auth):
    playlist, _ = await accessible(db, playlist_id, auth)
    return await serialize(db, playlist)


@router.put("/playlists/{playlist_id}")
async def update_playlist(playlist_id: UUID, body: PlaylistWrite, db: Db, auth: Auth):
    playlist, folder = await accessible(db, playlist_id, auth, edit=True)
    broadcasts = (await db.scalars(select(SessionAudioPlayback).where(SessionAudioPlayback.playlist_id == playlist.id).with_for_update())).all()
    previous = [(row, await playback_payload(db, row)) for row in broadcasts]
    await write_tracks(db, auth, playlist, body)
    folder.name = body.title
    value = await serialize(db, playlist)
    # Enriching an active playlist preserves the current track and position.
    # Removed tracks stop being authorized immediately; newly added tracks get durations.
    for row, before in previous:
        if not value["tracks"]:
            row.playlist_id = None
            continue
        durations = await track_durations(db, value, row.state.get("durations"))
        current_id = before["playlist"]["tracks"][before["index"]]["id"] if before and before["playlist"]["tracks"] else None
        next_index = next((i for i, v in enumerate(value["tracks"]) if v["id"] == current_id), None)
        row.state = {"index": next_index or 0, "position": before["position"] if next_index is not None else 0,
            "paused": before["paused"] if before else True, "durations": durations,
            "updated_at": time.time(), "revision": str(uuid4())}
    await db.commit()
    return value


@router.delete("/playlists/{playlist_id}")
async def delete_playlist(playlist_id: UUID, db: Db, auth: Auth):
    _, folder = await accessible(db, playlist_id, auth, edit=True)
    await drive.trash_items(db, [folder])
    await db.commit()
    return {"ok": True}


@router.post("/audio-files/{item_id}/share-class")
async def share_audio_class(item_id: UUID, db: Db, auth: Auth):
    if not auth.student:
        raise HTTPException(403, "Usa la condivisione Files per scegliere la classe")
    principal = await drive.principal_for(db, None, auth.student)
    item = await db.get(DriveItem, item_id)
    if not item or (await drive.resolve_role(db, principal, item))[0] != "owner" or not (item.mime_type or "").startswith("audio/"):
        raise HTTPException(422, "Audio non disponibile")
    cls = await db.get(Class, principal.student_class_id)
    teachers = [cls.teacher_id, *(await db.scalars(select(ClassTeacher.teacher_id).where(ClassTeacher.class_id == cls.id))).all()]
    for kind, target in [("class", cls.id), *[("teacher", v) for v in set(teachers)]]:
        await db.execute(insert(DriveShare).values(id=uuid4(), item_id=item.id, target_type=kind, target_id=target, role="viewer").on_conflict_do_nothing(constraint="uq_drive_shares_target"))
    await db.commit()
    return {"ok": True}


class PlaybackWrite(BaseModel):
    playlist_id: UUID | None = None
    index: int = Field(default=0, ge=0, le=199)
    position: float = Field(default=0, ge=0, le=86400, allow_inf_nan=False)
    paused: bool = False
    expected_revision: str | None = None


async def require_session(db, auth, session_id=None):
    """Shared audio belongs to one session: students only reach their own, teachers need access to its class."""
    if auth.student:
        if session_id and session_id != auth.student.session_id:
            raise HTTPException(404, "Sessione non disponibile")
        session_id = auth.student.session_id
    session = await db.get(Session, session_id) if session_id else None
    if not session or session.deleted_at:
        raise HTTPException(404, "Sessione non disponibile")
    if auth.teacher and not await teacher_can_access_class(db, auth.teacher, session.class_id):
        raise HTTPException(404, "Sessione non disponibile")
    return session.id


async def playback_payload(db, playback):
    if not playback or not playback.playlist_id:
        return None
    playlist = await db.get(VoiceLabPlaylist, playback.playlist_id)
    folder = await db.get(DriveItem, playlist.folder_id) if playlist else None
    if not folder or folder.trashed_at or folder.is_hidden:
        return None
    value = await serialize(db, playlist)
    state = dict(playback.state)
    now = time.time()
    index = min(state.get("index", 0), max(0, len(value["tracks"]) - 1))
    position = state.get("position", 0) + (0 if state.get("paused") else max(0, now - state.get("updated_at", now)))
    durations = state.get("durations", {})
    while value["tracks"]:
        duration = durations.get(value["tracks"][index]["id"])
        if not duration or position < duration:
            break
        if index + 1 >= len(value["tracks"]):
            state["paused"] = True
            position = duration
            break
        position -= duration
        index += 1
    return {**state, "index": index, "position": position, "updated_at": now,
        "session_id": str(playback.session_id), "teacher_id": str(playback.teacher_id),
        "playlist": value, "server_time": now}


@router.get("/session-playback")
async def session_playback(db: Db, auth: Auth, session_id: UUID | None = None):
    if auth.teacher and not session_id:
        return None
    session_id = await require_session(db, auth, session_id)
    return await playback_payload(db, await db.get(SessionAudioPlayback, session_id))


@router.put("/session-playback/{session_id}")
async def set_session_playback(session_id: UUID, body: PlaybackWrite, db: Db, teacher: Teacher):
    await require_session(db, StudentOrTeacher(teacher=teacher), session_id)
    await db.execute(insert(SessionAudioPlayback).values(session_id=session_id, teacher_id=teacher.id, state={}).on_conflict_do_nothing())
    playback = await db.scalar(select(SessionAudioPlayback).where(SessionAudioPlayback.session_id == session_id).with_for_update())
    if body.expected_revision and body.expected_revision != playback.state.get("revision"):
        raise HTTPException(409, "La riproduzione è stata aggiornata")
    durations = dict(playback.state.get("durations", {}))
    if body.playlist_id:
        playlist, _ = await accessible(db, body.playlist_id, StudentOrTeacher(teacher=teacher))
        value = await serialize(db, playlist)
        if not value["tracks"] or body.index >= len(value["tracks"]):
            raise HTTPException(422, "Playlist vuota o traccia non disponibile")
        durations = await track_durations(db, value, durations)
    playback.teacher_id = teacher.id
    playback.playlist_id = body.playlist_id
    playback.state = {"index": body.index, "position": body.position, "paused": body.paused,
        "updated_at": time.time(), "revision": str(uuid4()), "durations": durations}
    await db.commit()
    return await playback_payload(db, playback)


@router.get("/session-playback/{session_id}/tracks/{track_id}/content")
async def session_track_content(session_id: UUID, track_id: UUID, db: Db, auth: Auth):
    await require_session(db, auth, session_id)
    value = await playback_payload(db, await db.get(SessionAudioPlayback, session_id))
    if not value or str(track_id) not in {v["id"] for v in value["playlist"]["tracks"]}:
        raise HTTPException(404, "Traccia non disponibile")
    item = await db.get(DriveItem, track_id)
    stored = await db.get(File, item.file_id)
    if not stored:
        raise HTTPException(404, "Traccia non disponibile")
    data = await asyncio.to_thread(drive.read_blob, stored.storage_key)
    return Response(data, media_type=stored.mime_type, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
