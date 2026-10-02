"""Chunked editing of large text documents for Document Builder.

A single LLM call cannot rewrite a long document: the whole text must fit both in the prompt and
in the (much smaller) output budget. Instead the document HTML is split on top-level blocks into
chunks of bounded size, each chunk is edited independently with the same instruction, and the
results are concatenated. Embedded base64 images are swapped for short placeholders first, so they
neither burn tokens nor get mangled by the model.
"""
import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

import nh3
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Size of one chunk sent to the model (characters of HTML / text, after image protection).
CHUNK_MAX_CHARS = 9000
# Hard ceiling on the whole document. ~60 chunks keeps latency and cost bounded.
DOCUMENT_MAX_CHARS = 540_000
MAX_CONCURRENCY = 3

_DATA_URI_RE = re.compile(r'(src\s*=\s*")(data:[^"]*)(")', re.IGNORECASE)

_DOC_TAGS = {
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "strike", "span",
    "br", "hr", "ul", "ol", "li", "blockquote", "pre", "code", "sub", "sup", "mark", "a", "img",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col", "div",
}
_DOC_ATTRIBUTES = {
    "*": {"style", "class", "data-type", "data-latex", "data-page-break"},
    "a": {"href", "title", "target"},
    "img": {"src", "alt", "title", "width", "height"},
    "td": {"colspan", "rowspan", "colwidth"},
    "th": {"colspan", "rowspan", "colwidth"},
    "col": {"span", "width"},
    "ol": {"start", "type"},
}
_DOC_STYLE_PROPERTIES = {
    "color", "background-color", "font-family", "font-size", "font-weight", "font-style",
    "text-decoration", "text-align", "line-height", "text-indent", "letter-spacing",
    "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
    "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
    "border", "border-top", "border-bottom", "border-left", "border-right", "border-collapse",
    "border-color", "border-width", "border-style", "width", "min-width", "height", "vertical-align",
    "list-style-type",
}
_STYLE_ATTR_RE = re.compile(r'style="([^"]*)"')
_UNSAFE_STYLE_VALUE_RE = re.compile(r"url\s*\(|expression\s*\(|javascript:|@import", re.IGNORECASE)


def _clean_style(style: str) -> str:
    declarations = []
    for declaration in style.split(";"):
        prop, sep, value = declaration.partition(":")
        prop, value = prop.strip().lower(), value.strip()
        if sep and prop in _DOC_STYLE_PROPERTIES and value and not _UNSAFE_STYLE_VALUE_RE.search(value):
            declarations.append(f"{prop}: {value}")
    return "; ".join(declarations)


def sanitize_document_html(raw: str) -> str:
    """Allowlist sanitization for word-processor HTML (richer than the slide text allowlist)."""
    cleaned = nh3.clean(
        raw or "",
        tags=_DOC_TAGS,
        attributes=_DOC_ATTRIBUTES,
        url_schemes={"http", "https", "mailto", "data"},
        strip_comments=True,
    )

    def _replace(match: "re.Match[str]") -> str:
        safe = _clean_style(match.group(1))
        return f'style="{safe}"' if safe else ""

    return _STYLE_ATTR_RE.sub(_replace, cleaned)


def protect_images(html: str) -> tuple[str, dict[str, str]]:
    """Replace inline data: URIs with short tokens; returns (html, token -> original src)."""
    originals: dict[str, str] = {}

    def _swap(match: "re.Match[str]") -> str:
        token = f"__IMG_{len(originals)}__"
        originals[token] = match.group(2)
        return f"{match.group(1)}{token}{match.group(3)}"

    return _DATA_URI_RE.sub(_swap, html), originals


def restore_images(html: str, originals: dict[str, str]) -> str:
    for token, src in originals.items():
        html = html.replace(token, src)
    return html


def split_html_blocks(html: str, max_chars: int = CHUNK_MAX_CHARS) -> list[str]:
    """Group top-level blocks into chunks of at most ``max_chars`` (an oversized block stays alone)."""
    soup = BeautifulSoup(html or "", "html.parser")
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for node in soup.contents:
        piece = str(node)
        if not piece.strip():
            continue
        if current and size + len(piece) > max_chars:
            chunks.append("".join(current))
            current, size = [], 0
        current.append(piece)
        size += len(piece)
    if current:
        chunks.append("".join(current))
    return chunks


