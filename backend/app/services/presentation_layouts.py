"""Deterministic slide layout rendering for AI-generated presentations.

Root-cause fixes for malformed AI slides:
- the LLM never emits pixel geometry: it picks a named *layout* and writes the structured
  content (title, points, a stat, a quote...); these renderers turn that into concrete,
  in-bounds, text-fit blocks;
- the LLM never picks colours: every colour comes from a semantic role of a resolved theme
  (see presentation_themes.resolve_theme), whose text roles are contrast-checked. Each generated
  block records its roles in ``themeRole`` so the editor can switch theme later without
  re-generating (and without losing the user's manual edits);
- there are no decorative shapes without a purpose: shapes are backgrounds, cards, list markers
  or a single theme motif.

Used by the Presentation Studio (outline → template → render), by the one-shot chat generator
(POST /llm/presentations/agent) and by its fallback, so there is one source of truth.
"""
import html
import math
import uuid
from typing import Optional
from urllib.parse import quote_plus

from app.services.presentation_themes import resolve_theme

# ---------------------------------------------------------------------------
# Text fitting: estimates wrapped line count from content length / box width / font size using a
# character-width heuristic (no headless browser server-side). Also used by the sanitizer and the
# quality pass as a defense-in-depth check for blocks that don't come from a layout renderer.
# ---------------------------------------------------------------------------

AVG_CHAR_WIDTH_EM = 0.53  # heuristic average glyph width for common UI sans-serif fonts, in em
_FONT_WIDTH_EM = {"lexend": 0.58, "plus jakarta": 0.55, "georgia": 0.51, "inter": 0.53}


def _char_width_for(font_family: str) -> float:
    family = (font_family or "").lower()
    for key, width in _FONT_WIDTH_EM.items():
        if family.startswith(key) or family.startswith(f"'{key}"):
            return width
    return AVG_CHAR_WIDTH_EM


def estimate_wrapped_lines(text: str, box_width: float, font_size: float, char_width_em: float = AVG_CHAR_WIDTH_EM) -> int:
    if not text:
        return 1
    chars_per_line = max(1, int(box_width / max(1.0, font_size * char_width_em)))
    lines = 0
    for paragraph in text.split("\n") or [""]:
        # Word-wrap wastes the tail of each line: approximate with a 0.92 fill factor.
        lines += max(1, math.ceil(len(paragraph) / max(1, chars_per_line * 0.95)))
    return max(1, lines)


def estimate_text_height(text: str, box_width: float, font_size: float, line_height: float, padding: float = 0,
                         char_width_em: float = AVG_CHAR_WIDTH_EM) -> float:
    lines = estimate_wrapped_lines(text, max(1.0, box_width - 2 * padding), font_size, char_width_em)
    return lines * font_size * line_height + 2 * padding


def fit_font_size(
    text: str,
    box_width: float,
    box_height: float,
    base_font_size: float,
    min_font_size: float = 10,
    line_height: float = 1.25,
    padding: float = 0,
    char_width_em: float = AVG_CHAR_WIDTH_EM,
) -> float:
    """Shrinks font size step-wise until the estimated wrapped text height fits the box."""
    font_size = base_font_size
    while font_size > min_font_size:
        if estimate_text_height(text, box_width, font_size, line_height, padding, char_width_em) <= box_height:
            return font_size
        font_size -= 1
    return min_font_size


# ---------------------------------------------------------------------------
# Content normalisation: accepts both the Studio outline fields and the older composer fields.
# ---------------------------------------------------------------------------

def _clean_list(value, limit: int = 6) -> list[str]:
    if isinstance(value, str):
        value = [line for line in value.split("\n")]
    if not isinstance(value, list):
        return []
    return [str(item).strip()[:220] for item in value if str(item).strip()][:limit]


