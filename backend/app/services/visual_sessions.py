"""Durable, owner-scoped visual chats. A claimed turn survives a browser disconnect."""
import asyncio
import base64
import io
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from PIL import Image
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.visual_comprehension import VisualComprehensionSession
from app.services.credit_service import credit_service
from app.services.storage_service import storage_service
from app.services.visual_comprehension import normalize_image
from app.services.visual_dialogue import Inventory, converse
from app.services.visual_selection import Selection
from app.services.visual_blackboard import compose_blackboard
from app.services.visual_review import review_drawing

logger = logging.getLogger(__name__)
STALE_SECONDS = 180


def utcnow():
    return datetime.now(timezone.utc)


def serialize(s, full=True):
    out = {"id": str(s.id), "title": s.title, "image_name": s.image_name,
           "image_width": s.image_width, "image_height": s.image_height,
           "updated_at": s.updated_at.isoformat(), "revision": s.revision,
           "busy": bool(s.active_request_id), "message_count": len(s.messages or [])}
    if full:
        out.update(image_url=f"/admin/visual-comprehension/sessions/{s.id}/image", messages=s.messages or [],
                   dialogue=s.dialogue or {}, inventory=s.inventory, draft=s.draft or "")
    return out


async def owned(db, session_id, owner_id, lock=False):
    query = select(VisualComprehensionSession).where(
        VisualComprehensionSession.id == session_id, VisualComprehensionSession.owner_id == owner_id)
    if lock:
        query = query.with_for_update()
    session = (await db.execute(query)).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    return session


def finish_failed(s, request_id, error):
    s.messages = [{**m, "status": "failed", "error": error} if m.get("role") == "user" and m.get("request_id") == str(request_id)
                  else m for m in (s.messages or [])]
    s.active_request_id = None
    s.request_started_at = None
    s.revision += 1


def recover_stale(s):
    if s.active_request_id and (not s.request_started_at or (utcnow() - s.request_started_at).total_seconds() > STALE_SECONDS):
        finish_failed(s, s.active_request_id, "Elaborazione interrotta. Puoi riprovare questo messaggio.")
        return True
    return False


