"""Import complete, verified Gutenberg TXT books, with real download progress."""

from __future__ import annotations

import hashlib
import logging
import re
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlsplit

import httpx

from app.services.toy_lm_catalog import search_catalog

logger = logging.getLogger(__name__)
MAX_CORPUS_BYTES = 50 * 1024 * 1024
GUTENBERG_HOSTS = {"gutenberg.org", "www.gutenberg.org"}
NS = {
    "pg": "http://www.gutenberg.org/2009/pgterms/",
    "dc": "http://purl.org/dc/terms/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
}
START_MARKER = re.compile(r"^\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG (?:EBOOK|ETEXT)[^\n]*(?:\n|$)", re.MULTILINE | re.IGNORECASE)
END_MARKER = re.compile(r"^\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG (?:EBOOK|ETEXT)[^\n]*", re.MULTILINE | re.IGNORECASE)


class LibraryError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def validate_corpus(text: str) -> str:
    if len(text.encode("utf-8")) > MAX_CORPUS_BYTES:
        raise LibraryError("Il testo supera 50 MB. Scegli un file più piccolo: non verrà importato un estratto.", 422)
    return text


def _safe_url(url: str) -> str:
    parsed = urlsplit(url)
    if (parsed.hostname not in GUTENBERG_HOSTS or parsed.scheme not in {"https", "http"}
            or parsed.port not in {None, 80, 443} or parsed.username):
        raise LibraryError("Il collegamento al testo non è supportato.")
    return parsed._replace(scheme="https", netloc=parsed.hostname).geturl()


def _parse_book(content: bytes, book_id: int) -> dict:
    root = ET.fromstring(content)
    ebook = root.find("pg:ebook", NS)
    if ebook is None:
        raise LibraryError("La scheda dell’opera non è valida.")
    rights = ebook.findtext("dc:rights", default="", namespaces=NS).casefold()
    if "public domain" not in rights:
        raise LibraryError("Questo testo non risulta di pubblico dominio nel catalogo.", 422)
    media_type = ebook.findtext("dc:type/rdf:Description/rdf:value", default="", namespaces=NS)
    if media_type.casefold() != "text":
        raise LibraryError("Questa scheda non contiene un libro di testo: potrebbe essere un audiolibro.", 422)
    formats = []
    for file in ebook.findall("dc:hasFormat/pg:file", NS):
        mime = file.findtext("dc:format/rdf:Description/rdf:value", default="", namespaces=NS)
        url = file.get(f"{{{NS['rdf']}}}about", "")
        if mime.startswith("text/plain") and not urlsplit(url).path.endswith(".zip"):
            formats.append((mime, _safe_url(url)))
    formats.sort(key=lambda item: "utf-8" not in item[0].lower())
    if not formats:
        raise LibraryError("Per questa opera non è disponibile un file TXT completo.", 422)
    return {
        "id": book_id,
        "title": ebook.findtext("dc:title", default=f"Libro {book_id}", namespaces=NS),
        "authors": [node.text for node in ebook.findall("dc:creator/pg:agent/pg:name", NS) if node.text],
        "languages": [node.text for node in ebook.findall("dc:language/rdf:Description/rdf:value", NS) if node.text],
        "sourceUrl": f"https://www.gutenberg.org/ebooks/{book_id}",
        "formats": formats,
    }


async def _load_book(client: httpx.AsyncClient, book_id: int) -> dict:
    response = await client.get(f"https://www.gutenberg.org/ebooks/{book_id}.rdf", follow_redirects=True)
    if response.status_code == 404:
        raise LibraryError("Testo non trovato nel catalogo.", 404)
    response.raise_for_status()
    return _parse_book(response.content, book_id)


async def search_books(query: str, language: str = "", page: int = 1) -> dict:
    try:
        return await search_catalog(query, language, page)
    except (httpx.HTTPError, ValueError, OSError, EOFError) as exc:
        logger.warning("Toy LM catalog initialization failed", exc_info=True)
        raise LibraryError("La biblioteca sta impiegando troppo tempo a rispondere. Riprova: puoi anche caricare un TXT completo.") from exc


def _clean_text(text: str) -> str:
    text = text.lstrip("\ufeff")
    start, end = START_MARKER.search(text), END_MARKER.search(text)
    if not start or not end or end.start() <= start.end():
        raise LibraryError("Il download non contiene un TXT Gutenberg completo. Riprova: nessun estratto è stato importato.")
    text = text[start.end():end.start()].strip()
    if not text or "\x00" in text or "\ufffd" in text:
        raise LibraryError("Il TXT scaricato è vuoto o non è decodificato correttamente. Nessun testo è stato importato.")
    return text


