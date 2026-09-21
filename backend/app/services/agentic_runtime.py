"""Execution runtime for the typed Dataflow Studio graph."""
from __future__ import annotations

import json
import csv
import time
from io import StringIO
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.agentic import AgenticDataset, AgenticNodeRun, AgenticWorkflow, AgenticWorkflowRun
from app.models.user import User
from app.services.dataflow_nodes import NODE_REGISTRY, execute_data_node, interpolate_variables
from app.services.llm_service import DEFAULT_OPENAI_CHAT_MODEL, llm_service


def configured_models() -> list[dict[str, str]]:
    models: list[dict[str, str]] = []
    if settings.OPENAI_API_KEY:
        models.append({"provider": "openai", "model": DEFAULT_OPENAI_CHAT_MODEL, "name": "GPT-5.6 Luna"})
    if settings.ANTHROPIC_API_KEY:
        models.append({"provider": "anthropic", "model": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5"})
    if settings.GEMINI_API_KEY:
        models.append({"provider": "gemini", "model": "gemini-3.8-flash", "name": "Gemini 3.8 Flash"})
    return models


def _edge_port(edge: dict[str, Any], side: str) -> str:
    return str(edge.get(f"{side}Port") or edge.get("type") or ("result" if side == "source" else "input"))


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
        if key in occupied_inputs:
            raise ValueError(f"La porta {target_port} ha già una connessione")
        occupied_inputs.add(key)
        output_type = next(item["type"] for item in source_spec["outputs"] if item["name"] == source_port)
        input_type = next(item["type"] for item in target_spec["inputs"] if item["name"] == target_port)
        if output_type != input_type and "ANY" not in {output_type, input_type}:
            raise ValueError(f"Tipi incompatibili: {output_type} → {input_type}")
    def _is_flow_node(node_id: str) -> bool:
        return node_id.startswith("chatbot.") or node_id.startswith("control.") or node_id == "llm_chatbot"

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
        key = (edge["from"], _edge_port(edge, "source"))
        outgoing_counts[key] = outgoing_counts.get(key, 0) + 1
    for (source_id, port_name), count in outgoing_counts.items():
        source_node = node_by_id[source_id]
        if count > 1 and _is_flow_node(str(source_node.get("id") or "")):
            raise ValueError(f"La porta '{port_name}' di '{NODE_REGISTRY[source_node['id']]['label']}' può proseguire verso un solo nodo successivo")
    chatbot_nodes = [node for node in nodes if str(node.get("id") or "").startswith("chatbot.") or node.get("id") == "llm_chatbot"]
    if chatbot_nodes:
        starts = [node for node in nodes if node.get("id") == "chatbot.start"]
        if len(starts) != 1:
            raise ValueError("Un flusso chatbot deve avere esattamente un nodo 'Inizio conversazione'")
        if not any(node.get("id") == "chatbot.end" for node in nodes):
            raise ValueError("Un flusso chatbot deve avere almeno un nodo 'Fine conversazione'")
    _execution_order(graph)


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
    if isinstance(value, dict) and value.get("kind") in {"scatter", "histogram"}:
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


async def _execute(
    node_type: str, inputs: dict[str, Any], config: dict[str, Any], state: dict[str, Any],
    db: AsyncSession | None = None, actor: User | None = None,
) -> tuple[dict[str, Any], str | None, str | None, int, int]:
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
    if node_type not in {"llm_chatbot", "ai.generate_dataset"}:
        return await execute_data_node(node_type, inputs, config, state), None, None, 0, 0
    models = configured_models()
    # llm_chatbot favours the lightest/fastest configured model by default (low latency matters more
    # than raw quality for a conversational node); ai.generate_dataset keeps the first configured model.
    if node_type == "llm_chatbot" and models:
        light_priority = ["anthropic", "gemini", "openai"]
        default_choice = next((item for provider_name in light_priority for item in models if item["provider"] == provider_name), models[0])
    else:
        default_choice = models[0] if models else None
    provider = str(config.get("provider") or (default_choice["provider"] if default_choice else settings.DEFAULT_LLM_PROVIDER))
    model = str(config.get("model") or (default_choice["model"] if default_choice else settings.DEFAULT_LLM_MODEL))
    if models and not any(item["provider"] == provider and item["model"] == model for item in models):
        raise ValueError(f"Il modello {provider}/{model} non è attivo in GOLIAI")
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

    message = inputs.get("message") or "Continua la conversazione"
    if isinstance(message, dict):
        message = message.get("content") or message.get("message") or json.dumps(message, ensure_ascii=False)
    system_prompt = interpolate_variables(config.get("system_prompt") or "Sei un assistente utile.", state.get("variables") or {})
    context_parts = [part for idx in (1, 2, 3) if (part := _format_context(inputs.get(f"context_{idx}"), f"Contesto {idx}"))]
    if context_parts:
        system_prompt += "\n\nContesto fornito dai nodi collegati:\n\n" + "\n\n".join(context_parts)
    response = await llm_service.generate(
        messages=[{"role": "user", "content": str(message)}], system_prompt=system_prompt,
        provider=provider, model=model, max_tokens=min(4096, max(128, int(config.get("max_tokens", 1024)))),
    )
    payload = {"message": response.content, "provider": response.provider, "model": response.model,
               "tokens_used": response.prompt_tokens + response.completion_tokens}
    return {"response": payload, "next": response.content}, response.provider, response.model, response.prompt_tokens, response.completion_tokens


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
    graph = workflow.graph_json
    order = _execution_order(graph)
    state = {"variables": dict((run.input_json or {}).get("variables") or {})}
    run.status = "running"
    run.started_at = run.started_at or datetime.now(timezone.utc)
    run.error_message = None
    await db.commit()
    try:
        for sequence, node in enumerate(order):
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
            output, provider, model, prompt_tokens, completion_tokens = await _execute(node["id"], inputs, config, state, db=db, actor=actor)
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


async def _get_or_create_node_run(db: AsyncSession, run: AgenticWorkflowRun, node: dict[str, Any], sequence: int) -> AgenticNodeRun:
    result = await db.execute(select(AgenticNodeRun).where(
        AgenticNodeRun.run_id == run.id, AgenticNodeRun.node_instance_id == node["instanceId"],
    ))
    node_run = result.scalar_one_or_none()
    if node_run:
        return node_run
    node_run = AgenticNodeRun(
        run_id=run.id, node_instance_id=node["instanceId"], node_type=node["id"],
        label=str(node.get("label") or NODE_REGISTRY[node["id"]]["label"]), sequence=sequence,
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
    node_run = await _get_or_create_node_run(db, run, node, sequence[0])
    if node_run.status == "completed":
        return node_run.output_json or {}
    if node_run.status == "waiting":
        raise _AwaitingInput(node_run)
    if node_instance_id in visiting:
        raise ValueError(f"Riferimento ciclico rilevato su '{node.get('label') or node['id']}'")
    visiting.add(node_instance_id)
    sequence[0] += 1
    incoming = [edge for edge in graph["edges"] if edge["to"] == node_instance_id]
    inputs: dict[str, Any] = {}
    for edge in incoming:
        source_output = await _ensure_executed(db, run, graph, node_by_id, edge["from"], state, visiting, sequence, actor)
        inputs[_edge_port(edge, "target")] = source_output.get(_edge_port(edge, "source"))
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
    output, provider, model, prompt_tokens, completion_tokens = await _execute(node["id"], inputs, config, state, db=db, actor=actor)
    node_run.output_json = output
    node_run.provider = provider
    node_run.model = model
    node_run.prompt_tokens = prompt_tokens
    node_run.completion_tokens = completion_tokens
    node_run.duration_ms = int((time.perf_counter() - started) * 1000)
    node_run.status = "completed"
    node_run.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return output


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
    state: dict[str, Any] = {"variables": dict((run.input_json or {}).get("variables") or {})}
    current = (run.input_json or {}).get("current_node_id")

    max_sequence = await db.execute(select(func.coalesce(func.max(AgenticNodeRun.sequence), -1)).where(AgenticNodeRun.run_id == run.id))
    sequence = [int(max_sequence.scalar_one()) + 1]

    run.status = "running"
    run.started_at = run.started_at or datetime.now(timezone.utc)
    run.error_message = None
    await db.commit()

    def _persist_position(node_id: str | None) -> None:
        run.input_json = {**(run.input_json or {}), "current_node_id": node_id, "variables": state["variables"]}

    try:
        if current is None:
            start_node = next((node for node in graph["nodes"] if node.get("id") == "chatbot.start"), None)
            if not start_node:
                raise ValueError("Il workflow chatbot deve avere un nodo 'Inizio conversazione'")
            current = start_node["instanceId"]
        elif user_input is not None:
            result = await db.execute(select(AgenticNodeRun).where(
                AgenticNodeRun.run_id == run.id, AgenticNodeRun.node_instance_id == current, AgenticNodeRun.status == "waiting",
            ))
            node_run = result.scalar_one_or_none()
            if not node_run:
                raise ValueError("La conversazione non è in attesa di una risposta")
            node = node_by_id[current]
            if node["id"] == "chatbot.ask":
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
            current = active_edges[0]["to"]
        raise ValueError("Il flusso conversazionale ha superato il numero massimo di passi consentiti in un turno")
    except ValueError as exc:
        run.status = "failed"
        run.error_message = str(exc)
        run.completed_at = datetime.now(timezone.utc)
        await db.commit()
    await db.refresh(run)
    return run
