"""Editor HTML → DOCX → editor HTML round trips.

Each test exports native editor content with export_document(), checks the resulting WordprocessingML
directly, then re-imports the file and checks the editor HTML again, so both directions stay symmetric.
"""

import base64
import io
import json

from bs4 import BeautifulSoup
from docx import Document
from docx.oxml.ns import qn
from PIL import Image

from app.services.document_conversion import export_document, import_document


def _png_data_uri(width: int = 40, height: int = 20) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (254, 0, 77)).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _export(html: str, **extra) -> bytes:
    content = {"type": "document_v1", "htmlContent": html, **extra}
    return export_document(json.dumps(content), "Prova", "docx").content


def _reimport(data: bytes) -> tuple[dict, BeautifulSoup]:
    imported = import_document("prova.docx", data)
    content = json.loads(imported.content_json)
    return content, BeautifulSoup(content["htmlContent"], "html.parser")


def test_inline_formatting_survives_round_trip():
    html = (
        "<p><strong>grassetto</strong> <em>corsivo</em> <u>sotto</u> <s>barrato</s> "
        "H<sub>2</sub>O x<sup>2</sup> "
        '<span style="color: rgb(254, 0, 77); font-family: Georgia; font-size: 20px">stile</span> '
        '<mark style="background-color:#ffff00">evidenza</mark> '
        '<mark style="background-color:#c7f9cc">tinta</mark></p>'
    )
    data = _export(html)
    document = Document(io.BytesIO(data))
    runs = {run.text: run for run in document.paragraphs[0].runs if run.text.strip()}
    assert runs["grassetto"].bold and runs["corsivo"].italic and runs["sotto"].underline
    assert runs["barrato"].font.strike
    assert runs["2"].font.subscript or any(r.font.superscript for r in runs.values())
    styled = runs["stile"]
    assert str(styled.font.color.rgb) == "FE004D"
    assert styled.font.name == "Georgia" and styled.font.size.pt == 15
    assert runs["evidenza"]._r.rPr.find(qn("w:highlight")).get(qn("w:val")) == "yellow"
    assert runs["tinta"]._r.rPr.find(qn("w:shd")).get(qn("w:fill")) == "C7F9CC"

    _, soup = _reimport(data)
    assert soup.find("strong", string="grassetto")
    assert soup.find("em", string="corsivo")
    assert soup.find("u", string="sotto")
    assert soup.find("s", string="barrato")
    assert soup.find("sub", string="2")
    assert soup.find("sup", string="2")
    styled_span = soup.find(string="stile").find_parent("span")
    style = styled_span.get("style", "").lower()
    assert "#fe004d" in style and "georgia" in style and "15pt" in style
    assert "#c7f9cc" in str(soup).lower()


def test_headings_alignment_links_and_no_forced_title():
    html = (
        "<h1>Capitolo</h1><h2>Sezione</h2>"
        '<p style="text-align: justify">Testo giustificato con '
        '<a href="https://golinelli.it">un link</a>.</p>'
        '<p style="text-align: center">Centrato</p>'
    )
    data = _export(html)
    document = Document(io.BytesIO(data))
    styles = [p.style.name for p in document.paragraphs if p.text]
    assert styles[:2] == ["Heading 1", "Heading 2"]
    assert all(p.text != "Prova" for p in document.paragraphs), "title must not be injected as a heading"
    assert document.core_properties.title == "Prova"
    body_xml = document.element.body.xml
    assert "w:hyperlink" in body_xml
    assert "data-href" not in body_xml

    _, soup = _reimport(data)
    assert soup.find("h1", string="Capitolo") and soup.find("h2", string="Sezione")
    link = soup.find("a")
    assert link and link["href"] == "https://golinelli.it" and "un link" in link.get_text()
    assert "text-align:justify" in soup.find(string=lambda s: s and "giustificato" in s).find_parent("p").get("style", "")
    assert "text-align:center" in soup.find(string="Centrato").find_parent("p").get("style", "")


