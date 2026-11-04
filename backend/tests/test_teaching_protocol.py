import asyncio
import copy
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.services.teaching_protocol import ProtocolPlan, descendants, execute_plan, parse_object, public_state, validate_result


def task(key, dependencies=(), kind="document"):
    return {"id": key, "kind": kind, "title": key, "instructions": "Crea il materiale richiesto", "depends_on": list(dependencies)}


def plan(*tasks):
    return ProtocolPlan.model_validate({"title": "Attività", "tasks": list(tasks)})


@pytest.mark.parametrize("tasks", [
    [task("a"), task("a")], [task("a", ["missing"])], [task("a", ["a"])],
    [task("a", ["b"]), task("b", ["a"])], [task("a", kind="delete_files")],
    [task(f"a{i}") for i in range(13)],
])
def test_invalid_graph_never_runs(tasks):
    with pytest.raises(ValidationError):
        plan(*tasks)


def test_forward_dependencies_and_transitive_descendants():
    graph = plan(task("c", ["b"]), task("a"), task("b", ["a"]), task("independent"))
    assert descendants(graph, "a") == {"a", "b", "c"}


@pytest.mark.asyncio
async def test_independent_agents_overlap_but_dependency_waits_and_concurrency_is_bounded():
    graph = plan(*(task(f"a{i}") for i in range(5)), task("dependent", ["a0", "a1"]))
    results, active, peak = {}, set(), 0
    barrier = asyncio.Event()

    async def generate(current, dependencies):
        nonlocal peak
        active.add(current.id); peak = max(peak, len(active))
        if len(active) == 3:
            barrier.set()
        await asyncio.wait_for(barrier.wait(), 1)
        if current.id == "dependent":
            assert set(dependencies) == {"a0", "a1"}
            assert all(results[key]["status"] == "ready" for key in dependencies)
        await asyncio.sleep(0)
        active.remove(current.id)
        return {"title": current.id, "text": "Risultato"}

    await execute_plan(graph, results, generate, AsyncMock())
    assert peak == 3
    assert all(value["status"] == "ready" for value in results.values())


@pytest.mark.asyncio
async def test_failure_preserves_independent_results_and_blocks_only_descendants():
    graph = plan(task("fails"), task("blocked", ["fails"]), task("works"))
    results = {}

    async def generate(current, _):
        if current.id == "fails":
            raise RuntimeError("private provider secret")
        return {"text": "ok"}

    await execute_plan(graph, results, generate, AsyncMock())
    assert results["works"]["status"] == "ready"
    assert results["fails"]["status"] == "error"
    assert results["blocked"]["status"] == "blocked"
    assert "secret" not in results["fails"]["error"]
    results["fails"] = {"status": "pending"}; results["blocked"] = {"status": "pending"}
    generate_ok = AsyncMock(return_value={"text": "recovered"})
    await execute_plan(graph, results, generate_ok, AsyncMock())
    assert generate_ok.await_count == 2  # The successful independent block is not charged again.
    assert all(value["status"] == "ready" for value in results.values())


@pytest.mark.asyncio
async def test_cancellation_stops_all_child_agents():
    started, stopped = asyncio.Event(), []

    async def generate(current, _):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.append(current.id)

    running = asyncio.create_task(execute_plan(plan(task("a"), task("b")), {}, generate, AsyncMock()))
    await started.wait(); await asyncio.sleep(0)
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert set(stopped) == {"a", "b"}


def test_quiz_types_preserved_and_invalid_answers_rejected():
    data = {"title": "Verifica", "description": "Conoscenze e autovalutazione", "questions": [
        {"question": "Descrivi il ciclo", "type": "open", "sampleAnswer": "Criteri di valutazione"},
        {"question": "Quanto hai capito?", "type": "scale", "min": 1, "max": 5},
        {"question": "Quale risposta è vera?", "options": ["A", "B"], "correctIndex": 1},
    ]}
    result = validate_result("quiz", data)
    assert [q["type"] for q in result["questions"]] == ["open", "scale", "mcq"]
    data["questions"][-1]["correctIndex"] = 9
    with pytest.raises(ValueError):
        validate_result("quiz", data)


@pytest.mark.parametrize("kind,data", [
    ("teacherbot", {"name": "Tutor", "system_prompt": ""}),
    ("sheet", {"title": "Dati", "rows": [["A", "B"], [1]]}),
    ("sheet", {"title": "Dati", "rows": [[{"script": "bad"}]]}),
    ("presentation", {"title": "Slide", "slides": []}),
    ("html_page", {"title": "Pagina", "html": "Solo testo"}),
    ("document", {"title": "Documento", "text": ""}),
])
def test_invalid_generated_or_edited_artifacts_are_rejected(kind, data):
    with pytest.raises(ValueError):
        validate_result(kind, data)


def test_private_blob_keys_are_not_returned_or_mutated():
    state = {"revision": 3, "results": {"image": {"status": "ready", "data": {"image_storage_key": "private/key", "title": "Illustrazione"}}}}
    original = copy.deepcopy(state)
    result = public_state("message", state)
    assert "image_storage_key" not in result["results"]["image"]["data"]
    assert result["results"]["image"]["data"]["image_url"].endswith("/tasks/image/image?v=3")
    assert state == original
    assert parse_object('```json\n{"title":"Test"}\n```') == {"title": "Test"}
