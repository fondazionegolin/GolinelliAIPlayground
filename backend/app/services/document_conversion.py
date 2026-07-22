"""Import/export bridge between LMS files and the native document editors.

The original upload is always kept separately in object storage.  This module only
creates an editable representation or a newly exported copy, so conversions are
non-destructive by design.
"""

from __future__ import annotations

import base64
import csv
import html
import io
import json
import mimetypes
import re
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz
from bs4 import BeautifulSoup
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt
from openpyxl import Workbook, load_workbook
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches as PptxInches, Pt as PptxPt


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


def _run_libreoffice(input_bytes: bytes, source_ext: str, target_ext: str) -> bytes:
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
            "--convert-to",
            target_ext,
            "--outdir",
            str(root),
            str(source),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=90, check=False)
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


def _docx_to_html(data: bytes) -> str:
    document = Document(io.BytesIO(data))
    output: list[str] = []
    for paragraph in document.paragraphs:
        text = html.escape(paragraph.text)
        style = (paragraph.style.name if paragraph.style else "").lower()
        heading = re.search(r"heading\s*(\d+)", style)
        if heading:
            level = min(6, max(1, int(heading.group(1))))
            output.append(f"<h{level}>{text}</h{level}>")
        elif "list" in style:
            output.append(f"<ul><li>{text}</li></ul>")
        else:
            output.append(f"<p>{text or '<br>'}</p>")
    for table in document.tables:
        rows = []
        for row_index, row in enumerate(table.rows):
            tag = "th" if row_index == 0 else "td"
            cells = "".join(f"<{tag}>{html.escape(cell.text)}</{tag}>" for cell in row.cells)
            rows.append(f"<tr>{cells}</tr>")
        output.append(f"<table><tbody>{''.join(rows)}</tbody></table>")
    for relationship in document.part.rels.values():
        if "image" not in relationship.reltype:
            continue
        part = relationship.target_part
        encoded = base64.b64encode(part.blob).decode("ascii")
        content_type = getattr(part, "content_type", "image/png")
        output.append(f'<p><img src="data:{content_type};base64,{encoded}" alt="Immagine importata"></p>')
    return "\n".join(output) or "<p></p>"


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


def _pptx_to_native(data: bytes) -> dict[str, Any]:
    presentation = Presentation(io.BytesIO(data))
    width = int(presentation.slide_width or 1)
    height = int(presentation.slide_height or 1)
    format_name = "4:3" if abs((width / height) - (4 / 3)) < 0.08 else "16:9"
    target_width, target_height = ((800, 600) if format_name == "4:3" else (960, 540))
    slides: list[dict[str, Any]] = []
    for slide_index, slide in enumerate(presentation.slides):
        blocks: list[dict[str, Any]] = []
        title = f"Slide {slide_index + 1}"
        for shape in slide.shapes:
            x = round(shape.left / width * target_width, 2)
            y = round(shape.top / height * target_height, 2)
            block_width = max(8, round(shape.width / width * target_width, 2))
            block_height = max(8, round(shape.height / height * target_height, 2))
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                image = shape.image
                encoded = base64.b64encode(image.blob).decode("ascii")
                blocks.append({
                    "id": str(uuid.uuid4()), "type": "image", "content": f"data:{image.content_type};base64,{encoded}",
                    "x": x, "y": y, "width": block_width, "height": block_height, "style": {},
                })
                continue
            if not getattr(shape, "has_text_frame", False) or not shape.text.strip():
                continue
            text = shape.text.strip()
            if getattr(slide.shapes, "title", None) is shape:
                title = text.splitlines()[0][:200]
            paragraph = shape.text_frame.paragraphs[0] if shape.text_frame.paragraphs else None
            run = paragraph.runs[0] if paragraph and paragraph.runs else None
            font_size = round((run.font.size.pt if run and run.font.size else (30 if y < 120 else 18)) * target_width / 960, 1)
            color = "#1e293b"
            try:
                if run and run.font.color and run.font.color.type and run.font.color.rgb:
                    color = f"#{run.font.color.rgb}"
            except AttributeError:
                pass
            alignment = "left"
            if paragraph and paragraph.alignment == PP_ALIGN.CENTER:
                alignment = "center"
            elif paragraph and paragraph.alignment == PP_ALIGN.RIGHT:
                alignment = "right"
            blocks.append({
                "id": str(uuid.uuid4()), "type": "text", "content": text,
                "x": x, "y": y, "width": block_width, "height": block_height,
                "style": {"fontSize": font_size, "color": color, "fontWeight": "bold" if run and run.font.bold else "normal", "textAlign": alignment, "lineHeight": 1.2},
            })
        slides.append({"id": str(uuid.uuid4()), "title": title, "blocks": blocks})
    return {"type": "presentation_v2", "format": format_name, "slides": slides or [{"id": str(uuid.uuid4()), "title": "Slide 1", "blocks": []}]}


