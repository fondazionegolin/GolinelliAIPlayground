"""Curated, contrast-checked presentation themes for the Presentation Studio.

Root-cause fix for "white text on a white background": the art-director LLM used to invent a
free palette and the layouts paired it with hard-coded text colours (e.g. #FFFFFF on `primary`),
so any light palette produced unreadable slides. Now the LLM can only *recommend* one of these
themes by id, and every text colour a layout uses comes from a semantic role (``on_primary``,
``on_inverse``, ...) that ``resolve_theme`` derives with a WCAG contrast check — so a readable
pairing is guaranteed by construction, including when the user overrides the accent colour.
"""
from __future__ import annotations

import re
from typing import Optional

# ---------------------------------------------------------------------------
# Colour maths (WCAG 2.x relative luminance / contrast ratio)
# ---------------------------------------------------------------------------

_HEX_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_RGB_RE = re.compile(r"^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$")
_NAMED = {"white": "#FFFFFF", "black": "#000000"}


def parse_color(value: object) -> Optional[tuple[int, int, int, float]]:
    """Parse #rgb/#rrggbb/#rrggbbaa/rgb()/rgba()/white/black → (r, g, b, alpha). None if unknown
    or fully transparent."""
    text = str(value or "").strip().lower()
    if not text or text in {"transparent", "none"}:
        return None
    text = _NAMED.get(text, text)
    match = _HEX_RE.match(text)
    if match:
        raw = match.group(1)
        if len(raw) == 3:
            raw = "".join(ch * 2 for ch in raw)
        alpha = int(raw[6:8], 16) / 255 if len(raw) == 8 else 1.0
        if alpha == 0:
            return None
        return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16), alpha
    match = _RGB_RE.match(text)
    if match:
        alpha = float(match.group(4)) if match.group(4) is not None else 1.0
        if alpha == 0:
            return None
        return min(255, int(match.group(1))), min(255, int(match.group(2))), min(255, int(match.group(3))), alpha
    return None


def to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def blend(top: object, bottom: object) -> Optional[str]:
    """Composite a possibly translucent colour over an opaque one."""
    fg = parse_color(top)
    bg = parse_color(bottom)
    if fg is None:
        return to_hex(bg[:3]) if bg else None
    if bg is None or fg[3] >= 1:
        return to_hex(fg[:3])
    a = fg[3]
    return to_hex(tuple(round(fg[i] * a + bg[i] * (1 - a)) for i in range(3)))


def mix(a: str, b: str, amount_b: float) -> str:
    """Linear mix of two opaque colours (amount_b = share of b)."""
    pa, pb = parse_color(a), parse_color(b)
    if not pa or not pb:
        return a
    return to_hex(tuple(round(pa[i] * (1 - amount_b) + pb[i] * amount_b) for i in range(3)))


def visible_on(color: str, background: str, minimum: float = 3.0) -> str:
    """Lighten/darken `color` toward white/black until it stands out on `background`."""
    target = "#FFFFFF" if relative_luminance(background) < 0.5 else "#000000"
    for step in range(0, 11):
        candidate = mix(color, target, step / 10)
        if contrast_ratio(candidate, background) >= minimum:
            return candidate
    return target


def relative_luminance(color: object) -> float:
    parsed = parse_color(color)
    if parsed is None:
        return 1.0
    channels = []
    for value in parsed[:3]:
        c = value / 255
        channels.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(a: object, b: object) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def is_dark(color: object) -> bool:
    return relative_luminance(color) < 0.2


def readable_on(background: str, preferred: list[str], minimum: float = 4.5) -> str:
    """First preferred colour reaching `minimum` contrast on `background`; otherwise the best of
    the preferred list plus pure black/white (pure black/white always reach ≥ 4.5 on any colour
    for one of the two, so the result is always readable)."""
    for candidate in preferred:
        if parse_color(candidate) and contrast_ratio(candidate, background) >= minimum:
            return candidate
    pool = [c for c in preferred if parse_color(c)] + ["#FFFFFF", "#0B0F19"]
    return max(pool, key=lambda c: contrast_ratio(c, background))


