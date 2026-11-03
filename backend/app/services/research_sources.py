"""Discovery catalogue, not an automatic endorsement of an article's claims.

RSS/Atom provides article URLs and dates; only pages actually read can become evidence.
Searches also cover publishers without a public feed (e.g. ANSA, Reuters and AP).
"""
from urllib.parse import urlparse
import re

NEWS_DOMAINS = {
    "italy": ("ansa.it", "rainews.it", "agi.it", "ilsole24ore.com"),
    "europe": ("euronews.com", "dw.com", "france24.com", "lemonde.fr"),
    "world": ("bbc.com", "reuters.com", "apnews.com", "bbc.co.uk"),
}
PRIMARY_DOMAINS = {
    "general": ("europa.eu", "un.org", "oecd.org", "istat.it"),
    "economy": ("istat.it", "ec.europa.eu", "ecb.europa.eu", "worldbank.org", "imf.org", "bancaditalia.it"),
    "health": ("who.int", "iss.it", "ecdc.europa.eu", "pubmed.ncbi.nlm.nih.gov"),
    "science": ("nature.com", "science.org", "arxiv.org", "cnr.it", "esa.int", "nasa.gov"),
    "climate": ("ipcc.ch", "climate.copernicus.eu", "isprambiente.gov.it", "eea.europa.eu"),
    "education": ("mim.gov.it", "indire.it", "invalsi.it", "istruzione.it", "unesco.org", "oecd.org"),
}
FEEDS = (
    ("RaiNews", "https://www.rainews.it/rss/tutti"),
    ("Euronews", "https://www.euronews.com/rss?format=mrss&level=theme&name=news"),
    ("BBC News", "https://feeds.bbci.co.uk/news/world/rss.xml"),
    ("Deutsche Welle", "https://rss.dw.com/xml/rss-en-all"),
)


def source_kind(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    for kind, groups in (("primary", PRIMARY_DOMAINS), ("news", NEWS_DOMAINS)):
        if any(host == d or host.endswith("." + d) for domains in groups.values() for d in domains):
            return kind
    return "web"


def source_origin(url: str) -> str:
    """Group regional mirrors/subdomains and publishers sharing the same institution."""
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    for domain in ("mim.gov.it", "istruzione.it"):
        if host == domain or host.endswith('.' + domain):
            return "ministero-istruzione"
    if host in {"bbc.com", "bbc.co.uk"} or host.endswith((".bbc.com", ".bbc.co.uk")):
        return "bbc"
    for groups in (PRIMARY_DOMAINS, NEWS_DOMAINS):
        for domains in groups.values():
            for domain in domains:
                if host == domain or host.endswith('.' + domain):
                    return domain
    return host


def primary_domains(topic: str) -> tuple[str, ...]:
    keys = {
        "education": ("scuol", "school", "educat", "istruz", "didatt", "student"),
        "economy": ("econom", "inflaz", "lavor", "pil", "gdp", "energy", "energi", "finanz"),
        "health": ("salut", "sanit", "health", "vaccin", "medic", "malatt"),
        "science": ("scien", "fisic", "biolog", "intelligenza artificiale", "artificial intelligence", "tecnolog"),
        "climate": ("clima", "climate", "ambient", "emission", "biodivers"),
    }
    groups = [PRIMARY_DOMAINS[key] for key, words in keys.items() if any(w in topic.lower() for w in words)]
    selected = [g[i] for i in range(3) for g in groups if i < len(g)]
    return tuple(dict.fromkeys(selected or PRIMARY_DOMAINS["general"]))[:6]


def scoped_queries(query: str, topic: str, news: bool, round_no: int = 1) -> list[str]:
    # A primary-source query must not accidentally require a newspaper domain too.
    query = re.sub(r"\b(?:site|sito):[\w.-]+", "", query).strip()
    groups = [primary_domains(topic)]
    if news:
        groups.extend(NEWS_DOMAINS.values())
    # Individual site: queries are supported more consistently than compound OR groups.
    # Rotate publishers in later rounds to seek genuinely independent evidence.
    offset = (round_no - 1) * 2
    return [f"{query} site:{domains[(offset + i) % len(domains)]}" for domains in groups for i in range(min(2, len(domains)))]
