"""Teacher drive API: browse, upload, organise, preview, export and share files."""

import asyncio
import hashlib
import io
import json
import mimetypes
import re
import secrets
import zipfile
from pathlib import PurePosixPath
from typing import Annotated, Literal, Optional
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File as UploadField, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_current_teacher, get_student_or_teacher
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import teacher_can_access_class, teacher_can_access_session
from app.models.document_draft import DocumentDraft
from app.models.drive import DriveItem, DriveShare
from app.models.enums import OwnerType, Scope, UserRole
from app.models.file import File
from app.models.invitation import ClassTeacher
from app.models.session import Class, Session, SessionStudent
from app.models.solid_model import SolidModel
from app.models.user import User
from app.services import drive_service as drive
from app.services.document_conversion import SUPPORTED_EXPORT_FORMATS, export_document

router = APIRouter()
public_router = APIRouter()

INLINE_SAFE_PREFIXES = ("image/", "video/", "audio/", "text/plain", "application/pdf")
UNSAFE_INLINE = {"image/svg+xml", "text/html", "application/xhtml+xml"}
MAX_ZIP_BYTES = 1024 * 1024 * 1024
View = Literal["folder", "recent", "starred", "trash", "shared", "search"]


# ── Schemas ───────────────────────────────────────────────────────────────────


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: Optional[UUID] = None


class ItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    starred: Optional[bool] = None


class ItemIds(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=500)


class MoveRequest(ItemIds):
    parent_id: Optional[UUID] = None


class ShareEntry(BaseModel):
    target_type: Literal["session", "class", "teacher"]
    target_id: Optional[UUID] = None
    email: Optional[str] = None  # teacher shares may be addressed by email
    role: Literal["viewer", "editor"] = "viewer"


class SharesUpdate(BaseModel):
    shares: list[ShareEntry] = Field(max_length=200)


class PublicLinkUpdate(BaseModel):
    enabled: bool


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _principal(db: AsyncSession, auth: StudentOrTeacher) -> drive.DrivePrincipal:
    return await drive.principal_for(db, auth.teacher, auth.student)


async def _load(db: AsyncSession, item_id: UUID) -> DriveItem:
    item = await db.get(DriveItem, item_id)
    if not item or item.is_hidden:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    return item


async def _require(db: AsyncSession, principal: drive.DrivePrincipal, item: DriveItem, needed: str) -> str:
    role, _ = await drive.resolve_role(db, principal, item)
    if not drive.role_at_least(role, needed):
        # Hide existence from people with no access at all.
        raise HTTPException(status_code=404 if role is None else 403, detail="Accesso negato")
    return role


def _clean_name(name: str) -> str:
    cleaned = re.sub(r"[\\/\x00-\x1f]", "_", name).strip().strip(".")
    if not cleaned:
        raise HTTPException(status_code=400, detail="Nome non valido")
    return cleaned[:255]


async def _serialize(db: AsyncSession, items: list[DriveItem], role: str | None = None) -> list[dict]:
    if not items:
        return []
    ids = [item.id for item in items]
    shared_ids = set((await db.execute(select(DriveShare.item_id).where(DriveShare.item_id.in_(ids)).distinct())).scalars().all())
    student_ids = {item.created_by_student_id for item in items if item.created_by_student_id}
    nicknames = dict((await db.execute(
        select(SessionStudent.id, SessionStudent.nickname).where(SessionStudent.id.in_(student_ids))
    )).all()) if student_ids else {}
    folder_ids = [item.id for item in items if item.kind == "folder"]
    child_counts = dict((await db.execute(
        select(DriveItem.parent_id, func.count())
        .where(DriveItem.parent_id.in_(folder_ids))
        .where(DriveItem.is_hidden.is_(False))
        .where(DriveItem.trashed_at.is_(None))
        .group_by(DriveItem.parent_id)
    )).all()) if folder_ids else {}
    thumbs = {}
    model_ids = [item.source_id for item in items if item.source_type == "solid_model" and item.source_id]
    if model_ids:
        thumbs = dict((await db.execute(select(SolidModel.id, SolidModel.thumbnail).where(SolidModel.id.in_(model_ids)))).all())
    return [
        {
            "id": str(item.id),
            "parent_id": str(item.parent_id) if item.parent_id else None,
            "kind": item.kind,
            "name": item.name,
            "source_type": item.source_type,
            "source_id": str(item.source_id) if item.source_id else None,
            "mime_type": item.mime_type,
            "size_bytes": item.size_bytes,
            "class_id": str(item.class_id) if item.class_id else None,
            "session_id": str(item.session_id) if item.session_id else None,
            "is_system": item.is_system,
            "starred": item.starred,
            "shared": item.id in shared_ids,
            "public": bool(item.public_token),
            "public_token": item.public_token if role == "owner" else None,
            "trashed_at": item.trashed_at.isoformat() if item.trashed_at else None,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            "created_by_student": nicknames.get(item.created_by_student_id),
            "child_count": child_counts.get(item.id, 0) if item.kind == "folder" else None,
            "thumbnail": thumbs.get(item.source_id) if item.source_type == "solid_model" else None,
            "role": role,
        }
        for item in items
    ]