def normalize_content(content: Optional[dict]) -> dict:
    content = content if isinstance(content, dict) else {}
    points = _clean_list(content.get("points") or content.get("bullets") or content.get("steps") or content.get("left_bullets"))
    points_right = _clean_list(content.get("points_right") or content.get("right_bullets"))
    return {
        "title": str(content.get("title") or "").strip()[:160],
        "subtitle": str(content.get("subtitle") or content.get("supporting_text") or "").strip()[:280],
        "points": points,
        "points_right": points_right,
        "left_label": str(content.get("left_label") or "").strip()[:60],
        "right_label": str(content.get("right_label") or "").strip()[:60],
        "stat_value": str(content.get("stat_value") or "").strip()[:24],
        "stat_label": str(content.get("stat_label") or "").strip()[:120],
        "quote": str(content.get("quote") or content.get("quote_text") or "").strip()[:360],
        "attribution": str(content.get("attribution") or "").strip()[:80],
        "image_prompt": str(content.get("image_prompt") or "").strip()[:200],
    }


# ---------------------------------------------------------------------------
# Themed block kit
# ---------------------------------------------------------------------------

class _Kit:
    def __init__(self, width: float, height: float, theme: dict):
        self.w = width
        self.h = height
        self.theme = theme
        self.c = theme["colors"]
        self.fonts = theme["fonts"]
        self.scale = 1.15 if theme.get("options", {}).get("large_text") else 1.0
        self.mx = width * 0.07
        self.blocks: list[dict] = []

    def size(self, base: float) -> float:
        return base * self.scale

    def _add(self, block: dict) -> dict:
        block["id"] = str(uuid.uuid4())
        block["zIndex"] = len(self.blocks)
        block["rotation"] = 0
        self.blocks.append(block)
        return block

    def rect(self, x, y, w, h, fill_role: str, *, radius=0, stroke_role: Optional[str] = None, stroke_width=0):
        role = {"fill": fill_role}
        if stroke_role:
            role["stroke"] = stroke_role
        return self._add({
            "type": "rectangle", "content": "", "x": round(x, 1), "y": round(y, 1), "width": round(w, 1), "height": round(h, 1),
            "style": {"fill": self.c[fill_role], "stroke": self.c[stroke_role] if stroke_role else self.c[fill_role],
                      "strokeWidth": stroke_width, "cornerRadius": radius},
            "themeRole": role,
        })

    def ellipse(self, x, y, w, h, fill_role: str):
        return self._add({
            "type": "ellipse", "content": "", "x": round(x, 1), "y": round(y, 1), "width": round(w, 1), "height": round(h, 1),
            "style": {"fill": self.c[fill_role], "stroke": self.c[fill_role], "strokeWidth": 0},
            "themeRole": {"fill": fill_role},
        })

    def line(self, x, y, w, stroke_role: str, stroke_width=2):
        return self._add({
            "type": "line", "content": "", "x": round(x, 1), "y": round(y, 1), "width": round(w, 1), "height": 0,
            "style": {"stroke": self.c[stroke_role], "strokeWidth": stroke_width},
            "themeRole": {"stroke": stroke_role},
        })

    def text(self, x, y, w, h, text: str, *, color_role: str, font: str = "body", base: float = 20,
             minimum: float = 12, weight: str = "normal", align: str = "left", line_height: float = 1.3,
             italic: bool = False, fixed_size: Optional[float] = None):
        text = (text or "").strip()
        if not text:
            return None
        family = self.fonts[font]
        size = fixed_size or fit_font_size(text, w, h, self.size(base), min_font_size=minimum, line_height=line_height,
                                           char_width_em=_char_width_for(family))
        style = {
            "fontFamily": family, "fontSize": round(size), "color": self.c[color_role], "backgroundColor": "transparent",
            "fontWeight": weight, "textAlign": align, "lineHeight": line_height, "padding": 0, "borderRadius": 0,
        }
        if italic:
            style["fontStyle"] = "italic"
        return self._add({
            "type": "text", "content": f"<p>{html.escape(text, quote=False)}</p>",
            "x": round(x, 1), "y": round(y, 1), "width": round(w, 1), "height": round(h, 1),
            "style": style, "themeRole": {"color": color_role, "font": font},
        })

    def image(self, x, y, w, h, prompt: str):
        label = quote_plus(("Immagine: " + (prompt or "da scegliere"))[:60])
        bg = self.c["surface"].lstrip("#")
        fg = self.c["muted"].lstrip("#")
        return self._add({
            "type": "image",
            "content": f"https://placehold.co/{int(w)}x{int(h)}/{bg}/{fg}/png?text={label}&font=inter",
            "x": round(x, 1), "y": round(y, 1), "width": round(w, 1), "height": round(h, 1),
            "style": {"borderRadius": 14, "padding": 0, "backgroundColor": "transparent"},
            "imagePrompt": prompt,
        })

    # -- composite helpers ---------------------------------------------------

    def background(self, role: str = "background"):
        # Locked: clicking empty slide space must not grab (and drag) the whole background.
        self.rect(0, 0, self.w, self.h, role)["locked"] = True

    def measure(self, text: str, width: float, size: float, line_height: float = 1.25, font: str = "body") -> float:
        return estimate_text_height(text, width, size, line_height, 0, _char_width_for(self.fonts[font]))

    def motif(self):
        motif = self.theme.get("motif")
        if motif == "bar":
            self.rect(0, 0, self.w * 0.012, self.h, "primary")
        elif motif == "band":
            self.rect(0, 0, self.w, self.h * 0.016, "accent")

    def title(self, text: str, *, y: Optional[float] = None, height: Optional[float] = None, color_role: str = "text"):
        y = self.h * 0.08 if y is None else y
        height = self.h * 0.17 if height is None else height
        self.text(self.mx, y, self.w - 2 * self.mx, height, text, color_role=color_role, font="heading",
                  base=36, minimum=22, weight="bold", line_height=1.15)
        if self.theme.get("motif") == "underline" and text:
            self.rect(self.mx, y + height + self.h * 0.005, 64, 4, "accent", radius=2)

    def list_size(self, items: list[str], width: float, height: float, base: float = 22) -> float:
        """Largest uniform font size (one size per list: mixed sizes look broken) at which every item
        fits, with rows only as tall as their text."""
        text_w = width - 26
        size = self.size(base)
        while size > 14:
            gap = size * 0.7
            total = sum(self.measure(item, text_w, size) for item in items) + gap * (len(items) - 1)
            if total <= height:
                return size
            size -= 1
        return 14

    def bullet_list(self, items: list[str], x: float, y: float, w: float, h: float, *, color_role: str = "text",
                    marker_role: str = "accent", base: float = 22, size: Optional[float] = None) -> float:
        """Draw the list; returns the y where it ends."""
        if not items:
            return y
        marker = 10
        text_x = x + marker + 16
        text_w = x + w - text_x
        size = size or self.list_size(items, w, h, base)
        top = y
        for item in items:
            row_h = self.measure(item, text_w, size)
            self.rect(x, top + size * 0.65 - marker / 2, marker, marker, marker_role, radius=3)
            self.text(text_x, top, text_w, row_h + 4, item, color_role=color_role, fixed_size=size, line_height=1.25)
            top += row_h + size * 0.7
        return top - size * 0.7

    def slide_number(self, number: Optional[int], color_role: str):
        if not number or not self.theme.get("options", {}).get("slide_numbers", True):
            return
        self.text(self.w - self.mx - 60, self.h - self.h * 0.075, 60, 22, str(number), color_role=color_role,
                  fixed_size=12, align="right", line_height=1.2)


