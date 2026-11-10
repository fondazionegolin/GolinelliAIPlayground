"""Regression coverage for generating, cleaning, enriching and plotting student datasets."""
import copy
import json
import re
from types import SimpleNamespace

import pytest

from app.services import agentic_runtime as runtime
from app.services.agentic_assistant import apply_patch, catalog_text, compile_blueprint, infer_columns, lint_graph
from app.services.agentic_assistant_agents import ARCHITECT_SYSTEM, EDITOR_SYSTEM
from app.services.dataflow_nodes import execute_data_node


CONFIG = {"name": "criticita", "instruction": "Valuta la necessità di supporto: 0 minima, 10 massima.",
          "output_type": "number", "min_value": 0, "max_value": 10, "batch_size": 25}


def reply(value):
    return SimpleNamespace(content=json.dumps(value), provider="test", model="m", prompt_tokens=10, completion_tokens=5)


@pytest.mark.asyncio
async def test_all_rows_are_enriched_and_reordered_responses_keep_student_identity(monkeypatch):
    table = {"columns": ["studente", "voto"], "rows": [{"studente": f"S{i}", "voto": i % 11} for i in range(63)]}
    original = copy.deepcopy(table)
    calls = []

    async def generate(**kwargs):
        calls.append(kwargs)
        rows = json.loads(kwargs["messages"][0]["content"].split("RIGHE:\n")[1])
        return reply([{"row_id": row["row_id"], "value": 10 - row["data"]["voto"]} for row in reversed(rows)])

    monkeypatch.setattr(runtime.llm_service, "generate", generate)
    monkeypatch.setattr(runtime, "_pick_model", lambda *args: ("test", "m"))
    result = await runtime.execute_node_isolated({"id": "ai.add_column", "config": CONFIG}, {"table": table})
    out = result["output"]
    assert out["table"]["columns"] == ["studente", "voto", "criticita"]
    assert out["table"]["rowCount"] == 63
    assert out["table"]["rows"] == [{**row, "criticita": 10 - row["voto"]} for row in table["rows"]]
    assert table == original
    assert out["metadata"]["llm_calls"] == len(calls) == 3
    assert result["prompt_tokens"] == 30 and result["completion_tokens"] == 15


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [
    [{"row_id": 0, "value": 3}, {"row_id": 0, "value": 4}],
    [{"row_id": 0, "value": 3}],
    [{"row_id": 0, "value": 3}, {"row_id": 99, "value": 4}],
    [{"row_id": 0, "value": 3}, {"row_id": 1, "value": 11}],
    [{"row_id": 0, "value": 3}, {"row_id": 1, "value": -1}],
    [{"row_id": 0, "value": 3}, {"row_id": 1, "value": "alto"}],
    [{"row_id": 0, "value": 3}, {"row_id": 1, "value": True}],
    [{"row_id": 0, "value": 3}, {"row_id": 1, "value": None}],
    [{"row_id": 0, "value": 3}, {"row_id": 1, "value": float("nan")}],
    {"rows": []},
])
async def test_invalid_model_values_never_silently_change_the_dataset(monkeypatch, response):
    table = {"columns": ["studente"], "rows": [{"studente": "Ada"}, {"studente": "Bea"}]}
    original = copy.deepcopy(table)

    async def generate(**kwargs):
        return reply(response)

    monkeypatch.setattr(runtime.llm_service, "generate", generate)
    with pytest.raises(ValueError, match="Colonna AI"):
        await runtime._ai_add_column({"table": table}, CONFIG, "test", "m")
    assert table == original


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,value", [("text", "supporto linguistico"), ("boolean", False), ("number", 0)])
async def test_column_types_and_optional_analysis_context(monkeypatch, kind, value):
    async def generate(**kwargs):
        assert "Analisi precedente" in kwargs["messages"][0]["content"]
        return reply([{"row_id": 0, "value": value}])

    monkeypatch.setattr(runtime.llm_service, "generate", generate)
    out, *_ = await runtime._ai_add_column({"table": [{"studente": "Ada"}], "extra": "Analisi precedente"}, {**CONFIG, "output_type": kind}, "test", "m")
    assert out["table"]["rows"][0]["criticita"] == value


