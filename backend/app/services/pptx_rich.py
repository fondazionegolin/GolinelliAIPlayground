"""Rich PowerPoint ↔ slide-editor conversion.

Slide text blocks in the editor hold small TipTap HTML documents (p / ul / ol / li / strong / em /
u / s / span[style: color, font-size, font-family] / br, paragraph text-align). This module maps
them to and from DrawingML text frames with per-run formatting, bullets and levels, and resolves
what PowerPoint leaves implicit on import: placeholder/layout/master text styles, theme colours
and theme fonts. It also reads shapes, groups, tables, slide backgrounds and speaker notes.
"""

from __future__ import annotations

import html
import re
from collections import Counter
from dataclasses import dataclass
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


def load_theme(presentation: Any) -> Theme:
    colors: dict[str, str] = {}
    major = minor = None
    try:
        master = presentation.slide_masters[0]
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


def _apply_luminance(hex_color: str, color_element: Any) -> str:
    red, green, blue = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    lum_mod = lum_off = None
    shade = tint = None
    for modifier in color_element:
        name = etree.QName(modifier).localname
        try:
            value = int(modifier.get("val", "0")) / 100000
        except ValueError:
            continue
        if name == "lumMod":
            lum_mod = value
        elif name == "lumOff":
            lum_off = value
        elif name == "shade":
            shade = value
        elif name == "tint":
            tint = value
    channels = [red, green, blue]
    if lum_mod is not None or lum_off is not None:
        channels = [min(255, max(0, round(c * (lum_mod if lum_mod is not None else 1) + 255 * (lum_off or 0)))) for c in channels]
    if shade is not None:
        channels = [round(c * shade) for c in channels]
    if tint is not None:
        channels = [round(c + (255 - c) * (1 - tint)) for c in channels]
    return "".join(f"{c:02X}" for c in channels)


def color_of(fill_parent: Any, theme: Theme) -> str | None:
    """Hex colour of a:solidFill (or a colour element) under `fill_parent`."""
    if fill_parent is None:
        return None
    solid = fill_parent.find(qn("a:solidFill")) if etree.QName(fill_parent).localname != "solidFill" else fill_parent
    if solid is None:
        return None
    for color in solid:
        name = etree.QName(color).localname
        if name == "srgbClr" and color.get("val"):
            return _apply_luminance(color.get("val").upper(), color)
        if name == "schemeClr":
            scheme = SCHEME_ALIASES.get(color.get("val"), color.get("val"))
            base = theme.colors.get(scheme)
            return _apply_luminance(base, color) if base else None
        if name == "sysClr" and color.get("lastClr"):
            return color.get("lastClr").upper()
        if name == "prstClr":
            return {"black": "000000", "white": "FFFFFF", "red": "FF0000", "blue": "0000FF"}.get(color.get("val"))
    return None


def resolve_typeface(typeface: str | None, theme: Theme) -> str | None:
    if not typeface:
        return None
    if typeface.startswith("+mj"):
        return theme.major_font
    if typeface.startswith("+mn"):
        return theme.minor_font
    return typeface


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
        return None

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


def text_frame_to_html(shape: Any, slide: Any, presentation: Any, theme: Theme, pt_to_px: float) -> TextImport:
    frame = shape.text_frame
    sizes: Counter[float] = Counter()
    colors: Counter[str] = Counter()
    fonts: Counter[str] = Counter()
    aligns: Counter[str] = Counter()
    bold_chars = total_chars = 0
    items: list[tuple[str | None, int, str, str | None]] = []  # (list tag, level, inner html, align)

    for paragraph in frame.paragraphs:
        p_pr = paragraph._p.find(qn("a:pPr"))
        level = int(p_pr.get("lvl", "0")) if p_pr is not None and p_pr.get("lvl", "0").isdigit() else 0
        chain = level_styles(shape, slide, presentation, level) + ([p_pr] if p_pr is not None else [])
        context = ParagraphContext(chain, theme)
        fragments: list[str] = []
        for child in paragraph._p:
            name = etree.QName(child).localname
            if name == "br":
                fragments.append("<br>")
                continue
            if name not in {"r", "fld"}:
                continue
            text = "".join(t.text or "" for t in child.iter(qn("a:t")))
            if not text:
                continue
            r_pr = child.find(qn("a:rPr"))
            size_raw = context.run_attr(r_pr, "sz")
            size_pt = int(size_raw) / 100 if size_raw and size_raw.isdigit() else 18.0
            color = context.run_color(r_pr)
            font = context.run_font(r_pr)
            bold = context.run_attr(r_pr, "b") in {"1", "true"}
            italic = context.run_attr(r_pr, "i") in {"1", "true"}
            underline = (context.run_attr(r_pr, "u") or "none") != "none"
            strike = (context.run_attr(r_pr, "strike") or "noStrike") != "noStrike"
            weight = len(text)
            sizes[round(size_pt * pt_to_px, 1)] += weight
            if color:
                colors[color] += weight
            if font:
                fonts[font] += weight
            total_chars += weight
            bold_chars += weight if bold else 0
            fragments.append(_run_html(text, size_pt * pt_to_px, color, font, bold, italic, underline, strike))
        align = ALIGN_TO_CSS.get(p_pr.get("algn")) if p_pr is not None and p_pr.get("algn") else context.alignment()
        if align:
            aligns[align] += 1
        list_tag = context.bullet() if fragments else None
        items.append((list_tag, level, "".join(fragments), align))

    dominant_size = sizes.most_common(1)[0][0] if sizes else None
    dominant_color = colors.most_common(1)[0][0] if colors else None
    dominant_font = fonts.most_common(1)[0][0] if fonts else None
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
                if prop == "font-family" and dominant_font and value.strip("'\"") == dominant_font:
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

    output: list[str] = []
    open_lists: list[tuple[int, str]] = []
    for list_tag, level, inner, align in items:
        inner = simplify(inner) or "<br>"
        style = f' style="text-align: {align}"' if align and align != block_align else ""
        if list_tag is None:
            while open_lists:
                output.append(f"</li></{open_lists.pop()[1]}>")
            output.append(f"<p{style}>{inner}</p>")
            continue
        while open_lists and (open_lists[-1][0] > level or (open_lists[-1][0] == level and open_lists[-1][1] != list_tag)):
            output.append(f"</li></{open_lists.pop()[1]}>")
        if open_lists and open_lists[-1][0] == level:
            output.append(f"</li><li><p{style}>{inner}</p>")
        else:
            output.append(f"<{list_tag}><li><p{style}>{inner}</p>")
            open_lists.append((level, list_tag))
    while open_lists:
        output.append(f"</li></{open_lists.pop()[1]}>")

    return TextImport(
        html="".join(output) or "<p></p>",
        plain=frame.text,
        font_px=dominant_size,
        color=f"#{dominant_color}" if dominant_color else None,
        font_family=dominant_font,
        align=block_align,
        bold=block_bold,
    )


