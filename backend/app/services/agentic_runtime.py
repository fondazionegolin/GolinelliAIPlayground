"""Execution runtime for the typed Dataflow Studio graph."""
from __future__ import annotations

import json
import csv
import logging
import time
from io import StringIO
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.agentic import AgenticDataset, AgenticNodeRun, AgenticWorkflow, AgenticWorkflowRun
from app.models.user import User
from app.services import platform_actions
from app.services.dataflow_nodes import AI_TRANSFORM_TASKS, DEFAULT_EXIT_PHRASES, NODE_REGISTRY, execute_data_node, interpolate_variables, value_to_text

platform_actions.register_nodes(NODE_REGISTRY)
from app.services.llm_service import DEFAULT_OPENAI_CHAT_MODEL, llm_service


logger = logging.getLogger(__name__)


def configured_models() -> list[dict[str, str]]:
    """Models a workflow node can use, following the admin's assignments (Admin → Modelli)."""
    from app.services import model_roles
    models: list[dict[str, str]] = []
    default_provider, default_model = model_roles.pair_for("chat.default")
    fast_provider, fast_model = model_roles.pair_for("chat.fast")
    if settings.OPENAI_API_KEY:
        model = default_model if default_provider == "openai" else DEFAULT_OPENAI_CHAT_MODEL
        models.append({"provider": "openai", "model": model, "name": model})
    if settings.ANTHROPIC_API_KEY:
        model = fast_model if fast_provider == "anthropic" else "claude-haiku-4-5-20251001"
        models.append({"provider": "anthropic", "model": model, "name": model})
    if settings.GEMINI_API_KEY:
        models.append({"provider": "gemini", "model": "gemini-3.8-flash", "name": "Gemini 3.8 Flash"})
    return models


def _edge_port(edge: dict[str, Any], side: str) -> str:
    return str(edge.get(f"{side}Port") or edge.get("type") or ("result" if side == "source" else "input"))


LOOP_NODE = "control.repeat_until"
LOOP_PORT = "repeat"
# The LLM appends this marker when it decides a continuous conversation is over; it is stripped before display.
EXIT_MARKER = "[[FINE_CONVERSAZIONE]]"


def _is_flow_type(node_type: str) -> bool:
    return node_type.startswith("chatbot.") or node_type.startswith("control.") or node_type == "llm_chatbot"


def _is_loop_edge(edge: dict[str, Any], node_by_id: dict[str, dict[str, Any]]) -> bool:
    """The only edges allowed to point backwards: the «Ripeti» port of a repeat-until node."""
    source = node_by_id.get(edge.get("from"))
    return bool(source) and source.get("id") == LOOP_NODE and _edge_port(edge, "source") == LOOP_PORT


def _forward_graph(graph: dict[str, Any]) -> dict[str, Any]:
    """The graph without loop edges: always acyclic, used for ordering and dependency resolution."""
    node_by_id = {node["instanceId"]: node for node in graph["nodes"]}
    return {**graph, "edges": [edge for edge in graph["edges"] if not _is_loop_edge(edge, node_by_id)]}


def _loop_body(graph: dict[str, Any], start: str, loop_node: str) -> set[str]:
    """Nodes to run again when «Ripeti» jumps back to ``start``: everything on a forward path start → loop node."""
    edges = _forward_graph(graph)["edges"]

    def reach(origin: str, forward: bool) -> set[str]:
        seen, pending = {origin}, [origin]
        while pending:
            current = pending.pop()
            for edge in edges:
                src, dst = (edge["from"], edge["to"]) if forward else (edge["to"], edge["from"])
                if src == current and dst not in seen:
                    seen.add(dst); pending.append(dst)
        return seen

    return (reach(start, True) & reach(loop_node, False)) | {start}


