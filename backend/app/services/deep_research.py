"""Deep research for the teacher chatbot: a multi-agent web-crawling loop that ends when sources start to overlap.

Flow (every step is reported as an SSE event so the UI can show each spawned sub-agent):
    plan (separate endpoint, teacher approves/edits) -> rounds of [crawler -> readers] per subtopic ->
    analyst (measures overlap between sources, proposes follow-up queries) -> stop when saturated ->
    writers (one per subtopic) -> editor (assembles the markdown document + sources).
Extending an existing document reuses the same loop on the new topic and appends the new sections.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

from app.services.json_extract import extract_json
from app.services.llm_service import llm_service
from urllib.parse import urlparse

from app.services.web_search_service import web_search_service
from app.services.deep_crawler import Crawler, FetchedPage, MAX_LINKS_PER_PAGE, canonical, topic_words, wikipedia_seeds, score_link

logger = logging.getLogger(__name__)

MAX_ROUNDS = 3
MAX_SUBTOPICS = 6
QUERIES_PER_SUBTOPIC = 2
PAGES_PER_SUBTOPIC_ROUND = 8  # crawl budget per subtopic per round
CRAWL_BATCH = 3
CRAWL_MAX_DEPTH = 2
SATURATION_NOVELTY = 0.35  # a round whose facts are <35% new w.r.t. the knowledge base ends the search
READ_CHARS = 9000
SOURCES_HEADING = "## Fonti"

_WORD_RE = re.compile(r"[a-zà-ÿ0-9]{4,}", re.IGNORECASE)


@dataclass
class Fact:
    text: str
    source: int  # 1-based global source number
    subtopic: str


@dataclass
class ResearchState:
    facts: list[Fact] = field(default_factory=list)
    sources: list[dict[str, Any]] = field(default_factory=list)  # [{n, url, title}]
    seen_urls: set[str] = field(default_factory=set)
    prompt_tokens: int = 0
    completion_tokens: int = 0

    def source_number(self, url: str, title: str) -> int:
        for source in self.sources:
            if source["url"] == url:
                return source["n"]
        number = len(self.sources) + 1
        self.sources.append({"n": number, "url": url, "title": title or url})
        return number


def _words(text: str) -> set[str]:
    return {word.lower() for word in _WORD_RE.findall(text or "")}


def _overlaps(fact: str, others: list[Fact], threshold: float = 0.55) -> bool:
    """True when most of the fact's content words already appear in a fact from another source."""
    words = _words(fact)
    if len(words) < 3:
        return False
    for other in others:
        other_words = _words(other.text)
        if other_words and len(words & other_words) / min(len(words), len(other_words)) >= threshold:
            return True
    return False


class _Run:
    """Shared plumbing for the agents of one run: event queue, usage counters and model settings."""

    def __init__(self, provider: str, model: str, state: ResearchState, language_hint: str):
        self.provider = provider
        self.model = model
        self.state = state
        self.language_hint = language_hint
        self.queue: asyncio.Queue[Optional[dict[str, Any]]] = asyncio.Queue()
        self.llm_slots = asyncio.Semaphore(4)
        self.crawler = Crawler()

    def emit(self, event: dict[str, Any]) -> None:
        self.queue.put_nowait(event)

    def agent(self, agent_id: str, role: str, label: str, status: str = "running", parent: Optional[str] = None, detail: str = "") -> None:
        self.emit({"type": "agent", "agent": {"id": agent_id, "role": role, "label": label, "status": status, "parent": parent, "detail": detail}})

    def log(self, agent_id: str, message: str) -> None:
        self.emit({"type": "agent_log", "id": agent_id, "message": message})

    async def llm(self, system: str, prompt: str, max_tokens: int = 1500, temperature: float = 0.3) -> str:
        async with self.llm_slots:
            response = await llm_service.generate(
                messages=[{"role": "user", "content": prompt}],
                system_prompt=f"{system}\n{self.language_hint}",
                provider=self.provider,
                model=self.model,
                temperature=temperature,
                max_tokens=max_tokens,
                allow_web_search=False,
            )
        self.state.prompt_tokens += int(response.prompt_tokens or 0)
        self.state.completion_tokens += int(response.completion_tokens or 0)
        return (response.content or "").strip()


