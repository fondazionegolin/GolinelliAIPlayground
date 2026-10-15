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
from app.services.agentic_runtime import FOR_EACH_NODE, NODE_REGISTRY, _edge_port, _forward_graph, _is_flow_type, _loop_groups, validate_graph

MAX_NODES = 40
NODE_GAP = 110
ROW_HEIGHT = 280
ORIGIN = (80, 80)
KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
CREDIT_EFFECTS = {"spends_credits"}
LLM_NODES = {"ai.generate_dataset", "ai.transform", "llm_chatbot"}

# Preview-only answers make a chatbot node answer by itself: generated nodes must always wait for the real person.
INTERACTIVE_DEFAULTS = {"chatbot.ask": {"test_response": ""}, "chatbot.multi_choice": {"test_choice": 0}}

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
        config = {**_sanitize_config(step.node, step.config, warnings), **INTERACTIVE_DEFAULTS.get(step.node, {})}
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


# ── editing an existing workflow ──────────────────────────────────────────────

class PatchOp(BaseModel):
    """One edit.  ``node`` refs are the instanceId of an existing node or the ``key`` of a node added earlier in the patch."""
    op: Literal["add_node", "set_config", "remove_node", "connect", "disconnect", "replace_node", "insert_between"]
    key: str | None = None            # add_node: name other ops use to refer to the new node
    node: str | None = None           # add_node: catalogue id · set_config/remove_node: target node
    config: dict[str, Any] = Field(default_factory=dict)
    label: str | None = None
    source: str | None = None         # connect/disconnect/insert_between: "node.port"
    target: str | None = None         # connect/disconnect/insert_between: "node.port"
    # replace_node: ``node`` = existing node, ``with_node`` = catalogue id that takes its place (position and wiring are kept
    # wherever the port names/types still match).  insert_between: ``with_node`` goes on the link source → target.
    with_node: str | None = None


class GraphPatch(BaseModel):
    explanation: str = ""
    ops: list[PatchOp] = Field(default_factory=list, max_length=40)


def parse_patch(raw: Any) -> GraphPatch:
    try:
        return GraphPatch.model_validate(raw)
    except ValidationError as exc:
        details = "; ".join(f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in exc.errors()[:5])
        raise BlueprintError(f"Modifica non valida ({details})") from exc


def _short(value: Any, limit: int = 160) -> Any:
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + f"… ({len(value)} caratteri)"
    return value


def describe_graph(graph: dict[str, Any], selected: str | None = None) -> str:
    """The canvas as the editor agent sees it: node ids, non-default config, known columns, wiring."""
    lines = ["NODI"]
    for node in graph["nodes"]:
        spec = NODE_REGISTRY.get(node["id"])
        if spec is None:
            continue
        config = node.get("config") or {}
        defaults = {item["name"]: ("" if item.get("default") is None else item["default"]) for item in spec["params"]}
        changed = {key: _short(value) for key, value in config.items() if key == "function" or value != defaults.get(key)}
        outputs = []
        for item in effective_ports(node["id"], config, "outputs"):
            if item["type"] == "TABLE":
                columns = infer_columns(graph, node["instanceId"], item["name"])
                if columns:
                    outputs.append(f"{item['name']}[colonne: {', '.join(columns)}]")
        title = node.get("label") or spec["label"]
        lines.append(f"- {node['instanceId']} · {node['id']} «{title}»{' (SELEZIONATO)' if node['instanceId'] == selected else ''}"
                     f" · config: {json.dumps(changed, ensure_ascii=False)}" + (f" · uscite: {'; '.join(outputs)}" if outputs else ""))
    lines.append("COLLEGAMENTI")
    lines += [f"- {edge['from']}.{_edge_port(edge, 'source')} → {edge['to']}.{_edge_port(edge, 'target')}" for edge in graph["edges"]] or ["- (nessuno)"]
    return "\n".join(lines)


def _node_title(node: dict[str, Any]) -> str:
    return str(node.get("label") or NODE_REGISTRY[node["id"]]["label"])


