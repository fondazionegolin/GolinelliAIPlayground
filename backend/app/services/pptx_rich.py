"""Rich PowerPoint ↔ slide-editor conversion.

Slide text blocks in the editor hold small TipTap HTML documents (p / ul / ol / li / strong / em /
u / s / span[style: color, font-size, font-family] / br, paragraph text-align). This module maps
them to and from DrawingML text frames with per-run formatting, bullets and levels, and resolves
what PowerPoint leaves implicit on import: placeholder/layout/master text styles, theme colours
and theme fonts. It also reads shapes, groups, tables, slide backgrounds and speaker notes.
"""

from __future__ import annotations

import colorsys
import html
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from bs4 import BeautifulSoup, NavigableString, Tag
from lxml import etree
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Pt

A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
RT_THEME = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
SCHEME_ALIASES = {"tx1": "dk1", "bg1": "lt1", "tx2": "dk2", "bg2": "lt2", "phClr": "dk1"}
ALIGN_TO_CSS = {"ctr": "center", "r": "right", "just": "justify", "dist": "justify", "l": "left"}
CSS_TO_ALIGN = {"center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT, "justify": PP_ALIGN.JUSTIFY, "left": PP_ALIGN.LEFT}
TITLE_TYPES = {"title", "ctrTitle"}
BODY_TYPES = {"body", "obj", "subTitle", None}


# ── theme ──────────────────────────────────────────────────────────────────────────────────

@dataclass
class Theme:
    colors: dict[str, str]
    major_font: str | None
    minor_font: str | None
    # clrMap of the master, optionally overridden by layout/slide: dark templates map bg1 → dk1.
    color_map: dict[str, str] = field(default_factory=dict)

    def scheme(self, name: str | None) -> str | None:
        name = name or ""
        mapped = self.color_map.get(name) or SCHEME_ALIASES.get(name, name)
        return self.colors.get(mapped)


def _load_theme_part(master: Any) -> Theme:
    colors: dict[str, str] = {}
    major = minor = None
    try:
        theme_part = master.part.part_related_by(RT_THEME)
        root = etree.fromstring(theme_part.blob)
    except Exception:
        return Theme(colors, major, minor)
    scheme = root.find(f".//{{{A_NS}}}clrScheme")
    if scheme is not None:
        for entry in scheme:
            name = etree.QName(entry).localname
            srgb = entry.find(f"{{{A_NS}}}srgbClr")
            system = entry.find(f"{{{A_NS}}}sysClr")
            if srgb is not None and srgb.get("val"):
                colors[name] = srgb.get("val").upper()
            elif system is not None and system.get("lastClr"):
                colors[name] = system.get("lastClr").upper()
    font_scheme = root.find(f".//{{{A_NS}}}fontScheme")
    if font_scheme is not None:
        major_latin = font_scheme.find(f"{{{A_NS}}}majorFont/{{{A_NS}}}latin")
        minor_latin = font_scheme.find(f"{{{A_NS}}}minorFont/{{{A_NS}}}latin")
        major = major_latin.get("typeface") if major_latin is not None else None
        minor = minor_latin.get("typeface") if minor_latin is not None else None
    return Theme(colors, major, minor)


def load_theme(presentation: Any) -> Theme:
    try:
        master = presentation.slide_masters[0]
    except Exception:
        return Theme({}, None, None)
    theme = _load_theme_part(master)
    theme.color_map = _color_map(master._element.find(qn("p:clrMap")))
    return theme


def _color_map(element: Any) -> dict[str, str]:
    return dict(element.attrib) if element is not None else {}


def theme_for_slide(slide: Any) -> Theme:
    """Theme of the slide's own master, with the clrMap override of slide or layout applied."""
    master = slide.slide_layout.slide_master
    theme = _load_theme_part(master)
    color_map = _color_map(master._element.find(qn("p:clrMap")))
    for owner in (slide.slide_layout, slide):
        override = owner._element.find(qn("p:clrMapOvr") + "/" + qn("a:overrideClrMapping"))
        if override is not None:
            color_map = _color_map(override)
    theme.color_map = color_map
    return theme


def _hsl_modifiers(hex_color: str, color_element: Any) -> str:
    """Apply DrawingML colour transforms in document order. lumMod/lumOff act on HSL lightness,
    so "Text 1, Lighter 35%" and friends only come out right in HSL, not on the RGB channels."""
    red, green, blue = (int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4))
    for modifier in color_element:
        name = etree.QName(modifier).localname
        try:
            value = int(modifier.get("val", "0")) / 100000
        except ValueError:
            continue
        if name in {"lumMod", "lumOff", "satMod", "satOff", "hueMod", "hueOff"}:
            hue, light, saturation = colorsys.rgb_to_hls(red, green, blue)
            if name == "lumMod":
                light *= value
            elif name == "lumOff":
                light += value
            elif name == "satMod":
                saturation *= value
            elif name == "satOff":
                saturation += value
            elif name == "hueMod":
                hue = (hue * value) % 1
            else:
                hue = (hue + int(modifier.get("val", "0")) / 21600000) % 1
            red, green, blue = colorsys.hls_to_rgb(hue, min(1, max(0, light)), min(1, max(0, saturation)))
        elif name == "shade":
            red, green, blue = red * value, green * value, blue * value
        elif name == "tint":
            red, green, blue = (c + (1 - c) * (1 - value) for c in (red, green, blue))
    return "".join(f"{min(255, max(0, round(c * 255))):02X}" for c in (red, green, blue))


