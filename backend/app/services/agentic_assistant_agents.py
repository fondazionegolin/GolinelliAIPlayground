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
from app.services.agentic_assistant import BlueprintError, apply_patch, catalog_text, compile_blueprint, describe_graph, parse_blueprint, parse_patch, wants_rebuild
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
- TABELLE COME DATABASE: se il lavoro riguarda raccogliere, conservare, estrarre o interrogare dati, usa i nodi «db.*» (tabelle con nome che restano salvate): db.create_table, db.insert, db.read, db.query (WHERE/ORDER BY/LIMIT), db.random_pick (estrazione casuale, anche con "remove"), db.update, db.delete_rows, db.count; più random.values (valori casuali), data.join, data.distinct, data.group_by. Tutti i nodi db.* hanno lo stesso "table_name". L'ordine tra nodi db.* senza altro legame si impone collegando la tabella del precedente alla porta "after" del successivo.
- Condizioni ("where") e "set": sintassi pandas, es. punti > 5 and classe == '3A'; per inserire dati dalla conversazione usa $variabile nei "values" (es. "nome=$nome; voto=$voto").
- NON precompilare le risposte: in un chatbot le domande sono dell'utente, i nodi di input/attesa restano vuoti e raccolgono i valori a runtime. Non inventare dati di esempio dentro i nodi a meno che l'utente li dia o chieda dati finti (allora random.values / csv.synthetic).
- Usa TUTTE le funzioni utili dei nodi (filtri, ordinamenti, aggregazioni, join, estrazioni casuali) invece di far fare all'AI ciò che un nodo dati fa in modo esatto.
- PRINCIPIO DI ESATTEZZA: i nodi algoritmici sono esatti, gratuiti e verificabili; l'AI (ai.transform, llm_chatbot, ai.generate_dataset) si usa SOLO per ciò che è davvero linguaggio naturale (riassumere, spiegare, tradurre, scrivere testi o domande, classificare testo libero). MAI per verificare una risposta, confrontare, contare, filtrare, ordinare, validare o convertire formati: per quello esistono i nodi dati e di controllo. Un LLM può affiancare un controllo (ad esempio spiegare l'errore) ma non sostituirlo.
- FILE E TABELLE: leggi con platform.files (list / read_text) o platform.documents (read → table); da testo a tabella usa data.parse_text (CSV/TSV/JSON/righe) o text.extract (regex), MAI ai.transform «extract_table» su un file; controlla le righe con data.validate (regole per colonna → valide / scartate con motivo / ok), data.filter, data.dropna, data.distinct, data.convert_to_number, data.compute_column, data.group_by, data.join, data.sort; scrivi con platform.documents.create_sheet / platform.files.write (testo da text.from_table).
- DIALOGHI ALGORITMICI (chatbot.* e control.*, senza AI): il flusso è una catena in cui da ogni nodo parte UN solo collegamento attivo; i rami nascono SOLO dai nodi con uscite alternative: chatbot.check_answer / chatbot.if_contains / chatbot.yes_no / control.compare_numbers / control.if_else (yes|no), chatbot.multi_choice (choice_1..4), control.repeat_until (ok | repeat | exhausted). Un solo nodo iniziale (il primo nodo chatbot.* senza ingressi). Collega ogni uscita di un ramo: un ramo scollegato chiude la conversazione.
  · Verifica di una risposta: chatbot.ask → chatbot.check_answer (mode uguale | contiene | numero con tolleranza | regex; più risposte accettate separate da virgola) → chatbot.say sui rami yes / no.
  · Riprovare: l'unico arco all'indietro è la porta "repeat" di control.repeat_until (mode uguale / contiene / vero_falso, mai verifica_ai se una regola basta) verso il nodo che ripone la domanda.
  · Stato: chatbot.save_variable (nome) e poi $nome nei messaggi e nei "values" dei nodi db.*; contatori con control.counter; dati persistenti con i nodi db.*, che si possono mettere IN MEZZO al dialogo (collega l'uscita del nodo precedente alla porta "after" e l'uscita del db al nodo dopo). Per mostrare una tabella o un numero in chat collegalo alla porta "value" di chatbot.say (testo con {valore}).
  · Nel dialogo i nodi dati (db.*, data.*, text.*) vengono eseguiti quando il flusso ci passa: mettili in catena, non lasciarli appesi.

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


