"""Deterministic core of the Dataflow Studio assistant: blueprint → graph compiler, layout, static lint, LLM catalogue.

The architect agent never writes the graph.  It writes a *blueprint* (steps + wiring by name) that this module
validates against the closed node catalogue and compiles into nodes, edges and canvas operations.  Nothing here calls
an LLM or executes a node.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

from app.services import platform_actions
from app.services.agentic_runtime import FOR_EACH_NODE, NODE_REGISTRY, _edge_port, _forward_graph, _loop_groups, validate_graph

MAX_NODES = 40
NODE_GAP = 110
ROW_HEIGHT = 280
ORIGIN = (80, 80)
KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
CREDIT_EFFECTS = {"spends_credits"}
LLM_NODES = {"ai.generate_dataset", "ai.transform", "llm_chatbot"}

# Functions the architect may never place on its own: they destroy data or drive students in real time.
# They can be allowed explicitly (``allow_destructive``) when the user asked for them.
DESTRUCTIVE_FUNCTIONS = {
    "files.delete", "files.trash", "documents.trash",
    "live.start", "live.next", "live.end",
}


class BlueprintError(ValueError):
    """The blueprint cannot be compiled; the message is actionable for the architect and for the user."""


class Step(BaseModel):
    key: str
    node: str
    purpose: str = ""
    label: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    inputs: dict[str, str] = Field(default_factory=dict)  # target port -> "step_key.source_port"

    @field_validator("key")
    @classmethod
    def _key(cls, value: str) -> str:
        if not KEY_PATTERN.match(value):
            raise ValueError("la chiave di un passo è in minuscolo (a-z, 0-9, _) e inizia con una lettera")
        return value


class Blueprint(BaseModel):
    title: str = "Workflow dell'assistente"
    mode: Literal["data", "chatbot"] = "data"
    steps: list[Step] = Field(min_length=1, max_length=MAX_NODES)
    warnings: list[str] = Field(default_factory=list)


def parse_blueprint(raw: Any) -> Blueprint:
    try:
        return Blueprint.model_validate(raw)
    except ValidationError as exc:
        details = "; ".join(f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in exc.errors()[:5])
        raise BlueprintError(f"Blueprint non valido ({details})") from exc


# ── spec helpers ──────────────────────────────────────────────────────────────

def _spec(node_id: str) -> dict[str, Any]:
    if node_id not in NODE_REGISTRY or NODE_REGISTRY[node_id].get("hidden"):
        raise BlueprintError(f"Nodo «{node_id}» non esiste nel catalogo")
    return NODE_REGISTRY[node_id]


def _function_of(spec: dict[str, Any], config: dict[str, Any]) -> str | None:
    if not spec.get("functions"):
        return None
    options = [item["id"] for item in spec["functions"]]
    chosen = str(config.get("function") or "")
    return chosen if chosen in options else options[0]


def _variant(item: dict[str, Any], function: str | None) -> dict[str, Any]:
    return {**item, **((item.get("variants") or {}).get(function) or {})} if function else item


def _visible(items: list[dict[str, Any]], function: str | None) -> list[dict[str, Any]]:
    """Ports/params of a node for the chosen function (generic platform nodes carry the union of all functions)."""
    return [_variant(item, function) for item in items if not item.get("showFor") or function in item["showFor"]]


def effective_ports(node_id: str, config: dict[str, Any], side: Literal["inputs", "outputs"]) -> list[dict[str, Any]]:
    spec = NODE_REGISTRY[node_id]
    return _visible(spec[side], _function_of(spec, config))


def effective_params(node_id: str, config: dict[str, Any]) -> list[dict[str, Any]]:
    spec = NODE_REGISTRY[node_id]
    return _visible(spec["params"], _function_of(spec, config))


def _compatible(source_type: str, target_type: str) -> bool:
    return source_type == target_type or "ANY" in {source_type, target_type}


def _sanitize_config(node_id: str, raw: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    """Complete config for the canvas: defaults for every parameter, unknown/invalid values dropped with a warning."""
    spec = NODE_REGISTRY[node_id]
    function = _function_of(spec, raw)
    config: dict[str, Any] = {item["name"]: "" if item.get("default") is None else item["default"] for item in spec["params"]}
    for item in _visible(spec["params"], function):  # the chosen function's own defaults (e.g. platform nodes)
        config[item["name"]] = "" if item.get("default") is None else item["default"]
    if function:
        config["function"] = function
    allowed = {item["name"]: item for item in effective_params(node_id, {"function": function} if function else {})}
    for name, value in raw.items():
        if name == "function":
            continue
        item = allowed.get(name)
        if item is None:
            warnings.append(f"{node_id}: parametro «{name}» non esiste{f' per la funzione «{function}»' if function else ''}: ignorato")
            continue
        kind = item["type"]
        try:
            if item.get("options") and value not in (None, "") and value not in item["options"]:
                raise ValueError(f"valori ammessi: {', '.join(map(str, item['options']))}")
            if kind == "INTEGER" and value not in (None, ""):
                value = int(value)
            elif kind in {"NUMBER", "SLIDER"} and value not in (None, ""):
                value = float(value)
            elif kind == "BOOLEAN" and isinstance(value, str):
                value = value.strip().lower() in {"1", "true", "si", "sì", "yes"}
            if kind in {"INTEGER", "NUMBER", "SLIDER"} and value not in (None, ""):
                if item.get("min") is not None and value < item["min"]:
                    value = item["min"]
                if item.get("max") is not None and value > item["max"]:
                    value = item["max"]
        except (TypeError, ValueError) as exc:
            warnings.append(f"{node_id}: «{name}» non valido ({exc}): uso il default")
            continue
        config[name] = value
    return config


# ── compiler ──────────────────────────────────────────────────────────────────

def _node_width(node_id: str) -> int:
    spec = NODE_REGISTRY[node_id]
    return 430 if spec["category"] == "Visualizzazioni" else 500 if node_id == "ml.kmeans_clustering" else 300


def _layout(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], origin: tuple[int, int]) -> None:
    """Longest-path layers left→right; rows ordered by the mean row of the predecessors to limit crossings."""
    by_id = {node["instanceId"]: node for node in nodes}
    forward = _forward_graph({"nodes": nodes, "edges": edges})["edges"]
    layer: dict[str, int] = {}

    def depth(node_id: str, seen: frozenset[str] = frozenset()) -> int:
        if node_id in layer:
            return layer[node_id]
        parents = [edge["from"] for edge in forward if edge["to"] == node_id and edge["from"] not in seen]
        layer[node_id] = 1 + max((depth(parent, seen | {node_id}) for parent in parents), default=-1)
        return layer[node_id]

    for node in nodes:
        depth(node["instanceId"])
    columns: dict[int, list[str]] = {}
    for node in nodes:
        columns.setdefault(layer[node["instanceId"]], []).append(node["instanceId"])
    rows: dict[str, float] = {}
    x = origin[0]
    for index in sorted(columns):
        members = columns[index]

        def preferred(node_id: str) -> float:
            parents = [rows[edge["from"]] for edge in forward if edge["to"] == node_id and edge["from"] in rows]
            return sum(parents) / len(parents) if parents else float(members.index(node_id))

        for slot, node_id in enumerate(sorted(members, key=preferred)):
            rows[node_id] = float(slot) if len(members) > 1 else preferred(node_id)
            by_id[node_id]["x"] = x
            by_id[node_id]["y"] = origin[1] + int(rows[node_id] * ROW_HEIGHT)
        x += max(_node_width(by_id[node_id]["id"]) for node_id in members) + NODE_GAP


def _reference(text: str, steps: dict[str, Step], where: str) -> tuple[str, str]:
    key, _, port = str(text).partition(".")
    if key not in steps or not port:
        raise BlueprintError(f"{where}: riferimento «{text}» non valido (usa «passo.porta» con un passo esistente)")
    return key, port


def compile_blueprint(
    blueprint: Blueprint | dict[str, Any], *, allow_destructive: bool = False, stamp: int | None = None,
    origin: tuple[int, int] = ORIGIN,
) -> dict[str, Any]:
    """Blueprint → ``{graph, ops, estimate, warnings, issues}``.  Raises :class:`BlueprintError`."""
    plan = blueprint if isinstance(blueprint, Blueprint) else parse_blueprint(blueprint)
    stamp = int(stamp if stamp is not None else time.time() * 1000)
    warnings = list(plan.warnings)
    steps: dict[str, Step] = {}
    for step in plan.steps:
        if step.key in steps:
            raise BlueprintError(f"La chiave di passo «{step.key}» è usata due volte")
        steps[step.key] = step

    nodes: list[dict[str, Any]] = []
    instance: dict[str, str] = {}
    for index, step in enumerate(plan.steps):
        spec = _spec(step.node)
        function = _function_of(spec, step.config)
        if function and f"{spec['id'].split('.', 1)[1]}.{function}" in DESTRUCTIVE_FUNCTIONS and not allow_destructive:
            raise BlueprintError(
                f"Il passo «{step.key}» usa {spec['id']}.{function}, che cancella dati o agisce in tempo reale sugli studenti: "
                "l'assistente non lo inserisce da solo (serve una richiesta esplicita dell'utente)."
            )
        config = _sanitize_config(step.node, step.config, warnings)
        instance[step.key] = f"{step.node}-{stamp + index}"
        node: dict[str, Any] = {"id": step.node, "instanceId": instance[step.key], "x": 0, "y": 0, "status": "idle", "config": config}
        if step.label:
            node["label"] = step.label
        nodes.append(node)

    edges: list[dict[str, Any]] = []
    node_by_key = {step.key: node for step, node in zip(plan.steps, nodes)}
    for step in plan.steps:
        target = node_by_key[step.key]
        for target_port, reference in step.inputs.items():
            where = f"Passo «{step.key}», ingresso «{target_port}»"
            source_key, source_port = _reference(reference, steps, where)
            source = node_by_key[source_key]
            target_ports = {item["name"]: item for item in effective_ports(target["id"], target["config"], "inputs")}
            source_ports = {item["name"]: item for item in effective_ports(source["id"], source["config"], "outputs")}
            if target_port not in target_ports:
                raise BlueprintError(f"{where}: {target['id']} non ha l'ingresso «{target_port}» (ha: {', '.join(target_ports) or 'nessuno'})")
            if source_port not in source_ports:
                raise BlueprintError(f"{where}: {source['id']} non ha l'uscita «{source_port}» (ha: {', '.join(source_ports) or 'nessuna'})")
            if not _compatible(source_ports[source_port]["type"], target_ports[target_port]["type"]):
                raise BlueprintError(f"{where}: tipi incompatibili {source_ports[source_port]['type']} → {target_ports[target_port]['type']}")
            edges.append({"id": f"edge-{stamp + len(nodes) + len(edges)}", "from": source["instanceId"], "sourcePort": source_port,
                          "to": target["instanceId"], "targetPort": target_port})

    graph = {"nodes": nodes, "edges": edges}
    try:
        validate_graph(graph)
    except ValueError as exc:
        raise BlueprintError(f"Il workflow generato non è valido: {exc}") from exc
    _layout(nodes, edges, origin)
    issues = lint_graph(graph)
    return {
        "title": plan.title, "mode": plan.mode, "graph": graph, "ops": build_ops(graph),
        "estimate": estimate_cost(graph), "warnings": warnings, "issues": issues,
    }


def build_ops(graph: dict[str, Any]) -> list[dict[str, Any]]:
    """Canvas operations in construction order: a node, then each edge as soon as both ends exist."""
    ops: list[dict[str, Any]] = []
    placed: set[str] = set()
    emitted: set[str] = set()
    for node in _topological(graph):
        ops.append({"type": "add_node", "node": node})
        placed.add(node["instanceId"])
        for edge in graph["edges"]:
            if edge["id"] not in emitted and edge["to"] in placed and edge["from"] in placed:
                emitted.add(edge["id"])
                ops.append({"type": "connect", "edge": edge})
    ops.append({"type": "done", "graph": graph})
    return ops


def _topological(graph: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = {node["instanceId"]: node for node in graph["nodes"]}
    edges = _forward_graph(graph)["edges"]
    indegree = {node_id: 0 for node_id in nodes}
    for edge in edges:
        indegree[edge["to"]] += 1
    ready = sorted((node_id for node_id, count in indegree.items() if count == 0), key=lambda node_id: (nodes[node_id]["x"], nodes[node_id]["y"]))
    ordered: list[str] = []
    while ready:
        current = ready.pop(0)
        ordered.append(current)
        for edge in edges:
            if edge["from"] == current:
                indegree[edge["to"]] -= 1
                if indegree[edge["to"]] == 0:
                    ready.append(edge["to"])
    return [nodes[node_id] for node_id in ordered]


# ── cost estimate ─────────────────────────────────────────────────────────────

def _static_rows(graph: dict[str, Any], node_id: str) -> int | None:
    node = next((item for item in graph["nodes"] if item["instanceId"] == node_id), None)
    if node is None:
        return None
    config = node.get("config") or {}
    if node["id"] == "data.custom_input":
        try:
            data = json.loads(config.get("data") or "[]") if isinstance(config.get("data"), str) else config.get("data")
            return len(data) if isinstance(data, list) else None
        except ValueError:
            return None
    if node["id"] == "ai.transform" and config.get("task") == "prompt_table":
        match = re.search(r"\b(\d{1,3})\b", str(config.get("instruction") or ""))
        return int(match.group(1)) if match else 5
    if node["id"] in {"ai.generate_dataset", "csv.synthetic"}:
        return int(config.get("rows") or config.get("samples") or 0) or None
    return None


def loop_times(graph: dict[str, Any]) -> dict[str, int | None]:
    """How many times each loop-body node runs (``None`` = unknown); nodes outside loops are absent."""
    times: dict[str, int | None] = {}
    try:
        groups = _loop_groups(graph)
    except ValueError:
        return times
    for origin, group in groups.items():
        node = next(item for item in graph["nodes"] if item["instanceId"] == origin)
        limit = int((node.get("config") or {}).get("limit") or 0)
        source = next((edge["from"] for edge in graph["edges"] if edge["to"] == origin), None)
        rows = _static_rows(graph, source) if source else None
        count = min(limit, rows) if limit and rows else (limit or rows)
        for member in group["body"]:
            times[member] = count
    return times


def estimate_cost(graph: dict[str, Any]) -> dict[str, Any]:
    """What running the workflow would spend, computed from the graph (not by the model)."""
    times = loop_times(graph)
    credit_nodes: list[dict[str, Any]] = []
    llm_calls: int | None = 0
    for node in graph["nodes"]:
        multiplier = times.get(node["instanceId"], 1) if node["instanceId"] in times else 1
        function = _function_of(NODE_REGISTRY[node["id"]], node.get("config") or {})
        meta = platform_actions.ACTIONS.get(f"{node['id'].split('.', 1)[1]}.{function}") if node["id"].startswith("platform.") and function else None
        if meta and meta.side_effects in CREDIT_EFFECTS:
            credit_nodes.append({"node": node["instanceId"], "type": node["id"], "function": function, "times": multiplier,
                                 "long_running": meta.long_running})
        if node["id"] in LLM_NODES:
            llm_calls = None if (multiplier is None or llm_calls is None) else llm_calls + multiplier
    return {"credit_nodes": credit_nodes, "llm_calls": llm_calls}


# ── static lint (reviewer level 1) ────────────────────────────────────────────

def _issue(severity: str, node: str | None, message: str) -> dict[str, Any]:
    return {"severity": severity, "node": node, "message": message}


def _csv(value: Any) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def infer_columns(graph: dict[str, Any], node_id: str, port: str, _seen: frozenset[tuple[str, str]] = frozenset()) -> list[str] | None:
    """Columns of a TABLE output when they can be known without running anything (``None`` = unknown)."""
    if (node_id, port) in _seen:
        return None
    seen = _seen | {(node_id, port)}
    node = next((item for item in graph["nodes"] if item["instanceId"] == node_id), None)
    if node is None:
        return None
    kind, config = node["id"], node.get("config") or {}

    def upstream(input_port: str = "table") -> list[str] | None:
        edge = next((item for item in graph["edges"] if item["to"] == node_id and _edge_port(item, "target") == input_port), None)
        return infer_columns(graph, edge["from"], _edge_port(edge, "source"), seen) if edge else None

    if kind == "data.custom_input":
        try:
            data = json.loads(config.get("data") or "[]") if isinstance(config.get("data"), str) else config.get("data")
            if isinstance(data, list) and data and isinstance(data[0], dict):
                return list(dict.fromkeys(str(key) for row in data for key in row))
        except ValueError:
            pass
        return None
    if kind == "csv.synthetic":
        count = 2 if config.get("kind") in {"moons", "circles"} else int(config.get("features") or 3)
        return [f"feature_{index + 1}" for index in range(count)] + ["target"]
    if kind == "ai.generate_dataset":
        return _csv(config.get("columns")) or None
    if kind == "ai.transform":
        return ["prompt"] if port == "table" and config.get("task") == "prompt_table" else None
    if kind == "loop.collect" and port == "table":
        return ["ciclo", "input", "risultato"]
    if kind in {"data.filter", "data.sort", "data.dropna", "data.slice", "data.transform", "data.convert_to_number", "nlp.clean_text"}:
        return upstream()
    if kind == "data.split":
        return upstream()
    if kind == "data.select":
        columns = upstream()
        chosen = _csv(config.get("columns"))
        if config.get("mode") == "exclude":
            return [name for name in columns if name not in chosen] if columns is not None else None
        return chosen or columns
    if kind in {"data.new_table", "data.rename_columns"}:
        columns = upstream()
        if columns is None:
            return None
        chosen = _csv(config.get("columns")) if kind == "data.new_table" else []
        columns = chosen or columns
        mapping = {old.strip(): new.strip() for old, new in (item.split(":", 1) for item in _csv(config.get("rename")) if ":" in item)}
        return [mapping.get(name, name) for name in columns]
    if kind == "data.compute_column":
        columns = upstream()
        name = str(config.get("name") or "nuova_colonna")
        return None if columns is None else columns + ([name] if name not in columns else [])
    if kind == "data.group_by":
        columns = upstream()
        group = str(config.get("group_column") or "")
        if columns is None or not group:
            return None
        values = _csv(config.get("value_columns"))
        return [group, "conteggio"] if config.get("aggregation") == "count" or not values else [group, *values]
    if kind == "data.merge_columns":
        first, second = upstream("table_1"), upstream("table_2")
        if first is None:
            return None
        if config.get("merge_mode") == "vertical" or second is None:
            return first
        return first + [f"{name}_2" if name in first else name for name in second]
    if kind == "nlp.sentiment":
        columns = upstream()
        return None if columns is None else columns + ["polarity", "sentiment"]
    if kind == "ml.kmeans_clustering":
        columns = upstream()
        return None if columns is None else columns + ["cluster"]
    if kind in {"ml.regression", "ml.classification", "ml.predict"}:
        columns = upstream("train" if kind != "ml.predict" else "data")
        return None if columns is None else columns + ["prediction"]
    return None


def lint_graph(graph: dict[str, Any]) -> list[dict[str, Any]]:
    """Deterministic review: structural validity, unconnected inputs, columns that do not exist, obvious waste."""
    try:
        validate_graph(graph)
    except ValueError as exc:
        return [_issue("error", None, str(exc))]
    issues: list[dict[str, Any]] = []
    connected = {(edge["to"], _edge_port(edge, "target")) for edge in graph["edges"]}
    used_sources = {edge["from"] for edge in graph["edges"]}
    for node in graph["nodes"]:
        config = node.get("config") or {}
        title = node.get("label") or NODE_REGISTRY[node["id"]]["label"]
        for item in effective_ports(node["id"], config, "inputs"):
            if item.get("required", True) and (node["instanceId"], item["name"]) not in connected:
                issues.append(_issue("error", node["instanceId"], f"«{title}»: l'ingresso «{item['label']}» ({item['name']}) non è collegato"))
        if len(graph["nodes"]) > 1 and node["instanceId"] not in used_sources and not any(edge["to"] == node["instanceId"] for edge in graph["edges"]):
            issues.append(_issue("warning", node["instanceId"], f"«{title}» non è collegato a nulla"))
        for item in effective_params(node["id"], config):
            if item["type"] not in {"COLUMN", "COLUMNS"}:
                continue
            requested = _csv(config.get(item["name"]))
            if not requested:
                continue
            available = None
            for edge in (item for item in graph["edges"] if item["to"] == node["instanceId"]):
                available = infer_columns(graph, edge["from"], _edge_port(edge, "source"))
                if available is not None:
                    break
            missing = [name for name in requested if available is not None and name not in available]
            if missing:
                issues.append(_issue("error", node["instanceId"], f"«{title}»: {item['label']} usa «{', '.join(missing)}» ma la tabella a monte ha: {', '.join(available or [])}"))
    # «Per ogni riga»: the column must exist in the table that feeds it (covered above); an empty static table never runs.
    for node in graph["nodes"]:
        if node["id"] != FOR_EACH_NODE:
            continue
        feeder = next((edge for edge in graph["edges"] if edge["to"] == node["instanceId"]), None)
        rows = _static_rows(graph, feeder["from"]) if feeder else None
        if rows == 0:
            issues.append(_issue("error", node["instanceId"], "«Per ogni riga»: la tabella in ingresso è vuota, il ciclo non farebbe nulla"))
    estimate = estimate_cost(graph)
    for item in estimate["credit_nodes"]:
        if item["times"] is None:
            issues.append(_issue("warning", item["node"], "Spende crediti ma non so quante volte verrà eseguito: imposta «Massimo cicli»"))
        elif item["times"] > 50:
            issues.append(_issue("warning", item["node"], f"Spende crediti {item['times']} volte: controlla il numero di cicli"))
    return issues


# ── catalogue for the architect prompt ────────────────────────────────────────

COMPOSITION_RULES = [
    "Un ingresso dati accetta UN solo arco; le porte di uscita possono alimentare più nodi dati.",
    "Tipi: un'uscita si collega a un ingresso dello stesso tipo, oppure se uno dei due è ANY. TABLE→TABLE, MODEL→MODEL, ecc.",
    "Il grafo è aciclico. L'unico arco all'indietro è la porta «repeat» di control.repeat_until (solo nei dialoghi chatbot).",
    "Per ripetere un'azione su ogni riga di una tabella: tabella → loop.for_each → nodi del corpo → loop.collect. Un solo loop.collect per ogni loop.for_each, niente cicli annidati.",
    "I nodi del corpo di un ciclo leggono loop.for_each.value (cella della colonna scelta), .row (riga intera) o .index.",
    "I risultati di un ciclo si leggono da loop.collect.results (lista) o .table; i nodi a valle di loop.collect partono a ciclo concluso.",
    "I nodi chatbot.*, control.* e llm_chatbot formano un dialogo lineare: una porta di uscita porta a UN solo nodo del dialogo; serve un solo nodo iniziale.",
    "Qualunque output si può usare come testo (tabelle → Markdown, risposte AI → messaggio): non servono nodi di conversione.",
    "Valutazione ML onesta: data.split → addestra su train → ml.predict su test. Le metriche del nodo di training sono sul training set.",
    "I nodi platform.* con effetti (creano file, spendono crediti) non si eseguono durante la revisione.",
]


def _port_line(item: dict[str, Any]) -> str:
    return f"{item['name']}:{item['type']}{'' if item.get('required', True) else '?'}"


def _param_line(item: dict[str, Any]) -> str:
    detail = f"{item['name']}:{item['type']}"
    if item.get("options"):
        detail += "{" + "|".join(map(str, item["options"])) + "}"
    if item.get("default") not in (None, ""):
        detail += f"={str(item['default'])[:40]}"
    return detail


def catalog_for_llm() -> dict[str, Any]:
    """Compact, always-in-sync view of ``NODE_REGISTRY`` for the architect prompt."""
    nodes: list[dict[str, Any]] = []
    for spec in NODE_REGISTRY.values():
        if spec.get("hidden"):
            continue
        entry: dict[str, Any] = {
            "id": spec["id"], "label": spec["label"], "category": spec["category"],
            "description": spec["description"].split(". ")[0].rstrip("."),
        }
        if spec.get("functions"):
            entry["functions"] = []
            for fn in spec["functions"]:
                function = fn["id"]
                entry["functions"].append({
                    "id": function, "label": fn["label"], "sideEffects": fn.get("sideEffects", "none"), "longRunning": bool(fn.get("longRunning")),
                    "destructive": f"{spec['id'].split('.', 1)[1]}.{function}" in DESTRUCTIVE_FUNCTIONS,
                    "inputs": [_port_line(p) for p in _visible(spec["inputs"], function)],
                    "outputs": [_port_line(p) for p in _visible(spec["outputs"], function)],
                    "params": [_param_line(p) for p in _visible(spec["params"], function) if p["name"] != "function"],
                })
        else:
            entry.update(inputs=[_port_line(p) for p in spec["inputs"]], outputs=[_port_line(p) for p in spec["outputs"]],
                         params=[_param_line(p) for p in spec["params"]])
        nodes.append(entry)
    return {"rules": COMPOSITION_RULES, "nodes": nodes}


def catalog_text() -> str:
    """The catalogue as dense text for a system prompt (one line per node / platform function)."""
    lines = ["REGOLE DI COMPOSIZIONE", *(f"- {rule}" for rule in COMPOSITION_RULES), "", "NODI  (porta:TIPO, '?' = facoltativa; params nome:TIPO{opzioni}=default)"]
    for entry in catalog_for_llm()["nodes"]:
        lines.append(f"* {entry['id']} — {entry['label']}: {entry['description']}")
        if "functions" in entry:
            for fn in entry["functions"]:
                flag = " [DISTRUTTIVA]" if fn["destructive"] else " [spende crediti]" if fn["sideEffects"] == "spends_credits" else ""
                lines.append(f"    function={fn['id']}{flag}: in({', '.join(fn['inputs'])}) out({', '.join(fn['outputs'])}) params({', '.join(fn['params'])})")
        else:
            lines.append(f"    in({', '.join(entry['inputs'])}) out({', '.join(entry['outputs'])}) params({', '.join(entry['params'])})")
    return "\n".join(lines)