_apply_luminance = _hsl_modifiers
_PRESET_COLORS = {
    "black": "000000", "white": "FFFFFF", "red": "FF0000", "green": "008000", "blue": "0000FF", "yellow": "FFFF00",
    "orange": "FFA500", "purple": "800080", "gray": "808080", "grey": "808080", "lightGray": "D3D3D3", "darkGray": "A9A9A9",
    "cyan": "00FFFF", "magenta": "FF00FF", "navy": "000080", "teal": "008080", "silver": "C0C0C0", "maroon": "800000",
}


def _color_element(fill_parent: Any) -> Any | None:
    if fill_parent is None:
        return None
    local = etree.QName(fill_parent).localname
    if local == "gradFill":
        stops = fill_parent.find(qn("a:gsLst"))
        return stops[0][0] if stops is not None and len(stops) and len(stops[0]) else None
    solid = fill_parent if local == "solidFill" else fill_parent.find(qn("a:solidFill"))
    if solid is None and local != "solidFill":
        gradient = fill_parent.find(qn("a:gradFill"))
        if gradient is not None:
            return _color_element(gradient)
    if solid is None:
        return None
    return solid[0] if len(solid) else None


def resolve_color(color: Any, theme: Theme) -> str | None:
    if color is None:
        return None
    name = etree.QName(color).localname
    if name == "srgbClr" and color.get("val"):
        return _apply_luminance(color.get("val").upper(), color)
    if name == "schemeClr":
        base = theme.scheme(color.get("val"))
        return _apply_luminance(base, color) if base else None
    if name == "sysClr" and color.get("lastClr"):
        return _apply_luminance(color.get("lastClr").upper(), color)
    if name == "prstClr":
        base = _PRESET_COLORS.get(color.get("val"))
        return _apply_luminance(base, color) if base else None
    return None


def color_of(fill_parent: Any, theme: Theme) -> str | None:
    """Hex colour of a:solidFill (or the first stop of a:gradFill) under `fill_parent`."""
    return resolve_color(_color_element(fill_parent), theme)


def alpha_of(fill_parent: Any) -> float:
    color = _color_element(fill_parent)
    alpha = color.find(qn("a:alpha")) if color is not None else None
    try:
        return max(0.0, min(1.0, int(alpha.get("val")) / 100000)) if alpha is not None else 1.0
    except (TypeError, ValueError):
        return 1.0


def css_color(hex_color: str | None, alpha: float = 1.0) -> str | None:
    if not hex_color:
        return None
    if alpha >= 0.995:
        return f"#{hex_color}"
    red, green, blue = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({red}, {green}, {blue}, {round(alpha, 3)})"


def resolve_typeface(typeface: str | None, theme: Theme) -> str | None:
    if not typeface:
        return None
    if typeface.startswith("+mj"):
        return theme.major_font
    if typeface.startswith("+mn"):
        return theme.minor_font
    return typeface


# PowerPoint stores a static weight as part of the family ("Josefin Sans SemiBold"); the web
# font is the family plus a numeric weight.
_WEIGHT_SUFFIXES = {
    "thin": 100, "hairline": 100, "extralight": 200, "extra light": 200, "ultralight": 200, "ultra light": 200, "light": 300,
    "medium": 500, "semibold": 600, "semi bold": 600, "demibold": 600, "demi bold": 600,
    "extrabold": 800, "extra bold": 800, "ultrabold": 800, "black": 900, "heavy": 900,
}
_FONT_ALIASES = {"arial mt": "Arial", "times new roman psmt": "Times New Roman", "arialmt": "Arial"}
# Face used by browsers that have neither the original font nor its web version.
_FONT_FALLBACKS = {"segoe ui": "'Open Sans', sans-serif", "consolas": "'Courier New', monospace", "garamond": "'EB Garamond', serif"}
_SERIF_FONT = re.compile(r"times|georgia|cambria|garamond|serif(?<!sans serif)|playfair|merriweather|lora|baskerville|book antiqua|palatino|average|tinos|caladea", re.IGNORECASE)
_MONO_FONT = re.compile(r"mono|courier|consolas|code|typewriter", re.IGNORECASE)


def split_font(typeface: str | None) -> tuple[str | None, int | None]:
    """('Josefin Sans SemiBold') → ('Josefin Sans', 600)."""
    if not typeface:
        return None, None
    name = typeface.strip()
    if name.lower() in _FONT_ALIASES:
        return _FONT_ALIASES[name.lower()], None
    lowered = name.lower()
    for suffix, weight in sorted(_WEIGHT_SUFFIXES.items(), key=lambda item: -len(item[0])):
        if lowered.endswith(" " + suffix):
            return name[: -len(suffix) - 1].strip(), weight
    return name, None


def css_font(family: str) -> str:
    fallback = _FONT_FALLBACKS.get(family.lower())
    if fallback is None:
        fallback = "serif" if _SERIF_FONT.search(family) and "sans" not in family.lower() else "monospace" if _MONO_FONT.search(family) else "sans-serif"
    return f"'{family}', {fallback}"