ESEMPIO 3 — «quiz: estrai una domanda a caso dalla tabella, registra i punteggi e mostra la classifica»
{"title":"Quiz con classifica","mode":"data","steps":[
 {"key":"mk","node":"db.create_table","config":{"table_name":"domande","columns":"domanda,risposta","if_exists":"keep"}},
 {"key":"pick","node":"db.random_pick","config":{"table_name":"domande","count":1},"inputs":{"after":"mk.table"}},
 {"key":"log","node":"db.insert","config":{"table_name":"punteggi","values":"studente=$nome; punti=$punti"},"inputs":{"after":"pick.table"}},
 {"key":"top","node":"db.query","config":{"table_name":"punteggi","order_by":"punti","order":"descending","limit":5},"inputs":{"after":"log.table"}}],
 "warnings":["Le tabelle restano salvate nel workflow: ogni esecuzione aggiunge righe."]}

ESEMPIO 4 — «chiedi il nome, salvalo in una tabella e mostra tutti i partecipanti» (dialogo algoritmico con tabella in mezzo)
{"title":"Registro partecipanti","mode":"chatbot","steps":[
 {"key":"chi","node":"chatbot.ask","config":{"question":"Come ti chiami?"}},
 {"key":"sv","node":"chatbot.save_variable","config":{"variable_name":"nome"},"inputs":{"value":"chi.response"}},
 {"key":"ins","node":"db.insert","config":{"table_name":"partecipanti","values":"nome=$nome"},"inputs":{"after":"sv.next"}},
 {"key":"lst","node":"db.read","config":{"table_name":"partecipanti"},"inputs":{"after":"ins.table"}},
 {"key":"fine","node":"chatbot.say","config":{"message":"Grazie $nome! Partecipanti finora:\\n{valore}"},"inputs":{"value":"lst.table"}}],
 "warnings":[]}

ESEMPIO 5 — «quiz: chiedi 7 x 8, verifica la risposta e commenta» (verifica esatta, senza AI)
{"title":"Quiz tabelline","mode":"chatbot","steps":[
 {"key":"q","node":"chatbot.ask","config":{"question":"Quanto fa 7 x 8?"}},
 {"key":"chk","node":"chatbot.check_answer","config":{"expected":"56","mode":"numero"},"inputs":{"text":"q.response"}},
 {"key":"ok","node":"chatbot.say","config":{"message":"Esatto, 56!"},"inputs":{"trigger":"chk.yes"}},
 {"key":"ko","node":"chatbot.say","config":{"message":"Non è corretto: 7 x 8 fa 56."},"inputs":{"trigger":"chk.no"}}],
 "warnings":[]}

ESEMPIO 6 — «leggi il CSV dal drive, scarta le righe non valide e salva le valide ordinate in un foglio» (file, senza AI)
{"title":"Pulizia CSV","mode":"data","steps":[
 {"key":"file","node":"platform.files","config":{"function":"read_text"}},
 {"key":"tab","node":"data.parse_text","config":{"format":"auto"},"inputs":{"text":"file.text"}},
 {"key":"chk","node":"data.validate","config":{"rules":"nome:not_empty\\npunti:number:0-100"},"inputs":{"table":"tab.table"}},
 {"key":"srt","node":"data.sort","config":{"column":"punti","order":"descending"},"inputs":{"table":"chk.valid"}},
 {"key":"out","node":"platform.documents","config":{"function":"create_sheet","title":"Righe valide"},"inputs":{"table":"srt.table"}}],
 "warnings":["Il file da leggere va scelto nel nodo «File» (parametro item_id) prima di eseguire."]}

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
    previous_blueprint: dict[str, Any] | None = None, feedback: str = "",
) -> dict[str, Any]:
    """Blueprint + compile result. Retries with the compiler's error when the blueprint is rejected."""
    brief = f"Intenzione dell'utente:\n{intent.strip()[:MAX_INTENT_CHARS]}\n\nInterpretazione confermata dall'utente:\n{understanding}"
    if assumptions:
        brief += "\n\nScelte da adottare:\n" + "\n".join(f"- {item}" for item in assumptions)
    if answers:
        brief += "\n\nRisposte dell'utente:\n" + "\n".join(f"- {a.get('question', '')} → {a.get('answer', '')}" for a in answers[:6])
    if previous_blueprint and feedback.strip():
        brief += ("\n\nBLUEPRINT PRECEDENTE (da rivedere, non da rifare da zero):\n" + json.dumps(previous_blueprint, ensure_ascii=False)
                  + f"\n\nMODIFICA RICHIESTA DALL'UTENTE:\n{feedback.strip()[:MAX_INTENT_CHARS]}\n"
                  "Restituisci il blueprint COMPLETO aggiornato: mantieni invariato tutto ciò che la modifica non tocca.")
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


