"""
Web Search Service - Provides web search capabilities for the teacher agent.
Uses DuckDuckGo HTML scraping (no API key required).
"""

import httpx
import asyncio
import logging
from typing import List, Optional
from dataclasses import dataclass
from bs4 import BeautifulSoup
from urllib.parse import unquote

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """A single search result"""
    title: str
    url: str
    snippet: str
    content: Optional[str] = None  # Full page content if fetched


class WebSearchService:
    """
    Web search service using DuckDuckGo HTML scraping.
    No API key required, works out of the box.
    """

    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
        }

    async def search(
        self,
        query: str,
        num_results: int = 5,
        fetch_content: bool = False
    ) -> List[SearchResult]:
        """
        Perform web search and optionally fetch page content.

        Args:
            query: Search query string
            num_results: Maximum number of results to return
            fetch_content: If True, fetches full page content for top results

        Returns:
            List of SearchResult objects
        """
        try:
            results = await self._search_duckduckgo(query, num_results)

            # Optionally fetch full content for top results
            if fetch_content and results:
                # Fetch content for top 3 results in parallel
                tasks = [
                    self._fetch_page_content(r.url)
                    for r in results[:3]
                ]
                contents = await asyncio.gather(*tasks, return_exceptions=True)

                for i, content in enumerate(contents):
                    if i < len(results) and isinstance(content, str):
                        results[i].content = content

            return results

        except Exception as e:
            logger.error(f"Web search failed: {e}")
            return []

    async def _search_duckduckgo(self, query: str, num: int) -> List[SearchResult]:
        """
        Search DuckDuckGo using HTML scraping.
        """
        results = []

        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                response = await client.get(
                    "https://html.duckduckgo.com/html/",
                    params={"q": query},
                    headers=self.headers
                )
                response.raise_for_status()

                soup = BeautifulSoup(response.text, 'html.parser')

                # Find all result containers
                for result in soup.select('.result')[:num]:
                    try:
                        # Extract title and URL
                        title_elem = result.select_one('.result__title a')
                        snippet_elem = result.select_one('.result__snippet')

                        if not title_elem:
                            continue

                        title = title_elem.get_text(strip=True)

                        # DuckDuckGo wraps URLs - need to extract actual URL
                        href = title_elem.get('href', '')
                        if 'uddg=' in href:
                            # Extract actual URL from DuckDuckGo redirect
                            url = unquote(href.split('uddg=')[-1].split('&')[0])
                        else:
                            url = href

                        snippet = snippet_elem.get_text(strip=True) if snippet_elem else ""

                        if title and url:
                            results.append(SearchResult(
                                title=title,
                                url=url,
                                snippet=snippet
                            ))

                    except Exception as e:
                        logger.warning(f"Failed to parse search result: {e}")
                        continue

        except Exception as e:
            logger.error(f"DuckDuckGo search failed: {e}")

        return results

    async def _fetch_page_content(
        self,
        url: str,
        max_chars: int = 4000
    ) -> Optional[str]:
        """
        Fetch and extract main text content from a URL.

        Args:
            url: URL to fetch
            max_chars: Maximum characters to return

        Returns:
            Extracted text content or None on failure
        """
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()

                soup = BeautifulSoup(response.text, 'html.parser')

                # Remove unwanted elements
                for element in soup(['script', 'style', 'nav', 'footer', 'header',
                                    'aside', 'iframe', 'noscript', 'form']):
                    element.decompose()

                # Try to find main content area
                main_content = (
                    soup.find('main') or
                    soup.find('article') or
                    soup.find('div', class_='content') or
                    soup.find('div', id='content') or
                    soup.body
                )

                if main_content:
                    # Extract text with newlines between elements
                    text = main_content.get_text(separator='\n', strip=True)

                    # Clean up excessive whitespace
                    lines = [line.strip() for line in text.split('\n') if line.strip()]
                    text = '\n'.join(lines)

                    return text[:max_chars]

        except Exception as e:
            logger.warning(f"Failed to fetch content from {url}: {e}")

        return None


# Singleton instance
web_search_service = WebSearchService()
