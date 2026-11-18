"""Slide styles: background, title/body typography and accent, applied deterministically.

A *style* is a small JSON spec (never raw model output applied blindly):

    {"background": "#FFFFFF",
     "title": {"fontFamily": "Georgia", "fontSize": 40, "color": "#1A1A2E", "fontWeight": "bold", "textAlign": "left"},
     "body":  {"fontFamily": "Inter",   "fontSize": 24, "color": "#2D2D2D"},
     "accent": "#E85C8D"}

Every key is optional: only what is present is changed. The same code path serves the editor panel,
saved styles and the document assistant, so «sfondo bianco» can never again paint white boxes over
the text: the background is the slide's own ``backgroundColor`` (plus its full-slide shape, if any).
"""
from __future__ import annotations

import json
import re
import statistics
from typing import Optional

from app.services.presentation_quality import check_and_fix_slides
from app.services.presentation_themes import FONT_STACKS, contrast_ratio, parse_color, readable_on, to_hex

TEXT_PROPS = ("fontFamily", "fontSize", "color", "fontWeight", "fontStyle", "textAlign", "lineHeight")
ROLE_KEYS = {"fontFamily": "font", "color": "color"}
INLINE_KEYS = {"fontFamily": "font-family", "fontSize": "font-size", "color": "color"}
STYLE_PRESET_FONTS = [
    "Inter", "Lexend", "Plus Jakarta Sans", "Georgia", "Merriweather", "Playfair Display", "Montserrat",
    "Poppins", "Roboto Slab", "Source Serif 4", "Fira Sans", "Comic Neue",
]
_FONT_RE = re.compile(r"^[A-Za-z0-9 \-]{2,40}$")
_STYLE_ATTR_RE = re.compile(r"""style=(["'])(.*?)\1""", re.IGNORECASE | re.DOTALL)