def _visible(query):
    return query.where(DriveItem.is_hidden.is_(False))


def _content_headers(filename: str, mime: str, download: bool) -> dict[str, str]:
    inline = not download and mime not in UNSAFE_INLINE and mime.startswith(INLINE_SAFE_PREFIXES)
    headers = {
        "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(filename)}",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
    }
    if mime != "application/pdf":
        headers["Content-Security-Policy"] = "sandbox"  # never run scripts from user uploads on our origin
    return headers


async def _file_bytes(db: AsyncSession, item: DriveItem) -> tuple[bytes, str]:
    stored = await db.get(File, item.file_id) if item.file_id else None
    if not stored:
        raise HTTPException(status_code=404, detail="File non disponibile")
    try:
        data = await asyncio.to_thread(drive.read_blob, stored.storage_key)
    except Exception:
        raise HTTPException(status_code=404, detail="File non più presente nello storage")
    return data, stored.mime_type or item.mime_type or "application/octet-stream"


async def _document(db: AsyncSession, item: DriveItem) -> DocumentDraft:
    draft = await db.get(DocumentDraft, item.source_id) if item.source_id else None
    if not draft:
        raise HTTPException(status_code=404, detail="Documento non più disponibile")
    return draft


async def _export_bytes(db: AsyncSession, item: DriveItem, fmt: str | None) -> tuple[bytes, str, str]:
    """Bytes, filename and mime for one item in the requested (or default) export format."""
    if item.kind == "file":
        data, mime = await _file_bytes(db, item)
        return data, item.name, mime
    if item.source_type in ("document", "presentation"):
        draft = await _document(db, item)
        target = (fmt or ("pptx" if item.source_type == "presentation" else "docx")).lower()
        if target == "json":
            return draft.content_json.encode(), f"{item.name}.json", "application/json"
        if target not in SUPPORTED_EXPORT_FORMATS:
            raise HTTPException(status_code=400, detail=f"Formato .{target} non supportato")
        try:
            exported = await asyncio.to_thread(export_document, draft.content_json, draft.title, target)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return exported.content, exported.filename, exported.mime_type
    if item.source_type == "solid_model":
        model = await db.get(SolidModel, item.source_id) if item.source_id else None
        if not model:
            raise HTTPException(status_code=404, detail="Modello non più disponibile")
        payload = {"format": "golinelli-solid-modeler", "version": 1, "name": model.name, "objects": model.scene or []}
        return json.dumps(payload, ensure_ascii=False, indent=2).encode(), f"{item.name}.json", "application/json"
    raise HTTPException(status_code=400, detail="Elemento non esportabile")


async def _folder_for_write(db: AsyncSession, principal: drive.DrivePrincipal, parent_id: UUID | None) -> tuple[DriveItem | None, UUID]:
    """Target folder (None = drive root) and the drive owner new items belong to."""
    if parent_id is None:
        if not principal.is_teacher:
            raise HTTPException(status_code=403, detail="Seleziona una cartella condivisa")
        return None, principal.teacher.id
    folder = await _load(db, parent_id)
    if folder.kind != "folder" or folder.trashed_at:
        raise HTTPException(status_code=400, detail="La destinazione non è una cartella")
    await _require(db, principal, folder, "editor")
    return folder, folder.owner_teacher_id