# ── inherited text styles ──────────────────────────────────────────────────────────────────

def _placeholder_info(shape: Any) -> tuple[str | None, int | None]:
    try:
        if shape.is_placeholder:
            fmt = shape.placeholder_format
            ph = shape._element.find(".//" + qn("p:ph"))
            ph_type = ph.get("type") if ph is not None else None
            return (ph_type or "body"), fmt.idx
    except Exception:
        pass
    return None, None


def inherited_body_properties(shape: Any, slide: Any) -> list[Any]:
    """a:bodyPr of the shape and of its layout/master placeholders, highest priority first."""
    chain: list[Any] = []
    own = shape._element.find(".//" + qn("a:bodyPr"))
    if own is not None:
        chain.append(own)
    ph_type, idx = _placeholder_info(shape)
    if ph_type is None:
        return chain
    try:
        layout = slide.slide_layout
        owners = [layout, layout.slide_master]
    except Exception:
        return chain
    for owner in owners:
        match = _matching_placeholder(owner.placeholders, ph_type, idx)
        body = match._element.find(".//" + qn("a:bodyPr")) if match is not None else None
        if body is not None:
            chain.append(body)
    return chain


def body_attr(chain: list[Any], name: str) -> str | None:
    for body in chain:
        if body.get(name) is not None:
            return body.get(name)
    return None


def _matching_placeholder(shapes: Any, ph_type: str | None, idx: int | None) -> Any | None:
    candidates = []
    for candidate in shapes:
        try:
            if not candidate.is_placeholder:
                continue
            ph = candidate._element.find(".//" + qn("p:ph"))
            cand_type = (ph.get("type") if ph is not None else None) or "body"
            cand_idx = candidate.placeholder_format.idx
        except Exception:
            continue
        if idx is not None and cand_idx == idx and idx != 0:
            return candidate
        if cand_type == ph_type or (ph_type in TITLE_TYPES and cand_type in TITLE_TYPES):
            candidates.append(candidate)
    return candidates[0] if candidates else None


def level_styles(shape: Any, slide: Any, presentation: Any, level: int) -> list[Any]:
    """lvlNpPr elements that style paragraphs of `shape` at `level`, lowest priority first."""
    tag = qn(f"a:lvl{min(9, level + 1)}pPr")
    chain: list[Any] = []
    try:
        default_style = presentation.part._element.find(qn("p:defaultTextStyle"))
        if default_style is not None and default_style.find(tag) is not None:
            chain.append(default_style.find(tag))
    except Exception:
        pass
    ph_type, idx = _placeholder_info(shape)
    try:
        layout = slide.slide_layout
        master = layout.slide_master
    except Exception:
        layout = master = None
    if master is not None:
        tx_styles = master._element.find(qn("p:txStyles"))
        if tx_styles is not None:
            if ph_type in TITLE_TYPES:
                group = tx_styles.find(qn("p:titleStyle"))
            elif ph_type is not None and ph_type in BODY_TYPES:
                group = tx_styles.find(qn("p:bodyStyle"))
            else:
                group = tx_styles.find(qn("p:otherStyle"))
            if group is not None and group.find(tag) is not None:
                chain.append(group.find(tag))
    if ph_type is not None:
        for owner in (master, layout):
            if owner is None:
                continue
            match = _matching_placeholder(owner.placeholders if hasattr(owner, "placeholders") else owner.shapes, ph_type, idx)
            if match is not None:
                list_style = match._element.find(".//" + qn("a:lstStyle"))
                if list_style is not None and list_style.find(tag) is not None:
                    chain.append(list_style.find(tag))
    own_list_style = shape._element.find(".//" + qn("a:lstStyle"))
    if own_list_style is not None and own_list_style.find(tag) is not None:
        chain.append(own_list_style.find(tag))
    return chain


