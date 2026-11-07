"""Multi-agent outline pipeline for the Presentation Studio (Gamma-style).

A single LLM call that reads long notes and writes a whole outline takes minutes and dies behind
proxies (Cloudflare 524 after ~100 s without response). The pipeline splits the work in small,
parallel, individually retryable calls and streams progress events instead:

1. Digest   (parallel)  — long sources are cut in sections, each summarised by a "reader" agent.
2. Plan     (1 call)    — the "architect" agent reads the digests and designs the deck: slide
                          sequence, one layout per slide, the message and the sources of each slide.
3. Harmonise (no LLM)   — deterministic pass: cover first, summary last, layout rhythm, image budget.
4. Write    (parallel)  — one "writer" agent per slide, each with the deck context and only the
                          source sections assigned to its slide. A failed slide degrades to a
                          sketch built from the plan, so the deck is never lost.

Everything is an async generator of plain dict events; the endpoint turns them into NDJSON.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from app.services import presentation_studio as studio
from app.services.json_extract import extract_json
from app.services.presentation_layouts import LAYOUTS
from app.services.presentation_themes import THEMES_BY_ID

logger = logging.getLogger(__name__)

DIRECT_SOURCE_LIMIT = 14_000   # up to this many chars the architect reads the source as is
SECTION_CHARS = 5_500          # size of a source section (digest unit and writer excerpt unit)
MAX_SOURCE_CHARS = 200_000
MAX_SECTIONS = 40
DIGEST_CONCURRENCY = 6
WRITER_CONCURRENCY = 5
WRITER_EXCERPT_CHARS = 9_000
CALL_TIMEOUT = 150.0
MAX_SLIDES = 24
MAX_IMAGE_SLIDES = 3
MAX_SAME_LAYOUT_RUN = 3

# Layouts a repeated one may be swapped for, keeping the content type plausible.
_VARIETY_SWAPS = {
    "title_bullets": ["cards", "two_column", "timeline"],
    "cards": ["title_bullets", "two_column"],
    "two_column": ["title_bullets", "cards"],
    "timeline": ["title_bullets", "cards"],
    "image_split": ["title_bullets", "cards"],
}

READER_SYSTEM_PROMPT = (
    "Sei un lettore attento che prepara appunti per chi costruirà una presentazione. Riassumi la sezione "
    "mantenendo fatti, definizioni, numeri, nomi, date, esempi e citazioni importanti, nell'ordine in cui compaiono. "
    "Non aggiungere nulla che non sia nel testo. Rispondi con testo semplice, senza introduzioni."
)

ARCHITECT_SYSTEM_PROMPT = (
    "Sei un instructional designer che progetta la STRUTTURA di una presentazione didattica: quante slide, in che "
    "ordine, con quale layout e quale messaggio ciascuna. Non scrivi i testi finali (lo faranno altri redattori, "
    "uno per slide) e non scegli colori o caratteri. Costruisci un filo narrativo (apertura, sviluppo a blocchi "
    "coerenti, chiusura), copri tutto il materiale importante senza ripetizioni e dividi gli argomenti grandi in "
    "più slide. Rispondi solo con JSON valido."
)

WRITER_SYSTEM_PROMPT = (
    "Sei un redattore di slide didattiche. Scrivi il contenuto di UNA sola slide di una presentazione già progettata: "
    "rispetta il layout e il messaggio assegnati, mantieni il registro e la terminologia del resto della presentazione, "
    "non anticipare né ripetere ciò che dicono le altre slide. Titoli che dicono il messaggio (max 9 parole); "
    "testo sintetizzato, non copiato; i dettagli vanno nelle note per chi presenta; dati e citazioni solo se presenti "
    "nelle fonti, mai inventati. Rispondi solo con JSON valido."
)


# ── Source handling ──────────────────────────────────────────────────────────

def split_source(text: str, size: int = SECTION_CHARS) -> list[str]:
    """Cut a long text in sections of about `size` chars on paragraph / sentence boundaries."""
    text = (text or "").strip()[:MAX_SOURCE_CHARS]
    if not text:
        return []
    paragraphs = [p.strip() for p in text.replace("\r\n", "\n").split("\n") if p.strip()]
    sections: list[str] = []
    current = ""
    for paragraph in paragraphs:
        pieces = [paragraph]
        if len(paragraph) > size:  # one huge paragraph: cut on sentence ends, then hard
            pieces, buffer = [], ""
            for sentence in paragraph.replace(". ", ".\n").split("\n"):
                while len(sentence) > size:
                    pieces.append(sentence[:size]); sentence = sentence[size:]
                if len(buffer) + len(sentence) + 1 > size and buffer:
                    pieces.append(buffer); buffer = ""
                buffer = f"{buffer} {sentence}".strip()
            if buffer:
                pieces.append(buffer)
        for piece in pieces:
            if current and len(current) + len(piece) + 1 > size:
                sections.append(current); current = ""
            current = f"{current}\n{piece}".strip()
    if current:
        sections.append(current)
    if len(sections) > MAX_SECTIONS:  # very long source: merge neighbours instead of dropping the tail
        factor = -(-len(sections) // MAX_SECTIONS)
        sections = ["\n".join(sections[i:i + factor]) for i in range(0, len(sections), factor)]
    return sections


def build_digest_prompt(section: str, index: int, total: int, language: str) -> str:
    return (
        f"Lingua: {language}\nSezione {index + 1} di {total} del materiale. Riassumila in 120-200 parole "
        f"mantenendo i punti essenziali, i numeri e i nomi.\n\n<<<\n{section}\n>>>"
    )


def build_plan_prompt(brief: dict, sections: list[tuple[str, str]], digested: bool, language: str,
                      school_grade_instruction: str = "") -> str:
    source = ""
    if sections:
        label = "riassunti delle sezioni del materiale" if digested else "materiale fornito, diviso in sezioni"
        body = "\n\n".join(f"[{sid}]\n{text}" for sid, text in sections)
        source = f"\n\nMateriali ({label}); ogni sezione ha un id tra parentesi quadre:\n<<<\n{body}\n>>>"
    return (
        f"Lingua dei contenuti: {language}\n{studio.build_brief_text(brief, school_grade_instruction, include_source=False)}"
        f"{source}\n\n{studio.LAYOUT_GUIDE}\n"
        f"Template grafici esistenti (ne consiglierai 3, in ordine, adatti a pubblico e argomento):\n{studio._theme_menu()}\n\n"
        "Progetta la presentazione. Restituisci JSON con questa forma:\n"
        '{"title":"titolo","subtitle":"sottotitolo","audience":"...","core_message":"il messaggio in una frase",'
        '"recommended_templates":[{"id":"<id template>","reason":"perché, in una frase"}],'
        '"slides":[{"layout":"...","title":"titolo provvisorio","brief":"cosa deve dire questa slide, 1-2 frasi",'
        '"sources":["S1","S3"]}]}\n'
        "La prima slide è la cover, l'ultima una sintesi (layout summary). `sources` elenca gli id delle sezioni "
        "da cui la slide attinge (vuoto se non c'è materiale). Distribuisci le sezioni: ogni parte importante del "
        "materiale deve finire in almeno una slide. Alterna i layout e usa section per aprire le parti principali."
    )


def build_writer_prompt(brief: dict, deck: dict, spec: dict, index: int, excerpt: str, language: str,
                        school_grade_instruction: str = "") -> str:
    overview = "\n".join(
        f"{'→ ' if i == index else '  '}{i + 1}. [{s['layout']}] {s['title']} — {s['brief']}"
        for i, s in enumerate(deck["slides"])
    )
    source = f"\n\nFonte per questa slide:\n<<<\n{excerpt}\n>>>" if excerpt else ""
    return (
        f"Lingua dei contenuti: {language}\n"
        f"{studio.build_brief_text(brief, school_grade_instruction, include_source=False)}\n\n{studio.LAYOUT_GUIDE}\n"
        f"Presentazione: «{deck['title']}» — messaggio centrale: {deck['core_message']}\n"
        f"Piano delle slide (la tua è segnata da →):\n{overview}\n\n"
        f"Scrivi la slide {index + 1} con layout «{spec['layout']}». Messaggio da trasmettere: {spec['brief']}"
        f"{source}\n\nRestituisci solo l'oggetto JSON della slide: {studio.SLIDE_SCHEMA}"
    )


# ── Deterministic coherence pass ─────────────────────────────────────────────

def harmonize_plan(raw_slides: list[dict], title: str, subtitle: str, slide_cap: int = MAX_SLIDES) -> list[dict]:
    """Validate layouts and enforce the deck rhythm. Pure function; one dict per slide with
    layout/title/brief/sources."""
    slides: list[dict] = []
    for item in raw_slides:
        if not isinstance(item, dict):
            continue
        layout = str(item.get("layout") or "").strip()
        sources = item.get("sources") if isinstance(item.get("sources"), list) else []
        slides.append({
            "layout": layout if layout in LAYOUTS else "title_bullets",
            "title": str(item.get("title") or "").strip()[:140],
            "brief": str(item.get("brief") or item.get("message") or "").strip()[:500],
            "sources": [str(s).strip() for s in sources if str(s).strip()][:8],
        })
    slides = slides[:slide_cap]
    if not slides:
        raise ValueError("Il piano non contiene slide")

    # Cover first (and only one), summary last.
    if slides[0]["layout"] != "cover":
        slides.insert(0, {"layout": "cover", "title": title, "brief": subtitle or "Apertura della presentazione", "sources": []})
    for slide in slides[1:]:
        if slide["layout"] == "cover":
            slide["layout"] = "section"
    if len(slides) >= 5 and slides[-1]["layout"] != "summary":
        if slides[-1]["layout"] in ("title_bullets", "cards", "two_column"):
            slides[-1]["layout"] = "summary"
        elif len(slides) < slide_cap:
            slides.append({"layout": "summary", "title": "In sintesi", "brief": "Riepilogo dei punti chiave", "sources": []})
    slides = slides[:slide_cap]

    # Image budget: images are slow and costly, keep the few the architect found most useful (the first ones).
    seen_images = 0
    for slide in slides:
        if slide["layout"] == "image_split":
            seen_images += 1
            if seen_images > MAX_IMAGE_SLIDES:
                slide["layout"] = "title_bullets"

    # Rhythm: no more than N identical layouts in a row.
    run = 1
    for i in range(1, len(slides)):
        run = run + 1 if slides[i]["layout"] == slides[i - 1]["layout"] else 1
        if run > MAX_SAME_LAYOUT_RUN and slides[i]["layout"] in _VARIETY_SWAPS:
            neighbours = {slides[i - 1]["layout"], slides[i + 1]["layout"] if i + 1 < len(slides) else None}
            replacement = next((c for c in _VARIETY_SWAPS[slides[i]["layout"]] if c not in neighbours), None)
            if replacement:
                slides[i]["layout"] = replacement
                run = 1

    for index, slide in enumerate(slides):
        slide["index"] = index
        if not slide["title"]:
            slide["title"] = f"Slide {index + 1}"
    return slides


def fallback_slide(spec: dict, density: Optional[str]) -> dict:
    """Minimal slide built from the plan when its writer failed twice."""
    layout, title, brief = spec["layout"], spec["title"], spec.get("brief", "")
    raw: dict[str, Any] = {"layout": layout, "title": title}
    if layout in ("cover", "section"):
        raw["subtitle"] = brief
    elif layout == "quote":
        raw["layout"], raw["points"] = "title_bullets", [brief] if brief else []
    elif layout == "big_stat":
        raw["layout"], raw["points"] = "title_bullets", [brief] if brief else []
    else:
        raw["points"] = [brief] if brief else []
    return studio.normalize_slide(raw, density)


# ── Orchestration ────────────────────────────────────────────────────────────

@dataclass
class UsageLog:
    responses: list = field(default_factory=list)

    def add(self, response) -> None:
        self.responses.append(response)

    @property
    def prompt_tokens(self) -> int:
        return sum(int(getattr(r, "prompt_tokens", 0) or 0) for r in self.responses)

    @property
    def completion_tokens(self) -> int:
        return sum(int(getattr(r, "completion_tokens", 0) or 0) for r in self.responses)


# generate(prompt, system, max_tokens, temperature) -> LLMResponse-like (content, tokens, provider, model)
Generate = Callable[..., Awaitable[Any]]


async def _json_call(generate: Generate, usage: UsageLog, prompt: str, system: str, max_tokens: int,
                     attempts: int = 2) -> dict:
    last: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            response = await asyncio.wait_for(
                generate(prompt if attempt == 0 else prompt + "\n\nIMPORTANTE: rispondi esclusivamente con JSON valido e completo, senza testo prima o dopo.",
                         system, max_tokens, 0.5 if attempt == 0 else 0.2),
                timeout=CALL_TIMEOUT,
            )
            usage.add(response)
            parsed = extract_json(response.content)
            if not isinstance(parsed, dict):
                raise ValueError("JSON non è un oggetto")
            return parsed
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last = exc
            logger.warning("Presentation agent call failed (attempt %s): %s", attempt + 1, exc)
    raise last or RuntimeError("chiamata fallita")


async def _text_call(generate: Generate, usage: UsageLog, prompt: str, system: str, max_tokens: int) -> str:
    last: Optional[Exception] = None
    for attempt in range(2):
        try:
            response = await asyncio.wait_for(generate(prompt, system, max_tokens, 0.3), timeout=CALL_TIMEOUT)
            usage.add(response)
            text = (response.content or "").strip()
            if text:
                return text
            raise ValueError("risposta vuota")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last = exc
            logger.warning("Presentation reader call failed (attempt %s): %s", attempt + 1, exc)
    raise last or RuntimeError("chiamata fallita")


async def _drain(queue: "asyncio.Queue[Any]", tasks: list[asyncio.Task], total: int) -> AsyncIterator[Any]:
    """Yield `total` items put on `queue` by `tasks`; cancel the tasks if the consumer goes away."""
    try:
        for _ in range(total):
            yield await queue.get()
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run_create_pipeline(
    brief: dict,
    language: str,
    generate: Generate,
    usage: UsageLog,
    school_grade_instruction: str = "",
) -> AsyncIterator[dict]:
    density = brief.get("density")
    source = str(brief.get("source_text") or "").strip()
    sections = split_source(source)
    section_map = {f"S{i + 1}": text for i, text in enumerate(sections)}
    digested = len(source) > DIRECT_SOURCE_LIMIT
    yield {"type": "phase", "phase": "read", "progress": 0.02,
           "label": f"Leggo il materiale ({len(sections)} sezioni)" if sections else "Preparo la struttura"}

    # 1. Digest (parallel) ───────────────────────────────────────────────────
    plan_sections: list[tuple[str, str]] = [(sid, text) for sid, text in section_map.items()]
    if digested and sections:
        semaphore = asyncio.Semaphore(DIGEST_CONCURRENCY)
        queue: asyncio.Queue = asyncio.Queue()

        async def digest(i: int, sid: str, text: str) -> None:
            async with semaphore:
                try:
                    result = await _text_call(generate, usage, build_digest_prompt(text, i, len(sections), language),
                                              READER_SYSTEM_PROMPT, 700)
                except Exception:
                    result = text[:900]  # keep going with a plain excerpt
                await queue.put((sid, result))

        tasks = [asyncio.create_task(digest(i, sid, text)) for i, (sid, text) in enumerate(section_map.items())]
        digests: dict[str, str] = {}
        async for sid, result in _drain(queue, tasks, len(tasks)):
            digests[sid] = result
            yield {"type": "phase", "phase": "read", "label": f"Leggo il materiale ({len(digests)}/{len(tasks)} sezioni)",
                   "progress": 0.02 + 0.23 * len(digests) / len(tasks)}
        plan_sections = [(sid, digests[sid]) for sid in section_map]

    # 2. Plan ────────────────────────────────────────────────────────────────
    yield {"type": "phase", "phase": "plan", "progress": 0.27, "label": "Progetto struttura e layout delle slide"}
    wanted = int(brief.get("slide_count") or 0)
    plan_tokens = 2500 + 120 * (wanted or 16)
    raw_plan = await _json_call(
        generate, usage,
        build_plan_prompt(brief, plan_sections, digested, language, school_grade_instruction),
        ARCHITECT_SYSTEM_PROMPT, min(plan_tokens, 7000),
    )
    title = str(raw_plan.get("title") or brief.get("topic") or "Presentazione").strip()[:140]
    subtitle = str(raw_plan.get("subtitle") or "").strip()[:200]
    core_message = str(raw_plan.get("core_message") or "").strip()[:300]
    slide_cap = min(MAX_SLIDES, max(3, wanted + 2)) if wanted else MAX_SLIDES

    # 3. Harmonise ───────────────────────────────────────────────────────────
    plan = harmonize_plan(raw_plan.get("slides") if isinstance(raw_plan.get("slides"), list) else [], title, subtitle, slide_cap)
    recommended = []
    for item in raw_plan.get("recommended_templates") or []:
        theme_id = item.get("id") if isinstance(item, dict) else item
        if theme_id in THEMES_BY_ID and theme_id not in [r["id"] for r in recommended]:
            recommended.append({"id": theme_id, "reason": str(item.get("reason") or "")[:200] if isinstance(item, dict) else ""})
    deck = {"title": title, "subtitle": subtitle, "core_message": core_message, "slides": plan}
    yield {"type": "plan", "progress": 0.33, "label": f"Struttura pronta: {len(plan)} slide",
           "title": title, "slides": [{"index": s["index"], "layout": s["layout"], "title": s["title"]} for s in plan]}

    # 4. Write (parallel) ────────────────────────────────────────────────────
    semaphore = asyncio.Semaphore(WRITER_CONCURRENCY)
    queue = asyncio.Queue()
    first_section = next(iter(section_map.values()), "")

    def excerpt_for(spec: dict) -> str:
        chosen = [section_map[s] for s in spec["sources"] if s in section_map]
        if not chosen:
            return first_section[:2500] if spec["layout"] != "cover" and len(section_map) == 1 else ""
        text = "\n\n".join(chosen)
        return text[:WRITER_EXCERPT_CHARS]

    async def write(spec: dict) -> None:
        async with semaphore:
            degraded = False
            try:
                candidate = await _json_call(
                    generate, usage,
                    build_writer_prompt(brief, deck, spec, spec["index"], excerpt_for(spec), language, school_grade_instruction),
                    WRITER_SYSTEM_PROMPT, 1800,
                )
                candidate["layout"] = spec["layout"]
                if not str(candidate.get("title") or "").strip():
                    candidate["title"] = spec["title"]
                slide = studio.normalize_slide(candidate, density)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Presentation writer failed for slide %s", spec["index"])
                slide, degraded = fallback_slide(spec, density), True
            await queue.put((spec["index"], slide, degraded))

    tasks = [asyncio.create_task(write(spec)) for spec in plan]
    written: dict[int, dict] = {}
    degraded_count = 0
    async for index, slide, degraded in _drain(queue, tasks, len(tasks)):
        written[index] = slide
        degraded_count += int(degraded)
        yield {"type": "slide", "index": index, "slide": slide, "degraded": degraded,
               "label": f"Scrivo le slide ({len(written)}/{len(plan)})",
               "progress": 0.33 + 0.64 * len(written) / len(plan)}

    # 5. Assemble ────────────────────────────────────────────────────────────
    slides = [written[i] for i in range(len(plan))]
    outline = studio.normalize_outline({
        "title": title, "subtitle": subtitle, "audience": raw_plan.get("audience") or brief.get("audience"),
        "core_message": core_message, "recommended_templates": recommended, "slides": slides,
    }, "dettagliata")  # slides are already density-trimmed: don't trim twice
    yield {"type": "done", "progress": 1.0, "outline": outline, "degraded": degraded_count}


async def run_revise(
    brief: dict, previous: dict, instruction: str, language: str, generate: Generate, usage: UsageLog,
    school_grade_instruction: str = "",
) -> AsyncIterator[dict]:
    yield {"type": "phase", "phase": "revise", "progress": 0.1, "label": "Applico le modifiche alla scaletta"}
    prompt = studio.build_revise_prompt(brief, previous, instruction, language, school_grade_instruction)
    candidate = await _json_call(generate, usage, prompt, studio.OUTLINE_SYSTEM_PROMPT, 9000)
    outline = studio.normalize_outline(candidate, brief.get("density"), previous)
    yield {"type": "done", "progress": 1.0, "outline": outline, "degraded": 0}


def event_line(event: dict) -> bytes:
    return (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")
