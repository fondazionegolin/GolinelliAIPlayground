"""Teacher drive: automatic organisation, permissions and blob storage.

Each teacher owns one drive. ``sync_teacher_drive`` mirrors the teacher's classes and sessions as system
folders and imports everything produced in them (chat attachments, AI 3D models saved to chat, documents,
presentations, 3D Lab projects) as items keyed by ``system_key``. The sync only creates missing rows and
refreshes names, so the teacher can freely move, rename or delete imported items afterwards; a purged
import stays as a hidden tombstone so it is not re-created.

Access: the owner has full rights. Shares grant a session, a class or a colleague teacher ``viewer`` or
``editor`` rights on an item and everything below it.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document_draft import DocumentDraft
from app.models.drive import DriveItem, DriveShare
from app.models.file import File
from app.models.invitation import ClassTeacher
from app.models.session import Class, Session, SessionStudent
from app.models.solid_model import SolidModel
from app.models.user import User
from app.services.storage_service import storage_service

UPLOADS_ROOT = Path("uploads")
DRIVE_PREFIX = "drive/"
MINE_FOLDER_KEY = "mine"
DOCUMENT_MIME = {
    "document": "application/vnd.golinelli.document",
    "presentation": "application/vnd.golinelli.presentation",
    "sheet": "application/vnd.golinelli.sheet",
    "canvas": "application/vnd.golinelli.canvas",
}
SOLID_MODEL_MIME = "application/vnd.golinelli.solid-model"
ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}
MAX_TREE_DEPTH = 64
SYNC_INTERVAL_SECONDS = 20.0

_last_sync: dict[UUID, float] = {}
_sync_locks: dict[UUID, asyncio.Lock] = {}


# ── Principals ────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class DrivePrincipal:
    """Whoever is browsing: a teacher (owner of their drive, or share recipient) or a session student."""

    teacher: User | None = None
    student: SessionStudent | None = None
    student_class_id: UUID | None = None

    @property
    def is_teacher(self) -> bool:
        return self.teacher is not None

    def share_targets(self) -> list[tuple[str, UUID]]:
        if self.teacher:
            return [("teacher", self.teacher.id)]
        assert self.student is not None
        targets = [("session", self.student.session_id)]
        if self.student_class_id:
            targets.append(("class", self.student_class_id))
        return targets


async def principal_for(db: AsyncSession, teacher: User | None, student: SessionStudent | None) -> DrivePrincipal:
    if teacher:
        return DrivePrincipal(teacher=teacher)
    class_id = (await db.execute(select(Session.class_id).where(Session.id == student.session_id))).scalar_one_or_none()
    return DrivePrincipal(student=student, student_class_id=class_id)


# ── Tree helpers ──────────────────────────────────────────────────────────────


async def ancestors(db: AsyncSession, item: DriveItem) -> list[DriveItem]:
    """Chain from the root down to (and including) ``item``."""
    chain = [item]
    current = item
    while current.parent_id and len(chain) < MAX_TREE_DEPTH:
        parent = await db.get(DriveItem, current.parent_id)
        if not parent:
            break
        chain.append(parent)
        current = parent
    chain.reverse()
    return chain


async def descendant_ids(db: AsyncSession, root_ids: list[UUID]) -> list[UUID]:
    """All ids below ``root_ids`` (excluded), breadth first."""
    found: list[UUID] = []
    frontier = list(root_ids)
    seen = set(root_ids)
    while frontier:
        rows = (await db.execute(select(DriveItem.id).where(DriveItem.parent_id.in_(frontier)))).scalars().all()
        frontier = [row for row in rows if row not in seen]
        seen.update(frontier)
        found.extend(frontier)
    return found


async def resolve_role(db: AsyncSession, principal: DrivePrincipal, item: DriveItem) -> tuple[str | None, DriveItem | None]:
    """Effective role on ``item`` and the item that grants it (the share root, or the drive root for owners)."""
    if item.is_hidden:
        return None, None
    if principal.teacher and item.owner_teacher_id == principal.teacher.id:
        return "owner", None
    chain = await ancestors(db, item)
    targets = principal.share_targets()
    target_filter = or_(*[and_(DriveShare.target_type == kind, DriveShare.target_id == target_id) for kind, target_id in targets])
    shares = (await db.execute(
        select(DriveShare).where(DriveShare.item_id.in_([node.id for node in chain])).where(target_filter)
    )).scalars().all()
    if not shares:
        return None, None
    best = max(shares, key=lambda share: ROLE_RANK.get(share.role, 0))
    by_id = {node.id: node for node in chain}
    # Shared subtree root: the highest shared ancestor, so breadcrumbs start there.
    shared_ids = {share.item_id for share in shares}
    root = next(node for node in chain if node.id in shared_ids)
    return best.role, by_id.get(root.id, root)


def role_at_least(role: str | None, needed: str) -> bool:
    return ROLE_RANK.get(role or "", 0) >= ROLE_RANK[needed]


# ── Blob storage ──────────────────────────────────────────────────────────────


def blob_path(storage_key: str) -> Path | None:
    """Local path for disk-backed keys (chat uploads and drive uploads); None for object storage keys."""
    if storage_key.startswith(DRIVE_PREFIX) or storage_key.startswith("chat/"):
        path = (UPLOADS_ROOT / storage_key).resolve()
        if UPLOADS_ROOT.resolve() in path.parents:
            return path
    return None


def read_blob(storage_key: str) -> bytes:
    path = blob_path(storage_key)
    if path is not None:
        return path.read_bytes()
    return storage_service.download_file(storage_key)


def write_blob(storage_key: str, data: bytes) -> None:
    path = blob_path(storage_key)
    if path is None:
        raise ValueError("Drive blobs must live under the drive prefix")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def delete_blob(storage_key: str) -> None:
    path = blob_path(storage_key)
    if path is not None:
        path.unlink(missing_ok=True)


# ── Automatic organisation ────────────────────────────────────────────────────


async def sync_teacher_drive(db: AsyncSession, teacher: User, *, force: bool = False) -> None:
    """Mirror classes/sessions as folders and import session artifacts. Throttled per teacher."""
    now = time.monotonic()
    if not force and now - _last_sync.get(teacher.id, 0.0) < SYNC_INTERVAL_SECONDS:
        return
    lock = _sync_locks.setdefault(teacher.id, asyncio.Lock())
    async with lock:
        if not force and time.monotonic() - _last_sync.get(teacher.id, 0.0) < SYNC_INTERVAL_SECONDS:
            return
        try:
            await _sync(db, teacher)
            await db.commit()
        except IntegrityError:
            # A concurrent request (other worker) inserted the same system keys: its sync wins.
            await db.rollback()
        _last_sync[teacher.id] = time.monotonic()


async def _sync(db: AsyncSession, teacher: User) -> None:
    existing_rows = (await db.execute(
        select(DriveItem).where(DriveItem.owner_teacher_id == teacher.id).where(DriveItem.system_key.isnot(None))
    )).scalars().all()
    existing: dict[str, DriveItem] = {row.system_key: row for row in existing_rows}
    folders_by_id: dict[UUID, DriveItem] = {row.id: row for row in existing_rows if row.kind == "folder"}

    def ensure(key: str, **fields) -> DriveItem:
        row = existing.get(key)
        if row is None:
            parent_id = fields.get("parent_id")
            parent = folders_by_id.get(parent_id) if parent_id else None
            row = DriveItem(owner_teacher_id=teacher.id, tenant_id=teacher.tenant_id, system_key=key, **fields)
            if parent is not None and parent.trashed_at:
                row.trashed_at = parent.trashed_at
            db.add(row)
            existing[key] = row
        return row

    def track(folder: DriveItem) -> DriveItem:
        folders_by_id[folder.id] = folder
        return folder

    def refresh(row: DriveItem, **fields) -> None:
        for name, value in fields.items():
            if getattr(row, name) != value:
                setattr(row, name, value)

    # Classes the teacher owns or co-teaches; system helper classes stay out of the drive.
    member_class_ids = select(ClassTeacher.class_id).where(ClassTeacher.teacher_id == teacher.id)
    classes = (await db.execute(
        select(Class)
        .where(or_(Class.teacher_id == teacher.id, Class.id.in_(member_class_ids)))
        .where(Class.is_system.is_(False))
        .order_by(Class.created_at)
    )).scalars().all()
    class_ids = [cls.id for cls in classes]
    sessions = (await db.execute(
        select(Session).where(Session.class_id.in_(class_ids)).where(Session.deleted_at.is_(None)).order_by(Session.created_at)
    )).scalars().all() if class_ids else []

    mine = ensure(MINE_FOLDER_KEY, kind="folder", name="I miei lavori", is_system=True)
    await db.flush()

    class_folders: dict[UUID, DriveItem] = {}
    for cls in classes:
        folder = ensure(f"class:{cls.id}", kind="folder", name=cls.name, is_system=True, class_id=cls.id)
        refresh(folder, name=cls.name)
        class_folders[cls.id] = folder
    await db.flush()
    for folder in [mine, *class_folders.values()]:
        track(folder)

    session_folders: dict[UUID, DriveItem] = {}
    for session in sessions:
        parent = class_folders[session.class_id]
        folder = ensure(
            f"session:{session.id}", kind="folder", name=session.title, is_system=True,
            parent_id=parent.id, class_id=session.class_id, session_id=session.id,
        )
        refresh(folder, name=session.title)
        session_folders[session.id] = folder
    await db.flush()
    for folder in session_folders.values():
        track(folder)
    session_ids = list(session_folders)
    session_class = {session.id: session.class_id for session in sessions}

    # Session files: chat attachments and AI 3D models posted to the class chat.
    if session_ids:
        files = (await db.execute(
            select(File).where(File.session_id.in_(session_ids)).where(~File.storage_key.startswith(DRIVE_PREFIX))
        )).scalars().all()
        for stored in files:
            ensure(
                f"file:{stored.id}", kind="file", name=stored.filename, file_id=stored.id, source_type="chat",
                mime_type=stored.mime_type, size_bytes=stored.size_bytes, parent_id=session_folders[stored.session_id].id,
                class_id=session_class.get(stored.session_id), session_id=stored.session_id,
                created_by_student_id=stored.owner_student_id,
            )

    # Documents and presentations: session drafts (teacher's and students') plus the teacher's own drafts.
    draft_filter = DocumentDraft.owner_teacher_id == teacher.id
    if session_ids:
        draft_filter = or_(draft_filter, DocumentDraft.session_id.in_(session_ids))
    drafts = (await db.execute(
        select(DocumentDraft.id, DocumentDraft.title, DocumentDraft.doc_type, DocumentDraft.session_id, DocumentDraft.owner_student_id)
        .where(draft_filter)
    )).all()
    live_doc_keys = set()
    for draft_id, title, doc_type, session_id, owner_student_id in drafts:
        key = f"doc:{draft_id}"
        live_doc_keys.add(key)
        folder = session_folders.get(session_id) if session_id else None
        row = ensure(
            key, kind="link", name=title or "Documento", source_type=_doc_source(doc_type), source_id=draft_id,
            mime_type=DOCUMENT_MIME.get(doc_type, DOCUMENT_MIME["document"]),
            parent_id=(folder or mine).id, class_id=session_class.get(session_id), session_id=session_id if folder else None,
            created_by_student_id=owner_student_id,
        )
        refresh(row, name=title or "Documento")

    # 3D Lab projects: the teacher's own and those of students in the teacher's sessions.
    model_filter = SolidModel.owner_id == teacher.id
    student_session: dict[UUID, UUID] = {}
    if session_ids:
        student_rows = (await db.execute(
            select(SessionStudent.id, SessionStudent.session_id).where(SessionStudent.session_id.in_(session_ids))
        )).all()
        student_session = {student_id: session_id for student_id, session_id in student_rows}
        if student_session:
            model_filter = or_(model_filter, SolidModel.owner_student_id.in_(list(student_session)))
    models = (await db.execute(
        select(SolidModel.id, SolidModel.name, SolidModel.owner_student_id).where(model_filter)
    )).all()
    live_model_keys = set()
    for model_id, name, owner_student_id in models:
        key = f"solid:{model_id}"
        live_model_keys.add(key)
        session_id = student_session.get(owner_student_id) if owner_student_id else None
        folder = session_folders.get(session_id) if session_id else None
        row = ensure(
            key, kind="link", name=name or "Modello 3D", source_type="solid_model", source_id=model_id,
            mime_type=SOLID_MODEL_MIME, parent_id=(folder or mine).id,
            class_id=session_class.get(session_id), session_id=session_id, created_by_student_id=owner_student_id,
        )
        refresh(row, name=name or "Modello 3D")

    # Links whose artifact was deleted elsewhere disappear from the drive too.
    for key, row in list(existing.items()):
        if (key.startswith("doc:") and key not in live_doc_keys) or (key.startswith("solid:") and key not in live_model_keys):
            await db.delete(row)
            existing.pop(key)
    await db.flush()


def _doc_source(doc_type: str | None) -> str:
    return "presentation" if doc_type == "presentation" else "document"


# ── Mutations shared by endpoints ─────────────────────────────────────────────


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def trash_items(db: AsyncSession, items: list[DriveItem]) -> None:
    stamp = utcnow()
    ids = [item.id for item in items]
    for item in items:
        item.trashed_at = stamp
    below = await descendant_ids(db, ids)
    if below:
        await db.execute(
            update(DriveItem).where(DriveItem.id.in_(below)).where(DriveItem.trashed_at.is_(None)).values(trashed_at=stamp)
        )


async def restore_items(db: AsyncSession, items: list[DriveItem]) -> None:
    for item in items:
        stamp = item.trashed_at
        if stamp is None:
            continue
        below = await descendant_ids(db, [item.id])
        if below:
            await db.execute(
                update(DriveItem).where(DriveItem.id.in_(below)).where(DriveItem.trashed_at == stamp).values(trashed_at=None)
            )
        item.trashed_at = None
        if item.parent_id:
            parent = await db.get(DriveItem, item.parent_id)
            if parent is None or parent.trashed_at is not None:
                item.parent_id = None  # the original folder is still in the trash: restore to the root


async def purge_items(db: AsyncSession, items: list[DriveItem]) -> None:
    """Delete forever. Uploaded blobs are removed; auto-imported rows become hidden tombstones."""
    ids = [item.id for item in items]
    all_ids = ids + await descendant_ids(db, ids)
    rows = (await db.execute(select(DriveItem).where(DriveItem.id.in_(all_ids)))).scalars().all()
    blob_files: list[UUID] = []
    for row in rows:
        if row.system_key:
            row.is_hidden = True
            row.parent_id = None
            row.starred = False
            row.public_token = None
        elif row.kind == "file" and row.file_id and row.source_type == "upload":
            blob_files.append(row.file_id)
    await db.flush()
    if blob_files:
        stored = (await db.execute(select(File).where(File.id.in_(blob_files)))).scalars().all()
        for blob in stored:
            delete_blob(blob.storage_key)
            await db.delete(blob)  # cascades to the drive row
    folder_ids = [row.id for row in rows if not row.system_key and row.kind == "folder"]
    if folder_ids:
        # Bulk delete: nested folders go with their parent through the FK cascade.
        await db.execute(delete(DriveItem).where(DriveItem.id.in_(folder_ids)).execution_options(synchronize_session=False))
    await db.flush()


async def is_descendant(db: AsyncSession, candidate_id: UUID, ancestor_id: UUID) -> bool:
    current = await db.get(DriveItem, candidate_id)
    depth = 0
    while current is not None and depth < MAX_TREE_DEPTH:
        if current.id == ancestor_id:
            return True
        current = await db.get(DriveItem, current.parent_id) if current.parent_id else None
        depth += 1
    return False


async def context_of(db: AsyncSession, folder: DriveItem | None) -> tuple[UUID | None, UUID | None]:
    """Class/session a new item inherits from the folder it lands in."""
    if folder is None:
        return None, None
    for node in reversed(await ancestors(db, folder)):
        if node.session_id or node.class_id:
            return node.class_id, node.session_id
    return None, None


async def drive_usage_bytes(db: AsyncSession, teacher_id: UUID) -> int:
    total = (await db.execute(
        select(func.coalesce(func.sum(DriveItem.size_bytes), 0))
        .where(DriveItem.owner_teacher_id == teacher_id)
        .where(DriveItem.source_type == "upload")
        .where(DriveItem.is_hidden.is_(False))
    )).scalar_one()
    return int(total or 0)