def _run_html(text: str, size_px: float, color: str | None, font: str | None, bold: bool, italic: bool, underline: bool, strike: bool) -> str:
    escaped = html.escape(text).replace("\v", "<br>")
    styles = [f"font-size: {round(size_px, 1):g}px"]
    if color:
        styles.append(f"color: #{color.lower()}")
    if font:
        styles.append(f"font-family: {font}")
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
    return bool(re.search(r"<\s*(p|span|strong|em|u|s|br|ul|ol|li|b|i)\b", value, re.IGNORECASE))


def fill_text_frame(frame: Any, content: str, block_style: dict[str, Any], px_to_pt: float) -> None:
    """Write editor text-block content (HTML or legacy plain text) into a python-pptx text frame."""
    base = _Fmt(
        bold=str(block_style.get("fontWeight") or "").lower() in {"bold", "600", "700", "800", "900"},
        italic=str(block_style.get("fontStyle") or "").lower() == "italic",
        underline="underline" in str(block_style.get("textDecoration") or "").lower(),
        strike="line-through" in str(block_style.get("textDecoration") or "").lower(),
        color=_hex(str(block_style.get("color") or "")) or "000000",
        size_px=float(block_style.get("fontSize") or 18),
        font=str(block_style.get("fontFamily")) if block_style.get("fontFamily") else None,
    )
    block_align = CSS_TO_ALIGN.get(str(block_style.get("textAlign") or "left"), PP_ALIGN.LEFT)
    line_height = block_style.get("lineHeight")

    if not _looks_like_html(content or ""):
        paragraphs: list[tuple[list[tuple[str, _Fmt]], str | None, int, str | None]] = [
            ([(line, base)], None, 0, None) for line in (content or "").split("\n")
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
                for child in item.children:
                    if isinstance(child, Tag) and child.name in {"ul", "ol"}:
                        continue
                    if isinstance(child, Tag) and child.name == "p":
                        align = _css(child).get("text-align") or align
                        if runs:
                            runs.append(("\v", base))
                    inline_runs(child, base, runs)
                paragraphs.append((runs, node.name, level, align))
                for nested in item.find_all(["ul", "ol"], recursive=False):
                    walk_list(nested, level + 1)

        for node in soup.children:
            if isinstance(node, Tag) and node.name in {"ul", "ol"}:
                walk_list(node, 0)
            elif isinstance(node, Tag) and node.name == "p":
                runs: list[tuple[str, _Fmt]] = []
                for child in node.children:
                    inline_runs(child, base, runs)
                paragraphs.append((runs, None, 0, _css(node).get("text-align")))
            else:
                runs = []
                inline_runs(node, base, runs)
                if any(text.strip() for text, _ in runs):
                    paragraphs.append((runs, None, 0, None))
        if not paragraphs:
            paragraphs = [([("", base)], None, 0, None)]

    frame.clear()
    for index, (runs, list_tag, level, align) in enumerate(paragraphs):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.alignment = CSS_TO_ALIGN.get(align or "", block_align)
        if isinstance(line_height, (int, float)) and line_height > 0:
            paragraph.line_spacing = float(line_height)
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
