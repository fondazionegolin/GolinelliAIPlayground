import pytest

from app.services.agentic_assistant import (
    BlueprintError, catalog_for_llm, catalog_text, compile_blueprint, estimate_cost, infer_columns, lint_graph,
)
from app.services.agentic_runtime import validate_graph

IMAGE_LOOP = {
    "title": "Galleria fantasy",
    "steps": [
        {"key": "prompts", "node": "ai.transform", "config": {"task": "prompt_table", "instruction": "20 prompt su paesaggi fantasy"}},
        {"key": "each", "node": "loop.for_each", "config": {"column": "prompt", "order": "casuale", "on_error": "salta"}, "inputs": {"table": "prompts.table"}},
        {"key": "img", "node": "platform.images", "config": {"function": "generate"}, "inputs": {"prompt": "each.value"}},
        {"key": "end", "node": "loop.collect", "inputs": {"value": "img.data_uri"}},
    ],
}


def test_image_loop_blueprint_compiles_to_a_valid_graph():
    result = compile_blueprint(IMAGE_LOOP, stamp=1000)
    graph = result["graph"]
    validate_graph(graph)
    assert [node["id"] for node in graph["nodes"]] == ["ai.transform", "loop.for_each", "platform.images", "loop.collect"]
    assert len(graph["edges"]) == 3
    assert not [issue for issue in result["issues"] if issue["severity"] == "error"]
    # canvas operations: every node added before an edge touches it, final snapshot last
    seen: set[str] = set()
    for op in result["ops"][:-1]:
        if op["type"] == "add_node":
            seen.add(op["node"]["instanceId"])
        else:
            assert op["edge"]["from"] in seen and op["edge"]["to"] in seen
    assert result["ops"][-1]["type"] == "done"


def test_layout_flows_left_to_right():
    nodes = compile_blueprint(IMAGE_LOOP, stamp=1000)["graph"]["nodes"]
    xs = [node["x"] for node in nodes]
    assert xs == sorted(xs) and len(set(xs)) == 4


def test_config_is_completed_and_sanitised():
    result = compile_blueprint(IMAGE_LOOP, stamp=1000)
    images = result["graph"]["nodes"][2]["config"]
    assert images["function"] == "generate" and images["size"] == "1024x1024"
    loop = result["graph"]["nodes"][1]["config"]
    assert loop["order"] == "casuale" and loop["limit"] == 0
    bad = {"steps": [{"key": "a", "node": "csv.synthetic", "config": {"samples": 99999, "kind": "nope", "inventato": 1}}]}
    out = compile_blueprint(bad, stamp=1)
    assert out["graph"]["nodes"][0]["config"]["samples"] == 5000  # clamped to the catalogue maximum
    assert out["graph"]["nodes"][0]["config"]["kind"] == "regression"  # invalid option -> default
    assert any("inventato" in w for w in out["warnings"]) and any("kind" in w for w in out["warnings"])


def test_estimate_counts_credit_nodes_by_loop_size():
    result = compile_blueprint(IMAGE_LOOP, stamp=1000)
    assert result["estimate"]["credit_nodes"] == [{"node": result["graph"]["nodes"][2]["instanceId"], "type": "platform.images", "function": "generate", "times": 20, "long_running": False}]
    assert result["estimate"]["llm_calls"] == 1
    capped = {**IMAGE_LOOP, "steps": [{**s, "config": {**s["config"], "limit": 5}} if s["key"] == "each" else s for s in IMAGE_LOOP["steps"]]}
    assert compile_blueprint(capped, stamp=1)["estimate"]["credit_nodes"][0]["times"] == 5


