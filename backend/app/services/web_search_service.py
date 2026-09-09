"""
Web Search Service - Provides web search capabilities for the teacher agent.
Uses DuckDuckGo Search (via duckduckgo_search library).
"""

import logging
import ipaddress
import json
import re
import socket
from typing import List, Optional
from dataclasses import dataclass
from urllib.parse import urlparse, urljoin
from duckduckgo_search import DDGS

logger = logging.getLogger(__name__)

URL_RE = re.compile(r"https?://[^\s<>()\"']+", re.IGNORECASE)


@dataclass
class SearchResult:
    """A single search result"""
    title: str
    url: str
    snippet: str
    content: Optional[str] = None  # Full page content if fetched


@dataclass
class UrlFetchResult:
    """Text extracted from a user-provided URL."""
    url: str
    final_url: str
    title: str
    content: str
    error: Optional[str] = None


class WebSearchService:
    """
    Web search service using DuckDuckGo Search library.
    More robust than manual scraping.
    """

    def __init__(self):
        pass

    def extract_urls(self, text: str, max_urls: int = 3) -> list[str]:
        """Extract unique http(s) URLs from free text."""
        urls: list[str] = []
        seen: set[str] = set()
        for match in URL_RE.finditer(text or ""):
            url = match.group(0).rstrip(".,;:!?)]}")
            if url not in seen:
                seen.add(url)
                urls.append(url)
            if len(urls) >= max_urls:
                break
        return urls

    def _is_public_http_url(self, url: str) -> bool:
        """Allow only public http(s) URLs to reduce SSRF risk."""
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False

        hostname = parsed.hostname
        try:
            infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        except socket.gaierror:
            return False

        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_multicast
                or ip.is_reserved
                or ip.is_unspecified
            ):
                return False
        return True

    def _flatten_page_json(self, value, depth: int = 0, max_items: int = 250) -> list[str]:
        """Extract useful human-readable fields from embedded page JSON."""
        if depth > 8 or max_items <= 0:
            return []

        useful_keys = {
            "name", "title", "headline", "description", "brand", "model",
            "sku", "price", "pricecurrency", "availability", "url",
            "category", "itemcondition",
        }
        lines: list[str] = []

        if isinstance(value, dict):
            for key, child in value.items():
                key_str = str(key).lower()
                if isinstance(child, (dict, list)):
                    lines.extend(self._flatten_page_json(child, depth + 1, max_items - len(lines)))
                elif key_str in useful_keys and child not in (None, ""):
                    lines.append(f"{key}: {child}")
                if len(lines) >= max_items:
                    break
        elif isinstance(value, list):
            for child in value:
                lines.extend(self._flatten_page_json(child, depth + 1, max_items - len(lines)))
                if len(lines) >= max_items:
                    break

        return lines[:max_items]

    def _extract_embedded_json_text(self, soup, max_chars: int = 5000) -> str:
        """Extract product/catalog data from JSON scripts when pages are JS-rendered."""
        blocks: list[str] = []
        for script in soup.find_all("script"):
            script_type = (script.get("type") or "").lower()
            script_id = (script.get("id") or "").lower()
            if (
                "json" not in script_type
                and "ld+json" not in script_type
                and script_id not in {"__next_data__", "__nuxt_data__"}
            ):
                continue
            raw = (script.string or script.get_text() or "").strip()
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except Exception:
                continue
            lines = self._flatten_page_json(data)
            if lines:
                blocks.append("\n".join(lines))
            if sum(len(block) for block in blocks) >= max_chars:
                break
        return "\n\n".join(blocks)[:max_chars]

    def _extract_catalog_items_text(self, lines: list[str], max_items: int = 80) -> str:
        """Extract compact product listings from ecommerce pages with repeated item blocks."""
        items: list[tuple[str, str, str, str]] = []
        seen: set[tuple[str, str, str]] = set()

        for index, line in enumerate(lines):
            if line != "VISTO DI RECENTE" or index + 4 >= len(lines):
                continue

            name = lines[index + 1].strip()
            brand = lines[index + 2].strip()
            availability = lines[index + 3].strip()
            price = lines[index + 4].strip()

            if not name or brand.lower() == "array":
                continue
            if not re.search(r"\d", availability) or "disponibil" not in availability.lower():
                continue
            if "€" not in price:
                continue

            key = (name.lower(), availability.lower(), price.lower())
            if key in seen:
                continue
            seen.add(key)
            items.append((name, brand, availability, price))
            if len(items) >= max_items:
                break

        if not items:
            return ""

        rows = [
            "Prodotti estratti dal catalogo:",
            "| # | Nome | Brand | Disponibilita | Prezzo |",
            "|---:|---|---|---|---|",
        ]
        for index, (name, brand, availability, price) in enumerate(items, 1):
            rows.append(f"| {index} | {name} | {brand} | {availability} | {price} |")
        rows.append(f"Totale prodotti estratti da questa pagina: {len(items)}")
        return "\n".join(rows)

    async def fetch_user_url(self, url: str, max_chars: int = 6000) -> UrlFetchResult:
        """Fetch and extract readable text from a teacher-provided URL."""
        import httpx
        from bs4 import BeautifulSoup

        if not self._is_public_http_url(url):
            return UrlFetchResult(url=url, final_url=url, title="", content="", error="URL non consentito")

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        }
        current_url = url

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
                response = None
                for _ in range(5):
                    if not self._is_public_http_url(current_url):
                        return UrlFetchResult(url=url, final_url=current_url, title="", content="", error="Redirect non consentito")
                    response = await client.get(current_url, headers=headers)
                    if response.status_code not in {301, 302, 303, 307, 308}:
                        break
                    location = response.headers.get("location")
                    if not location:
                        break
                    current_url = urljoin(current_url, location)

                if response is None:
                    return UrlFetchResult(url=url, final_url=current_url, title="", content="", error="Nessuna risposta")
                response.raise_for_status()

                content_type = response.headers.get("content-type", "").lower()
                if "text/html" not in content_type and "text/plain" not in content_type:
                    return UrlFetchResult(
                        url=url,
                        final_url=str(response.url),
                        title="",
                        content="",
                        error=f"Tipo contenuto non supportato: {content_type or 'sconosciuto'}",
                    )

                if "text/plain" in content_type:
                    text = response.text.strip()
                    return UrlFetchResult(
                        url=url,
                        final_url=str(response.url),
                        title=str(response.url),
                        content=text[:max_chars],
                    )

                soup = BeautifulSoup(response.text, "html.parser")
                embedded_json_text = self._extract_embedded_json_text(soup)
                for element in soup(["script", "style", "nav", "footer", "header", "aside", "iframe", "form", "noscript"]):
                    element.decompose()

                title = soup.title.get_text(" ", strip=True) if soup.title else str(response.url)
                main_content = (
                    soup.find("main")
                    or soup.find("article")
                    or soup.find("div", class_="content")
                    or soup.body
                )
                if not main_content:
                    return UrlFetchResult(url=url, final_url=str(response.url), title=title, content="", error="Testo non trovato")

                text = main_content.get_text(separator="\n", strip=True)
                lines = [line.strip() for line in text.split("\n") if line.strip()]
                clean_text = "\n".join(lines)
                catalog_items_text = self._extract_catalog_items_text(lines)
                if catalog_items_text:
                    clean_text = catalog_items_text
                    if embedded_json_text:
                        clean_text += f"\n\nDati strutturati nella pagina:\n{embedded_json_text}"
                elif embedded_json_text:
                    clean_text = f"Dati strutturati nella pagina:\n{embedded_json_text}\n\nTesto visibile nella pagina:\n{clean_text}"
                return UrlFetchResult(
                    url=url,
                    final_url=str(response.url),
                    title=title[:200],
                    content=clean_text[:max_chars],
                )
        except Exception as e:
            logger.warning("Failed to fetch user URL %s: %s", url, e)
            return UrlFetchResult(url=url, final_url=current_url, title="", content="", error=str(e))

    async def build_url_context(self, text: str, max_urls: int = 3, max_chars_per_url: int = 12000) -> str:
        """Build an LLM context block from URLs found in a teacher message."""
        urls = self.extract_urls(text, max_urls=max_urls)
        if not urls:
            return ""

        parts = ["## Contesto dai link forniti dal docente"]
        for index, url in enumerate(urls, 1):
            result = await self.fetch_user_url(url, max_chars=max_chars_per_url)
            if result.error or not result.content:
                parts.append(
                    f"[{index}] URL: {url}\n"
                    f"Stato: non leggibile ({result.error or 'nessun testo estratto'})."
                )
                continue
            parts.append(
                f"[{index}] Titolo: {result.title or result.final_url}\n"
                f"URL: {result.final_url}\n"
                f"Testo estratto:\n{result.content}"
            )
        parts.append(
            "Istruzioni: usa il contenuto dei link solo come fonte contestuale. "
            "Se una fonte contiene testo estratto, considera quel testo come gia disponibile nel prompt e non dire che non puoi leggere o guardare il link. "
            "Se e presente una tabella 'Prodotti estratti dal catalogo', usala come fonte principale per rispondere su liste, prezzi e disponibilita. "
            "Quando riprendi informazioni dai link, cita il numero della fonte tra parentesi quadre, ad esempio [1]. "
            "Se una pagina non e leggibile, dillo chiaramente senza inventare contenuti."
        )
        return "\n\n---\n\n".join(parts)

    async def search(
        self,
        query: str,
        num_results: int = 5,
        fetch_content: bool = False
    ) -> List[SearchResult]:
        """
        Perform web search using DDGS.

        Args:
            query: Search query string
            num_results: Maximum number of results to return
            fetch_content: If True, fetches full page content (not implemented here, relies on snippet or separate fetch)

        Returns:
            List of SearchResult objects
        """
        results = []
        try:
            # DDGS is synchronous but fast enough for this context, 
            # or we can run it in an executor if needed. 
            # For now, running directly.
            with DDGS() as ddgs:
                # region="it-it" for Italian results
                ddgs_results = list(ddgs.text(query, region="it-it", max_results=num_results))
                
                for r in ddgs_results:
                    results.append(SearchResult(
                        title=r.get('title', ''),
                        url=r.get('href', ''),
                        snippet=r.get('body', '')
                    ))

            # Optionally fetch full content
            if fetch_content and results:
                # We can implement content fetching here if needed, 
                # but for now we rely on the snippet which is adequate for quick answers
                pass

            return results

        except Exception as e:
            logger.error(f"Web search failed: {e}")
            return []

    async def _fetch_page_content(self, url: str, max_chars: int = 4000) -> Optional[str]:
        """
        Fetch and extract main text content from a URL.
        (Kept for compatibility if we decide to fetch deeper content)
        """
        import httpx
        from bs4 import BeautifulSoup

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
                response = await client.get(url, headers=headers)
                response.raise_for_status()

                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Cleanup
                for element in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'form']):
                    element.decompose()

                main_content = (
                    soup.find('main') or
                    soup.find('article') or
                    soup.find('div', class_='content') or
                    soup.body
                )

                if main_content:
                    text = main_content.get_text(separator='\n', strip=True)
                    lines = [line.strip() for line in text.split('\n') if line.strip()]
                    return '\n'.join(lines)[:max_chars]

        except Exception as e:
            logger.warning(f"Failed to fetch content from {url}: {e}")
        
        return None

# Singleton instance
web_search_service = WebSearchService()