def _split_card(point: str) -> tuple[str, str]:
    for separator in (":", " — ", " – ", " - "):
        if separator in point:
            head, _, body = point.partition(separator)
            if 0 < len(head.strip()) <= 48 and body.strip():
                return head.strip(), body.strip()
    return "", point


# ---------------------------------------------------------------------------
# Layout renderers: (kit, content, slide_number) → blocks appended to kit
# ---------------------------------------------------------------------------

def layout_cover(k: _Kit, c: dict, number: Optional[int]):
    # Same background as every other slide: a cover in a different colour made a light deck look
    # like a dark theme had been chosen and then ignored.
    title = c["title"] or "Presentazione"
    k.background()
    k.rect(0, k.h * 0.94, k.w, k.h * 0.06, "primary")
    k.rect(k.mx, k.h * 0.22, 96, 6, "accent", radius=3)
    k.text(k.mx, k.h * 0.27, k.w - 2 * k.mx, k.h * 0.34, title, color_role="text", font="heading",
           base=56, minimum=30, weight="bold", line_height=1.1)
    k.text(k.mx, k.h * 0.65, k.w - 2 * k.mx, k.h * 0.2, c["subtitle"], color_role="muted",
           base=24, minimum=15, line_height=1.35)


def layout_section(k: _Kit, c: dict, number: Optional[int]):
    k.background()
    panel_w = k.w * 0.3
    k.rect(0, 0, panel_w, k.h, "primary")
    k.text(k.w * 0.04, k.h * 0.7, panel_w - k.w * 0.08, k.h * 0.18, c["subtitle"], color_role="on_primary",
           font="heading", base=26, minimum=15, weight="bold", line_height=1.2)
    k.rect(panel_w + k.mx, k.h * 0.34, 72, 6, "accent", radius=3)
    k.text(panel_w + k.mx, k.h * 0.39, k.w - panel_w - 2 * k.mx, k.h * 0.32, c["title"], color_role="text",
           font="heading", base=46, minimum=26, weight="bold", line_height=1.1)
    k.slide_number(number, "muted")