@pytest.mark.parametrize("mutation,message", [
    (lambda b: b["steps"].append({"key": "each", "node": "data.sort"}), "usata due volte"),
    (lambda b: b["steps"].append({"key": "x", "node": "nodo.inventato"}), "non esiste nel catalogo"),
    (lambda b: b["steps"][2]["inputs"].update(prompt="ghost.value"), "riferimento"),
    (lambda b: b["steps"][2]["inputs"].update(inventata="each.value"), "non ha l'ingresso"),
    (lambda b: b["steps"][1]["inputs"].update(table="prompts.nope"), "non ha l'uscita"),
    (lambda b: b["steps"][3].update(inputs={}), "Fine ciclo"),
])
def test_broken_blueprints_are_rejected_with_actionable_errors(mutation, message):
    import copy
    blueprint = copy.deepcopy(IMAGE_LOOP)
    mutation(blueprint)
    with pytest.raises(BlueprintError, match=message):
        compile_blueprint(blueprint, stamp=1)


def test_type_mismatch_is_rejected():
    with pytest.raises(BlueprintError, match="tipi incompatibili"):
        compile_blueprint({"steps": [
            {"key": "gen", "node": "ai.generate_dataset"},
            {"key": "split", "node": "data.split", "inputs": {"table": "gen.metadata"}},
        ]}, stamp=1)


def test_destructive_functions_need_explicit_permission():
    blueprint = {"steps": [{"key": "bin", "node": "platform.files", "config": {"function": "delete"}}]}
    with pytest.raises(BlueprintError, match="non lo inserisce da solo"):
        compile_blueprint(blueprint, stamp=1)
    assert compile_blueprint(blueprint, allow_destructive=True, stamp=1)["graph"]["nodes"][0]["config"]["function"] == "delete"


def test_blueprint_schema_is_enforced():
    with pytest.raises(BlueprintError):
        compile_blueprint({"steps": []})
    with pytest.raises(BlueprintError, match="chiave"):
        compile_blueprint({"steps": [{"key": "Bad Key", "node": "csv.synthetic"}]})


def test_lint_finds_unknown_columns_and_unconnected_inputs():
    result = compile_blueprint({"steps": [
        {"key": "src", "node": "csv.synthetic", "config": {"samples": 30, "features": 2}},
        {"key": "filter", "node": "data.sort", "config": {"column": "inesistente"}, "inputs": {"table": "src.table"}},
        {"key": "plot", "node": "plot.2d", "config": {"x": "feature_1", "y": "ghost"}, "inputs": {"table": "filter.table"}},
        {"key": "hist", "node": "plot.histogram"},
    ]}, stamp=1)
    messages = [issue["message"] for issue in result["issues"]]
    assert any("ghost" in m for m in messages)
    assert any("non è collegato" in m for m in messages)
    assert any(issue["severity"] == "error" for issue in result["issues"])
    assert lint_graph(result["graph"]) == result["issues"]


def test_column_inference_follows_transformations():
    graph = compile_blueprint({"steps": [
        {"key": "src", "node": "csv.synthetic", "config": {"features": 2}},
        {"key": "calc", "node": "data.compute_column", "config": {"name": "somma", "expression": "feature_1 + feature_2"}, "inputs": {"table": "src.table"}},
        {"key": "pick", "node": "data.select", "config": {"mode": "include", "columns": "somma,target"}, "inputs": {"table": "calc.table"}},
    ]}, stamp=1)["graph"]
    pick = graph["nodes"][2]["instanceId"]
    assert infer_columns(graph, graph["nodes"][1]["instanceId"], "table") == ["feature_1", "feature_2", "target", "somma"]
    assert infer_columns(graph, pick, "table") == ["somma", "target"]


def test_loop_without_known_size_warns_about_credits():
    blueprint = {"steps": [
        {"key": "src", "node": "data.saved_dataset"},
        {"key": "each", "node": "loop.for_each", "inputs": {"table": "src.table"}},
        {"key": "img", "node": "platform.images", "inputs": {"prompt": "each.value"}},
        {"key": "end", "node": "loop.collect", "inputs": {"value": "img.data_uri"}},
    ]}
    result = compile_blueprint(blueprint, stamp=1)
    assert any("Massimo cicli" in issue["message"] for issue in result["issues"])
    assert estimate_cost(result["graph"])["credit_nodes"][0]["times"] is None


