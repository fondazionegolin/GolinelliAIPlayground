"""Import/export bridge between LMS files and the native document editors.

The original upload is always kept separately in object storage.  This module only
creates an editable representation or a newly exported copy, so conversions are
non-destructive by design.
"""

from __future__ import annotations

import base64
import csv
import datetime
import html
import io
import json
import mimetypes
import re
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz
from bs4 import BeautifulSoup
from lxml import etree
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.styles.colors import COLOR_INDEX
from openpyxl.utils import get_column_letter
from openpyxl.utils.datetime import to_excel
from PIL import Image, ImageOps

from app.services import pptx_rich
from app.services.pptx_import import pptx_to_native
from app.services.docx_writer import html_to_docx
from pptx.oxml.ns import qn as qn_pptx
from pptx import Presentation
from pptx.dml.color import RGBColor as PptxRGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.enum.text import MSO_AUTO_SIZE, MSO_VERTICAL_ANCHOR, PP_ALIGN
from pptx.util import Inches as PptxInches, Pt as PptxPt


# The editor's own defaults: runs that resolve to these carry no inline style (keeps HTML clean and
# makes export → import stable).
EDITOR_DEFAULT_FONT = "Arial"
EDITOR_DEFAULT_HALF_POINTS = 24

SUPPORTED_IMPORT_EXTENSIONS = {"pdf", "ppt", "pptx", "doc", "docx", "md", "xls", "xlsx", "csv"}
SUPPORTED_EXPORT_FORMATS = {"pdf", "ppt", "pptx", "doc", "docx", "xlsx"}

MIME_BY_EXTENSION = {
    "pdf": "application/pdf",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "md": "text/markdown",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv",
}


@dataclass(slots=True)
class ImportedDocument:
    title: str
    doc_type: str
    content_json: str
    extension: str


@dataclass(slots=True)
class ExportedDocument:
    filename: str
    mime_type: str
    content: bytes


def normalized_extension(filename: str) -> str:
    return Path(filename or "").suffix.lower().lstrip(".")


def _safe_title(filename: str) -> str:
    title = Path(filename or "Documento").stem.strip()
    return title[:255] or "Documento"


def _source_metadata(filename: str, mime_type: str, file_id: str | None) -> dict[str, Any]:
    extension = normalized_extension(filename)
    return {
        "filename": Path(filename).name,
        "extension": extension,
        "mimeType": mime_type or MIME_BY_EXTENSION.get(extension, "application/octet-stream"),
        "fileId": file_id,
        "url": f"/api/v1/files/{file_id}/content" if file_id else None,
        "preservedOriginal": True,
    }


def _run_libreoffice(input_bytes: bytes, source_ext: str, target_ext: str, input_filter: str | None = None) -> bytes:
    executable = shutil.which("libreoffice") or shutil.which("soffice")
    if not executable:
        raise RuntimeError("LibreOffice non è disponibile per questa conversione")
    with tempfile.TemporaryDirectory(prefix="eduai-office-") as temp_dir:
        root = Path(temp_dir)
        source = root / f"source.{source_ext}"
        source.write_bytes(input_bytes)
        command = [
            executable,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            *([f"--infilter={input_filter}"] if input_filter else []),
            "--convert-to",
            target_ext,
            "--outdir",
            str(root),
            str(source),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=240, check=False)
        output = root / f"source.{target_ext}"
        if completed.returncode != 0 or not output.exists():
            detail = (completed.stderr or completed.stdout or "conversione non riuscita").strip()
            raise RuntimeError(f"LibreOffice: {detail[:400]}")
        return output.read_bytes()


def _markdown_to_html(raw: str) -> str:
    lines = raw.replace("\r\n", "\n").split("\n")
    rendered: list[str] = []
    in_list = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(("- ", "* ")):
            if not in_list:
                rendered.append("<ul>")
                in_list = True
            rendered.append(f"<li>{html.escape(stripped[2:])}</li>")
            continue
        if in_list:
            rendered.append("</ul>")
            in_list = False
        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            level = len(heading.group(1))
            rendered.append(f"<h{level}>{html.escape(heading.group(2))}</h{level}>")
        elif stripped:
            value = html.escape(stripped)
            value = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", value)
            value = re.sub(r"`(.+?)`", r"<code>\1</code>", value)
            rendered.append(f"<p>{value}</p>")
        else:
            rendered.append("<p></p>")
    if in_list:
        rendered.append("</ul>")
    return "\n".join(rendered) or "<p></p>"


_DOCX_HIGHLIGHT_COLORS = {
    "black": "#000000",
    "blue": "#0000ff",
    "cyan": "#00ffff",
    "darkBlue": "#000080",
    "darkCyan": "#008080",
    "darkGray": "#808080",
    "darkGreen": "#008000",
    "darkMagenta": "#800080",
    "darkRed": "#800000",
    "darkYellow": "#808000",
    "green": "#00ff00",
    "lightGray": "#c0c0c0",
    "magenta": "#ff00ff",
    "red": "#ff0000",
    "white": "#ffffff",
    "yellow": "#ffff00",
}
_VML_IMAGE_TAG = "{urn:schemas-microsoft-com:vml}imagedata"


def _docx_bool(element: Any | None) -> bool:
    if element is None:
        return False
    return str(element.get(qn("w:val"), "true")).lower() not in {"0", "false", "off", "none"}


def _docx_comments(data: bytes) -> dict[str, dict[str, str]]:
    comments: dict[str, dict[str, str]] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            raw = archive.read("word/comments.xml")
    except (KeyError, zipfile.BadZipFile):
        return comments

    # python-docx already depends on lxml and returns the same OOXML element type.
    from docx.oxml import parse_xml

    root = parse_xml(raw)
    for node in root:
        if node.tag != qn("w:comment"):
            continue
        comment_id = str(node.get(qn("w:id"), ""))
        text = "".join(
            str(item.text or "")
            for item in node.iter()
            if item.tag in {qn("w:t"), qn("w:delText")}
        ).strip()
        comments[comment_id] = {
            "author": str(node.get(qn("w:author"), "")),
            "date": str(node.get(qn("w:date"), "")),
            "text": text,
        }
    return comments


def _docx_style_context(document: Any) -> dict[str, Any]:
    names: dict[str, str] = {}
    elements: dict[str, Any] = {}
    default_paragraph = ""
    for style in document.styles.element:
        if style.tag != qn("w:style"):
            continue
        style_id = str(style.get(qn("w:styleId"), ""))
        if style.get(qn("w:type")) == "paragraph" and style.get(qn("w:default")) in {"1", "true"}:
            default_paragraph = style_id
        name = style.find(qn("w:name"))
        names[style_id] = str(name.get(qn("w:val"), style_id)) if name is not None else style_id
        elements[style_id] = style
    defaults = document.styles.element.find(qn("w:docDefaults"))
    run_defaults = None
    if defaults is not None:
        run_properties_default = defaults.find(qn("w:rPrDefault"))
        if run_properties_default is not None:
            run_defaults = run_properties_default.find(qn("w:rPr"))
    return {
        "names": names,
        "elements": elements,
        "run_defaults": run_defaults,
        "numbering": _docx_numbering_formats(document),
        "default_paragraph": default_paragraph,
        "theme_fonts": _docx_theme_fonts(document),
    }


def _docx_theme_fonts(document: Any) -> dict[str, str]:
    """{'major': …, 'minor': …} latin typefaces of the document theme (Word's default body font
    is referenced as asciiTheme="minorHAnsi", never by name)."""
    try:
        theme_part = document.part.part_related_by(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
        )
        root = etree.fromstring(theme_part.blob)
    except Exception:
        return {}
    namespace = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    fonts: dict[str, str] = {}
    for kind in ("major", "minor"):
        latin = root.find(f".//{namespace}{kind}Font/{namespace}latin")
        if latin is not None and latin.get("typeface"):
            fonts[kind] = str(latin.get("typeface"))
    return fonts


