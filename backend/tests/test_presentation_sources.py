import asyncio
from io import BytesIO

import pytest
from app.services import presentation_sources as sources


@pytest.mark.parametrize('encoding', ['utf-8-sig', 'utf-16', 'cp1252'])
def test_import_markdown_preserves_structure_and_accents(encoding):
    text = '# Progetto XR\n\n## [SLIDE S01] Perché?\n- Qualità\n\n**Note docente:** già pronto.'
    assert asyncio.run(sources.extract_notes(text.encode(encoding), 'Appunti.MD')) == text


@pytest.mark.parametrize('data,filename,message', [
    (b'', 'note.md', 'non contiene'),
    (b'\x00\x01hello', 'note.txt', 'non sembra'),
    (b'hello', 'script.exe', 'Formato'),
    (b'x' * (sources.MAX_SOURCE_BYTES + 1), 'note.md', '10 MB'),
    (b'x' * (sources.MAX_SOURCE_CHARS + 1), 'note.md', 'caratteri'),
])
def test_reject_invalid_notes_without_truncation(data, filename, message):
    with pytest.raises(ValueError, match=message):
        asyncio.run(sources.extract_notes(data, filename))


def test_import_docx_notes():
    from docx import Document
    doc = Document()
    doc.add_heading('Progetto XR', 0)
    doc.add_paragraph('Una traccia da sviluppare.')
    stream = BytesIO()
    doc.save(stream)
    text = asyncio.run(sources.extract_notes(stream.getvalue(), 'note.docx'))
    assert 'Progetto XR' in text and 'Una traccia da sviluppare.' in text


def test_import_pdf_notes():
    import fitz
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), 'Progetto XR: consegna al cliente')
    text = asyncio.run(sources.extract_notes(doc.tobytes(), 'note.pdf'))
    assert 'Progetto XR' in text