async def create_session(admin, image_data, image_name, title):
    try:
        normalized = await asyncio.to_thread(normalize_image, image_data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    raw = base64.b64decode(normalized.split(",", 1)[1])
    with Image.open(io.BytesIO(raw)) as img:
        width, height = img.size
    session_id = uuid.uuid4()
    key = f"visual-comprehension/{admin.id}/{session_id}/source.png"
    await asyncio.to_thread(storage_service.upload_file, key, raw, "image/png")
    try:
        async with AsyncSessionLocal() as db:
            s = VisualComprehensionSession(id=session_id, owner_id=admin.id, title=title,
                image_key=key, image_name=image_name, image_width=width, image_height=height,
                messages=[], dialogue={}, draft="", revision=0)
            db.add(s)
            await db.commit()
            await db.refresh(s)
            return serialize(s)
    except Exception:
        await asyncio.to_thread(storage_service.delete_file, key)
        raise


async def usage_callback(admin):
    async with AsyncSessionLocal() as db:
        if not await credit_service.check_availability(db, admin.tenant_id, estimated_cost=0.05, teacher_id=admin.id):
            raise HTTPException(status_code=402, detail="Crediti AI esauriti.")

    async def track(response, stage):
        cost = credit_service.calculate_cost_for_model(response.provider, response.model, response.prompt_tokens, response.completion_tokens)
        async with AsyncSessionLocal() as db:
            await credit_service.track_usage(db, admin.tenant_id, response.provider, response.model, cost,
                {"type": "visual_comprehension", "stage": stage, "prompt_tokens": response.prompt_tokens,
                 "completion_tokens": response.completion_tokens}, teacher_id=admin.id)
    return track


async def send_message(admin, session_id, request_id, revision, content, selection: Selection | None = None):
    # Idempotency is checked before optimistic concurrency: a lost response can be retried safely.
    async with AsyncSessionLocal() as db:
        s = await owned(db, session_id, admin.id, lock=True)
        recover_stale(s)
        matches = [m for m in (s.messages or []) if m.get("request_id") == str(request_id)]
        if any(m["role"] == "assistant" for m in matches):
            if matches[0].get("content") != content:
                raise HTTPException(status_code=409, detail="Il messaggio è già stato utilizzato per un'altra richiesta.")
            return serialize(s)
        if s.active_request_id:
            raise HTTPException(status_code=409, detail="Il tutor sta già elaborando un messaggio in questa sessione.")
        if s.revision != revision:
            raise HTTPException(status_code=409, detail="La sessione è stata aggiornata. Riaprila per continuare dal punto salvato.")
        if matches and matches[0].get("content") != content:
            raise HTTPException(status_code=409, detail="Per modificare il testo invia un nuovo messaggio.")
        # Check credits before durably claiming work, so a denial does not leave a phantom turn.
        track = await usage_callback(admin)
        if matches:
            s.messages = [{**m, "status": "pending", "error": None} if m.get("request_id") == str(request_id) else m for m in s.messages]
            stored = matches[0].get("selection")  # a retry asks about the same marked area
            selection = Selection.model_validate(stored) if stored else None
        else:
            s.messages = [*(s.messages or []), {"id": str(uuid.uuid4()), "request_id": str(request_id),
                "role": "user", "content": content, "status": "pending", "created_at": utcnow().isoformat(),
                **({"selection": selection.model_dump()} if selection else {})}]
        selection_id = f"selezione-{sum(1 for m in s.messages if m.get('selection'))}"
        s.active_request_id = request_id
        s.request_started_at = utcnow()
        s.draft = ""
        s.revision += 1
        image_key, inventory, dialogue, messages = s.image_key, s.inventory, s.dialogue or {}, list(s.messages)
        await db.commit()

    try:
        raw = await asyncio.to_thread(storage_service.download_file, image_key)
        image = "data:image/png;base64," + base64.b64encode(raw).decode()
        new_inventory, new_dialogue, reply = await converse(image, inventory, dialogue, messages, track,
                                                            selection=selection, selection_id=selection_id)
        async with AsyncSessionLocal() as db:
            s = await owned(db, session_id, admin.id, lock=True)
            if s.active_request_id != request_id:
                raise HTTPException(status_code=409, detail="Questo turno è stato sostituito. Riapri la sessione.")
            s.messages = [{**m, "status": "sent", "error": None} if m.get("request_id") == str(request_id) else m for m in s.messages]
            s.messages = [*s.messages, {"id": str(uuid.uuid4()), "request_id": str(request_id), "role": "assistant",
                **reply, "status": "sent", "created_at": utcnow().isoformat()}]
            s.inventory = new_inventory.model_dump()
            s.dialogue = new_dialogue
            s.active_request_id = None
            s.request_started_at = None
            s.revision += 1
            await db.commit()
            await db.refresh(s)
            return serialize(s)
    except Exception as exc:
        logger.exception("Saved visual conversation failed")
        message = "Il tutor non ha completato la risposta. Il messaggio è salvato: puoi riprovare."
        async with AsyncSessionLocal() as db:
            s = await owned(db, session_id, admin.id, lock=True)
            if s.active_request_id == request_id:
                finish_failed(s, request_id, message)
                await db.commit()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=504 if isinstance(exc, TimeoutError) else 502, detail=message) from exc