def _docx_numbering_formats(document: Any) -> dict[tuple[str, int], str]:
    """(numId, ilvl) → numFmt ('bullet', 'decimal', …) from numbering.xml."""
    try:
        numbering = document.part.numbering_part.element
    except Exception:
        return {}
    abstract_formats: dict[str, dict[int, str]] = {}
    for abstract in numbering.findall(qn("w:abstractNum")):
        levels: dict[int, str] = {}
        for level in abstract.findall(qn("w:lvl")):
            fmt = level.find(qn("w:numFmt"))
            try:
                levels[int(level.get(qn("w:ilvl"), "0"))] = str(fmt.get(qn("w:val"), "bullet")) if fmt is not None else "bullet"
            except ValueError:
                continue
        abstract_formats[str(abstract.get(qn("w:abstractNumId"), ""))] = levels
    formats: dict[tuple[str, int], str] = {}
    for num in numbering.findall(qn("w:num")):
        abstract_ref = num.find(qn("w:abstractNumId"))
        if abstract_ref is None:
            continue
        for level, fmt in abstract_formats.get(str(abstract_ref.get(qn("w:val"), "")), {}).items():
            formats[(str(num.get(qn("w:numId"), "")), level)] = fmt
    return formats


def _docx_list_info(paragraph: Any, style_id: str, style_name: str, style_context: dict[str, Any]) -> tuple[str, int, bool] | None:
    """(list id, level, ordered) for a list paragraph, following direct numPr then the style chain."""
    num_pr = None
    properties = paragraph.find(qn("w:pPr"))
    if properties is not None:
        num_pr = properties.find(qn("w:numPr"))
    if num_pr is None:
        for style in reversed(_docx_style_chain(style_id, style_context)):
            style_ppr = style.find(qn("w:pPr"))
            if style_ppr is not None and style_ppr.find(qn("w:numPr")) is not None:
                num_pr = style_ppr.find(qn("w:numPr"))
                break
    lowered = style_name.lower()
    if num_pr is not None:
        num_id_el = num_pr.find(qn("w:numId"))
        level_el = num_pr.find(qn("w:ilvl"))
        num_id = str(num_id_el.get(qn("w:val"), "")) if num_id_el is not None else ""
        if num_id == "0":
            return None  # numbering explicitly removed
        try:
            level = int(level_el.get(qn("w:val"), "0")) if level_el is not None else 0
        except ValueError:
            level = 0
        fmt = style_context.get("numbering", {}).get((num_id, level))
        ordered = fmt not in {None, "bullet", "none"} if fmt else ("number" in lowered or "numer" in lowered)
        return (num_id or style_id, level, ordered)
    if "list" in lowered or "elenco" in lowered:
        return (style_id, 0, "number" in lowered or "numer" in lowered)
    return None


def _docx_style_chain(style_id: str, style_context: dict[str, Any]) -> list[Any]:
    elements = style_context["elements"]
    chain: list[Any] = []
    seen: set[str] = set()
    current_id = style_id
    while current_id and current_id not in seen:
        seen.add(current_id)
        style = elements.get(current_id)
        if style is None:
            break
        chain.append(style)
        based_on = style.find(qn("w:basedOn"))
        current_id = str(based_on.get(qn("w:val"), "")) if based_on is not None else ""
    chain.reverse()
    return chain


def _docx_run_property(
    run_properties: Any | None,
    paragraph_style_id: str,
    style_context: dict[str, Any],
    property_name: str,
) -> Any | None:
    sources: list[Any] = []
    if style_context.get("run_defaults") is not None:
        sources.append(style_context["run_defaults"])
    for style in _docx_style_chain(paragraph_style_id or style_context.get("default_paragraph", ""), style_context):
        inherited = style.find(qn("w:rPr"))
        if inherited is not None:
            sources.append(inherited)
    if run_properties is not None:
        character_style = run_properties.find(qn("w:rStyle"))
        character_style_id = (
            str(character_style.get(qn("w:val"), "")) if character_style is not None else ""
        )
        for style in _docx_style_chain(character_style_id, style_context):
            inherited = style.find(qn("w:rPr"))
            if inherited is not None:
                sources.append(inherited)
        sources.append(run_properties)
    result = None
    for source in sources:
        candidate = source.find(qn(f"w:{property_name}"))
        if candidate is not None:
            result = candidate
    return result


def _docx_relationship(part: Any, relationship_id: str) -> Any | None:
    try:
        return part.rels[relationship_id]
    except (KeyError, TypeError):
        return None


_BROWSER_IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/svg+xml", "image/bmp"}
_VECTOR_OFFICE_IMAGES = {"image/x-emf": "emf", "image/emf": "emf", "image/x-wmf": "wmf", "image/wmf": "wmf"}


def _web_image(blob: bytes, content_type: str) -> tuple[bytes, str]:
    """Office pictures a browser cannot show (EMF/WMF drawings, TIFF…) → PNG."""
    content_type = (content_type or "").lower()
    if content_type in _BROWSER_IMAGE_TYPES:
        return blob, content_type
    if content_type in _VECTOR_OFFICE_IMAGES:
        try:
            return _run_libreoffice(blob, _VECTOR_OFFICE_IMAGES[content_type], "png"), "image/png"
        except Exception:
            return b"", content_type
    try:
        with Image.open(io.BytesIO(blob)) as image:
            output = io.BytesIO()
            image.convert("RGBA").save(output, format="PNG")
            return output.getvalue(), "image/png"
    except Exception:
        return blob, content_type or "image/png"


def _docx_image_html(element: Any, part: Any) -> str:
    relationship_id = ""
    for descendant in element.iter():
        if descendant.tag == qn("a:blip"):
            relationship_id = str(descendant.get(qn("r:embed"), ""))
            break
        if descendant.tag == _VML_IMAGE_TAG:
            relationship_id = str(descendant.get(qn("r:id"), ""))
            break
    relationship = _docx_relationship(part, relationship_id)
    if relationship is None:
        return ""
    target_part = getattr(relationship, "target_part", None)
    blob = getattr(target_part, "blob", None)
    if not blob:
        return ""

    alt = "Immagine importata"
    width = ""
    height = ""
    for descendant in element.iter():
        if descendant.tag == qn("wp:docPr"):
            alt = str(
                descendant.get("descr")
                or descendant.get("title")
                or descendant.get("name")
                or alt
            )
        elif descendant.tag == qn("wp:extent"):
            try:
                width = str(max(1, round(int(descendant.get("cx", "0")) / 9525)))
                height = str(max(1, round(int(descendant.get("cy", "0")) / 9525)))
            except (TypeError, ValueError):
                width = height = ""

    blob, content_type = _web_image(blob, str(getattr(target_part, "content_type", "image/png")))
    if not blob:
        return ""
    encoded = base64.b64encode(blob).decode("ascii")
    dimensions = f' width="{width}" height="{height}"' if width and height else ""
    return (
        f'<img src="data:{html.escape(content_type, quote=True)};base64,{encoded}"'
        f' alt="{html.escape(alt, quote=True)}"{dimensions}>'
    )


