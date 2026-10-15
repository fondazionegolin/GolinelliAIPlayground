"""Anteprima dell'anonimizzazione degli allegati (mostrata prima dell'invio in chat)."""
import logging
from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.document_processor import document_processor
from app.services.pii_anonymizer import COUNT_LABELS, anonymize_text_async

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_BYTES = 10 * 1024 * 1024
PREVIEW_CHARS = 20_000


async def _preview(file: UploadFile) -> dict:
    data = await file.read()
    filename = file.filename or "documento"
    mime_type = file.content_type or "application/octet-stream"
    if not data:
        raise HTTPException(status_code=400, detail="File vuoto")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File troppo grande (max 10 MB)")

    if mime_type.startswith("image/"):
        # Le immagini non si possono anonimizzare in modo affidabile: avvisiamo e basta.
        return {
            "filename": filename, "kind": "image", "supported": False, "had_pii": False,
            "counts": {}, "labels": {}, "text": "", "truncated": False,
            "note": "Le immagini non possono essere anonimizzate automaticamente: verifica che non mostrino volti, nomi o altri dati personali.",
        }

    steps: list[str] = []
    try:
        raw_text, _pages, _vis, _segs = await document_processor._extract_content(data, filename, mime_type, steps)
    except Exception as exc:
        logger.warning("anonymize-preview extraction failed for %s: %s", filename, exc)
        raw_text = ""
    if not (raw_text or "").strip():
        return {
            "filename": filename, "kind": "document", "supported": False, "had_pii": False,
            "counts": {}, "labels": {}, "text": "", "truncated": False,
            "note": "Non è stato possibile leggere il testo del file per l'anteprima. Verrà comunque anonimizzato lato server se contiene testo.",
        }

    result = await anonymize_text_async(raw_text)
    return {
        "filename": filename, "kind": "document", "supported": True,
        "had_pii": result.changed,
        "counts": result.counts,
        "labels": {k: COUNT_LABELS.get(k, k) for k in result.counts},
        "text": result.text[:PREVIEW_CHARS],
        "truncated": len(result.text) > PREVIEW_CHARS,
        "ner_available": result.ner_available,
        "note": None,
    }


@router.post("/anonymize-preview")
async def anonymize_preview(file: UploadFile = File(...)):
    """Copia anonimizzata (testo) di un allegato, senza salvare nulla.

    Volutamente senza autenticazione: lo usano anche i visitatori dei link pubblici dei
    teacherbot, che possono già allegare file. Limite 10 MB, nessuna persistenza."""
    return await _preview(file)