@dataclass
class ParagraphContext:
    chain: list[Any]  # lvlNpPr + paragraph pPr, lowest priority first
    theme: Theme
    default_color: str | None = None  # p:style/a:fontRef, table style…
    default_bold: bool = False

    def run_attr(self, run_properties: Any, name: str) -> str | None:
        value = run_properties.get(name) if run_properties is not None else None
        if value is not None:
            return value
        for level in reversed(self.chain):
            default = level.find(qn("a:defRPr"))
            if default is not None and default.get(name) is not None:
                return default.get(name)
        return None

    def run_color(self, run_properties: Any) -> str | None:
        color = color_of(run_properties, self.theme) if run_properties is not None else None
        if color:
            return color
        for level in reversed(self.chain):
            default = level.find(qn("a:defRPr"))
            color = color_of(default, self.theme) if default is not None else None
            if color:
                return color
        return self.default_color

    def run_font(self, run_properties: Any) -> str | None:
        sources = [run_properties] + [level.find(qn("a:defRPr")) for level in reversed(self.chain)]
        for source in sources:
            if source is None:
                continue
            latin = source.find(qn("a:latin"))
            if latin is not None and latin.get("typeface"):
                return resolve_typeface(latin.get("typeface"), self.theme)
        return self.theme.minor_font

    def alignment(self) -> str | None:
        for level in reversed(self.chain):
            if level.get("algn"):
                return ALIGN_TO_CSS.get(level.get("algn"))
        return None

    def bullet(self) -> str | None:
        """'ul' / 'ol' / None."""
        for level in reversed(self.chain):
            if level.find(qn("a:buNone")) is not None:
                return None
            if level.find(qn("a:buAutoNum")) is not None:
                return "ol"
            if level.find(qn("a:buChar")) is not None or level.find(qn("a:buBlip")) is not None:
                return "ul"
        return None

    def list_style(self) -> tuple[str | None, int | None]:
        """(CSS list-style-type, first number) of the bullet that applies."""
        font = None
        for level in reversed(self.chain):
            if font is None and level.find(qn("a:buFont")) is not None:
                font = level.find(qn("a:buFont")).get("typeface")
            numbered = level.find(qn("a:buAutoNum"))
            if numbered is not None:
                kind = numbered.get("type", "arabicPeriod")
                css = next((value for prefix, value in AUTO_NUMBER_STYLES.items() if kind.startswith(prefix)), "decimal")
                start = numbered.get("startAt")
                return css, int(start) if start and start.isdigit() else None
            char = level.find(qn("a:buChar"))
            if char is not None:
                return _bullet_css(char.get("char", "•"), font), None
        return None, None

    def spacing(self, tag: str, font_px: float) -> float | None:
        """lnSpc → unitless CSS line-height is handled by line_height(); spcBef/spcAft → px."""
        for level in reversed(self.chain):
            element = level.find(qn(f"a:{tag}"))
            if element is None:
                continue
            percent = element.find(qn("a:spcPct"))
            points = element.find(qn("a:spcPts"))
            if percent is not None and percent.get("val", "").lstrip("-").isdigit():
                return int(percent.get("val")) / 100000 * font_px * 1.2
            if points is not None and points.get("val", "").lstrip("-").isdigit():
                return int(points.get("val")) / 100
        return None

    def line_height(self) -> tuple[float | None, float | None]:
        """(multiple of single spacing, exact points) from a:lnSpc."""
        for level in reversed(self.chain):
            element = level.find(qn("a:lnSpc"))
            if element is None:
                continue
            percent = element.find(qn("a:spcPct"))
            points = element.find(qn("a:spcPts"))
            if percent is not None and percent.get("val", "").isdigit():
                return int(percent.get("val")) / 100000, None
            if points is not None and points.get("val", "").isdigit():
                return None, int(points.get("val")) / 100
        return None, None

    def indents(self) -> tuple[int | None, int | None]:
        """(marL, indent) in EMU."""
        left = indent = None
        for level in reversed(self.chain):
            if left is None and (level.get("marL") or "").lstrip("-").isdigit():
                left = int(level.get("marL"))
            if indent is None and (level.get("indent") or "").lstrip("-").isdigit():
                indent = int(level.get("indent"))
        return left, indent


AUTO_NUMBER_STYLES = {
    "arabic": "decimal", "alphaLc": "lower-alpha", "alphaUc": "upper-alpha", "romanLc": "lower-roman", "romanUc": "upper-roman",
}
# Symbol fonts map letters to pictograms: "§" in Wingdings is the square bullet.
_SYMBOL_BULLETS = {"§": "▪", "q": "❑", "n": "■", "l": "●", "Ø": "➢", "ü": "✓", "v": "❖", "Ÿ": "•", "o": "◦", "\uf0a7": "▪", "\uf0b7": "•", "\uf0d8": "➢", "\uf0fc": "✓"}


def _bullet_css(char: str, font: str | None) -> str:
    if font and re.search(r"wingdings|symbol|webdings", font, re.IGNORECASE):
        char = _SYMBOL_BULLETS.get(char, "•")
    elif char == "o" and font and "courier" in font.lower():
        return "circle"
    if char in {'"', "'", "\\", ";"}:
        return "disc"
    return f"'{char}  '"


# ── PPTX text frame → editor HTML ─────────────────────────────────────────────────────────

@dataclass
class TextImport:
    html: str
    plain: str
    font_px: float | None
    color: str | None
    font_family: str | None
    align: str | None
    bold: bool


@dataclass(frozen=True)
class TextScale:
    """a:normAutofit: PowerPoint stores the shrink it computed instead of smaller font sizes."""
    font: float = 1.0
    line_reduction: float = 0.0


def autofit_scale(body_chain: list[Any]) -> TextScale:
    for body in body_chain:
        fit = body.find(qn("a:normAutofit"))
        if fit is not None:
            try:
                return TextScale(int(fit.get("fontScale", "100000")) / 100000, int(fit.get("lnSpcReduction", "0")) / 100000)
            except ValueError:
                return TextScale()
        if body.find(qn("a:noAutofit")) is not None or body.find(qn("a:spAutoFit")) is not None:
            return TextScale()
    return TextScale()


def shape_font_color(shape: Any, theme: Theme) -> str | None:
    reference = shape._element.find(qn("p:style") + "/" + qn("a:fontRef"))
    return resolve_color(reference[0], theme) if reference is not None and len(reference) else None


