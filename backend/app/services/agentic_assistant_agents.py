"""LLM agents of the Dataflow Studio assistant: intake (do I understand?) and architect (blueprint → graph).

The graph itself is produced by the deterministic compiler in :mod:`app.services.agentic_assistant`; the agents only
produce JSON that the compiler validates.  A compile error is sent back to the architect (at most twice).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User
from app.services import model_roles
from app.services.agentic_assistant import BlueprintError, catalog_text, compile_blueprint, parse_blueprint
from app.services.agentic_runtime import _parse_json_payload
from app.services.credit_service import credit_service
from app.services.environmental_impact import enrich_usage_with_environmental_impact
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)
MAX_REPAIRS = 2
MAX_INTENT_CHARS = 4000

INTAKE_SYSTEM = """Sei l'assistente del Dataflow Studio, un editor a nodi per costruire workflow (dati, grafici, machine learning, testi con AI,
documenti, immagini, cicli su tabelle, chatbot). L'utente descrive un'intenzione. Il tuo compito, PRIMA di costruire qualunque cosa, è
verificare di aver capito.

Rispondi SOLO con un oggetto JSON:
{
  "understanding": "1-2 frasi in italiano: che cosa costruirai, in termini concreti (cosa entra, cosa succede, cosa esce)",
  "assumptions": ["scelte che farai se l'utente non dice altro: quantità, formato, lingua, salvataggi, ... (max 5, brevi)"],
  "questions": [{"question": "domanda mirata", "suggestions": ["risposta pronta 1", "risposta pronta 2"]}],
  "mode": "data" | "chatbot"
}
Regole:
- Fai domande (al massimo 3) SOLO se un dettaglio cambia davvero la struttura del workflow o può far spendere crediti inutilmente. Se l'intenzione è chiara, "questions" è [].
- "mode" è "chatbot" solo se l'utente vuole una conversazione con uno studente/utente (domande, risposte, tutor); altrimenti "data".
- Scrivi per un docente, non per uno sviluppatore: niente id di nodi (es. «platform.images»), niente nomi di modelli o provider.
- Non assumere azioni che l'utente non ha chiesto: non salvare nel drive, non creare documenti, non avviare sessioni live se non richiesto. Le ipotesi riguardano quantità, formato, lingua, qualità.
- Non proporre funzioni che non esistono nel catalogo sotto. Nessun testo fuori dal JSON.

CATALOGO (sintesi)
"""

ARCHITECT_SYSTEM = """Sei l'architetto del Dataflow Studio. Progetti un workflow scegliendo SOLO nodi del catalogo e collegandoli per nome.
Un compilatore deterministico trasforma il tuo blueprint in nodi e archi sul Canvas: se sbagli un nome di nodo, di porta o un tipo, il
blueprint viene rifiutato e ti restituirò l'errore da correggere.

Rispondi SOLO con un oggetto JSON (nessun testo fuori, nessun markdown):
{
  "title": "titolo breve del workflow",
  "mode": "data" | "chatbot",
  "steps": [
    {"key": "chiave_minuscola", "node": "id.del.nodo", "purpose": "a cosa serve in una riga",
     "config": {"parametro": valore},
     "inputs": {"porta_di_ingresso": "chiave_altro_passo.porta_di_uscita"}}
  ],
  "warnings": ["avvisi per l'utente: costi, limiti, cose da verificare"]
}
Regole:
- "key": a-z, 0-9, _ ; unica; inizia con una lettera. "node": un id del catalogo. Non inventare mai porte o parametri.
- Per i nodi "platform.*" scegli la funzione con "config": {"function": "..."} e usa le porte di QUELLA funzione.
- "inputs" collega le porte di ingresso: valore "chiave.porta". Una porta di ingresso dati accetta un solo collegamento.
- Metti in "config" solo i parametri che servono (gli altri hanno già un default). Scrivi testi e prompt nella lingua dell'utente.
- Nessun nodo che cancella dati o avvia sessioni live, salvo richiesta esplicita. Non salvare nel drive se non richiesto.
- Se il workflow può spendere crediti (immagini, 3D) in un ciclo, imposta "limit" del loop.for_each sul numero richiesto e aggiungilo agli avvisi.
- Workflow semplici: 3-10 passi. Non aggiungere nodi decorativi. Ogni uscita utile deve arrivare a un nodo che la mostra o la salva (grafico, tabella, documento, loop.collect).
- Per l'iterazione sulle righe di una tabella usa loop.for_each + loop.collect (mai ripetizioni manuali).
- Se l'utente fornisce una tabella di esempio o dati, usa data.custom_input con i dati veri; altrimenti, per dati finti, csv.synthetic o ai.generate_dataset.