def _xlsx_to_native(data: bytes) -> dict[str, Any]:
    workbook = load_workbook(io.BytesIO(data), data_only=False, read_only=True)
    sheet = workbook.active
    rows: list[list[str]] = []
    for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
        if row_index >= 1000:
            break
        values = ["" if value is None else str(value) for value in row[:100]]
        while values and values[-1] == "":
            values.pop()
        rows.append(values)
    while rows and not rows[-1]:
        rows.pop()
    return {"type": "sheet_v1", "data": rows or [[""]], "sheetName": sheet.title}


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
        content = _pptx_to_native(working)
        doc_type = "presentation"
    elif modern_extension == "xlsx":
        content = _xlsx_to_native(working)
        doc_type = "sheet"
    elif extension == "csv":
        content = _csv_to_native(data)
        doc_type = "sheet"
    elif modern_extension == "docx":
        content = {"type": "document_v1", "htmlContent": _docx_to_html(working)}
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


def _append_html_to_docx(document: Document, raw_html: str) -> None:
    soup = BeautifulSoup(raw_html or "<p></p>", "html.parser")
    for node in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "table", "img"]):
        if node.find_parent(["p", "li", "table"]) and node.name != "img":
            continue
        if node.name.startswith("h"):
            document.add_heading(node.get_text(" ", strip=True), level=min(6, int(node.name[1])))
        elif node.name == "li":
            document.add_paragraph(node.get_text(" ", strip=True), style="List Bullet")
        elif node.name == "table":
            rows = node.find_all("tr")
            column_count = max((len(row.find_all(["th", "td"])) for row in rows), default=1)
            table = document.add_table(rows=max(1, len(rows)), cols=max(1, column_count))
            table.style = "Table Grid"
            for row_index, row in enumerate(rows):
                for column_index, cell in enumerate(row.find_all(["th", "td"])):
                    table.cell(row_index, column_index).text = cell.get_text(" ", strip=True)
        elif node.name == "img":
            source = str(node.get("src") or "")
            match = re.match(r"data:([^;]+);base64,(.+)", source, re.DOTALL)
            if match:
                try:
                    document.add_picture(io.BytesIO(base64.b64decode(match.group(2))), width=Inches(5.8))
                except Exception:
                    pass
        else:
            paragraph = document.add_paragraph(node.get_text(" ", strip=True))
            style = str(node.get("style") or "")
            if "text-align: center" in style:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER


def _native_to_docx(content: dict[str, Any], title: str) -> bytes:
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
    else:
        _append_html_to_docx(document, str(content.get("htmlContent") or content.get("content") or ""))
    output = io.BytesIO()
    document.save(output)
    return output.getvalue()


def _add_text_to_slide(slide: Any, text: str, x: float, y: float, width: float, height: float, style: dict[str, Any]) -> None:
    box = slide.shapes.add_textbox(PptxInches(x), PptxInches(y), PptxInches(width), PptxInches(height))
    frame = box.text_frame
    frame.clear()
    paragraph = frame.paragraphs[0]
    paragraph.text = text
    run = paragraph.runs[0]
    run.font.size = PptxPt(max(8, min(72, float(style.get("fontSize") or 18))))
    run.font.bold = str(style.get("fontWeight") or "").lower() in {"bold", "600", "700", "800", "900"}
    alignment = style.get("textAlign")
    paragraph.alignment = PP_ALIGN.CENTER if alignment == "center" else PP_ALIGN.RIGHT if alignment == "right" else PP_ALIGN.LEFT


def _native_to_pptx(content: dict[str, Any], title: str) -> bytes:
    presentation = Presentation()
    presentation.slide_width = PptxInches(13.333)
    presentation.slide_height = PptxInches(7.5)
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
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        blocks = native_slide.get("blocks") or []
        if not any(block.get("type") == "text" and block.get("y", 999) < 110 for block in blocks):
            _add_text_to_slide(slide, native_slide.get("title") or f"Slide {index + 1}", 0.65, 0.35, 12, 0.65, {"fontSize": 30, "fontWeight": "bold"})
        for block in blocks:
            x = float(block.get("x", 0)) / 72
            y = float(block.get("y", 0)) / 72
            width = max(0.1, float(block.get("width", 100)) / 72)
            height = max(0.1, float(block.get("height", 50)) / 72)
            if block.get("type") == "text":
                _add_text_to_slide(slide, str(block.get("content") or ""), x, y, width, height, block.get("style") or {})
            elif block.get("type") == "image":
                match = re.match(r"data:([^;]+);base64,(.+)", str(block.get("content") or ""), re.DOTALL)
                if match:
                    try:
                        slide.shapes.add_picture(io.BytesIO(base64.b64decode(match.group(2))), PptxInches(x), PptxInches(y), PptxInches(width), PptxInches(height))
                    except Exception:
                        pass
    output = io.BytesIO()
    presentation.save(output)
    return output.getvalue()


def _native_to_xlsx(content: dict[str, Any], title: str) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = re.sub(r"[\\/*?:\[\]]", "_", title)[:31] or "Foglio"
    rows = content.get("data") if isinstance(content.get("data"), list) else []
    for row in rows:
        sheet.append(list(row))
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
        if content.get("type") == "presentation_v2" or isinstance(content.get("slides"), list):
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