def text_frame_to_html(shape: Any, slide: Any, presentation: Any, theme: Theme, pt_to_px: float, scale: TextScale = TextScale()) -> TextImport:
    frame = shape.text_frame

    def chain_for(level: int, p_pr: Any) -> list[Any]:
        return level_styles(shape, slide, presentation, level) + ([p_pr] if p_pr is not None else [])

    return paragraphs_to_html(frame.paragraphs, chain_for, theme, pt_to_px, scale, shape_font_color(shape, theme))


def paragraphs_to_html(
    paragraphs: Any,
    chain_for: Any,
    theme: Theme,
    pt_to_px: float,
    scale: TextScale = TextScale(),
    default_color: str | None = None,
    default_bold: bool = False,
) -> TextImport:
    sizes: Counter[float] = Counter()
    colors: Counter[str] = Counter()
    fonts: Counter[str] = Counter()
    aligns: Counter[str] = Counter()
    bold_chars = total_chars = 0
    # (list tag, level, inner html, align, paragraph CSS, list CSS, list start)
    items: list[tuple[str | None, int, str, str | None, list[str], list[str], int | None]] = []
    plain_lines: list[str] = []

    for paragraph_index, paragraph in enumerate(paragraphs):
        p_pr = paragraph._p.find(qn("a:pPr"))
        level = int(p_pr.get("lvl", "0")) if p_pr is not None and p_pr.get("lvl", "0").isdigit() else 0
        context = ParagraphContext(chain_for(level, p_pr), theme, default_color, default_bold)
        fragments: list[str] = []
        line_text = ""
        largest_size = 0.0
        for child in paragraph._p:
            name = etree.QName(child).localname
            if name == "br":
                fragments.append("<br>")
                line_text += "\n"
                continue
            if name not in {"r", "fld"}:
                continue
            text = "".join(t.text or "" for t in child.iter(qn("a:t")))
            if not fragments and context.bullet():
                text = text.lstrip("\t ")  # hand-made gap after the bullet: the list indent already does it
            if not text:
                continue
            r_pr = child.find(qn("a:rPr"))
            size_raw = context.run_attr(r_pr, "sz")
            size_pt = (int(size_raw) / 100 if size_raw and size_raw.isdigit() else 18.0) * scale.font
            color = context.run_color(r_pr)
            family, weight = split_font(context.run_font(r_pr))
            bold_attr = context.run_attr(r_pr, "b")
            bold = bold_attr in {"1", "true"} if bold_attr is not None else context.default_bold
            italic = context.run_attr(r_pr, "i") in {"1", "true"}
            underline = (context.run_attr(r_pr, "u") or "none") != "none"
            strike = (context.run_attr(r_pr, "strike") or "noStrike") != "noStrike"
            caps = context.run_attr(r_pr, "cap")
            if caps == "all":
                text = text.upper()
            spacing_raw = context.run_attr(r_pr, "spc")
            letter_spacing = int(spacing_raw) / 100 * pt_to_px if spacing_raw and spacing_raw.lstrip("-").isdigit() else 0
            baseline_raw = context.run_attr(r_pr, "baseline")
            baseline = int(baseline_raw) if baseline_raw and baseline_raw.lstrip("-").isdigit() else 0
            highlight = color_of(r_pr.find(qn("a:highlight")), theme) if r_pr is not None and r_pr.find(qn("a:highlight")) is not None else None
            if highlight is None and r_pr is not None and r_pr.find(qn("a:highlight")) is not None and len(r_pr.find(qn("a:highlight"))):
                highlight = resolve_color(r_pr.find(qn("a:highlight"))[0], theme)
            weight_chars = len(text)
            size_px = round(size_pt * pt_to_px, 1)
            largest_size = max(largest_size, size_px)
            sizes[size_px] += weight_chars
            if color:
                colors[color] += weight_chars
            if family:
                fonts[family] += weight_chars
            total_chars += weight_chars
            bold_chars += weight_chars if bold else 0
            fragments.append(_run_html(text, size_pt * pt_to_px, color, family, bold, italic, underline, strike, weight, letter_spacing, baseline, highlight))
            line_text += text
        plain_lines.append(line_text)

        end_props = paragraph._p.find(qn("a:endParaRPr"))
        if not largest_size:
            size_raw = context.run_attr(end_props, "sz")
            largest_size = round((int(size_raw) / 100 if size_raw and size_raw.isdigit() else 18.0) * scale.font * pt_to_px, 1)

        align = ALIGN_TO_CSS.get(p_pr.get("algn")) if p_pr is not None and p_pr.get("algn") else context.alignment()
        if align:
            aligns[align] += 1

        paragraph_css: list[str] = []
        multiple, exact = context.line_height()
        if exact is not None:
            paragraph_css.append(f"line-height: {round(exact * pt_to_px, 1):g}px")
        elif multiple is not None:
            paragraph_css.append(f"line-height: {round(max(0.5, multiple - scale.line_reduction) * 1.2, 3):g}")
        elif not fragments:
            paragraph_css.append(f"line-height: {round(largest_size * 1.2, 1):g}px")
        if not fragments and exact is None and multiple is not None:
            paragraph_css[-1] = f"line-height: {round(largest_size * 1.2 * multiple, 1):g}px"
        before = context.spacing("spcBef", largest_size / pt_to_px)
        after = context.spacing("spcAft", largest_size / pt_to_px)
        # PowerPoint ignores the space before the first line of a text frame.
        if before and paragraph_index > 0:
            paragraph_css.append(f"margin-top: {round(before * pt_to_px, 1):g}px")
        if after:
            paragraph_css.append(f"margin-bottom: {round(after * pt_to_px, 1):g}px")

        left, indent = context.indents()
        emu_to_px = pt_to_px / 12700
        list_tag = context.bullet() if fragments else None
        list_css: list[str] = []
        list_start: int | None = None
        if list_tag:
            style_type, list_start = context.list_style()
            if style_type:
                list_css.append(f"list-style-type: {style_type}")
            list_css.append(f"padding-left: {round((left or 0) * emu_to_px, 1):g}px")
        else:
            if left:
                paragraph_css.append(f"margin-left: {round(left * emu_to_px, 1):g}px")
            if indent:
                paragraph_css.append(f"text-indent: {round(indent * emu_to_px, 1):g}px")
        right_margin = p_pr.get("marR") if p_pr is not None else None
        if right_margin and right_margin.isdigit() and int(right_margin):
            paragraph_css.append(f"margin-right: {round(int(right_margin) * emu_to_px, 1):g}px")
        items.append((list_tag, level, "".join(fragments), align, paragraph_css, list_css, list_start))

    dominant_size = sizes.most_common(1)[0][0] if sizes else None
    dominant_color = colors.most_common(1)[0][0] if colors else None
    dominant_font = fonts.most_common(1)[0][0] if fonts else None
    dominant_font_css = css_font(dominant_font) if dominant_font else None
    block_bold = total_chars > 0 and bold_chars / total_chars > 0.6
    block_align = aligns.most_common(1)[0][0] if aligns else None

    # Drop inline declarations equal to the block defaults so the HTML stays editable/clean.
    def simplify(fragment: str) -> str:
        soup = BeautifulSoup(fragment, "html.parser")
        for span in soup.find_all("span"):
            kept = []
            for declaration in (span.get("style") or "").split(";"):
                if ":" not in declaration:
                    continue
                prop, value = (part.strip() for part in declaration.split(":", 1))
                if prop == "font-size" and dominant_size is not None and abs(float(value.rstrip("px")) - dominant_size) < 0.6:
                    continue
                if prop == "color" and dominant_color and value.lower() == f"#{dominant_color.lower()}":
                    continue
                if prop == "font-family" and dominant_font_css and value == dominant_font_css:
                    continue
                kept.append(f"{prop}: {value}")
            if kept:
                span["style"] = "; ".join(kept)
            else:
                span.unwrap()
        if block_bold:
            for strong in soup.find_all("strong"):
                strong.unwrap()
        return str(soup)

    def paragraph_style(align: str | None, css: list[str]) -> str:
        declarations = list(css)
        if align and align != block_align:
            declarations.insert(0, f"text-align: {align}")
        return f' style="{"; ".join(declarations)}"' if declarations else ""

    output: list[str] = []
    open_lists: list[tuple[int, str]] = []
    open_paddings: list[tuple[float, int]] = []
    for list_tag, level, inner, align, paragraph_css, list_css, list_start in items:
        inner = simplify(inner) or "<br>"
        style = paragraph_style(align, paragraph_css)
        if list_tag is None:
            while open_lists:
                output.append(f"</li></{open_lists.pop()[1]}>")
                open_paddings.pop()
            output.append(f"<p{style}>{inner}</p>")
            continue
        while open_lists and (open_lists[-1][0] > level or (open_lists[-1][0] == level and open_lists[-1][1] != list_tag)):
            output.append(f"</li></{open_lists.pop()[1]}>")
            open_paddings.pop()
        if open_lists and open_lists[-1][0] == level:
            output.append(f"</li><li><p{style}>{inner}</p>")
        else:
            start_attr = f' start="{list_start}"' if list_tag == "ol" and list_start and list_start != 1 else ""
            # Nested lists sit inside the parent's padding, while marL counts from the frame edge.
            left_px = float(next(c.split(":")[1].strip().rstrip("px") for c in list_css if c.startswith("padding-left")))
            relative = max(0.0, left_px - sum(padding for padding, _ in open_paddings))
            declarations = [c for c in list_css if not c.startswith("padding-left")] + [f"padding-left: {round(relative, 1):g}px"]
            output.append(f'<{list_tag}{start_attr} style="{"; ".join(declarations)}"><li><p{style}>{inner}</p>')
            open_lists.append((level, list_tag))
            open_paddings.append((relative, level))
    while open_lists:
        output.append(f"</li></{open_lists.pop()[1]}>")

    return TextImport(
        html="".join(output) or "<p></p>",
        plain="\n".join(plain_lines),
        font_px=dominant_size,
        color=f"#{dominant_color}" if dominant_color else None,
        font_family=dominant_font_css,
        align=block_align,
        bold=block_bold,
    )