@pytest.mark.asyncio
async def test_empty_table_and_config_guards_do_not_call_the_model(monkeypatch):
    async def generate(**kwargs):
        pytest.fail("No model call expected")

    monkeypatch.setattr(runtime.llm_service, "generate", generate)
    out, *_ = await runtime._ai_add_column({"table": {"columns": ["studente"], "rows": []}}, CONFIG, "test", "m")
    assert out["table"] == {"columns": ["studente", "criticita"], "rows": [], "rowCount": 0}
    for config in ({**CONFIG, "name": "studente"}, {**CONFIG, "instruction": ""}, {**CONFIG, "min_value": 11}):
        with pytest.raises(ValueError):
            await runtime._ai_add_column({"table": [{"studente": "Ada"}]}, config, "test", "m")


def student_blueprint():
    return json.loads(re.search(r"ESEMPIO 7[^\n]*\n(\{.*?\})\n\n", ARCHITECT_SYSTEM, re.S)[1])


@pytest.mark.asyncio
async def test_student_pipeline_from_architect_example_to_bar_chart(monkeypatch):
    async def generate(**kwargs):
        if "RIGHE:\n" in kwargs["messages"][0]["content"]:
            batch = json.loads(kwargs["messages"][0]["content"].split("RIGHE:\n")[1])
            return reply([{"row_id": row["row_id"], "value": 10 - row["data"]["performance"]} for row in reversed(batch)])
        return reply([
            {"studente": "Ada", "performance": "4,5", "italiano": "3,5", "fratelli_sorelle": "2"},
            {"studente": "Bea", "performance": "9", "italiano": "8", "fratelli_sorelle": "1"},
            {"studente": "Carlo", "performance": "6", "italiano": "6", "fratelli_sorelle": "0"},
            {"studente": "Ada", "performance": "4,5", "italiano": "3,5", "fratelli_sorelle": "2"},
            {"studente": "Scarto", "performance": "assente", "italiano": "5", "fratelli_sorelle": "3"},
        ])

    monkeypatch.setattr(runtime.llm_service, "generate", generate)
    monkeypatch.setattr(runtime, "_pick_model", lambda *args: ("test", "m"))
    compiled = compile_blueprint(student_blueprint(), stamp=1)
    graph = compiled["graph"]
    assert not [i for i in compiled["issues"] if i["severity"] == "error"]
    assert compiled["estimate"]["llm_calls"] == 3  # generation + at most two scoring batches
    outputs = {}
    for node in runtime._execution_order(graph):
        inputs = {e["targetPort"]: outputs[e["from"]][e["sourcePort"]] for e in graph["edges"] if e["to"] == node["instanceId"]}
        outputs[node["instanceId"]], *_ = await runtime._execute(node["id"], inputs, node["config"], {})
    score = graph["nodes"][-2]["instanceId"]
    assert infer_columns(graph, score, "table") == ["studente", "performance", "italiano", "fratelli_sorelle", "criticita"]
    table = outputs[score]["table"]
    assert table["rowCount"] == 3 and [r["criticita"] for r in table["rows"]] == [5.5, 1, 4]
    plot = outputs[graph["nodes"][-1]["instanceId"]]["plot"]
    assert plot["kind"] == "bar" and plot["x"] == ["Ada", "Bea", "Carlo"] and plot["y"] == [5.5, 1, 4]
    assert plot["labels"] == {"x": "studente", "y": "criticita"}


def test_editor_can_insert_scoring_and_rewire_chart_without_rebuilding():
    graph = compile_blueprint({"steps": [
        {"key": "src", "node": "ai.generate_dataset", "config": {"columns": "studente,performance", "rows": 30}},
        {"key": "bar", "node": "plot.bar", "config": {"x": "studente", "y": "performance"}, "inputs": {"table": "src.table"}},
    ]}, stamp=1)["graph"]
    source, bar = [n["instanceId"] for n in graph["nodes"]]
    edited = apply_patch(graph, {"ops": [
        {"op": "insert_between", "source": f"{source}.table", "target": f"{bar}.table", "key": "score", "with_node": "ai.add_column", "config": CONFIG},
        {"op": "set_config", "node": bar, "config": {"y": "criticita"}},
    ]}, allow_rebuild=False)
    assert not [i for i in edited["issues"] if i["severity"] == "error"]
    assert edited["graph"]["nodes"][0] == graph["nodes"][0]
    for prompt in (ARCHITECT_SYSTEM, EDITOR_SYSTEM, catalog_text()):
        assert "ai.add_column" in prompt and "plot.bar" in prompt


