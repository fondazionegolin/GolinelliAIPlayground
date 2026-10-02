"""Interop checks against a second office suite (LibreOffice, already used for legacy formats).

python-docx/python-pptx can write files that they themselves re-read but that other suites reject;
rendering exports through LibreOffice proves they open elsewhere, and LibreOffice-authored files
exercise the importers with XML shapes python-docx never produces (its own numbering, table props).
"""

import json

import fitz
from bs4 import BeautifulSoup

from app.services.document_conversion import _run_libreoffice, export_document, import_document


def _pdf_text(pdf: bytes) -> str:
    with fitz.open(stream=pdf, filetype="pdf") as document:
        return " ".join(page.get_text() for page in document)


def test_exported_docx_renders_in_libreoffice():
    html = (
        "<h1>Relazione</h1><p><strong>Grassetto</strong> e <a href='https://example.org'>link</a></p>"
        "<ol><li><p>Uno</p><ul><li><p>Sotto</p></li></ul></li></ol>"
        "<table><tbody><tr><th colspan='2'>Tabella</th></tr><tr><td rowspan='1'>a</td><td>b</td></tr></tbody></table>"
        "<p><span data-docx-comment='true' data-comment-id='1' data-comment-author='Ada' data-comment-text='Nota'>commento</span></p>"
    )
    docx = export_document(json.dumps({"type": "document_v1", "htmlContent": html}), "Relazione", "docx").content
    text = _pdf_text(_run_libreoffice(docx, "docx", "pdf"))
    for expected in ("Relazione", "Grassetto", "link", "Uno", "Sotto", "Tabella", "commento"):
        assert expected in text


def test_exported_pptx_renders_in_libreoffice():
    native = {
        "type": "presentation_v2", "format": "16:9",
        "slides": [{
            "id": "s1", "title": "Ciclo dell'acqua", "notes": "Parlare dell'evaporazione",
            "blocks": [
                {"id": "t", "type": "text", "content": "<p><strong>Ciclo dell'acqua</strong></p>",
                 "x": 60, "y": 40, "width": 840, "height": 80, "style": {"fontSize": 40}},
                {"id": "b", "type": "text", "content": "<ul><li><p>Evaporazione</p><ul><li><p>Sole</p></li></ul></li><li><p>Pioggia</p></li></ul>",
                 "x": 60, "y": 140, "width": 600, "height": 300, "style": {"fontSize": 24}},
                {"id": "r", "type": "rectangle", "content": "", "x": 700, "y": 160, "width": 180, "height": 120,
                 "style": {"fill": "#abcdef", "stroke": "#102030"}},
            ],
        }],
    }
    pptx = export_document(json.dumps(native), "Acqua", "pptx").content
    text = _pdf_text(_run_libreoffice(pptx, "pptx", "pdf"))
    for expected in ("Ciclo dell", "Evaporazione", "Sole", "Pioggia"):
        assert expected in text


def test_libreoffice_authored_docx_imports_lists_and_tables():
    source = (
        "<html><body><h2>Programma</h2>"
        "<ol><li>Introduzione</li><li>Esperimento<ul><li>Materiali</li></ul></li></ol>"
        "<table border='1'><tr><th>Ora</th><th>Attività</th></tr><tr><td>9:00</td><td>Laboratorio</td></tr></table>"
        "</body></html>"
    ).encode("utf-8")
    # Open as a Writer document (not Writer/Web, which has no DOCX export filter).
    docx = _run_libreoffice(source, "html", "docx", input_filter="HTML (StarWriter)")
    content = json.loads(import_document("programma.docx", docx).content_json)
    soup = BeautifulSoup(content["htmlContent"], "html.parser")
    assert soup.find(["h1", "h2"], string=lambda s: s and "Programma" in s)
    ordered = soup.find("ol")
    assert ordered is not None and "Introduzione" in ordered.get_text()
    assert "Materiali" in soup.get_text()
    cells = [cell.get_text(strip=True) for cell in soup.find_all(["th", "td"])]
    assert {"Ora", "Attività", "9:00", "Laboratorio"} <= set(cells)
