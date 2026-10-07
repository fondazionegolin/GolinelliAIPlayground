"""Polite focused web crawler used by deep research.

Fetches pages (robots.txt aware, per-domain delay, SSRF-safe at every hop), extracts readable text and the
outgoing links, and scores links by how well their anchor/URL match the topic so the crawl follows the most
promising ones first. Seeds come from a web search plus Wikipedia's search API (reliable, no key needed).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from urllib.parse import quote, unquote, urljoin, urlparse, urldefrag
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

from app.services.web_search_service import web_search_service

logger = logging.getLogger(__name__)

USER_AGENT = "GolinelliAIResearchBot/1.0 (+educational research; contact: fondazionegolinelli.it)"
MAX_BYTES = 1_500_000
DOMAIN_DELAY_SECONDS = 1.0
MAX_LINKS_PER_PAGE = 6
SKIP_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".pdf", ".zip", ".gz", ".mp3", ".mp4", ".avi", ".mov",
    ".css", ".js", ".ico", ".xml", ".rss", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
)
SKIP_PATH_HINTS = ("login", "signin", "signup", "register", "cart", "checkout", "privacy", "cookie", "terms", "account", "/tag/", "/category/", "special:", "speciale:", "file:", "template:", "help:")
_WORD_RE = re.compile(r"[a-zà-ÿ0-9]{4,}", re.IGNORECASE)


@dataclass
class FetchedPage:
    url: str
    final_url: str
    title: str = ""
    text: str = ""
    links: list[tuple[str, str]] = field(default_factory=list)  # (url, anchor text)
    error: str | None = None


def topic_words(*texts: str) -> set[str]:
    return {w.lower() for t in texts for w in _WORD_RE.findall(t or "")}


def canonical(url: str) -> str:
    url, _ = urldefrag(url.strip())
    parsed = urlparse(url)
    return parsed._replace(netloc=parsed.netloc.lower(), query="" if "wikipedia.org" in parsed.netloc else parsed.query).geturl().rstrip("/")


def score_link(url: str, anchor: str, words: set[str]) -> int:
    haystack = topic_words(anchor, unquote(urlparse(url).path).replace("_", " ").replace("-", " "))
    return len(haystack & words)


class Crawler:
    """One instance per research run: shares robots cache and per-domain politeness across all subtopics."""

    def __init__(self) -> None:
        self._robots: dict[str, RobotFileParser | None] = {}
        self._next_slot: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._client = httpx.AsyncClient(timeout=12.0, follow_redirects=False, headers={"User-Agent": USER_AGENT, "Accept-Language": "it,en;q=0.7"})

    async def close(self) -> None:
        await self._client.aclose()

    async def _allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self._robots:
            parser: RobotFileParser | None = None
            try:
                if web_search_service._is_public_http_url(origin):
                    response = await self._client.get(f"{origin}/robots.txt", timeout=5.0)
                    if response.status_code == 200:
                        parser = RobotFileParser()
                        parser.parse(response.text.splitlines())
            except Exception:
                parser = None
            self._robots[origin] = parser
        parser = self._robots[origin]
        return True if parser is None else parser.can_fetch(USER_AGENT, url)

    async def _wait_turn(self, host: str) -> None:
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            delay = self._next_slot.get(host, 0) - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self._next_slot[host] = time.monotonic() + DOMAIN_DELAY_SECONDS

    async def fetch(self, url: str, max_chars: int = 9000) -> FetchedPage:
        current = url
        try:
            for _ in range(5):
                if not web_search_service._is_public_http_url(current):
                    return FetchedPage(url, current, error="URL non consentito")
                if not await self._allowed(current):
                    return FetchedPage(url, current, error="Bloccato da robots.txt")
                await self._wait_turn(urlparse(current).netloc)
                async with self._client.stream("GET", current) as response:
                    if response.status_code in {301, 302, 303, 307, 308} and response.headers.get("location"):
                        current = urljoin(current, response.headers["location"])
                        continue
                    if response.status_code >= 400:
                        return FetchedPage(url, current, error=f"HTTP {response.status_code}")
                    kind = response.headers.get("content-type", "").lower()
                    if "html" not in kind and "text/plain" not in kind:
                        return FetchedPage(url, current, error=f"Tipo non supportato: {kind or 'sconosciuto'}")
                    body = b""
                    async for chunk in response.aiter_bytes():
                        body += chunk
                        if len(body) > MAX_BYTES:
                            break
                    html = body.decode(response.encoding or "utf-8", errors="replace")
                return self._parse(url, current, html, max_chars)
            return FetchedPage(url, current, error="Troppi redirect")
        except Exception as exc:
            return FetchedPage(url, current, error=str(exc)[:160] or exc.__class__.__name__)

    def _parse(self, url: str, final_url: str, html: str, max_chars: int) -> FetchedPage:
        soup = BeautifulSoup(html, "html.parser")
        for element in soup(["script", "style", "nav", "footer", "header", "aside", "iframe", "form", "noscript"]):
            element.decompose()
        title = soup.title.get_text(" ", strip=True) if soup.title else final_url
        main = soup.find("main") or soup.find("article") or soup.find("div", id="mw-content-text") or soup.body
        if main is None:
            return FetchedPage(url, final_url, title=title, error="Testo non trovato")
        lines = [line.strip() for line in main.get_text(separator="\n", strip=True).split("\n") if line.strip()]
        links: list[tuple[str, str]] = []
        seen: set[str] = set()
        for a in main.find_all("a", href=True)[:400]:
            href = urljoin(final_url, a["href"])
            parsed = urlparse(href)
            lowered = href.lower()
            if parsed.scheme not in {"http", "https"} or lowered.endswith(SKIP_EXTENSIONS) or any(h in lowered for h in SKIP_PATH_HINTS):
                continue
            key = canonical(href)
            if key in seen or key == canonical(final_url):
                continue
            seen.add(key)
            links.append((key, a.get_text(" ", strip=True)[:120]))
        return FetchedPage(url, final_url, title=title[:200], text="\n".join(lines)[:max_chars], links=links)


async def wikipedia_seeds(query: str, limit: int = 3, lang: str = "it") -> list[tuple[str, str]]:
    """Top Wikipedia articles for a query: a dependable seed even when the web search is rate-limited."""
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": USER_AGENT}) as client:
            response = await client.get(
                f"https://{lang}.wikipedia.org/w/api.php",
                params={"action": "query", "list": "search", "srsearch": query, "srlimit": limit, "format": "json"},
            )
            response.raise_for_status()
            return [
                (f"https://{lang}.wikipedia.org/wiki/{quote(item['title'].replace(' ', '_'))}", item["title"])
                for item in response.json().get("query", {}).get("search", [])
            ]
    except Exception as exc:
        logger.warning("wikipedia seed search failed for %r: %s", query, exc)
        return []