def test_catalogue_for_the_architect_is_complete_and_flags_risks():
    catalogue = catalog_for_llm()
    ids = {node["id"] for node in catalogue["nodes"]}
    assert "loop.for_each" in ids and "chatbot.start" not in ids
    files = next(node for node in catalogue["nodes"] if node["id"] == "platform.files")
    assert next(fn for fn in files["functions"] if fn["id"] == "delete")["destructive"] is True
    text = catalog_text()
    assert "platform.images" in text and "[spende crediti]" in text and "[DISTRUTTIVA]" in text
    assert len(text) < 40_000


# ── LLM agents (model mocked) ─────────────────────────────────────────────────

import json
from types import SimpleNamespace

from app.services import agentic_assistant_agents as agents


def _reply(payload):
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return SimpleNamespace(content=text, provider="test", model="m", prompt_tokens=10, completion_tokens=5)


@pytest.fixture
def scripted_llm(monkeypatch):
    replies, calls = [], []

    async def fake_generate(**kwargs):
        calls.append(kwargs)
        return replies.pop(0)

    async def no_cost(*args, **kwargs):
        return None

    monkeypatch.setattr(agents.llm_service, "generate", fake_generate)
    monkeypatch.setattr(agents, "_record_cost", no_cost)
    return replies, calls


ACTOR = SimpleNamespace(id="u1", tenant_id="t1")


@pytest.mark.asyncio
async def test_intake_restates_and_asks_only_before_answers(scripted_llm):
    replies, _ = scripted_llm
    body = {"understanding": "Genero immagini.", "assumptions": ["20 immagini"], "mode": "data",
            "questions": [{"question": "Quante?", "suggestions": ["5", "20"]}] }
    replies.extend([_reply(body), _reply(body)])
    first = await agents.run_intake(None, ACTOR, "genera immagini")
    assert first["questions"] and first["mode"] == "data"
    second = await agents.run_intake(None, ACTOR, "genera immagini", [{"question": "Quante?", "answer": "20"}])
    assert second["questions"] == []


@pytest.mark.asyncio
async def test_intake_survives_a_model_that_returns_garbage(scripted_llm):
    replies, _ = scripted_llm
    replies.append(_reply("non è json"))
    result = await agents.run_intake(None, ACTOR, "fammi un grafico")
    assert result["understanding"] == "fammi un grafico" and result["questions"] == []


@pytest.mark.asyncio
async def test_architect_repairs_a_rejected_blueprint(scripted_llm):
    replies, calls = scripted_llm
    broken = {"steps": [{"key": "a", "node": "nodo.inventato"}]}
    replies.extend([_reply("```json\n" + json.dumps(broken) + "\n```"), _reply(IMAGE_LOOP)])
    result = await agents.run_architect(None, ACTOR, "20 immagini", "Genero 20 immagini", [])
    assert result["attempts"] == 2 and len(result["graph"]["nodes"]) == 4
    # the compiler's error went back to the model
    assert "non esiste nel catalogo" in calls[1]["messages"][-1]["content"]


@pytest.mark.asyncio
async def test_architect_gives_up_after_the_repair_budget(scripted_llm):
    replies, _ = scripted_llm
    replies.extend([_reply({"steps": [{"key": "a", "node": "nodo.inventato"}]}) for _ in range(3)])
    with pytest.raises(BlueprintError, match="dopo 3 tentativi"):
        await agents.run_architect(None, ACTOR, "x", "x", [])


@pytest.mark.asyncio
async def test_architect_cannot_smuggle_destructive_nodes(scripted_llm):
    replies, _ = scripted_llm
    replies.extend([_reply({"steps": [{"key": "d", "node": "platform.files", "config": {"function": "delete"}}]}) for _ in range(3)])
    with pytest.raises(BlueprintError, match="non lo inserisce da solo"):
        await agents.run_architect(None, ACTOR, "x", "x", [])


def test_assistant_roles_are_registered():
    from app.services import model_roles
    assert {"agentic.architect", "agentic.reviewer"} <= set(model_roles.ROLES)