async def _get_or_create_folder(db: AsyncSession, owner: UUID, tenant_id, parent: DriveItem | None, name: str) -> DriveItem:
    parent_id = parent.id if parent else None
    existing = (await db.execute(
        _visible(select(DriveItem))
        .where(DriveItem.owner_teacher_id == owner)
        .where(DriveItem.parent_id == parent_id if parent_id else DriveItem.parent_id.is_(None))
        .where(DriveItem.kind == "folder")
        .where(DriveItem.trashed_at.is_(None))
        .where(DriveItem.name == name)
        .limit(1)
    )).scalar_one_or_none()
    if existing:
        return existing
    class_id, session_id = await drive.context_of(db, parent)
    folder = DriveItem(owner_teacher_id=owner, tenant_id=tenant_id, parent_id=parent_id, kind="folder", name=name,
                       class_id=class_id, session_id=session_id)
    db.add(folder)
    await db.flush()
    return folder


async def _check_targets(db: AsyncSession, teacher: User, entries: list[ShareEntry]) -> list[tuple[str, UUID, str]]:
    resolved: list[tuple[str, UUID, str]] = []
    for entry in entries:
        if entry.target_type == "teacher":
            target = None
            if entry.target_id:
                target = await db.get(User, entry.target_id)
            elif entry.email:
                target = (await db.execute(
                    select(User).where(func.lower(User.email) == entry.email.strip().lower()).limit(1)
                )).scalar_one_or_none()
            if not target or target.role not in (UserRole.TEACHER, UserRole.ADMIN) or not target.is_active:
                raise HTTPException(status_code=400, detail=f"Docente non trovato: {entry.email or entry.target_id}")
            if target.id == teacher.id:
                continue
            resolved.append(("teacher", target.id, entry.role))
        elif entry.target_type == "class":
            if not entry.target_id or not await teacher_can_access_class(db, teacher, entry.target_id):
                raise HTTPException(status_code=403, detail="Classe non accessibile")
            resolved.append(("class", entry.target_id, entry.role))
        else:
            if not entry.target_id or not await teacher_can_access_session(db, teacher, entry.target_id):
                raise HTTPException(status_code=403, detail="Sessione non accessibile")
            resolved.append(("session", entry.target_id, entry.role))
    return resolved


# ── Browse ────────────────────────────────────────────────────────────────────