# ── Planner (called by its own endpoint, before the teacher approves) ─────────


async def propose_plan(request: str, history: list[dict], provider: str, model: str, language_hint: str, existing_title: str | None = None) -> dict[str, Any]:
    """Ask the model for a research plan, or a clarifying question when the request is too vague."""
    run = _Run(provider, model, ResearchState(), language_hint)
    recent = "\n".join(f"{m.get('role')}: {str(m.get('content') or '')[:600]}" for m in history[-6:])
    scope = (
        f"Esiste già un documento intitolato «{existing_title}»: il piano riguarda SOLO ciò che va aggiunto."
        if existing_title else "Il documento va creato da zero."
    )
    raw = await run.llm(
        "Sei il coordinatore di una ricerca approfondita per un docente. Rispondi SOLO con JSON valido.",
        f"""Conversazione recente:
{recent or '(nessuna)'}

Richiesta del docente: "{request}"
{scope}

Se la richiesta è troppo vaga per pianificare (manca l'argomento, il livello o lo scopo), rispondi:
{{"clarifying_question": "domanda breve e concreta"}}

Altrimenti proponi il piano:
{{"title": "titolo del documento", "objective": "obiettivo in 1-2 frasi",
  "subtopics": [{{"id": "s1", "title": "sottoargomento", "queries": ["query di ricerca web 1", "query 2"]}}]}}
Regole: da 3 a {MAX_SUBTOPICS} sottoargomenti distinti (1-3 se si tratta di un'aggiunta), massimo {QUERIES_PER_SUBTOPIC} query ciascuno, query specifiche e adatte al web.""",
        max_tokens=900,
    )
    try:
        data = extract_json(raw)
    except ValueError:
        return {"clarifying_question": "Non sono riuscito a pianificare la ricerca: puoi descrivere meglio argomento e scopo?"}
    if data.get("clarifying_question"):
        return {"clarifying_question": str(data["clarifying_question"])[:400]}
    plan = normalize_plan(data, request)
    plan["seed_urls"] = web_search_service.extract_urls(request, max_urls=6)  # links the teacher pasted seed the crawl
    return {"plan": plan, "usage": {"prompt_tokens": run.state.prompt_tokens, "completion_tokens": run.state.completion_tokens}}


def normalize_plan(data: dict[str, Any], fallback_title: str = "Ricerca") -> dict[str, Any]:
    subtopics = []
    for index, item in enumerate((data.get("subtopics") or [])[:MAX_SUBTOPICS], start=1):
        title = str((item or {}).get("title") or "").strip()
        if not title:
            continue
        queries = [str(q).strip() for q in ((item or {}).get("queries") or []) if str(q).strip()][:QUERIES_PER_SUBTOPIC]
        subtopics.append({"id": str((item or {}).get("id") or f"s{index}")[:16], "title": title[:160], "queries": queries or [title[:160]]})
    return {
        "title": str(data.get("title") or fallback_title)[:200],
        "objective": str(data.get("objective") or "")[:600],
        "subtopics": subtopics,
    }


# ── Agents ────────────────────────────────────────────────────────────────────


