"""Readable transcripts: a light model rewrites the word-for-word speech-to-text of each turn.

Whisper gives exactly what was said ("allora, diciamo, no, cioè, la… la lezione di oggi"). Teachers want clean text:
fillers and false starts removed, complete sentences, correct punctuation. The original wording is kept in ``raw``
on every line, so nothing is lost. Any failure leaves the original text in place: the transcript is never blocked.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

from app.models.user import User
from app.services import model_roles

logger = logging.getLogger(__name__)

CHUNK_CHARS = 4500
PART_CHARS = 2200
CONCURRENCY = 3
MIN_CHARS = 25  # shorter turns ("sì", "ok grazie") are left alone

SYSTEM = (
    "Sei un revisore di trascrizioni di parlato italiano. Ricevi turni numerati, ognuno nel formato «[n] testo», "
    "ottenuti da un riconoscimento vocale parola per parola. Riscrivi ogni turno in un italiano pulito e leggibile, "
    "restando FEDELE al significato e senza aggiungere nulla che non sia stato detto:\n"
    "- togli intercalari e riempitivi (allora, diciamo, cioè, no?, ecco, praticamente, eh, ehm, quindi…, infatti usato a vuoto), "
    "ripetizioni, false partenze e balbettii;\n"
    "- costruisci frasi di senso compiuto con punteggiatura e maiuscole corrette;\n"
    "- se il turno è lungo vai a capo con una riga vuota tra un argomento e l'altro;\n"
    "- correggi i termini storpiati dal riconoscimento solo quando il contesto lo rende ovvio; mantieni nomi, numeri e termini tecnici;\n"
    "- non riassumere, non commentare, non tradurre: lingua e contenuto restano quelli del parlato.\n"
    "Rispondi SOLO con i turni riscritti, ognuno preceduto dallo stesso numero «[n]», nello stesso ordine."
)

_ITEM = re.compile(r"^\[(\d+)\]\s*", re.M)


def _split_long(text: str) -> list[str]:
    """Cut an over-long turn at sentence ends so each model call stays small."""
    if len(text) <= PART_CHARS:
        return [text]
    parts, current = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if current and len(current) + len(sentence) > PART_CHARS:
            parts.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    if current:
        parts.append(current)
    return parts


def _parse(answer: str) -> dict[int, str]:
    marks = list(_ITEM.finditer(answer))
    out: dict[int, str] = {}
    for i, mark in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(answer)
        out[int(mark.group(1))] = answer[mark.end():end].strip()
    return out


def _sane(original: str, cleaned: str) -> bool:
    """Reject empty answers and ones that are far shorter/longer than the speech (summaries, hallucinations)."""
    if not cleaned:
        return False
    ratio = len(cleaned) / max(1, len(original))
    return 0.25 <= ratio <= 1.5


async def clean_lines(db, lines: list[dict], teacher: Optional[User]) -> int:
    """Rewrites ``line['text']`` in place (original in ``line['raw']``). Returns how many lines were cleaned."""
    from app.services.call_recordings import _charge
    from app.services.credit_service import credit_service
    from app.services.llm_service import llm_service

    provider, model = model_roles.pair_for("chat.fast")
    # (line index, part index) → numbered work items
    items: list[tuple[int, int, str]] = []
    pieces: dict[int, list[str]] = {}
    for index, line in enumerate(lines):
        text = (line.get("text") or "").strip()
        if len(text) < MIN_CHARS:
            continue
        parts = _split_long(text)
        pieces[index] = [""] * len(parts)
        items.extend((index, part, chunk) for part, chunk in enumerate(parts))

    chunks: list[list[tuple[int, int, str]]] = []
    current: list[tuple[int, int, str]] = []
    size = 0
    for item in items:
        if current and size + len(item[2]) > CHUNK_CHARS:
            chunks.append(current)
            current, size = [], 0
        current.append(item)
        size += len(item[2])
    if current:
        chunks.append(current)

    semaphore = asyncio.Semaphore(CONCURRENCY)
    usage = {"prompt": 0, "completion": 0}

    async def run(chunk: list[tuple[int, int, str]]) -> None:
        body = "\n\n".join(f"[{n}] {text}" for n, (_, _, text) in enumerate(chunk, 1))
        async with semaphore:
            try:
                response = await llm_service.generate(
                    messages=[{"role": "user", "content": body}], system_prompt=SYSTEM,
                    provider=provider, model=model, temperature=0.2,
                    max_tokens=min(8000, int(len(body) / 2) + 800), allow_web_search=False)
            except Exception as exc:
                logger.warning("transcript cleanup chunk failed: %s", exc)
                return
        usage["prompt"] += int(response.prompt_tokens or 0)
        usage["completion"] += int(response.completion_tokens or 0)
        answer = _parse(response.content or "")
        for n, (index, part, text) in enumerate(chunk, 1):
            cleaned = answer.get(n, "")
            if _sane(text, cleaned):
                pieces[index][part] = cleaned

    await asyncio.gather(*(run(chunk) for chunk in chunks))

    changed = 0
    for index, parts in pieces.items():
        original = lines[index]["text"]
        if not all(parts):  # a part failed: keep the whole turn as spoken rather than a patchwork
            continue
        lines[index]["raw"] = original
        lines[index]["text"] = "\n\n".join(parts) if len(parts) > 1 else parts[0]
        changed += 1

    if usage["prompt"] or usage["completion"]:
        try:
            cost = credit_service.calculate_cost_for_model(provider, model, usage["prompt"], usage["completion"], 0)
            await _charge(db, teacher, provider, model, cost, {
                "prompt_tokens": usage["prompt"], "completion_tokens": usage["completion"],
                "total_tokens": usage["prompt"] + usage["completion"], "type": "call_recording:cleanup"})
        except Exception:
            logger.exception("transcript cleanup cost tracking failed")
    return changed