def split_text_blocks(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list[str]:
    """Same grouping for plain text, cutting only on line breaks (long lines are cut on spaces)."""
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for line in (text or "").split("\n"):
        while len(line) > max_chars:
            cut = line.rfind(" ", 0, max_chars)
            cut = cut if cut > max_chars // 2 else max_chars
            head, line = line[:cut], line[cut:].lstrip(" ")
            if current:
                chunks.append("\n".join(current))
                current, size = [], 0
            chunks.append(head)
        if current and size + len(line) + 1 > max_chars:
            chunks.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        chunks.append("\n".join(current))
    return chunks


def strip_code_fence(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


@dataclass
class ChunkedEditResult:
    text: str
    chunks: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    responses: list[Any] = field(default_factory=list)


GenerateFn = Callable[..., Awaitable[Any]]


async def edit_chunks(
    chunks: list[str],
    *,
    instruction: str,
    mode: str,
    generate: GenerateFn,
    language: str,
    document_title: str = "",
    scope_label: str = "documento",
    provider: Optional[str] = None,
    model: Optional[str] = None,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> ChunkedEditResult:
    """Edit every chunk with the same instruction and join the results in order.

    ``mode`` is ``html`` (document fragments) or ``text`` (a plain-text selection).
    Raises ValueError when any chunk comes back empty or cut off by the output limit.
    """
    total = len(chunks)
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    done = 0
    format_rule = (
        "Restituisci SOLO l'HTML del frammento (stessi tag e struttura, stili inline compresi, salvo ciò che "
        "l'istruzione chiede di cambiare). Conserva intatti attributi, tabelle, immagini (src con segnaposto "
        "__IMG_n__), formule e link. Non aggiungere <html>/<body>, commenti o Markdown."
        if mode == "html"
        else "Restituisci SOLO il testo sostitutivo, senza virgolette, commenti o Markdown, mantenendo gli a capo."
    )
    system_prompt = (
        "Sei Document Builder, assistente per un editor di testi didattico. Ricevi un frammento di un "
        "documento più lungo e applichi l'istruzione dell'utente SOLO a quel frammento, in modo coerente con "
        "gli altri frammenti (stessa lingua, tono e convenzioni di formattazione). Non riassumere né tagliare "
        "contenuto che l'istruzione non chiede di rimuovere. " + format_rule
    )

    async def run(index: int, chunk: str) -> tuple[str, Any]:
        nonlocal done
        # ~1 token / 3 chars, plus headroom for markup added by the edit; capped by provider limits.
        max_tokens = min(16000, max(2000, int(len(chunk) / 2.2) + 1200))
        user_prompt = (
            f"Lingua interfaccia: {language}\nDocumento: {document_title or 'senza titolo'}\n"
            f"Ambito: {scope_label} — frammento {index + 1} di {total}\n\n"
            f"Istruzione utente:\n{instruction}\n\nFrammento:\n{chunk}"
        )
        async with semaphore:
            response = await generate(
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                provider=provider,
                model=model,
                temperature=0.2,
                max_tokens=max_tokens,
                allow_web_search=False,
            )
        out = strip_code_fence(response.content)
        if not out:
            raise ValueError("Il modello non ha restituito testo per una parte del documento")
        if response.completion_tokens >= max_tokens - 8:
            logger.warning("Document chunk %s/%s hit the output limit (%s tokens)", index + 1, total, max_tokens)
            raise ValueError("Una parte del documento è troppo lunga per essere modificata in un solo passaggio: riprova selezionando una porzione più piccola")
        done += 1
        if on_progress:
            on_progress(done, total)
        return out, response

    results = await asyncio.gather(*(run(i, c) for i, c in enumerate(chunks)))
    separator = "" if mode == "html" else "\n"
    return ChunkedEditResult(
        text=separator.join(text for text, _ in results),
        chunks=total,
        prompt_tokens=sum(r.prompt_tokens for _, r in results),
        completion_tokens=sum(r.completion_tokens for _, r in results),
        responses=[r for _, r in results],
    )


# --- Interpretation ("plan") step ------------------------------------------------------------------
# Before touching the document the agent states what it understood; the user confirms. Formatting
# requests are translated into a small set of deterministic operations executed by the client.

PLAN_SYSTEM_PROMPT = """Sei Document Builder, co-autore e assistente di un editor di testi didattico. L'utente chiede qualcosa sul documento. \
NON modificare nulla ora: interpreta la richiesta nel contesto del documento e restituisci un piano.

Rispondi SOLO con un oggetto JSON valido, senza Markdown:
{"understanding":"1-3 frasi in italiano, concrete: cosa farai (con valori/lunghezza/posizione) e cosa NON toccherai","approach":"format|write|rewrite|ask","question":"solo se approach=ask","operations":[...],"write":{...}}

SCEGLI L'APPROCCIO
- format: cambia solo l'aspetto (spaziatura, interlinea, rientri, font, colore, titoli, righe vuote), mai le parole.
- write: PRODUCE TESTO NUOVO o ne aggiunge molto. Usalo per: espandere/ampliare/sviluppare/approfondire/arricchire/allungare/dettagliare/"scrivi di più"; continuare/proseguire/completare/finire/"vai avanti"/"scrivi il resto"; scrivere una bozza, una sezione, un'introduzione, una conclusione, un paragrafo, esempi, un riassunto breve da inserire; sintetizzare/riassumere.
  Se il documento ha un titolo e magari un incipit ma poco altro, e la richiesta è generica ("scrivi", "completa", "sviluppa"), tratta l'incipit come STIMOLO: il compito è sviluppare il documento (task draft), non chiudere la frase.
- rewrite: cambia le parole di un testo già scritto SENZA aggiungere molto contenuto: correggere, riformulare, tradurre, semplificare, cambiare tono/registro, accorciare leggermente.
- ask: solo se due letture darebbero risultati molto diversi. UNA domanda breve con le alternative.

CAMPO "write" (solo se approach=write):
{"task":"expand|continue|draft|insert|summarize","placement":"replace_selection|after_selection|at_cursor|end_of_document","target_words":N,"tone":"breve descrizione del registro da mantenere","structure":"paragraphs|sections|list|auto","merge_first_paragraph":true|false}
- expand: sviluppa il testo selezionato (placement replace_selection). target_words = 2–3 volte le parole della selezione (almeno +80), salvo diversa richiesta ("il doppio", "una pagina" ≈ 450).
- continue: prosegue da dove il testo si interrompe (at_cursor se c'è un cursore, altrimenti end_of_document). merge_first_paragraph=true se l'ultimo paragrafo prima del cursore è incompleto (non finisce con . ! ? : o è un incipit da proseguire).
- draft: sviluppa il documento/sezione da titolo e incipit (end_of_document o at_cursor). Documento lungo ⇒ structure sections con sottotitoli.
- insert: inserisce una parte nuova richiesta (introduzione → at_cursor o inizio; conclusione → end_of_document).
- summarize: riassume la selezione (replace_selection) o il documento (after_selection/end_of_document).
Lunghezze di riferimento se non indicate: una frase 25, un paragrafo 110, "più testo" 200–300, una sezione 300–400, una pagina 450, bozza completa 600–900 (max 2000).
Usa stat.cursor_at_end, stat.has_selection, stat.selection_words, stat.words, stat.outline, stat.last_block per decidere. Rispetta lingua, registro e livello del testo esistente.

VOCABOLARIO DI FORMATTAZIONE (per approach=format, sono cose diverse):
- "spaziatura/spazio tra i paragrafi" = space_after_px (tipico 8-14). NON è l'interlinea.
- "interlinea", "righe più larghe/strette" = line_height (1.0-2.0).
- "rientro", "indentazione", "capoverso" = text_indent_px (24-36).
- righe vuote usate come distanza → normalize_spacing. capitoli/titoli da riconoscere → detect_structure. rientri a mano → smart_indent.
- carattere, dimensione, colore, grassetto, corsivo → text_style. allineamento → paragraph_format.text_align.
OPERAZIONI (solo per format; campi opzionali tranne op). target: paragraphs|headings|h1|h2|h3|all (default all).
{"op":"paragraph_format","target":"paragraphs","space_before_px":0,"space_after_px":12,"line_height":1.5,"text_indent_px":28,"text_align":"left|center|right|justify"}
{"op":"text_style","target":"all","font_family":"Georgia","font_size_pt":12,"color":"#111111","bold":true,"italic":false}
{"op":"normalize_spacing","gap_px":14}
{"op":"detect_structure"}
{"op":"smart_indent","indent_px":28,"skip_after_heading":true}
Se stat.scope è "selection" le operazioni valgono per la selezione. Nell'understanding cita valori e posizione (es. «Sviluppo il paragrafo selezionato da 40 a circa 120 parole, mantenendo il tono formale»)."""

_TARGETS = {"paragraphs", "headings", "h1", "h2", "h3", "all"}
_ALIGNS = {"left", "center", "right", "justify"}
_COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|rgba?\([\d\s.,%]+\))$")
_FONT_RE = re.compile(r"^[\w\s\-.,'\"]{1,60}$")


def _num(value: Any, low: float, high: float) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(low, min(high, number))


def sanitize_operations(raw: Any) -> list[dict]:
    """Validate/clamp the model's operations so the client only ever receives well-formed ones."""
    result: list[dict] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        op = item.get("op")
        target = item.get("target") if item.get("target") in _TARGETS else "all"
        if op == "paragraph_format":
            clean: dict = {"op": op, "target": target}
            for key, low, high in (("space_before_px", 0, 120), ("space_after_px", 0, 120), ("line_height", 0.8, 3), ("text_indent_px", 0, 160)):
                value = _num(item.get(key), low, high)
                if value is not None:
                    clean[key] = value
            if item.get("text_align") in _ALIGNS:
                clean["text_align"] = item["text_align"]
            if len(clean) > 2:
                result.append(clean)
        elif op == "text_style":
            clean = {"op": op, "target": target}
            family = item.get("font_family")
            if isinstance(family, str) and _FONT_RE.match(family):
                clean["font_family"] = family.strip()
            size = _num(item.get("font_size_pt"), 6, 96)
            if size is not None:
                clean["font_size_pt"] = size
            color = item.get("color")
            if isinstance(color, str) and _COLOR_RE.match(color.strip()):
                clean["color"] = color.strip()
            for flag in ("bold", "italic"):
                if isinstance(item.get(flag), bool):
                    clean[flag] = item[flag]
            if len(clean) > 2:
                result.append(clean)
        elif op == "normalize_spacing":
            result.append({"op": op, "gap_px": _num(item.get("gap_px"), 4, 48) or 14})
        elif op == "detect_structure":
            result.append({"op": op})
        elif op == "smart_indent":
            result.append({"op": op, "indent_px": _num(item.get("indent_px"), 8, 120) or 28, "skip_after_heading": item.get("skip_after_heading") is not False})
    return result[:8]


_WRITE_TASKS = {"expand", "continue", "draft", "insert", "summarize"}
_PLACEMENTS = {"replace_selection", "after_selection", "at_cursor", "end_of_document"}
_STRUCTURES = {"paragraphs", "sections", "list", "auto"}


def sanitize_write_spec(raw: Any, *, has_selection: bool) -> dict:
    """Validate the planner's ``write`` spec; falls back to safe defaults."""
    value = raw if isinstance(raw, dict) else {}
    task = value.get("task") if value.get("task") in _WRITE_TASKS else "continue"
    placement = value.get("placement") if value.get("placement") in _PLACEMENTS else (
        "replace_selection" if has_selection and task in {"expand", "summarize"} else "at_cursor"
    )
    if placement in {"replace_selection", "after_selection"} and not has_selection:
        placement = "at_cursor"
    words = _num(value.get("target_words"), 20, 2500)
    return {
        "task": task,
        "placement": placement,
        "target_words": int(words) if words else {"expand": 200, "continue": 180, "draft": 600, "insert": 250, "summarize": 80}[task],
        "tone": str(value.get("tone") or "")[:160],
        "structure": value.get("structure") if value.get("structure") in _STRUCTURES else "auto",
        "merge_first_paragraph": value.get("merge_first_paragraph") is True,
    }


# --- Writing ("vibe writing") --------------------------------------------------------------------

WRITE_SYSTEM_PROMPT = """Sei Document Builder, co-autore di un editor di testi didattico. Scrivi testo PRONTO DA INSERIRE nel documento dell'utente.

Regole di scrittura
- Scrivi nella stessa lingua, persona, registro, lessico e livello del testo esistente; se è breve o assente, deduci dal titolo e dall'istruzione. Il testo deve sembrare scritto dalla stessa mano.
- Collega il nuovo testo a quello che c'è prima e dopo: niente ripetizioni di ciò che è già scritto, niente ripartenze («In questo documento…») se non servono, transizioni naturali.
- Sviluppa davvero: concetti, spiegazioni, esempi concreti, collegamenti, non frasi generiche. Rispetta la lunghezza obiettivo (±15%).
- Non inventare dati precisi, date, statistiche, citazioni o fonti che non sono nel documento: se servono, resta generale o formula in modo prudente.
- Output SOLO HTML pulito: <p>, <h2>/<h3> (mai <h1>; il livello sotto l'ultimo titolo che precede), <ul>/<ol>/<li>, <strong>, <em>, <u>, <blockquote>. Nessun Markdown, nessun blocco di codice, nessun commento o meta-testo («Ecco…»), nessun segnaposto.
- Mantieni la struttura del documento: se il testo esistente è fatto di paragrafi, non introdurre elenchi puntati a caso; usa sottotitoli solo se il documento ne ha o se la parte è lunga."""

_OUTLINE_PROMPT = """Pianifica le sezioni di un testo da scrivere. Rispondi SOLO con JSON valido:
{"sections":[{"heading":"titolo sezione","points":["punto chiave 1","punto chiave 2"],"words":N}]}
Da 3 a 7 sezioni, coerenti con titolo e testo esistente, senza ripetere ciò che c'è già; la somma di "words" ≈ lunghezza obiettivo."""


def plain_words(html: str) -> int:
    text = re.sub(r"<[^>]+>", " ", html or "")
    return len([word for word in re.split(r"\s+", text) if word])


def _context_block(context: dict) -> str:
    outline = context.get("outline") if isinstance(context.get("outline"), list) else []
    outline_text = "\n".join(
        f"{'  ' * (max(1, int(item.get('level') or 1)) - 1)}- {str(item.get('text') or '')[:120]}"
        for item in outline[:60]
        if isinstance(item, dict)
    )
    parts = [f"TITOLO DEL DOCUMENTO: {str(context.get('title') or 'senza titolo')[:200]}"]
    if outline_text:
        parts.append(f"STRUTTURA (titoli esistenti):\n{outline_text}")
    before = str(context.get("before") or "")[-7000:]
    after = str(context.get("after") or "")[:1500]
    if before.strip():
        parts.append(f"TESTO PRECEDENTE (fino al punto di inserimento):\n{before}")
    else:
        parts.append("TESTO PRECEDENTE: (nessuno: è l'inizio del documento)")
    if after.strip():
        parts.append(f"TESTO SEGUENTE (dopo il punto di inserimento):\n{after}")
    selection = str(context.get("selection") or "")[:6000]
    if selection.strip():
        parts.append(f"TESTO SELEZIONATO:\n{selection}")
    return "\n\n".join(parts)


@dataclass
class WriteResult:
    html: str
    words: int
    steps: list[str] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    responses: list[Any] = field(default_factory=list)

    def add(self, response: Any) -> None:
        self.responses.append(response)
        self.prompt_tokens += response.prompt_tokens
        self.completion_tokens += response.completion_tokens


def _task_brief(spec: dict, merge: bool) -> str:
    placement = {
        "replace_selection": "Il tuo testo SOSTITUISCE il testo selezionato: deve contenerne e sviluppare le idee, non solo aggiungerle.",
        "after_selection": "Il tuo testo viene inserito subito DOPO la selezione.",
        "at_cursor": "Il tuo testo viene inserito nel punto del cursore, tra TESTO PRECEDENTE e TESTO SEGUENTE.",
        "end_of_document": "Il tuo testo viene aggiunto IN FONDO al documento.",
    }[spec["placement"]]
    task = {
        "expand": "Espandi e approfondisci",
        "continue": "Prosegui il testo da dove si interrompe",
        "draft": "Sviluppa il documento a partire da titolo e incipit",
        "insert": "Scrivi la parte richiesta",
        "summarize": "Sintetizza",
    }[spec["task"]]
    extra = ""
    if merge:
        extra = " Il primo paragrafo CONTINUA direttamente la frase interrotta (non ripeterne l'inizio, non aprire con maiuscola se la frase è a metà)."
    return f"COMPITO: {task}. {placement}{extra} Lunghezza obiettivo: circa {spec['target_words']} parole. Struttura: {spec['structure']}. Registro: {spec['tone'] or 'come il testo esistente'}."


async def write_text(
    *,
    generate: GenerateFn,
    instruction: str,
    understanding: str,
    spec: dict,
    context: dict,
    language: str,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    previous_draft: str = "",
) -> WriteResult:
    """Agentic text production: (outline →) draft → length check → one extension pass."""
    result = WriteResult(html="", words=0)
    target = int(spec["target_words"])
    merge = bool(spec.get("merge_first_paragraph"))
    base_context = _context_block(context)
    brief = _task_brief(spec, merge)
    header = (
        f"Lingua interfaccia: {language}\n\n{base_context}\n\nISTRUZIONE DELL'UTENTE:\n{instruction}\n"
        f"INTERPRETAZIONE CONFERMATA: {understanding}\n\n{brief}"
    )

    async def call(prompt: str, max_words: int, system: str = WRITE_SYSTEM_PROMPT, temperature: float = 0.6) -> str:
        max_tokens = min(16000, int(max_words * 2.4) + 600)
        response = await generate(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=system,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            allow_web_search=False,
        )
        result.add(response)
        out = strip_code_fence(response.content)
        if not out:
            raise ValueError("Il modello non ha restituito testo")
        if response.completion_tokens >= max_tokens - 8:
            raise ValueError("Il testo generato è stato interrotto: chiedi una parte più breve o più mirata")
        return out

    if previous_draft.strip():
        # Refinement of a proposal the user has already seen ("più lungo", "più formale", …).
        result.steps.append("Rielaboro la bozza precedente secondo la tua richiesta")
        html = await call(f"{header}\n\nBOZZA PRECEDENTE DA MODIFICARE:\n{previous_draft[:20000]}\n\nApplica l'istruzione alla bozza e restituisci la versione completa aggiornata.", target)
    elif target >= 700 and spec["task"] in {"draft", "insert", "expand"}:
        result.steps.append("Pianifico le sezioni prima di scrivere")
        outline_raw = await call(f"{header}\n\nPianifica ora le sezioni.", 400, system=_OUTLINE_PROMPT, temperature=0.3)
        try:
            sections = json.loads(outline_raw[outline_raw.index("{"): outline_raw.rindex("}") + 1]).get("sections") or []
        except (ValueError, json.JSONDecodeError):
            sections = []
        sections = [item for item in sections if isinstance(item, dict) and str(item.get("heading") or "").strip()][:7]
        if len(sections) < 2:
            html = await call(header, target)
        else:
            written: list[str] = []
            outline_text = "\n".join(f"{n}. {str(item['heading'])[:100]} — " + "; ".join(str(point)[:100] for point in (item.get("points") or [])[:5]) for n, item in enumerate(sections, 1))
            for n, item in enumerate(sections, 1):
                words = int(_num(item.get("words"), 60, 600) or max(80, target // len(sections)))
                result.steps.append(f"Scrivo la sezione {n}/{len(sections)}: {str(item['heading'])[:60]}")
                tail = re.sub(r"<[^>]+>", " ", " ".join(written))[-1800:]
                written.append(await call(
                    f"{header}\n\nSCALETTA COMPLETA:\n{outline_text}\n\nSEZIONI GIÀ SCRITTE (ultime righe): {tail or '(nessuna)'}\n\n"
                    f"Scrivi SOLO la sezione {n}: «{item['heading']}», con titolo <h2> e ~{words} parole, senza ripetere le altre sezioni.",
                    words,
                ))
            html = "".join(written)
    else:
        result.steps.append("Scrivo la bozza usando titolo, struttura e testo circostante")
        html = await call(header, target)

    words = plain_words(html)
    # Length check: an "expand"/"draft"/"continue" that came back far too short is extended once.
    if not previous_draft.strip() and spec["task"] in {"expand", "continue", "draft", "insert"} and words < target * 0.6 and target >= 80:
        result.steps.append(f"Il testo ({words} parole) è più corto dell'obiettivo ({target}): lo sviluppo ulteriormente")
        html = await call(
            f"{header}\n\nBOZZA ATTUALE ({words} parole, TROPPO BREVE):\n{html}\n\n"
            f"Riscrivi la bozza completa portandola a circa {target} parole: aggiungi spiegazioni, esempi concreti e collegamenti invece di ripetere. Restituisci l'intera versione.",
            target,
        )
        words = plain_words(html)
    result.html = html
    result.words = words
    return result