def layout_title_bullets(k: _Kit, c: dict, number: Optional[int]):
    k.background()
    k.motif()
    k.title(c["title"])
    top = k.h * 0.33
    if c["subtitle"]:
        k.text(k.mx, k.h * 0.27, k.w - 2 * k.mx, k.h * 0.08, c["subtitle"], color_role="muted", base=18, minimum=13)
        top = k.h * 0.38
    k.bullet_list(c["points"], k.mx, top, k.w - 2 * k.mx, k.h * 0.88 - top)
    k.slide_number(number, "muted")


def layout_two_column(k: _Kit, c: dict, number: Optional[int]):
    left, right = c["points"], c["points_right"]
    if not right and len(left) > 1:
        half = math.ceil(len(left) / 2)
        left, right = left[:half], left[half:]
    k.background()
    k.motif()
    k.title(c["title"])
    gap = k.w * 0.03
    col_w = (k.w - 2 * k.mx - gap) / 2
    top, bottom = k.h * 0.32, k.h * 0.88
    pad = 22
    label_h = k.h * 0.08 if (c["left_label"] or c["right_label"]) else 0
    inner_w = col_w - 2 * pad
    room = bottom - top - 2 * pad - 6 - label_h
    # Both columns share one font size and one panel height, sized on their content.
    size = min(k.list_size(items, inner_w, room, 22) for items in (left, right) if items) if (left or right) else 18
    heights = [sum(k.measure(i, inner_w - 26, size) for i in items) + size * 0.7 * max(0, len(items) - 1) for items in (left, right)]
    panel_h = min(bottom - top, max(heights) + 2 * pad + 6 + label_h + 4)
    for index, (label, items) in enumerate(((c["left_label"], left), (c["right_label"], right))):
        x = k.mx + index * (col_w + gap)
        k.rect(x, top, col_w, panel_h, "surface", radius=14, stroke_role="border", stroke_width=1)
        k.rect(x, top, col_w, 6, "primary" if index == 0 else "accent", radius=3)
        if label:
            k.text(x + pad, top + pad, inner_w, label_h, label, color_role="primary_text", font="heading",
                   base=22, minimum=15, weight="bold", line_height=1.2)
        k.bullet_list(items, x + pad, top + pad + 6 + label_h, inner_w, room, size=size)
    k.slide_number(number, "muted")


