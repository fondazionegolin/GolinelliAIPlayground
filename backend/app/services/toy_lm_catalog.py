"""A persistent, searchable copy of Gutenberg's official machine-readable catalog."""

from __future__ import annotations

import asyncio
import csv
import gzip
import io
import logging
import os
import tempfile
import time
import unicodedata
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)
CATALOG_URL = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz"
CATALOG_TTL = 24 * 3600
PAGE_SIZE = 24
FEATURED_IDS = [52484, 1000, 3747, 11, 1342, 1661, 2000, 84]
_catalog: list[dict] = []
_loaded_at = 0.0
_lock = asyncio.Lock()
_refresh_task: asyncio.Task | None = None


def _cache_path() -> Path:
    return Path(os.environ.get("TOY_LM_LIBRARY_CACHE_DIR", "uploads/toy_lm_library")) / "catalog.csv.gz"


def _normalize(value: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c))


def _parse_catalog(content: bytes) -> list[dict]:
    records = []
    with gzip.open(io.BytesIO(content), "rt", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not {"Text#", "Type", "Title", "Language", "Authors"}.issubset(reader.fieldnames or []):
            raise ValueError("Invalid Gutenberg catalog")
        for row in reader:
            if row["Type"] != "Text" or not row["Text#"].isdigit():
                continue
            book_id = int(row["Text#"])
            authors = [a.strip() for a in row["Authors"].split(";") if a.strip() and "[" not in a]
            records.append({
                "id": book_id, "title": row["Title"], "authors": authors,
                "languages": [language.strip() for language in row["Language"].split(";")],
                "sourceUrl": f"https://www.gutenberg.org/ebooks/{book_id}",
                "_search": _normalize(row["Title"] + " " + row["Authors"]),
            })
    if not records:
        raise ValueError("Empty Gutenberg catalog")
    featured = {book_id: rank for rank, book_id in enumerate(FEATURED_IDS)}
    records.sort(key=lambda book: (featured.get(book["id"], len(featured)), book["title"].casefold(), book["id"]))
    return records


def _save_catalog(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(content)
            stream.flush()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


async def _refresh_catalog() -> list[dict]:
    global _catalog, _loaded_at
    async with _lock:
        if _catalog and time.time() - _loaded_at < CATALOG_TTL:
            return _catalog
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0), follow_redirects=True) as client:
                async with client.stream("GET", CATALOG_URL) as response:
                    response.raise_for_status()
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > 30 * 1024 * 1024:
                            raise ValueError("Catalog download too large")
            records = await asyncio.to_thread(_parse_catalog, bytes(content))
            try:
                await asyncio.to_thread(_save_catalog, _cache_path(), content)
            except OSError:
                logger.warning("Could not persist Toy LM catalog", exc_info=True)
            _catalog, _loaded_at = records, time.time()
        except (httpx.HTTPError, OSError, ValueError, EOFError):
            if not _catalog:
                raise
            logger.warning("Using cached Toy LM catalog while Gutenberg is unavailable", exc_info=True)
        return _catalog


async def get_catalog() -> list[dict]:
    global _catalog, _loaded_at, _refresh_task
    if not _catalog:
        path = _cache_path()
        try:
            _catalog = await asyncio.to_thread(_parse_catalog, await asyncio.to_thread(path.read_bytes))
            _loaded_at = path.stat().st_mtime
        except (OSError, ValueError, EOFError):
            return await _refresh_catalog()
    if time.time() - _loaded_at >= CATALOG_TTL and (_refresh_task is None or _refresh_task.done()):
        _refresh_task = asyncio.create_task(_refresh_catalog())
    return _catalog


async def search_catalog(query: str, language: str = "", page: int = 1) -> dict:
    catalog = await get_catalog()
    terms = _normalize(query).split()
    matches = [book for book in catalog if (not language or language in book["languages"])
               and all(term in book["_search"] for term in terms)]
    start = (page - 1) * PAGE_SIZE
    return {
        "results": [{key: value for key, value in book.items() if not key.startswith("_")}
                    for book in matches[start:start + PAGE_SIZE]],
        "hasNext": start + PAGE_SIZE < len(matches),
        "total": len(matches),
    }