def _run_html(
    text: str, size_px: float, color: str | None, font: str | None, bold: bool, italic: bool, underline: bool, strike: bool,
    weight: int | None = None, letter_spacing: float = 0, baseline: int = 0, highlight: str | None = None,
) -> str:
    escaped = html.escape(text).replace("\v", "<br>").replace("\t", "\u00a0\u00a0\u00a0\u00a0").replace("  ", " \u00a0")
    styles = [f"font-size: {round(size_px, 1):g}px"]
    if color:
        styles.append(f"color: #{color.lower()}")
    if font:
        styles.append(f"font-family: {css_font(font)}")
    if weight and not bold:
        styles.append(f"font-weight: {weight}")
    if letter_spacing:
        styles.append(f"letter-spacing: {round(letter_spacing, 2):g}px")
    if baseline:
        styles.append(f"vertical-align: {'super' if baseline > 0 else 'sub'}")
    if highlight:
        styles.append(f"background-color: #{highlight.lower()}")
    content = f'<span style="{"; ".join(styles)}">{escaped}</span>'
    for enabled, tag in ((strike, "s"), (underline, "u"), (italic, "em"), (bold, "strong")):
        if enabled:
            content = f"<{tag}>{content}</{tag}>"
    return content


# ── editor HTML → PPTX text frame ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class _Fmt:
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    color: str | None = None
    size_px: float | None = None
    font: str | None = None
    letter_spacing_px: float | None = None