@router.get("/tree")
async def folder_tree(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """All folders of the teacher's drive (for the sidebar tree and move dialogs). Triggers the auto-sync."""
    await drive.sync_teacher_drive(db, teacher)
    folders = (await db.execute(
        _visible(select(DriveItem))
        .where(DriveItem.owner_teacher_id == teacher.id)
        .where(DriveItem.kind == "folder")
        .where(DriveItem.trashed_at.is_(None))
        .order_by(DriveItem.is_system.desc(), DriveItem.name)
    )).scalars().all()
    return [
        {
            "id": str(folder.id),
            "parent_id": str(folder.parent_id) if folder.parent_id else None,
            "name": folder.name,
            "is_system": folder.is_system,
            "class_id": str(folder.class_id) if folder.class_id else None,
            "session_id": str(folder.session_id) if folder.session_id else None,
            "system_key": folder.system_key,
        }
        for folder in folders
    ]


@router.get("/items")
async def list_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    view: View = "folder",
    parent_id: Optional[UUID] = None,
    q: Optional[str] = Query(default=None, max_length=120),
    sync: bool = False,
):
    principal = await _principal(db, auth)
    if principal.is_teacher:
        await drive.sync_teacher_drive(db, principal.teacher, force=sync)

    breadcrumb: list[dict] = []
    role: str | None = "owner" if principal.is_teacher else None

    if view == "folder" and parent_id:
        folder = await _load(db, parent_id)
        if folder.kind != "folder":
            raise HTTPException(status_code=400, detail="Non è una cartella")
        role, share_root = await drive.resolve_role(db, principal, folder)
        if role is None:
            raise HTTPException(status_code=404, detail="Cartella non trovata")
        chain = await drive.ancestors(db, folder)
        if share_root is not None:
            chain = chain[next(i for i, node in enumerate(chain) if node.id == share_root.id):]
        breadcrumb = [{"id": str(node.id), "name": node.name} for node in chain]
        rows = (await db.execute(
            _visible(select(DriveItem)).where(DriveItem.parent_id == folder.id).where(DriveItem.trashed_at.is_(None))
        )).scalars().all()
        return {"items": await _serialize(db, list(rows), role), "breadcrumb": breadcrumb, "role": role,
                "folder": (await _serialize(db, [folder], role))[0]}

    if view == "shared":
        targets = principal.share_targets()
        target_filter = or_(*[(DriveShare.target_type == kind) & (DriveShare.target_id == target_id) for kind, target_id in targets])
        share_rows = (await db.execute(select(DriveShare.item_id, DriveShare.role).where(target_filter))).all()
        best: dict[UUID, str] = {}
        for item_id, share_role in share_rows:
            if drive.ROLE_RANK.get(share_role, 0) > drive.ROLE_RANK.get(best.get(item_id, ""), 0):
                best[item_id] = share_role
        rows = (await db.execute(
            _visible(select(DriveItem)).where(DriveItem.id.in_(list(best))).where(DriveItem.trashed_at.is_(None))
        )).scalars().all() if best else []
        items = []
        for row in rows:
            items.extend(await _serialize(db, [row], best[row.id]))
        return {"items": items, "breadcrumb": [], "role": None}

    if not principal.is_teacher:
        raise HTTPException(status_code=403, detail="Vista disponibile solo ai docenti")
    owner = principal.teacher.id
    base = _visible(select(DriveItem)).where(DriveItem.owner_teacher_id == owner)
    if view == "folder":
        query = base.where(DriveItem.parent_id.is_(None)).where(DriveItem.trashed_at.is_(None))
    elif view == "recent":
        query = base.where(DriveItem.kind != "folder").where(DriveItem.trashed_at.is_(None)).order_by(DriveItem.updated_at.desc()).limit(60)
    elif view == "starred":
        query = base.where(DriveItem.starred.is_(True)).where(DriveItem.trashed_at.is_(None))
    elif view == "trash":
        trashed_parent = select(DriveItem.id).where(DriveItem.trashed_at.isnot(None))
        query = base.where(DriveItem.trashed_at.isnot(None)).where(
            or_(DriveItem.parent_id.is_(None), DriveItem.parent_id.not_in(trashed_parent))
        ).order_by(DriveItem.trashed_at.desc())
    else:
        term = (q or "").strip()
        if not term:
            return {"items": [], "breadcrumb": [], "role": "owner"}
        query = base.where(DriveItem.trashed_at.is_(None)).where(DriveItem.name.ilike(f"%{term}%")).limit(200)
    rows = (await db.execute(query)).scalars().all()
    return {"items": await _serialize(db, list(rows), "owner"), "breadcrumb": breadcrumb, "role": role}


@router.get("/items/{item_id}")
async def get_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    principal = await _principal(db, auth)
    item = await _load(db, item_id)
    role = await _require(db, principal, item, "viewer")
    return (await _serialize(db, [item], role))[0]


