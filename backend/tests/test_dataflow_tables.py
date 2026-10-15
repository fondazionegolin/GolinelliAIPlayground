import asyncio

import pytest

from app.services import dataflow_tables as dt
from app.services.agentic_runtime import validate_graph
from app.services.dataflow_nodes import NODE_REGISTRY, execute_data_node, random_table


class FakeDb:
    def __init__(self):
        self.added = []

    def add(self, record):
        self.added.append(record)

    async def commit(self):
        pass


@pytest.fixture
def store(monkeypatch):
    tables = {}

    async def fake_load(db, workflow_id, name, lock=False):
        return tables.get(name)

    monkeypatch.setattr(dt, "_load", fake_load)
    db = FakeDb()
    original_add = db.add

    def add(record):
        original_add(record)
        tables[record.name] = record

    db.add = add
    return db, tables


def run(db, node, config, inputs=None, variables=None):
    state = {"workflow_id": "wf", "variables": variables or {}}
    return asyncio.run(dt.run_db_node(node, inputs or {}, {"table_name": "domande", **config}, state, db))


def test_registry_has_database_nodes():
    for node in dt.DB_NODES | {"random.values", "data.join", "data.distinct"}:
        assert node in NODE_REGISTRY
    assert all(NODE_REGISTRY[node]["category"] == "Database" for node in dt.DB_NODES)


def test_insert_pick_update_delete_cycle(store):
    db, _ = store
    run(db, "db.insert", {"values": "tema=mare; punti=3"})
    out = run(db, "db.insert", {"values": "tema=sole; punti=7"})
    assert out["count"] == 1 and out["table"]["rowCount"] == 2
    assert out["table"]["rows"][0]["punti"] == 3 and isinstance(out["table"]["rows"][0]["punti"], int)
    assert run(db, "db.count", {"where": "punti > 5"})["count"] == 1
    picked = run(db, "db.random_pick", {"where": "punti > 5"})
    assert picked["row"]["tema"] == "sole"
    assert run(db, "db.update", {"where": "tema == 'mare'", "set": "punti=10"})["count"] == 1
    top = run(db, "db.query", {"order_by": "punti", "order": "descending", "limit": 1})
    assert top["table"]["rows"][0]["tema"] == "mare"
    assert run(db, "db.delete_rows", {"where": "punti < 8"})["count"] == 1
    assert run(db, "db.read", {})["table"]["rowCount"] == 1


def test_random_pick_remove_drains_table(store):
    db, _ = store
    run(db, "db.insert", {}, inputs={"table": {"columns": ["n"], "rows": [{"n": 1}, {"n": 2}, {"n": 3}]}})
    seen = {run(db, "db.random_pick", {"remove": True})["row"]["n"] for _ in range(3)}
    assert seen == {1, 2, 3}
    with pytest.raises(ValueError, match="vuota"):
        run(db, "db.random_pick", {})
    assert run(db, "db.random_pick", {"on_empty": "ignora"})["row"] is None


def test_variables_and_connected_row(store):
    db, _ = store
    run(db, "db.insert", {"values": "risposta=$risp"}, inputs={"row": {"studente": "Ada"}}, variables={"risp": "42"})
    row = run(db, "db.read", {})["table"]["rows"][0]
    assert row == {"studente": "Ada", "risposta": 42}


def test_guards(store):
    db, _ = store
    with pytest.raises(ValueError, match="non esiste"):
        run(db, "db.read", {})
    run(db, "db.insert", {"values": "a=1"})
    with pytest.raises(ValueError, match="condizione"):
        run(db, "db.delete_rows", {})
    assert run(db, "db.delete_rows", {"delete_all": True})["count"] == 1
    with pytest.raises(ValueError, match="salvando"):
        asyncio.run(dt.run_db_node("db.read", {}, {"table_name": "x"}, {}, db))


def test_create_table_keep_and_replace(store):
    db, _ = store
    run(db, "db.create_table", {"columns": "nome,punti"})
    run(db, "db.insert", {"values": "nome=Ada; punti=1"})
    assert run(db, "db.create_table", {"columns": "nome,punti"})["table"]["rowCount"] == 1
    assert run(db, "db.create_table", {"columns": "nome,punti", "if_exists": "replace"})["table"]["rowCount"] == 0


def test_random_values_and_seed():
    cfg = {"columns": "id:id\nvoto:int:1-10\ncolore:choice:rosso|blu\nok:bool\ngiorno:date:2024-01-01..2024-01-31", "rows": 20, "seed": 5}
    table = random_table(cfg)
    assert table["columns"] == ["id", "voto", "colore", "ok", "giorno"] and table["rowCount"] == 20
    assert all(1 <= row["voto"] <= 10 and row["colore"] in {"rosso", "blu"} for row in table["rows"])
    assert random_table(cfg) == table
    with pytest.raises(ValueError, match="non valida"):
        random_table({"columns": "x:int:abc"})