def validate_graph(graph: dict[str, Any]) -> None:
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list):
        raise ValueError("I nodi del workflow non sono validi")
    if not isinstance(edges, list):
        raise ValueError("Le connessioni del workflow non sono valide")
    ids = [str(node.get("instanceId") or "") for node in nodes if isinstance(node, dict)]
    if not all(ids) or len(ids) != len(set(ids)):
        raise ValueError("Ogni nodo deve avere un instanceId univoco")
    node_by_id = {node["instanceId"]: node for node in nodes}
    unknown = [str(node.get("id")) for node in nodes if node.get("id") not in NODE_REGISTRY]
    if unknown:
        raise ValueError(f"Tipi di nodo non supportati: {', '.join(sorted(set(unknown)))}")
    occupied_inputs: set[tuple[str, str]] = set()
    for edge in edges:
        if not isinstance(edge, dict) or edge.get("from") not in ids or edge.get("to") not in ids:
            raise ValueError("Una connessione fa riferimento a un nodo inesistente")
        source_spec = NODE_REGISTRY[node_by_id[edge["from"]]["id"]]
        target_spec = NODE_REGISTRY[node_by_id[edge["to"]]["id"]]
        source_port, target_port = _edge_port(edge, "source"), _edge_port(edge, "target")
        if source_port not in {item["name"] for item in source_spec["outputs"]}:
            raise ValueError(f"Porta di uscita inesistente: {source_port}")
        if target_port not in {item["name"] for item in target_spec["inputs"]}:
            raise ValueError(f"Porta di ingresso inesistente: {target_port}")
        key = (edge["to"], target_port)
        # Flow nodes can be entered from several places (e.g. first time + «Ripeti»); data inputs take one value.
        if key in occupied_inputs and not _is_flow_type(str(node_by_id[edge["to"]].get("id") or "")):
            raise ValueError(f"La porta {target_port} ha già una connessione")
        occupied_inputs.add(key)
        if _is_loop_edge(edge, node_by_id) and not _is_flow_type(str(node_by_id[edge["to"]].get("id") or "")):
            raise ValueError("«Ripeti» di 'Ripeti finché' può tornare solo a un nodo del chatbot (es. Domanda o Messaggio)")
        output_type = next(item["type"] for item in source_spec["outputs"] if item["name"] == source_port)
        input_type = next(item["type"] for item in target_spec["inputs"] if item["name"] == target_port)
        if output_type != input_type and "ANY" not in {output_type, input_type}:
            raise ValueError(f"Tipi incompatibili: {output_type} → {input_type}")
    _is_flow_node = _is_flow_type

    for node in nodes:
        if not _is_flow_node(str(node.get("id") or "")):
            continue  # data/ML/plot nodes may be temporarily unconnected while the teacher is still wiring the canvas
        node_spec = NODE_REGISTRY[node["id"]]
        required_ports = {item["name"] for item in node_spec["inputs"] if item.get("required", True)}
        connected_ports = {_edge_port(edge, "target") for edge in edges if edge.get("to") == node["instanceId"]}
        missing = required_ports - connected_ports
        if missing:
            raise ValueError(f"Il nodo '{node_spec['label']}' richiede un collegamento per: {', '.join(sorted(missing))}")
    outgoing_counts: dict[tuple[str, str], int] = {}
    for edge in edges:
        if not _is_flow_type(str(node_by_id[edge["to"]].get("id") or "")):
            continue  # data consumers (images, documents, tables…) may all read the same output; only the dialogue is linear
        key = (edge["from"], _edge_port(edge, "source"))
        outgoing_counts[key] = outgoing_counts.get(key, 0) + 1
    for (source_id, port_name), count in outgoing_counts.items():
        source_node = node_by_id[source_id]
        if count > 1 and _is_flow_node(str(source_node.get("id") or "")):
            raise ValueError(f"La porta '{port_name}' di '{NODE_REGISTRY[source_node['id']]['label']}' può proseguire verso un solo nodo successivo")
    if any(str(node.get("id") or "").startswith("chatbot.") or node.get("id") == "llm_chatbot" for node in nodes):
        _entry_node(graph)  # raises when the dialogue has no unambiguous first node
    try:
        _execution_order(_forward_graph(graph))
    except ValueError:
        raise ValueError("Il workflow contiene un ciclo: per tornare indietro usa l'uscita «Ripeti» del nodo 'Ripeti finché'") from None


def _entry_node(graph: dict[str, Any]) -> dict[str, Any]:
    """First node of a dialogue: a legacy «Inizio conversazione», else the single chat node nobody leads into."""
    nodes = [node for node in graph["nodes"] if isinstance(node, dict)]
    legacy = [node for node in nodes if node.get("id") == "chatbot.start"]
    if len(legacy) == 1:
        return legacy[0]
    if len(legacy) > 1:
        raise ValueError("Un flusso chatbot può avere un solo nodo 'Inizio conversazione'")
    node_by_id = {node["instanceId"]: node for node in nodes}
    forward = _forward_graph(graph)["edges"]
    candidates = [
        node for node in nodes
        if (str(node.get("id") or "").startswith("chatbot.") or node.get("id") == "llm_chatbot")
        and not any(edge["to"] == node["instanceId"] and _is_flow_type(str(node_by_id[edge["from"]].get("id") or "")) for edge in forward)
    ]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise ValueError("Il dialogo non ha un nodo iniziale: ogni nodo riceve già un collegamento da un altro nodo del dialogo")
    names = ", ".join(f"«{node.get('label') or NODE_REGISTRY[node['id']]['label']}»" for node in candidates)
    raise ValueError(f"Il dialogo ha più nodi iniziali ({names}): collegali in sequenza, così il primo è uno solo")


