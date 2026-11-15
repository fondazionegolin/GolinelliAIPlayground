"""Vibe Lab brief hardening.

The brief (description.md + spec.md) is the contract every generation must follow. These helpers guarantee that:
  * a project NEVER starts without a substantive description.md (the user's own words are always in it);
  * spec.md survives across versions even if the client forgets to send it;
  * the interview never repeats a question;
  * a failed spec call degrades to a deterministic spec instead of blocking the build.

Pure functions only (no DB, no LLM) so they are cheap to unit test.
"""
from __future__ import annotations

import re

BRIEF_PATHS = ("description.md", "spec.md")
PLACEHOLDER_MARKERS = ("Descrivi qui l'obiettivo", "Descrivi qui obiettivo")
MIN_INSTRUCTION_CHARS = 60
REQUEST_LOG_HEADING = "## Richieste"
INSTRUCTIONS_HEADING = "## Istruzioni di progetto"

_WORD = re.compile(r"[a-zàèéìòù0-9]{3,}", re.IGNORECASE)
_STOP = {
    "che", "per", "con", "una", "uno", "dei", "del", "della", "delle", "degli", "nel", "nella", "sono", "come",
    "quale", "quali", "vuoi", "vorresti", "hai", "hanno", "alla", "alle", "agli", "sul", "sulla", "tra", "fra",
    "questo", "questa", "queste", "questi", "piu", "più", "anche", "essere", "fare", "tuo", "tua", "tuoi",
}


def _words(text: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(text or "") if w.lower() not in _STOP}


def question_repeats(question: str, previous_questions: list[str], threshold: float = 0.55) -> bool:
    """True when `question` says (nearly) the same as an already asked one (word-set overlap)."""
    new = _words(question)
    if not new:
        return False
    for old_text in previous_questions:
        old = _words(old_text)
        if not old:
            continue
        overlap = len(new & old)
        if overlap >= 2 and overlap / max(1, min(len(new), len(old))) >= 0.66:
            return True
        if overlap / max(1, len(new | old)) >= threshold:
            return True
    return False


def _section(text: str, heading: str) -> str:
    """Body of `## heading` up to the next `## ` heading ('' when absent)."""
    match = re.search(rf"^{re.escape(heading)}\s*$", text or "", re.MULTILINE)
    if not match:
        return ""
    rest = text[match.end():]
    nxt = re.search(r"^## ", rest, re.MULTILINE)
    return (rest[: nxt.start()] if nxt else rest).strip()


def instructions_of(description_md: str) -> str:
    """The user-authored instructions inside description.md, without boilerplate/placeholder lines."""
    body = _section(description_md, INSTRUCTIONS_HEADING)
    lines = [
        line for line in body.splitlines()
        if line.strip() and not line.startswith("Queste istruzioni vengono passate")
        and not any(marker in line for marker in PLACEHOLDER_MARKERS)
    ]
    return "\n".join(lines).strip()


def build_description_md(title: str, instructions: str, requests_log: str = "") -> str:
    log = (requests_log or "").strip()
    return (
        f"# {title or 'Progetto'}\n\n"
        f"{INSTRUCTIONS_HEADING}\n"
        "Queste istruzioni vengono passate all'AI a ogni generazione. Modificale liberamente.\n\n"
        f"{instructions.strip()}\n\n"
        f"{REQUEST_LOG_HEADING}\n"
        + (log + "\n" if log else "")
    )


