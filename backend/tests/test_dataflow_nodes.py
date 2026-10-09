import pytest

from app.services.agentic_runtime import execute_node_isolated, validate_graph
from app.services.dataflow_nodes import NODE_REGISTRY, execute_data_node


def test_typed_graph_accepts_compatible_ports():
    validate_graph({
        "nodes": [
            {"id": "csv.synthetic", "instanceId": "source"},
            {"id": "data.split", "instanceId": "split"},
        ],
        "edges": [{"from": "source", "to": "split", "sourcePort": "table", "targetPort": "table"}],
    })


def test_empty_draft_and_llm_dataset_node_are_supported():
    validate_graph({"nodes": [], "edges": []})
    assert NODE_REGISTRY["ai.generate_dataset"]["outputs"][0]["type"] == "TABLE"


def test_typed_graph_rejects_incompatible_ports():
    with pytest.raises(ValueError, match="Tipi incompatibili"):
        validate_graph({
            "nodes": [
                {"id": "ai.generate_dataset", "instanceId": "source"},
                {"id": "data.split", "instanceId": "split"},
            ],
            "edges": [{"from": "source", "to": "split", "sourcePort": "metadata", "targetPort": "table"}],
        })


@pytest.mark.asyncio
async def test_regression_pipeline_end_to_end():
    source = await execute_data_node("csv.synthetic", {}, {"kind": "regression", "samples": 60, "features": 3, "seed": 42}, {})
    split = await execute_data_node("data.split", {"table": source["table"]}, {"test_size": .2, "seed": 42}, {})
    trained = await execute_data_node("ml.regression", {"train": split["train"]}, {
        "target_column": "target", "feature_columns": "", "algorithm": "linear", "cv_folds": 3,
    }, {})
    predicted = await execute_data_node("ml.predict", {"model": trained["model"], "data": split["test"]}, {}, {})
    assert trained["metrics"]["r2"] > .9
    assert predicted["predictions"]["rowCount"] == 12


@pytest.mark.asyncio
async def test_single_node_execution_returns_preview_payload():
    result = await execute_node_isolated({
        "id": "csv.synthetic",
        "config": {"kind": "regression", "samples": 24, "features": 2, "seed": 7},
    }, {})
    assert result["output"]["table"]["rowCount"] == 24
    assert result["duration_ms"] >= 0


@pytest.mark.asyncio
async def test_visualizations_adapt_to_incoming_columns():
    table = {"columns": ["altezza", "peso", "gruppo"], "rows": [
        {"altezza": 160, "peso": 55, "gruppo": "A"},
        {"altezza": 170, "peso": 67, "gruppo": "B"},
        {"altezza": 180, "peso": 81, "gruppo": "A"},
    ]}
    scatter = await execute_data_node("plot.2d", {"table": table}, {"x": "x", "y": "y"}, {})
    histogram = await execute_data_node("plot.histogram", {"table": table}, {"column": "x", "bins": 3}, {})
    assert scatter["plot"]["labels"] == {"x": "altezza", "y": "peso"}
    assert histogram["plot"]["labels"]["x"] == "altezza"


@pytest.mark.asyncio
async def test_column_nodes_have_safe_defaults_and_actionable_errors():
    table = {"columns": ["a", "b"], "rows": [{"a": 1, "b": 2}, {"a": 3, "b": 4}]}
    selected = await execute_data_node("data.select", {"table": table}, {"mode": "include", "columns": ""}, {})
    assert selected["table"]["columns"] == ["a", "b"]
    with pytest.raises(ValueError, match="Disponibili: a, b"):
        await execute_data_node("data.select", {"table": table}, {"mode": "include", "columns": "missing"}, {})


