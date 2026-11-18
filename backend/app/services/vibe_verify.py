"""Post-generation brief conformance for Vibe Lab.

After a build, every feature of the brief (F1..Fn in spec.md) is checked against the generated code by a
verifier pass; features that are missing or only stubbed get ONE focused repair round. Pure helpers here;
the LLM calls live in the coding endpoint.
"""
from __future__ import annotations

import json
import re

from app.services import vibe_contract

_SCOPE = re.compile(r"Funzioni da completare:\s*([^\n]+)", re.IGNORECASE)
_ID = re.compile(r"F\d{1,2}")

MAX_FILE_CHARS = 14000
MAX_BUNDLE_CHARS = 70000


def scoped_requirements(spec_md: str, request_text: str) -> list[tuple[str, str]]:
    """Requirements to verify: those named by a milestone request ("Funzioni da completare: F1, F2"),
    otherwise the whole F-list of the spec."""
    reqs = vibe_contract.extract_requirements(spec_md)
    match = _SCOPE.search(request_text or "")
    if match:
        wanted = set(_ID.findall(match.group(1)))
        scoped = [r for r in reqs if r[0] in wanted]
        if scoped:
            return scoped
    return reqs


def is_scoped_request(request_text: str) -> bool:
    return bool(_SCOPE.search(request_text or ""))


def code_bundle(files: list[dict], *, only: list[str] | None = None) -> str:
    """Code files (no .md) as a delimited bundle, capped so a big project still fits one call."""
    parts: list[str] = []
    total = 0
    for f in files:
        path = str(f.get("path") or "")
        if path.lower().endswith(".md") or (only is not None and path not in only):
            continue
        body = str(f.get("content") or "")[:MAX_FILE_CHARS]
        if total + len(body) > MAX_BUNDLE_CHARS:
            break
        parts.append(f"=== FILE: {path} ===\n{body}")
        total += len(body)
    return "\n\n".join(parts)


VERIFY_SYSTEM_PROMPT = """Sei un revisore di conformita'. Ricevi i REQUISITI di un brief (F1, F2, ...) e il CODICE di
un'app React. Per OGNI requisito stabilisci se il codice lo implementa DAVVERO:
- "ok": esiste logica/UI reale e raggiungibile dall'utente che lo realizza (anche semplice).
- "partial": esiste ma e' incompleto, finto (stub, dati hardcoded dove servono dati veri, bottone senza handler,
  TODO) o non raggiungibile dalla navigazione.
- "missing": non c'e' nulla nel codice.
Sii concreto e severo ma non pedante: un'implementazione semplice ma funzionante e' "ok". Cita il file/componente
come evidenza. Rispondi SOLO con JSON valido:
{"results": [{"id": "F1", "status": "ok|partial|missing", "evidence": "file o componente", "why": "cosa manca (vuoto se ok)"}]}"""


CONFORMANCE_REPAIR_SYSTEM = """Sei un senior front-end engineer dentro Golinelli.ai. L'app React che ricevi NON implementa
alcune funzioni richieste dal brief (elenco sotto). Implementale DAVVERO, con logica e UI funzionanti e raggiungibili
dalla navigazione, riusando i componenti, i tipi e lo stile gia' presenti.
- Cambia SOLO cio' che serve: non riscrivere e non rimuovere le funzioni che gia' funzionano.
- Ogni import deve puntare a un file esistente con quell'export; se crei un file nuovo, scrivilo completo.
- Niente "..." ne' commenti tipo "resto invariato": ogni file in output e' COMPLETO.
- Se aggiungi una libreria npm consentita, aggiorna package.json (dependencies). Non scrivere index.html, index.tsx,
  main.tsx ne' file .md.

FORMATO DI OUTPUT — nessun testo fuori, nessun backtick: per ogni file da cambiare o creare
=== FILE: percorso ===
<contenuto COMPLETO del file>
e in fondo una riga === END ===.
"""


def parse_gaps(raw: str, reqs: list[tuple[str, str]]) -> list[dict]:
    """Requirements the verifier judged partial/missing. Unparseable output -> [] (never blocks a build)."""
    text = (raw or "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(text[start:end + 1])
    except Exception:
        return []
    texts = dict(reqs)
    gaps: list[dict] = []
    for item in data.get("results") or []:
        if not isinstance(item, dict):
            continue
        rid = str(item.get("id") or "").strip()
        status = str(item.get("status") or "").strip().lower()
        if rid in texts and status in {"partial", "missing"}:
            gaps.append({"id": rid, "text": texts[rid], "status": status, "why": str(item.get("why") or "")[:300]})
    return gaps


def describe_gaps(gaps: list[dict]) -> str:
    return "\n".join(
        f"- {g['id']} ({'mancante' if g['status'] == 'missing' else 'incompleta'}): {g['text']}"
        + (f" — {g['why']}" if g.get("why") else "")
        for g in gaps
    )


def valid_assessment(raw: str, reqs: list[tuple[str, str]]) -> bool:
    text = (raw or '').strip()
    try:
        data = json.loads(text[text.index('{'):text.rindex('}') + 1])
        results = data['results']
        if not isinstance(results, list): return False
        known = {rid for rid, _ in reqs}
        seen = set()
        for item in results:
            if not isinstance(item, dict) or item.get('id') in seen or item.get('id') not in known or item.get('status') not in {'ok', 'partial', 'missing'}: return False
            seen.add(item['id'])
        return seen == known
    except (ValueError, KeyError, TypeError):
        return False