async def _read_page(run: _Run, subtopic: dict, page: FetchedPage, depth: int, parent: str) -> list[Fact]:
    """Reader agent: turn one crawled page into facts. A page without relevant facts is discarded (and not expanded)."""
    agent_id = f"reader-{uuid.uuid4().hex[:6]}"
    label = (page.title or page.final_url)[:80]
    host = urlparse(page.final_url).netloc
    run.agent(agent_id, "reader", label, parent=parent, detail=f"{host} · profondità {depth}")
    try:
        if page.error or len(page.text) < 200:
            run.agent(agent_id, "reader", label, status="error", parent=parent, detail=page.error or "Contenuto troppo breve")
            return []
        run.log(agent_id, f"Estraggo i fatti utili da {len(page.text)} caratteri ({len(page.links)} link in pagina)")
        raw = await run.llm(
            "Estrai fatti verificabili da una pagina web. Rispondi SOLO con JSON valido.",
            f"""Sottoargomento: {subtopic['title']}
Pagina: {page.title}
---
{page.text}
---
Estrai da 3 a 8 fatti autonomi, concreti e rilevanti per il sottoargomento (dati, definizioni, date, esempi).
Ignora pubblicità e testo non pertinente. Se la pagina NON tratta il sottoargomento (pagina di prodotto, login, assistenza, argomento diverso) rispondi {{"facts": []}}.
Formato: {{"facts": ["fatto 1", "fatto 2"]}}""",
        )
        facts_raw = [str(f).strip() for f in (extract_json(raw).get("facts") or []) if str(f).strip()][:8]
        if not facts_raw:
            run.agent(agent_id, "reader", label, status="error", parent=parent, detail="Pagina non pertinente, scartata")
            return []
        number = run.state.source_number(page.final_url, page.title)
        facts = [Fact(text=f[:500], source=number, subtopic=subtopic["id"]) for f in facts_raw]
        run.emit({"type": "source", "n": number, "url": page.final_url, "title": page.title, "agent": agent_id, "facts": len(facts)})
        run.agent(agent_id, "reader", label, status="done", parent=parent, detail=f"{len(facts)} fatti · {host}")
        return facts
    except Exception as exc:  # one broken page must never stop the research
        logger.warning("deep research reader failed for %s: %s", page.final_url, exc)
        run.agent(agent_id, "reader", label, status="error", parent=parent, detail=str(exc)[:160])
        return []


async def _crawl_subtopic(run: _Run, subtopic: dict, queries: list[str], round_no: int, seed_urls: list[str]) -> list[Fact]:
    """Crawler agent: seeds (web search + Wikipedia + teacher links) -> best-first crawl following relevant links."""
    agent_id = f"crawler-{round_no}-{subtopic['id']}"
    title = f"Crawl: {subtopic['title']}"
    run.agent(agent_id, "crawler", title, detail=f"Giro {round_no}")
    words = topic_words(subtopic["title"], *queries)
    frontier: list[tuple[int, int, str]] = []  # (score, depth, url)
    queued: set[str] = set()
    facts: list[Fact] = []

    def push(url: str, depth: int, score: int) -> None:
        key = canonical(url)
        if key and key not in run.state.seen_urls and key not in queued:
            queued.add(key)
            frontier.append((score, depth, url))

    try:
        for url in seed_urls:
            push(url, 0, 99)
        for query in queries[:QUERIES_PER_SUBTOPIC]:
            run.log(agent_id, f"Ricerca seed: {query}")
            for url, _ in await wikipedia_seeds(query, limit=2):
                push(url, 0, 80)
            for result in await asyncio.to_thread(lambda q=query: _search_sync(q)):
                # the web search is noisy: keep only results whose title/URL mention the topic
                if score_link(result.url, result.title, words) >= 1:
                    push(result.url, 0, 30)
        run.log(agent_id, f"{len(frontier)} seed in coda")
        fetched = 0
        while frontier and fetched < PAGES_PER_SUBTOPIC_ROUND:
            frontier.sort(key=lambda item: (-item[0], item[1]))
            batch = [frontier.pop(0) for _ in range(min(CRAWL_BATCH, len(frontier), PAGES_PER_SUBTOPIC_ROUND - fetched))]
            for _, _, url in batch:
                run.state.seen_urls.add(canonical(url))
            fetched += len(batch)
            run.log(agent_id, "Scarico: " + ", ".join(urlparse(u).netloc + urlparse(u).path[:30] for _, _, u in batch))
            pages = await asyncio.gather(*[run.crawler.fetch(url, READ_CHARS) for _, _, url in batch])
            results = await asyncio.gather(*[_read_page(run, subtopic, page, depth, agent_id) for page, (_, depth, _) in zip(pages, batch)])
            for page, (_, depth, _), page_facts in zip(pages, batch, results):
                facts.extend(page_facts)
                if page_facts and depth < CRAWL_MAX_DEPTH:  # only expand pages that proved relevant
                    ranked = sorted(((score_link(u, a, words), u) for u, a in page.links), reverse=True)
                    for score, link in [r for r in ranked if r[0] >= 2][:MAX_LINKS_PER_PAGE]:
                        push(link, depth + 1, score)
            run.agent(agent_id, "crawler", title, detail=f"{fetched} pagine · {len(frontier)} link in coda · {len(facts)} fatti")
        run.agent(agent_id, "crawler", title, status="done", detail=f"{fetched} pagine, {len(facts)} fatti")
        return facts
    except Exception as exc:
        logger.warning("deep research crawler failed: %s", exc)
        run.agent(agent_id, "crawler", title, status="error", detail=str(exc)[:160])
        return facts


