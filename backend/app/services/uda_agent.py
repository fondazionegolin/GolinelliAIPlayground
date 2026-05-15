"""
UDA Agent Service - Unità Didattica (Teaching Unit) agent
Drives the 5-phase agentic workflow to generate complete teaching units
Phases: briefing → kb → plan → generating → review
"""

import json
import logging
import re
import uuid
from typing import Optional, AsyncGenerator

from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)


def _extract_json(text: str) -> dict:
    """
    Robustly extract a JSON object from an LLM response.
    Handles:  raw JSON, ```json ... ```, text before/after the JSON block.
    """
    text = text.strip()

    # 1. Try direct parse first (fastest path)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Strip code fences: ```json ... ``` or ``` ... ```
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass

    # 3. Find the first { ... } block in the text (handles preamble/postamble)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"No valid JSON found in LLM response: {text[:200]}")


# ─────────────────────────────────────────────────────────────────────────────
# System prompts
# ─────────────────────────────────────────────────────────────────────────────

_KB_SYSTEM = """Sei un esperto pedagogista e progettista didattico con solida formazione accademica.
Il docente vuole creare una Unità Didattica (UDA) per la propria classe.
Il tuo compito è costruire una knowledge base strutturata, precisa e coerente con la descrizione fornita.

REGOLE FONDAMENTALI:
- Aderisci strettamente all'argomento e al livello scolastico indicati dal docente.
- Se il docente specifica una lingua di output, usa quella lingua per tutti i valori del JSON.
- Se viene indicato un livello scolastico esplicito, usalo come campo school_level.
- La knowledge base deve riflettere la descrizione del docente, non inventare temi non menzionati.

Rispondi SEMPRE in JSON con questo schema:
{
  "title": "Titolo UDA",
  "language": "es. italiano / english / français",
  "school_level": "es. Scuola Secondaria I grado, classe 2ª",
  "subject": "Disciplina",
  "duration": "es. 4 settimane, 8 ore",
  "objectives": ["obiettivo 1", "obiettivo 2"],
  "prerequisites": ["prerequisito 1"],
  "key_contents": ["contenuto 1", "contenuto 2"],
  "methodology": ["metodologia 1"],
  "evaluation_criteria": ["criterio 1"],
  "notes": "eventuali note libere del docente"
}"""

_PLAN_SYSTEM = """Sei un esperto progettista didattico.
Il tuo compito è creare il piano operativo di una UDA: la lista di tutti i materiali concreti da produrre.

═══════════════════════════════════════════════════
PRIORITÀ ASSOLUTA: LA RICHIESTA ORIGINALE DEL DOCENTE
═══════════════════════════════════════════════════
Se il docente ha fornito istruzioni specifiche su QUANTI o CHE TIPO di materiali vuole
(es. "crea tante mini-attività", "voglio 10 esercizi", "fai soprattutto quiz", "scomponi in passi piccoli"),
DEVI rispettarle alla lettera. Queste istruzioni hanno la PRECEDENZA assoluta sulla KB
e su qualsiasi tua valutazione soggettiva di cosa sia "bilanciato" o "appropriato".

REGOLE:
1. Leggi prima la RICHIESTA ORIGINALE DEL DOCENTE e rispettala come direttiva vincolante.
2. La KB è contesto di sfondo: usa i contenuti chiave, ma non ignorare le istruzioni esplicite.
3. Ogni item deve avere titolo, descrizione specifica e purpose chiari.
4. Scrivi titoli e descrizioni nella lingua indicata nel campo "language" della KB.
5. Se il docente non specifica i tipi, bilancia lesson/quiz/exercise/presentation in base agli obiettivi.
6. Non c'è un limite rigido di elementi: genera quanti ne richiede il docente (da 2 a 15).

Rispondi SEMPRE in JSON con questo schema:
{
  "items": [
    {
      "id": "item_1",
      "type": "lesson",
      "title": "Titolo del documento",
      "description": "Descrizione dettagliata del contenuto",
      "purpose": "A cosa serve nella UDA e quali obiettivi copre"
    }
  ]
}

Tipi consentiti: lesson (documento didattico), quiz (verifica a scelta multipla),
exercise (esercizio a risposta aperta), presentation (presentazione a slide)."""