def test_join_and_distinct():
    left = {"columns": ["id", "a"], "rows": [{"id": 1, "a": "x"}, {"id": 2, "a": "y"}, {"id": 2, "a": "y"}]}
    right = {"columns": ["id", "b"], "rows": [{"id": 2, "b": "z"}]}
    joined = asyncio.run(execute_data_node("data.join", {"left": left, "right": right}, {"on": "id"}, {}))["table"]
    assert joined["rowCount"] == 2 and joined["rows"][0]["b"] == "z"
    distinct = asyncio.run(execute_data_node("data.distinct", {"table": left}, {}, {}))["table"]
    assert distinct["rowCount"] == 2


def test_graph_with_after_port_validates():
    graph = {"nodes": [
        {"instanceId": "a", "id": "db.insert", "config": {"table_name": "t", "values": "x=1"}},
        {"instanceId": "b", "id": "db.random_pick", "config": {"table_name": "t"}}],
        "edges": [{"from": "a", "to": "b", "sourcePort": "table", "targetPort": "after", "type": "table"}]}
    validate_graph(graph)


def test_architect_prompt_example_compiles():
    import json
    import re

    from app.services.agentic_assistant import compile_blueprint, parse_blueprint
    from app.services.agentic_assistant_agents import ARCHITECT_SYSTEM

    examples = re.findall(r"ESEMPIO \d[^\n]*\n(\{.*?\})\n\n", ARCHITECT_SYSTEM, re.S)
    assert len(examples) >= 6
    for raw in examples:
        result = compile_blueprint(parse_blueprint(json.loads(raw)))
        assert result["graph"]["nodes"]


# ── assistant: editing an existing canvas ────────────────────────────────────

def _canvas():
    from app.services.agentic_assistant import compile_blueprint, parse_blueprint

    blueprint = parse_blueprint({"title": "t", "steps": [
        {"key": "src", "node": "random.values", "config": {"columns": "voto:int:1-10", "rows": 5}},
        {"key": "flt", "node": "data.filter", "config": {"expression": "voto > 3"}, "inputs": {"table": "src.table"}},
        {"key": "srt", "node": "data.sort", "config": {"column": "voto"}, "inputs": {"table": "flt.table"}}]})
    return compile_blueprint(blueprint, stamp=1000)["graph"]


def test_patch_insert_node_between_and_reconfigure():
    from app.services.agentic_assistant import apply_patch

    graph = _canvas()
    src, flt, srt = (node["instanceId"] for node in graph["nodes"])
    xs = {node["instanceId"]: (node["x"], node["y"]) for node in graph["nodes"]}
    result = apply_patch(graph, {"explanation": "ok", "ops": [
        {"op": "set_config", "node": flt, "config": {"expression": "voto > 5"}},
        {"op": "add_node", "key": "dst", "node": "data.distinct", "config": {}},
        {"op": "connect", "source": f"{flt}.table", "target": "dst.table"},
        {"op": "connect", "source": "dst.table", "target": f"{srt}.table"}]}, stamp=2000)
    after = result["graph"]
    assert len(after["nodes"]) == 4 and len(after["edges"]) == 3
    assert next(n for n in after["nodes"] if n["instanceId"] == flt)["config"]["expression"] == "voto > 5"
    assert {n["instanceId"]: (n["x"], n["y"]) for n in after["nodes"] if n["instanceId"] in xs} == xs  # nothing moved
    kinds = [op["type"] for op in result["ops"]]
    assert kinds.count("add_node") == 1 and "set_config" in kinds and "remove_edge" in kinds
    assert not [i for i in result["issues"] if i["severity"] == "error"]
    assert len(result["summary"]) == 4
    assert _canvas() == graph  # input untouched


def test_patch_remove_and_errors_are_actionable():
    from app.services.agentic_assistant import BlueprintError, apply_patch

    graph = _canvas()
    _, flt, srt = (node["instanceId"] for node in graph["nodes"])
    removed = apply_patch(graph, {"ops": [{"op": "remove_node", "node": flt}]})
    assert len(removed["graph"]["nodes"]) == 2
    assert any(i["severity"] == "error" for i in removed["issues"])  # sort lost its input: the lint says so
    with pytest.raises(BlueprintError, match="non esiste"):
        apply_patch(graph, {"ops": [{"op": "set_config", "node": "nope", "config": {"a": 1}}]})
    with pytest.raises(BlueprintError, match="ingresso"):
        apply_patch(graph, {"ops": [{"op": "connect", "source": f"{flt}.table", "target": f"{srt}.nope"}]})
    with pytest.raises(BlueprintError, match="collegamento"):
        apply_patch(graph, {"ops": [{"op": "disconnect", "target": f"{_canvas()['nodes'][0]['instanceId']}.table"}]})


