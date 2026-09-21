"""Deterministic slide layout rendering for the AI presentation generator.

Root-cause fix for AI-generated slides being malformed (text overflowing its box, layout not
matching content volume): the LLM used to be asked to freehand emit exact pixel x/y/width/height
for every block, which it is unreliable at. Instead, the LLM now only chooses *intent* — which
named layout fits a slide's content, and the structured content itself (title, bullets, a stat,
an image idea, ...) — and this module turns that into concrete, in-bounds, text-fit geometry.

Both the primary generation path (POST /llm/presentations/agent) and the hardcoded fallback
payload share these renderers, so there is one source of truth for "what a cover/title+bullets/
etc. slide looks like" instead of two.
"""
import math
from dataclasses import dataclass, field
from typing import Callable, Optional


# ---------------------------------------------------------------------------
# Text fitting: estimates wrapped line count from content length / box width / font size using a
# character-width heuristic (no headless browser available server-side). Used both by the layout
# renderers below (to size a text box to its content) and as a defense-in-depth check in the
# sanitizer for anything that doesn't go through a layout renderer (single-block targeted edits,
# manual user edits sent back to the server).
# ---------------------------------------------------------------------------

AVG_CHAR_WIDTH_EM = 0.56  # heuristic average glyph width for common UI sans-serif fonts, in em


def estimate_wrapped_lines(text: str, box_width: float, font_size: float) -> int:
    if not text:
        return 1
    chars_per_line = max(1, int(box_width / max(1.0, font_size * AVG_CHAR_WIDTH_EM)))
    lines = 0
    for paragraph in text.split("\n") or [""]:
        lines += max(1, math.ceil(len(paragraph) / chars_per_line))
    return max(1, lines)


def estimate_text_height(text: str, box_width: float, font_size: float, line_height: float, padding: float = 0) -> float:
    lines = estimate_wrapped_lines(text, max(1.0, box_width - 2 * padding), font_size)
    return lines * font_size * line_height + 2 * padding


def fit_font_size(
    text: str,
    box_width: float,
    box_height: float,
    base_font_size: float,
    min_font_size: float = 10,
    line_height: float = 1.25,
    padding: float = 0,
) -> float:
    """Shrinks font size step-wise until the estimated wrapped text height fits the box."""
    font_size = base_font_size
    while font_size > min_font_size:
        if estimate_text_height(text, box_width, font_size, line_height, padding) <= box_height:
            return font_size
        font_size -= 1
    return min_font_size


# ---------------------------------------------------------------------------
# Block builders — small helpers producing the raw dicts the frontend's SlideBlock model expects.
# ---------------------------------------------------------------------------

def _text(x, y, w, h, content, *, font_size, color="#111827", weight="normal", align="left",
          line_height=1.25, family="Inter, Arial, sans-serif", bg="transparent", padding=0, border_radius=0):
    return {
        "type": "text", "content": content, "x": x, "y": y, "width": w, "height": h,
        "style": {
            "fontFamily": family, "fontSize": round(font_size), "color": color, "backgroundColor": bg,
            "fontWeight": weight, "textAlign": align, "lineHeight": line_height,
            "padding": padding, "borderRadius": border_radius,
        },
    }


def _rect(x, y, w, h, *, fill, radius=0, stroke=None, stroke_width=0):
    return {
        "type": "rectangle", "content": "", "x": x, "y": y, "width": w, "height": h,
        "style": {"fill": fill, "stroke": stroke or fill, "strokeWidth": stroke_width, "cornerRadius": radius},
    }


def _ellipse(x, y, w, h, *, fill):
    return {"type": "ellipse", "content": "", "x": x, "y": y, "width": w, "height": h,
            "style": {"fill": fill, "stroke": fill, "strokeWidth": 0}}


def _line(x, y, w, h, *, stroke, stroke_width=2):
    return {"type": "line", "content": "", "x": x, "y": y, "width": w, "height": h,
            "style": {"stroke": stroke, "strokeWidth": stroke_width}}


def _image(x, y, w, h, prompt: str, *, radius=12):
    slug = "+".join((prompt or "Immagine").split()[:6]) or "Immagine"
    return {
        "type": "image", "content": f"https://placehold.co/{int(w)}x{int(h)}?text={slug}",
        "x": x, "y": y, "width": w, "height": h,
        "style": {"borderRadius": radius, "padding": 0, "backgroundColor": "transparent"},
    }