def _num(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def clean_color(value: object) -> Optional[str]:
    parsed = parse_color(value)
    return to_hex(parsed[:3]) if parsed and parsed[3] >= 1 else None


def clean_font(value: object) -> Optional[str]:
    text = str(value or "").strip().strip("'\"")
    if not text:
        return None
    first = text.split(",")[0].strip().strip("'\"")
    if first in FONT_STACKS:
        return FONT_STACKS[first]
    if not _FONT_RE.match(first):
        return None
    return f"'{first}', Inter, Arial, sans-serif" if " " in first else f"{first}, Inter, Arial, sans-serif"


def _clean_text_style(raw: object) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    out: dict = {}
    font = clean_font(raw.get("fontFamily", raw.get("font")))
    if font:
        out["fontFamily"] = font
    size = _num(raw.get("fontSize", raw.get("size")), 0)
    if size:
        out["fontSize"] = round(max(10.0, min(140.0, size)))
    color = clean_color(raw.get("color"))
    if color:
        out["color"] = color
    weight = str(raw.get("fontWeight", raw.get("weight")) or "").lower()
    if weight in {"normal", "bold", "400", "500", "600", "700", "800"}:
        out["fontWeight"] = weight
    if str(raw.get("fontStyle") or "").lower() in {"normal", "italic"}:
        out["fontStyle"] = str(raw["fontStyle"]).lower()
    if str(raw.get("textAlign") or "").lower() in {"left", "center", "right", "justify"}:
        out["textAlign"] = str(raw["textAlign"]).lower()
    line_height = _num(raw.get("lineHeight"), 0)
    if line_height:
        out["lineHeight"] = round(max(0.9, min(2.2, line_height)), 2)
    return out


def normalize_style(raw: object) -> dict:
    """Allowlist + clamp a style spec coming from the UI, the database or the model."""
    raw = raw if isinstance(raw, dict) else {}
    style: dict = {}
    background = clean_color(raw.get("background", raw.get("backgroundColor")))
    if background:
        style["background"] = background
    for part in ("title", "body"):
        cleaned = _clean_text_style(raw.get(part))
        if cleaned:
            style[part] = cleaned
    accent = clean_color(raw.get("accent"))
    if accent:
        style["accent"] = accent
    return style


def describe_style(style: dict) -> str:
    parts = []
    if style.get("background"):
        parts.append(f"sfondo {style['background']}")
    for part, label in (("title", "titoli"), ("body", "testo")):
        spec = style.get(part) or {}
        bits = [spec.get("fontFamily", "").split(",")[0].strip("'\" ") or None,
                f"{spec['fontSize']}px" if spec.get("fontSize") else None, spec.get("color")]
        bits = [b for b in bits if b]
        if bits:
            parts.append(f"{label} {' '.join(bits)}")
    if style.get("accent"):
        parts.append(f"accento {style['accent']}")
    return ", ".join(parts) or "nessuna modifica"


def _strip_inline(content: str, props: set[str]) -> str:
    """Drop inline declarations (font-family/size/color) the style now owns, so they cannot win over it."""
    if not props or "style=" not in content:
        return content

    def fix(match: re.Match) -> str:
        quote = match.group(1)
        kept = [d.strip() for d in match.group(2).split(";") if d.strip()
                and d.split(":", 1)[0].strip().lower() not in props]
        return f"style={quote}{'; '.join(kept)}{quote}" if kept else ""

    return _STYLE_ATTR_RE.sub(fix, content)


def is_heading(block: dict) -> bool:
    roles = block.get("themeRole") if isinstance(block.get("themeRole"), dict) else {}
    if roles.get("font") in {"heading", "editorial"}:
        return True
    style = block.get("style") if isinstance(block.get("style"), dict) else {}
    size = _num(style.get("fontSize"), 18)
    bold = str(style.get("fontWeight") or "").lower() in {"bold", "600", "700", "800", "900"}
    return size >= 30 or (bold and size >= 22)


def block_role(block: dict) -> str:
    """title (main headings) / small (page numbers, captions) / body (everything else, card labels included)."""
    style = block.get("style") if isinstance(block.get("style"), dict) else {}
    size = _num(style.get("fontSize"), 18)
    if size <= 14:
        return "small"
    return "title" if is_heading(block) and size >= 30 else "body"


def _full_slide_rects(slide: dict, width: float, height: float) -> list[dict]:
    return [b for b in slide.get("blocks") or []
            if isinstance(b, dict) and b.get("type") == "rectangle"
            and _num(b.get("width")) >= width * 0.95 and _num(b.get("height")) >= height * 0.95]


def set_background(slide: dict, color: str, width: float, height: float) -> None:
    """The slide's own background plus any full-slide rectangle painted over it (Studio layouts)."""
    slide["backgroundColor"] = color
    for rect in _full_slide_rects(slide, width, height):
        style = rect.get("style") if isinstance(rect.get("style"), dict) else {}
        style["fill"] = color
        rect["style"] = style
        roles = rect.get("themeRole") if isinstance(rect.get("themeRole"), dict) else None
        if roles:
            roles.pop("fill", None)
            if not roles:
                rect.pop("themeRole", None)


def _apply_text(block: dict, spec: dict, ratio: float = 1.0, small: bool = False) -> bool:
    """``ratio`` scales the block's own size toward the style's size, so hierarchy (card label vs text) survives.
    ``small`` blocks (page numbers, captions) take only the typeface: their size and ink are deliberate."""
    style = block.get("style") if isinstance(block.get("style"), dict) else {}
    changed = False
    spec = {"fontFamily": spec["fontFamily"]} if small and "fontFamily" in spec else ({} if small else spec)
    for key in TEXT_PROPS:
        if key not in spec:
            continue
        value = spec[key]
        if key == "fontSize":
            value = round(max(10.0, min(140.0, _num(style.get("fontSize"), spec[key]) * ratio)))
        if style.get(key) != value:
            style[key] = value
            changed = True
    block["style"] = style
    roles = block.get("themeRole") if isinstance(block.get("themeRole"), dict) else None
    if roles:
        for key, role in ROLE_KEYS.items():
            if key in spec:
                roles.pop(role, None)
        if not roles:
            block.pop("themeRole", None)
    owned = {INLINE_KEYS[k] for k in INLINE_KEYS if k in spec}
    if "fontSize" in spec:
        owned.add("font-size")
    if owned and isinstance(block.get("content"), str):
        stripped = _strip_inline(block["content"], owned)
        if stripped != block["content"]:
            block["content"] = stripped
            changed = True
    return changed


def apply_style_to_slide(slide: dict, style: dict, width: float, height: float) -> bool:
    """Returns True when anything changed. ``style`` must already be normalised."""
    changed = False
    if style.get("background") and slide.get("backgroundColor") != style["background"]:
        set_background(slide, style["background"], width, height)
        changed = True
    elif style.get("background"):
        set_background(slide, style["background"], width, height)
    texts = [b for b in slide.get("blocks") or [] if isinstance(b, dict) and b.get("type") == "text"]
    sizes = {"title": [], "body": []}
    for b in texts:
        role = block_role(b)
        if role in sizes:
            sizes[role].append(_num((b.get("style") or {}).get("fontSize"), 18))
    ratios = {}
    for role in ("title", "body"):
        target = (style.get(role) or {}).get("fontSize")
        ratios[role] = (target / statistics.median_low(sizes[role])) if target and sizes[role] else 1.0
    for block in slide.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            role = block_role(block)
            spec = style.get("title") if role == "title" else style.get("body")
            if spec and _apply_text(block, spec, ratios.get(role, 1.0), small=role == "small"):
                changed = True
        elif style.get("accent") and block.get("type") in {"rectangle", "ellipse", "line"} and block not in _full_slide_rects(slide, width, height):
            roles = block.get("themeRole") if isinstance(block.get("themeRole"), dict) else {}
            if roles.get("fill") in {"accent", "primary"} or roles.get("stroke") in {"accent", "primary"}:
                s = block.get("style") if isinstance(block.get("style"), dict) else {}
                if roles.get("fill") in {"accent", "primary"}:
                    s["fill"] = style["accent"]
                if roles.get("stroke") in {"accent", "primary"}:
                    s["stroke"] = style["accent"]
                block["style"] = s
                block["themeRole"] = {k: v for k, v in roles.items() if k not in {"fill", "stroke"}}
                changed = True
    if changed and slide.get("layout") and not slide.get("customized"):
        slide["customized"] = True  # its Studio render is stale now: a theme switch must keep this style
    return changed


def _ensure_readable(slide: dict, style: dict) -> None:
    """Background changed without an explicit text colour: text that no longer reads gets a readable ink."""
    bg = clean_color(slide.get("backgroundColor"))
    if not bg:
        return
    for block in slide.get("blocks") or []:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        role = block_role(block)
        spec = style.get("title") if role == "title" else style.get("body")
        if role == "small" or (spec and spec.get("color")):
            continue
        s = block.get("style") if isinstance(block.get("style"), dict) else {}
        current = clean_color(s.get("color"))
        if current is None or contrast_ratio(current, bg) < 4.5:
            s["color"] = readable_on(bg, ["#1A1A2E", "#111827", "#FFFFFF"], 7.0)
            block["style"] = s
            roles = block.get("themeRole") if isinstance(block.get("themeRole"), dict) else None
            if roles:
                roles.pop("color", None)
            if isinstance(block.get("content"), str):
                block["content"] = _strip_inline(block["content"], {"color"})


def apply_style(slides: list[dict], style: dict, width: float, height: float, theme: Optional[dict] = None,
                slide_ids: Optional[list[str]] = None) -> tuple[list[dict], int]:
    """Copy of ``slides`` with the style applied to ``slide_ids`` (all when None). Returns (slides, changed_count)."""
    style = normalize_style(style)
    work = json.loads(json.dumps([s for s in slides if isinstance(s, dict)]))
    wanted = {str(i) for i in slide_ids} if slide_ids else None
    changed = 0
    touched = []
    for slide in work:
        if wanted is not None and str(slide.get("id")) not in wanted:
            continue
        if apply_style_to_slide(slide, style, width, height):
            changed += 1
        if style.get("background"):
            _ensure_readable(slide, style)
        touched.append(slide)
    if touched:
        check_and_fix_slides(touched, width, height, theme)
    return work, changed
