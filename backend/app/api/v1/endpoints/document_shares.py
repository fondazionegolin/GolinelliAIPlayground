"""Capability links: owner-only management, anonymous view/edit, revision-checked saves."""
import asyncio
import hashlib
import io
import json
import math
import re
import secrets
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

import nh3
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.core.database import get_db
from app.core.permissions import teacher_can_access_session
from app.models.document_draft import DocumentDraft, DocumentDraftVersion
from app.models.document_share import DocumentShareLink
from app.models.file import File
from app.models.task import Task, TaskType
from app.services.slide_sanitizer import sanitize_document_draft_content_json
from app.services.storage_service import storage_service

router = APIRouter()
Db = Annotated[AsyncSession, Depends(get_db)]
Auth = Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]
SourceKind = Literal["draft", "task"]
FILE_URL = re.compile(r"/api/v1/files/([0-9a-fA-F-]{36})/content")
PUBLIC_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"}


class CreateLink(BaseModel):
    source_kind: SourceKind
    source_id: UUID
    permission: Literal["view", "edit"]


class PublicSave(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content_json: str = Field(max_length=24_000_000)
    revision: str = Field(min_length=64, max_length=64)


def source_filter(kind: SourceKind, source_id: UUID):
    return (DocumentShareLink.draft_id if kind == "draft" else DocumentShareLink.task_id) == source_id


def document_kind(source) -> str:
    if isinstance(source, DocumentDraft):
        return source.doc_type
    try:
        return "presentation" if isinstance(json.loads(source.content_json).get("slides"), list) else "document"
    except (ValueError, AttributeError, TypeError):
        return "invalid"


def revision(source) -> str:
    return hashlib.sha256((source.title + "\0" + (source.content_json or "")).encode()).hexdigest()


async def owned_source(db: AsyncSession, auth: StudentOrTeacher, kind: SourceKind, source_id: UUID):
    source = (await db.execute(select(DocumentDraft if kind == "draft" else Task).where(
        (DocumentDraft.id if kind == "draft" else Task.id) == source_id))).scalar_one_or_none()
    allowed = False
    if source is not None and kind == "draft":
        allowed = source.owner_student_id == auth.student.id if auth.is_student else source.owner_teacher_id == auth.teacher.id
    elif source is not None and auth.is_teacher and source.task_type in {TaskType.LESSON, TaskType.PRESENTATION}:
        allowed = source.tenant_id == auth.teacher.tenant_id and bool(source.session_id) and await teacher_can_access_session(db, auth.teacher, source.session_id)
    if not allowed:
        raise HTTPException(404, "Documento non trovato")
    if document_kind(source) not in {"document", "presentation"}:
        raise HTTPException(422, "Puoi condividere documenti e presentazioni")
    return source


async def granted_assets(db: AsyncSession, auth: StudentOrTeacher, content_json: str) -> list[str]:
    from app.api.v1.endpoints.files import _can_access_file
    ids = set()
    for value in FILE_URL.findall(content_json):
        try:
            ids.add(UUID(value))
        except ValueError:
            continue
    if not ids:
        return []
    files = (await db.execute(select(File).where(File.id.in_(ids)))).scalars().all()
    return [str(f.id) for f in files if f.mime_type.startswith("image/") and await _can_access_file(db, auth, f)]


def link_response(link):
    return {"id": str(link.id), "token": link.token, "permission": link.permission, "created_at": link.created_at.isoformat()}


@router.get("")
async def list_links(source_kind: SourceKind, source_id: UUID, db: Db, auth: Auth):
    source = await owned_source(db, auth, source_kind, source_id)
    links = (await db.execute(select(DocumentShareLink).where(source_filter(source_kind, source_id), DocumentShareLink.revoked_at.is_(None))
                             .order_by(DocumentShareLink.created_at))).scalars().all()
    if links:
        assets = await granted_assets(db, auth, source.content_json)
        for link in links:
            link.asset_ids = assets
        await db.commit()
    return [link_response(link) for link in links]


@router.post("")
async def create_link(body: CreateLink, db: Db, auth: Auth):
    source = await owned_source(db, auth, body.source_kind, body.source_id)
    # Serialize link creation on the source so double clicks cannot create duplicates.
    model = DocumentDraft if body.source_kind == "draft" else Task
    source = (await db.execute(select(model).where(model.id == body.source_id).with_for_update()
                              .execution_options(populate_existing=True))).scalar_one_or_none()
    if source is None:
        raise HTTPException(404, "Documento non trovato")
    link = (await db.execute(select(DocumentShareLink).where(source_filter(body.source_kind, body.source_id),
            DocumentShareLink.permission == body.permission, DocumentShareLink.revoked_at.is_(None)))).scalar_one_or_none()
    if link is None:
        link = DocumentShareLink(token=secrets.token_urlsafe(32), permission=body.permission,
                                 **{f"{body.source_kind}_id": body.source_id})
        db.add(link)
    link.asset_ids = await granted_assets(db, auth, source.content_json)
    await db.commit()
    await db.refresh(link)
    return link_response(link)


@router.delete("/{link_id}", status_code=204)
async def revoke_link(link_id: UUID, db: Db, auth: Auth):
    link = (await db.execute(select(DocumentShareLink).where(DocumentShareLink.id == link_id).with_for_update())).scalar_one_or_none()
    if link is None:
        raise HTTPException(404, "Link non trovato")
    await owned_source(db, auth, "draft" if link.draft_id else "task", link.draft_id or link.task_id)
    link.revoked_at = datetime.now(timezone.utc)
    await db.commit()


async def public_source(db: AsyncSession, token: str, *, lock: bool = False):
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise HTTPException(404, "Link non trovato")
    query = select(DocumentShareLink).where(DocumentShareLink.token == token)
    link = (await db.execute(query)).scalar_one_or_none()
    if link is None:
        raise HTTPException(404, "Link non trovato")
    if link.revoked_at is not None:
        raise HTTPException(410, "Questo link è stato revocato")
    model = DocumentDraft if link.draft_id else Task
    query = select(model).where(model.id == (link.draft_id or link.task_id))
    source = (await db.execute(query.with_for_update() if lock else query)).scalar_one_or_none()
    if lock:
        # Same lock order as link creation (source, then link); recheck revocation after waiting.
        link = (await db.execute(select(DocumentShareLink).where(DocumentShareLink.id == link.id)
                                .with_for_update().execution_options(populate_existing=True))).scalar_one()
        if link.revoked_at is not None:
            raise HTTPException(410, "Questo link è stato revocato")
    if source is None or document_kind(source) not in {"document", "presentation"}:
        raise HTTPException(404, "Documento non disponibile")
    return link, source


def public_document(link, source) -> dict:
    content = json.loads(source.content_json)
    content.pop("source", None)
    encoded = json.dumps(content, ensure_ascii=False)
    for file_id in link.asset_ids:
        encoded = encoded.replace(f"/api/v1/files/{file_id}/content", f"/api/v1/document-shares/public/{link.token}/assets/{file_id}")
    return {"title": source.title, "doc_type": document_kind(source), "content_json": encoded,
            "permission": link.permission, "revision": revision(source)}


@router.get("/public/{token}")
async def read_public(token: str, response: Response, db: Db):
    link, source = await public_source(db, token)
    response.headers.update(PUBLIC_HEADERS)
    return public_document(link, source)


def clean_public_content(raw: str, kind: str) -> str:
    try:
        value = json.loads(raw)
    except ValueError:
        raise HTTPException(422, "Contenuto non valido")
    if not isinstance(value, dict):
        raise HTTPException(422, "Contenuto non valido")
    if kind == "presentation":
        if value.get("format") is not None and (not isinstance(value["format"], str) or value["format"] not in {"16:9", "4:3"}):
            raise HTTPException(422, "Formato non valido")
        slides = value.get("slides")
        if not isinstance(slides, list) or not 1 <= len(slides) <= 200:
            raise HTTPException(422, "La presentazione deve contenere da 1 a 200 slide")
        for slide in slides:
            if not isinstance(slide, dict) or not isinstance(slide.get("blocks"), list) or len(slide["blocks"]) > 1000:
                raise HTTPException(422, "Slide non valida")
            for key in ("id", "title", "speakerNotes", "backgroundColor"):
                if slide.get(key) is not None and not isinstance(slide[key], str):
                    raise HTTPException(422, "Slide non valida")
            for block in slide["blocks"]:
                if not isinstance(block, dict) or block.get("type") not in {"text", "image", "video", "rectangle", "ellipse", "line"}:
                    raise HTTPException(422, "Elemento non valido")
                if not isinstance(block.get("content", ""), str) or not isinstance(block.get("style", {}), dict):
                    raise HTTPException(422, "Elemento non valido")
                if block.get("id") is not None and not isinstance(block["id"], str):
                    raise HTTPException(422, "Elemento non valido")
                for key, item in block.get("style", {}).items():
                    if item is not None and (not isinstance(item, (str, int, float, bool)) or isinstance(item, float) and not math.isfinite(item)):
                        raise HTTPException(422, "Stile non valido")
                    if key in {"fontFamily", "color", "backgroundColor", "fill", "stroke", "textAlign", "fontStyle", "fontWeight", "textDecoration"} and item is not None and not isinstance(item, str):
                        raise HTTPException(422, "Stile non valido")
                    if key in {"fontSize", "lineHeight", "padding", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "borderRadius", "cornerRadius", "strokeWidth"} and item is not None and not isinstance(item, (int, float)):
                        raise HTTPException(422, "Stile non valido")
                if block.get("rotation") is not None and (not isinstance(block["rotation"], (int, float)) or not math.isfinite(block["rotation"])):
                    raise HTTPException(422, "Rotazione non valida")
                for key in ("x", "y", "width", "height"):
                    number = block.get(key)
                    if not isinstance(number, (int, float)) or not math.isfinite(number) or abs(number) > 10000:
                        raise HTTPException(422, "Dimensioni non valide")
        value["type"] = "presentation_v2"
    else:
        if not isinstance(value.get("htmlContent"), str) or "slides" in value:
            raise HTTPException(422, "Documento non valido")
        value["type"] = "document_v1"
        if value.get("margins") is not None:
            if not isinstance(value["margins"], dict) or any(not isinstance(n, (int, float)) or not math.isfinite(n) or not 0 <= n <= 300 for n in value["margins"].values()):
                raise HTTPException(422, "Margini non validi")
        value["htmlContent"] = nh3.clean(value["htmlContent"],
            tags={"p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "div", "section", "br", "strong", "em", "b", "i", "u", "s", "sub", "sup", "mark", "blockquote", "pre", "code", "ul", "ol", "li", "a", "img", "hr", "table", "thead", "tbody", "tr", "td", "th", "colgroup", "col"},
            attributes={"*": {"style", "class", "data-docx-region", "data-docx-region-label", "data-composition", "data-columns",
                               "data-type", "data-latex", "data-docx-comment", "data-comment-id", "data-comment-author", "data-comment-date", "data-comment-text",
                               "data-revision-kind", "data-revision-author", "data-revision-date"},
                        "img": {"src", "alt", "width", "height"}, "a": {"href", "title"},
                        "td": {"colspan", "rowspan", "colwidth"}, "th": {"colspan", "rowspan", "colwidth"}, "ol": {"start"}},
            url_schemes={"https", "http", "data", "mailto"})
    value.pop("source", None)
    return sanitize_document_draft_content_json(json.dumps(value, ensure_ascii=False))


@router.put("/public/{token}")
async def save_public(token: str, body: PublicSave, response: Response, db: Db):
    link, source = await public_source(db, token, lock=True)
    if link.permission != "edit":
        raise HTTPException(403, "Questo link consente solo la lettura")
    if body.revision != revision(source):
        raise HTTPException(409, "Il documento è stato modificato da un’altra persona. Ricarica la versione aggiornata prima di salvare.")
    cleaned = clean_public_content(body.content_json, document_kind(source))
    for file_id in link.asset_ids:
        cleaned = cleaned.replace(f"/api/v1/document-shares/public/{token}/assets/{file_id}", f"/api/v1/files/{file_id}/content")
    # Import provenance belongs to the owner; anonymous editors neither see nor replace it.
    original = json.loads(source.content_json)
    if "source" in original:
        parsed = json.loads(cleaned)
        parsed["source"] = original["source"]
        cleaned = json.dumps(parsed, ensure_ascii=False)
    if isinstance(source, DocumentDraft) and source.owner_teacher_id:
        db.add(DocumentDraftVersion(draft_id=source.id, owner_teacher_id=source.owner_teacher_id,
                                   title=source.title, doc_type=source.doc_type, content_json=source.content_json,
                                   label="Prima di una modifica tramite link"))
    source.title = body.title.strip() or source.title
    source.content_json = cleaned
    await db.commit()
    await db.refresh(source)
    response.headers.update(PUBLIC_HEADERS)
    return public_document(link, source)


@router.get("/public/{token}/assets/{file_id}")
async def public_asset(token: str, file_id: UUID, db: Db):
    link, source = await public_source(db, token)
    if str(file_id) not in link.asset_ids or str(file_id) not in source.content_json:
        raise HTTPException(404, "Immagine non disponibile")
    stored = (await db.execute(select(File).where(File.id == file_id))).scalar_one_or_none()
    if stored is None or not stored.mime_type.startswith("image/"):
        raise HTTPException(404, "Immagine non disponibile")
    data = await asyncio.to_thread(storage_service.download_file, stored.storage_key)
    return StreamingResponse(io.BytesIO(data), media_type=stored.mime_type,
                             headers={**PUBLIC_HEADERS, "X-Content-Type-Options": "nosniff",
                                      "Content-Security-Policy": "default-src 'none'; sandbox"})