ESEMPIO 1 — «genera 20 immagini fantasy, un prompt diverso per ognuna»
{"title":"Galleria fantasy","mode":"data","steps":[
 {"key":"prompts","node":"ai.transform","purpose":"Scrive 20 prompt diversi","config":{"task":"prompt_table","instruction":"20 prompt su paesaggi fantasy"}},
 {"key":"each","node":"loop.for_each","purpose":"Un giro per prompt","config":{"column":"prompt","order":"casuale","limit":20,"on_error":"salta"},"inputs":{"table":"prompts.table"}},
 {"key":"img","node":"platform.images","purpose":"Genera l'immagine","config":{"function":"generate"},"inputs":{"prompt":"each.value"}},
 {"key":"end","node":"loop.collect","purpose":"Raccoglie le immagini","inputs":{"value":"img.data_uri"}}],
 "warnings":["Genera 20 immagini: spendono crediti."]}

ESEMPIO 2 — «classifica dati sintetici e mostra il risultato»
{"title":"Classificazione","mode":"data","steps":[
 {"key":"src","node":"csv.synthetic","config":{"kind":"classification","samples":200,"features":4}},
 {"key":"split","node":"data.split","config":{"test_size":0.2},"inputs":{"table":"src.table"}},
 {"key":"train","node":"ml.classification","config":{"target_column":"target","algorithm":"random_forest"},"inputs":{"train":"split.train"}},
 {"key":"pred","node":"ml.predict","inputs":{"model":"train.model","data":"split.test"}},
 {"key":"plot","node":"plot.2d","config":{"x":"feature_1","y":"feature_2","color":"prediction"},"inputs":{"table":"pred.predictions"}}],
 "warnings":["Le metriche del nodo di training sono sul training set; la valutazione onesta è sul test."]}