def _docx_run_html(
    run: Any,
    part: Any,
    paragraph_style_id: str,
    style_context: dict[str, Any],
) -> str:
    fragments: list[str] = []
    for child in run:
        if child.tag in {qn("w:t"), qn("w:delText"), qn("w:instrText")}:
            fragments.append(html.escape(str(child.text or "")))
        elif child.tag == qn("w:tab"):
            fragments.append("&emsp;")
        elif child.tag in {qn("w:br"), qn("w:cr")}:
            fragments.append("<br>")
        elif child.tag == qn("w:noBreakHyphen"):
            fragments.append("&#8209;")
        elif child.tag in {qn("w:drawing"), qn("w:pict"), qn("w:object")}:
            fragments.append(_docx_image_html(child, part))
    content = "".join(fragments)
    if not content:
        return ""

    properties = run.find(qn("w:rPr"))
    wrappers: list[str] = []
    styles: list[str] = []
    style_name = style_context["names"].get(paragraph_style_id, paragraph_style_id)
    in_heading = bool(re.search(r"(?:heading|titolo)\s*[1-6]", style_name, re.IGNORECASE))

    def direct(name: str) -> Any | None:
        return properties.find(qn(f"w:{name}")) if properties is not None else None

    def resolved(name: str) -> Any | None:
        # Heading paragraphs: size/weight/colour/font implied by the <hN> tag unless set on the run.
        if in_heading and name in {"b", "sz", "color", "rFonts"}:
            return direct(name)
        return _docx_run_property(properties, paragraph_style_id, style_context, name)

    if _docx_bool(resolved("b")):
        wrappers.append("strong")
    if _docx_bool(_docx_run_property(properties, paragraph_style_id, style_context, "i")):
        wrappers.append("em")
    if _docx_bool(_docx_run_property(properties, paragraph_style_id, style_context, "u")):
        wrappers.append("u")
    if _docx_bool(_docx_run_property(properties, paragraph_style_id, style_context, "strike")) or _docx_bool(
        _docx_run_property(properties, paragraph_style_id, style_context, "dstrike")
    ):
        wrappers.append("s")

    vertical = _docx_run_property(properties, paragraph_style_id, style_context, "vertAlign")
    vertical_value = str(vertical.get(qn("w:val"), "")) if vertical is not None else ""
    if vertical_value == "superscript":
        wrappers.append("sup")
    elif vertical_value == "subscript":
        wrappers.append("sub")

    color = resolved("color")
    color_value = str(color.get(qn("w:val"), "")) if color is not None else ""
    if re.fullmatch(r"[0-9A-Fa-f]{6}", color_value) and color_value.upper() != "000000":
        styles.append(f"color:#{color_value}")

    highlight = _docx_run_property(properties, paragraph_style_id, style_context, "highlight")
    highlight_value = str(highlight.get(qn("w:val"), "")) if highlight is not None else ""
    if highlight_value in _DOCX_HIGHLIGHT_COLORS:
        styles.append(f"background-color:{_DOCX_HIGHLIGHT_COLORS[highlight_value]}")

    shading = _docx_run_property(properties, paragraph_style_id, style_context, "shd")
    shading_fill = str(shading.get(qn("w:fill"), "")) if shading is not None else ""
    if re.fullmatch(r"[0-9A-Fa-f]{6}", shading_fill) and shading_fill.lower() != "auto":
        styles.append(f"background-color:#{shading_fill}")

    size = resolved("sz")
    try:
        half_points = int(size.get(qn("w:val"), "0")) if size is not None else 0
    except (TypeError, ValueError):
        half_points = 0
    if half_points and half_points != EDITOR_DEFAULT_HALF_POINTS:
        styles.append(f"font-size:{half_points / 2:g}pt")

    fonts = resolved("rFonts")
    if fonts is not None:
        family = (
            fonts.get(qn("w:ascii"))
            or fonts.get(qn("w:hAnsi"))
            or fonts.get(qn("w:eastAsia"))
        )
        if not family:
            theme_ref = str(fonts.get(qn("w:asciiTheme")) or fonts.get(qn("w:hAnsiTheme")) or "")
            if theme_ref:
                family = style_context.get("theme_fonts", {}).get("major" if theme_ref.startswith("major") else "minor")
        if family and str(family).lower() != EDITOR_DEFAULT_FONT.lower():
            safe_family = str(family).replace('"', "").replace("'", "")
            styles.append(f"font-family:'{safe_family}'")

    if styles:
        content = f'<span style="{html.escape(";".join(styles), quote=True)}">{content}</span>'
    for wrapper in wrappers:
        content = f"<{wrapper}>{content}</{wrapper}>"
    return content


def _docx_annotation_attributes(metadata: dict[str, str], prefix: str) -> str:
    return " ".join(
        f'data-{prefix}-{name}="{html.escape(str(value), quote=True)}"'
        for name, value in metadata.items()
        if value
    )


def _docx_inline_html(
    parent: Any,
    part: Any,
    comments: dict[str, dict[str, str]],
    active_comments: set[str],
    paragraph_style_id: str,
    style_context: dict[str, Any],
) -> str:
    output: list[str] = []
    for child in parent:
        if child.tag in {qn("w:pPr"), qn("w:rPr")}:
            continue
        if child.tag == qn("w:commentRangeStart"):
            active_comments.add(str(child.get(qn("w:id"), "")))
            continue
        if child.tag == qn("w:commentRangeEnd"):
            active_comments.discard(str(child.get(qn("w:id"), "")))
            continue

        fragment = ""
        if child.tag == qn("w:r"):
            fragment = _docx_run_html(child, part, paragraph_style_id, style_context)
            references = [
                str(reference.get(qn("w:id"), ""))
                for reference in child.iter()
                if reference.tag == qn("w:commentReference")
            ]
            if not fragment and references:
                fragment = "&#8203;"
        elif child.tag == qn("w:hyperlink"):
            fragment = _docx_inline_html(
                child,
                part,
                comments,
                active_comments,
                paragraph_style_id,
                style_context,
            )
            relationship_id = str(child.get(qn("r:id"), ""))
            relationship = _docx_relationship(part, relationship_id)
            href = str(getattr(relationship, "target_ref", "") or "")
            anchor = str(child.get(qn("w:anchor"), "") or "")
            if anchor and not href:
                href = f"#{anchor}"
            if href:
                fragment = f'<a href="{html.escape(href, quote=True)}">{fragment}</a>'
        elif child.tag in {qn("w:ins"), qn("w:del")}:
            fragment = _docx_inline_html(
                child,
                part,
                comments,
                active_comments,
                paragraph_style_id,
                style_context,
            )
            kind = "insert" if child.tag == qn("w:ins") else "delete"
            metadata = {
                "author": str(child.get(qn("w:author"), "")),
                "date": str(child.get(qn("w:date"), "")),
            }
            attributes = _docx_annotation_attributes(metadata, "revision")
            fragment = f'<span data-revision-kind="{kind}" {attributes}>{fragment}</span>'
        elif child.tag in {qn("w:smartTag"), qn("w:sdt"), qn("w:sdtContent"), qn("w:fldSimple")}:
            fragment = _docx_inline_html(
                child,
                part,
                comments,
                active_comments,
                paragraph_style_id,
                style_context,
            )

        if fragment and active_comments:
            for comment_id in sorted(active_comments):
                metadata = comments.get(comment_id, {})
                attributes = _docx_annotation_attributes(
                    {"id": comment_id, **metadata},
                    "comment",
                )
                fragment = f'<span data-docx-comment="true" {attributes}>{fragment}</span>'
        output.append(fragment)
    return "".join(output)


def _docx_paragraph_html(
    paragraph: Any,
    part: Any,
    comments: dict[str, dict[str, str]],
    active_comments: set[str],
    style_context: dict[str, Any],
    list_info_out: list[Any] | None = None,
) -> str:
    properties = paragraph.find(qn("w:pPr"))
    style_id = ""
    alignment = ""
    if properties is not None:
        style = properties.find(qn("w:pStyle"))
        style_id = str(style.get(qn("w:val"), "")) if style is not None else ""
        justification = properties.find(qn("w:jc"))
        alignment_value = str(justification.get(qn("w:val"), "")) if justification is not None else ""
        alignment = {
            "both": "justify",
            "distribute": "justify",
            "center": "center",
            "right": "right",
            "left": "left",
        }.get(alignment_value, "")

    style_name = style_context["names"].get(style_id, style_id)
    heading = re.search(r"(?:heading|titolo)\s*([1-6])", style_name, re.IGNORECASE)
    content = _docx_inline_html(
        paragraph,
        part,
        comments,
        active_comments,
        style_id,
        style_context,
    ) or "<br>"
    style_attribute = f' style="text-align:{alignment}"' if alignment else ""
    if heading:
        tag = f"h{heading.group(1)}"
        return f"<{tag}{style_attribute}>{content}</{tag}>"
    list_info = _docx_list_info(paragraph, style_id, style_name, style_context) if not heading else None
    if list_info is not None:
        if list_info_out is not None:
            list_info_out.append(list_info)
            return f"<p{style_attribute}>{content}</p>"
        tag = "ol" if list_info[2] else "ul"
        return f"<{tag}><li><p{style_attribute}>{content}</p></li></{tag}>"
    return f"<p{style_attribute}>{content}</p>"


