"""Helpers shared by chat endpoints that accept file uploads."""
import asyncio
import io
import html
import re
import uuid
import zipfile
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

ATTACHMENT_DIR = Path("/app/uploads/chat_attachments")
THUMB_MAX_SIDE = 640

# An uploaded picture is edited (img2img) by default. These phrasings instead ask
# *about* the picture (describe, read, explain), so they keep the vision/analysis path.
_ANALYSIS_ONLY_RE = re.compile(
    r"\b(descriv\w*|cosa\s+(?:c'?è|vedi|rappresenta|raffigura)|che\s+cos'?è|spieg\w*|"
    r"analizz\w*|trascriv\w*|ocr|leggi|riassum\w*|commenta|valuta|correggi|"
    r"describe|what(?:'s|\s+is)\s+(?:in|this|that)|explain|analy[sz]e|transcribe|read|summari[sz]e)\b",
    re.IGNORECASE,
)


def should_edit_image(content: str, has_image: bool) -> bool:
    """Image attached → image-to-image, unless the text only asks to analyse it."""
    if not has_image:
        return False
    text = (content or "").strip()
    if not text:
        return False
    return not _ANALYSIS_ONLY_RE.search(text)


def _save_thumb_sync(data: bytes) -> Optional[str]:
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((THUMB_MAX_SIDE, THUMB_MAX_SIDE), Image.Resampling.LANCZOS)
            im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
            ATTACHMENT_DIR.mkdir(parents=True, exist_ok=True)
            name = f"{uuid.uuid4()}.webp"
            im.save(ATTACHMENT_DIR / name, format="WEBP", quality=80)
            return f"/uploads/chat_attachments/{name}"
    except Exception:
        return None


async def save_image_thumbnail(data: bytes) -> Optional[str]:
    """Persist a downscaled copy of an uploaded image so chat history can show its thumbnail."""
    return await asyncio.to_thread(_save_thumb_sync, data)


def _document_text(data: bytes, filename: str) -> str:
    lower = filename.lower()
    try:
        if lower.endswith((".txt", ".md", ".csv", ".json", ".py", ".html")):
            return data[:4000].decode("utf-8", errors="replace")
        if lower.endswith((".docx", ".pptx", ".xlsx")):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = archive.namelist()
                if lower.endswith(".docx"):
                    selected = ["word/document.xml"]
                elif lower.endswith(".pptx"):
                    selected = ["ppt/slides/slide1.xml"]
                else:
                    selected = ["xl/sharedStrings.xml"]
                raw = " ".join(archive.open(name).read(12000).decode("utf-8", errors="replace") for name in selected if name in names)
                return html.unescape(re.sub(r"<[^>]+>", " ", raw))
    except Exception:
        pass
    return ""


def _save_document_thumb_sync(data: bytes, filename: str) -> Optional[str]:
    try:
        if filename.lower().endswith(".pdf"):
            import fitz
            with fitz.open(stream=data, filetype="pdf") as pdf:
                if not pdf.page_count:
                    return None
                page = pdf[0]
                scale = min(1.5, 450 / max(page.rect.width, page.rect.height))
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        else:
            from PIL import ImageDraw, ImageFont
            image = Image.new("RGB", (360, 460), "white")
            draw = ImageDraw.Draw(image)
            font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
            title_font = ImageFont.truetype(font_path, 20)
            body_font = ImageFont.truetype(font_path, 13)
            draw.rectangle((0, 0, 360, 9), fill="#5870a8")
            draw.text((20, 28), filename[:26], font=title_font, fill="#172334")
            words = _document_text(data, filename).split()
            line, y = "", 78
            for word in words[:130]:
                candidate = f"{line} {word}".strip()
                if draw.textlength(candidate, font=body_font) > 318:
                    draw.text((20, y), line, font=body_font, fill="#4b5563")
                    y += 20
                    line = word
                    if y > 420:
                        break
                else:
                    line = candidate
            if line and y <= 420:
                draw.text((20, y), line, font=body_font, fill="#4b5563")
        image.thumbnail((360, 460), Image.Resampling.LANCZOS)
        ATTACHMENT_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4()}.webp"
        image.save(ATTACHMENT_DIR / name, format="WEBP", quality=78)
        return f"/uploads/chat_attachments/{name}"
    except Exception:
        return None


