"""
UDA Agent Service - Unità Didattica (Teaching Unit) agent
Drives the 5-phase agentic workflow to generate complete teaching units
Phases: briefing → kb → plan → generating → review
"""

import json
import logging
import uuid
from typing import Optional, AsyncGenerator

from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# System prompts
# ─────────────────────────────────────────────────────────────────────────────

_KB_SYSTEM = """Sei un esperto pedagogista e progettista didattico.
Il docente vuole creare una Unità Didattica (UDA) per la propria classe.
Il tuo compito è costruire una knowledge base strutturata che comprenda:
- Contesto educativo (ordine scolastico, disciplina, prerequisiti, traguardi)
- Obiettivi di apprendimento (conoscenze, abilità, competenze)
- Contenuti disciplinari chiave
- Metodologie didattiche consigliate
- Criteri di valutazione

Rispondi SEMPRE in JSON con questo schema:
{
  "title": "Titolo UDA",
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
Data la knowledge base di una UDA, crea un piano operativo con tutti i materiali da generare.
Ogni voce del piano rappresenta un artefatto concreto da produrre.

Rispondi SEMPRE in JSON con questo schema:
{
  "items": [
    {
      "id": "item_1",
      "type": "lesson",
      "title": "Titolo del documento",
      "description": "Breve descrizione del contenuto",
      "purpose": "A cosa serve nella UDA"
    }
  ]
}

Tipi consentiti: lesson (documento didattico), quiz (verifica a scelta multipla),
exercise (esercizio a risposta aperta), presentation (presentazione a slide).
Genera da 3 a 7 elementi. Bilancia bene i tipi in base agli obiettivi."""

_LESSON_SYSTEM = """Sei un esperto docente. Scrivi un documento didattico HTML completo, ben strutturato e coinvolgente.
Usa titoli (<h2>, <h3>), paragrafi, elenchi puntati/numerati, esempi pratici e, dove utile, tabelle.
Non includere tag <html>, <head>, <body>. Solo il contenuto interno.
Il testo deve essere adatto al livello scolastico specificato."""

_QUIZ_SYSTEM = """Sei un esperto docente. Crea un quiz a scelta multipla in JSON.
Schema:
{
  "questions": [
    {
      "question": "Testo della domanda?",
      "options": ["A) risposta 1", "B) risposta 2", "C) risposta 3", "D) risposta 4"],
      "correct": 0,
      "explanation": "Spiegazione della risposta corretta"
    }
  ]
}
Genera da 5 a 10 domande chiare e pertinenti. Distribuisci le risposte corrette tra A/B/C/D."""

_EXERCISE_SYSTEM = """Sei un esperto docente. Crea un esercizio a risposta aperta in JSON.
Schema:
{
  "instructions": "Istruzioni generali per lo studente",
  "questions": [
    {
      "question": "Testo della domanda/consegna",
      "hint": "Suggerimento opzionale"
    }
  ],
  "evaluation_rubric": "Criteri di valutazione della risposta"
}
Genera da 3 a 5 domande stimolanti e pertinenti."""

_PRESENTATION_SYSTEM = """Sei un esperto docente. Crea una presentazione didattica in JSON.
Schema:
{
  "slides": [
    {
      "title": "Titolo slide",
      "content": "Testo principale della slide (max 5 punti chiave)",
      "notes": "Note per il docente (opzionali)"
    }
  ]
}
Genera da 8 a 14 slide. La prima sia una slide di titolo, l'ultima un riepilogo."""


# ─────────────────────────────────────────────────────────────────────────────
# Agent functions
# ─────────────────────────────────────────────────────────────────────────────

async def generate_kb(
    user_prompt: str,
    document_texts: list[str],
    existing_kb: Optional[dict] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Phase 1: Build/update the knowledge base from user prompt + documents."""
    context_parts = [f"RICHIESTA DEL DOCENTE:\n{user_prompt}"]
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

    raw = response.content.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)


async def generate_plan(
    kb: dict,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Phase 2: Generate the list of items to produce for the UDA."""
    messages = [{"role": "user", "content": f"KNOWLEDGE BASE UDA:\n{json.dumps(kb, ensure_ascii=False, indent=2)}\n\nCrea il piano operativo completo."}]
    response = await llm_service.generate(
        messages=messages,
        system_prompt=_PLAN_SYSTEM,
        provider=provider,
        model=model,
        temperature=0.5,
        max_tokens=2048,
    )

    raw = response.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)


async def generate_item_content(
    item: dict,
    kb: dict,
    provider: Optional[str] = None,
    model: Optional[str] = None,
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

    context = (
        f"Titolo: {item['title']}\n"
        f"Descrizione: {item.get('description', '')}\n"
        f"Scopo nella UDA: {item.get('purpose', '')}\n\n"
        f"KNOWLEDGE BASE UDA:\n{json.dumps(kb, ensure_ascii=False, indent=2)}"
    )
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
    system = (
        "Sei un assistente didattico specializzato nella progettazione di Unità Didattiche (UDA).\n"
        "Hai accesso allo stato corrente dell'UDA. Interpreta la richiesta del docente e:\n"
        "- Se chiede di modificare la KB, rispondi con JSON iniziante con {\"action\":\"update_kb\", \"kb\": {...}}\n"
        "- Se chiede di modificare il piano, rispondi con JSON iniziante con {\"action\":\"update_plan\", \"plan\": {...}}\n"
        "- Se chiede domande generali, rispondi in testo libero (senza JSON)\n\n"
        f"STATO UDA CORRENTE:\n{json.dumps(uda_state, ensure_ascii=False, indent=2)}"
    )
    msgs = list(history) + [{"role": "user", "content": user_message}]
    response = await llm_service.generate(
        messages=msgs,
        system_prompt=system,
        provider=provider,
        model=model,
        temperature=0.5,
        max_tokens=2048,
    )
    return response.content.strip()