def _docx_table_html(
    table: Any,
    part: Any,
    comments: dict[str, dict[str, str]],
    style_context: dict[str, Any],
) -> str:
    row_elements = [child for child in table if child.tag == qn("w:tr")]
    # First pass: grid positions, spans and vertical merges.
    layout: list[list[dict[str, Any]]] = []
    origins: dict[int, dict[str, Any]] = {}
    for row in row_elements:
        column = 0
        cells: list[dict[str, Any]] = []
        is_header_row = False
        row_properties = row.find(qn("w:trPr"))
        if row_properties is not None and row_properties.find(qn("w:tblHeader")) is not None:
            is_header_row = True
        for cell in (child for child in row if child.tag == qn("w:tc")):
            properties = cell.find(qn("w:tcPr"))
            span = 1
            merge_state = None
            fill = ""
            if properties is not None:
                grid_span = properties.find(qn("w:gridSpan"))
                try:
                    span = max(1, int(grid_span.get(qn("w:val")))) if grid_span is not None else 1
                except (TypeError, ValueError):
                    span = 1
                vertical_merge = properties.find(qn("w:vMerge"))
                if vertical_merge is not None:
                    merge_state = str(vertical_merge.get(qn("w:val"), "continue") or "continue")
                shading = properties.find(qn("w:shd"))
                fill = str(shading.get(qn("w:fill"), "")) if shading is not None else ""
            entry = {"element": cell, "span": span, "rowspan": 1, "fill": fill, "skip": False, "header": is_header_row}
            if merge_state == "continue" and column in origins:
                origins[column]["rowspan"] += 1
                entry["skip"] = True
            elif merge_state == "restart":
                origins[column] = entry
            else:
                origins.pop(column, None)
            cells.append(entry)
            column += span
        layout.append(cells)

    has_declared_header = any(cell["header"] for cells in layout for cell in cells)
    rows: list[str] = []
    for row_index, cells in enumerate(layout):
        rendered: list[str] = []
        for entry in cells:
            if entry["skip"]:
                continue
            attributes: list[str] = []
            if entry["span"] > 1:
                attributes.append(f'colspan="{entry["span"]}"')
            if entry["rowspan"] > 1:
                attributes.append(f'rowspan="{entry["rowspan"]}"')
            if re.fullmatch(r"[0-9A-Fa-f]{6}", entry["fill"]) and entry["fill"].lower() != "auto":
                attributes.append(f'style="background-color:#{entry["fill"]}"')
            blocks = _docx_blocks_html(entry["element"], part, comments, style_context)
            is_header = entry["header"] if has_declared_header else row_index == 0
            tag = "th" if is_header else "td"
            rendered.append(f"<{tag} {' '.join(attributes)}>{''.join(blocks) or '<p><br></p>'}</{tag}>")
        rows.append(f"<tr>{''.join(rendered)}</tr>")
    return f"<table><tbody>{''.join(rows)}</tbody></table>"


def _docx_blocks_html(
    container: Any,
    part: Any,
    comments: dict[str, dict[str, str]],
    style_context: dict[str, Any],
) -> list[str]:
    """Blocks of a body/cell/header: paragraphs, tables and properly nested lists."""
    output: list[str] = []
    active_comments: set[str] = set()
    open_lists: list[tuple[int, str]] = []  # (level, tag); each has an open <li>

    def close_to(level: int) -> None:
        while open_lists and open_lists[-1][0] > level:
            output.append(f"</li></{open_lists.pop()[1]}>")

    def close_all() -> None:
        close_to(-1)

    def emit_list_item(level: int, ordered: bool, content: str) -> None:
        tag = "ol" if ordered else "ul"
        close_to(level)
        if open_lists and open_lists[-1][0] == level and open_lists[-1][1] != tag:
            output.append(f"</li></{open_lists.pop()[1]}>")
        if open_lists and open_lists[-1][0] == level:
            output.append("</li><li>")
        else:
            output.append(f"<{tag}><li>")
            open_lists.append((level, tag))
        output.append(content)

    for child in container:
        if child.tag == qn("w:p"):
            info: list[Any] = []
            html_fragment = _docx_paragraph_html(child, part, comments, active_comments, style_context, info)
            if info:
                _, level, ordered = info[0]
                emit_list_item(level, ordered, html_fragment)
            else:
                close_all()
                output.append(html_fragment)
        elif child.tag == qn("w:tbl"):
            close_all()
            output.append(_docx_table_html(child, part, comments, style_context))
        elif child.tag == qn("w:sdt"):
            content = child.find(qn("w:sdtContent"))
            if content is not None:
                close_all()
                output.extend(_docx_blocks_html(content, part, comments, style_context))
    close_all()
    return output


def _docx_part_blocks(
    container: Any,
    part: Any,
    comments: dict[str, dict[str, str]],
    style_context: dict[str, Any],
) -> list[str]:
    return _docx_blocks_html(container, part, comments, style_context)


def _docx_region_html(kind: str, label: str, blocks: list[str]) -> str:
    meaningful = "".join(blocks).replace("<p><br></p>", "").strip()
    if not meaningful:
        return ""
    return (
        f'<section data-docx-region="{kind}" data-docx-region-label="{html.escape(label, quote=True)}">'
        f"{''.join(blocks)}</section>"
    )


def _docx_to_html(data: bytes) -> str:
    document = Document(io.BytesIO(data))
    comments = _docx_comments(data)
    style_context = _docx_style_context(document)
    output: list[str] = []
    seen_parts: set[str] = set()

    for section in document.sections:
        for kind, label, region in (
            ("header", "Intestazione", section.header),
            ("header-first", "Intestazione prima pagina", section.first_page_header),
            ("header-even", "Intestazione pagine pari", section.even_page_header),
        ):
            part_name = str(region.part.partname)
            if part_name in seen_parts:
                continue
            seen_parts.add(part_name)
            output.append(
                _docx_region_html(
                    kind,
                    label,
                    _docx_part_blocks(region._element, region.part, comments, style_context),
                )
            )

    output.extend(_docx_part_blocks(document.element.body, document.part, comments, style_context))

    for section in document.sections:
        for kind, label, region in (
            ("footer", "Piè di pagina", section.footer),
            ("footer-first", "Piè di pagina prima pagina", section.first_page_footer),
            ("footer-even", "Piè di pagina pagine pari", section.even_page_footer),
        ):
            part_name = str(region.part.partname)
            if part_name in seen_parts:
                continue
            seen_parts.add(part_name)
            output.append(
                _docx_region_html(
                    kind,
                    label,
                    _docx_part_blocks(region._element, region.part, comments, style_context),
                )
            )
    return "\n".join(fragment for fragment in output if fragment) or "<p></p>"


def _docx_margins_px(data: bytes) -> dict[str, int] | None:
    """Page margins of the first section in editor pixels (96 dpi); the editor keeps them symmetric."""
    try:
        section = Document(io.BytesIO(data)).sections[0]
    except Exception:
        return None
    def to_px(*values: Any) -> int | None:
        known = [int(value) for value in values if value is not None]
        return round(sum(known) / len(known) / 914400 * 96) if known else None
    vertical = to_px(section.top_margin, section.bottom_margin)
    horizontal = to_px(section.left_margin, section.right_margin)
    if vertical is None or horizontal is None:
        return None
    return {"vertical": max(0, min(192, vertical)), "horizontal": max(0, min(192, horizontal))}