def _search_sync(query: str):
    from duckduckgo_search import DDGS
    try:
        with DDGS() as ddgs:
            return [
                type("R", (), {"title": r.get("title", ""), "url": r.get("href", "")})
                for r in ddgs.text(query, region="it-it", max_results=6)
            ]
    except Exception as exc:
        logger.warning("deep research search failed for %r: %s", query, exc)
        return []


async def _analyze_round(run: _Run, subtopics: list[dict], new_facts: list[Fact], previous: list[Fact], round_no: int) -> tuple[float, dict[str, list[str]]]:
    """Measure how much of the round was already known from other sources and ask for the remaining gaps."""
    agent_id = f"analyst-{round_no}"
    run.agent(agent_id, "analyst", f"Analisi sovrapposizioni (giro {round_no})")
    # Overlap between sources: facts of this round that earlier sources already cover (semantic judge, lexical fallback).
    redundant = 0
    sample = new_facts[:15]
    if previous and sample:
        try:
            raw = await run.llm(
                "Confronti fatti estratti da fonti diverse. Rispondi SOLO con JSON valido.",
                "Fatti già noti:\n" + "\n".join(f"- {f.text[:140]}" for f in previous[-45:])
                + "\n\nNuovi fatti numerati:\n" + "\n".join(f"{i}. {f.text[:140]}" for i, f in enumerate(sample))
                + '\n\nQuali nuovi fatti dicono la stessa cosa di un fatto già noto (sovrapposizione)? Formato: {"covered": [indici]}',
                max_tokens=200, temperature=0.0,
            )
            covered = {int(i) for i in extract_json(raw).get("covered") or [] if str(i).isdigit() and int(i) < len(sample)}
            redundant = round(len(covered) / len(sample) * len(new_facts))
        except Exception:
            redundant = sum(1 for f in new_facts if _overlaps(f.text, [p for p in previous if p.source != f.source]))
    novelty = 1.0 if not previous else (1 - redundant / len(new_facts)) if new_facts else 0.0
    run.log(agent_id, f"{len(new_facts)} fatti nuovi, {redundant} già coperti da altre fonti → novità {novelty:.0%}")
    gaps: dict[str, list[str]] = {}
    if round_no < MAX_ROUNDS and novelty >= SATURATION_NOVELTY:
        digest = "\n".join(f"- [{s['id']}] {s['title']}: {sum(1 for f in run.state.facts if f.subtopic == s['id'])} fatti" for s in subtopics)
        sample = "\n".join(f"[{f.subtopic}] {f.text[:140]}" for f in run.state.facts[-24:])
        try:
            raw = await run.llm(
                "Individui lacune in una ricerca. Rispondi SOLO con JSON valido.",
                f"""Sottoargomenti e fatti raccolti finora:
{digest}

Ultimi fatti:
{sample}

Per i sottoargomenti ancora scoperti o superficiali proponi nuove query web diverse da quelle già ovvie.
Formato: {{"gaps": [{{"id": "s1", "queries": ["query"]}}]}} (massimo {QUERIES_PER_SUBTOPIC} query per sottoargomento, lista vuota se tutto coperto)""",
                max_tokens=600,
            )
            for item in extract_json(raw).get("gaps") or []:
                queries = [str(q).strip() for q in (item.get("queries") or []) if str(q).strip()]
                if queries and any(s["id"] == item.get("id") for s in subtopics):
                    gaps[str(item["id"])] = queries[:QUERIES_PER_SUBTOPIC]
        except Exception as exc:
            logger.warning("deep research gap analysis failed: %s", exc)
    saturated = round_no > 1 and novelty < SATURATION_NOVELTY or not gaps and round_no > 1
    run.agent(agent_id, "analyst", f"Analisi sovrapposizioni (giro {round_no})", status="done",
              detail=f"Novità {novelty:.0%}" + (" · argomento esaurito" if saturated else f" · {len(gaps)} lacune da approfondire"))
    return novelty, ({} if saturated else gaps)


