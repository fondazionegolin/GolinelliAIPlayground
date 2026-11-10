"""Bounded import of presentation notes; Markdown remains editable source text."""
from pathlib import PurePath

MAX_SOURCE_CHARS = 1_000_000
MAX_SOURCE_BYTES = 10 * 1024 * 1024
MAX_SLIDES = 60
TEXT_EXTENSIONS = {".md", ".markdown", ".txt", ".text", ".rst"}
DOCUMENT_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
SOURCE_EXTENSIONS = TEXT_EXTENSIONS | DOCUMENT_TYPES.keys()


def validate_source(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        raise ValueError("Il file non contiene testo leggibile.")
    if len(text) > MAX_SOURCE_CHARS:
        raise ValueError(f"I materiali superano il limite di {MAX_SOURCE_CHARS:,} caratteri. Dividili in più presentazioni.")
    return text


def decode_notes(data: bytes) -> str:
    # Detect BOMs before trying UTF-8; never silently drop undecodable characters.
    encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    try:
        text = data.decode(encoding)
    except UnicodeDecodeError:
        try:
            text = data.decode("cp1252")
        except UnicodeDecodeError as exc:
            raise ValueError("Il testo non è leggibile. Salva il file in UTF-8 e riprova.") from exc
    if "\x00" in text or any(ord(char) < 32 and char not in "\n\r\t\f" for char in text):
        raise ValueError("Il file non sembra contenere appunti di testo. Usa Markdown, TXT, PDF o DOCX.")
    return validate_source(text)


async def extract_notes(data: bytes, filename: str) -> str:
    extension = PurePath(filename.lower()).suffix
    if extension not in SOURCE_EXTENSIONS:
        raise ValueError("Formato non supportato. Carica Markdown (.md, .markdown), TXT, RST, PDF o DOCX.")
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError("Il file supera il limite di 10 MB.")
    if extension in TEXT_EXTENSIONS:
        return decode_notes(data)
    from app.services.document_processor import document_processor

    text, *_ = await document_processor._extract_content(data, filename, DOCUMENT_TYPES[extension], [])
    return validate_source(text or "")