def test_generated_chatbot_nodes_never_answer_themselves():
    from app.services.agentic_assistant import apply_patch, compile_blueprint, parse_blueprint

    plan = compile_blueprint(parse_blueprint({"steps": [
        {"key": "q", "node": "chatbot.ask", "config": {"question": "Come ti chiami?", "test_response": "Ada"}},
        {"key": "c", "node": "chatbot.multi_choice", "config": {"test_choice": 2}, "inputs": {"trigger": "q.response"}}]}))
    assert plan["graph"]["nodes"][0]["config"]["test_response"] == ""
    assert plan["graph"]["nodes"][1]["config"]["test_choice"] == 0
    edited = apply_patch(plan["graph"], {"ops": [{"op": "set_config", "node": plan["graph"]["nodes"][0]["instanceId"], "config": {"test_response": "Bea"}}]})
    assert edited["graph"]["nodes"][0]["config"]["test_response"] == ""


def test_replace_and_insert_between_keep_the_chain():
    from app.services.agentic_assistant import apply_patch

    graph = _canvas()
    src, flt, srt = (node["instanceId"] for node in graph["nodes"])
    result = apply_patch(graph, {"ops": [
        {"op": "replace_node", "node": flt, "with_node": "data.dropna"},
        {"op": "insert_between", "source": f"{flt}.table", "target": f"{srt}.table", "key": "dst", "with_node": "data.distinct"}]},
        allow_rebuild=False, stamp=5000)
    after = result["graph"]
    assert next(n for n in after["nodes"] if n["instanceId"] == flt)["id"] == "data.dropna"
    assert len(after["nodes"]) == 4 and len(after["edges"]) == 3
    assert not [i for i in result["issues"] if i["severity"] == "error"]
    kinds = [op["type"] for op in result["ops"]]
    assert "replace_node" in kinds and kinds.count("add_node") == 1


def test_rebuild_is_refused_unless_requested():
    from app.services.agentic_assistant import BlueprintError, apply_patch, wants_rebuild

    graph = _canvas()
    ids = [node["instanceId"] for node in graph["nodes"]]
    with pytest.raises(BlueprintError, match="ricostruzione"):
        apply_patch(graph, {"ops": [{"op": "remove_node", "node": ids[0]}, {"op": "remove_node", "node": ids[1]}]}, allow_rebuild=False)
    with pytest.raises(BlueprintError, match="stesso tipo"):
        apply_patch(graph, {"ops": [{"op": "remove_node", "node": ids[1]}, {"op": "add_node", "key": "nuovo", "node": "data.filter"}]}, allow_rebuild=False)
    assert wants_rebuild("rifai tutto da capo") and not wants_rebuild("aggiungi un filtro")
    apply_patch(graph, {"ops": [{"op": "remove_node", "node": ids[0]}, {"op": "remove_node", "node": ids[1]}]}, allow_rebuild=True)


def test_algorithmic_file_and_chat_nodes():
    import asyncio as aio

    csv_text = "nome;punti\nAda;90\nBea;abc\n;50\nCarlo;70"
    table = aio.run(execute_data_node("data.parse_text", {"text": csv_text}, {}, {}))["table"]
    assert table["columns"] == ["nome", "punti"] and table["rowCount"] == 4
    out = aio.run(execute_data_node("data.validate", {"table": table}, {"rules": "nome:not_empty\npunti:number:0-100"}, {}))
    assert out["report"] == {"totale": 4, "valide": 2, "scartate": 2} and out["ok"] is None
    assert {row["motivo"] for row in out["invalid"]["rows"]} == {"punti: non è un numero", "nome: vuoto"}
    clean = aio.run(execute_data_node("data.validate", {"table": out["valid"]}, {"rules": "punti:number:0-100\nnome:unique"}, {}))
    assert clean["ok"] is True
    with pytest.raises(ValueError, match="righe non valide"):
        aio.run(execute_data_node("data.validate", {"table": table}, {"rules": "punti:number", "on_invalid": "errore"}, {}))
    assert aio.run(execute_data_node("chatbot.check_answer", {"text": "  Il risultato è 56. "}, {"expected": "56", "mode": "numero"}, {}))["yes"]
    assert aio.run(execute_data_node("chatbot.check_answer", {"text": "Roma"}, {"expected": "roma, la capitale", "mode": "uguale"}, {}))["yes"]
    assert aio.run(execute_data_node("chatbot.check_answer", {"text": "55.9"}, {"expected": "56", "mode": "numero", "tolerance": 0.2}, {}))["yes"]
    assert aio.run(execute_data_node("chatbot.check_answer", {"text": "boh"}, {"expected": "56", "mode": "numero"}, {}))["no"]
    found = aio.run(execute_data_node("text.extract", {"text": "ordini 12 e 7, poi 30"}, {"pattern": r"(\d+)"}, {}))
    assert [r["gruppo_1"] for r in found["table"]["rows"]] == ["12", "7", "30"] and found["first"] == "12"
    said = aio.run(execute_data_node("chatbot.say", {"value": {"columns": ["a"], "rows": [{"a": 1}]}}, {"message": "Ecco:\n{valore}"}, {}))
    assert "| a |" in said["message"]