def layout_cards(k: _Kit, c: dict, number: Optional[int]):
    items = c["points"][:4] or [c["subtitle"] or c["title"]]
    k.background()
    k.motif()
    k.title(c["title"])
    n = len(items)
    gap = k.w * 0.025
    card_w = (k.w - 2 * k.mx - gap * (n - 1)) / n
    top, bottom = k.h * 0.33, k.h * 0.88
    pad = 20
    inner_w = card_w - 2 * pad
    parts = [_split_card(item) for item in items]
    head_size = k.size(24 if n <= 3 else 21)
    head_h = max((k.measure(head, inner_w, head_size, 1.15, "heading") for head, _ in parts if head), default=k.h * 0.09)
    body_room = bottom - top - 2 * pad - 6 - head_h - 12
    body_size = k.size(22 if n <= 3 else 19)
    while body_size > 14 and max(k.measure(body, inner_w, body_size, 1.3) for _, body in parts) > body_room:
        body_size -= 1
    body_h = max(k.measure(body, inner_w, body_size, 1.3) for _, body in parts)
    card_h = min(bottom - top, 2 * pad + 6 + head_h + 12 + body_h + 6)
    for index, (head, body) in enumerate(parts):
        x = k.mx + index * (card_w + gap)
        k.rect(x, top, card_w, card_h, "surface", radius=16, stroke_role="border", stroke_width=1)
        k.rect(x, top, card_w, 6, "accent", radius=3)
        k.text(x + pad, top + pad + 6, inner_w, head_h, head or f"{index + 1:02d}",
               color_role="primary_text" if head else "accent_text", font="heading", fixed_size=head_size if head else 30,
               weight="bold", line_height=1.15)
        k.text(x + pad, top + pad + 6 + head_h + 12, inner_w, body_h + 6, body, color_role="text",
               fixed_size=body_size, line_height=1.3)
    k.slide_number(number, "muted")


def layout_image_split(k: _Kit, c: dict, number: Optional[int]):
    k.background()
    k.motif()
    text_w = k.w * 0.46
    image_x = k.mx + text_w + k.w * 0.04
    image_w = k.w - k.mx - image_x
    k.text(k.mx, k.h * 0.1, text_w, k.h * 0.22, c["title"], color_role="text", font="heading", base=34,
           minimum=20, weight="bold", line_height=1.15)
    if k.theme.get("motif") == "underline" and c["title"]:
        k.rect(k.mx, k.h * 0.33, 64, 4, "accent", radius=2)
    k.bullet_list(c["points"][:4], k.mx, k.h * 0.38, text_w, k.h * 0.52, base=22)
    k.image(image_x, k.h * 0.1, image_w, k.h * 0.78, c["image_prompt"] or c["title"])
    k.slide_number(number, "muted")


def layout_big_stat(k: _Kit, c: dict, number: Optional[int]):
    k.background()
    k.motif()
    stat = c["stat_value"] or c["title"]
    k.text(k.mx, k.h * 0.12, k.w - 2 * k.mx, k.h * 0.36, stat, color_role="primary_text", font="heading", base=112,
           minimum=40, weight="bold", align="center", line_height=1.0)
    k.rect(k.w / 2 - 40, k.h * 0.5, 80, 6, "accent", radius=3)
    k.text(k.mx, k.h * 0.54, k.w - 2 * k.mx, k.h * 0.12, c["stat_label"] or (c["title"] if c["stat_value"] else ""),
           color_role="text", font="heading", base=28, minimum=16, weight="bold", align="center", line_height=1.2)
    k.text(k.w * 0.15, k.h * 0.68, k.w * 0.7, k.h * 0.2, c["subtitle"] or " ".join(c["points"][:1]),
           color_role="muted", base=21, minimum=14, align="center", line_height=1.35)
    k.slide_number(number, "muted")