async def _write_section(run: _Run, subtopic: dict, objective: str) -> str:
    agent_id = f"writer-{subtopic['id']}"
    facts = [f for f in run.state.facts if f.subtopic == subtopic["id"]]
    run.agent(agent_id, "writer", f"Scrive: {subtopic['title']}", detail=f"{len(facts)} fatti")
    if not facts:
        run.agent(agent_id, "writer", f"Scrive: {subtopic['title']}", status="error", detail="Nessun fatto raccolto")
        return ""
    material = "\n".join(f"[{f.source}] {f.text}" for f in facts)
    try:
        body = await run.llm(
            "Sei un autore di materiali didattici per docenti. Scrivi in Markdown, tono chiaro e rigoroso.",
            f"""Obiettivo del documento: {objective}
Scrivi la sezione «{subtopic['title']}» usando SOLO i fatti seguenti. Sintetizza e unisci i fatti concordanti di fonti diverse, segnala eventuali discordanze.
Dopo ogni affermazione cita le fonti con il loro numero, es. [1] o [2][5]. Non inventare dati.
Parti con "## {subtopic['title']}" e usa sottotitoli ### / elenchi dove aiutano.

Fatti:
{material}""",
            max_tokens=2200,
            temperature=0.4,
        )
        run.agent(agent_id, "writer", f"Scrive: {subtopic['title']}", status="done", detail=f"{len(body.split())} parole")
        return body
    except Exception as exc:
        run.agent(agent_id, "writer", f"Scrive: {subtopic['title']}", status="error", detail=str(exc)[:160])
        return ""


def sources_markdown(sources: list[dict[str, Any]]) -> str:
    return SOURCES_HEADING + "\n\n" + "\n".join(f"{s['n']}. [{s['title']}]({s['url']})" for s in sources)


def split_sources(content: str) -> tuple[str, list[dict[str, Any]]]:
    """Split an existing document into (body, sources) so new sections can be appended before the sources list."""
    index = content.rfind("\n" + SOURCES_HEADING)
    if index == -1:
        return content.rstrip(), []
    body, tail = content[:index].rstrip(), content[index:]
    sources = [
        {"n": int(m.group(1)), "title": m.group(2), "url": m.group(3)}
        for m in re.finditer(r"^\s*(\d+)\.\s*\[(.*?)\]\((.*?)\)\s*$", tail, re.MULTILINE)
    ]
    return body, sources


# ── Orchestrator ──────────────────────────────────────────────────────────────


