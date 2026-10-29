"""Deterministic quality pass for slides: finds and fixes what makes AI decks look broken.

Runs on every AI-produced slide (Studio render, chat generator, document-assistant slide /
presentation edits) and mirrors the client-side check in frontend/src/lib/slideQuality.ts that the
editor's «Controllo qualità» panel uses for manual edits. Checks, against the *painted stack*
(what is really drawn under each text block, not just the slide background):

- text contrast below WCAG AA (4.5:1, 3:1 for large text) → recolour with the most readable
  theme role / black / white, and strip unreadable inline colours from the HTML;
- blocks outside the canvas → clamped inside;
- degenerate or invisible shapes (zero-size, no fill and no stroke, same colour as what's under
  them) → removed: these are the "shapes that make no sense";
- empty text boxes → removed; estimated text overflow → font shrunk to fit.
"""
from __future__ import annotations

import re
from typing import Optional

from app.services.presentation_layouts import _char_width_for, estimate_text_height, fit_font_size
from app.services.presentation_themes import blend, contrast_ratio, parse_color, readable_on

_TAG_RE = re.compile(r"<[^>]+>")
_INLINE_COLOR_RE = re.compile(r"(?<![-\w])color\s*:\s*([^;\"']+);?", re.IGNORECASE)
DEFAULT_SLIDE_BACKGROUND = "#FFFFFF"


def plain_text(content: str) -> str:
    text = re.sub(r"<(br|/p|/li)\s*/?>", "\n", str(content or ""), flags=re.IGNORECASE)
    text = _TAG_RE.sub("", text)
    return text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").strip()