def layout_timeline(k: _Kit, c: dict, number: Optional[int]):
    steps = c["points"][:5]
    k.background()
    k.motif()
    k.title(c["title"])
    n = max(1, len(steps))
    col_w = (k.w - 2 * k.mx) / n
    track_y = k.h * 0.44
    dot = 36
    k.line(k.mx + col_w / 2, track_y, (k.w - 2 * k.mx) - col_w, "border", stroke_width=3)
    family = k.fonts["body"]
    text_w = col_w * 0.88
    text_h = k.h * 0.34
    size = min(fit_font_size(step, text_w, text_h, k.size(20), min_font_size=14, line_height=1.3,
                             char_width_em=_char_width_for(family)) for step in steps) if steps else 16
    for index, step in enumerate(steps):
        cx = k.mx + col_w * index + col_w / 2
        k.ellipse(cx - dot / 2, track_y - dot / 2, dot, dot, "accent")
        k.text(cx - dot / 2, track_y - 10, dot, 20, str(index + 1), color_role="on_accent", fixed_size=14,
               weight="bold", align="center", line_height=1.2)
        k.text(cx - text_w / 2, track_y + dot / 2 + 14, text_w, text_h, step, color_role="text", fixed_size=size,
               align="center", line_height=1.3)
    k.slide_number(number, "muted")


def layout_quote(k: _Kit, c: dict, number: Optional[int]):
    k.background()
    k.motif()
    k.text(k.mx, k.h * 0.08, 120, 120, "“", color_role="accent_text", font="heading", fixed_size=120,
           weight="bold", line_height=1.0)
    k.text(k.mx + k.w * 0.05, k.h * 0.3, k.w - 2 * k.mx - k.w * 0.1, k.h * 0.38, c["quote"] or c["title"],
           color_role="text", font="heading", base=32, minimum=18, line_height=1.3, italic=True)
    attribution = c["attribution"]
    k.text(k.mx + k.w * 0.05, k.h * 0.72, k.w - 2 * k.mx - k.w * 0.1, k.h * 0.08,
           f"— {attribution}" if attribution else "", color_role="muted", base=18, minimum=13, weight="bold")
    k.slide_number(number, "muted")


def layout_summary(k: _Kit, c: dict, number: Optional[int]):
    k.background()
    k.motif()
    k.title(c["title"] or "In sintesi")
    items = c["points"][:5]
    top, bottom = k.h * 0.32, k.h * 0.88
    pad = 26
    inner_w = k.w - 2 * k.mx - 2 * pad
    size = k.list_size(items, inner_w, bottom - top - 2 * pad, 23) if items else 20
    content_h = sum(k.measure(i, inner_w - 26, size) for i in items) + size * 0.7 * max(0, len(items) - 1)
    k.rect(k.mx, top, k.w - 2 * k.mx, min(bottom - top, content_h + 2 * pad + 4), "surface", radius=18,
           stroke_role="border", stroke_width=1)
    k.rect(k.mx, top, 8, min(bottom - top, content_h + 2 * pad + 4), "primary", radius=4)
    k.bullet_list(items, k.mx + pad, top + pad, inner_w, bottom - top - 2 * pad, size=size)
    k.slide_number(number, "muted")


LAYOUTS: dict[str, dict] = {
    "cover": {"render": layout_cover, "label": "Copertina", "fields": ["title", "subtitle"]},
    "section": {"render": layout_section, "label": "Divisore di sezione", "fields": ["title", "subtitle"]},
    "title_bullets": {"render": layout_title_bullets, "label": "Titolo ed elenco", "fields": ["title", "subtitle", "points"]},
    "two_column": {"render": layout_two_column, "label": "Due colonne / confronto",
                   "fields": ["title", "left_label", "points", "right_label", "points_right"]},
    "cards": {"render": layout_cards, "label": "Schede (2–4 concetti)", "fields": ["title", "points"]},
    "image_split": {"render": layout_image_split, "label": "Testo e immagine", "fields": ["title", "points", "image_prompt"]},
    "big_stat": {"render": layout_big_stat, "label": "Dato in evidenza", "fields": ["stat_value", "stat_label", "subtitle"]},
    "timeline": {"render": layout_timeline, "label": "Sequenza / processo", "fields": ["title", "points"]},
    "quote": {"render": layout_quote, "label": "Citazione", "fields": ["quote", "attribution"]},
    "summary": {"render": layout_summary, "label": "Sintesi finale", "fields": ["title", "points"]},
}