_LESSON_SYSTEM = """Sei un esperto pedagogista e autore di testi didattici accademicamente rigorosi.
Scrivi un documento didattico HTML completo, ben strutturato, scientificamente accurato e coinvolgente.

OBBLIGATORIO:
1. Usa titoli (<h2>, <h3>), paragrafi (<p>), elenchi (<ul>/<ol>), tabelle (<table>) dove utile.
2. Il linguaggio deve essere formale e disciplinarmente preciso, adeguato al livello scolastico indicato.
3. Struttura minima: introduzione contestuale, almeno 3 sezioni tematiche sviluppate, approfondimento critico, sintesi/conclusioni.
4. Dove pertinente, inserisci riferimenti a teorie, autori o scoperte scientifiche nel corpo del testo (es. "secondo la teoria di Darwin (1859)..." o "come dimostrato da Piaget nel campo dello sviluppo cognitivo...").
5. Usa esempi concreti, analogie efficaci e connessioni interdisciplinari.
6. NON includere tag <html>, <head>, <body>. Solo il contenuto interno al body.
7. Aderisci strettamente al titolo, alla descrizione e allo scopo dell'item specificati.
8. Scrivi ESCLUSIVAMENTE nella lingua indicata nel contesto (campo LINGUA OUTPUT)."""

_QUIZ_SYSTEM = """Sei un esperto valutatore e docente. Crea un quiz a scelta multipla in JSON.
Il quiz deve verificare comprensione profonda, capacità di analisi e applicazione — non semplice memorizzazione.

OBBLIGATORIO:
1. Le domande devono usare terminologia disciplinare corretta e appropriata al livello scolastico.
2. Le opzioni errate devono essere plausibili e basate su misconcezioni comuni (non trivialmente sbagliate).
3. L'explanation deve essere scientificamente accurata, formativa e spiegare *perché* la risposta è corretta.
4. Distribuisci le risposte corrette equamente tra le posizioni A/B/C/D.
5. Scrivi ESCLUSIVAMENTE nella lingua indicata nel contesto (campo LINGUA OUTPUT).

Schema JSON:
{
  "questions": [
    {
      "question": "Testo della domanda?",
      "options": ["A) risposta 1", "B) risposta 2", "C) risposta 3", "D) risposta 4"],
      "correct": 0,
      "explanation": "Spiegazione scientificamente accurata della risposta corretta"
    }
  ]
}
Genera da 6 a 10 domande."""

_EXERCISE_SYSTEM = """Sei un esperto docente. Crea un esercizio a risposta aperta in JSON.
L'esercizio deve stimolare pensiero critico, analisi, sintesi e argomentazione — non semplice ripetizione.

OBBLIGATORIO:
1. Le consegne devono richiedere elaborazione personale, connessioni tra concetti, applicazione a contesti reali.
2. Usa linguaggio preciso e terminologia disciplinare corretta.
3. La rubrica di valutazione deve specificare criteri distinti con descrittori di livello (es. eccellente / adeguato / insufficiente).
4. Scrivi ESCLUSIVAMENTE nella lingua indicata nel contesto (campo LINGUA OUTPUT).

Schema JSON:
{
  "instructions": "Istruzioni generali chiare per lo studente",
  "questions": [
    {
      "question": "Consegna specifica e stimolante",
      "hint": "Suggerimento metodologico opzionale"
    }
  ],
  "evaluation_rubric": "Criteri di valutazione dettagliati con descrittori per ciascun livello"
}
Genera da 3 a 5 consegne."""