def _css(tag: Tag) -> dict[str, str]:
    out: dict[str, str] = {}
    for declaration in (tag.get("style") or "").split(";"):
        if ":" in declaration:
            prop, value = declaration.split(":", 1)
            out[prop.strip().lower()] = value.strip()
    return out


def _hex(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip().lower()
    match = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", value)
    if match:
        digits = match.group(1)
        return ("".join(c * 2 for c in digits) if len(digits) == 3 else digits).upper()
    match = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)", value)
    if match:
        return "".join(f"{min(255, int(match.group(i))):02X}" for i in (1, 2, 3))
    return None


def _px(value: str | None) -> float | None:
    if not value:
        return None
    match = re.fullmatch(r"\s*([\d.]+)\s*(px|pt)?\s*", value.lower())
    if not match:
        return None
    number = float(match.group(1))
    return number * 4 / 3 if match.group(2) == "pt" else number


def _derive(fmt: _Fmt, tag: Tag) -> _Fmt:
    changes: dict[str, Any] = {}
    if tag.name in {"strong", "b"}:
        changes["bold"] = True
    elif tag.name in {"em", "i"}:
        changes["italic"] = True
    elif tag.name == "u":
        changes["underline"] = True
    elif tag.name in {"s", "strike", "del"}:
        changes["strike"] = True
    css = _css(tag)
    if _hex(css.get("color")):
        changes["color"] = _hex(css.get("color"))
    if _px(css.get("font-size")):
        changes["size_px"] = _px(css.get("font-size"))
    if _px(css.get("letter-spacing")):
        changes["letter_spacing_px"] = _px(css.get("letter-spacing"))
    if css.get("font-family"):
        changes["font"] = css["font-family"].split(",")[0].strip().strip("'\"")
    weight = css.get("font-weight", "")
    if weight == "bold" or (weight.isdigit() and int(weight) >= 600):
        changes["bold"] = True
    if css.get("font-style") == "italic":
        changes["italic"] = True
    decoration = css.get("text-decoration", "")
    if "underline" in decoration:
        changes["underline"] = True
    if "line-through" in decoration:
        changes["strike"] = True
    return _Fmt(**{**fmt.__dict__, **changes})


def _looks_like_html(value: str) -> bool:
    return bool(re.search(r"<\s*(p|h[1-6]|div|blockquote|span|strong|em|u|s|br|ul|ol|li|b|i)\b", value, re.IGNORECASE))