"""

BLUEPRINT_FORMAT_REMINDER = "Rispondi solo con il JSON del blueprint corretto."


def _resolve_pair(role: str) -> tuple[str, str]:
    return model_roles.pair_for(role)


async def _generate(role: str, system: str, messages: list[dict[str, str]], *, max_tokens: int, temperature: float):
    provider, model = _resolve_pair(role)
    try:
        return await llm_service.generate(messages=messages, system_prompt=system, provider=provider, model=model,
                                          temperature=temperature, max_tokens=max_tokens, allow_web_search=False)
    except Exception as exc:  # role model unavailable (missing key, retired model): fall back to the platform default
        logger.warning("assistant model %s/%s failed (%s); using the platform default", provider, model, exc)
        return await llm_service.generate(messages=messages, system_prompt=system, temperature=temperature,
                                          max_tokens=max_tokens, allow_web_search=False)


async def _record_cost(db: AsyncSession, actor: User, response: Any, context: str) -> None:
    """Charge the call to the credit system. Never raises: tracking must not break the assistant."""
    try:
        if not actor.tenant_id:
            return
        prompt, completion = int(response.prompt_tokens or 0), int(response.completion_tokens or 0)
        cost = credit_service.calculate_cost_for_model(response.provider, response.model, prompt, completion, 0)
        usage = enrich_usage_with_environmental_impact(
            {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion,
             "image_count": 0, "estimated_tokens": True, "type": context},
            provider=response.provider, model=response.model,
        )
        await credit_service.track_usage(db, actor.tenant_id, response.provider, response.model, cost, usage, actor.id, None, None, None)
    except Exception:
        logger.exception("assistant usage tracking failed (%s)", context)


def _json_object(raw: str) -> dict[str, Any]:
    try:
        parsed = _parse_json_payload(raw)
    except ValueError as exc:
        raise BlueprintError("La risposta del modello non è un JSON valido") from exc
    if not isinstance(parsed, dict):
        raise BlueprintError("La risposta del modello non è un oggetto JSON")
    return parsed


def _clean_list(value: Any, limit: int) -> list[str]:
    return [str(item).strip() for item in (value if isinstance(value, list) else []) if str(item).strip()][:limit]


async def run_intake(db: AsyncSession, actor: User, intent: str, answers: list[dict[str, str]] | None = None) -> dict[str, Any]:
    intent = intent.strip()[:MAX_INTENT_CHARS]
    if not intent:
        raise BlueprintError("Descrivi che cosa vuoi costruire")
    user = f"Intenzione dell'utente:\n{intent}"
    if answers:
        user += "\n\nRisposte alle tue domande precedenti:\n" + "\n".join(f"- {a.get('question', '')} → {a.get('answer', '')}" for a in answers[:6])
    system = INTAKE_SYSTEM + catalog_text()
    response = await _generate("chat.fast", system, [{"role": "user", "content": user}], max_tokens=900, temperature=0.3)
    await _record_cost(db, actor, response, "agentic_assistant_intake")
    try:
        data = _json_object(response.content or "")
    except BlueprintError:
        # A model that cannot produce the JSON should not block the user: ask for confirmation of the raw intent.
        data = {"understanding": intent, "assumptions": [], "questions": [], "mode": "data"}
    questions = []
    for item in (data.get("questions") or [])[:3]:
        if isinstance(item, dict) and str(item.get("question") or "").strip():
            questions.append({"question": str(item["question"]).strip(), "suggestions": _clean_list(item.get("suggestions"), 4)})
    # Once the user has answered, ask nothing more: move on to the plan.
    return {
        "understanding": str(data.get("understanding") or intent).strip()[:600],
        "assumptions": _clean_list(data.get("assumptions"), 5),
        "questions": [] if answers else questions,
        "mode": "chatbot" if data.get("mode") == "chatbot" else "data",
    }


async def run_architect(
    db: AsyncSession, actor: User, intent: str, understanding: str, assumptions: list[str], answers: list[dict[str, str]] | None = None,
    allow_destructive: bool = False, on_status: Any = None,
) -> dict[str, Any]:
    """Blueprint + compile result. Retries with the compiler's error when the blueprint is rejected."""
    brief = f"Intenzione dell'utente:\n{intent.strip()[:MAX_INTENT_CHARS]}\n\nInterpretazione confermata dall'utente:\n{understanding}"
    if assumptions:
        brief += "\n\nScelte da adottare:\n" + "\n".join(f"- {item}" for item in assumptions)
    if answers:
        brief += "\n\nRisposte dell'utente:\n" + "\n".join(f"- {a.get('question', '')} → {a.get('answer', '')}" for a in answers[:6])
    system = ARCHITECT_SYSTEM + "CATALOGO\n" + catalog_text()
    messages: list[dict[str, str]] = [{"role": "user", "content": brief}]
    last_error = ""
    for attempt in range(MAX_REPAIRS + 1):
        if on_status:
            await on_status("Progetto il workflow…" if attempt == 0 else f"Correggo il blueprint (tentativo {attempt + 1})…")
        response = await _generate("agentic.architect", system, messages, max_tokens=6000, temperature=0.3)
        await _record_cost(db, actor, response, "agentic_assistant_architect")
        content = response.content or ""
        try:
            blueprint = parse_blueprint(_json_object(content))
            result = compile_blueprint(blueprint, allow_destructive=allow_destructive)
        except BlueprintError as exc:
            last_error = str(exc)
            logger.info("architect attempt %s rejected: %s", attempt + 1, last_error)
            messages += [{"role": "assistant", "content": content or "{}"},
                         {"role": "user", "content": f"Il blueprint è stato rifiutato dal compilatore:\n{last_error}\n\n{BLUEPRINT_FORMAT_REMINDER}"}]
            continue
        result["blueprint"] = json.loads(blueprint.model_dump_json())
        result["attempts"] = attempt + 1
        return result
    raise BlueprintError(f"Non sono riuscito a progettare un workflow valido dopo {MAX_REPAIRS + 1} tentativi. Ultimo errore: {last_error}")