_PRESENTATION_SYSTEM = """Sei un esperto docente. Crea una presentazione didattica in JSON.
La presentazione deve essere accademicamente rigorosa, visivamente strutturata e didatticamente efficace.

OBBLIGATORIO:
1. La slide di titolo deve includere i concetti chiave e il livello scolastico.
2. Ogni slide di contenuto deve avere massimo 5 punti chiave, precisi e disciplinarmente corretti.
3. Includi almeno una slide con riferimenti o approfondimenti (teorie, autori, fonti).
4. Le note per il docente devono fornire contesto aggiuntivo, suggerimenti metodologici o domande da porre agli studenti.
5. L'ultima slide deve essere un riepilogo strutturato con i concetti chiave appresi.
6. Scrivi ESCLUSIVAMENTE nella lingua indicata nel contesto (campo LINGUA OUTPUT).

Schema JSON:
{
  "slides": [
    {
      "title": "Titolo slide",
      "content": "Punti chiave della slide (max 5, precisi e completi)",
      "notes": "Note metodologiche per il docente"
    }
  ]
}
Genera da 8 a 14 slide."""


# ─────────────────────────────────────────────────────────────────────────────
# Agent functions
# ─────────────────────────────────────────────────────────────────────────────

async def generate_kb(
    user_prompt: str,
    document_texts: list[str],
    existing_kb: Optional[dict] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    language: Optional[str] = None,
    school_level: Optional[str] = None,
) -> dict:
    """Phase 1: Build/update the knowledge base from user prompt + documents."""
    context_parts = []

    # Language and school level as explicit directives (highest priority)
    if language:
        context_parts.append(f"LINGUA DI OUTPUT: {language}\nProdurre tutti i valori del JSON in: {language}")
    if school_level:
        context_parts.append(f"LIVELLO SCOLASTICO (campo school_level): {school_level}")

    context_parts.append(f"RICHIESTA DEL DOCENTE:\n{user_prompt}")

    if document_texts:
        for i, text in enumerate(document_texts, 1):
            context_parts.append(f"DOCUMENTO {i}:\n{text[:4000]}")  # cap per doc
    if existing_kb:
        context_parts.append(f"KNOWLEDGE BASE ESISTENTE (da aggiornare):\n{json.dumps(existing_kb, ensure_ascii=False, indent=2)}")

    messages = [{"role": "user", "content": "\n\n".join(context_parts)}]
    response = await llm_service.generate(
        messages=messages,
        system_prompt=_KB_SYSTEM,
        provider=provider,
        model=model,
        temperature=0.4,
        max_tokens=2048,
    )

    return _extract_json(response.content)


async def generate_plan(
    kb: dict,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    teacher_request: Optional[str] = None,
) -> dict:
    """Phase 2: Generate the list of items to produce for the UDA."""
    parts = []
    if teacher_request:
        parts.append(
            "═══════════════════════════════════════════════════\n"
            "RICHIESTA ORIGINALE DEL DOCENTE (DIRETTIVA VINCOLANTE):\n"
            "═══════════════════════════════════════════════════\n"
            f"{teacher_request}"
        )
    parts.append(f"KNOWLEDGE BASE UDA (contesto di sfondo):\n{json.dumps(kb, ensure_ascii=False, indent=2)}")
    parts.append("Crea il piano operativo rispettando PRIMA la richiesta del docente, poi la KB.")

    messages = [{"role": "user", "content": "\n\n".join(parts)}]
    response = await llm_service.generate(
        messages=messages,
        system_prompt=_PLAN_SYSTEM,
        provider=provider,
        model=model,
        temperature=0.4,
        max_tokens=3000,
    )

    return _extract_json(response.content)