def _docx_page_setup(data: bytes) -> dict[str, str] | None:
    """{'size': 'a4'|'letter', 'orientation': 'portrait'|'landscape'} of the first section."""
    try:
        section = Document(io.BytesIO(data)).sections[0]
        width_mm, height_mm = section.page_width.mm, section.page_height.mm
    except Exception:
        return None
    short, long = sorted((width_mm, height_mm))
    size = "letter" if abs(short - 215.9) < 3 and abs(long - 279.4) < 3 else "a4"
    return {"size": size, "orientation": "landscape" if width_mm > height_mm else "portrait"}


def _pdf_to_html(data: bytes) -> str:
    pdf = fitz.open(stream=data, filetype="pdf")
    pages: list[str] = []
    try:
        for page_index, page in enumerate(pdf):
            blocks = sorted(page.get_text("blocks"), key=lambda block: (block[1], block[0]))
            paragraphs = [f"<p>{html.escape(str(block[4]).strip()).replace(chr(10), '<br>')}</p>" for block in blocks if str(block[4]).strip()]
            pages.append(
                f'<section data-imported-page="{page_index + 1}" style="break-after:page">'
                f"{''.join(paragraphs) or '<p></p>'}</section>"
            )
    finally:
        pdf.close()
    return "\n".join(pages) or "<p></p>"


def _pdf_first_page_preview(data: bytes) -> str | None:
    pdf = fitz.open(stream=data, filetype="pdf")
    try:
        if not pdf.page_count:
            return None
        page = pdf.load_page(0)
        scale = min(2.0, 1200 / max(1, page.rect.width))
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        encoded = base64.b64encode(pixmap.tobytes("jpeg", jpg_quality=82)).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"
    finally:
        pdf.close()