async def review_message(admin, session_id, message_id, snapshot, issues):
    """Art-direction pass on one assistant drawing; done once per message, the reviewed scene replaces the original."""
    try:
        snapshot = await asyncio.to_thread(normalize_image, snapshot)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    async with AsyncSessionLocal() as db:
        s = await owned(db, session_id, admin.id)
        message = next((m for m in s.messages or [] if m.get("id") == str(message_id) and m.get("role") == "assistant"), None)
        if not message or not (message.get("focus") or {}).get("drawing"):
            raise HTTPException(status_code=404, detail="Disegno non trovato")
        if message["focus"].get("review"):
            return serialize(s)
        scene, content, inventory, image_key = message["focus"]["drawing"], message.get("content", ""), s.inventory, s.image_key
        last_id = next((m.get("id") for m in reversed(s.messages or []) if m.get("role") == "assistant"), None)
        brief = (s.dialogue or {}).get("drawing_brief", "") if last_id == str(message_id) else ""
    track = await usage_callback(admin)
    grounding = Inventory.model_validate(inventory).grounding
    try:
        raw = await asyncio.to_thread(storage_service.download_file, image_key)
        source = "data:image/png;base64," + base64.b64encode(raw).decode()
        async with asyncio.timeout(120):
            reviewed, review, applied = await review_drawing(snapshot, scene, grounding, content, issues, track, source=source, brief=brief)
    except Exception as exc:  # the original drawing stays usable; record the attempt so it is not retried forever
        logger.warning("visual review failed: %s", exc)
        reviewed, review, applied = scene, None, 0
    summary = {"applied": max(applied, 0), "redone": applied < 0, "failed": review is None,
               **({"scores": {k: getattr(review, k) for k in ("legibility", "alignment", "clarity", "restraint")},
                   "verdict": review.verdict, "notes": review.notes} if review else {})}
    async with AsyncSessionLocal() as db:
        s = await owned(db, session_id, admin.id, lock=True)
        last = next((m for m in reversed(s.messages or []) if m.get("role") == "assistant"), None)
        s.messages = [{**m, "focus": {**m["focus"], "drawing": reviewed, "review": summary}} if m.get("id") == str(message_id) else m
                      for m in s.messages]
        if last and last.get("id") == str(message_id):
            s.dialogue = {**(s.dialogue or {}), "drawing": reviewed}
        await db.commit()
        await db.refresh(s)
        return serialize(s)


async def redraw_message(admin, session_id, message_id):
    """Second chance for a drawing that failed: same explanation, same brief, a new composition."""
    async with AsyncSessionLocal() as db:
        s = await owned(db, session_id, admin.id)
        message = next((m for m in s.messages or [] if m.get("id") == str(message_id) and m.get("role") == "assistant"), None)
        focus = (message or {}).get("focus") or {}
        if not message or not focus.get("drawing_failed"):
            raise HTTPException(status_code=404, detail="Nessun disegno da rigenerare")
        image_key, inventory = s.image_key, s.inventory
    track = await usage_callback(admin)
    raw = await asyncio.to_thread(storage_service.download_file, image_key)
    image = "data:image/png;base64," + base64.b64encode(raw).decode()
    try:
        async with asyncio.timeout(120):
            drawing = await compose_blackboard(image, Inventory.model_validate(inventory).grounding, message.get("content", ""),
                                               focus.get("brief", ""), None, track, action=focus.get("action", "explain"))
    except (ValueError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail="Il disegno non è riuscito neanche questa volta. Prova a chiederlo con parole diverse.") from exc
    async with AsyncSessionLocal() as db:
        s = await owned(db, session_id, admin.id, lock=True)
        last = next((m for m in reversed(s.messages or []) if m.get("role") == "assistant"), None)
        clean = {k: v for k, v in focus.items() if k not in ("drawing_failed", "brief", "action")}
        s.messages = [{**m, "focus": {**clean, "drawing": drawing.model_dump()}} if m.get("id") == str(message_id) else m for m in s.messages]
        if last and last.get("id") == str(message_id):
            s.dialogue = {**(s.dialogue or {}), "drawing": drawing.model_dump()}
        await db.commit()
        await db.refresh(s)
        return serialize(s)
