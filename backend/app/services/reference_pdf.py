"""Fast PDF → text for Live Interaction reference documents.

Differences from the generic document_processor path:
  * all PyMuPDF work runs in a worker thread (never blocks the event loop);
  * no table / drawing analysis (``find_tables`` is very slow on big PDFs);
  * pages with no text layer (scans, slides exported as images) are transcribed
    by a vision model, several pages in parallel, under a global time budget.
"""

import asyncio
import base64
import logging
import time
from dataclasses import dataclass, field

from app.services import model_roles
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)

MAX_PAGES = 400            # pages read for the text layer
MIN_TEXT_CHARS = 60        # below this a page is treated as image-only
OCR_MAX_PAGES = 30         # vision transcription cap per document
OCR_CONCURRENCY = 5
OCR_PAGE_TIMEOUT = 45.0    # seconds per page
OCR_BUDGET = 80.0          # seconds for all OCR (stay under the 100s proxy limit)
OCR_DPI = 130

OCR_PROMPT = (
    "Trascrivi fedelmente tutto il testo presente in questa pagina di documento (OCR), "
    "nell'ordine di lettura e nella lingua originale. Mantieni titoli ed elenchi; "
    "rendi le tabelle in formato Markdown; scrivi le formule in testo semplice. "
    "Per grafici, schemi o immagini aggiungi una riga breve '[Figura: ...]' con i dati chiave. "
    "Non aggiungere commenti, introduzioni o spiegazioni tue. "
    "Se la pagina è vuota rispondi esattamente: [vuota]"
)


@dataclass
class ReferenceExtraction:
    text: str
    page_count: int
    ocr_pages: int = 0
    ocr_skipped: int = 0
    usage: list = field(default_factory=list)  # LLMResponse objects, for billing


def _read_pdf(file_bytes: bytes) -> tuple[int, dict[int, str], dict[int, bytes]]:
    """Blocking: text layer for every page + JPEG renders of the image-only ones."""
    import fitz

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        page_count = len(doc)
        texts: dict[int, str] = {}
        scan_candidates: list[int] = []
        for i in range(min(page_count, MAX_PAGES)):
            page = doc[i]
            t = (page.get_text("text", sort=True) or "").strip()
            texts[i] = t
            if len(t) < MIN_TEXT_CHARS:
                scan_candidates.append(i)

        images: dict[int, bytes] = {}
        zoom = OCR_DPI / 72.0
        mat = fitz.Matrix(zoom, zoom)
        for i in scan_candidates[:OCR_MAX_PAGES]:
            pix = doc[i].get_pixmap(matrix=mat, colorspace=fitz.csGRAY, alpha=False)
            images[i] = pix.tobytes("jpeg", jpg_quality=75)
        skipped = scan_candidates[OCR_MAX_PAGES:]
        for i in skipped:
            texts.setdefault(i, "")
        return page_count, texts, images
    finally:
        doc.close()


async def _ocr_page(idx: int, jpeg: bytes, sem: asyncio.Semaphore):
    b64 = base64.b64encode(jpeg).decode("ascii")
    async with sem:
        resp = await asyncio.wait_for(
            llm_service.generate(
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": OCR_PROMPT},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }],
                provider=model_roles.provider_for("vision"),
                model=model_roles.model_for("vision"),
                temperature=0.0,
                max_tokens=1800,
                allow_web_search=False,
            ),
            timeout=OCR_PAGE_TIMEOUT,
        )
    return idx, resp


async def extract_reference(file_bytes: bytes, *, allow_ocr: bool = True) -> ReferenceExtraction:
    page_count, texts, images = await asyncio.to_thread(_read_pdf, file_bytes)
    result = ReferenceExtraction(text="", page_count=page_count)

    ocr_texts: dict[int, str] = {}
    failed = 0
    if allow_ocr and images:
        sem = asyncio.Semaphore(OCR_CONCURRENCY)
        tasks = [asyncio.create_task(_ocr_page(i, jpg, sem)) for i, jpg in images.items()]
        done, pending = await asyncio.wait(tasks, timeout=OCR_BUDGET)
        for t in pending:
            t.cancel()
        failed += len(pending)
        for t in done:
            try:
                idx, resp = t.result()
            except Exception as e:  # one bad page must not sink the document
                logger.warning("reference OCR page failed: %s", e)
                failed += 1
                continue
            result.usage.append(resp)
            content = (resp.content or "").strip()
            if content and content.lower() != "[vuota]":
                ocr_texts[idx] = content
        result.ocr_pages = len(ocr_texts)

    # image-only pages beyond the OCR cap were never attempted
    failed += max(0, sum(1 for t in texts.values() if len(t) < MIN_TEXT_CHARS) - len(images)) if allow_ocr else 0
    result.ocr_skipped = failed

    parts: list[str] = []
    for i in sorted(texts):
        body = ocr_texts.get(i) or texts[i]
        if body:
            parts.append(f"[Pagina {i + 1}]\n{body}")
    result.text = "\n\n".join(parts)
    return result