def _sheet_value(value: Any) -> str:
    """Machine form of a cell: the frontend formats it. Dates become Excel serials, as in the file."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        serial = float(to_excel(value))
        return str(int(serial)) if serial.is_integer() else str(round(serial, 8))
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _workbook_theme_colors(workbook: Any) -> list[str]:
    """Theme palette in the order cell colours index it (lt1, dk1, lt2, dk2, accents…)."""
    if not workbook.loaded_theme:
        return []
    try:
        namespace = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
        scheme = etree.fromstring(workbook.loaded_theme).find(f".//{namespace}clrScheme")
        palette = [(entry[0].get("lastClr") or entry[0].get("val") or "000000") for entry in scheme]
        palette[0], palette[1], palette[2], palette[3] = palette[1], palette[0], palette[3], palette[2]
        return palette
    except Exception:
        return []


def _excel_color(color: Any, theme_colors: list[str]) -> str | None:
    if color is None:
        return None
    base = None
    if color.type == "rgb" and isinstance(color.rgb, str):
        if color.rgb[:2] == "00" and len(color.rgb) == 8 and color.rgb[2:] == "000000":
            return None  # openpyxl's "unset" value
        base = color.rgb[-6:]
    elif color.type == "theme" and color.theme is not None and color.theme < len(theme_colors):
        base = theme_colors[color.theme]
    elif color.type == "indexed" and color.indexed is not None and color.indexed < len(COLOR_INDEX):
        if color.indexed >= 64:
            return None  # system foreground/background
        base = COLOR_INDEX[color.indexed][-6:]
    if not base:
        return None
    tint = float(color.tint or 0)
    if tint:
        channels = [int(base[i:i + 2], 16) for i in (0, 2, 4)]
        channels = [round(c * (1 + tint)) if tint < 0 else round(c + (255 - c) * tint) for c in channels]
        base = "".join(f"{c:02X}" for c in channels)
    return f"#{base.upper()}"


def _xlsx_to_native(data: bytes) -> dict[str, Any]:
    # Normal mode is required here: read-only worksheets do not expose column/
    # row dimensions and only provide a reduced style model.
    workbook = load_workbook(io.BytesIO(data), data_only=False, read_only=False)
    sheet = workbook.active
    theme_colors = _workbook_theme_colors(workbook)
    rows: list[list[str]] = []
    for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
        if row_index >= 1000:
            break
        values = [_sheet_value(value) for value in row[:100]]
        while values and values[-1] == "":
            values.pop()
        rows.append(values)
    while rows and not rows[-1]:
        rows.pop()
    column_count = min(sheet.max_column, 100)
    column_widths = [91] * column_count
    # openpyxl keeps one entry per run of equal-width columns, under the first column's letter.
    for dimension in sheet.column_dimensions.values():
        if dimension.width and dimension.min:
            for index in range(dimension.min, min(dimension.max or dimension.min, column_count) + 1):
                column_widths[index - 1] = round(dimension.width * 7)
    row_heights = [
        round((sheet.row_dimensions[index].height or 27) * 4 / 3)
        for index in range(1, min(sheet.max_row, 1000) + 1)
    ]
    styles: dict[str, dict[str, Any]] = {}
    for row in sheet.iter_rows(max_row=min(sheet.max_row, 1000), max_col=min(sheet.max_column, 100)):
        for cell in row:
            if not cell.has_style:
                continue
            cell_style: dict[str, Any] = {}
            if cell.font.name:
                cell_style["fontFamily"] = cell.font.name
            if cell.font.sz:
                cell_style["fontSize"] = round(float(cell.font.sz) * 4 / 3)
            if cell.font.bold:
                cell_style["fontWeight"] = "bold"
            if cell.font.italic:
                cell_style["fontStyle"] = "italic"
            if cell.font.underline:
                cell_style["textDecoration"] = "underline"
            text_color = _excel_color(cell.font.color, theme_colors)
            if text_color and text_color != "#000000":
                cell_style["color"] = text_color
            if cell.fill.fill_type == "solid":
                fill = _excel_color(cell.fill.fgColor, theme_colors)
                if fill:
                    cell_style["backgroundColor"] = fill
            if cell.alignment.horizontal in {"left", "center", "right"}:
                cell_style["textAlign"] = cell.alignment.horizontal
            if cell.alignment.wrap_text:
                cell_style["whiteSpace"] = "normal"
            if cell.number_format and cell.number_format != "General":
                cell_style["numberFormat"] = cell.number_format
            if cell_style:
                styles[f"{cell.row - 1}:{cell.column - 1}"] = cell_style
    return {
        "type": "sheet_v1",
        "data": rows or [[""]],
        "sheetName": sheet.title,
        "styles": styles,
        "dimensions": {"columnWidths": column_widths, "rowHeights": row_heights},
    }


def _csv_to_native(data: bytes) -> dict[str, Any]:
    raw = data.decode("utf-8-sig", errors="replace")
    sample = raw[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows: list[list[str]] = []
    for row_index, row in enumerate(csv.reader(io.StringIO(raw), dialect)):
        if row_index >= 1000:
            break
        values = [str(value) for value in row[:100]]
        while values and values[-1] == "":
            values.pop()
        rows.append(values)
    while rows and not rows[-1]:
        rows.pop()
    return {"type": "sheet_v1", "data": rows or [[""]], "sheetName": "CSV"}


def import_document(filename: str, data: bytes, mime_type: str = "", file_id: str | None = None) -> ImportedDocument:
    extension = normalized_extension(filename)
    if extension not in SUPPORTED_IMPORT_EXTENSIONS:
        raise ValueError(f"Formato .{extension or '?'} non supportato")
    working = data
    modern_extension = extension
    if extension in {"doc", "ppt", "xls"}:
        modern_extension = {"doc": "docx", "ppt": "pptx", "xls": "xlsx"}[extension]
        working = _run_libreoffice(data, extension, modern_extension)
    source = _source_metadata(filename, mime_type, file_id)
    if modern_extension == "pptx":
        content = pptx_to_native(working, _web_image, _run_libreoffice)
        doc_type = "presentation"
    elif modern_extension == "xlsx":
        content = _xlsx_to_native(working)
        doc_type = "sheet"
    elif extension == "csv":
        content = _csv_to_native(data)
        doc_type = "sheet"
    elif modern_extension == "docx":
        content = {"type": "document_v1", "htmlContent": _docx_to_html(working)}
        margins = _docx_margins_px(working)
        if margins:
            content["margins"] = margins
        page = _docx_page_setup(working)
        if page:
            content["page"] = page
        doc_type = "document"
    elif extension == "md":
        content = {"type": "document_v1", "htmlContent": _markdown_to_html(data.decode("utf-8", errors="replace"))}
        doc_type = "document"
    else:
        content = {
            "type": "document_v1",
            "htmlContent": _pdf_to_html(data),
            "previewImage": _pdf_first_page_preview(data),
        }
        doc_type = "document"
    content["source"] = source
    content["imported"] = True
    return ImportedDocument(_safe_title(filename), doc_type, json.dumps(content, ensure_ascii=False), extension)


def _native_to_docx(content: dict[str, Any], title: str) -> bytes:
    is_presentation = content.get("type") == "presentation_v2" or isinstance(content.get("slides"), list)
    is_sheet = content.get("type") == "sheet_v1" or isinstance(content.get("data"), list)
    if not is_presentation and not is_sheet:
        return html_to_docx(
            str(content.get("htmlContent") or content.get("content") or ""),
            title=title,
            margins_px=content.get("margins") if isinstance(content.get("margins"), dict) else None,
            header=content.get("header") if isinstance(content.get("header"), dict) else None,
            page=content.get("page") if isinstance(content.get("page"), dict) else None,
            header_footer=content.get("headerFooter") if isinstance(content.get("headerFooter"), dict) else None,
            page_breaks=content.get("pageBreaks") if isinstance(content.get("pageBreaks"), list) else None,
        )
    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.65)
    section.bottom_margin = Inches(0.65)
    document.add_heading(title, level=0)
    if content.get("type") == "presentation_v2" or isinstance(content.get("slides"), list):
        for index, slide in enumerate(content.get("slides") or []):
            document.add_heading(slide.get("title") or f"Slide {index + 1}", level=1)
            for block in sorted(slide.get("blocks") or [], key=lambda item: (item.get("y", 0), item.get("x", 0))):
                if block.get("type") == "text" and block.get("content"):
                    document.add_paragraph(str(block["content"]))
                elif block.get("type") == "image" and str(block.get("content", "")).startswith("data:"):
                    match = re.match(r"data:([^;]+);base64,(.+)", block["content"], re.DOTALL)
                    if match:
                        try:
                            document.add_picture(io.BytesIO(base64.b64decode(match.group(2))), width=Inches(5.8))
                        except Exception:
                            pass
    elif content.get("type") == "sheet_v1" or isinstance(content.get("data"), list):
        rows = content.get("data") or []
        columns = max((len(row) for row in rows), default=1)
        table = document.add_table(rows=max(1, len(rows)), cols=max(1, columns))
        table.style = "Table Grid"
        for row_index, row in enumerate(rows):
            for column_index, value in enumerate(row):
                table.cell(row_index, column_index).text = str(value)
    output = io.BytesIO()
    document.save(output)
    return output.getvalue()


def _pptx_rgb(value: Any, fallback: str = "000000") -> PptxRGBColor:
    raw = pptx_rich._hex(str(value or "")) or str(value or "").strip().lstrip("#")
    if len(raw) == 3 and re.fullmatch(r"[0-9a-fA-F]{3}", raw):
        raw = "".join(character * 2 for character in raw)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", raw):
        raw = fallback
    return PptxRGBColor.from_string(raw.upper())


def _is_transparent(value: Any) -> bool:
    return not value or str(value).strip().lower() in {"transparent", "none"}


def _pptx_box(block: dict[str, Any], canvas_width: float, canvas_height: float) -> tuple[float, float, float, float]:
    x = max(0.0, min(canvas_width, float(block.get("x", 0) or 0)))
    y = max(0.0, min(canvas_height, float(block.get("y", 0) or 0)))
    minimum = 0.0 if block.get("type") == "line" else 1.0
    width = max(minimum, float(block.get("width", minimum) or minimum))
    height = max(minimum, float(block.get("height", minimum) or minimum))
    return x, y, min(width, max(minimum, canvas_width - x)), min(height, max(minimum, canvas_height - y))


def _set_shape_rotation(shape: Any, block: dict[str, Any]) -> None:
    try:
        shape.rotation = float(block.get("rotation") or 0) % 360
    except (TypeError, ValueError):
        shape.rotation = 0


def _configure_text_frame(frame: Any, style: dict[str, Any], scale_x: float, scale_y: float) -> None:
    frame.word_wrap = style.get("whiteSpace") != "nowrap"
    frame.auto_size = MSO_AUTO_SIZE.NONE
    frame.vertical_anchor = {"middle": MSO_VERTICAL_ANCHOR.MIDDLE, "bottom": MSO_VERTICAL_ANCHOR.BOTTOM}.get(str(style.get("verticalAlign")), MSO_VERTICAL_ANCHOR.TOP)
    padding = max(0.0, float(style.get("padding") or 0))
    side = lambda name: max(0.0, float(style.get(name, padding) or 0))
    frame.margin_left, frame.margin_right = PptxInches(side("paddingLeft") * scale_x), PptxInches(side("paddingRight") * scale_x)
    frame.margin_top, frame.margin_bottom = PptxInches(side("paddingTop") * scale_y), PptxInches(side("paddingBottom") * scale_y)


def _add_table_to_slide(slide: Any, content: str, x: float, y: float, width: float, height: float, style: dict[str, Any], scale_x: float) -> None:
    """Imported tables are HTML tables inside a text block; on export they become real tables."""
    soup = BeautifulSoup(content, "html.parser")
    rows = soup.find_all("tr")
    columns = soup.find("colgroup").find_all("col") if soup.find("colgroup") else []
    column_count = max(len(columns), max((sum(int(c.get("colspan") or 1) for c in row.find_all(["td", "th"], recursive=False)) for row in rows), default=1))
    table = slide.shapes.add_table(len(rows) or 1, column_count, PptxInches(x), PptxInches(y), PptxInches(width), PptxInches(height)).table
    table._tbl.tblPr.remove(table._tbl.tblPr.find(qn_pptx("a:tableStyleId")))
    table._tbl.tblPr.attrib.clear()
    widths = [pptx_rich._px(pptx_rich._css(col).get("width")) or 0 for col in columns]
    total = sum(widths)
    if total:
        for index, column_width in enumerate(widths[:column_count]):
            table.columns[index].width = PptxInches(width * column_width / total)
    occupied: set[tuple[int, int]] = set()
    for row_index, row in enumerate(rows):
        row_px = pptx_rich._px(pptx_rich._css(row).get("height"))
        if row_px:
            table.rows[row_index].height = PptxInches(row_px * scale_x)
        column_index = 0
        for source in row.find_all(["td", "th"], recursive=False):
            while (row_index, column_index) in occupied:
                column_index += 1
            if column_index >= column_count:
                break
            cell = table.cell(row_index, column_index)
            span_x, span_y = int(source.get("colspan") or 1), int(source.get("rowspan") or 1)
            if span_x > 1 or span_y > 1:
                cell.merge(table.cell(min(len(rows) - 1, row_index + span_y - 1), min(column_count - 1, column_index + span_x - 1)))
            occupied.update((row_index + r, column_index + c) for r in range(span_y) for c in range(span_x))
            css = pptx_rich._css(source)
            if css.get("background-color"):
                cell.fill.solid()
                cell.fill.fore_color.rgb = _pptx_rgb(css["background-color"], "FFFFFF")
            cell.vertical_anchor = {"middle": MSO_VERTICAL_ANCHOR.MIDDLE, "bottom": MSO_VERTICAL_ANCHOR.BOTTOM}.get(css.get("vertical-align", ""), MSO_VERTICAL_ANCHOR.TOP)
            cell_style = {
                **style,
                "color": css.get("color") or style.get("color"), "fontSize": pptx_rich._px(css.get("font-size")) or style.get("fontSize"),
                "fontFamily": css.get("font-family") or style.get("fontFamily"), "textAlign": css.get("text-align") or style.get("textAlign"),
                "fontWeight": css.get("font-weight") or style.get("fontWeight"),
            }
            pptx_rich.fill_text_frame(cell.text_frame, source.decode_contents(), cell_style, px_to_pt=scale_x * 72)
            column_index += span_x


def _add_text_to_slide(
    slide: Any,
    text: str,
    x: float,
    y: float,
    width: float,
    height: float,
    style: dict[str, Any],
    scale_x: float,
    scale_y: float,
    rotation: float = 0,
) -> None:
    if "<table" in text:
        _add_table_to_slide(slide, text, x, y, width, height, style, scale_x)
        return
    radius = float(style.get("borderRadius") or 0)
    if radius > 0 and not _is_transparent(style.get("backgroundColor")):
        box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, PptxInches(x), PptxInches(y), PptxInches(width), PptxInches(height))
        box.adjustments[0] = min(0.5, radius * scale_x / max(0.01, min(width, height)))
    else:
        box = slide.shapes.add_textbox(PptxInches(x), PptxInches(y), PptxInches(width), PptxInches(height))
    frame = box.text_frame
    _configure_text_frame(frame, style, scale_x, scale_y)
    # Canvas pixels → points so text keeps its size relative to the slide (canvas width = slide width).
    pptx_rich.fill_text_frame(frame, text, style, px_to_pt=scale_x * 72)
    background = style.get("backgroundColor")
    if not _is_transparent(background):
        box.fill.solid()
        box.fill.fore_color.rgb = _pptx_rgb(background, "FFFFFF")
    else:
        box.fill.background()
    box.line.fill.background()
    box.rotation = rotation % 360


def _cover_image_bytes(data: bytes, width: float, height: float) -> bytes:
    with Image.open(io.BytesIO(data)) as source:
        target_width = max(1, min(3840, round(width * 2)))
        target_height = max(1, min(2160, round(height * 2)))
        image = ImageOps.fit(source.convert("RGBA"), (target_width, target_height), method=Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()


def _slide_image_bytes(data: bytes, width: float, height: float, style: dict) -> bytes:
    """Match object-cover and the CSS corner mask, including transparent icon assets."""
    raw = _cover_image_bytes(data, width, height)
    radius = max(0, float(style.get("borderRadius") or 0))
    if radius:
        from PIL import ImageDraw
        with Image.open(io.BytesIO(raw)) as image:
            mask = Image.new("L", image.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width - 1, image.height - 1),
                                                   radius=radius * image.width / max(1, width), fill=255)
            from PIL import ImageChops
            image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
            output = io.BytesIO()
            image.save(output, format="PNG")
            return output.getvalue()
    return raw


def _add_shape_to_slide(
    slide: Any,
    block: dict[str, Any],
    x: float,
    y: float,
    width: float,
    height: float,
    scale_x: float,
) -> None:
    style = block.get("style") or {}
    if block.get("type") == "line":
        shape = slide.shapes.add_connector(
            MSO_CONNECTOR.STRAIGHT,
            PptxInches(x),
            PptxInches(y),
            PptxInches(x + width),
            PptxInches(y + height),
        )
    else:
        shape_type = MSO_SHAPE.OVAL if block.get("type") == "ellipse" else (
            MSO_SHAPE.ROUNDED_RECTANGLE if float(style.get("cornerRadius") or 0) > 0 else MSO_SHAPE.RECTANGLE
        )
        shape = slide.shapes.add_shape(
            shape_type,
            PptxInches(x),
            PptxInches(y),
            PptxInches(width),
            PptxInches(height),
        )
        if shape_type == MSO_SHAPE.ROUNDED_RECTANGLE:
            shape.adjustments[0] = min(0.5, float(style.get("cornerRadius") or 0) * scale_x / max(0.01, min(width, height)))
        fill = style.get("fill")
        if _is_transparent(fill):
            shape.fill.background()
        else:
            shape.fill.solid()
            shape.fill.fore_color.rgb = _pptx_rgb(fill, "E2E8F0")
    stroke = style.get("stroke")
    if _is_transparent(stroke):
        shape.line.fill.background()
    else:
        shape.line.color.rgb = _pptx_rgb(stroke, "1E293B")
        stroke_width = float(style.get("strokeWidth", 1))
        if stroke_width <= 0:
            shape.line.fill.background()
        else:
            shape.line.width = PptxPt(max(0.25, stroke_width * scale_x * 72))
    _set_shape_rotation(shape, block)


def _native_to_pptx(content: dict[str, Any], title: str) -> bytes:
    presentation = Presentation()
    format_name = content.get("format")
    canvas_width, canvas_height = (800.0, 600.0) if format_name == "4:3" else (960.0, 540.0)
    presentation.slide_width = PptxInches(10 if format_name == "4:3" else 13.333)
    presentation.slide_height = PptxInches(7.5)
    slide_width_inches = float(presentation.slide_width) / 914400
    slide_height_inches = float(presentation.slide_height) / 914400
    scale_x = slide_width_inches / canvas_width
    scale_y = slide_height_inches / canvas_height
    presentation.slides._sldIdLst.clear()
    native_slides = content.get("slides") if isinstance(content.get("slides"), list) else None
    if native_slides is None:
        if content.get("type") == "sheet_v1":
            lines = ["\t".join(str(value) for value in row) for row in (content.get("data") or [])]
        else:
            soup = BeautifulSoup(str(content.get("htmlContent") or content.get("content") or ""), "html.parser")
            lines = [node.get_text(" ", strip=True) for node in soup.find_all(["h1", "h2", "h3", "p", "li"]) if node.get_text(" ", strip=True)]
        chunks = [lines[index:index + 8] for index in range(0, len(lines), 8)] or [[title]]
        native_slides = [{"title": title if index == 0 else f"{title} · {index + 1}", "blocks": [{"type": "text", "content": "\n".join(chunk), "x": 70, "y": 100, "width": 820, "height": 360, "style": {"fontSize": 24}}]} for index, chunk in enumerate(chunks)]
    for index, native_slide in enumerate(native_slides):
        # "Title Only" layout: the slide title lives in a real title placeholder (outline view,
        # accessibility, re-import) when a text block carries it; otherwise the placeholder is dropped.
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        slide_title = str(native_slide.get("title") or "").strip()
        title_block_id = None
        for candidate in native_slide.get("blocks") or []:
            if candidate.get("type") != "text" or candidate.get("hidden"):
                continue
            first_line = BeautifulSoup(str(candidate.get("content") or ""), "html.parser").get_text("\n").strip().split("\n")[0].strip()
            if slide_title and first_line == slide_title:
                title_block_id = candidate.get("id") or id(candidate)
                break
        title_placeholder = slide.shapes.title
        if title_placeholder is not None and title_block_id is None:
            title_placeholder._element.getparent().remove(title_placeholder._element)
            title_placeholder = None
        background = native_slide.get("backgroundColor")
        if not _is_transparent(background):
            slide.background.fill.solid()
            slide.background.fill.fore_color.rgb = _pptx_rgb(background, "FFFFFF")
        blocks = [b for _, b in sorted(enumerate(native_slide.get("blocks") or []),
                  key=lambda item: float(item[1].get("zIndex") if item[1].get("zIndex") is not None else item[0]))
                  if not b.get("hidden")]
        for block in blocks:
            block_x, block_y, block_width, block_height = _pptx_box(block, canvas_width, canvas_height)
            x, y = block_x * scale_x, block_y * scale_y
            width, height = block_width * scale_x, block_height * scale_y
            if block.get("type") == "text" and title_placeholder is not None and (block.get("id") or id(block)) == title_block_id:
                title_placeholder.left, title_placeholder.top = PptxInches(x), PptxInches(y)
                title_placeholder.width, title_placeholder.height = PptxInches(width), PptxInches(height)
                frame = title_placeholder.text_frame
                style = block.get("style") or {}
                _configure_text_frame(frame, style, scale_x, scale_y)
                pptx_rich.fill_text_frame(frame, str(block.get("content") or ""), style, px_to_pt=scale_x * 72)
                _set_shape_rotation(title_placeholder, block)
                title_placeholder.fill.background()
                if not _is_transparent(style.get("backgroundColor")):
                    title_placeholder.fill.solid()
                    title_placeholder.fill.fore_color.rgb = _pptx_rgb(style["backgroundColor"], "FFFFFF")
                title_placeholder.line.fill.background()
                # A layout placeholder starts below all added shapes. Reinsert it at its actual
                # paint position, otherwise the slide background covers the title in Google Slides.
                element = title_placeholder._element
                element.getparent().remove(element)
                slide.shapes._spTree.insert_element_before(element, "p:extLst")
            elif block.get("type") == "text":
                _add_text_to_slide(
                    slide,
                    str(block.get("content") or ""),
                    x, y, width, height,
                    block.get("style") or {},
                    scale_x, scale_y,
                    float(block.get("rotation") or 0),
                )
            elif block.get("type") == "image":
                match = re.match(r"data:([^;]+);base64,(.+)", str(block.get("content") or ""), re.DOTALL)
                if match:
                    raw = base64.b64decode(match.group(2))
                    try:
                        image = _slide_image_bytes(raw, block_width, block_height, block.get("style") or {})
                    except Exception:
                        image = raw  # undecodable by Pillow: let PowerPoint render the original bytes
                    try:
                        picture = slide.shapes.add_picture(io.BytesIO(image), PptxInches(x), PptxInches(y), PptxInches(width), PptxInches(height))
                        _set_shape_rotation(picture, block)
                    except Exception:
                        pass
            elif block.get("type") in {"rectangle", "ellipse", "line"}:
                _add_shape_to_slide(slide, block, x, y, width, height, scale_x)
        # Match the presenter's fallback title for otherwise empty / shape-only slides.
        if not any(b.get("type") in {"text", "image"} for b in native_slide.get("blocks") or []):
            _add_text_to_slide(slide, slide_title or title, 32 * scale_x, 32 * scale_y,
                               (canvas_width - 64) * scale_x, 80 * scale_y,
                               {"fontSize": 36, "fontWeight": "bold", "color": "#0f172a"}, scale_x, scale_y)
        pptx_rich.write_notes(slide, str(native_slide.get("speakerNotes") or native_slide.get("notes") or ""))
    output = io.BytesIO()
    presentation.save(output)
    return output.getvalue()


def _native_to_xlsx(content: dict[str, Any], title: str) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = re.sub(r"[\\/*?:\[\]]", "_", title)[:31] or "Foglio"
    rows = content.get("data") if isinstance(content.get("data"), list) else []
    def excel_value(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if stripped.upper() == "TRUE":
            return True
        if stripped.upper() == "FALSE":
            return False
        if re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?", stripped, re.IGNORECASE) and not re.match(r"[-+]?0\d+", stripped):
            number = float(stripped)
            return int(number) if number.is_integer() else number
        return value

    for row in rows:
        sheet.append([excel_value(value) for value in row])

    dimensions = content.get("dimensions") if isinstance(content.get("dimensions"), dict) else {}
    for index, width in enumerate(dimensions.get("columnWidths") or [], 1):
        if isinstance(width, (int, float)):
            sheet.column_dimensions[get_column_letter(index)].width = max(1, float(width) / 7)
    for index, height in enumerate(dimensions.get("rowHeights") or [], 1):
        if isinstance(height, (int, float)):
            sheet.row_dimensions[index].height = max(1, float(height) * 3 / 4)

    styles = content.get("styles") if isinstance(content.get("styles"), dict) else {}
    for key, cell_style in styles.items():
        if not isinstance(cell_style, dict) or not re.fullmatch(r"\d+:\d+", str(key)):
            continue
        row_index, column_index = (int(part) + 1 for part in str(key).split(":"))
        cell = sheet.cell(row=row_index, column=column_index)
        cell.font = Font(
            name=cell_style.get("fontFamily") or cell.font.name,
            size=cell_style.get("fontSize") or cell.font.sz,
            bold=cell_style.get("fontWeight") == "bold",
            italic=cell_style.get("fontStyle") == "italic",
            underline="single" if cell_style.get("textDecoration") == "underline" else None,
            color=(pptx_rich._hex(str(cell_style.get("color") or "")) or None),
        )
        fill = pptx_rich._hex(str(cell_style.get("backgroundColor") or ""))
        if fill:
            cell.fill = PatternFill(fill_type="solid", start_color=fill, end_color=fill)
        alignment = cell_style.get("textAlign")
        wrap = cell_style.get("whiteSpace") == "normal"
        if alignment in {"left", "center", "right"} or wrap:
            cell.alignment = Alignment(horizontal=alignment if alignment in {"left", "center", "right"} else None, wrap_text=wrap or None)
        if cell_style.get("numberFormat"):
            cell.number_format = str(cell_style["numberFormat"])
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def export_document(content_json: str, title: str, target_format: str) -> ExportedDocument:
    target = target_format.lower().lstrip(".")
    if target not in SUPPORTED_EXPORT_FORMATS:
        raise ValueError(f"Formato di esportazione .{target} non supportato")
    try:
        content = json.loads(content_json)
    except (TypeError, ValueError) as exc:
        raise ValueError("Contenuto documento non valido") from exc
    safe_name = re.sub(r"[^\w\-. ]+", "_", title, flags=re.UNICODE).strip(" .") or "Documento"
    if target == "xlsx":
        data = _native_to_xlsx(content, title)
    elif target in {"ppt", "pptx"}:
        pptx = _native_to_pptx(content, title)
        data = pptx if target == "pptx" else _run_libreoffice(pptx, "pptx", "ppt")
    elif target in {"doc", "docx"}:
        docx = _native_to_docx(content, title)
        data = docx if target == "docx" else _run_libreoffice(docx, "docx", "doc")
    else:
        web_html = str(content.get("htmlContent") or content.get("html") or content.get("content") or "")
        if content.get("type") == "html_v1" or re.match(r"\s*(?:<!doctype\s+html|<html)", web_html, re.I):
            from app.services.html_pdf import html_to_pdf
            viewport = content.get("viewport") if isinstance(content.get("viewport"), dict) else {}
            data = html_to_pdf(web_html, viewport.get("width", 880), viewport.get("height", 900))
        elif content.get("type") == "presentation_v2" or isinstance(content.get("slides"), list):
            native = _native_to_pptx(content, title)
            data = _run_libreoffice(native, "pptx", "pdf")
        elif content.get("type") == "sheet_v1" or isinstance(content.get("data"), list):
            native = _native_to_xlsx(content, title)
            data = _run_libreoffice(native, "xlsx", "pdf")
        else:
            native = _native_to_docx(content, title)
            data = _run_libreoffice(native, "docx", "pdf")
    mime_type = MIME_BY_EXTENSION.get(target) or mimetypes.guess_type(f"file.{target}")[0] or "application/octet-stream"
    return ExportedDocument(f"{safe_name}.{target}", mime_type, data)