@router.get("/usage")
async def usage(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    return {"used_bytes": await drive.drive_usage_bytes(db, teacher.id), "quota_bytes": settings.DRIVE_QUOTA_MB * 1024 * 1024}


# ── Content, preview, export ──────────────────────────────────────────────────


@router.get("/items/{item_id}/content")
async def item_content(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    download: bool = False,
):
    principal = await _principal(db, auth)
    item = await _load(db, item_id)
    await _require(db, principal, item, "viewer")
    if item.kind != "file":
        raise HTTPException(status_code=400, detail="Usa l'esportazione per questo elemento")
    data, mime = await _file_bytes(db, item)
    return Response(content=data, media_type=mime, headers=_content_headers(item.name, mime, download))


@router.get("/items/{item_id}/document")
async def item_document(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Native document/presentation JSON for the in-drive preview."""
    principal = await _principal(db, auth)
    item = await _load(db, item_id)
    await _require(db, principal, item, "viewer")
    if item.source_type not in ("document", "presentation"):
        raise HTTPException(status_code=400, detail="Non è un documento")
    draft = await _document(db, item)
    return {"id": str(draft.id), "title": draft.title, "doc_type": draft.doc_type, "content_json": draft.content_json}


@router.get("/items/{item_id}/export")
async def item_export(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    format: Optional[str] = Query(default=None, max_length=8),
):
    principal = await _principal(db, auth)
    item = await _load(db, item_id)
    await _require(db, principal, item, "viewer")
    if item.kind == "folder":
        raise HTTPException(status_code=400, detail="Usa lo zip per le cartelle")
    data, filename, mime = await _export_bytes(db, item, format)
    return Response(content=data, media_type=mime, headers=_content_headers(filename, mime, True))


@router.post("/zip")
async def zip_items(
    body: ItemIds,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Download a selection (folders included, recursively) as one zip archive."""
    principal = await _principal(db, auth)
    entries: list[tuple[str, bytes]] = []
    total = 0
    used_names: set[str] = set()

    def unique(path: str) -> str:
        candidate, n = path, 1
        stem, suffix = str(PurePosixPath(path).with_suffix("")), PurePosixPath(path).suffix
        while candidate in used_names:
            n += 1
            candidate = f"{stem} ({n}){suffix}"
        used_names.add(candidate)
        return candidate

    async def add(item: DriveItem, prefix: str) -> None:
        nonlocal total
        if item.is_hidden or item.trashed_at:
            return
        if item.kind == "folder":
            children = (await db.execute(
                _visible(select(DriveItem)).where(DriveItem.parent_id == item.id).where(DriveItem.trashed_at.is_(None))
            )).scalars().all()
            folder_prefix = f"{prefix}{item.name}/"
            if not children:
                entries.append((unique(folder_prefix), b""))
            for child in children:
                await add(child, folder_prefix)
            return
        try:
            data, filename, _ = await _export_bytes(db, item, None)
        except HTTPException:
            return  # skip artifacts that disappeared or cannot be exported
        total += len(data)
        if total > MAX_ZIP_BYTES:
            raise HTTPException(status_code=413, detail="Selezione troppo grande per un unico zip")
        entries.append((unique(f"{prefix}{filename}"), data))

    for item_id in body.ids:
        item = await _load(db, item_id)
        await _require(db, principal, item, "viewer")
        await add(item, "")

    def build() -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for path, data in entries:
                if path.endswith("/"):
                    archive.writestr(zipfile.ZipInfo(path), b"")
                else:
                    archive.writestr(path, data)
        return buffer.getvalue()

    payload = await asyncio.to_thread(build)
    return StreamingResponse(
        io.BytesIO(payload),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename*=UTF-8''golinelli-files.zip", "Content-Length": str(len(payload))},
    )


# ── Create & upload ───────────────────────────────────────────────────────────


@router.post("/folders")
async def create_folder(
    body: FolderCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    principal = await _principal(db, auth)
    parent, owner = await _folder_for_write(db, principal, body.parent_id)
    class_id, session_id = await drive.context_of(db, parent)
    owner_user = await db.get(User, owner)
    folder = DriveItem(
        owner_teacher_id=owner, tenant_id=owner_user.tenant_id if owner_user else None,
        parent_id=parent.id if parent else None, kind="folder", name=_clean_name(body.name),
        class_id=class_id, session_id=session_id,
        created_by_student_id=principal.student.id if principal.student else None,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    role, _ = await drive.resolve_role(db, principal, folder)
    return (await _serialize(db, [folder], role))[0]


@router.post("/upload")
async def upload(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    files: list[UploadFile] = UploadField(...),
    parent_id: Optional[UUID] = Form(default=None),
    paths: Optional[str] = Form(default=None, description="JSON list of relative paths (folder uploads)"),
):
    principal = await _principal(db, auth)
    parent, owner = await _folder_for_write(db, principal, parent_id)
    owner_user = await db.get(User, owner)
    if not owner_user or not owner_user.tenant_id:
        raise HTTPException(status_code=400, detail="Drive non disponibile per questo account")
    relative_paths: list[str] = []
    if paths:
        try:
            relative_paths = [str(p) for p in json.loads(paths)]
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Percorsi non validi")

    max_size = settings.DRIVE_MAX_UPLOAD_MB * 1024 * 1024
    quota = settings.DRIVE_QUOTA_MB * 1024 * 1024
    used = await drive.drive_usage_bytes(db, owner)
    created: list[DriveItem] = []
    folder_cache: dict[str, DriveItem | None] = {"": parent}

    async def folder_for(relative: str) -> DriveItem | None:
        parts = [_clean_name(part) for part in PurePosixPath(relative).parts[:-1] if part not in ("", ".", "..")]
        key = ""
        current = parent
        for part in parts:
            key = f"{key}/{part}"
            if key not in folder_cache:
                folder_cache[key] = await _get_or_create_folder(db, owner, owner_user.tenant_id, current, part)
            current = folder_cache[key]
        return current

    for index, upload_file in enumerate(files):
        data = await upload_file.read(max_size + 1)
        if len(data) > max_size:
            raise HTTPException(status_code=413, detail=f"{upload_file.filename}: supera il limite di {settings.DRIVE_MAX_UPLOAD_MB} MB")
        if used + len(data) > quota:
            raise HTTPException(status_code=413, detail="Spazio del drive esaurito")
        used += len(data)
        relative = relative_paths[index] if index < len(relative_paths) and relative_paths[index] else (upload_file.filename or "file")
        target = await folder_for(relative)
        name = _clean_name(PurePosixPath(relative).name or upload_file.filename or "file")
        mime = upload_file.content_type
        if not mime or mime == "application/octet-stream":
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if name.lower().endswith(".glb"):
            mime = "model/gltf-binary"
        file_id = uuid4()
        suffix = PurePosixPath(name).suffix[:16]
        storage_key = f"{drive.DRIVE_PREFIX}{owner_user.tenant_id}/{owner}/{file_id}{suffix}"
        await asyncio.to_thread(drive.write_blob, storage_key, data)
        class_id, session_id = await drive.context_of(db, target)
        stored = File(
            id=file_id, tenant_id=owner_user.tenant_id,
            owner_type=OwnerType.STUDENT if principal.student else OwnerType.TEACHER,
            owner_teacher_id=None if principal.student else principal.teacher.id,
            owner_student_id=principal.student.id if principal.student else None,
            scope=Scope.USER, session_id=None, class_id=None, storage_key=storage_key, filename=name,
            mime_type=mime, size_bytes=len(data), checksum_sha256=hashlib.sha256(data).hexdigest(),
        )
        db.add(stored)
        await db.flush()
        item = DriveItem(
            owner_teacher_id=owner, tenant_id=owner_user.tenant_id, parent_id=target.id if target else None,
            kind="file", name=name, file_id=file_id, source_type="upload", mime_type=mime, size_bytes=len(data),
            class_id=class_id, session_id=session_id,
            created_by_student_id=principal.student.id if principal.student else None,
        )
        db.add(item)
        created.append(item)
    await db.commit()
    for item in created:
        await db.refresh(item)
    role = "owner" if principal.is_teacher and principal.teacher.id == owner else "editor"
    return {"items": await _serialize(db, created, role)}


# ── Organise ──────────────────────────────────────────────────────────────────


async def _sync_source_name(db: AsyncSession, item: DriveItem, name: str) -> None:
    """Renaming a linked artifact renames it everywhere on the platform."""
    if item.source_type in ("document", "presentation") and item.source_id:
        draft = await db.get(DocumentDraft, item.source_id)
        if draft:
            draft.title = name
    elif item.source_type == "solid_model" and item.source_id:
        model = await db.get(SolidModel, item.source_id)
        if model:
            model.name = name[:160]
    elif item.kind == "file" and item.file_id:
        stored = await db.get(File, item.file_id)
        if stored:
            stored.filename = name


@router.patch("/items/{item_id}")
async def update_item(
    item_id: UUID,
    body: ItemUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    principal = await _principal(db, auth)
    item = await _load(db, item_id)
    if body.starred is not None:
        await _require(db, principal, item, "owner")
        item.starred = body.starred
    if body.name is not None:
        await _require(db, principal, item, "editor")
        if item.is_system:
            raise HTTPException(status_code=400, detail="Le cartelle di classe e sessione seguono il nome sulla piattaforma")
        item.name = _clean_name(body.name)
        await _sync_source_name(db, item, item.name)
    await db.commit()
    await db.refresh(item)
    role, _ = await drive.resolve_role(db, principal, item)
    return (await _serialize(db, [item], role))[0]


@router.post("/move")
async def move_items(
    body: MoveRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    principal = await _principal(db, auth)
    target, owner = await _folder_for_write(db, principal, body.parent_id)
    for item_id in body.ids:
        item = await _load(db, item_id)
        await _require(db, principal, item, "editor")
        if item.is_system:
            raise HTTPException(status_code=400, detail=f"«{item.name}» è una cartella automatica e non si può spostare")
        if item.owner_teacher_id != owner:
            raise HTTPException(status_code=400, detail="Non puoi spostare elementi tra drive diversi")
        _, share_root = await drive.resolve_role(db, principal, item)
        if share_root is not None and share_root.id == item.id:
            raise HTTPException(status_code=403, detail="Non puoi spostare la cartella condivisa con te")
        if target is not None and await drive.is_descendant(db, target.id, item.id):
            raise HTTPException(status_code=400, detail="Non puoi spostare una cartella dentro sé stessa")
        item.parent_id = target.id if target else None
        if item.kind != "folder" and not item.system_key:
            item.class_id, item.session_id = await drive.context_of(db, target)
    await db.commit()
    return {"moved": len(body.ids)}


@router.post("/trash")
async def trash(
    body: ItemIds,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    principal = await _principal(db, auth)
    items = []
    for item_id in body.ids:
        item = await _load(db, item_id)
        await _require(db, principal, item, "editor")
        if item.is_system:
            raise HTTPException(status_code=400, detail=f"«{item.name}» è una cartella automatica e non si può eliminare")
        _, share_root = await drive.resolve_role(db, principal, item)
        if share_root is not None and share_root.id == item.id:
            raise HTTPException(status_code=403, detail="Non puoi eliminare la cartella condivisa con te")
        items.append(item)
    await drive.trash_items(db, items)
    await db.commit()
    return {"trashed": len(items)}


@router.post("/restore")
async def restore(
    body: ItemIds,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    items = [await _owned(db, teacher, item_id) for item_id in body.ids]
    await drive.restore_items(db, items)
    await db.commit()
    return {"restored": len(items)}


@router.post("/purge")
async def purge(
    body: ItemIds,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    items = [await _owned(db, teacher, item_id) for item_id in body.ids]
    if any(item.trashed_at is None for item in items):
        raise HTTPException(status_code=400, detail="Sposta prima gli elementi nel cestino")
    await drive.purge_items(db, items)
    await db.commit()
    return {"deleted": len(items)}


@router.delete("/trash")
async def empty_trash(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    items = (await db.execute(
        _visible(select(DriveItem)).where(DriveItem.owner_teacher_id == teacher.id).where(DriveItem.trashed_at.isnot(None))
    )).scalars().all()
    if items:
        await drive.purge_items(db, list(items))
        await db.commit()
    return {"deleted": len(items)}


async def _owned(db: AsyncSession, teacher: User, item_id: UUID) -> DriveItem:
    item = await _load(db, item_id)
    if item.owner_teacher_id != teacher.id:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    return item


# ── Sharing ───────────────────────────────────────────────────────────────────


@router.get("/share-targets")
async def share_targets(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    member_class_ids = select(ClassTeacher.class_id).where(ClassTeacher.teacher_id == teacher.id)
    classes = (await db.execute(
        select(Class).where(or_(Class.teacher_id == teacher.id, Class.id.in_(member_class_ids)))
        .where(Class.is_system.is_(False)).where(Class.archived_at.is_(None)).order_by(Class.name)
    )).scalars().all()
    sessions = (await db.execute(
        select(Session).where(Session.class_id.in_([cls.id for cls in classes])).where(Session.deleted_at.is_(None))
        .order_by(Session.created_at.desc())
    )).scalars().all() if classes else []
    return {
        "classes": [{"id": str(cls.id), "name": cls.name} for cls in classes],
        "sessions": [
            {"id": str(session.id), "name": session.title, "class_id": str(session.class_id), "status": getattr(session.status, "value", session.status)}
            for session in sessions
        ],
    }


@router.get("/items/{item_id}/shares")
async def get_shares(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    item = await _owned(db, teacher, item_id)
    shares = (await db.execute(select(DriveShare).where(DriveShare.item_id == item.id).order_by(DriveShare.created_at))).scalars().all()
    labels: dict[tuple[str, UUID], str] = {}
    for share in shares:
        if share.target_type == "teacher":
            user = await db.get(User, share.target_id)
            labels[(share.target_type, share.target_id)] = (
                f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email if user else "Docente"
            )
        elif share.target_type == "class":
            cls = await db.get(Class, share.target_id)
            labels[(share.target_type, share.target_id)] = cls.name if cls else "Classe"
        else:
            session = await db.get(Session, share.target_id)
            labels[(share.target_type, share.target_id)] = session.title if session else "Sessione"
    # Shares inherited from parent folders, shown read-only in the dialog.
    inherited = []
    chain = await drive.ancestors(db, item)
    parent_ids = [node.id for node in chain[:-1]]
    if parent_ids:
        rows = (await db.execute(select(DriveShare, DriveItem.name).join(DriveItem, DriveItem.id == DriveShare.item_id).where(DriveShare.item_id.in_(parent_ids)))).all()
        inherited = [{"target_type": share.target_type, "target_id": str(share.target_id), "role": share.role, "from": name} for share, name in rows]
    return {
        "shares": [
            {"target_type": share.target_type, "target_id": str(share.target_id), "role": share.role,
             "label": labels.get((share.target_type, share.target_id))}
            for share in shares
        ],
        "inherited": inherited,
        "public_token": item.public_token,
    }


@router.put("/items/{item_id}/shares")
async def put_shares(
    item_id: UUID,
    body: SharesUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    item = await _owned(db, teacher, item_id)
    resolved = await _check_targets(db, teacher, body.shares)
    existing = (await db.execute(select(DriveShare).where(DriveShare.item_id == item.id))).scalars().all()
    wanted = {(kind, target_id): role for kind, target_id, role in resolved}
    for share in existing:
        key = (share.target_type, share.target_id)
        if key not in wanted:
            await db.delete(share)
        else:
            share.role = wanted.pop(key)
    for (kind, target_id), role in wanted.items():
        db.add(DriveShare(item_id=item.id, target_type=kind, target_id=target_id, role=role))
    await db.commit()
    return await get_shares(item_id, db, teacher)


@router.post("/items/{item_id}/public-link")
async def set_public_link(
    item_id: UUID,
    body: PublicLinkUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    item = await _owned(db, teacher, item_id)
    if body.enabled and item.kind == "folder":
        raise HTTPException(status_code=400, detail="Il link pubblico è disponibile per i singoli file")
    if body.enabled and not item.public_token:
        item.public_token = secrets.token_urlsafe(24)
    elif not body.enabled:
        item.public_token = None
    await db.commit()
    return {"public_token": item.public_token}


# ── Public links ──────────────────────────────────────────────────────────────


@public_router.get("/{token}")
async def public_download(token: str, db: Annotated[AsyncSession, Depends(get_db)]):
    if len(token) > 64:
        raise HTTPException(status_code=404, detail="Link non valido")
    item = (await db.execute(
        select(DriveItem).where(DriveItem.public_token == token).where(DriveItem.is_hidden.is_(False)).where(DriveItem.trashed_at.is_(None))
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Link non valido o disattivato")
    data, filename, mime = await _export_bytes(db, item, "pdf" if item.source_type in ("document", "presentation") else None)
    return Response(content=data, media_type=mime, headers=_content_headers(filename, mime, False))