Palette = dict


DEFAULT_PALETTE: Palette = {
    "background": "#F8FAFC", "surface": "#FFFFFF", "primary": "#4F46E5",
    "accent": "#06B6D4", "text": "#0F172A", "muted": "#475569",
}


def _palette_from_style(style: Optional[dict]) -> Palette:
    if not isinstance(style, dict):
        return DEFAULT_PALETTE
    p = style.get("palette") if isinstance(style.get("palette"), dict) else {}
    return {**DEFAULT_PALETTE, **{k: v for k, v in p.items() if isinstance(v, str)}}


# ---------------------------------------------------------------------------
# Layout renderers. Each takes (width, height, content, palette) and returns a list of block
# dicts. `content` fields are all optional with sane fallbacks so a partially-filled LLM
# response still renders something reasonable rather than an empty slide.
# ---------------------------------------------------------------------------

def layout_cover(w, h, content, palette):
    title = str(content.get("title") or "Presentazione")
    subtitle = str(content.get("subtitle") or "")
    margin = w * 0.08
    blocks = [
        _rect(0, 0, w, h, fill=palette["background"]),
        _rect(0, h * 0.62, w, h * 0.06, fill=palette["primary"]),
    ]
    title_size = fit_font_size(title, w - 2 * margin, h * 0.32, base_font_size=min(56, h * 0.14), min_font_size=28, line_height=1.1)
    blocks.append(_text(margin, h * 0.32, w - 2 * margin, h * 0.32, title, font_size=title_size,
                         color=palette["text"], weight="bold", line_height=1.1, family="Inter, Arial, sans-serif"))
    if subtitle:
        blocks.append(_text(margin, h * 0.68, w - 2 * margin, h * 0.16, subtitle,
                             font_size=min(22, h * 0.05), color=palette["muted"], line_height=1.3))
    return blocks


def layout_title_bullets(w, h, content, palette):
    title = str(content.get("title") or "")
    bullets = [str(b) for b in (content.get("bullets") or []) if str(b).strip()][:5]
    margin = w * 0.07
    blocks = [_rect(0, 0, w, h, fill=palette["surface"]), _rect(0, 0, w * 0.015, h, fill=palette["primary"])]
    title_h = h * 0.2
    title_size = fit_font_size(title, w - 2 * margin, title_h, base_font_size=min(36, h * 0.09), min_font_size=22, line_height=1.15)
    blocks.append(_text(margin, h * 0.08, w - 2 * margin, title_h, title, font_size=title_size,
                         color=palette["text"], weight="bold", line_height=1.15))
    body_top = h * 0.32
    body_height = h * 0.6
    row_h = body_height / max(1, len(bullets))
    for i, bullet in enumerate(bullets):
        y = body_top + i * row_h
        blocks.append(_ellipse(margin, y + row_h * 0.28, row_h * 0.32, row_h * 0.32, fill=palette["accent"]))
        text_x = margin + row_h * 0.32 + margin * 0.4
        text_w = w - margin - text_x
        font_size = fit_font_size(bullet, text_w, row_h * 0.9, base_font_size=min(20, row_h * 0.4), min_font_size=12, line_height=1.25)
        blocks.append(_text(text_x, y, text_w, row_h * 0.95, bullet, font_size=font_size, color=palette["text"], line_height=1.25))
    return blocks


def layout_two_column(w, h, content, palette):
    title = str(content.get("title") or "")
    left = [str(b) for b in (content.get("left_bullets") or content.get("columns", {}).get("left") or []) if str(b).strip()][:4]
    right = [str(b) for b in (content.get("right_bullets") or content.get("columns", {}).get("right") or []) if str(b).strip()][:4]
    margin = w * 0.07
    blocks = [_rect(0, 0, w, h, fill=palette["background"])]
    title_size = fit_font_size(title, w - 2 * margin, h * 0.16, base_font_size=min(32, h * 0.08), min_font_size=20, line_height=1.15)
    blocks.append(_text(margin, h * 0.06, w - 2 * margin, h * 0.16, title, font_size=title_size,
                         color=palette["text"], weight="bold", line_height=1.15))
    col_gap = w * 0.05
    col_w = (w - 2 * margin - col_gap) / 2
    col_top = h * 0.28
    col_h = h * 0.64
    for col_index, (items, fill) in enumerate([(left, palette["primary"]), (right, palette["accent"])]):
        x = margin + col_index * (col_w + col_gap)
        blocks.append(_rect(x, col_top, col_w, h * 0.015, fill=fill))
        row_h = col_h / max(1, len(items))
        for i, item in enumerate(items):
            y = col_top + h * 0.04 + i * row_h
            font_size = fit_font_size(item, col_w, row_h * 0.85, base_font_size=min(18, row_h * 0.35), min_font_size=11, line_height=1.25)
            blocks.append(_text(x, y, col_w, row_h * 0.9, item, font_size=font_size, color=palette["text"], line_height=1.25))
    return blocks