EDITOR_SYSTEM = """Sei l'assistente di modifica del Dataflow Studio. L'utente ha GIÀ un workflow sul Canvas e ti chiede un cambiamento.
Ricevi la descrizione del Canvas (nodi con instanceId, parametri diversi dal default, colonne note, collegamenti) e la richiesta.
È una MODIFICA IN PLACE, come un edit di codice: il workflow dell'utente è la base e la sua struttura NON si sconvolge.
Rispondi con il diff minimo: i nodi e i collegamenti che la richiesta non tocca restano esattamente come sono (stessi nodi, stessi parametri, stesse posizioni).
Mai rimuovere e riaggiungere un nodo per cambiarlo: parametri → set_config; altro tipo di nodo → replace_node (mantiene posizione e collegamenti compatibili); un passo nuovo in mezzo a un collegamento → insert_between; un passo in coda o in parallelo → add_node + connect.
Rimuovi un nodo solo se l'utente lo chiede o se la richiesta lo rende inutile, e ricollega a monte/a valle ciò che resta.

Rispondi SOLO con un oggetto JSON (nessun testo fuori, nessun markdown):
{
  "explanation": "1-3 frasi in italiano per un docente: cosa cambi e perché (o la risposta, se è solo una domanda)",
  "ops": [
    {"op": "add_node", "key": "chiave_nuova", "node": "id.del.nodo", "config": {"parametro": valore}, "label": "nome opzionale"},
    {"op": "set_config", "node": "<instanceId o chiave>", "config": {"parametro": nuovo_valore}},
    {"op": "remove_node", "node": "<instanceId o chiave>"},
    {"op": "connect", "source": "<nodo>.porta_uscita", "target": "<nodo>.porta_ingresso"},
    {"op": "disconnect", "target": "<nodo>.porta_ingresso"},
    {"op": "replace_node", "node": "<instanceId>", "with_node": "id.nuovo.nodo", "config": {"parametro": valore}},
    {"op": "insert_between", "source": "<nodo>.porta_uscita", "target": "<nodo>.porta_ingresso", "key": "chiave_nuova", "with_node": "id.del.nodo", "config": {}}
  ]
}
Regole:
- "node" di set_config/remove_node/connect/disconnect è l'instanceId mostrato nel Canvas, oppure la "key" di un nodo aggiunto prima nella stessa lista.
- add_node: "node" è un id del catalogo; non inventare porte o parametri. Una porta di ingresso dati accetta un solo collegamento (connect la sostituisce).
- Per inserire un nodo IN MEZZO a una catena: add_node, poi connect (a monte → nuovo), connect (nuovo → a valle): il collegamento a valle sostituisce quello vecchio.
- set_config cambia solo i parametri indicati. Se l'utente dice «questo nodo», è quello (SELEZIONATO).
- Una richiesta di aggiungere un controllo (verifica, filtro, validazione, conteggio, estrazione) si risolve con nodi algoritmici, NON aggiungendo o riconfigurando un LLM.
- Se la richiesta è solo una domanda o è già soddisfatta, "ops" è [] e rispondi in "explanation".
- Se l'utente nomina un nodo per etichetta, trovalo nella lista. Se è ambiguo, scegli il più plausibile e dillo nella spiegazione.
- Non precompilare risposte nei nodi chatbot: restano vuoti, raccolgono i valori a runtime.
- Per dati/tabelle usa i nodi «db.*» (tabelle con nome persistenti: stesso "table_name" per leggere/scrivere la stessa tabella; ordine imposto con la porta "after"), random.values, data.join, data.distinct, data.group_by. Condizioni e formule: sintassi pandas.
- Nessun nodo che cancella dati o avvia sessioni live, salvo richiesta esplicita. Scrivi testi nella lingua dell'utente.
- PRINCIPIO DI ESATTEZZA: i nodi algoritmici sono esatti, gratuiti e verificabili; l'AI (ai.transform, llm_chatbot, ai.generate_dataset) si usa SOLO per ciò che è davvero linguaggio naturale (riassumere, spiegare, tradurre, scrivere testi o domande, classificare testo libero). MAI per verificare una risposta, confrontare, contare, filtrare, ordinare, validare o convertire formati: per quello esistono i nodi dati e di controllo. Un LLM può affiancare un controllo (ad esempio spiegare l'errore) ma non sostituirlo.
- FILE E TABELLE: leggi con platform.files (list / read_text) o platform.documents (read → table); da testo a tabella usa data.parse_text (CSV/TSV/JSON/righe) o text.extract (regex), MAI ai.transform «extract_table» su un file; controlla le righe con data.validate (regole per colonna → valide / scartate con motivo / ok), data.filter, data.dropna, data.distinct, data.convert_to_number, data.compute_column, data.group_by, data.join, data.sort; scrivi con platform.documents.create_sheet / platform.files.write (testo da text.from_table).
- DIALOGHI ALGORITMICI (chatbot.* e control.*, senza AI): il flusso è una catena in cui da ogni nodo parte UN solo collegamento attivo; i rami nascono SOLO dai nodi con uscite alternative: chatbot.check_answer / chatbot.if_contains / chatbot.yes_no / control.compare_numbers / control.if_else (yes|no), chatbot.multi_choice (choice_1..4), control.repeat_until (ok | repeat | exhausted). Un solo nodo iniziale (il primo nodo chatbot.* senza ingressi). Collega ogni uscita di un ramo: un ramo scollegato chiude la conversazione.
  · Verifica di una risposta: chatbot.ask → chatbot.check_answer (mode uguale | contiene | numero con tolleranza | regex; più risposte accettate separate da virgola) → chatbot.say sui rami yes / no.
  · Riprovare: l'unico arco all'indietro è la porta "repeat" di control.repeat_until (mode uguale / contiene / vero_falso, mai verifica_ai se una regola basta) verso il nodo che ripone la domanda.
  · Stato: chatbot.save_variable (nome) e poi $nome nei messaggi e nei "values" dei nodi db.*; contatori con control.counter; dati persistenti con i nodi db.*, che si possono mettere IN MEZZO al dialogo (collega l'uscita del nodo precedente alla porta "after" e l'uscita del db al nodo dopo). Per mostrare una tabella o un numero in chat collegalo alla porta "value" di chatbot.say (testo con {valore}).
  · Nel dialogo i nodi dati (db.*, data.*, text.*) vengono eseguiti quando il flusso ci passa: mettili in catena, non lasciarli appesi.

"""