def test_nested_and_numbered_lists_round_trip():
    html = (
        "<ol><li><p>Primo</p><ul><li><p>Sotto A</p></li><li><p>Sotto B</p></li></ul></li>"
        "<li><p>Secondo</p></li></ol>"
        "<p>Pausa</p>"
        "<ol><li><p>Ricomincia</p></li></ol>"
    )
    data = _export(html)
    document = Document(io.BytesIO(data))
    levels = {}
    for paragraph in document.paragraphs:
        num_pr = paragraph._p.pPr.find(qn("w:numPr")) if paragraph._p.pPr is not None else None
        if num_pr is not None:
            levels[paragraph.text] = (int(num_pr.find(qn("w:ilvl")).get(qn("w:val"))), num_pr.find(qn("w:numId")).get(qn("w:val")))
    assert levels["Primo"][0] == 0 and levels["Sotto A"][0] == 1
    assert levels["Primo"][1] != levels["Ricomincia"][1], "separate ordered lists must restart numbering"

    _, soup = _reimport(data)
    outer = soup.find("ol")
    assert outer is not None
    nested = outer.find("ul")
    assert nested is not None and "Sotto A" in nested.get_text() and "Sotto B" in nested.get_text()
    assert len(soup.find_all("ol")) == 2
    assert "Secondo" in outer.get_text()


def test_tables_with_header_merges_and_shading_round_trip():
    html = (
        "<table><tbody>"
        '<tr><th colspan="2" style="background-color:#fde68a">Intestazione</th><th>C</th></tr>'
        '<tr><td rowspan="2">Unita</td><td><p><strong>b1</strong></p></td><td>c1</td></tr>'
        "<tr><td>b2</td><td>c2</td></tr>"
        "</tbody></table>"
    )
    data = _export(html)
    document = Document(io.BytesIO(data))
    table = document.tables[0]
    assert len(table.rows) == 3 and len(table.columns) == 3
    assert table.cell(0, 0)._tc is table.cell(0, 1)._tc, "colspan must merge horizontally"
    assert table.cell(1, 0)._tc is table.cell(2, 0)._tc, "rowspan must merge vertically"
    assert table.rows[0]._tr.trPr.find(qn("w:tblHeader")) is not None

    _, soup = _reimport(data)
    header = soup.find("th")
    assert header and header.get("colspan") == "2" and "#fde68a" in header.get("style", "").lower()
    merged = soup.find(string="Unita").find_parent("td")
    assert merged.get("rowspan") == "2"
    assert soup.find("strong", string="b1")
    assert len(soup.find_all("tr")) == 3


def test_images_keep_their_size():
    data = _export(f'<p><img src="{_png_data_uri(400, 200)}" width="240"></p>')
    document = Document(io.BytesIO(data))
    shape = document.inline_shapes[0]
    assert abs(shape.width.inches - 2.5) < 0.02 and abs(shape.height.inches - 1.25) < 0.02

    _, soup = _reimport(data)
    image = soup.find("img")
    assert image and image["src"].startswith("data:image/")


def test_comments_revisions_and_regions_round_trip():
    html = (
        '<section data-docx-region="header" data-docx-region-label="Intestazione"><p>Scuola</p></section>'
        '<p>Frase <span data-docx-comment="true" data-comment-id="1" data-comment-author="Ada Lovelace" '
        'data-comment-text="Rivedere">commentata</span> e '
        '<span data-revision-kind="insert" data-revision-author="Ada">aggiunta</span>'
        '<span data-revision-kind="delete" data-revision-author="Ada">tolta</span>.</p>'
        '<section data-docx-region="footer" data-docx-region-label="Piè di pagina"><p>Pagina</p></section>'
    )
    data = _export(html)
    document = Document(io.BytesIO(data))
    assert document.sections[0].header.paragraphs[0].text == "Scuola"
    assert document.sections[0].footer.paragraphs[0].text == "Pagina"
    comments = list(document.comments)
    assert comments and comments[0].text == "Rivedere" and comments[0].author == "Ada Lovelace"
    body_xml = document.element.body.xml
    assert "<w:ins " in body_xml and "<w:del " in body_xml and "w:delText" in body_xml

    _, soup = _reimport(data)
    assert soup.find("section", attrs={"data-docx-region": "header"}).get_text(strip=True) == "Scuola"
    assert soup.find("section", attrs={"data-docx-region": "footer"}).get_text(strip=True) == "Pagina"
    comment = soup.find("span", attrs={"data-docx-comment": "true"})
    assert comment and comment.get("data-comment-text") == "Rivedere" and "commentata" in comment.get_text()
    assert soup.find("span", attrs={"data-revision-kind": "insert"}).get_text() == "aggiunta"
    assert soup.find("span", attrs={"data-revision-kind": "delete"}).get_text() == "tolta"


