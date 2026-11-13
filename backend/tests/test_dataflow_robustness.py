import pytest

from app.services.dataflow_nodes import execute_data_node, llm_rows, slug_column

pytestmark = pytest.mark.asyncio

TABLE = {"columns": ["month n°", "Students", "failed courses"], "rowCount": 3, "rows": [
    {"month n°": 1, "Students": 10, "failed courses": 0}, {"month n°": 2, "Students": 20, "failed courses": 2},
    {"month n°": 3, "Students": 30, "failed courses": 5}]}


async def run(node, config, **inputs):
    return await execute_data_node(node, inputs or {"table": TABLE}, config, {})


def test_slug():
    assert slug_column("Month N°") == "month_n"
    assert slug_column("Emissioni CO₂ (Mt)") == "emissioni_co2_mt"
    assert slug_column("2024 totale") == "c_2024_totale"


async def test_select_tolerates_naming():
    out = await run("data.select", {"mode": "include", "columns": "month_n, students"})
    assert out["table"]["columns"] == ["month n°", "Students"]


async def test_formula_with_int_and_loose_names():
    out = await run("data.compute_column", {"name": "bocciato", "expression": "int(failed_courses > 1)"})
    assert [r["bocciato"] for r in out["table"]["rows"]] == [0, 1, 1]
    out = await run("data.compute_column", {"name": "x", "expression": "`failed courses` * Students"})
    assert [r["x"] for r in out["table"]["rows"]] == [0, 40, 150]


async def test_formula_undefined_word_is_explained():
    with pytest.raises(ValueError, match="virgolette"):
        await run("data.compute_column", {"name": "x", "expression": "bocciato + 1"})


async def test_formula_cannot_escape():
    with pytest.raises(ValueError):
        await run("data.compute_column", {"name": "x", "expression": "__import__('os').system('id')"})


async def test_filter_and_group():
    out = await run("data.filter", {"expression": "students >= 20 and failed_courses > 1"})
    assert out["table"]["rowCount"] == 2
    out = await run("data.group_by", {"group_column": "month_n", "aggregation": "sum", "value_columns": "students"})
    assert out["table"]["rowCount"] == 3


async def test_missing_port_is_readable():
    with pytest.raises(ValueError, match="collega un nodo"):
        await execute_data_node("ml.classification", {}, {}, {})


def test_llm_rows_truncated_json_keeps_complete_rows():
    raw = '[{"anno": 2015, "mese": 1}, {"anno": 2015, "mese": 2}, {"anno": 2015, "me'
    assert llm_rows(raw) == [{"anno": 2015, "mese": 1}, {"anno": 2015, "mese": 2}]


def test_llm_rows_fenced_and_csv_and_garbage():
    assert llm_rows('```json\n[{"a":1}]\n```') == [{"a": 1}]
    assert llm_rows("a,b\n1,2\n3,4") == [{"a": "1", "b": "2"}, {"a": "3", "b": "4"}]
    with pytest.raises(ValueError):
        llm_rows("Mi dispiace, non posso.")