def test_lint_explains_why_custom_llm_cannot_feed_a_table_port():
    result = compile_blueprint({"steps": [
        {"key": "ai", "node": "ai.transform", "config": {"task": "custom", "instruction": "Aggiungi criticita"}},
        {"key": "out", "node": "data.new_table", "inputs": {"table": "ai.table"}},
    ]})
    assert any(i["severity"] == "error" and "ai.add_column" in i["message"] for i in lint_graph(result["graph"]))


@pytest.mark.asyncio
async def test_bar_preserves_text_categories_and_rejects_invalid_numeric_values():
    with pytest.raises(ValueError, match="numerici finiti"):
        await execute_data_node("plot.bar", {"table": [{"studente": "Ada", "criticita": float("inf")}]}, {"x": "studente", "y": "criticita"}, {})
    with pytest.raises(ValueError, match="non presenti"):
        await execute_data_node("plot.bar", {"table": [{"studente": "Ada", "voto": 5}]}, {"x": "studente", "y": "criticita"}, {})
    plot = await execute_data_node("plot.bar", {"table": [{"studente": "Ada", "criticita": "5.5"}]}, {"x": "studente", "y": "criticita"}, {})
    assert plot["plot"]["y"] == [5.5]


@pytest.mark.asyncio
async def test_architect_repairs_runtime_invalid_table_connections(monkeypatch):
    from app.services import agentic_assistant_agents as agents

    invalid = {"steps": [
        {"key": "ai", "node": "ai.transform", "config": {"task": "custom", "instruction": "Aggiungi criticita"}},
        {"key": "out", "node": "data.new_table", "inputs": {"table": "ai.table"}},
    ]}
    replies = [reply(invalid), reply(student_blueprint())]
    calls = []

    async def generate(*args, **kwargs):
        calls.append(args)
        return replies.pop(0)

    async def no_cost(*args, **kwargs):
        pass

    monkeypatch.setattr(agents, "_generate", generate)
    monkeypatch.setattr(agents, "_record_cost", no_cost)
    result = await agents.run_architect(None, SimpleNamespace(), "Valuta criticità", "Punteggio AI 0-10", [])
    assert result["attempts"] == len(calls) == 2
    assert not [i for i in result["issues"] if i["severity"] == "error"]


@pytest.mark.asyncio
async def test_execution_api_exposes_ai_column_and_bar(monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from app.api.v1.endpoints import agentic
    from app.api.deps import get_current_admin
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(agentic.router, prefix="/agentic")
    app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id="test", tenant_id=None)
    app.dependency_overrides[get_db] = lambda: None
    monkeypatch.setattr(runtime, "_pick_model", lambda *args: ("test", "m"))

    async def refresh_cache():
        pass

    monkeypatch.setattr(agentic.model_selection, "refresh_cache", refresh_cache)
    monkeypatch.setattr(agentic, "configured_models", lambda: [])

    async def generate(**kwargs):
        return reply([{"row_id": 0, "value": 7.5}])

    monkeypatch.setattr(runtime.llm_service, "generate", generate)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        registry = (await client.get("/agentic/registry")).json()
        assert {"ai.add_column", "plot.bar"} <= {n["id"] for n in registry["nodes"]}
        response = await client.post("/agentic/execute-node", json={"node": {"id": "ai.add_column", "config": CONFIG}, "inputs": {"table": [{"studente": "Ada"}]}})
        assert response.status_code == 200, response.text
        table = response.json()["output"]["table"]
        response = await client.post("/agentic/execute-node", json={"node": {"id": "plot.bar", "config": {"x": "studente", "y": "criticita"}}, "inputs": {"table": table}})
        assert response.status_code == 200, response.text
        assert response.json()["output"]["plot"]["x"] == ["Ada"]
        assert response.json()["output"]["plot"]["y"] == [7.5]
        response = await client.post("/agentic/execute-node", json={"node": {"id": "ai.add_column", "config": {**CONFIG, "max_value": 5}}, "inputs": {"table": [{"studente": "Ada"}]}})
        assert response.status_code == 422 and "valore non valido" in response.json()["detail"]