async def run_deep_research(
    plan: dict[str, Any],
    provider: str,
    model: str,
    language_hint: str,
    existing_content: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield events; the final one is `done` with the document (and `usage`)."""
    state = ResearchState()
    body_before = ""
    if existing_content:
        body_before, old_sources = split_sources(existing_content)
        state.sources = old_sources
        state.seen_urls = {canonical(s["url"]) for s in old_sources}
    run = _Run(provider, model, state, language_hint)
    subtopics = plan["subtopics"]
    objective = plan.get("objective") or plan.get("title") or ""

    async def orchestrate() -> None:
        try:
            queries = {s["id"]: list(s["queries"]) for s in subtopics}
            seed_urls = [u for u in plan.get("seed_urls", []) if isinstance(u, str)][:6]
            summary_rounds: list[dict[str, Any]] = []
            for round_no in range(1, MAX_ROUNDS + 1):
                run.emit({"type": "round", "round": round_no, "max_rounds": MAX_ROUNDS, "status": "running"})
                run.emit({"type": "status", "message": f"🔎 Giro {round_no}/{MAX_ROUNDS}: {len(queries)} sottoargomenti in parallelo"})
                previous = list(state.facts)
                batches = await asyncio.gather(*[
                    _crawl_subtopic(run, s, queries[s["id"]], round_no, seed_urls if round_no == 1 else []) for s in subtopics if s["id"] in queries
                ])
                new_facts = [fact for batch in batches for fact in batch]
                state.facts.extend(new_facts)
                if not new_facts:
                    run.emit({"type": "round", "round": round_no, "max_rounds": MAX_ROUNDS, "status": "done", "novelty": 0, "saturated": True})
                    break
                novelty, gaps = await _analyze_round(run, subtopics, new_facts, previous, round_no)
                summary_rounds.append({"round": round_no, "novelty": novelty})
                queries = gaps
                run.emit({"type": "round", "round": round_no, "max_rounds": MAX_ROUNDS, "status": "done", "novelty": round(novelty, 2), "saturated": not gaps})
                if not gaps:
                    break

            run.emit({"type": "status", "message": "✍️ Scrittura delle sezioni…"})
            sections = await asyncio.gather(*[_write_section(run, s, objective) for s in subtopics])
            sections = [s for s in sections if s.strip()]
            if not sections:
                raise RuntimeError("Non sono riuscito a raccogliere abbastanza materiale dalle fonti. Riprova con un argomento più specifico.")

            editor_id = "editor"
            run.agent(editor_id, "editor", "Assembla il documento")
            if existing_content:
                parts = [body_before, *sections]
            else:
                intro = await run.llm(
                    "Sei l'editor di un documento di ricerca per docenti.",
                    f"""Scrivi per il documento «{plan['title']}» una breve introduzione (3-5 righe) e una sintesi dei punti chiave (4-6 elenco puntato) in Markdown.
Parti con "## Introduzione" e poi "## Sintesi". Obiettivo: {objective}
Sezioni del documento:
{chr(10).join('- ' + s['title'] for s in subtopics)}
Punti chiave dai fatti raccolti:
{chr(10).join('- ' + f.text[:160] for f in state.facts[:20])}""",
                    max_tokens=700,
                )
                parts = [f"# {plan['title']}", intro, *sections]
            content = "\n\n".join(p.strip() for p in parts if p and p.strip()) + "\n\n" + sources_markdown(state.sources) + "\n"
            run.agent(editor_id, "editor", "Assembla il documento", status="done", detail=f"{len(state.sources)} fonti · {len(content.split())} parole")
            run.emit({"type": "done", "document": {"title": plan["title"], "content": content, "sources": state.sources, "rounds": summary_rounds},
                      "usage": {"prompt_tokens": state.prompt_tokens, "completion_tokens": state.completion_tokens}})
        except Exception as exc:
            logger.exception("deep research failed")
            run.emit({"type": "error", "message": str(exc)})
        finally:
            await run.crawler.close()
            run.queue.put_nowait(None)

    task = asyncio.create_task(orchestrate())
    try:
        while True:
            event = await run.queue.get()
            if event is None:
                break
            yield event
    finally:
        if not task.done():
            task.cancel()
    await asyncio.gather(task, return_exceptions=True)


def sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
