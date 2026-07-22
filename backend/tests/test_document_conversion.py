import io
import json

import fitz
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches

from app.services.document_conversion import _run_libreoffice, export_document, import_document


def _docx_bytes() -> bytes:
    document = Document()
    document.add_heading("Titolo DOCX", 1)
    document.add_paragraph("Testo modificabile")
    output = io.BytesIO()
    document.save(output)
    return output.getvalue()


def _pptx_bytes() -> bytes:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1))
    box.text = "Prima slide"
    output = io.BytesIO()
    presentation.save(output)
    return output.getvalue()


def _xlsx_bytes() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Nome", "Valore"])
    sheet.append(["A", 42])
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def _pdf_bytes() -> bytes:
    pdf = fitz.open()
    page = pdf.new_page()
    page.insert_text((72, 72), "Prima pagina PDF")
    output = pdf.tobytes()
    pdf.close()
    return output


def test_imports_supported_editable_formats_and_preserves_source_metadata():
    samples = {
        "lezione.docx": (_docx_bytes(), "document"),
        "lezione.pptx": (_pptx_bytes(), "presentation"),
        "dati.xlsx": (_xlsx_bytes(), "sheet"),
        "dispensa.pdf": (_pdf_bytes(), "document"),
        "note.md": (b"# Titolo MD\n\nTesto **forte**", "document"),
    }
    for filename, (payload, expected_type) in samples.items():
        imported = import_document(filename, payload, file_id="00000000-0000-0000-0000-000000000001")
        content = json.loads(imported.content_json)
        assert imported.doc_type == expected_type
        assert content["source"]["preservedOriginal"] is True
        assert content["source"]["extension"] == filename.rsplit(".", 1)[1]
    pdf_content = json.loads(import_document("dispensa.pdf", samples["dispensa.pdf"][0]).content_json)
    assert pdf_content["previewImage"].startswith("data:image/jpeg;base64,")


def test_native_exports_produce_valid_office_files():
    native = import_document("lezione.docx", _docx_bytes()).content_json
    docx = export_document(native, "Lezione", "docx")
    pptx = export_document(native, "Lezione", "pptx")
    assert Document(io.BytesIO(docx.content)).paragraphs
    assert Presentation(io.BytesIO(pptx.content)).slides


def test_pdf_export_uses_office_bridge():
    native = import_document("lezione.docx", _docx_bytes()).content_json
    exported = export_document(native, "Lezione", "pdf")
    assert exported.content.startswith(b"%PDF")


def test_legacy_office_formats_are_imported_as_editable_drafts():
    native_document = import_document("lezione.docx", _docx_bytes()).content_json
    legacy_doc = export_document(native_document, "Lezione", "doc").content
    legacy_ppt = export_document(native_document, "Lezione", "ppt").content
    legacy_xls = _run_libreoffice(_xlsx_bytes(), "xlsx", "xls")
    assert import_document("lezione.doc", legacy_doc).doc_type == "document"
    assert import_document("lezione.ppt", legacy_ppt).doc_type == "presentation"
    assert import_document("dati.xls", legacy_xls).doc_type == "sheet"
