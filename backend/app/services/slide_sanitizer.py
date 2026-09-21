"""HTML sanitization for slide text-block content.

Slide text blocks store a small TipTap-authored HTML fragment (inline marks: bold/italic/
underline/color/font-family/font-size), not plain text. Because that HTML is later rendered
via dangerouslySetInnerHTML for other viewers (published deck, thumbnails), it must never be
trusted as-is from the client — a modified client could smuggle a stored-XSS payload into a
deck other students/teachers load. This mirrors the client-side DOMPurify pass
(frontend/src/lib/sanitizeSlideHtml.ts) with the same allowlist, so content only tightens as it
crosses the trust boundary, never loosens.
"""
import json
import logging
from typing import Any

import nh3

logger = logging.getLogger(__name__)

_ALLOWED_TAGS = {"p", "strong", "em", "u", "span", "br"}
_ALLOWED_ATTRIBUTES = {"span": {"style"}}
_ALLOWED_STYLE_PROPERTIES = {"color", "font-family", "font-weight", "font-style", "text-decoration", "font-size"}


def _clean_style(style: str) -> str:
    declarations = []
    for declaration in style.split(";"):
        if ":" not in declaration:
            continue
        prop, _, value = declaration.partition(":")
        prop = prop.strip().lower()
        value = value.strip()
        if prop in _ALLOWED_STYLE_PROPERTIES and value:
            declarations.append(f"{prop}: {value}")
    return "; ".join(declarations)


def sanitize_slide_text_html(raw: Any) -> str:
    """Strip anything but the small inline-formatting allowlist from one text block's content."""
    text = str(raw or "")
    cleaned = nh3.clean(
        text,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRIBUTES,
        strip_comments=True,
    )
    if "style=" in cleaned:
        import re as _re

        def _replace(match: "_re.Match[str]") -> str:
            safe_style = _clean_style(match.group(1))
            return f'style="{safe_style}"' if safe_style else ""

        cleaned = _re.sub(r'style="([^"]*)"', _replace, cleaned)
    return cleaned


def sanitize_presentation_blocks(payload: dict) -> dict:
    """Sanitize every text block's content in-place within a parsed presentation payload."""
    slides = payload.get("slides") if isinstance(payload.get("slides"), list) else []
    for slide in slides:
        if not isinstance(slide, dict):
            continue
        blocks = slide.get("blocks") if isinstance(slide.get("blocks"), list) else []
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                block["content"] = sanitize_slide_text_html(block.get("content"))
    return payload


def sanitize_document_draft_content_json(content_json: str) -> str:
    """Sanitize the opaque content_json string persisted for a document/presentation draft or task.

    content_json is stored as a JSON-encoded string (see DocumentDraftCreate/Update,
    TaskCreate schemas) and is not otherwise validated server-side. Only presentation-shaped
    payloads (type == "presentation_v2") carry text blocks that need sanitizing; anything else
    (word-processor "document" mode, sheets) is left untouched here and passes through as-is —
    if malformed JSON is given, return it unchanged rather than raising, since this must not
    turn a save into a hard failure for unrelated document types.
    """
    if not content_json:
        return content_json
    try:
        payload = json.loads(content_json)
    except (TypeError, ValueError):
        return content_json
    if not isinstance(payload, dict) or not isinstance(payload.get("slides"), list):
        return content_json
    try:
        sanitized = sanitize_presentation_blocks(payload)
        return json.dumps(sanitized, ensure_ascii=False)
    except Exception:
        # Fail closed: an unexpected shape must not fall back to persisting unsanitized HTML.
        # Strip every text block down to plain text instead of returning the original payload.
        logger.exception("Failed to sanitize presentation content_json; stripping all text block markup")
        for slide in payload.get("slides", []):
            if not isinstance(slide, dict):
                continue
            for block in slide.get("blocks", []) if isinstance(slide.get("blocks"), list) else []:
                if isinstance(block, dict) and block.get("type") == "text":
                    block["content"] = nh3.clean(str(block.get("content") or ""), tags=set())
        return json.dumps(payload, ensure_ascii=False)