DEFAULT_LAYOUT = "title_bullets"


def coerce_layout(layout_key: Optional[str], content: dict, *, images: bool = True) -> str:
    """Valid layout for this content: never a big-stat without a stat, a quote without a quote,
    an image slide when images are off, or a list layout with nothing to list."""
    key = layout_key if layout_key in LAYOUTS else DEFAULT_LAYOUT
    points = content.get("points") or []
    if key == "big_stat" and not content.get("stat_value"):
        key = DEFAULT_LAYOUT
    if key == "quote" and not content.get("quote"):
        key = DEFAULT_LAYOUT
    if key == "image_split" and not images:
        key = DEFAULT_LAYOUT
    if key == "cards" and not (2 <= len(points) <= 4):
        key = DEFAULT_LAYOUT
    if key == "timeline" and len(points) < 2:
        key = DEFAULT_LAYOUT
    if key == "two_column" and len(points) + len(content.get("points_right") or []) < 2:
        key = DEFAULT_LAYOUT
    return key


def choose_layout(role: Optional[str], key_points: Optional[list], visual_idea: Optional[str]) -> str:
    """Deterministic layout choice from a strategist's per-slide intent (one-shot chat generator)."""
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
    if any(word in idea for word in ("immagine", "foto", "illustrazione", "photo", "image")):
        return "image_split"
    if 3 <= len(points) <= 4 and word_count <= 40:
        return "cards"
    if word_count > 45:
        return "two_column"
    return "title_bullets"


def _theme_from_style(style: Optional[dict]) -> dict:
    if isinstance(style, dict) and isinstance(style.get("colors"), dict) and style.get("fonts"):
        return style
    theme_id = style.get("theme_id") if isinstance(style, dict) else None
    return resolve_theme(theme_id)


def render_slide_blocks(layout_key: str, width: float, height: float, content: dict, style: Optional[dict] = None,
                        slide_number: Optional[int] = None) -> list:
    """Render one slide. `style` is a resolved theme (presentation_themes.resolve_theme); anything
    else falls back to the default theme, so legacy callers keep working."""
    theme = _theme_from_style(style)
    normalized = normalize_content(content)
    key = coerce_layout(layout_key, normalized, images=theme.get("options", {}).get("images", True))
    kit = _Kit(width, height, theme)
    try:
        LAYOUTS[key]["render"](kit, normalized, slide_number)
    except Exception:
        # A malformed content dict must degrade to *something* renderable, not a 500.
        kit = _Kit(width, height, theme)
        layout_title_bullets(kit, normalized, slide_number)
    return kit.blocks


def render_outline_slide(slide: dict, index: int, width: float, height: float, theme: dict) -> dict:
    """Studio outline slide → editor slide, keeping layout + content so it can be re-rendered."""
    content = normalize_content(slide)
    key = coerce_layout(slide.get("layout"), content, images=theme.get("options", {}).get("images", True))
    if index == 0 and slide.get("layout") in (None, "", "cover"):
        key = "cover"
    blocks = render_slide_blocks(key, width, height, content, theme, slide_number=index + 1 if key != "cover" else None)
    return {
        "id": str(slide.get("id") or uuid.uuid4()),
        "title": (content["title"] or content["stat_value"] or content["quote"][:60] or f"Slide {index + 1}")[:120],
        "speakerNotes": str(slide.get("notes") or slide.get("speaker_notes") or "").strip()[:2000],
        "layout": key,
        "content": content,
        "blocks": blocks,
    }