async def save_document_thumbnail(data: bytes, filename: str) -> Optional[str]:
    """Persist a small first-page preview for a document attachment."""
    if len(data) > 10 * 1024 * 1024:
        return None
    return await asyncio.to_thread(_save_document_thumb_sync, data, filename)


# ── LLM intent routing ───────────────────────────────────────────────────────
import json
import logging
from typing import Literal, TypedDict

logger = logging.getLogger(__name__)

ImageIntent = Literal["edit_image", "new_image", "analyze_image", "other"]
ImageSource = Literal["attached", "previous", "none"]


class RoutedIntent(TypedDict):
    intent: ImageIntent
    image: ImageSource


_ROUTER_SYSTEM = """You route chat messages for an educational platform. Decide what the user's LAST message wants.

Intents:
- edit_image: modify an existing picture (remove/add/change something, restyle, make it more X, fix background...)
- new_image: create a brand new picture from scratch
- analyze_image: ask about an existing picture (describe, explain, read text, answer questions on it)
- other: anything else (normal conversation, documents, quizzes, code...)

Image source (which existing picture the message refers to):
- attached: the user attached picture(s) to this message
- previous: no attachment, but the message continues from a picture already in the conversation
  (marked [IMMAGINE GENERATA] or [IMMAGINE ALLEGATA]) — typically the most recent one
- none: no existing picture involved

Use the conversation to resolve elliptical follow-ups ("togli lo sfondo", "più scuro", "e con gli occhiali?").
A new unrelated topic after an image is "other". Reply with ONLY JSON: {"intent": "...", "image": "..."}"""


def _clip(text: str, limit: int = 300) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "[IMMAGINE GENERATA]", text or "")
    text = re.sub(r"data:image/[^\s)]+", "[IMMAGINE]", text)
    return text if len(text) <= limit else text[:limit] + "…"


async def route_image_intent(
    llm_service,
    text: str,
    history: list[dict],
    attached_images: int = 0,
) -> RoutedIntent:
    """Classify the message with a cheap model. Falls back to keyword rules if the call fails."""
    from app.services import model_roles

    has_prior_image = any("![" in (m.get("content") or "") or "[IMMAGINE" in (m.get("content") or "") for m in history[-6:])
    if attached_images == 0 and not has_prior_image:
        return {"intent": "other", "image": "none"}  # nothing to edit: skip the LLM call

    lines = [f"{m.get('role', 'user').upper()}: {_clip(m.get('content', ''))}" for m in history[-6:]]
    prompt = (
        "Conversation so far:\n" + ("\n".join(lines) or "(empty)")
        + f"\n\nLAST user message: {text.strip()[:600]}"
        + f"\nPictures attached to the last message: {attached_images}"
    )
    try:
        provider, model = model_roles.pair_for("chat.router")
        resp = await llm_service.generate(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=_ROUTER_SYSTEM,
            provider=provider,
            model=model,
            temperature=0,
            max_tokens=40,
        )
        raw = (resp.content or "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        intent = data.get("intent")
        image = data.get("image")
        if intent in ("edit_image", "new_image", "analyze_image", "other") and image in ("attached", "previous", "none"):
            if attached_images == 0 and image == "attached":
                image = "previous" if has_prior_image else "none"
            return {"intent": intent, "image": image}
    except Exception as exc:
        logger.warning("Intent router failed, using keyword fallback: %s", exc)

    if attached_images:
        return {"intent": "edit_image" if should_edit_image(text, True) else "analyze_image", "image": "attached"}
    return {"intent": "other", "image": "none"}
