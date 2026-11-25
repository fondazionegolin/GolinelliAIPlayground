"""The simulated LLM of the admin stress test must speak the exact formats the Vibe Lab pipeline parses,
and only switch on with the configured secret."""
import asyncio

from app.api.v1.endpoints import coding
from app.loadtest.runner import findings, percentile
from app.services import load_simulation
from app.services.load_simulation import SimConfig

FAST = SimConfig(ttft_ms=0, tokens_per_s=5000, pad_lines=3)


def _collect(prompt: str) -> str:
    async def go():
        return "".join([c async for c in load_simulation.stream([{"role": "user", "content": prompt}], None, FAST)])
    return asyncio.run(go())


def test_architect_output_yields_usable_plan_and_shared_files():
    text = _collect("brief" + coding.ARCHITECT_FORMAT_INSTRUCTIONS)
    plan_lines = text.split("@@PLAN@@", 1)[1].split("@@SHARED@@", 1)[0].splitlines()
    plan = coding._parse_architect_plan(plan_lines)
    assert any(item["path"] == "App.tsx" for item in plan)
    parser = coding._DelimitedFileParser()
    parser.feed(text.split("@@SHARED@@", 1)[1])
    parser.finish()
    assert {f["path"] for f in parser.files} == {"types.ts", "styles.css"}


def test_worker_writes_exactly_its_assigned_files():
    prompt = "brief" + coding.WORKER_FORMAT_TEMPLATE.format(
        worker=2, paths="components/Counter.css, components/Counter.tsx", contract="c", shared="s")
    parser = coding._DelimitedFileParser()
    parser.feed(_collect(prompt))
    parser.finish()
    assert {f["path"] for f in parser.files} == {"components/Counter.tsx", "components/Counter.css"}
    assert parser.truncated_path is None


def test_simulation_requires_secret(monkeypatch):
    seen = {}

    async def app(scope, receive, send):
        seen["sim"] = load_simulation.active()

    middleware = load_simulation.LoadTestMiddleware(app)
    scope = {"type": "http", "headers": [(b"x-load-test", b"abc"), (b"x-load-test-sim", b'{"ttft_ms": 5}')]}
    monkeypatch.setattr(load_simulation.settings, "LOAD_TEST_SECRET", "")
    asyncio.run(middleware(scope, None, None))
    assert seen["sim"] is None
    monkeypatch.setattr(load_simulation.settings, "LOAD_TEST_SECRET", "abc")
    asyncio.run(middleware(scope, None, None))
    assert seen["sim"] == SimConfig(ttft_ms=5)
    monkeypatch.setattr(load_simulation.settings, "LOAD_TEST_SECRET", "other")
    asyncio.run(middleware(scope, None, None))
    assert seen["sim"] is None


def test_findings_flag_saturated_event_loop():
    report = {
        "steps": {}, "peaks": {"db_max": 100, "db_total": 90}, "logs": {"errors": {}},
        "probes": {"api": {"p50": 900, "p95": 2500, "max": 4000, "failures": 0}},
        "scenarios": {"vibe_generate": {"done": 80, "error": 20, "errors": {"HTTP 503": 20}}},
    }
    severities = [f["severity"] for f in findings(report)]
    assert severities.count("critical") == 3  # failures, event loop, DB connections
    assert percentile([1, 2, 3, 4], 0.5) == 2.5


def _project(**over):
    version = {"id": "v2", "version_number": 2, "build_status": "build_passed",
               "source_manifest_json": {"files": [{"path": "App.tsx", "content": "export default 1"}, {"path": "types.ts", "content": "x"}]}}
    project = {"status": "generated", "current_version_id": "v2", "versions": [{"id": "v1", "version_number": 1}, version]}
    project.update(over)
    return project


def test_validation_accepts_a_real_generation():
    from app.loadtest.runner import validate_generation
    assert validate_generation(_project(), {"version_number": 2, "needs_review": False}) == []


def test_validation_rejects_empty_or_unbuilt_results():
    from app.loadtest.runner import validate_generation
    empty = _project()
    empty["versions"][1]["source_manifest_json"] = {"files": []}
    assert "la versione salvata non contiene file" in validate_generation(empty, {})
    failed = _project()
    failed["versions"][1]["build_status"] = "needs_review"
    assert any("build" in p for p in validate_generation(failed, {}))
    assert any("annunciata" in p for p in validate_generation(_project(), {"version_number": 3}))
    assert validate_generation(None, {}) == ["progetto non riaperto dopo la generazione"]
    no_app = _project()
    no_app["versions"][1]["source_manifest_json"] = {"files": [{"path": "types.ts", "content": "x"}]}
    assert any("App.tsx" in p for p in validate_generation(no_app, {}))
