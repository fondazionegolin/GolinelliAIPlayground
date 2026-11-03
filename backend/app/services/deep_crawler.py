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
import json
import io
from xml.etree import ElementTree
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
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".zip", ".gz", ".mp3", ".mp4", ".avi", ".mov",
    ".css", ".js", ".ico", ".xml", ".rss", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
)
SKIP_PATH_HINTS = ("login", "signin", "signup", "register", "cart", "checkout", "privacy", "cookie", "terms", "account", "/tag/", "/category/", "special:", "speciale:", "file:", "template:", "help:")
_WORD_RE = re.compile(r"[a-zà-ÿ0-9]{4,}", re.IGNORECASE)
STOP_WORDS = set("della delle dello degli dalla dalle dagli nelle nella negli sullo sulla sulle come cosa quali quale sono sono perche perché ricerca approfondita research deep fonti sources notizie news informazioni information analisi analysis overview approfondimento introduzione quadro generale recenti ultimo ultimi ultime ultima latest recent oggi today dettagli dettagliata documenti documento rapporto report focus effetti impatto sviluppi about with from that this their have been into more also della degli anni anno ".split())


@dataclass
class FetchedPage:
    url: str
    final_url: str
    title: str = ""
    text: str = ""
    links: list[tuple[str, str]] = field(default_factory=list)  # (url, anchor text)
    error: str | None = None
    published_at: str = ""
    publisher: str = ""
    feed_entries: list[dict] = field(default_factory=list)


def topic_words(*texts: str) -> set[str]:
    return {w.lower() for t in texts for w in _WORD_RE.findall(t or "") if w.lower() not in STOP_WORDS and not w.isdigit()}


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

    async def fetch(self, url: str, max_chars: int = 9000, *, feed: bool = False) -> FetchedPage:
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
                    if not any(t in kind for t in (("xml", "rss", "atom", "text/plain") if feed else ("html", "text/plain", "application/pdf"))):
                        return FetchedPage(url, current, error=f"Tipo non supportato: {kind or 'sconosciuto'}")
                    body = b""
                    async for chunk in response.aiter_bytes():
                        body += chunk
                        if len(body) > (6_000_000 if "application/pdf" in kind else MAX_BYTES):
                            return FetchedPage(url, current, error="Pagina troppo grande")
                    html = body.decode(response.encoding or "utf-8", errors="replace")
                if "application/pdf" in kind:
                    return await asyncio.to_thread(self._parse_pdf, url, current, body, max_chars)
                return self._parse_feed(url, current, html) if feed else self._parse(url, current, html, max_chars)
            return FetchedPage(url, current, error="Troppi redirect")
        except Exception as exc:
            return FetchedPage(url, current, error=str(exc)[:160] or exc.__class__.__name__)

    def _parse_pdf(self, url: str, final_url: str, body: bytes, max_chars: int) -> FetchedPage:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(body))
        chunks = []
        for page in reader.pages[:25]:
            chunks.append(page.extract_text() or "")
            if sum(map(len, chunks)) >= max_chars:
                break
        title = str((reader.metadata or {}).get("/Title") or final_url)
        return FetchedPage(url, final_url, title=title[:200], text="\n".join(chunks)[:max_chars], publisher=urlparse(final_url).hostname or "")

    def _parse(self, url: str, final_url: str, html: str, max_chars: int) -> FetchedPage:
        soup = BeautifulSoup(html, "html.parser")
        published = soup.find("meta", property="article:published_time") or soup.find("meta", attrs={"name": "date"})
        publisher = soup.find("meta", property="og:site_name")
        published_at = str(published.get("content", ""))[:80] if published else ""
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or script.get_text())
                entries = data if isinstance(data, list) else [data]
                for entry in entries:
                    if isinstance(entry, dict):
                        for node in [entry, *(entry.get("@graph") or [])]:
                            if isinstance(node, dict) and node.get("datePublished"):
                                published_at = str(node["datePublished"])[:80]
            except (ValueError, TypeError):
                pass
        for element in soup(["script", "style", "nav", "footer", "aside", "iframe", "form", "noscript"]):
            element.decompose()
        title = soup.title.get_text(" ", strip=True) if soup.title else final_url
        main = soup.find("article") or soup.find("main") or soup.find("div", id="mw-content-text") or soup.body
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
        return FetchedPage(url, final_url, title=title[:200], text="\n".join(lines)[:max_chars], links=links,
                           published_at=published_at, publisher=str(publisher.get("content", ""))[:120] if publisher else "")

    def _parse_feed(self, url: str, final_url: str, xml: str) -> FetchedPage:
        if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", xml, re.I):
            return FetchedPage(url, final_url, error="Feed XML non consentito")
        try:
            root = ElementTree.fromstring(xml)
        except ElementTree.ParseError:
            return FetchedPage(url, final_url, error="Feed non valido")
        entries = []
        for item in list(root.iter()):
            if item.tag.split("}")[-1] not in {"item", "entry"}:
                continue
            fields = {c.tag.split("}")[-1]: c for c in item}
            link_node = next((c for c in item if c.tag.split("}")[-1] == "link" and c.get("rel", "alternate") == "alternate"), None)
            href = (link_node.get("href") or link_node.text or "").strip() if link_node is not None else ""
            href = urljoin(final_url, href)
            if not href.startswith(("http://", "https://")):
                continue
            def value(*names):
                node = next((fields[n] for n in names if n in fields), None)
                return "".join(node.itertext()).strip() if node is not None else ""
            entries.append({"url": href, "title": value("title")[:250],
                            "snippet": BeautifulSoup(value("description", "summary"), "html.parser").get_text(" ", strip=True)[:600],
                            "published_at": value("pubDate", "published", "updated")[:80]})
            if len(entries) >= 100:
                break
        return FetchedPage(url, final_url, feed_entries=entries)


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