# ---------------------------------------------------------------------------
# Theme catalogue
# ---------------------------------------------------------------------------

FONT_STACKS = {
    "Inter": "Inter, Arial, sans-serif",
    "Plus Jakarta Sans": "'Plus Jakarta Sans', Inter, Arial, sans-serif",
    "Lexend": "Lexend, Verdana, sans-serif",
    "Georgia": "Georgia, 'Times New Roman', serif",
}

# Optional font pairings the user can pick in the style step instead of the theme's own.
FONT_CHOICES = {
    "theme": None,
    "leggibile": ("Lexend", "Lexend"),
    "serif": ("Georgia", "Inter"),
    "moderno": ("Plus Jakarta Sans", "Inter"),
}

THEMES: list[dict] = [
    {
        "id": "aula", "name": "Aula luminosa",
        "description": "Chiaro e ordinato, indaco e ciano. Ottimo sulla LIM in aula illuminata.",
        "brightness": "light", "moods": ["istituzionale", "essenziale"],
        "colors": {"background": "#F8FAFC", "surface": "#FFFFFF", "primary": "#4338CA", "accent": "#0891B2",
                   "text": "#0F172A", "muted": "#475569", "border": "#E2E8F0"},
        "fonts": {"heading": "Inter", "body": "Inter"}, "motif": "bar", "cover": "solid",
    },
    {
        "id": "golinelli", "name": "Golinelli",
        "description": "Blu notte e rosa: istituzionale e riconoscibile.",
        "brightness": "light", "moods": ["istituzionale", "vivace"],
        "colors": {"background": "#FFFFFF", "surface": "#FFF5F8", "primary": "#1A1A2E", "accent": "#E85C8D",
                   "text": "#1A1A2E", "muted": "#4A4A5E", "border": "#F5D5E1"},
        "fonts": {"heading": "Plus Jakarta Sans", "body": "Inter"}, "motif": "bar", "cover": "solid",
    },
    {
        "id": "laboratorio", "name": "Laboratorio",
        "description": "Verde acqua e arancio: scientifico ed energico.",
        "brightness": "light", "moods": ["vivace", "essenziale"],
        "colors": {"background": "#F0FDFA", "surface": "#FFFFFF", "primary": "#0F766E", "accent": "#EA580C",
                   "text": "#042F2E", "muted": "#3F5F5C", "border": "#CCEBE6"},
        "fonts": {"heading": "Plus Jakarta Sans", "body": "Inter"}, "motif": "band", "cover": "solid",
    },
    {
        "id": "editoriale", "name": "Editoriale",
        "description": "Carta avorio, titoli serif e bordeaux: elegante, da rivista.",
        "brightness": "light", "moods": ["istituzionale", "accogliente"],
        "colors": {"background": "#FBF7F0", "surface": "#FFFFFF", "primary": "#8C2F39", "accent": "#B7791F",
                   "text": "#1F1A17", "muted": "#5B524B", "border": "#E8DFD2"},
        "fonts": {"heading": "Georgia", "body": "Inter"}, "motif": "underline", "cover": "light",
    },
    {
        "id": "pastello", "name": "Pastello",
        "description": "Lilla e fucsia, caratteri morbidi: adatto ai più piccoli.",
        "brightness": "light", "moods": ["accogliente", "vivace"],
        "colors": {"background": "#FDF4FF", "surface": "#FFFFFF", "primary": "#7C3AED", "accent": "#DB2777",
                   "text": "#2E1065", "muted": "#5B4B7A", "border": "#F0DDF7"},
        "fonts": {"heading": "Lexend", "body": "Lexend"}, "motif": "band", "cover": "light",
    },
    {
        "id": "natura", "name": "Natura",
        "description": "Verde oliva e ocra su fondo naturale: calmo e accogliente.",
        "brightness": "light", "moods": ["accogliente", "essenziale"],
        "colors": {"background": "#F7F9F2", "surface": "#FFFFFF", "primary": "#3F6212", "accent": "#A16207",
                   "text": "#1C2410", "muted": "#4D5A3D", "border": "#DFE6CF"},
        "fonts": {"heading": "Plus Jakarta Sans", "body": "Inter"}, "motif": "bar", "cover": "light",
    },
    {
        "id": "essenziale", "name": "Essenziale",
        "description": "Bianco e nero con un solo accento rosso. Perfetto anche da stampare.",
        "brightness": "light", "moods": ["essenziale", "istituzionale"],
        "colors": {"background": "#FFFFFF", "surface": "#F5F5F5", "primary": "#111111", "accent": "#DC2626",
                   "text": "#111111", "muted": "#525252", "border": "#E5E5E5"},
        "fonts": {"heading": "Inter", "body": "Inter"}, "motif": "underline", "cover": "solid",
    },
    {
        "id": "lavagna", "name": "Lavagna",
        "description": "Fondo verde scuro, gesso e giallo: atmosfera da aula, per sale poco illuminate.",
        "brightness": "dark", "moods": ["accogliente", "vivace"],
        "colors": {"background": "#1F2A24", "surface": "#2A3830", "primary": "#F4D35E", "accent": "#7FD1B9",
                   "text": "#F1F5F0", "muted": "#B8C4BB", "border": "#3B4A40"},
        "fonts": {"heading": "Plus Jakarta Sans", "body": "Inter"}, "motif": "underline", "cover": "light",
    },
    {
        "id": "notte", "name": "Notte",
        "description": "Blu notte con azzurro e rosa: moderno, per proiettori in sala buia.",
        "brightness": "dark", "moods": ["vivace", "essenziale"],
        "colors": {"background": "#0F172A", "surface": "#1E293B", "primary": "#38BDF8", "accent": "#F472B6",
                   "text": "#F8FAFC", "muted": "#CBD5E1", "border": "#334155"},
        "fonts": {"heading": "Inter", "body": "Inter"}, "motif": "bar", "cover": "light",
    },
    {
        "id": "alta_leggibilita", "name": "Alta leggibilità",
        "description": "Massimo contrasto, carattere Lexend e testi più grandi: pensato per DSA e ipovisione.",
        "brightness": "light", "moods": ["essenziale", "leggibilita"],
        "colors": {"background": "#FFFFFF", "surface": "#FFF9DB", "primary": "#000000", "accent": "#0050B3",
                   "text": "#000000", "muted": "#262626", "border": "#000000"},
        "fonts": {"heading": "Lexend", "body": "Lexend"}, "motif": "underline", "cover": "light",
        "large_text": True,
    },
]