def test_margins_and_page_size_round_trip():
    data = _export("<p>Margini</p>", margins={"vertical": 96, "horizontal": 72})
    section = Document(io.BytesIO(data)).sections[0]
    assert abs(section.top_margin.inches - 1.0) < 0.01 and abs(section.left_margin.inches - 0.75) < 0.01
    assert abs(section.page_width.mm - 210) < 0.5 and abs(section.page_height.mm - 297) < 0.5

    content, _ = _reimport(data)
    assert content["margins"] == {"vertical": 96, "horizontal": 72}


def test_second_round_trip_is_stable():
    html = (
        "<h2>Titolo</h2><p><strong>A</strong> e <em>B</em></p>"
        "<ul><li><p>uno</p></li><li><p>due</p></li></ul>"
        "<table><tbody><tr><th>h</th></tr><tr><td>v</td></tr></tbody></table>"
    )
    first_content, first = _reimport(_export(html))
    second_content, second = _reimport(_export(first_content["htmlContent"], margins=first_content.get("margins")))
    normalize = lambda soup: [(tag.name, tag.get_text(" ", strip=True)) for tag in soup.find_all(["h2", "p", "li", "th", "td", "strong", "em"])]
    assert normalize(first) == normalize(second)
    assert len(second.find_all("p")) == len(first.find_all("p")), "no blank paragraphs may accumulate"


def test_page_size_and_orientation_round_trip():
    data = _export("<p>Orizzontale</p>", page={"size": "letter", "orientation": "landscape"})
    section = Document(io.BytesIO(data)).sections[0]
    assert abs(section.page_width.inches - 11) < 0.01 and abs(section.page_height.inches - 8.5) < 0.01
    content, _ = _reimport(data)
    assert content["page"] == {"size": "letter", "orientation": "landscape"}


def test_word_theme_fonts_sizes_and_non_web_images_import():
    from docx.oxml import OxmlElement
    from docx.shared import Inches as DocxInches, Pt as DocxPt

    document = Document()
    normal = document.styles["Normal"]
    normal.font.size = DocxPt(11)
    r_fonts = normal.element.get_or_add_rPr().find(qn("w:rFonts"))
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        normal.element.get_or_add_rPr().append(r_fonts)
    for attribute in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        r_fonts.attrib.pop(qn(attribute), None)
    r_fonts.set(qn("w:asciiTheme"), "minorHAnsi")
    r_fonts.set(qn("w:hAnsiTheme"), "minorHAnsi")
    paragraph = document.add_paragraph("Corpo del testo")
    tiff = io.BytesIO()
    Image.new("RGB", (30, 10), (0, 120, 200)).save(tiff, format="TIFF")
    paragraph.add_run().add_picture(io.BytesIO(tiff.getvalue()), width=DocxInches(1))
    buffer = io.BytesIO()
    document.save(buffer)

    _, soup = _reimport(buffer.getvalue())
    span = soup.find(string="Corpo del testo").find_parent("span")
    style = span.get("style", "")
    assert "font-size:11pt" in style
    theme_font = Document(io.BytesIO(buffer.getvalue())).part.part_related_by(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
    )
    assert theme_font is not None
    assert "font-family" in style, "theme body font (minorHAnsi) must resolve to its typeface"
    image = soup.find("img")
    assert image is not None and image["src"].startswith("data:image/png;base64,"), "TIFF must be converted for browsers"
