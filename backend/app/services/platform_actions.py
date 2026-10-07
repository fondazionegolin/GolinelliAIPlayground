"""Platform action catalogue: one typed, self-describing entry per platform capability.

Every action is a thin layer over the logic the UI already uses (Drive, office documents, image / 3D
generation, live sessions): same permission checks, same credit metering, same side effects.  The catalogue
is the single contract for external callers (``/platform-api``) and for the Data Flow Studio, which will turn
each action into a ``platform.<id>`` node.  Inputs/outputs reuse the node vocabulary of ``dataflow_nodes``
(``param`` / ``port``), so an action spec can be dropped into the node registry unchanged.

Handlers receive an :class:`ActionContext` and a validated ``params`` dict and return a JSON-serialisable dict
whose keys match the declared output ports.  Tables use the dataflow shape ``{"columns": [...], "rows": [{...}]}``.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import html
import io
import json
import re
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import Headers
from fastapi import UploadFile

from app.api.deps import StudentOrTeacher
from app.core.permissions import teacher_can_access_session
from app.models.document_draft import DocumentDraft
from app.models.drive import DriveItem
from app.models.file import File
from app.models.user import User
from app.services.dataflow_nodes import param, port, table_frame
from app.services.slide_sanitizer import sanitize_document_draft_content_json

MAX_TEXT_READ_BYTES = 1024 * 1024
SLIDE_W, SLIDE_H = 960, 540


@dataclass
class ActionContext:
    db: AsyncSession
    teacher: User

    @property
    def actor(self) -> StudentOrTeacher:
        return StudentOrTeacher(teacher=self.teacher)


ActionHandler = Callable[[ActionContext, dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass
class PlatformAction:
    id: str
    domain: str
    label: str
    description: str
    inputs: list[dict[str, Any]]
    outputs: list[dict[str, Any]]
    params: list[dict[str, Any]]
    handler: ActionHandler
    side_effects: str = "none"  # none | creates | modifies | deletes | spends_credits | realtime
    long_running: bool = False

    def spec(self) -> dict[str, Any]:
        """Node-compatible description (see ``dataflow_nodes.spec``) plus API-only metadata."""
        return {
            "id": f"platform.{self.id}", "action": self.id, "domain": self.domain, "label": self.label,
            "category": DOMAINS[self.domain], "description": self.description, "inputs": self.inputs,
            "outputs": self.outputs, "params": self.params, "cachePolicy": "never",
            "sideEffects": self.side_effects, "longRunning": self.long_running,
        }


DOMAINS = {
    "files": "Files (drive)",
    "documents": "Documenti, presentazioni e tabelle",
    "images": "Immagini",
    "models3d": "Modelli 3D",
    "live": "Sessioni live",
}
ACTIONS: dict[str, PlatformAction] = {}


def action(id: str, domain: str, label: str, description: str, *, inputs: list | None = None,
           outputs: list | None = None, params: list | None = None, side_effects: str = "none",
           long_running: bool = False) -> Callable[[ActionHandler], ActionHandler]:
    def register(handler: ActionHandler) -> ActionHandler:
        full_id = f"{domain}.{id}"
        ACTIONS[full_id] = PlatformAction(full_id, domain, label, description, inputs or [], outputs or [],
                                          params or [], handler, side_effects, long_running)
        return handler
    return register


# ── helpers ──────────────────────────────────────────────────────────────────


def _uuid(value: Any, label: str, *, required: bool = True) -> UUID | None:
    text = str(value or "").strip()
    if not text:
        if required:
            raise HTTPException(status_code=422, detail=f"Parametro obbligatorio mancante: {label}")
        return None
    try:
        return UUID(text)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{label} non è un identificatore valido")


def _text(params: dict[str, Any], key: str, default: str = "") -> str:
    value = params.get(key)
    return default if value is None else str(value)


def _table_to_rows(table: Any) -> list[list[str]]:
    """Dataflow table → sheet grid with a header row."""
    frame = table_frame(table)
    return [[str(c) for c in frame.columns]] + [["" if v is None else str(v) for v in row] for row in frame.itertuples(index=False)]


def _rows_to_table(rows: list[list[str]]) -> dict[str, Any]:
    if not rows:
        return {"columns": [], "rows": [], "rowCount": 0}
    header = [str(c) or f"col_{i + 1}" for i, c in enumerate(rows[0])]
    body = [{header[i]: (row[i] if i < len(row) else "") for i in range(len(header))} for row in rows[1:]]
    return {"columns": header, "rows": body, "rowCount": len(body)}


def _grid(params: dict[str, Any]) -> list[list[str]]:
    """Rows from either a connected table or a JSON ``rows`` param (list of lists / list of objects)."""
    if params.get("table"):
        return _table_to_rows(params["table"])[1:] if params.get("skip_header") else _table_to_rows(params["table"])
    raw = params.get("rows")
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(raw)
        except ValueError:
            raise HTTPException(status_code=422, detail="rows non è JSON valido")
    if not raw:
        return []
    if isinstance(raw, list) and all(isinstance(r, dict) for r in raw):
        columns = list(dict.fromkeys(k for r in raw for k in r))
        return [columns] + [[str(r.get(c, "")) for c in columns] for r in raw]
    if isinstance(raw, list) and all(isinstance(r, list) for r in raw):
        return [[str(v) for v in r] for r in raw]
    raise HTTPException(status_code=422, detail="rows deve essere una lista di liste o di oggetti")


def _drive_api():
    from app.api.v1.endpoints import drive
    return drive


async def _drive_item(ctx: ActionContext, item_id: UUID) -> dict[str, Any]:
    return await _drive_api().get_item(item_id, ctx.db, ctx.actor)


async def _place_in_drive(ctx: ActionContext, draft_id: UUID, parent_id: UUID | None) -> dict[str, Any] | None:
    """Mirror a new draft into the drive (it is normally synced lazily) and optionally move it into a folder."""
    from app.services import drive_service as drive
    await drive.sync_teacher_drive(ctx.db, ctx.teacher, force=True)
    item = (await ctx.db.execute(
        select(DriveItem).where(DriveItem.owner_teacher_id == ctx.teacher.id, DriveItem.system_key == f"doc:{draft_id}")
    )).scalar_one_or_none()
    if item is None:
        return None
    if parent_id is not None:
        await _drive_api().move_items(_drive_api().MoveRequest(ids=[item.id], parent_id=parent_id), ctx.db, ctx.actor)
        await ctx.db.refresh(item)
    return {"drive_item_id": str(item.id)}


async def _own_draft(ctx: ActionContext, draft_id: UUID, expected: str | None = None) -> DocumentDraft:
    draft = (await ctx.db.execute(
        select(DocumentDraft).where(DocumentDraft.id == draft_id, DocumentDraft.owner_teacher_id == ctx.teacher.id)
    )).scalar_one_or_none()
    if draft is None:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    if expected and draft.doc_type != expected:
        raise HTTPException(status_code=400, detail=f"Il documento è di tipo «{draft.doc_type}», non «{expected}»")
    return draft


async def _create_draft(ctx: ActionContext, *, title: str, doc_type: str, content: dict[str, Any],
                        parent_id: Any = None, session_id: Any = None) -> dict[str, Any]:
    from app.api.v1.endpoints.teacher import _snapshot_document_draft
    session_uuid = _uuid(session_id, "session_id", required=False)
    if session_uuid and not await teacher_can_access_session(ctx.db, ctx.teacher, session_uuid):
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    title = (title or "").strip()[:200] or {"document": "Documento", "presentation": "Presentazione", "sheet": "Tabella"}[doc_type]
    draft = DocumentDraft(
        tenant_id=ctx.teacher.tenant_id, session_id=session_uuid, owner_teacher_id=ctx.teacher.id, title=title,
        doc_type=doc_type, content_json=sanitize_document_draft_content_json(json.dumps(content, ensure_ascii=False)),
    )
    ctx.db.add(draft)
    await ctx.db.flush()
    await _snapshot_document_draft(ctx.db, draft, label="Creato da flusso", force=True)
    await ctx.db.commit()
    await ctx.db.refresh(draft)
    placed = await _place_in_drive(ctx, draft.id, _uuid(parent_id, "parent_id", required=False)) or {}
    return {"document_id": str(draft.id), "title": draft.title, "doc_type": doc_type, **placed}


async def _save_content(ctx: ActionContext, draft: DocumentDraft, content: dict[str, Any]) -> None:
    from app.api.v1.endpoints.teacher import _snapshot_document_draft
    await _snapshot_document_draft(ctx.db, draft, label="Modificato da flusso")
    draft.content_json = sanitize_document_draft_content_json(json.dumps(content, ensure_ascii=False))
    await ctx.db.commit()
    await ctx.db.refresh(draft)


def _content(draft: DocumentDraft) -> dict[str, Any]:
    try:
        value = json.loads(draft.content_json)
    except ValueError:
        value = {}
    return value if isinstance(value, dict) else {}


def _plain_to_html(text: str) -> str:
    paragraphs = [p for p in re.split(r"\n{2,}", text.strip()) if p.strip()] or [""]
    return "".join(f"<p>{html.escape(p).replace(chr(10), '<br>')}</p>" for p in paragraphs)


def _slide(spec: dict[str, Any]) -> dict[str, Any]:
    """Build a native slide from ``{title, body|bullets, notes?, image?}`` laid out on the 960×540 canvas."""
    title = str(spec.get("title") or "").strip()
    bullets = spec.get("bullets")
    body = "\n".join(str(b) for b in bullets) if isinstance(bullets, list) else str(spec.get("body") or "")
    blocks: list[dict[str, Any]] = []
    if title:
        blocks.append({"id": str(uuid.uuid4()), "type": "text", "content": f"<p>{html.escape(title)}</p>", "x": 60, "y": 36,
                       "width": 840, "height": 80, "style": {"fontSize": 40, "fontWeight": "bold", "color": "#1a1a2e", "textAlign": "left", "lineHeight": 1.2}})
    image = str(spec.get("image") or "")
    if body.strip():
        items = [line for line in body.splitlines() if line.strip()]
        listed = isinstance(bullets, list) or len(items) > 1
        content = "".join(f"<p>{'• ' if listed else ''}{html.escape(line.strip())}</p>" for line in items)
        blocks.append({"id": str(uuid.uuid4()), "type": "text", "content": content, "x": 60, "y": 140,
                       "width": 520 if image else 840, "height": 360, "style": {"fontSize": 24, "color": "#2d2d2d", "textAlign": "left", "lineHeight": 1.4}})
    if image.startswith("data:image/"):
        blocks.append({"id": str(uuid.uuid4()), "type": "image", "content": image, "x": 610, "y": 140, "width": 290, "height": 290, "style": {}})
    slide: dict[str, Any] = {"id": str(uuid.uuid4()), "title": title or "Slide", "blocks": blocks}
    if spec.get("notes"):
        slide["notes"] = str(spec["notes"])
    return slide


def _slides_param(params: dict[str, Any]) -> list[dict[str, Any]]:
    raw = params.get("slides")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else []
        except ValueError:
            raise HTTPException(status_code=422, detail="slides non è JSON valido")
    if not isinstance(raw, list) or not all(isinstance(s, dict) for s in raw):
        raise HTTPException(status_code=422, detail='slides deve essere una lista di oggetti {"title", "body"|"bullets", "notes"?, "image"?}')
    return [_slide(s) for s in raw]


def _decode_b64(data: str) -> bytes:
    data = re.sub(r"^data:[^;]+;base64,", "", data.strip())
    try:
        return base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="Contenuto base64 non valido")


# ── FILES ────────────────────────────────────────────────────────────────────

PARENT = param("parent_id", "STRING", "Cartella (ID, vuoto = radice del drive)", "", required=False)
ITEM = param("item_id", "STRING", "ID elemento del drive", "")
ITEM_IN = port("item_id", "ANY", "ID elemento", required=False)
FILE_OUT = [port("item_id", "ANY", "ID elemento"), port("item", "ANY", "Elemento")]


@action("list", "files", "Elenca file e cartelle", "Elenca il contenuto di una cartella del drive (o cerca per nome).",
        params=[PARENT, param("query", "STRING", "Cerca per nome", "", required=False)],
        outputs=[port("items", "ANY", "Elementi"), port("table", "TABLE", "Tabella elementi")])
async def files_list(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    q = _text(p, "query").strip()
    result = await _drive_api().list_items(ctx.db, ctx.actor, "search" if q else "folder", _uuid(p.get("parent_id"), "parent_id", required=False), q or None, False)
    items = result.get("items", [])
    columns = ["id", "name", "kind", "mime_type", "size_bytes"]
    return {"items": items, "table": {"columns": columns, "rows": [{c: i.get(c) for c in columns} for i in items], "rowCount": len(items)}}


@action("read_text", "files", "Leggi file di testo", "Restituisce il contenuto testuale (UTF-8, max 1 MB) di un file del drive: txt, md, csv, json…",
        params=[ITEM], inputs=[ITEM_IN], outputs=[port("text", "ANY", "Testo"), port("item", "ANY", "Elemento")])
async def files_read_text(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    drive = _drive_api()
    item_id = _uuid(p.get("item_id"), "item_id")
    meta = await _drive_item(ctx, item_id)
    item = await drive._load(ctx.db, item_id)
    if item.kind != "file":
        raise HTTPException(status_code=400, detail="Per documenti, presentazioni e tabelle usa le azioni «documents.*»")
    data, _ = await drive._file_bytes(ctx.db, item)
    if len(data) > MAX_TEXT_READ_BYTES:
        raise HTTPException(status_code=413, detail="File troppo grande per la lettura testuale (max 1 MB)")
    return {"text": data.decode("utf-8", errors="replace"), "item": meta}


async def _store_file(ctx: ActionContext, name: str, data: bytes, mime: str | None, parent_id: UUID | None) -> dict[str, Any]:
    upload = UploadFile(file=io.BytesIO(data), filename=name, headers=Headers({"content-type": mime or "application/octet-stream"}))
    result = await _drive_api().upload(ctx.db, ctx.actor, [upload], parent_id, None)
    item = result["items"][0]
    return {"item_id": item["id"], "item": item}


@action("write", "files", "Crea o scrivi file", "Crea un nuovo file nel drive, oppure — indicando l'ID di un file esistente — ne sovrascrive il contenuto. Il contenuto è testo, oppure base64 con «Codifica = base64».",
        params=[param("name", "STRING", "Nome file (es. nota.md)", "nota.txt"), param("content", "CODE", "Contenuto", ""),
                param("encoding", "SELECT", "Codifica", "text", options=["text", "base64"]),
                param("mime_type", "STRING", "Tipo MIME (opzionale)", "", required=False), PARENT,
                param("overwrite_item_id", "STRING", "ID file da sovrascrivere (opzionale)", "", required=False)],
        inputs=[port("content", "ANY", "Contenuto", required=False)], outputs=FILE_OUT, side_effects="creates")
async def files_write(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    raw = p.get("content")
    raw = json.dumps(raw, ensure_ascii=False) if isinstance(raw, (dict, list)) else _text(p, "content")
    data = _decode_b64(raw) if _text(p, "encoding", "text") == "base64" else raw.encode("utf-8")
    overwrite = _uuid(p.get("overwrite_item_id"), "overwrite_item_id", required=False)
    if overwrite is None:
        name = _text(p, "name").strip()
        if not name:
            raise HTTPException(status_code=422, detail="Indica il nome del file")
        return await _store_file(ctx, name, data, _text(p, "mime_type") or None, _uuid(p.get("parent_id"), "parent_id", required=False))
    drive = _drive_api()
    from app.services import drive_service
    principal = await drive._principal(ctx.db, ctx.actor)
    item = await drive._load(ctx.db, overwrite)
    await drive._require(ctx.db, principal, item, "editor")
    stored = await ctx.db.get(File, item.file_id) if item.kind == "file" and item.file_id else None
    if stored is None:
        raise HTTPException(status_code=400, detail="L'elemento non è un file sovrascrivibile")
    from app.core.config import settings
    if len(data) > settings.DRIVE_MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Supera il limite di {settings.DRIVE_MAX_UPLOAD_MB} MB")
    import asyncio
    await asyncio.to_thread(drive_service.write_blob, stored.storage_key, data)
    stored.size_bytes = item.size_bytes = len(data)
    stored.checksum_sha256 = hashlib.sha256(data).hexdigest()
    await ctx.db.commit()
    await ctx.db.refresh(item)
    return {"item_id": str(item.id), "item": await _drive_item(ctx, item.id)}


@action("mkdir", "files", "Crea cartella", "Crea una cartella nel drive.",
        params=[param("name", "STRING", "Nome cartella", "Nuova cartella"), PARENT], outputs=FILE_OUT, side_effects="creates")
async def files_mkdir(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    drive = _drive_api()
    item = await drive.create_folder(drive.FolderCreate(name=_text(p, "name"), parent_id=_uuid(p.get("parent_id"), "parent_id", required=False)), ctx.db, ctx.actor)
    return {"item_id": item["id"], "item": item}


def _ids(p: dict[str, Any]) -> list[UUID]:
    raw = p.get("item_ids") or p.get("item_id")
    if isinstance(raw, str):
        raw = [s for s in re.split(r"[\s,;]+", raw) if s]
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=422, detail="Indica almeno un elemento")
    return [_uuid(v, "item_id") for v in raw]


IDS = param("item_ids", "STRING", "ID elementi (separati da virgola)", "")


@action("move", "files", "Sposta elementi", "Sposta file/cartelle in un'altra cartella (vuoto = radice).", params=[IDS, PARENT],
        inputs=[ITEM_IN], outputs=[port("moved", "ANY", "Numero spostati")], side_effects="modifies")
async def files_move(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    drive = _drive_api()
    result = await drive.move_items(drive.MoveRequest(ids=_ids(p), parent_id=_uuid(p.get("parent_id"), "parent_id", required=False)), ctx.db, ctx.actor)
    return {"moved": result["moved"]}


@action("rename", "files", "Rinomina elemento", "Rinomina un file, una cartella o un documento (anche sulla piattaforma).",
        params=[ITEM, param("name", "STRING", "Nuovo nome", "")], inputs=[ITEM_IN], outputs=FILE_OUT, side_effects="modifies")
async def files_rename(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    drive = _drive_api()
    item = await drive.update_item(_uuid(p.get("item_id"), "item_id"), drive.ItemUpdate(name=_text(p, "name")), ctx.db, ctx.actor)
    return {"item_id": item["id"], "item": item}


@action("trash", "files", "Sposta nel cestino", "Sposta elementi nel cestino (recuperabili).", params=[IDS], inputs=[ITEM_IN],
        outputs=[port("trashed", "ANY", "Numero eliminati")], side_effects="deletes")
async def files_trash(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    drive = _drive_api()
    return {"trashed": (await drive.trash(drive.ItemIds(ids=_ids(p)), ctx.db, ctx.actor))["trashed"]}


@action("restore", "files", "Ripristina dal cestino", "Ripristina elementi dal cestino.", params=[IDS], outputs=[port("restored", "ANY", "Numero ripristinati")], side_effects="modifies")
async def files_restore(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    drive = _drive_api()
    return {"restored": (await drive.restore(drive.ItemIds(ids=_ids(p)), ctx.db, ctx.teacher))["restored"]}


@action("delete", "files", "Elimina definitivamente", "Elimina per sempre elementi già nel cestino. Irreversibile.", params=[IDS],
        outputs=[port("deleted", "ANY", "Numero eliminati")], side_effects="deletes")
async def files_delete(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    drive = _drive_api()
    return {"deleted": (await drive.purge(drive.ItemIds(ids=_ids(p)), ctx.db, ctx.teacher))["deleted"]}


# ── DOCUMENTS (document | presentation | sheet) ──────────────────────────────

SESSION = param("session_id", "STRING", "Sessione collegata (opzionale)", "", required=False)
TITLE = param("title", "STRING", "Titolo", "")
DOC_ID = param("document_id", "STRING", "ID documento", "")
DOC_ID_IN = port("document_id", "ANY", "ID documento", required=False)
DOC_OUT = [port("document_id", "ANY", "ID documento"), port("drive_item_id", "ANY", "ID nel drive")]


@action("list", "documents", "Elenca documenti", "Elenca documenti, presentazioni e tabelle del docente.",
        params=[param("doc_type", "SELECT", "Tipo", "", options=["", "document", "presentation", "sheet"], required=False), SESSION],
        outputs=[port("table", "TABLE", "Elenco")])
async def documents_list(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    query = select(DocumentDraft).where(DocumentDraft.owner_teacher_id == ctx.teacher.id).order_by(DocumentDraft.updated_at.desc()).limit(200)
    if _text(p, "doc_type"):
        query = query.where(DocumentDraft.doc_type == _text(p, "doc_type"))
    if sid := _uuid(p.get("session_id"), "session_id", required=False):
        query = query.where(DocumentDraft.session_id == sid)
    rows = [{"id": str(d.id), "title": d.title, "doc_type": d.doc_type, "updated_at": d.updated_at.isoformat()}
            for d in (await ctx.db.execute(query)).scalars().all()]
    return {"table": {"columns": ["id", "title", "doc_type", "updated_at"], "rows": rows, "rowCount": len(rows)}}


@action("create_document", "documents", "Crea documento di testo", "Crea un documento (word processor). Il contenuto può essere HTML oppure testo semplice (paragrafi separati da riga vuota).",
        params=[TITLE, param("content", "CODE", "Contenuto", ""), param("format", "SELECT", "Formato contenuto", "text", options=["text", "html"]), PARENT, SESSION],
        inputs=[port("content", "ANY", "Contenuto", required=False), port("table", "TABLE", "Tabella da inserire (opzionale)", required=False)], outputs=DOC_OUT, side_effects="creates")
async def documents_create_document(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    raw = _text(p, "content")
    body = raw if _text(p, "format", "text") == "html" else _plain_to_html(raw)
    if isinstance(p.get("table"), dict) and p["table"].get("rows"):
        body += _table_html(p["table"])
    return await _create_draft(ctx, title=_text(p, "title"), doc_type="document", content={"type": "document_v1", "htmlContent": body},
                               parent_id=p.get("parent_id"), session_id=p.get("session_id"))


@action("create_presentation", "documents", "Crea presentazione", 'Crea una presentazione 16:9. «slides» è una lista JSON di {"title", "body" | "bullets": [...], "notes"?, "image"?: "data:image/png;base64,…"}.',
        params=[TITLE, param("slides", "CODE", "Slide (JSON)", '[{"title": "Titolo", "bullets": ["Punto 1", "Punto 2"]}]'), PARENT, SESSION],
        inputs=[port("slides", "ANY", "Slide", required=False)], outputs=DOC_OUT, side_effects="creates")
async def documents_create_presentation(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    slides = _slides_param(p) or [_slide({"title": _text(p, "title")})]
    return await _create_draft(ctx, title=_text(p, "title"), doc_type="presentation", content={"type": "presentation_v2", "format": "16:9", "slides": slides},
                               parent_id=p.get("parent_id"), session_id=p.get("session_id"))


@action("create_sheet", "documents", "Crea tabella (foglio di calcolo)", "Crea un foglio di calcolo da una tabella collegata, oppure da «rows» (JSON: lista di liste o di oggetti; con oggetti la prima riga è l'intestazione).",
        params=[TITLE, param("sheet_name", "STRING", "Nome foglio", "Foglio 1"), param("rows", "CODE", "Righe (JSON, opzionale)", "", required=False), PARENT, SESSION],
        inputs=[port("table", "TABLE", "Tabella", required=False)], outputs=DOC_OUT, side_effects="creates")
async def documents_create_sheet(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    grid = _grid(p) or [[""]]
    return await _create_draft(ctx, title=_text(p, "title"), doc_type="sheet",
                               content={"type": "sheet_v1", "data": grid, "sheetName": _text(p, "sheet_name", "Foglio 1")},
                               parent_id=p.get("parent_id"), session_id=p.get("session_id"))


@action("read", "documents", "Leggi documento", "Legge un documento, una presentazione o una tabella. Restituisce testo/HTML, slide o tabella a seconda del tipo.",
        params=[DOC_ID], inputs=[DOC_ID_IN],
        outputs=[port("title", "ANY", "Titolo"), port("doc_type", "ANY", "Tipo"), port("text", "ANY", "Testo"), port("html", "ANY", "HTML"),
                 port("slides", "ANY", "Slide"), port("table", "TABLE", "Tabella")])
async def documents_read(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    draft = await _own_draft(ctx, _uuid(p.get("document_id"), "document_id"))
    c = _content(draft)
    out: dict[str, Any] = {"title": draft.title, "doc_type": draft.doc_type}
    if draft.doc_type == "sheet":
        out["table"] = _rows_to_table(c.get("data") or [])
    elif draft.doc_type == "presentation":
        out["slides"] = [{"title": s.get("title", ""), "text": "\n".join(re.sub(r"<[^>]+>", " ", str(b.get("content", ""))).strip()
                          for b in s.get("blocks", []) if b.get("type") == "text"), "notes": s.get("notes", "")} for s in c.get("slides", [])]
        out["text"] = "\n\n".join(f"# {s['title']}\n{s['text']}" for s in out["slides"])
    else:
        out["html"] = str(c.get("htmlContent") or c.get("content") or "")
        out["text"] = re.sub(r"\s+\n", "\n", re.sub(r"<(br|/p|/h\d|/li)[^>]*>", "\n", out["html"]))
        out["text"] = html.unescape(re.sub(r"<[^>]+>", "", out["text"])).strip()
    return out


@action("update_document", "documents", "Scrivi nel documento", "Sostituisce o aggiunge in coda contenuto a un documento di testo.",
        params=[DOC_ID, param("content", "CODE", "Contenuto", ""), param("format", "SELECT", "Formato contenuto", "text", options=["text", "html"]),
                param("mode", "SELECT", "Modalità", "append", options=["append", "replace"])],
        inputs=[DOC_ID_IN, port("content", "ANY", "Contenuto", required=False)], outputs=[port("document_id", "ANY", "ID documento")], side_effects="modifies")
async def documents_update_document(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    draft = await _own_draft(ctx, _uuid(p.get("document_id"), "document_id"), "document")
    raw = _text(p, "content")
    fragment = raw if _text(p, "format", "text") == "html" else _plain_to_html(raw)
    c = _content(draft)
    base = "" if _text(p, "mode", "append") == "replace" else str(c.get("htmlContent") or "")
    await _save_content(ctx, draft, {**c, "type": "document_v1", "htmlContent": base + fragment})
    return {"document_id": str(draft.id)}


@action("add_slides", "documents", "Aggiungi slide", "Aggiunge slide in coda (o alla posizione indicata) a una presentazione.",
        params=[DOC_ID, param("slides", "CODE", "Slide (JSON)", '[{"title": "Nuova slide", "body": "Testo"}]'),
                param("position", "INTEGER", "Posizione (0 = in testa, vuoto = in coda)", None, required=False)],
        inputs=[DOC_ID_IN, port("slides", "ANY", "Slide", required=False)], outputs=[port("document_id", "ANY", "ID documento"), port("slide_count", "ANY", "Numero slide")], side_effects="modifies")
async def documents_add_slides(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    draft = await _own_draft(ctx, _uuid(p.get("document_id"), "document_id"), "presentation")
    c = _content(draft)
    slides = list(c.get("slides") or [])
    new = _slides_param(p)
    at = p.get("position")
    at = len(slides) if at in (None, "") else max(0, min(int(at), len(slides)))
    slides[at:at] = new
    await _save_content(ctx, draft, {**c, "slides": slides})
    return {"document_id": str(draft.id), "slide_count": len(slides)}


@action("sheet_append_rows", "documents", "Aggiungi righe alla tabella", "Accoda righe a un foglio di calcolo, da una tabella collegata o da «rows». Con «Salta intestazione» la prima riga non viene scritta (utile per tabelle che hanno già l'intestazione).",
        params=[DOC_ID, param("rows", "CODE", "Righe (JSON, opzionale)", "", required=False), param("skip_header", "BOOLEAN", "Salta intestazione della tabella collegata", True)],
        inputs=[DOC_ID_IN, port("table", "TABLE", "Tabella", required=False)], outputs=[port("document_id", "ANY", "ID documento"), port("row_count", "ANY", "Righe totali")], side_effects="modifies")
async def documents_sheet_append_rows(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    draft = await _own_draft(ctx, _uuid(p.get("document_id"), "document_id"), "sheet")
    c = _content(draft)
    data = [list(r) for r in (c.get("data") or [])]
    while data and not any(str(v) for v in data[-1]):
        data.pop()
    data.extend(_grid(p))
    await _save_content(ctx, draft, {**c, "type": "sheet_v1", "data": data})
    return {"document_id": str(draft.id), "row_count": len(data)}


@action("sheet_write_cells", "documents", "Scrivi celle", 'Scrive singole celle di un foglio. «cells» è JSON: [{"row": 0, "col": 0, "value": "x"}] (indici da 0) oppure [{"ref": "B3", "value": "x"}].',
        params=[DOC_ID, param("cells", "CODE", "Celle (JSON)", '[{"ref": "A1", "value": "Ciao"}]')],
        inputs=[DOC_ID_IN], outputs=[port("document_id", "ANY", "ID documento"), port("written", "ANY", "Celle scritte")], side_effects="modifies")
async def documents_sheet_write_cells(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    draft = await _own_draft(ctx, _uuid(p.get("document_id"), "document_id"), "sheet")
    raw = p.get("cells")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise HTTPException(status_code=422, detail="cells non è JSON valido")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=422, detail="cells deve essere una lista non vuota")
    c = _content(draft)
    data = [list(r) for r in (c.get("data") or [[""]])]
    for cell in raw:
        if "ref" in cell:
            m = re.fullmatch(r"([A-Za-z]{1,3})(\d{1,4})", str(cell["ref"]).strip())
            if not m:
                raise HTTPException(status_code=422, detail=f"Riferimento cella non valido: {cell['ref']}")
            col = 0
            for ch in m.group(1).upper():
                col = col * 26 + ord(ch) - 64
            row, col = int(m.group(2)) - 1, col - 1
        else:
            row, col = int(cell.get("row", -1)), int(cell.get("col", -1))
        if not (0 <= row < 1000 and 0 <= col < 100):
            raise HTTPException(status_code=422, detail="Cella fuori dai limiti (max 1000 righe × 100 colonne)")
        while len(data) <= row:
            data.append([])
        data[row] += [""] * (col + 1 - len(data[row]))
        data[row][col] = "" if cell.get("value") is None else str(cell["value"])
    await _save_content(ctx, draft, {**c, "type": "sheet_v1", "data": data})
    return {"document_id": str(draft.id), "written": len(raw)}


@action("rename", "documents", "Rinomina documento", "Cambia il titolo di un documento, presentazione o tabella.",
        params=[DOC_ID, param("title", "STRING", "Nuovo titolo", "")], inputs=[DOC_ID_IN], outputs=[port("document_id", "ANY", "ID documento")], side_effects="modifies")
async def documents_rename(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    draft = await _own_draft(ctx, _uuid(p.get("document_id"), "document_id"))
    title = _text(p, "title").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Titolo vuoto")
    draft.title = title[:200]
    item = (await ctx.db.execute(select(DriveItem).where(DriveItem.owner_teacher_id == ctx.teacher.id, DriveItem.source_id == draft.id))).scalars().first()
    if item:
        item.name = draft.title
    await ctx.db.commit()
    return {"document_id": str(draft.id)}


@action("trash", "documents", "Cestina documento", "Sposta un documento nel cestino del drive (recuperabile).",
        params=[DOC_ID], inputs=[DOC_ID_IN], outputs=[port("trashed", "ANY", "Numero eliminati")], side_effects="deletes")
async def documents_trash(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    draft = await _own_draft(ctx, _uuid(p.get("document_id"), "document_id"))
    await _place_in_drive(ctx, draft.id, None)  # make sure the drive row exists
    item = (await ctx.db.execute(select(DriveItem).where(DriveItem.owner_teacher_id == ctx.teacher.id, DriveItem.source_id == draft.id))).scalars().first()
    if item is None:
        raise HTTPException(status_code=404, detail="Elemento del drive non trovato")
    drive = _drive_api()
    return {"trashed": (await drive.trash(drive.ItemIds(ids=[item.id]), ctx.db, ctx.actor))["trashed"]}


# ── IMAGES ───────────────────────────────────────────────────────────────────


@action("generate", "images", "Genera immagine", "Genera un'immagine con il generatore di piattaforma (stesso provider, crediti e limiti del generatore immagini). Opzionalmente la salva nel drive.",
        params=[param("prompt", "CODE", "Descrizione", ""), param("size", "SELECT", "Dimensione", "1024x1024", options=["1024x1024", "1536x1024", "1024x1536"]),
                param("quality", "SELECT", "Qualità", "standard", options=["standard", "high"]),
                param("style", "SELECT", "Stile", "natural", options=["natural", "vivid"]),
                param("save_to_drive", "BOOLEAN", "Salva nel drive", False), param("filename", "STRING", "Nome file (se salvata)", "immagine.png", required=False), PARENT],
        inputs=[port("prompt", "ANY", "Descrizione", required=False)],
        outputs=[port("image_data", "ANY", "Immagine (base64)"), port("image_mime", "ANY", "Tipo MIME"), port("data_uri", "ANY", "Data URI"),
                 port("revised_prompt", "ANY", "Prompt rivisto"), port("item_id", "ANY", "ID nel drive", required=False)],
        side_effects="spends_credits")
async def images_generate(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints import meshy
    result = await meshy.generate_image({k: p[k] for k in ("prompt", "size", "quality", "style") if p.get(k)}, ctx.actor, ctx.db)
    out = {**result, "data_uri": f"data:{result['image_mime']};base64,{result['image_data']}"}
    if p.get("save_to_drive"):
        name = _text(p, "filename", "immagine.png").strip() or "immagine.png"
        stored = await _store_file(ctx, name, base64.b64decode(result["image_data"]), result["image_mime"], _uuid(p.get("parent_id"), "parent_id", required=False))
        out["item_id"] = stored["item_id"]
    return out


# ── 3D MODELS ────────────────────────────────────────────────────────────────

MESHY_OPTIONS = [
    param("ai_model", "SELECT", "Modello Meshy", "meshy-7.1", options=["meshy-6-lite", "meshy-6", "meshy-7.1", "latest"]),
    param("model_type", "SELECT", "Topologia", "standard", options=["standard", "smart-topology"]),
    param("target_polycount", "INTEGER", "Poligoni obiettivo", 30000, min=100, max=300000),
]
TASK_OUT = [port("task_id", "ANY", "ID task Meshy"), port("job_id", "ANY", "ID job in background"), port("task_type", "ANY", "text | image")]


@action("generate_from_text", "models3d", "Genera modello 3D da testo", "Avvia la generazione di un modello 3D con Meshy (stesso provider e crediti del 3D Lab). Asincrona: restituisce un task_id da interrogare con «models3d.status»; il progresso compare anche nell'indicatore job della navbar.",
        params=[param("prompt", "CODE", "Descrizione (max 800 caratteri)", ""), *MESHY_OPTIONS],
        inputs=[port("prompt", "ANY", "Descrizione", required=False)], outputs=TASK_OUT, side_effects="spends_credits", long_running=True)
async def models3d_from_text(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints import meshy
    payload = {k: v for k, v in p.items() if v not in (None, "")}
    payload.pop("image_data", None)
    return await meshy._start_meshy_generation(payload, ctx.actor, ctx.db)


@action("generate_from_image", "models3d", "Genera modello 3D da immagine", "Come «da testo», partendo da un'immagine di riferimento (base64, oppure l'ID di un file immagine del drive).",
        params=[param("image_data", "CODE", "Immagine base64 (opzionale se indichi un file)", "", required=False),
                param("image_item_id", "STRING", "ID file immagine nel drive", "", required=False),
                param("image_mime", "STRING", "Tipo MIME", "image/png", required=False),
                param("prompt", "CODE", "Prompt texture (opzionale)", "", required=False), *MESHY_OPTIONS],
        inputs=[port("image_data", "ANY", "Immagine (base64)", required=False)], outputs=TASK_OUT, side_effects="spends_credits", long_running=True)
async def models3d_from_image(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints import meshy
    payload = {k: v for k, v in p.items() if v not in (None, "")}
    if not payload.get("image_data"):
        drive = _drive_api()
        item = await drive._load(ctx.db, _uuid(p.get("image_item_id"), "image_item_id"))
        data, mime = await drive._file_bytes(ctx.db, item)
        payload["image_data"], payload["image_mime"] = base64.b64encode(data).decode("ascii"), mime
    else:
        payload["image_data"] = re.sub(r"^data:[^;]+;base64,", "", str(payload["image_data"]))
    return await meshy._start_meshy_generation(payload, ctx.actor, ctx.db)


@action("status", "models3d", "Stato generazione 3D", "Interroga un task Meshy. «status» vale PENDING, IN_PROGRESS, SUCCEEDED, FAILED…; a successo «model_urls» contiene i link ai formati (glb, obj, stl…).",
        params=[param("task_id", "STRING", "ID task Meshy", ""), param("task_type", "SELECT", "Tipo", "text", options=["text", "image"])],
        inputs=[port("task_id", "ANY", "ID task", required=False)],
        outputs=[port("status", "ANY", "Stato"), port("progress", "ANY", "Avanzamento %"), port("model_urls", "ANY", "URL dei modelli"), port("raw", "ANY", "Risposta completa")])
async def models3d_status(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints import meshy
    task_id = _text(p, "task_id").strip()
    if not task_id:
        raise HTTPException(status_code=422, detail="Indica il task_id")
    fetch = meshy.get_text_to_3d_status if _text(p, "task_type", "text") == "text" else meshy.get_image_to_3d_status
    raw = await fetch(task_id, ctx.actor)
    return {"status": raw.get("status"), "progress": raw.get("progress"), "model_urls": raw.get("model_urls") or {}, "raw": raw}


@action("wait", "models3d", "Attendi risultato 3D", "Attende (polling ogni 5 s) che un task Meshy termini: utile in un flusso per usare il modello subito dopo la generazione. Errore se il task fallisce o scade il tempo.",
        params=[param("task_id", "STRING", "ID task Meshy", ""), param("task_type", "SELECT", "Tipo", "text", options=["text", "image"]),
                param("timeout_seconds", "INTEGER", "Attesa massima (secondi)", 300, min=10, max=900)],
        inputs=[port("task_id", "ANY", "ID task", required=False)],
        outputs=[port("status", "ANY", "Stato"), port("model_urls", "ANY", "URL dei modelli"), port("raw", "ANY", "Risposta completa")], long_running=True)
async def models3d_wait(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    import asyncio
    deadline = min(900, max(10, int(p.get("timeout_seconds") or 300)))
    waited = 0
    while True:
        out = await models3d_status(ctx, p)
        state = str(out.get("status") or "").upper()
        if state == "SUCCEEDED":
            return {"status": state, "model_urls": out["model_urls"], "raw": out["raw"]}
        if state in ("FAILED", "EXPIRED", "CANCELED"):
            raise HTTPException(status_code=502, detail=f"Generazione 3D {state.lower()}")
        if waited >= deadline:
            raise HTTPException(status_code=504, detail=f"Il modello non è pronto dopo {deadline} secondi (stato: {state or 'sconosciuto'})")
        await asyncio.sleep(5)
        waited += 5


@action("save_to_drive", "models3d", "Salva modello 3D nel drive", "Scarica il modello generato da Meshy nel formato scelto e lo salva come file nel drive.",
        params=[param("task_id", "STRING", "ID task Meshy", ""), param("task_type", "SELECT", "Tipo", "text", options=["text", "image"]),
                param("format", "SELECT", "Formato", "glb", options=["glb", "obj", "stl", "fbx", "usdz"]),
                param("filename", "STRING", "Nome file", "modello", required=False), PARENT],
        inputs=[port("task_id", "ANY", "ID task", required=False)], outputs=FILE_OUT, side_effects="creates")
async def models3d_save(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    import httpx
    from app.api.v1.endpoints import meshy
    fmt = _text(p, "format", "glb")
    status = await models3d_status(ctx, p)
    if str(status.get("status") or "").upper() != "SUCCEEDED":
        raise HTTPException(status_code=409, detail="Il modello non è ancora pronto: usa prima «Attendi risultato 3D»")
    url = (status["model_urls"] or {}).get(fmt)
    if not url:
        raise HTTPException(status_code=404, detail=f"Formato {fmt} non disponibile per questo modello")
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        data = await meshy._download_meshy_asset(client, url, meshy.MAX_SHARED_MODEL_BYTES)
    if not data:
        raise HTTPException(status_code=502, detail="Download del modello non riuscito")
    name = (_text(p, "filename", "modello").strip() or "modello")
    name = name if name.lower().endswith(f".{fmt}") else f"{name}.{fmt}"
    mime = "model/gltf-binary" if fmt == "glb" else "application/octet-stream"
    return await _store_file(ctx, name, data, mime, _uuid(p.get("parent_id"), "parent_id", required=False))


@action("list_projects", "models3d", "Elenca progetti 3D", "Elenca i progetti dell'editor solido (Tinkercad-like) del docente.", outputs=[port("table", "TABLE", "Progetti")])
async def models3d_list(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints import solid_modeler
    items = await solid_modeler.list_models(ctx.actor, ctx.db)
    columns = list(items[0].keys()) if items else ["id", "name"]
    return {"table": {"columns": columns, "rows": items, "rowCount": len(items)}}


@action("create_project", "models3d", "Crea progetto 3D", 'Crea un progetto nell\'editor solido. «scene» è la lista JSON di oggetti della scena (vuota = progetto vuoto).',
        params=[param("name", "STRING", "Nome progetto", "Nuovo progetto"), param("scene", "CODE", "Scena (JSON)", "[]", required=False)],
        outputs=[port("model_id", "ANY", "ID progetto"), port("project", "ANY", "Progetto")], side_effects="creates")
async def models3d_create(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints import solid_modeler
    scene = p.get("scene") or []
    if isinstance(scene, str):
        try:
            scene = json.loads(scene) if scene.strip() else []
        except ValueError:
            raise HTTPException(status_code=422, detail="scene non è JSON valido")
    project = await solid_modeler.create_model(solid_modeler.ModelSaveRequest(name=_text(p, "name") or None, scene=scene), ctx.actor, ctx.db)
    return {"model_id": project["id"], "project": project}


# ── LIVE SESSIONS ────────────────────────────────────────────────────────────

LIVE_ID = param("interaction_id", "STRING", "ID sessione live", "")
LIVE_ID_IN = port("interaction_id", "ANY", "ID sessione live", required=False)


def _live():
    from app.api.v1.endpoints import live_interaction
    return live_interaction


@action("list", "live", "Elenca sessioni live", "Elenca le sessioni live di una sessione di lavoro.", params=[param("session_id", "STRING", "ID sessione di lavoro", "")],
        outputs=[port("table", "TABLE", "Elenco"), port("items", "ANY", "Elementi")])
async def live_list(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    items = await _live().list_live_interactions(str(_uuid(p.get("session_id"), "session_id")), ctx.db, ctx.teacher)
    columns = ["id", "title", "interaction_type", "status", "slides_count"]
    return {"items": items, "table": {"columns": columns, "rows": [{c: i[c] for c in columns} for i in items], "rowCount": len(items)}}


@action("create", "live", "Crea sessione live", 'Crea una sessione live interattiva. «slides» è JSON: lista di {"type": "mcq", "question", "options": [..], "correct_option": 0} | {"type": "wordwall"|"opinion"|"feedback", "prompt"}.',
        params=[param("session_id", "STRING", "ID sessione di lavoro", ""), TITLE, param("slides", "CODE", "Slide (JSON)", '[{"type": "mcq", "question": "Domanda?", "options": ["A", "B"], "correct_option": 0}]')],
        inputs=[port("slides", "ANY", "Slide", required=False)], outputs=[port("interaction_id", "ANY", "ID sessione live"), port("status", "ANY", "Stato")], side_effects="creates")
async def live_create(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
    live = _live()
    slides = p.get("slides") or []
    if isinstance(slides, str):
        try:
            slides = json.loads(slides) if slides.strip() else []
        except ValueError:
            raise HTTPException(status_code=422, detail="slides non è JSON valido")
    bad = [s for s in slides if not isinstance(s, dict) or s.get("type") not in live.SLIDE_TYPES]
    if not isinstance(slides, list) or bad:
        raise HTTPException(status_code=422, detail=f"Ogni slide deve avere type in {list(live.SLIDE_TYPES)}")
    title = _text(p, "title").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Indica il titolo")
    result = await live.create_live_interaction(live.LiveInteractionCreate(session_id=str(_uuid(p.get("session_id"), "session_id")), title=title, slides_json=slides), ctx.db, ctx.teacher)
    return {"interaction_id": result["id"], "status": result["status"]}


def _live_action(id: str, label: str, description: str, fn_name: str, side: str = "realtime", outputs: list | None = None) -> None:
    @action(id, "live", label, description, params=[LIVE_ID], inputs=[LIVE_ID_IN], outputs=outputs or [port("result", "ANY", "Esito")], side_effects=side)
    async def handler(ctx: ActionContext, p: dict[str, Any]) -> dict[str, Any]:
        result = await getattr(_live(), fn_name)(_uuid(p.get("interaction_id"), "interaction_id"), ctx.db, ctx.teacher)
        return {"result": result, **(result if isinstance(result, dict) else {})}


_live_action("start", "Avvia sessione live", "Avvia la sessione live: gli studenti collegati la vedono subito sulla prima slide.", "start_live_interaction")
_live_action("next", "Slide successiva", "Passa alla slide successiva; dopo l'ultima la sessione si chiude.", "next_slide")
_live_action("end", "Termina sessione live", "Chiude la sessione live per tutti i partecipanti.", "end_live_interaction")
_live_action("results", "Risultati sessione live", "Restituisce i risultati aggregati e per studente della sessione live.", "get_results", side="none")
_live_action("public_link", "Abilita link pubblico", "Abilita l'accesso pubblico (codice/QR) alla sessione live e restituisce il codice.", "enable_public_live_link", side="modifies",
             outputs=[port("token", "ANY", "Codice di accesso"), port("access_code", "ANY", "Codice di accesso")])


# ── catalogue / execution ────────────────────────────────────────────────────


def catalog() -> dict[str, Any]:
    return {
        "version": 1,
        "domains": [{"id": key, "label": label, "actions": [a.spec() for a in ACTIONS.values() if a.domain == key]} for key, label in DOMAINS.items()],
    }


def _validate_params(act: PlatformAction, params: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for spec in act.params:
        value = params.get(spec["name"])
        if value in (None, ""):
            value = spec.get("default")
        if spec.get("options") and value not in (None, "") and value not in spec["options"]:
            raise HTTPException(status_code=422, detail=f"{spec['name']}: valore non valido, ammessi {spec['options']}")
        if spec["type"] == "INTEGER" and value not in (None, ""):
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"{spec['name']} deve essere un intero")
        if spec["type"] == "BOOLEAN" and isinstance(value, str):
            value = value.strip().lower() in {"1", "true", "si", "sì", "yes"}
        merged[spec["name"]] = value
    # Connected ports (dataflow) arrive as extra keys: they override same-named params when non-empty.
    for spec in act.inputs:
        if params.get(spec["name"]) not in (None, ""):
            merged[spec["name"]] = params[spec["name"]]
    return merged


def _plain_value(value: Any) -> Any:
    """A chatbot node emits ``{"message": text, "provider": …}``: actions want the text, not the envelope."""
    if isinstance(value, dict) and value.get("message") is not None and (value.get("provider") or value.get("model")):
        return str(value["message"])
    return value


async def execute(action_id: str, params: dict[str, Any], ctx: ActionContext) -> dict[str, Any]:
    act = ACTIONS.get(action_id)
    if act is None:
        raise HTTPException(status_code=404, detail=f"Azione sconosciuta: {action_id}")
    return await act.handler(ctx, _validate_params(act, {k: _plain_value(v) for k, v in (params or {}).items()}))


# ── Data Flow node library ───────────────────────────────────────────────────
# One generic node per domain.  The inspector's «Funzione» selector picks the action; params and ports are the
# union of all the domain's actions, each tagged ``showFor`` (the functions it belongs to).  When the same
# name differs between functions (label, default, type) the per-function value lives under ``variants``.

NODE_CATEGORY = "Piattaforma"
NODE_DESCRIPTIONS = {
    "files": "Lavora sul drive: elenca, leggi, scrivi file, crea cartelle, sposta, rinomina, cestina.",
    "documents": "Crea e modifica documenti di testo, presentazioni e tabelle (foglio di calcolo) della piattaforma.",
    "images": "Genera immagini con il generatore di piattaforma (stessi crediti) e salvale nel drive.",
    "models3d": "Genera modelli 3D con Meshy da testo o immagine, attendi il risultato, salvalo; gestisci i progetti 3D.",
    "live": "Crea e conduci sessioni live interattive: quiz, word wall, opinioni, feedback.",
}
NODE_LABELS = {"files": "Files", "documents": "Documenti", "images": "Immagini AI", "models3d": "Modelli 3D", "live": "Sessioni live"}


def _merge(items: list[tuple[str, dict[str, Any]]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for fn, item in items:
        entry = merged.get(item["name"])
        if entry is None:
            merged[item["name"]] = {**item, "showFor": [fn], "variants": {}}
            continue
        entry["showFor"].append(fn)
        for key in keys:
            if item.get(key) != entry.get(key):
                if key == "type":
                    entry["type"] = "ANY"
                else:
                    entry["variants"][fn] = {**entry["variants"].get(fn, {}), key: item.get(key)}
    for entry in merged.values():
        if not entry["variants"]:
            del entry["variants"]
    return list(merged.values())


def platform_node_specs() -> list[dict[str, Any]]:
    specs = []
    for domain in DOMAINS:
        acts = [(a.id.split(".", 1)[1], a) for a in ACTIONS.values() if a.domain == domain]
        if not acts:
            continue
        function = {
            "name": "function", "type": "SELECT", "label": "Funzione", "default": acts[0][0], "options": [fn for fn, _ in acts],
            "optionLabels": {fn: a.label for fn, a in acts},
        }
        params = _merge([(fn, prm) for fn, a in acts for prm in a.params], ("type", "label", "default", "options"))
        inputs = _merge([(fn, {**prm, "required": False}) for fn, a in acts for prm in a.inputs], ("type", "label"))
        outputs = _merge([(fn, prm) for fn, a in acts for prm in a.outputs], ("type", "label"))
        specs.append({
            "id": f"platform.{domain}", "label": NODE_LABELS[domain], "category": NODE_CATEGORY, "description": NODE_DESCRIPTIONS[domain],
            "inputs": inputs, "outputs": outputs, "params": [function, *params], "cachePolicy": "never",
            "functions": [{"id": fn, "label": a.label, "description": a.description, "sideEffects": a.side_effects, "longRunning": a.long_running} for fn, a in acts],
        })
    return specs


def _coerce_input(action_id: str, name: str, value: Any) -> Any:
    """Make any upstream output usable on a platform port: text-like params receive text (LLM answers, tables, JSON…)."""
    from app.services.dataflow_nodes import value_to_text
    prm = next((item for item in ACTIONS[action_id].params if item["name"] == name), None)
    if prm and prm.get("type") in {"STRING", "CODE"} and not isinstance(value, str):
        if name in {"slides", "rows"} and isinstance(value, (list, dict)):
            return value
        return value_to_text(value).strip()
    if name == "slides" and isinstance(value, dict) and isinstance(value.get("slides"), list):
        return value["slides"]
    return value


def _table_html(table: Any) -> str:
    rows = _table_to_rows(table)
    if not rows:
        return ""
    head = "".join(f"<th>{html.escape(c)}</th>" for c in rows[0])
    body = "".join("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in row) + "</tr>" for row in rows[1:])
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


async def run_platform_node(node_type: str, inputs: dict[str, Any], config: dict[str, Any], db: AsyncSession, actor: User) -> dict[str, Any]:
    """Executor used by the Data Flow runtime for ``platform.<domain>`` nodes."""
    from app.services.dataflow_nodes import json_value
    domain = node_type.split(".", 1)[1]
    function = str(config.get("function") or "").strip()
    action_id = f"{domain}.{function}"
    if action_id not in ACTIONS:
        raise ValueError(f"Scegli una funzione per il nodo «{NODE_LABELS.get(domain, domain)}»")
    params = {k: v for k, v in config.items() if k != "function"}
    params.update({k: _coerce_input(action_id, k, v) for k, v in inputs.items() if v is not None})
    try:
        return json_value(await execute(action_id, params, ActionContext(db=db, teacher=actor)))
    except HTTPException as exc:
        raise ValueError(str(exc.detail)) from exc
    except (ValueError, TypeError, AttributeError, KeyError) as exc:
        raise ValueError(f"{NODE_LABELS.get(domain, domain)} · {function}: {exc}") from exc


def register_nodes(registry: dict[str, dict[str, Any]]) -> None:
    registry.update({item["id"]: item for item in platform_node_specs()})