def layout_image_split(w, h, content, palette):
    title = str(content.get("title") or "")
    bullets = [str(b) for b in (content.get("bullets") or []) if str(b).strip()][:4]
    image_prompt = str(content.get("image_prompt") or title)
    margin = w * 0.06
    image_right = bool(content.get("image_right", True))
    text_w = w * 0.46
    image_w = w - 2 * margin - text_w - margin
    text_x = margin if not image_right else margin
    image_x = margin + text_w + margin if image_right else margin
    if not image_right:
        text_x = margin + image_w + margin

    blocks = [_rect(0, 0, w, h, fill=palette["surface"])]
    blocks.append(_image(image_x if image_right else margin, h * 0.12, image_w, h * 0.76, image_prompt))
    title_size = fit_font_size(title, text_w, h * 0.22, base_font_size=min(30, h * 0.08), min_font_size=18, line_height=1.15)
    blocks.append(_text(text_x, h * 0.12, text_w, h * 0.22, title, font_size=title_size,
                         color=palette["text"], weight="bold", line_height=1.15))
    body_top = h * 0.38
    body_h = h * 0.5
    row_h = body_h / max(1, len(bullets))
    for i, bullet in enumerate(bullets):
        y = body_top + i * row_h
        font_size = fit_font_size(bullet, text_w, row_h * 0.85, base_font_size=min(18, row_h * 0.4), min_font_size=11, line_height=1.3)
        blocks.append(_text(text_x, y, text_w, row_h * 0.9, bullet, font_size=font_size, color=palette["muted"], line_height=1.3))
    return blocks


def layout_big_stat(w, h, content, palette):
    stat_value = str(content.get("stat_value") or content.get("title") or "")
    stat_label = str(content.get("stat_label") or "")
    supporting = str(content.get("supporting_text") or content.get("quote_text") or "")
    margin = w * 0.1
    blocks = [_rect(0, 0, w, h, fill=palette["primary"])]
    stat_size = fit_font_size(stat_value, w - 2 * margin, h * 0.4, base_font_size=min(96, h * 0.3), min_font_size=36, line_height=1.0)
    blocks.append(_text(margin, h * 0.14, w - 2 * margin, h * 0.4, stat_value, font_size=stat_size,
                         color="#FFFFFF", weight="bold", align="center", line_height=1.0))
    if stat_label:
        blocks.append(_text(margin, h * 0.56, w - 2 * margin, h * 0.14, stat_label,
                             font_size=min(24, h * 0.06), color="#E0E7FF", align="center", line_height=1.2))
    if supporting:
        font_size = fit_font_size(supporting, w - 2 * margin, h * 0.22, base_font_size=min(18, h * 0.05), min_font_size=12, line_height=1.3)
        blocks.append(_text(margin, h * 0.72, w - 2 * margin, h * 0.22, supporting,
                             font_size=font_size, color="#FFFFFF", align="center", line_height=1.3))
    return blocks


def layout_timeline(w, h, content, palette):
    title = str(content.get("title") or "")
    steps = [str(s) for s in (content.get("steps") or content.get("bullets") or []) if str(s).strip()][:5]
    margin = w * 0.07
    blocks = [_rect(0, 0, w, h, fill=palette["background"])]
    title_size = fit_font_size(title, w - 2 * margin, h * 0.16, base_font_size=min(30, h * 0.08), min_font_size=18, line_height=1.15)
    blocks.append(_text(margin, h * 0.06, w - 2 * margin, h * 0.16, title, font_size=title_size,
                         color=palette["text"], weight="bold", line_height=1.15))
    track_y = h * 0.46
    blocks.append(_line(margin, track_y, w - 2 * margin, 0, stroke=palette["muted"], stroke_width=2))
    n = max(1, len(steps))
    col_w = (w - 2 * margin) / n
    dot = min(28, col_w * 0.2)
    for i, step in enumerate(steps):
        cx = margin + col_w * i + col_w * 0.5
        blocks.append(_ellipse(cx - dot / 2, track_y - dot / 2, dot, dot, fill=palette["accent"]))
        text_w = col_w * 0.9
        font_size = fit_font_size(step, text_w, h * 0.28, base_font_size=min(16, h * 0.04), min_font_size=10, line_height=1.25)
        blocks.append(_text(cx - text_w / 2, track_y + dot, text_w, h * 0.28, step,
                             font_size=font_size, color=palette["text"], align="center", line_height=1.25))
    return blocks