def _num(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _painted_background(blocks: list[dict], index: int, slide_bg: str) -> str:
    """Colour actually painted under the centre of blocks[index] (blocks are in paint order)."""
    target = blocks[index]
    cx = _num(target.get("x")) + _num(target.get("width")) / 2
    cy = _num(target.get("y")) + _num(target.get("height")) / 2
    color = slide_bg
    for block in blocks[:index]:
        if block.get("hidden"):
            continue
        x, y = _num(block.get("x")), _num(block.get("y"))
        w, h = _num(block.get("width")), _num(block.get("height"))
        if not (x <= cx <= x + w and y <= cy <= y + h):
            continue
        style = block.get("style") or {}
        kind = block.get("type")
        if kind == "rectangle":
            fill = style.get("fill")
        elif kind == "ellipse":
            # Only the inscribed ellipse is painted.
            rx, ry = max(w / 2, 1), max(h / 2, 1)
            inside = ((cx - (x + rx)) / rx) ** 2 + ((cy - (y + ry)) / ry) ** 2 <= 1
            fill = style.get("fill") if inside else None
        elif kind == "text":
            fill = style.get("backgroundColor")
        else:
            fill = None  # images/lines: unknown or negligible paint
        if parse_color(fill):
            color = blend(fill, color) or color
    own = (target.get("style") or {}).get("backgroundColor")
    if parse_color(own):
        color = blend(own, color) or color
    return color


def _min_contrast(font_size: float, weight: str) -> float:
    bold = str(weight).lower() in {"bold", "700", "800", "900", "600"}
    return 3.0 if font_size >= 24 or (bold and font_size >= 19) else 4.5


def _issue(code: str, slide_index: int, block_id: Optional[str], message: str, fixed: bool) -> dict:
    return {"code": code, "slide_index": slide_index, "block_id": block_id, "message": message, "fixed": fixed}


def check_and_fix_slide(slide: dict, slide_index: int, width: float, height: float, theme: Optional[dict] = None,
                        fix: bool = True) -> list[dict]:
    """Inspect (and, with fix=True, repair in place) one slide. Returns the issues found."""
    issues: list[dict] = []
    blocks = slide.get("blocks") if isinstance(slide.get("blocks"), list) else []
    blocks.sort(key=lambda b: _num(b.get("zIndex"), 0) if isinstance(b, dict) else 0)
    slide_bg = slide.get("backgroundColor") if parse_color(slide.get("backgroundColor")) else DEFAULT_SLIDE_BACKGROUND
    palette = theme["colors"] if theme else {}
    preferred = [palette[k] for k in ("text", "on_inverse", "on_primary") if palette.get(k)]

    kept: list[dict] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        block_id = block.get("id")
        style = block.get("style") if isinstance(block.get("style"), dict) else {}
        block["style"] = style
        w, h = _num(block.get("width")), _num(block.get("height"))

        if kind in {"rectangle", "ellipse"}:
            has_fill = parse_color(style.get("fill")) is not None
            has_stroke = parse_color(style.get("stroke")) is not None and _num(style.get("strokeWidth")) > 0
            if w < 4 or h < 4 or not (has_fill or has_stroke):
                issues.append(_issue("degenerate_shape", slide_index, block_id, "Forma vuota o troppo piccola", fix))
                if fix:
                    continue
            elif has_fill and not has_stroke and kept:
                under = _painted_background(kept + [block], len(kept), slide_bg)
                if contrast_ratio(blend(style.get("fill"), under) or under, under) < 1.05 and not block.get("themeRole"):
                    issues.append(_issue("invisible_shape", slide_index, block_id, "Forma invisibile (stesso colore dello sfondo)", fix))
                    if fix:
                        continue
        elif kind == "line" and w < 4 and h < 4:
            issues.append(_issue("degenerate_shape", slide_index, block_id, "Linea di lunghezza nulla", fix))
            if fix:
                continue

        if kind != "line" and (w > 0 and h > 0):
            x, y = _num(block.get("x")), _num(block.get("y"))
            if x < -1 or y < -1 or x + w > width + 1 or y + h > height + 1:
                issues.append(_issue("off_canvas", slide_index, block_id, "Oggetto fuori dalla slide", fix))
                if fix:
                    w, h = min(w, width), min(h, height)
                    block["width"], block["height"] = w, h
                    block["x"] = max(0.0, min(x, width - w))
                    block["y"] = max(0.0, min(y, height - h))

        if kind == "text":
            text = plain_text(block.get("content") or "")
            if not text:
                issues.append(_issue("empty_text", slide_index, block_id, "Casella di testo vuota", fix))
                if fix:
                    continue
            font_size = _num(style.get("fontSize"), 20)
            line_height = _num(style.get("lineHeight"), 1.25)
            padding = _num(style.get("padding"), 0)
            char_w = _char_width_for(str(style.get("fontFamily") or ""))
            if estimate_text_height(text, w, font_size, line_height, padding, char_w) > h * 1.15:
                issues.append(_issue("overflow", slide_index, block_id, "Il testo esce dalla casella", fix))
                if fix:
                    style["fontSize"] = int(fit_font_size(text, w, h, font_size, min_font_size=11,
                                                          line_height=line_height, padding=padding, char_width_em=char_w))
                    font_size = style["fontSize"]

            background = _painted_background(kept + [block], len(kept), slide_bg)
            minimum = _min_contrast(font_size, style.get("fontWeight") or "normal")
            color = style.get("color") or "#111827"
            if contrast_ratio(blend(color, background) or color, background) < minimum:
                issues.append(_issue("low_contrast", slide_index, block_id, "Testo poco leggibile sullo sfondo", fix))
                if fix:
                    style["color"] = readable_on(background, preferred, minimum)
                    if isinstance(block.get("themeRole"), dict):
                        block["themeRole"].pop("color", None)
            content = str(block.get("content") or "")
            if fix and "color" in content:
                def _strip(match: "re.Match[str]") -> str:
                    inline = match.group(1).strip()
                    if parse_color(inline) and contrast_ratio(blend(inline, background) or inline, background) < minimum:
                        return ""
                    return match.group(0)
                cleaned = _INLINE_COLOR_RE.sub(_strip, content)
                if cleaned != content:
                    issues.append(_issue("low_contrast_inline", slide_index, block_id, "Colore del testo illeggibile", True))
                    block["content"] = cleaned
        kept.append(block)

    if fix:
        for order, block in enumerate(kept):
            block["zIndex"] = order
        slide["blocks"] = kept
    return issues


def check_and_fix_slides(slides: list[dict], width: float, height: float, theme: Optional[dict] = None,
                         fix: bool = True) -> list[dict]:
    issues: list[dict] = []
    for index, slide in enumerate(slides):
        if isinstance(slide, dict):
            issues.extend(check_and_fix_slide(slide, index, width, height, theme, fix))
    return issues