async def _download_events(client: httpx.AsyncClient, url: str, mime: str):
    url = _safe_url(url)
    for _ in range(5):
        async with client.stream("GET", url, headers={"Accept-Encoding": "identity"}) as response:
            if response.is_redirect:
                url = _safe_url(urljoin(url, response.headers.get("location", "")))
                continue
            response.raise_for_status()
            if "text/html" in response.headers.get("content-type", "").lower():
                raise LibraryError("La biblioteca ha restituito una pagina web, non il TXT del libro.")
            total = int(response.headers["content-length"]) if response.headers.get("content-length", "").isdigit() else None
            if response.headers.get("content-encoding", "identity").lower() != "identity":
                # Content-Length counts compressed bytes; progress counts decoded TXT bytes.
                total = None
            if total and total > MAX_CORPUS_BYTES:
                raise LibraryError("Il libro supera 50 MB. Non verrà importato un estratto.", 422)
            content = bytearray()
            yield {"type": "progress", "stage": "downloading", "receivedBytes": 0, "totalBytes": total}
            async for chunk in response.aiter_bytes(chunk_size=65_536):
                content.extend(chunk)
                if len(content) > MAX_CORPUS_BYTES:
                    raise LibraryError("Il libro supera 50 MB. Non verrà importato un estratto.", 422)
                yield {"type": "progress", "stage": "downloading", "receivedBytes": len(content), "totalBytes": total}
            if total and not response.headers.get("content-encoding") and len(content) != total:
                raise LibraryError("Download interrotto prima della fine del libro. Riprova.")
            yield {"type": "status", "stage": "verifying", "message": "Download terminato. Verifica del testo integrale…"}
            charset = re.search(r"charset=([\w-]+)", mime, re.IGNORECASE)
            encoding = charset.group(1) if charset else "utf-8"
            if encoding.lower() in {"us-ascii", "ascii"}:
                encoding = "utf-8"
            text = _clean_text(bytes(content).decode(encoding, errors="strict"))
            validate_corpus(text)
            yield {"type": "text", "text": text, "downloadedBytes": len(content)}
            return
    raise LibraryError("Troppi reindirizzamenti durante il download del testo.")


async def import_book_events(book_id: int):
    yield {"type": "status", "stage": "metadata", "message": "Recupero della scheda e del TXT integrale…"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
            book = None
            for attempt in range(2):
                try:
                    book = await _load_book(client, book_id)
                    break
                except httpx.HTTPError:
                    if attempt:
                        raise
                    yield {"type": "status", "stage": "retrying", "message": "La biblioteca risponde lentamente. Nuovo tentativo…"}
            assert book is not None
            candidates = [("text/plain; charset=utf-8", f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"), *book.pop("formats")]
            seen = set()
            for mime, url in candidates:
                if url in seen:
                    continue
                seen.add(url)
                try:
                    async for event in _download_events(client, url, mime):
                        if event["type"] == "text":
                            text = event["text"]
                            yield {"type": "complete", "book": {
                                **book, "text": text, "truncated": False,
                                "byteCount": len(text.encode("utf-8")), "downloadedBytes": event["downloadedBytes"],
                                "wordCount": len(text.split()), "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                            }}
                        else:
                            yield event
                    return
                except LibraryError as exc:
                    if exc.status_code == 422:
                        raise
                    last_error = exc
                except (httpx.HTTPError, UnicodeError, LookupError) as exc:
                    last_error = exc
                yield {"type": "status", "stage": "retrying", "message": "Verifico un altro collegamento al TXT completo…"}
            raise LibraryError("Impossibile ottenere il libro completo. Riprova: nessun estratto è stato importato.") from last_error
    except LibraryError:
        raise
    except (httpx.HTTPError, ValueError, ET.ParseError, LookupError) as exc:
        logger.warning("Toy LM book %s import failed", book_id, exc_info=True)
        raise LibraryError("Impossibile scaricare il libro completo. Riprova tra poco.") from exc


async def import_book(book_id: int) -> dict:
    async for event in import_book_events(book_id):
        if event["type"] == "complete":
            return event["book"]
    raise LibraryError("Download interrotto: il testo non è stato importato.")