def ensure_brief_files(
    kb_files: list[dict],
    *,
    title: str,
    original_prompt: str,
    history_files: list[list[dict]] | None = None,
    fallback_prompt: str = "",
) -> tuple[list[dict], list[str]]:
    """Return (kb_files with a guaranteed brief, notes about what was repaired).

    - spec.md missing  -> recovered from the newest version that has it.
    - description.md missing, empty or still the placeholder -> rebuilt from the project's ORIGINAL prompt
      (the first thing the user wrote), keeping any request log already accumulated.
    """
    notes: list[str] = []
    out = [dict(f) for f in kb_files]
    by_path = {str(f.get("path") or "").lower(): f for f in out}

    for path in BRIEF_PATHS:
        if path in by_path and str(by_path[path].get("content") or "").strip():
            continue
        for files in history_files or []:
            hit = next((f for f in files if str(f.get("path") or "").lower() == path and str(f.get("content") or "").strip()), None)
            if hit:
                if path in by_path:
                    by_path[path]["content"] = hit.get("content")
                else:
                    out.append({"path": hit.get("path"), "language": "markdown", "content": hit.get("content")})
                    by_path[path] = out[-1]
                notes.append(f"{path} recuperato dalla cronologia del progetto")
                break

    desc = by_path.get("description.md")
    current = str(desc.get("content") or "") if desc else ""
    cur_instr = instructions_of(current)
    if len(cur_instr) < MIN_INSTRUCTION_CHARS:
        source = (original_prompt or "").strip() or (fallback_prompt or "").strip()
        spec_text = str((by_path.get("spec.md") or {}).get("content") or "")
        if len(source) < MIN_INSTRUCTION_CHARS and spec_text:
            goal = _section(spec_text, "## Obiettivo e pubblico") or spec_text[:1500]
            source = (source + "\n\n" + goal).strip()
        if source and len(source) > len(cur_instr):
            rebuilt = build_description_md(title, source[:8000], _section(current, REQUEST_LOG_HEADING))
            if desc:
                desc["content"] = rebuilt
            else:
                out.insert(0, {"path": "description.md", "language": "markdown", "content": rebuilt})
            notes.append("description.md ricostruito dalla richiesta originale")
    return out, notes


def interview_transcript_md(turns: list[dict]) -> str:
    """Interview Q&A as markdown bullets (used in description.md so the answers are never lost)."""
    lines: list[str] = []
    for turn in turns:
        text = " ".join(str(turn.get("content") or "").split())[:600]
        if not text:
            continue
        who = "Domanda" if turn.get("role") == "assistant" else "Risposta"
        lines.append(f"- **{who}:** {text}")
    return "\n".join(lines)


def fallback_spec(title: str, idea: str, transcript_lines: list[str]) -> tuple[str, list[dict]]:
    """Deterministic spec used when the architect call fails or times out: nothing the user said is lost."""
    parts = [
        f"# {title or 'Progetto'}",
        "## Obiettivo e pubblico\n" + (idea.strip()[:3000] or "Vedi brief originale."),
        "## Funzioni\nF1. Realizzare TUTTO quanto descritto nel brief originale e nelle risposte dell'intervista (sezioni in fondo), "
        "senza omettere nessuna funzione citata. Criterio: ogni funzione citata e' visibile e utilizzabile nell'app.",
        "## Assunzioni\nDove il brief e' ambiguo scegli il default piu' ragionevole.",
    ]
    if transcript_lines:
        parts.append("## Dettagli dall'intervista\n" + "\n".join(f"- {line}" for line in transcript_lines)[:6000])
    milestones = [{"title": "Progetto completo", "goal": "Implementa tutto il brief.", "features": ["F1"]}]
    return "\n\n".join(parts), milestones


def confirm_fallback(title: str, idea: str, turns: list[dict]) -> str:
    """Plan-confirmation text built without the LLM, so the interview can always finish."""
    answers = [str(t.get("content") or "").strip() for t in turns if t.get("role") == "user"]
    bullets = "\n".join(f"- {a[:140]}" for a in answers[-5:] if a)
    return (
        f"Sto per costruire «{title or 'il tuo progetto'}»:\n{idea.strip()[:400]}\n"
        + (f"\nTenendo conto di:\n{bullets}\n" if bullets else "")
        + "\nParto con gli architetti e gli agenti di sviluppo. Ti va bene?"
    )