def layout_summary(w, h, content, palette):
    title = str(content.get("title") or "In sintesi")
    bullets = [str(b) for b in (content.get("bullets") or []) if str(b).strip()][:4]
    margin = w * 0.08
    blocks = [
        _rect(0, 0, w, h, fill=palette["text"]),
        _text(margin, h * 0.1, w - 2 * margin, h * 0.18, title,
              font_size=min(34, h * 0.09), color="#FFFFFF", weight="bold", line_height=1.15),
    ]
    body_top = h * 0.34
    body_h = h * 0.58
    row_h = body_h / max(1, len(bullets))
    for i, bullet in enumerate(bullets):
        y = body_top + i * row_h
        blocks.append(_rect(margin, y + row_h * 0.35, row_h * 0.14, row_h * 0.14, fill=palette["accent"], radius=3))
        text_x = margin + row_h * 0.14 + margin * 0.5
        text_w = w - margin - text_x
        font_size = fit_font_size(bullet, text_w, row_h * 0.85, base_font_size=min(19, row_h * 0.38), min_font_size=12, line_height=1.25)
        blocks.append(_text(text_x, y, text_w, row_h * 0.9, bullet, font_size=font_size, color="#F1F5F9", line_height=1.25))
    return blocks


@dataclass(frozen=True)
class LayoutSpec:
    render: Callable[[float, float, dict, Palette], list]
    fields: list = field(default_factory=list)  # structured content fields the composer LLM should fill for this layout


LAYOUT_REGISTRY: dict[str, LayoutSpec] = {
    "cover": LayoutSpec(layout_cover, ["title", "subtitle"]),
    "title_bullets": LayoutSpec(layout_title_bullets, ["title", "bullets"]),
    "two_column": LayoutSpec(layout_two_column, ["title", "left_bullets", "right_bullets"]),
    "image_split": LayoutSpec(layout_image_split, ["title", "bullets", "image_prompt"]),
    "big_stat": LayoutSpec(layout_big_stat, ["stat_value", "stat_label", "supporting_text"]),
    "timeline": LayoutSpec(layout_timeline, ["title", "steps"]),
    "summary": LayoutSpec(layout_summary, ["title", "bullets"]),
}

DEFAULT_LAYOUT = "title_bullets"


def choose_layout(role: Optional[str], key_points: Optional[list], visual_idea: Optional[str]) -> str:
    """Deterministic layout choice from the strategist's per-slide intent — the actual fix for
    "layout should adapt to content volume/type" instead of leaving it to LLM freehand judgement."""
    role = (role or "").strip().lower()
    idea = (visual_idea or "").strip().lower()
    points = [str(p) for p in (key_points or []) if str(p).strip()]
    word_count = sum(len(p.split()) for p in points)

    if role == "cover":
        return "cover"
    if role == "summary":
        return "summary"
    if role == "process":
        return "timeline"
    if role == "comparison" or len(points) == 2 and word_count > 12:
        return "two_column"
    if any(word in idea for word in ("immagine", "foto", "grafico", "diagramma", "illustrazione", "photo", "image")):
        return "image_split"
    if len(points) <= 1 and word_count <= 12:
        return "big_stat"
    if word_count > 45:
        return "two_column"
    return "title_bullets"


def render_slide_blocks(layout_key: str, width: float, height: float, content: dict, style: Optional[dict] = None) -> list:
    spec = LAYOUT_REGISTRY.get(layout_key) or LAYOUT_REGISTRY[DEFAULT_LAYOUT]
    palette = _palette_from_style(style)
    try:
        return spec.render(width, height, content or {}, palette)
    except Exception:
        # A malformed content dict must degrade to *something* renderable, not a 500.
        return LAYOUT_REGISTRY[DEFAULT_LAYOUT].render(width, height, content or {}, palette)
