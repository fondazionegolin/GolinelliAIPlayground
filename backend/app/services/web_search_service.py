"""
Web Search Service - Provides web search capabilities for the teacher agent.
Uses DuckDuckGo Search (via duckduckgo_search library).
"""

import logging
from typing import List, Optional
from dataclasses import dataclass
from duckduckgo_search import DDGS

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
    Web search service using DuckDuckGo Search library.
    More robust than manual scraping.
    """

    def __init__(self):
        pass

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