@pytest.mark.asyncio
async def test_every_local_node_executor_smoke():
    """Keep catalogue entries and their runtime implementations in lockstep."""
    covered = {"ai.generate_dataset", "ai.transform", "llm_chatbot", "data.saved_dataset"}  # handled by the async workflow runtime
    covered |= {"loop.for_each", "loop.collect", "control.repeat_until"}  # runtime-level nodes
    covered |= {node_id for node_id in NODE_REGISTRY if node_id.startswith("platform.")}  # platform action dispatcher
    rows = [{"x": i, "y": i * 2 + 1, "target": i % 2, "text": "great lesson" if i % 2 else "bad lesson"} for i in range(30)]
    table = {"columns": ["x", "y", "target", "text"], "rows": rows}
    table_z = {"columns": ["z"], "rows": [{"z": i * 3} for i in range(30)]}
    numeric_table = {"columns": ["x", "y", "target"], "rows": [{k: row[k] for k in ("x", "y", "target")} for row in rows]}

    async def run(node_type, inputs, config=None, state=None):
        covered.add(node_type)
        return await execute_data_node(node_type, inputs, config or {}, state or {})

    await run("data.custom_input", {}, {"data": rows})
    await run("data.new_table", {"table": table}, {"columns": "x,y", "rename": "x:score"})
    regression_source = await run("csv.synthetic", {}, {"kind": "regression", "samples": 30, "features": 2, "seed": 3})
    await run("math.numeric_input", {}, {"value": 4})
    await run("data.rename_columns", {"table": table}, {"rename": "x:score"})
    await run("data.sort", {"table": table}, {"column": "x", "order": "descending", "limit": 5})
    await run("data.group_by", {"table": numeric_table}, {"group_column": "target", "value_columns": "x", "aggregation": "sum"})
    await run("data.compute_column", {"table": numeric_table}, {"name": "sum_xy", "expression": "x + y"})
    await run("data.select", {"table": table}, {"mode": "include", "columns": "x,y"})
    await run("data.filter", {"table": table}, {"expression": "x >= 10"})
    await run("data.dropna", {"table": table}, {"how": "any"})
    await run("data.transform", {"table": numeric_table}, {"operation": "standardize", "columns": "x,y"})
    await run("data.split", {"table": table}, {"test_size": .2, "seed": 2})
    await run("data.slice", {"table": table}, {"start": 2, "end": 8, "step": 2})
    await run("data.merge_columns", {"table_1": table, "table_2": table_z}, {"merge_mode": "horizontal"})
    await run("data.convert_to_number", {"table": {"columns": ["price"], "rows": [{"price": "1,5"}]}}, {"columns": "price", "decimal_separator": ","})
    await run("nlp.clean_text", {"table": table}, {"column": "text", "lowercase": True})
    await run("nlp.sentiment", {"table": table}, {"column": "text", "neutral_threshold": .1})
    await run("text.from_table", {"table": table}, {"format": "markdown", "max_rows": 3})
    await run("text.template", {"a": "hello", "b": "world"}, {"template": "{a} {b}"})
    await run("math.operation", {"a": 5}, {"operation": "add"})
    await run("math.result", {"value": [1, 2, 3]}, {"aggregation": "mean"})
    await run("math.aggregate", {"a": 1, "b": 2, "c": 3}, {"aggregation": "sum"})
    equation = await run("math.equation", {}, {"expression": "x**2 - 1"})
    await run("math.evaluate", {"equation": equation["equation"]}, {"x_values": "-1,0,1"})
    await run("math.function_analysis", {"equation": equation["equation"]})
    regression = await run("ml.regression", {"train": regression_source["table"]}, {"target_column": "target", "algorithm": "linear", "cv_folds": 3})
    await run("ml.predict", {"model": regression["model"], "data": regression_source["table"]})
    await run("ml.classification", {"train": numeric_table}, {"target_column": "target", "feature_columns": "x,y", "algorithm": "logistic", "cv_folds": 3})
    clustered = await run("ml.kmeans_clustering", {"table": numeric_table}, {"columns": "x,y", "clusters": 3, "normalize": True})
    assert clustered["plot"]["kind"] == "scatter"
    assert len(clustered["plot"]["color"]) == 30
    await run("plot.2d", {"table": numeric_table}, {"x": "x", "y": "y"})
    await run("plot.histogram", {"table": numeric_table}, {"column": "x", "bins": 5})
    await run("control.if_else", {"condition": True})
    await run("control.compare_numbers", {"a": 2, "b": 1}, {"operator": ">"})
    state = {}
    await run("chatbot.start", {}, {"welcome_message": "Ciao"}, state)
    await run("control.counter", {}, {"start": 0, "step": 1}, state)
    await run("chatbot.say", {}, {"message": "Ciao"}, state)
    await run("chatbot.ask", {}, {"question": "Come va?", "test_response": "Bene"}, state)
    await run("chatbot.if_contains", {"text": "è urgente"}, {"keywords": "urgente"}, state)
    await run("chatbot.yes_no", {"text": "sì"}, {}, state)
    await run("chatbot.multi_choice", {}, {"test_choice": 2, "option_2": "B"}, state)
    await run("chatbot.save_variable", {"value": 42}, {"variable_name": "answer"}, state)
    await run("chatbot.show_variables", {}, {}, state)
    await run("chatbot.end", {}, {"message": "Fine"}, state)
    assert covered == set(NODE_REGISTRY)


def _loop_graph():
    return {
        "nodes": [
            {"id": "data.custom_input", "instanceId": "prompts"},
            {"id": "loop.for_each", "instanceId": "each"},
            {"id": "text.template", "instanceId": "compose"},
            {"id": "loop.collect", "instanceId": "end"},
            {"id": "text.from_table", "instanceId": "after"},
        ],
        "edges": [
            {"from": "prompts", "to": "each", "sourcePort": "table", "targetPort": "table"},
            {"from": "each", "to": "compose", "sourcePort": "value", "targetPort": "a"},
            {"from": "compose", "to": "end", "sourcePort": "text", "targetPort": "value"},
            {"from": "end", "to": "after", "sourcePort": "table", "targetPort": "table"},
        ],
    }


def test_for_each_loop_is_valid_and_ordered_as_one_unit():
    from app.services.agentic_runtime import _forward_graph, _loop_groups, _loop_members, _plan_order

    graph = _loop_graph()
    validate_graph(graph)
    groups = _loop_groups(graph)
    assert groups["each"] == {"collect": "end", "body": {"compose"}}
    order = [node["instanceId"] for node in _plan_order(_forward_graph(graph), _loop_members(groups))]
    assert order == ["prompts", "each", "after"]


def test_for_each_requires_a_closing_node():
    graph = _loop_graph()
    graph["nodes"] = [node for node in graph["nodes"] if node["instanceId"] not in {"end", "after"}]
    graph["edges"] = graph["edges"][:2]
    with pytest.raises(ValueError, match="Fine ciclo"):
        validate_graph(graph)


def test_loop_rows_follow_order_and_limit():
    from app.services.agentic_runtime import _iteration_output, _loop_rows

    table = {"columns": ["prompt"], "rows": [{"prompt": "a"}, {"prompt": "b"}, {"prompt": "c"}]}
    assert [row["prompt"] for _, row in _loop_rows(table, {})] == ["a", "b", "c"]
    assert len(_loop_rows(table, {"limit": 2})) == 2
    assert sorted(row["prompt"] for _, row in _loop_rows(table, {"order": "casuale"})) == ["a", "b", "c"]
    assert _iteration_output({"prompt": "a"}, 1, 1, {"column": "prompt"})["value"] == "a"
    with pytest.raises(ValueError, match="vuota"):
        _loop_rows({"columns": [], "rows": []}, {})