async def generate_item_content(
    item: dict,
    kb: dict,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    teacher_request: Optional[str] = None,
) -> str:
    """Phase 3: Generate actual content for a single plan item."""
    item_type = item.get("type", "lesson")
    system_map = {
        "lesson": _LESSON_SYSTEM,
        "quiz": _QUIZ_SYSTEM,
        "exercise": _EXERCISE_SYSTEM,
        "presentation": _PRESENTATION_SYSTEM,
    }
    system_prompt = system_map.get(item_type, _LESSON_SYSTEM)

    # Extract language and school level from KB for faithful output
    kb_language = kb.get("language", "italiano")
    kb_school_level = kb.get("school_level", "")

    parts = [
        f"LINGUA OUTPUT: {kb_language}",
        f"LIVELLO SCOLASTICO: {kb_school_level}",
    ]
    if teacher_request:
        parts.append(
            "RICHIESTA ORIGINALE DEL DOCENTE (rispettare le indicazioni specifiche su stile e contenuto):\n"
            f"{teacher_request}"
        )
    parts += [
        f"Titolo: {item['title']}",
        f"Descrizione: {item.get('description', '')}",
        f"Scopo nella UDA: {item.get('purpose', '')}",
        f"KNOWLEDGE BASE UDA:\n{json.dumps(kb, ensure_ascii=False, indent=2)}",
    ]
    context = "\n\n".join(parts)
    messages = [{"role": "user", "content": context}]
    response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider=provider,
        model=model,
        temperature=0.6,
        max_tokens=4096,
    )
    return response.content.strip()


async def chat_iterate(
    user_message: str,
    uda_state: dict,
    history: list[dict],
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> str:
    """Free-form UDA chat: user can ask to modify KB, plan, or individual items."""
    kb_language = uda_state.get("kb", {}).get("language", "italiano")
    system = (
        f"Sei un assistente didattico specializzato nella progettazione di Unità Didattiche (UDA).\n"
        f"Hai accesso allo stato corrente dell'UDA (KB, piano, contenuti generati).\n"
        f"LINGUA DI OUTPUT: {kb_language} — rispondi e genera contenuti in questa lingua.\n\n"
        "Interpreta la richiesta del docente e rispondi SOLO con JSON (senza testo prima o dopo) se deve essere eseguita un'azione:\n\n"
        "AZIONI DISPONIBILI:\n"
        "1. Modificare la Knowledge Base:\n"
        "   {\"action\":\"update_kb\", \"kb\": {...}}\n\n"
        "2. Modificare il piano (lista degli item):\n"
        "   {\"action\":\"update_plan\", \"plan\": {...}}\n\n"
        "3. Modificare il contenuto di un item già generato (usa l'id esatto dall'elenco children):\n"
        "   {\"action\":\"update_item\", \"item_id\":\"<uuid>\", \"title\":\"<opzionale>\", \"content\": <contenuto nel formato corretto>}\n"
        "   Formati contenuto per tipo:\n"
        "   - lesson:       {\"html\": \"<html completo>\"}\n"
        "   - quiz:         {\"questions\": [{\"question\":\"...\",\"options\":[...],\"correct\":0,\"explanation\":\"...\"}]}\n"
        "   - exercise:     {\"instructions\":\"...\",\"questions\":[{\"question\":\"...\",\"hint\":\"...\"}],\"evaluation_rubric\":\"...\"}\n"
        "   - presentation: {\"slides\": [{\"title\":\"...\",\"content\":\"...\",\"notes\":\"...\"}]}\n\n"
        "Se la richiesta è solo una domanda o richiede risposta testuale, rispondi liberamente in testo (NO JSON).\n\n"
        f"STATO UDA CORRENTE:\n{json.dumps(uda_state, ensure_ascii=False, indent=2)}"
    )
    msgs = list(history) + [{"role": "user", "content": user_message}]
    response = await llm_service.generate(
        messages=msgs,
        system_prompt=system,
        provider=provider,
        model=model,
        temperature=0.5,
        max_tokens=4096,
    )
    return response.content.strip()