def fill_text_frame(frame: Any, content: str, block_style: dict[str, Any], px_to_pt: float) -> None:
    """Write editor text-block content (HTML or legacy plain text) into a python-pptx text frame."""
    base = _Fmt(
        bold=str(block_style.get("fontWeight") or "").lower() in {"bold", "600", "700", "800", "900"},
        italic=str(block_style.get("fontStyle") or "").lower() == "italic",
        underline="underline" in str(block_style.get("textDecoration") or "").lower(),
        strike="line-through" in str(block_style.get("textDecoration") or "").lower(),
        color=_hex(str(block_style.get("color") or "")) or "000000",
        size_px=float(block_style.get("fontSize") or 18),
        # A CSS stack ("Georgia, 'Times New Roman', serif") is not a PowerPoint typeface name.
        font=str(block_style.get("fontFamily")).split(",")[0].strip().strip("'\"") or None if block_style.get("fontFamily") else None,
    )
    block_align = CSS_TO_ALIGN.get(str(block_style.get("textAlign") or "left"), PP_ALIGN.LEFT)
    line_height = block_style.get("lineHeight")

    if not _looks_like_html(content or ""):
        paragraphs: list[tuple[list[tuple[str, _Fmt]], str | None, int, str | None, dict[str, str]]] = [
            ([(line, base)], None, 0, None, {}) for line in (content or "").split("\n")
        ]
    else:
        paragraphs = []
        soup = BeautifulSoup(content, "html.parser")

        def inline_runs(node: Any, fmt: _Fmt, out: list[tuple[str, _Fmt]]) -> None:
            if isinstance(node, NavigableString):
                text = re.sub(r"[ \t\r\n]+", " ", str(node))
                if text:
                    out.append((text, fmt))
                return
            if not isinstance(node, Tag):
                return
            if node.name == "br":
                out.append(("\v", fmt))
                return
            if node.name in {"ul", "ol"}:
                return
            child_fmt = _derive(fmt, node)
            for child in node.children:
                inline_runs(child, child_fmt, out)

        def walk_list(node: Tag, level: int) -> None:
            for item in node.find_all("li", recursive=False):
                runs: list[tuple[str, _Fmt]] = []
                align = None
                css: dict[str, str] = {}
                for child in item.children:
                    if isinstance(child, Tag) and child.name in {"ul", "ol"}:
                        continue
                    if isinstance(child, Tag) and child.name == "p":
                        align = _css(child).get("text-align") or align
                        css = _css(child)
                        if runs:
                            runs.append(("\v", base))
                    inline_runs(child, base, runs)
                paragraphs.append((runs, node.name, level, align, css))
                for nested in item.find_all(["ul", "ol"], recursive=False):
                    walk_list(nested, level + 1)

        for node in soup.children:
            if isinstance(node, Tag) and node.name in {"ul", "ol"}:
                walk_list(node, 0)
            elif isinstance(node, Tag) and node.name in {"p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "blockquote"}:
                runs: list[tuple[str, _Fmt]] = []
                for child in node.children:
                    inline_runs(child, _derive(base, node), runs)
                paragraphs.append((runs, None, 0, _css(node).get("text-align"), _css(node)))
            else:
                runs = []
                inline_runs(node, base, runs)
                if any(text.strip() for text, _ in runs):
                    paragraphs.append((runs, None, 0, None, {}))
        if not paragraphs:
            paragraphs = [([("", base)], None, 0, None, {})]

    frame.clear()
    for index, (runs, list_tag, level, align, css) in enumerate(paragraphs):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        # Layout placeholders inherit theme paragraph spacing unless explicitly cleared.
        paragraph.space_before = Pt(0)
        paragraph.space_after = Pt(0)
        paragraph.alignment = CSS_TO_ALIGN.get(align or "", block_align)
        if isinstance(line_height, (int, float)) and line_height > 0:
            paragraph.line_spacing = Pt(max((fmt.size_px or base.size_px or 18) for _, fmt in runs or [("", base)]) * px_to_pt * float(line_height))
        paragraph_line = css.get("line-height", "")
        if re.fullmatch(r"[\d.]+", paragraph_line):
            paragraph.line_spacing = float(paragraph_line) / 1.2  # CSS 1.2 is PowerPoint's single spacing
        elif _px(paragraph_line):
            paragraph.line_spacing = Pt(_px(paragraph_line) * px_to_pt)
        if _px(css.get("margin-top")):
            paragraph.space_before = Pt(_px(css.get("margin-top")) * px_to_pt)
        if _px(css.get("margin-bottom")):
            paragraph.space_after = Pt(_px(css.get("margin-bottom")) * px_to_pt)
        p_pr = paragraph._p.get_or_add_pPr()
        if list_tag:
            p_pr.set("lvl", str(min(8, level)))
            indent = int(342900 * (level + 1))
            p_pr.set("marL", str(indent))
            p_pr.set("indent", str(-228600))
            bullet = etree.SubElement(p_pr, qn("a:buAutoNum" if list_tag == "ol" else "a:buChar"))
            if list_tag == "ol":
                bullet.set("type", "arabicPeriod" if level % 2 == 0 else "alphaLcPeriod")
            else:
                bullet.set("char", "•" if level % 3 == 0 else ("◦" if level % 3 == 1 else "▪"))
        else:
            etree.SubElement(p_pr, qn("a:buNone"))
        if not runs:
            runs = [("", base)]
        for text, fmt in runs:
            if text == "\v":
                paragraph.add_line_break()
                continue
            run = paragraph.add_run()
            run.text = text
            font = run.font
            font.size = Pt(max(4, min(400, (fmt.size_px or 18) * px_to_pt)))
            font.bold = fmt.bold
            font.italic = fmt.italic
            font.underline = fmt.underline
            if fmt.strike:
                run._r.get_or_add_rPr().set("strike", "sngStrike")
            if fmt.letter_spacing_px:
                run._r.get_or_add_rPr().set("spc", str(round(fmt.letter_spacing_px * px_to_pt * 100)))
            if fmt.font:
                font.name = fmt.font
            if fmt.color:
                from pptx.dml.color import RGBColor

                font.color.rgb = RGBColor.from_string(fmt.color)


# ── notes ─────────────────────────────────────────────────────────────────────────────────

def read_notes(slide: Any) -> str:
    try:
        if slide.has_notes_slide:
            return slide.notes_slide.notes_text_frame.text.strip()
    except Exception:
        pass
    return ""


def write_notes(slide: Any, notes: str) -> None:
    if not notes or not notes.strip():
        return
    try:
        slide.notes_slide.notes_text_frame.text = notes.strip()
    except Exception:
        pass