async def run_editor(
    db: AsyncSession, actor: User, graph: dict[str, Any], instruction: str, selected: str | None = None,
    history: list[dict[str, str]] | None = None, allow_destructive: bool = False, on_status: Any = None,
) -> dict[str, Any]:
    """Patch for an existing canvas, applied (deterministically) to a copy; retries with the error when it is rejected."""
    instruction = instruction.strip()[:MAX_INTENT_CHARS]
    if not instruction:
        raise BlueprintError("Scrivi che cosa vuoi cambiare")
    if not graph.get("nodes"):
        raise BlueprintError("Il Canvas è vuoto: descrivi il workflow da costruire")
    brief = describe_graph(graph, selected) + f"\n\nRICHIESTA DELL'UTENTE:\n{instruction}"
    system = EDITOR_SYSTEM + "CATALOGO\n" + catalog_text()
    messages: list[dict[str, str]] = [{"role": m.get("role", "user") if m.get("role") in {"user", "assistant"} else "user",
                                       "content": str(m.get("content", ""))[:1500]} for m in (history or [])[-12:] if m.get("content")]
    # The conversation must alternate and end on the user turn that carries the current canvas.
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    messages = [m for i, m in enumerate(messages) if i == 0 or m["role"] != messages[i - 1]["role"]]
    if messages and messages[-1]["role"] == "user":
        messages.pop()
    messages.append({"role": "user", "content": brief})
    last_error = ""
    for attempt in range(MAX_REPAIRS + 1):
        if on_status:
            await on_status("Preparo le modifiche…" if attempt == 0 else f"Correggo la modifica (tentativo {attempt + 1})…")
        response = await _generate("agentic.architect", system, messages, max_tokens=4000, temperature=0.2)
        await _record_cost(db, actor, response, "agentic_assistant_editor")
        content = response.content or ""
        try:
            result = apply_patch(graph, parse_patch(_json_object(content)), allow_destructive=allow_destructive,
                                 allow_rebuild=wants_rebuild(instruction))
        except BlueprintError as exc:
            last_error = str(exc)
            logger.info("editor attempt %s rejected: %s", attempt + 1, last_error)
            messages += [{"role": "assistant", "content": content or "{}"},
                         {"role": "user", "content": f"La modifica è stata rifiutata:\n{last_error}\n\nRispondi solo con il JSON corretto."}]
            continue
        result["attempts"] = attempt + 1
        return result
    raise BlueprintError(f"Non sono riuscito a preparare una modifica valida dopo {MAX_REPAIRS + 1} tentativi. Ultimo errore: {last_error}")