def _split_ref(text: str | None, where: str) -> tuple[str, str]:
    node, _, port = str(text or "").rpartition(".")
    if not node or not port:
        raise BlueprintError(f"{where}: riferimento «{text}» non valido (usa «nodo.porta»)")
    return node, port


REBUILD_WORDS = ("da capo", "da zero", "ricostruisc", "ricomincia", "rifai", "rifallo", "sostituisci tutto", "ricrea", "azzera")


def wants_rebuild(instruction: str) -> bool:
    text = instruction.lower()
    return any(word in text for word in REBUILD_WORDS)


def apply_patch(
    graph: dict[str, Any], patch: GraphPatch | dict[str, Any], *, allow_destructive: bool = False, stamp: int | None = None,
    allow_rebuild: bool = True,
) -> dict[str, Any]:
    """Apply an edit to a copy of the canvas graph.  Existing nodes keep their position; new ones are placed next to what they read from."""
    plan = patch if isinstance(patch, GraphPatch) else parse_patch(patch)
    stamp = int(stamp if stamp is not None else time.time() * 1000)
    before = json.loads(json.dumps(graph))
    nodes = {node["instanceId"]: node for node in json.loads(json.dumps(graph["nodes"]))}
    edges: list[dict[str, Any]] = json.loads(json.dumps(graph["edges"]))
    keys: dict[str, str] = {}
    added: list[str] = []
    summary: list[str] = []
    warnings: list[str] = []

    def resolve(ref: str | None, where: str) -> dict[str, Any]:
        name = str(ref or "").strip()
        node = nodes.get(keys.get(name, name))
        if node is None:
            raise BlueprintError(f"{where}: il nodo «{name}» non esiste (usa un instanceId del canvas o la chiave di un nodo aggiunto prima)")
        return node

    def port_of(node: dict[str, Any], port: str, side: Literal["inputs", "outputs"], where: str) -> dict[str, Any]:
        ports = {item["name"]: item for item in effective_ports(node["id"], node.get("config") or {}, side)}
        if port not in ports:
            raise BlueprintError(f"{where}: «{_node_title(node)}» non ha {'l’ingresso' if side == 'inputs' else 'l’uscita'} «{port}» (ha: {', '.join(ports) or 'nessuna'})")
        return ports[port]

    def drop_invalid_edges(node: dict[str, Any]) -> None:
        ins = {item["name"] for item in effective_ports(node["id"], node.get("config") or {}, "inputs")}
        outs = {item["name"] for item in effective_ports(node["id"], node.get("config") or {}, "outputs")}
        edges[:] = [e for e in edges if (e["to"] != node["instanceId"] or _edge_port(e, "target") in ins)
                    and (e["from"] != node["instanceId"] or _edge_port(e, "source") in outs)]

    for index, op in enumerate(plan.ops, start=1):
        where = f"Modifica {index} ({op.op})"
        if op.op == "add_node":
            spec = _spec(str(op.node or ""))
            key = (op.key or "").strip() or f"n{index}"
            if not KEY_PATTERN.match(key) or key in keys or key in nodes:
                raise BlueprintError(f"{where}: chiave «{key}» non valida o già usata")
            function = _function_of(spec, op.config)
            if function and f"{spec['id'].split('.', 1)[1]}.{function}" in DESTRUCTIVE_FUNCTIONS and not allow_destructive:
                raise BlueprintError(f"{where}: {spec['id']}.{function} cancella dati o agisce in tempo reale sugli studenti: serve una richiesta esplicita dell'utente")
            if len(nodes) >= MAX_NODES:
                raise BlueprintError(f"{where}: il workflow supererebbe {MAX_NODES} nodi")
            config = {**_sanitize_config(spec["id"], op.config, warnings), **INTERACTIVE_DEFAULTS.get(spec["id"], {})}
            instance_id = f"{spec['id']}-{stamp + index}"
            node = {"id": spec["id"], "instanceId": instance_id, "x": 0, "y": 0, "status": "idle", "config": config}
            if op.label:
                node["label"] = op.label
            nodes[instance_id], keys[key] = node, instance_id
            added.append(instance_id)
            summary.append(f"Aggiunto «{_node_title(node)}»")
        elif op.op == "set_config":
            node = resolve(op.node, where)
            if not op.config and op.label is None:
                raise BlueprintError(f"{where}: nessun parametro da cambiare")
            spec = NODE_REGISTRY[node["id"]]
            merged = {**(node.get("config") or {}), **op.config}
            function = _function_of(spec, merged)
            if function and f"{spec['id'].split('.', 1)[1]}.{function}" in DESTRUCTIVE_FUNCTIONS and not allow_destructive:
                raise BlueprintError(f"{where}: {spec['id']}.{function} cancella dati o agisce in tempo reale sugli studenti: serve una richiesta esplicita dell'utente")
            node["config"] = {**_sanitize_config(spec["id"], merged, warnings), **INTERACTIVE_DEFAULTS.get(spec["id"], {})}
            if op.label is not None:
                node["label"] = op.label or None
                if not node["label"]:
                    node.pop("label")
            node["status"] = "idle"
            drop_invalid_edges(node)
            summary.append(f"Modificato «{_node_title(node)}»: {', '.join(op.config) or 'nome'}")
        elif op.op == "remove_node":
            node = resolve(op.node, where)
            edges[:] = [e for e in edges if node["instanceId"] not in (e["from"], e["to"])]
            nodes.pop(node["instanceId"])
            added = [item for item in added if item != node["instanceId"]]
            summary.append(f"Rimosso «{_node_title(node)}»")
        elif op.op == "connect":
            src_name, src_port = _split_ref(op.source, where)
            dst_name, dst_port = _split_ref(op.target, where)
            source, target = resolve(src_name, where), resolve(dst_name, where)
            out = port_of(source, src_port, "outputs", where)
            inp = port_of(target, dst_port, "inputs", where)
            if not _compatible(out["type"], inp["type"]):
                raise BlueprintError(f"{where}: tipi incompatibili {out['type']} → {inp['type']}")
            if not _is_flow_type(target["id"]):
                edges[:] = [e for e in edges if not (e["to"] == target["instanceId"] and _edge_port(e, "target") == dst_port)]
            edges.append({"id": f"edge-{stamp + 1000 + index}", "from": source["instanceId"], "sourcePort": src_port,
                          "to": target["instanceId"], "targetPort": dst_port})
            summary.append(f"Collegato «{_node_title(source)}» → «{_node_title(target)}» ({dst_port})")
        elif op.op == "replace_node":
            node = resolve(op.node, where)
            spec = _spec(str(op.with_node or ""))
            if spec["id"] == node["id"]:
                raise BlueprintError(f"{where}: «{_node_title(node)}» è già di tipo {spec['id']}: usa set_config per cambiarne i parametri")
            function = _function_of(spec, op.config)
            if function and f"{spec['id'].split('.', 1)[1]}.{function}" in DESTRUCTIVE_FUNCTIONS and not allow_destructive:
                raise BlueprintError(f"{where}: {spec['id']}.{function} cancella dati o agisce in tempo reale sugli studenti: serve una richiesta esplicita dell'utente")
            old_title, old_type = _node_title(node), node["id"]
            old_spec = NODE_REGISTRY[old_type]
            shared = {key: value for key, value in (node.get("config") or {}).items() if key in {item["name"] for item in spec["params"]}}
            kept_defaults = {item["name"]: item.get("default") for item in old_spec["params"]}
            carried = {key: value for key, value in shared.items() if value != kept_defaults.get(key)}
            node["id"] = spec["id"]
            node["config"] = {**_sanitize_config(spec["id"], {**carried, **op.config}, warnings), **INTERACTIVE_DEFAULTS.get(spec["id"], {})}
            node["status"] = "idle"
            if op.label is not None:
                node["label"] = op.label
            elif node.get("label") and node["label"] == old_spec["label"]:
                node.pop("label")
            before_edges = len(edges)
            drop_invalid_edges(node)
            # A port that still exists must also still be type-compatible with its neighbour.
            for edge in list(edges):
                other_id = edge["from"] if edge["to"] == node["instanceId"] else edge["to"] if edge["from"] == node["instanceId"] else None
                if other_id is None:
                    continue
                source, target = (nodes[edge["from"]], nodes[edge["to"]])
                try:
                    out = port_of(source, _edge_port(edge, "source"), "outputs", where)
                    inp = port_of(target, _edge_port(edge, "target"), "inputs", where)
                except BlueprintError:
                    edges.remove(edge)
                    continue
                if not _compatible(out["type"], inp["type"]):
                    edges.remove(edge)
            lost = before_edges - len(edges)
            summary.append(f"Sostituito «{old_title}» con «{_node_title(node)}»" + (f" ({lost} collegamenti da rifare)" if lost else " (collegamenti mantenuti)"))
        elif op.op == "insert_between":
            src_name, src_port = _split_ref(op.source, where)
            dst_name, dst_port = _split_ref(op.target, where)
            source, target = resolve(src_name, where), resolve(dst_name, where)
            link = next((e for e in edges if e["from"] == source["instanceId"] and _edge_port(e, "source") == src_port
                         and e["to"] == target["instanceId"] and _edge_port(e, "target") == dst_port), None)
            if link is None:
                raise BlueprintError(f"{where}: non c'è un collegamento «{op.source}» → «{op.target}» su cui inserire il nodo")
            spec = _spec(str(op.with_node or ""))
            key = (op.key or "").strip() or f"n{index}"
            if not KEY_PATTERN.match(key) or key in keys or key in nodes:
                raise BlueprintError(f"{where}: chiave «{key}» non valida o già usata")
            if len(nodes) >= MAX_NODES:
                raise BlueprintError(f"{where}: il workflow supererebbe {MAX_NODES} nodi")
            config = {**_sanitize_config(spec["id"], op.config, warnings), **INTERACTIVE_DEFAULTS.get(spec["id"], {})}
            instance_id = f"{spec['id']}-{stamp + index}"
            fresh = {"id": spec["id"], "instanceId": instance_id, "x": 0, "y": 0, "status": "idle", "config": config}
            if op.label:
                fresh["label"] = op.label
            out_type = port_of(source, src_port, "outputs", where)["type"]
            in_type = port_of(target, dst_port, "inputs", where)["type"]
            ins = [p for p in effective_ports(fresh["id"], config, "inputs") if _compatible(out_type, p["type"])]
            outs = [p for p in effective_ports(fresh["id"], config, "outputs") if _compatible(p["type"], in_type)]
            if not ins or not outs:
                raise BlueprintError(f"{where}: «{_node_title(fresh)}» non ha un ingresso compatibile con {out_type} e un'uscita compatibile con {in_type}: usa add_node e connect")
            # Prefer the port that carries the same type as the link (a table node on a table link), else the first compatible.
            pick_in = next((p for p in ins if p["type"] == out_type), ins[0])
            pick_out = next((p for p in outs if p["type"] == in_type), outs[0])
            nodes[instance_id], keys[key] = fresh, instance_id
            added.append(instance_id)
            edges.remove(link)
            edges.append({"id": f"edge-{stamp + 2000 + index}", "from": source["instanceId"], "sourcePort": src_port, "to": instance_id, "targetPort": pick_in["name"]})
            edges.append({"id": f"edge-{stamp + 3000 + index}", "from": instance_id, "sourcePort": pick_out["name"], "to": target["instanceId"], "targetPort": dst_port})
            summary.append(f"Inserito «{_node_title(fresh)}» tra «{_node_title(source)}» e «{_node_title(target)}»")
        else:  # disconnect
            dst_name, dst_port = _split_ref(op.target, where)
            target = resolve(dst_name, where)
            source_id = resolve(_split_ref(op.source, where)[0], where)["instanceId"] if op.source else None
            kept = [e for e in edges if not (e["to"] == target["instanceId"] and _edge_port(e, "target") == dst_port
                                             and (source_id is None or e["from"] == source_id))]
            if len(kept) == len(edges):
                raise BlueprintError(f"{where}: non c'è nessun collegamento verso «{dst_name}.{dst_port}»")
            edges[:] = kept
            summary.append(f"Scollegato l'ingresso «{dst_port}» di «{_node_title(target)}»")

    if not allow_rebuild:
        # An edit is a diff: the user's chain stays. Removing most of it (or removing a node only to add the same type
        # back) is a rebuild in disguise; the agent gets told to change in place instead.
        original = {node["instanceId"]: node for node in before["nodes"]}
        gone = [node_id for node_id in original if node_id not in nodes]
        if len(original) >= 3 and len(gone) > max(1, len(original) // 3):
            raise BlueprintError(
                f"La modifica toglie {len(gone)} nodi su {len(original)}: è una ricostruzione. Cambia solo ciò che serve — "
                "set_config per i parametri, replace_node per cambiare tipo mantenendo i collegamenti, insert_between per aggiungere un passo in mezzo — "
                "e lascia tutti gli altri nodi com'erano."
            )
        removed_types = {original[node_id]["id"] for node_id in gone}
        recreated = sorted({nodes[node_id]["id"] for node_id in added if nodes[node_id]["id"] in removed_types})
        if recreated:
            raise BlueprintError(
                f"Rimuovi e ricrei lo stesso tipo di nodo ({', '.join(recreated)}): usa set_config sul nodo esistente, "
                "così posizione e collegamenti restano."
            )
    graph_after = {"nodes": list(nodes.values()), "edges": edges}
    try:
        validate_graph(graph_after)
    except ValueError as exc:
        raise BlueprintError(f"Dopo la modifica il workflow non è valido: {exc}") from exc
    _place_new_nodes(graph_after, added)
    return {
        "graph": graph_after, "ops": diff_ops(before, graph_after), "summary": summary, "warnings": warnings,
        "issues": lint_graph(graph_after), "estimate": estimate_cost(graph_after), "explanation": plan.explanation.strip(),
    }


def _place_new_nodes(graph: dict[str, Any], added: list[str]) -> None:
    """Existing nodes never move; a new node goes right of what feeds it (or below the canvas) and slides down until it is free."""
    by_id = {node["instanceId"]: node for node in graph["nodes"]}
    fixed = [node for node in graph["nodes"] if node["instanceId"] not in added]
    placed = list(fixed)
    bottom = max((int(node.get("y") or 0) for node in fixed), default=ORIGIN[1] - ROW_HEIGHT)
    left = min((int(node.get("x") or 0) for node in fixed), default=ORIGIN[0])
    for node_id in added:
        node = by_id[node_id]
        parents = [by_id[e["from"]] for e in graph["edges"] if e["to"] == node_id and e["from"] in by_id and e["from"] != node_id]
        if parents:
            x = max(int(p.get("x") or 0) + _node_width(p["id"]) + NODE_GAP for p in parents)
            y = int(sum(int(p.get("y") or 0) for p in parents) / len(parents))
        else:
            x, y = left, bottom + ROW_HEIGHT
        width = _node_width(node["id"])
        while any(abs(int(o.get("x") or 0) - x) < max(width, _node_width(o["id"])) and abs(int(o.get("y") or 0) - y) < ROW_HEIGHT * 0.9 for o in placed):
            y += ROW_HEIGHT
        node["x"], node["y"] = x, y
        placed.append(node)


def diff_ops(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    """Canvas operations that turn ``before`` into ``after``: disconnect, remove, reconfigure, add, connect."""
    old_nodes = {node["instanceId"]: node for node in before["nodes"]}
    new_nodes = {node["instanceId"]: node for node in after["nodes"]}
    old_edges = {edge["id"]: edge for edge in before["edges"]}
    new_edges = {edge["id"]: edge for edge in after["edges"]}
    ops: list[dict[str, Any]] = []
    ops += [{"type": "remove_edge", "edgeId": edge_id} for edge_id in old_edges if edge_id not in new_edges]
    ops += [{"type": "remove_node", "instanceId": node_id} for node_id in old_nodes if node_id not in new_nodes]
    for node_id, node in new_nodes.items():
        if node_id in old_nodes and old_nodes[node_id]["id"] != node["id"]:
            ops.append({"type": "replace_node", "node": node})
        elif node_id in old_nodes and ((old_nodes[node_id].get("config") or {}) != (node.get("config") or {}) or old_nodes[node_id].get("label") != node.get("label")):
            ops.append({"type": "set_config", "instanceId": node_id, "config": node.get("config") or {}, "label": node.get("label")})
    ops += [{"type": "add_node", "node": node} for node_id, node in new_nodes.items() if node_id not in old_nodes]
    ops += [{"type": "connect", "edge": edge} for edge_id, edge in new_edges.items() if edge_id not in old_edges]
    return ops


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
    if kind == "data.validate":
        columns = upstream()
        if columns is None:
            return None
        return columns + (["motivo"] if port == "invalid" else [])
    if kind == "text.extract":
        return ["corrispondenza"]
    if kind == "random.values":
        return [line.split(":", 1)[0].strip() for line in re.split(r"[\n;]", str(config.get("columns") or "")) if line.strip()] or None
    if kind == "data.distinct":
        return upstream()
    if kind == "data.join":
        left, right = upstream("left"), upstream("right")
        if left is None or right is None:
            return None
        key = {str(config.get("right_on") or config.get("on") or "")}
        return left + [f"{name}_2" if name in left else name for name in right if name not in key or name in left]
    if kind in {"db.create_table"}:
        return _csv(config.get("columns")) or upstream("table")
    if kind == "db.query":
        return _csv(config.get("columns")) or None
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
    # Branching nodes: a path with no continuation silently ends the conversation / the flow.
    branch_ports = {"chatbot.if_contains": ("yes", "no"), "chatbot.yes_no": ("yes", "no"), "chatbot.check_answer": ("yes", "no"),
                    "control.if_else": ("yes", "no"), "control.compare_numbers": ("yes", "no"), "control.repeat_until": ("ok", "exhausted")}
    for node in graph["nodes"]:
        for branch in branch_ports.get(node["id"], ()):
            if not any(edge["from"] == node["instanceId"] and _edge_port(edge, "source") == branch for edge in graph["edges"]):
                title = node.get("label") or NODE_REGISTRY[node["id"]]["label"]
                issues.append(_issue("warning", node["instanceId"], f"«{title}»: l'uscita «{branch}» non è collegata: se il flusso passa da lì la conversazione si ferma"))
    # An LLM node that only restates or checks what a rule could decide (answer checking, parsing a file) hides errors.
    for node in graph["nodes"]:
        config = node.get("config") or {}
        title = node.get("label") or NODE_REGISTRY[node["id"]]["label"]
        if node["id"] == "ai.transform" and config.get("task") == "extract_table":
            feeders = [graph_node for graph_node in graph["nodes"] if any(e["to"] == node["instanceId"] and e["from"] == graph_node["instanceId"] for e in graph["edges"])]
            if any(f["id"] == "platform.files" for f in feeders):
                issues.append(_issue("warning", node["instanceId"], f"«{title}» legge un file con l'AI: per CSV/TSV/JSON «Testo → tabella» è esatto e non spende crediti"))
        if node["id"] == "control.repeat_until" and config.get("mode") == "verifica_ai":
            issues.append(_issue("warning", node["instanceId"], f"«{title}» usa un giudizio AI: se la risposta si può controllare con una regola usa «uguale», «contiene» o «Verifica risposta»"))
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