THEMES_BY_ID = {theme["id"]: theme for theme in THEMES}
DEFAULT_THEME_ID = "aula"


def _clean_hex(value: object) -> Optional[str]:
    parsed = parse_color(value)
    return to_hex(parsed[:3]) if parsed and parsed[3] >= 1 else None


def resolve_theme(theme_id: Optional[str], options: Optional[dict] = None) -> dict:
    """Theme + user options → a fully-resolved theme whose every text role is contrast-checked.

    Options: font ('theme'|'leggibile'|'serif'|'moderno'), accent (hex override), large_text
    (bool), slide_numbers (bool), images (bool), dark (bool: dark version of a light theme). Unknown/invalid values fall back to defaults.
    """
    base = THEMES_BY_ID.get(str(theme_id or "")) or THEMES_BY_ID[DEFAULT_THEME_ID]
    options = options if isinstance(options, dict) else {}
    colors = dict(base["colors"])

    accent_override = _clean_hex(options.get("accent"))
    if accent_override:
        colors["accent"] = accent_override

    # Dark version of a light theme: every slide gets the same dark background (never a dark
    # cover followed by light slides), primary/accent re-tuned to stay visible on it.
    dark = bool(options.get("dark")) and base["brightness"] == "light"
    if dark:
        primary, accent = colors["primary"], colors["accent"]
        bg = primary if relative_luminance(primary) < 0.03 else mix(primary, "#0B1020", 0.78)
        colors["background"] = bg
        colors["surface"] = mix(bg, "#FFFFFF", 0.07)
        colors["border"] = mix(bg, "#FFFFFF", 0.2)
        colors["text"] = "#F8FAFC"
        colors["muted"] = "#CBD5E1"
        new_accent = visible_on(accent, bg)
        new_primary = new_accent if contrast_ratio(primary, bg) < 3 else primary
        if new_primary == new_accent:
            new_accent = visible_on(mix(new_primary, "#FFFFFF", 0.5), bg)
        colors["primary"], colors["accent"] = new_primary, new_accent

    bg, surface = colors["background"], colors["surface"]
    # Body text must read on both the slide background and card surfaces.
    colors["text"] = readable_on(bg, [colors["text"]], 7.0) if contrast_ratio(colors["text"], surface) >= 4.5 else readable_on(surface, [colors["text"]])
    colors["muted"] = colors["muted"] if min(contrast_ratio(colors["muted"], bg), contrast_ratio(colors["muted"], surface)) >= 4.5 else colors["text"]
    # Accent/primary used *as text* (stat values, quote marks, labels) only when they actually read
    # on the background; otherwise degrade to the next readable role.
    colors["primary_text"] = readable_on(bg, [colors["primary"], colors["text"]])
    colors["accent_text"] = readable_on(bg, [colors["accent"], colors["primary"], colors["text"]])
    colors["on_primary"] = readable_on(colors["primary"], ["#FFFFFF", bg, colors["text"]])
    colors["on_primary_muted"] = readable_on(colors["primary"], [colors["border"], "#E5E7EB", colors["on_primary"]])
    colors["on_accent"] = readable_on(colors["accent"], ["#FFFFFF", colors["text"], bg])
    # "Inverse" panel = the opposite brightness of the slide (dark summary slide on a light theme).
    colors["inverse"] = colors["text"] if not is_dark(bg) else colors["surface"]
    colors["on_inverse"] = readable_on(colors["inverse"], [bg, "#FFFFFF", "#0B0F19"])
    colors["accent_on_inverse"] = readable_on(colors["inverse"], [colors["accent"], colors["primary"], colors["on_inverse"]], 3.0)

    heading, body = base["fonts"]["heading"], base["fonts"]["body"]
    pairing = FONT_CHOICES.get(str(options.get("font") or "theme"))
    if pairing:
        heading, body = pairing

    return {
        "id": base["id"],
        "name": base["name"],
        "description": base["description"],
        "brightness": "dark" if dark else base["brightness"],
        "moods": list(base["moods"]),
        "motif": base["motif"],
        "cover": base["cover"],
        "colors": colors,
        "fonts": {
            "heading": FONT_STACKS.get(heading, FONT_STACKS["Inter"]),
            "body": FONT_STACKS.get(body, FONT_STACKS["Inter"]),
        },
        "options": {
            "font": str(options.get("font") or "theme") if str(options.get("font") or "theme") in FONT_CHOICES else "theme",
            "accent": accent_override,
            "large_text": bool(options.get("large_text", base.get("large_text", False))),
            "slide_numbers": bool(options.get("slide_numbers", True)),
            "images": bool(options.get("images", True)),
            "dark": dark,
        },
    }


def theme_catalog() -> list[dict]:
    """Every theme resolved with default options (what the template gallery shows)."""
    return [resolve_theme(theme["id"]) for theme in THEMES]


def theme_from_deck(raw: object) -> Optional[dict]:
    """Re-resolve a theme stored in a deck's content_json (never trust stored colours as-is)."""
    if not isinstance(raw, dict) or not raw.get("id"):
        return None
    return resolve_theme(str(raw.get("id")), raw.get("options") if isinstance(raw.get("options"), dict) else {})