def _execution_order(graph: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = {node["instanceId"]: node for node in graph["nodes"]}
    indegree = {node_id: 0 for node_id in nodes}
    for edge in graph["edges"]:
        indegree[edge["to"]] += 1
    ready = [node_id for node_id in nodes if indegree[node_id] == 0]
    ordered: list[str] = []
    while ready:
        node_id = ready.pop(0)
        ordered.append(node_id)
        for edge in graph["edges"]:
            if edge["from"] == node_id:
                indegree[edge["to"]] -= 1
                if indegree[edge["to"]] == 0:
                    ready.append(edge["to"])
    if len(ordered) != len(nodes):
        raise ValueError("Il workflow contiene un ciclo. Usa un nodo di controllo per iterazioni limitate")
    return [nodes[node_id] for node_id in ordered]


async def _node_inputs(db: AsyncSession, run: AgenticWorkflowRun, graph: dict[str, Any], node_id: str) -> tuple[dict[str, Any], bool]:
    incoming = [edge for edge in graph["edges"] if edge["to"] == node_id]
    if not incoming:
        return dict(run.input_json or {}), True
    result = await db.execute(select(AgenticNodeRun).where(
        AgenticNodeRun.run_id == run.id,
        AgenticNodeRun.node_instance_id.in_([edge["from"] for edge in incoming]),
        AgenticNodeRun.status.in_(["completed", "skipped"]),
    ))
    runs = {item.node_instance_id: item for item in result.scalars().all()}
    values: dict[str, Any] = {}
    active = False
    for edge in incoming:
        source_run = runs.get(edge["from"])
        output = (source_run.output_json if source_run else {}) or {}
        value = output.get(_edge_port(edge, "source"))
        if value is not None or _edge_port(edge, "target") not in values:
            values[_edge_port(edge, "target")] = value
        active = active or (value is not None and value is not False)
    return values, active


def _format_context(value: Any, label: str) -> str | None:
    """Render a table/plot/metrics value coming from another node as readable text for an LLM prompt."""
    if value is None or value == "":
        return None
    if isinstance(value, dict) and isinstance(value.get("rows"), list):
        rows = value["rows"]
        cols = value.get("columns") or (list(rows[0].keys()) if rows else [])
        preview = rows[:15]
        lines = ["| " + " | ".join(str(c) for c in cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
        lines += ["| " + " | ".join(str(row.get(c, "")) for c in cols) + " |" for row in preview]
        note = f"\n… e altre {len(rows) - len(preview)} righe" if len(rows) > len(preview) else ""
        return f"{label} — tabella ({value.get('rowCount', len(rows))} righe):\n" + "\n".join(lines) + note
    if isinstance(value, dict) and value.get("kind") in {"scatter", "scatter3d", "histogram"}:
        axis = value.get("labels") or {}
        title = value.get("title") or "Grafico"
        if value.get("kind") == "histogram":
            ys = [float(v) for v in (value.get("y") or []) if isinstance(v, (int, float))]
            total = sum(ys)
            peak = ys.index(max(ys)) if ys else None
            xs = value.get("x") or []
            summary = f"istogramma di \"{axis.get('x', 'x')}\", {len(ys)} intervalli, {int(total)} osservazioni totali"
            if peak is not None and peak < len(xs):
                summary += f", picco intorno a {xs[peak]}"
        else:
            xs, ys = value.get("x") or [], value.get("y") or []
            summary = f"grafico a dispersione \"{axis.get('x', 'x')}\" vs \"{axis.get('y', 'y')}\", {len(xs)} punti"
        return f"{label} — grafico \"{title}\": {summary}"
    if isinstance(value, dict) and value.get("message") is not None and (value.get("provider") or value.get("model")):
        return f"{label}: {value.get('message')}"
    if isinstance(value, dict):
        pairs = ", ".join(f"{k}: {v}" for k, v in value.items() if isinstance(v, (str, int, float, bool)) or v is None)
        return f"{label} — dati: {pairs}"[:2000] if pairs else None
    if isinstance(value, list):
        return f"{label}: {json.dumps(value, ensure_ascii=False)[:2000]}"
    return f"{label}: {str(value)[:2000]}"


def _pick_model(node_type: str, config: dict[str, Any]) -> tuple[str, str]:
    models = configured_models()
    # Conversational/judging nodes favour the lightest configured model (latency matters more than raw quality);
    # ai.generate_dataset keeps the first configured model.
    if node_type != "ai.generate_dataset" and models:
        light_priority = ["anthropic", "gemini", "openai"]
        default_choice = next((item for provider_name in light_priority for item in models if item["provider"] == provider_name), models[0])
    else:
        default_choice = models[0] if models else None
    provider = str(config.get("provider") or (default_choice["provider"] if default_choice else settings.DEFAULT_LLM_PROVIDER))
    model = str(config.get("model") or (default_choice["model"] if default_choice else settings.DEFAULT_LLM_MODEL))
    if models and not any(item["provider"] == provider and item["model"] == model for item in models):
        raise ValueError(f"Il modello {provider}/{model} non è attivo in GOLIAI")
    return provider, model


def _exit_phrases(config: dict[str, Any]) -> list[str]:
    return [item.strip().lower() for item in str(config.get("exit_phrases") or DEFAULT_EXIT_PHRASES).split(",") if item.strip()]


async def _llm_reply(config: dict[str, Any], inputs: dict[str, Any], state: dict[str, Any],
                     messages: list[dict[str, str]], continuous: bool) -> tuple[str, bool, Any]:
    """One chatbot turn. Returns (visible text, whether the model closed the conversation, raw response)."""
    provider, model = _pick_model("llm_chatbot", config)
    system_prompt = interpolate_variables(config.get("system_prompt") or "Sei un assistente utile.", state.get("variables") or {})
    context_parts = [part for idx in (1, 2, 3) if (part := _format_context(inputs.get(f"context_{idx}"), f"Contesto {idx}"))]
    if context_parts:
        system_prompt += "\n\nContesto fornito dai nodi collegati:\n\n" + "\n\n".join(context_parts)
    if continuous:
        system_prompt += (
            "\n\nQuesta è una conversazione continua a più turni. Quando l'utente mostra di voler chiudere o di essere "
            f"soddisfatto (per esempio: {', '.join(_exit_phrases(config))}), rispondi con un breve saluto conclusivo e "
            f"termina il messaggio con {EXIT_MARKER}. Non usare mai quel marcatore in nessun altro caso."
        )
    response = await llm_service.generate(
        messages=messages, system_prompt=system_prompt, provider=provider, model=model,
        max_tokens=min(4096, max(128, int(config.get("max_tokens", 1024)))),
    )
    content = response.content or ""
    ended = EXIT_MARKER in content
    return content.replace(EXIT_MARKER, "").strip(), ended, response


def _llm_payload(content: str, response: Any) -> dict[str, Any]:
    return {"message": content, "provider": response.provider, "model": response.model,
            "tokens_used": response.prompt_tokens + response.completion_tokens}


async def _repeat_until(inputs: dict[str, Any], config: dict[str, Any], state: dict[str, Any],
                        key: str) -> tuple[dict[str, Any], str | None, str | None, int, int]:
    """Check a value; route to ok / repeat / exhausted and count attempts in the run state."""
    value = inputs.get("value")
    if isinstance(value, dict):
        value = value.get("message") or value.get("response") or value.get("content") or json.dumps(value, ensure_ascii=False)
    text = "" if value is None else str(value).strip()
    mode = str(config.get("mode") or "contiene")
    expected = str(config.get("expected") or "")
    options = [item.strip().lower() for item in expected.split(",") if item.strip()]
    provider = model = None
    prompt_tokens = completion_tokens = 0
    if mode == "uguale":
        ok = text.lower().strip(" .!?") in options
    elif mode == "verifica_ai":
        if not expected.strip():
            raise ValueError("Scrivi il criterio da verificare, ad esempio «la risposta è 56»")
        provider, model = _pick_model("llm_chatbot", config)
        response = await llm_service.generate(
            messages=[{"role": "user", "content": f"Criterio: {expected}\nRisposta dello studente: {text or '(vuota)'}\n\nLa risposta soddisfa il criterio? Rispondi solo SI oppure NO."}],
            system_prompt="Sei un valutatore rigoroso ma ragionevole: accetti formulazioni diverse e piccoli errori di battitura se il significato è corretto.",
            provider=provider, model=model, max_tokens=20,
        )
        ok = response.content.strip().upper().lstrip("*«\"' ").startswith(("SI", "SÌ", "YES"))
        provider, model = response.provider, response.model
        prompt_tokens, completion_tokens = response.prompt_tokens, response.completion_tokens
    elif mode == "vero_falso":
        ok = bool(value) and text.lower() not in {"", "false", "falso", "no", "0", "none"}
    else:
        ok = any(option in text.lower() for option in options)
    counts = state.setdefault("loop_counts", {})
    attempts = int(counts.get(key, 0)) + 1
    limit = max(1, int(config.get("max_attempts") or 3))
    passthrough: Any = text or True
    if ok or attempts >= limit:
        counts[key] = 0
        route = "ok" if ok else "exhausted"
    else:
        counts[key] = attempts
        route = "repeat"
    output = {port_name: (passthrough if port_name == route else None) for port_name in ("ok", "repeat", "exhausted")}
    return {**output, "attempts": attempts, "max_attempts": limit, "passed": ok}, provider, model, prompt_tokens, completion_tokens


def _parse_json_payload(raw: str) -> Any:
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(cleaned)
    except ValueError:
        start, end = min((i for i in (cleaned.find("["), cleaned.find("{")) if i >= 0), default=-1), max(cleaned.rfind("]"), cleaned.rfind("}"))
        if start >= 0 and end > start:
            return json.loads(cleaned[start:end + 1])
        raise


async def _ai_transform(inputs: dict[str, Any], config: dict[str, Any], provider: str, model: str) -> tuple[dict[str, Any], str, str, int, int]:
    """One-shot LLM transformation whose result is exposed on typed ports (text / table / slides)."""
    task = str(config.get("task") or "custom")
    if task not in AI_TRANSFORM_TASKS:
        raise ValueError(f"Compito AI sconosciuto: {task}")
    instruction = str(config.get("instruction") or "").strip()
    if task == "custom" and not instruction:
        raise ValueError("Con il compito «custom» scrivi le istruzioni per l'AI")
    source = value_to_text(inputs.get("input")).strip()
    extra = value_to_text(inputs.get("extra")).strip()
    if not source and not extra and not instruction:
        raise ValueError("Collega un input o scrivi delle istruzioni")
    language = str(config.get("language") or "italiano")
    system = f"{AI_TRANSFORM_TASKS[task]}\nRispondi in {language}."
    if instruction and task != "custom":
        system += f"\nIndicazioni aggiuntive: {instruction}"
    user = (instruction + "\n\n" if task == "custom" else "") + (f"INPUT:\n{source}" if source else "")
    if extra:
        user += f"\n\nCONTESTO AGGIUNTIVO:\n{extra}"
    response = await llm_service.generate(
        messages=[{"role": "user", "content": user.strip() or "Procedi."}], system_prompt=system,
        provider=provider, model=model, max_tokens=min(8192, max(256, int(config.get("max_tokens", 2048)))),
    )
    content = (response.content or "").strip()
    output: dict[str, Any] = {"text": content}
    if task in {"extract_table", "make_slides", "make_quiz"}:
        try:
            parsed = _parse_json_payload(content)
        except ValueError:
            raise ValueError("Il modello non ha restituito un JSON valido: riprova o semplifica l'input") from None
        rows = parsed.get("rows") if isinstance(parsed, dict) and "rows" in parsed else parsed
        if not isinstance(rows, list) or not rows or not all(isinstance(item, dict) for item in rows):
            raise ValueError("Il modello non ha restituito una lista di oggetti")
        if task == "extract_table":
            columns = list(dict.fromkeys(str(key) for row in rows for key in row.keys()))
            output["table"] = {"columns": columns, "rows": rows, "rowCount": len(rows)}
        else:
            output["slides"] = rows
    return output, response.provider, response.model, response.prompt_tokens, response.completion_tokens


async def _execute(
    node_type: str, inputs: dict[str, Any], config: dict[str, Any], state: dict[str, Any],
    db: AsyncSession | None = None, actor: User | None = None, instance_id: str | None = None,
) -> tuple[dict[str, Any], str | None, str | None, int, int]:
    if node_type == LOOP_NODE:
        return await _repeat_until(inputs, config, state, instance_id or "default")
    if node_type.startswith("platform."):
        if db is None or actor is None:
            raise ValueError("I nodi di piattaforma si eseguono con un account docente")
        return await platform_actions.run_platform_node(node_type, inputs, config, db, actor), None, None, 0, 0
    if node_type == "data.saved_dataset":
        if db is None:
            raise ValueError("Il dataset salvato è disponibile solo eseguendo il workflow")
        dataset_id = str(config.get("dataset_id") or "").strip()
        if not dataset_id:
            raise ValueError("Seleziona un dataset dalla libreria")
        result = await db.execute(select(AgenticDataset).where(AgenticDataset.id == dataset_id))
        dataset = result.scalar_one_or_none()
        if not dataset:
            raise ValueError("Il dataset selezionato non è più disponibile")
        return {"table": dataset.table_json}, None, None, 0, 0
    if node_type == "data.new_table":
        output = await execute_data_node(node_type, inputs, config, state)
        table = output["table"]
        if config.get("save_to_library") and db is not None and actor is not None:
            if not table.get("rows"):
                raise ValueError("La nuova tabella è vuota: niente da salvare in libreria")
            db.add(AgenticDataset(
                tenant_id=actor.tenant_id, created_by_user_id=actor.id,
                title=(str(config.get("title") or "").strip() or "Nuova tabella")[:180],
                source="workflow", row_count=int(table.get("rowCount") or len(table["rows"])), table_json=table,
            ))
            await db.commit()
        return output, None, None, 0, 0
    if node_type not in {"llm_chatbot", "ai.generate_dataset", "ai.transform"}:
        return await execute_data_node(node_type, inputs, config, state), None, None, 0, 0
    provider, model = _pick_model(node_type, config)
    if node_type == "ai.transform":
        return await _ai_transform(inputs, config, provider, model)
    if node_type == "ai.generate_dataset":
        requested_rows = min(300, max(5, int(config.get("rows", 30))))
        requested_columns = str(config.get("columns") or "").strip()
        description = str(config.get("prompt") or "Dataset didattico realistico")
        response = await llm_service.generate(
            messages=[{"role": "user", "content": (
                f"Genera {requested_rows} righe per questo dataset: {description}.\n"
                f"Colonne richieste: {requested_columns or 'sceglile in modo coerente'}.\n"
                "Restituisci esclusivamente un array JSON di oggetti, senza markdown né spiegazioni. "
                "Mantieni tipi coerenti, valori plausibili e varietà sufficiente per analisi statistiche."
            )}],
            system_prompt="Sei un generatore rigoroso di dataset tabellari sintetici per attività didattiche e machine learning.",
            provider=provider, model=model, max_tokens=4096,
        )
        raw = response.content.strip().removeprefix("```json").removeprefix("```csv").removeprefix("```").removesuffix("```").strip()
        try:
            parsed = json.loads(raw)
            rows = parsed.get("rows") if isinstance(parsed, dict) else parsed
        except (TypeError, ValueError):
            rows = list(csv.DictReader(StringIO(raw)))
        if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
            raise ValueError("Il modello non ha restituito un dataset tabellare valido")
        columns = list(dict.fromkeys(str(key) for row in rows for key in row.keys()))
        table = {"columns": columns, "rows": rows[:requested_rows], "rowCount": min(len(rows), requested_rows)}
        metadata = {"generated_by": f"{response.provider}/{response.model}", "requested_rows": requested_rows, "actual_rows": table["rowCount"], "columns": columns}
        if db is not None and actor is not None:
            title = description.strip()[:170] or "Dataset generato"
            db.add(AgenticDataset(
                tenant_id=actor.tenant_id, created_by_user_id=actor.id, title=title,
                source="ai", row_count=table["rowCount"], table_json=table,
            ))
            await db.commit()
            metadata["saved_to_library"] = True
        return {"table": table, "metadata": metadata}, response.provider, response.model, response.prompt_tokens, response.completion_tokens

    message = inputs.get("message") or "Inizia la conversazione"
    message = value_to_text(message)
    continuous = bool(config.get("continuous"))
    content, ended, response = await _llm_reply(config, inputs, state, [{"role": "user", "content": str(message)}], continuous)
    output: dict[str, Any] = {"response": _llm_payload(content, response), "next": content}
    if continuous:
        # History holds the turns of the loop (the seed message was already shown by the node that produced it).
        output.update({"seed": str(message), "history": [{"role": "assistant", "content": content}], "turns": 1, "ended": ended})
    return output, response.provider, response.model, response.prompt_tokens, response.completion_tokens


async def execute_node_isolated(node: dict[str, Any], inputs: dict[str, Any], db: AsyncSession | None = None, actor: User | None = None) -> dict[str, Any]:
    """Execute one node without persisting a workflow run.

    The caller supplies resolved values keyed by input-port name.  This is used by
    the editor for iterative, node-by-node exploration and inline previews.
    """
    node_type = str(node.get("id") or "")
    if node_type not in NODE_REGISTRY:
        raise ValueError(f"Tipo di nodo non supportato: {node_type}")
    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    required = [item["name"] for item in NODE_REGISTRY[node_type]["inputs"] if item.get("required", True)]
    missing = [name for name in required if inputs.get(name) is None]
    if missing:
        raise ValueError(f"Input mancanti: {', '.join(missing)}")
    started = time.perf_counter()
    output, provider, model, prompt_tokens, completion_tokens = await _execute(node_type, inputs, config, {}, db=db, actor=actor)
    return {
        "output": output,
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "provider": provider,
        "model": model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }


async def execute_run(db: AsyncSession, workflow: AgenticWorkflow, run: AgenticWorkflowRun, actor: User) -> AgenticWorkflowRun:
    # Batch runs execute each node once in topological order: loop edges are ignored here.
    graph = _forward_graph(workflow.graph_json)
    order = _execution_order(graph)
    state = {"variables": dict((run.input_json or {}).get("variables") or {})}
    run.status = "running"
    run.started_at = run.started_at or datetime.now(timezone.utc)
    run.error_message = None
    await db.commit()
    try:
        for sequence, node in enumerate(order):
            if (await db.execute(select(AgenticWorkflowRun.status).where(AgenticWorkflowRun.id == run.id))).scalar_one() == "cancelled":
                run.status = "cancelled"
                await db.commit()
                await db.refresh(run)
                return run
            result = await db.execute(select(AgenticNodeRun).where(
                AgenticNodeRun.run_id == run.id, AgenticNodeRun.node_instance_id == node["instanceId"],
            ))
            node_run = result.scalar_one_or_none()
            if node_run and node_run.status in {"completed", "skipped"}:
                continue
            inputs, active = await _node_inputs(db, run, graph, node["instanceId"])
            if not node_run:
                node_run = AgenticNodeRun(
                    run_id=run.id, node_instance_id=node["instanceId"], node_type=node["id"],
                    label=str(node.get("label") or NODE_REGISTRY[node["id"]]["label"]), sequence=sequence,
                )
                db.add(node_run)
            node_run.input_json = inputs
            node_run.started_at = datetime.now(timezone.utc)
            if not active:
                node_run.status = "skipped"
                node_run.output_json = {}
                node_run.completed_at = datetime.now(timezone.utc)
                await db.commit()
                continue
            config = node.get("config") if isinstance(node.get("config"), dict) else {}
            node_run.status = "running"
            await db.commit()
            started = time.perf_counter()
            output, provider, model, prompt_tokens, completion_tokens = await _execute(node["id"], inputs, config, state, db=db, actor=actor, instance_id=node["instanceId"])
            node_run.output_json = output
            node_run.provider = provider
            node_run.model = model
            node_run.prompt_tokens = prompt_tokens
            node_run.completion_tokens = completion_tokens
            node_run.duration_ms = int((time.perf_counter() - started) * 1000)
            node_run.status = "completed"
            node_run.completed_at = datetime.now(timezone.utc)
            run.output_json = output
            await db.commit()
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        run.output_json = {**(run.output_json or {}), "variables": state["variables"]}
        await db.commit()
    except Exception as exc:
        if "node_run" in locals() and node_run:
            node_run.status = "failed"
            node_run.error_message = str(exc)
            node_run.completed_at = datetime.now(timezone.utc)
        run.status = "failed"
        run.error_message = str(exc)
        run.completed_at = datetime.now(timezone.utc)
        await db.commit()
    await db.refresh(run)
    return run


class _AwaitingInput(Exception):
    """Raised internally to unwind the conversation walk when a node needs a real user answer."""

    def __init__(self, node_run: AgenticNodeRun):
        self.node_run = node_run


async def _find_node_run(db: AsyncSession, run: AgenticWorkflowRun, node_instance_id: str, visit: int) -> AgenticNodeRun | None:
    result = await db.execute(select(AgenticNodeRun).where(
        AgenticNodeRun.run_id == run.id, AgenticNodeRun.node_instance_id == node_instance_id, AgenticNodeRun.visit == visit,
    ))
    return result.scalar_one_or_none()


async def _get_or_create_node_run(db: AsyncSession, run: AgenticWorkflowRun, node: dict[str, Any], sequence: int, visit: int = 0) -> AgenticNodeRun:
    node_run = await _find_node_run(db, run, node["instanceId"], visit)
    if node_run:
        return node_run
    node_run = AgenticNodeRun(
        run_id=run.id, node_instance_id=node["instanceId"], node_type=node["id"],
        label=str(node.get("label") or NODE_REGISTRY[node["id"]]["label"]), sequence=sequence, visit=visit,
    )
    db.add(node_run)
    return node_run


async def _ensure_executed(
    db: AsyncSession, run: AgenticWorkflowRun, graph: dict[str, Any], node_by_id: dict[str, dict[str, Any]],
    node_instance_id: str, state: dict[str, Any], visiting: set[str], sequence: list[int], actor: User,
) -> dict[str, Any]:
    """Return a node's output, executing it (and any unresolved upstream dependency) on demand.

    Used both to walk the live conversation path and to lazily resolve side inputs
    (e.g. a table/plot node feeding an ``llm_chatbot`` context port) that sit off that
    path.  Every node instance runs at most once per run: the graph is acyclic
    (enforced at save time), so a node reached both as a live-path step and as
    someone else's dependency is simply reused.
    """
    node = node_by_id[node_instance_id]
    visits = state.setdefault("visits", {})
    node_run = await _get_or_create_node_run(db, run, node, sequence[0], int(visits.get(node_instance_id, 0)))
    if node_run.status == "completed":
        return node_run.output_json or {}
    if node_run.status == "waiting":
        raise _AwaitingInput(node_run)
    if node_instance_id in visiting:
        raise ValueError(f"Riferimento ciclico rilevato su '{node.get('label') or node['id']}'")
    visiting.add(node_instance_id)
    sequence[0] += 1
    incoming = [edge for edge in graph["edges"] if edge["to"] == node_instance_id and not _is_loop_edge(edge, node_by_id)]
    inputs: dict[str, Any] = {}
    for edge in incoming:
        source_id = edge["from"]
        if _is_flow_type(str(node_by_id[source_id].get("id") or "")):
            # Flow predecessors are only ever reached by walking the conversation; one that has not run on this
            # pass (another branch, or the path that loops back here) contributes nothing instead of running now.
            source_run = await _find_node_run(db, run, source_id, int(visits.get(source_id, 0)))
            source_output = (source_run.output_json or {}) if source_run and source_run.status == "completed" else {}
        else:
            source_output = await _ensure_executed(db, run, graph, node_by_id, source_id, state, visiting, sequence, actor)
        value = source_output.get(_edge_port(edge, "source"))
        if value is not None or _edge_port(edge, "target") not in inputs:
            inputs[_edge_port(edge, "target")] = value
    visiting.discard(node_instance_id)

    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    if node["id"] == "chatbot.ask" and not config.get("test_response"):
        node_run.input_json = inputs
        node_run.status = "waiting"
        node_run.started_at = datetime.now(timezone.utc)
        node_run.output_json = {"question": config.get("question", "Come posso aiutarti?")}
        await db.commit()
        raise _AwaitingInput(node_run)
    if node["id"] == "chatbot.multi_choice" and not config.get("test_choice"):
        node_run.input_json = inputs
        node_run.status = "waiting"
        node_run.started_at = datetime.now(timezone.utc)
        options = [str(config.get(f"option_{i}", "")) for i in range(1, 5) if str(config.get(f"option_{i}", "")).strip()]
        node_run.output_json = {"question": config.get("question", "Scegli"), "options": options}
        await db.commit()
        raise _AwaitingInput(node_run)

    node_run.input_json = inputs
    node_run.status = "running"
    node_run.started_at = datetime.now(timezone.utc)
    await db.commit()
    started = time.perf_counter()
    output, provider, model, prompt_tokens, completion_tokens = await _execute(node["id"], inputs, config, state, db=db, actor=actor, instance_id=node_instance_id)
    node_run.output_json = output
    node_run.provider = provider
    node_run.model = model
    node_run.prompt_tokens = prompt_tokens
    node_run.completion_tokens = completion_tokens
    node_run.duration_ms = int((time.perf_counter() - started) * 1000)
    if node["id"] == "llm_chatbot" and config.get("continuous") and not output.get("ended"):
        # Continuous chat: the node keeps the floor and waits for the next student message.
        node_run.status = "waiting"
        await db.commit()
        raise _AwaitingInput(node_run)
    node_run.status = "completed"
    node_run.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return output


async def _continue_llm_conversation(node: dict[str, Any], node_run: AgenticNodeRun, user_input: str, state: dict[str, Any]) -> bool:
    """Run one more turn of a continuous ``llm_chatbot``. Returns True when the conversation is over."""
    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    previous = dict(node_run.output_json or {})
    history = list(previous.get("history") or []) + [{"role": "user", "content": user_input}]
    seed = str(previous.get("seed") or "Inizia la conversazione")
    content, ended, response = await _llm_reply(config, node_run.input_json or {}, state, [{"role": "user", "content": seed}, *history], True)
    history.append({"role": "assistant", "content": content})
    turns = int(previous.get("turns") or 1) + 1
    # The model decides when to stop; an explicit closing phrase or the turn cap are hard stops on top of that.
    closing = user_input.strip().lower().strip(" .!?,") in _exit_phrases(config)
    ended = ended or closing or turns >= max(1, int(config.get("max_turns") or 20))
    node_run.output_json = {"response": _llm_payload(content, response), "next": content, "seed": seed,
                            "history": history, "turns": turns, "ended": ended}
    node_run.provider, node_run.model = response.provider, response.model
    node_run.prompt_tokens = int(node_run.prompt_tokens or 0) + response.prompt_tokens
    node_run.completion_tokens = int(node_run.completion_tokens or 0) + response.completion_tokens
    return ended


def _active_flow_edges(graph: dict[str, Any], node_instance_id: str, output: dict[str, Any]) -> list[dict[str, Any]]:
    return [edge for edge in graph["edges"] if edge["from"] == node_instance_id
            and output.get(_edge_port(edge, "source")) not in (None, False)]


async def advance_conversation(
    db: AsyncSession, workflow: AgenticWorkflow, run: AgenticWorkflowRun, actor: User, user_input: str | None = None,
) -> AgenticWorkflowRun:
    """Drive one turn of a chatbot workflow as an explicit state machine.

    The run persists its current position (``current_node_id``) and its
    conversation variables inside ``run.input_json``.  Each call walks forward
    from that position — executing plain nodes automatically and resolving any
    off-path data dependency on demand — until it hits a node that needs a real
    answer (``chatbot.ask``/``chatbot.multi_choice``), reaches ``chatbot.end``, or
    runs out of active outgoing edges. Unlike the batch ``execute_run`` used for
    data-pipeline workflows, a single node instance is never re-entered across
    calls: the graph is acyclic, so "current" only ever moves forward.
    """
    graph = workflow.graph_json
    node_by_id = {node["instanceId"]: node for node in graph["nodes"]}
    saved = run.input_json or {}
    # visits: how many times each node was re-entered by a loop; loop_counts: attempts per «Ripeti finché».
    state: dict[str, Any] = {"variables": dict(saved.get("variables") or {}), "visits": dict(saved.get("visits") or {}),
                             "loop_counts": dict(saved.get("loop_counts") or {})}
    current = saved.get("current_node_id")

    max_sequence = await db.execute(select(func.coalesce(func.max(AgenticNodeRun.sequence), -1)).where(AgenticNodeRun.run_id == run.id))
    sequence = [int(max_sequence.scalar_one()) + 1]

    run.status = "running"
    run.started_at = run.started_at or datetime.now(timezone.utc)
    run.error_message = None
    await db.commit()

    def _persist_position(node_id: str | None) -> None:
        run.input_json = {**(run.input_json or {}), "current_node_id": node_id, "variables": state["variables"],
                          "visits": state["visits"], "loop_counts": state["loop_counts"]}

    try:
        if current is None:
            current = _entry_node(graph)["instanceId"]
        elif user_input is not None:
            node_run = await _find_node_run(db, run, current, int(state["visits"].get(current, 0)))
            if not node_run or node_run.status != "waiting":
                raise ValueError("La conversazione non è in attesa di una risposta")
            node = node_by_id[current]
            if node["id"] == "llm_chatbot":
                if not await _continue_llm_conversation(node, node_run, user_input, state):
                    run.status = "waiting"
                    run.output_json = {"waiting_for": current, "kind": "text"}
                    _persist_position(current)
                    await db.commit()
                    return run
            elif node["id"] == "chatbot.ask":
                node_run.output_json = {"response": user_input, "question": (node_run.output_json or {}).get("question")}
            else:
                config = node.get("config") if isinstance(node.get("config"), dict) else {}
                text = user_input.strip()
                chosen = next((i for i in range(1, 5) if text == str(i) or (
                    str(config.get(f"option_{i}", "")).strip() and text.lower() == str(config.get(f"option_{i}", "")).strip().lower()
                )), 1)
                node_run.output_json = {f"choice_{i}": config.get(f"option_{i}") if i == chosen else None for i in range(1, 5)}
            node_run.status = "completed"
            node_run.completed_at = datetime.now(timezone.utc)
            await db.commit()

        for _ in range(200):
            cancelled = await db.execute(select(AgenticWorkflowRun.status).where(AgenticWorkflowRun.id == run.id))
            if cancelled.scalar_one() == "cancelled":
                run.status = "cancelled"
                _persist_position(current)
                await db.commit()
                return run
            try:
                output = await _ensure_executed(db, run, graph, node_by_id, current, state, set(), sequence, actor)
            except _AwaitingInput as awaiting:
                run.status = "waiting"
                waiting_output = awaiting.node_run.output_json or {}
                run.output_json = {"waiting_for": awaiting.node_run.node_instance_id, "kind": "choice" if "options" in waiting_output else "text", **waiting_output}
                _persist_position(awaiting.node_run.node_instance_id)
                await db.commit()
                return run
            node = node_by_id[current]
            run.output_json = output
            if node["id"] == "chatbot.end":
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                _persist_position(None)
                await db.commit()
                return run
            active_edges = _active_flow_edges(graph, current, output)
            if not active_edges:
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                _persist_position(None)
                await db.commit()
                return run
            step = active_edges[0]
            if _is_loop_edge(step, node_by_id):
                # «Ripeti»: every node between the target and this loop node runs again on a fresh visit.
                for body_node in _loop_body(graph, step["to"], current):
                    state["visits"][body_node] = int(state["visits"].get(body_node, 0)) + 1
            current = step["to"]
        raise ValueError("Il flusso conversazionale ha superato il numero massimo di passi consentiti in un turno")
    except Exception as exc:
        # Any failure (not only ValueError) must end the run: otherwise it stays «running» forever and the next
        # message is rejected with «la conversazione non attende una risposta».
        await db.rollback()
        logger.exception("Conversation run %s failed", run.id)
        failing = next((item for item in (await db.execute(select(AgenticNodeRun).where(
            AgenticNodeRun.run_id == run.id, AgenticNodeRun.status == "running"))).scalars().all()), None)
        if failing:
            failing.status = "failed"
            failing.error_message = str(exc) or exc.__class__.__name__
            failing.completed_at = datetime.now(timezone.utc)
        run.status = "failed"
        run.error_message = str(exc) or exc.__class__.__name__
        run.completed_at = datetime.now(timezone.utc)
        await db.commit()
    await db.refresh(run)
    return run
