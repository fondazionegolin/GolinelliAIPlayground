import base64
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import httpx
from fastapi import FastAPI
from PIL import Image
from pydantic import ValidationError

from app.api.deps import get_current_user
from app.api.v1.endpoints.visual_comprehension import TurnRequest, router
from app.models.enums import UserRole
from app.services import visual_comprehension as vc
from app.services.llm_service import LLMResponse


def image_url():
    data = io.BytesIO()
    Image.new("RGB", (160, 100), "white").save(data, "PNG")
    return "data:image/png;base64," + base64.b64encode(data.getvalue()).decode()


GROUNDING = {
    "subject": "Funzione", "overview": "Una radice quadrata",
    "regions": [{"id": "formula", "label": "Formula", "text": "sqrt(x-2)",
                 "box": {"x": 10, "y": 20, "width": 40, "height": 20}, "confidence": "high"}],
    "warnings": [],
}
LESSON = {"title": "Dominio", "summary": "Studiamo gli ingressi ammessi", "steps": [
    {"title": "Radicando", "action": "Osserva il radicando", "explanation": "Considera quali ingressi sono ammessi",
     "overlays": [{"kind": "highlight", "region_id": "formula", "color": "amber", "label": "Radicando"}],
     "question": "È ammesso 1?", "answer": "No", "hint": "Pensa al segno del numero dentro la radice."},
]}


def test_normalize_checks_actual_image_bytes_and_preserves_geometry():
    out = vc.normalize_image(image_url())
    with Image.open(io.BytesIO(base64.b64decode(out.split(",")[1]))) as img:
        assert img.size == (160, 100)
    for invalid in ["data:image/svg+xml;base64,PHN2Zy8+", "https://example.org/a.png", "data:image/png;base64,YmFk"]:
        with pytest.raises(ValueError):
            vc.normalize_image(invalid)


def test_exif_orientation_matches_the_displayed_source():
    data = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (160, 100)).save(data, "JPEG", exif=exif)
    out = vc.normalize_image("data:image/jpeg;base64," + base64.b64encode(data.getvalue()).decode())
    with Image.open(io.BytesIO(base64.b64decode(out.split(",")[1]))) as img:
        assert img.size == (100, 160)


def test_animated_input_is_rejected():
    data = io.BytesIO()
    Image.new("RGB", (20, 20), "red").save(data, "PNG", save_all=True, append_images=[Image.new("RGB", (20, 20), "blue")])
    with pytest.raises(ValueError, match="statica"):
        vc.normalize_image("data:image/png;base64," + base64.b64encode(data.getvalue()).decode())


def test_transparent_images_are_composited_on_white():
    data = io.BytesIO()
    Image.new("RGBA", (20, 20), (0, 0, 0, 0)).save(data, "PNG")
    out = vc.normalize_image("data:image/png;base64," + base64.b64encode(data.getvalue()).decode())
    with Image.open(io.BytesIO(base64.b64decode(out.split(",")[1]))) as img:
        assert img.getpixel((0, 0)) == (255, 255, 255)


@pytest.mark.parametrize("patch", [{"x": 95, "width": 10}, {"x": -1}, {"width": 0}, {"height": float("nan")}])
def test_out_of_image_or_nonfinite_boxes_are_rejected(patch):
    with pytest.raises(ValidationError):
        vc.Box.model_validate({"x": 10, "y": 10, "width": 30, "height": 30, **patch})


def test_graphical_program_rejects_unknown_regions_and_tools():
    import copy
    for overlay in [{"kind": "highlight", "region_id": "invented"},
                    {"kind": "arrow", "region_id": "formula"},
                    {"kind": "arrow", "region_id": "formula", "to_region_id": "missing"},
                    {"kind": "javascript", "region_id": "formula"},
                    {"kind": "label", "region_id": "formula", "html": "<script>bad()</script>"}]:
        lesson = copy.deepcopy(LESSON)
        lesson["steps"][0]["overlays"] = [overlay]
        with pytest.raises(ValidationError):
            vc.VisualLesson.model_validate({"grounding": GROUNDING, "lesson": lesson})


def test_duplicate_regions_rejected():
    with pytest.raises(ValidationError, match="univoci"):
        vc.Grounding.model_validate({**GROUNDING, "regions": GROUNDING["regions"] * 2})


@pytest.mark.asyncio
async def test_grounding_then_planning_and_usage_for_every_call(monkeypatch):
    import json
    responses = [LLMResponse(json.dumps(value), "openai", "vision-test", 100, 200) for value in [GROUNDING, LESSON]]
    generate = AsyncMock(side_effect=responses)
    usage = AsyncMock()
    monkeypatch.setattr(vc.llm_service, "generate", generate)
    monkeypatch.setattr(vc, "pair_for", lambda _: ("openai", "vision-test"))
    result = await vc.build_lesson(image_url(), "Spiega la funzione", [{"role": "user", "content": "Non ho capito"}], "Radicando", usage)
    assert result.lesson.steps[0].overlays[0].region_id == "formula"
    assert usage.await_count == 2
    assert [call.args[1] for call in usage.await_args_list] == ["grounding", "lesson"]
    calls = generate.await_args_list
    assert all(call.kwargs["allow_web_search"] is False for call in calls)
    assert all(call.kwargs["messages"][0]["content"][1]["image_url"]["detail"] == "high" for call in calls)
    planning_prompt = calls[1].kwargs["messages"][0]["content"][0]["text"]
    assert '"id": "formula"' in planning_prompt and "Non ho capito" in planning_prompt and "Radicando" in planning_prompt


@pytest.mark.asyncio
async def test_invalid_region_gets_one_bounded_repair(monkeypatch):
    import copy
    import json
    broken = copy.deepcopy(LESSON)
    broken["steps"][0]["overlays"][0]["region_id"] = "invented"
    outputs = [GROUNDING, broken, LESSON]
    generate = AsyncMock(side_effect=[LLMResponse(json.dumps(o), "openai", "test", 1, 1) for o in outputs])
    monkeypatch.setattr(vc.llm_service, "generate", generate)
    usage = AsyncMock()
    result = await vc.build_lesson(image_url(), "Spiega", [], "", usage)
    assert result.lesson.title == "Dominio"
    assert generate.await_count == usage.await_count == 3


@pytest.mark.asyncio
async def test_repeated_malformed_output_fails_without_infinite_retries(monkeypatch):
    generate = AsyncMock(return_value=LLMResponse("Not JSON", "openai", "test", 1, 1))
    monkeypatch.setattr(vc.llm_service, "generate", generate)
    usage = AsyncMock()
    with pytest.raises(ValueError, match="percorso visuale valido"):
        await vc.build_lesson(image_url(), "Spiega", [], "", usage)
    assert generate.await_count == usage.await_count == 2


@pytest.mark.parametrize("role,expected", [(None, 401), (UserRole.TEACHER, 403), (UserRole.ADMIN, 422)])
@pytest.mark.asyncio
async def test_api_is_admin_only_including_direct_requests(role, expected):
    app = FastAPI()
    app.include_router(router)
    if role:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=role)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/analyze", json={"image": "data:image/png;base64," + "a" * 40, "prompt": "Spiega"})
    assert response.status_code == expected


@pytest.mark.parametrize("missing", ["action", "question", "answer", "hint"])
def test_every_step_requires_an_action_and_check(missing):
    step = {k: v for k, v in LESSON["steps"][0].items() if k != missing}
    with pytest.raises(ValidationError):
        vc.Step.model_validate(step)
    with pytest.raises(ValidationError):
        vc.Step.model_validate({**LESSON["steps"][0], missing: "   "})


def test_multi_question_steps_are_rejected():
    with pytest.raises(ValidationError, match="una sola domanda"):
        vc.Step.model_validate({**LESSON["steps"][0], "question": "Quanto fa la somma? Quanto vale il riporto?"})


def test_single_digit_answers_and_progress_validation():
    context = {"grounding": GROUNDING, "lesson": {**LESSON, "steps": LESSON["steps"] * 2}}
    body = {"image": image_url(), "context": context, "step_index": 0, "completed_steps": 0, "message": "0"}
    assert TurnRequest.model_validate(body).message == "0"
    for invalid in [{"step_index": 1}, {"message": " "}, {"completed_steps": 3}, {"completed_steps": 1}]:
        with pytest.raises(ValidationError):
            TurnRequest.model_validate({**body, **invalid})
    assert TurnRequest.model_validate({**body, "completed_steps": 1, "action": "question"}).step_index == 0


def context_with_two_steps():
    return vc.VisualLesson.model_validate({"objective": "Comprendi la funzione", "grounding": GROUNDING,
                                          "lesson": {**LESSON, "steps": LESSON["steps"] * 2}})


@pytest.mark.asyncio
@pytest.mark.parametrize("action,outcome", [("answer", "correct"), ("answer", "retry"), ("hint", "hint"), ("question", "clarify")])
async def test_only_a_verified_answer_advances(action, outcome, monkeypatch):
    import json
    context = context_with_two_steps()
    generate = AsyncMock(return_value=LLMResponse(json.dumps({"outcome": outcome, "feedback": "Guarda il segno del radicando"}), "openai", "test", 1, 1))
    monkeypatch.setattr(vc.llm_service, "generate", generate)
    usage = AsyncMock()
    result = await vc.tutor_turn(image_url(), context, 0, 0, action, "0", [], usage)
    assert result.completed_steps == (1 if outcome == "correct" else 0)
    assert result.context.lesson == context.lesson
    assert usage.await_args.args[1] == "check"


@pytest.mark.asyncio
async def test_hint_cannot_promote_the_user_even_if_model_requests_it(monkeypatch):
    import json
    generate = AsyncMock(return_value=LLMResponse(json.dumps({"outcome": "correct", "feedback": "OK"}), "openai", "test", 1, 1))
    monkeypatch.setattr(vc.llm_service, "generate", generate)
    with pytest.raises(ValueError, match="percorso visuale valido"):
        await vc.tutor_turn(image_url(), context_with_two_steps(), 0, 0, "hint", "", [], AsyncMock())
    assert generate.await_count == 2


@pytest.mark.asyncio
async def test_simplify_must_actually_split_the_task(monkeypatch):
    import json
    generate = AsyncMock(return_value=LLMResponse(json.dumps({"outcome": "hint", "feedback": "Osserva meglio"}), "openai", "test", 1, 1))
    monkeypatch.setattr(vc.llm_service, "generate", generate)
    with pytest.raises(ValueError, match="percorso visuale valido"):
        await vc.tutor_turn(image_url(), context_with_two_steps(), 0, 0, "simplify", "", [], AsyncMock())
    assert generate.await_count == 2


@pytest.mark.asyncio
async def test_simplification_inserts_small_checks_and_keeps_the_rest(monkeypatch):
    import json
    context = context_with_two_steps()
    small = {**LESSON["steps"][0], "question": "Quanto vale il radicando con x=1?", "answer": "-1"}
    decision = {"outcome": "clarify", "feedback": "Partiamo da un solo calcolo.", "replacement_steps": [small, LESSON["steps"][0]],
                "region_updates": [{**GROUNDING["regions"][0], "box": {"x": 12, "y": 20, "width": 20, "height": 10}}]}
    monkeypatch.setattr(vc.llm_service, "generate", AsyncMock(return_value=LLMResponse(json.dumps(decision), "openai", "test", 1, 1)))
    result = await vc.tutor_turn(image_url(), context, 0, 0, "simplify", "", [], AsyncMock())
    assert result.completed_steps == 0
    assert len(result.context.lesson.steps) == 3
    assert result.context.lesson.steps[0].question == small["question"]
    assert result.context.lesson.steps[-1] == context.lesson.steps[-1]
    assert result.context.grounding.regions[0].box.x == 12
    assert context.grounding.regions[0].box.x == 10  # no mutation of the previous attempt


@pytest.mark.asyncio
async def test_unknown_regions_in_a_replacement_check_are_rejected(monkeypatch):
    import json
    small = {**LESSON["steps"][0], "overlays": [{"kind": "zoom", "region_id": "nonexistent"}]}
    decision = {"outcome": "hint", "feedback": "Osserva", "replacement_steps": [small]}
    generate = AsyncMock(return_value=LLMResponse(json.dumps(decision), "openai", "test", 1, 1))
    monkeypatch.setattr(vc.llm_service, "generate", generate)
    with pytest.raises(ValueError):
        await vc.tutor_turn(image_url(), context_with_two_steps(), 0, 0, "simplify", "", [], AsyncMock())


@pytest.mark.parametrize("role,expected", [(None, 401), (UserRole.TEACHER, 403)])
@pytest.mark.asyncio
async def test_interactive_endpoint_remains_admin_only(role, expected):
    app = FastAPI()
    app.include_router(router)
    if role:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=role)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/interact", json={"image": image_url(), "context": context_with_two_steps().model_dump(),
                                                       "step_index": 0, "completed_steps": 0, "message": "0"})
    assert response.status_code == expected


@pytest.mark.parametrize("raw,expected", [
    ('```json\n{"a": 1}\n```\n\nNota: stimato.', {"a": 1}),
    ('Ecco: {"f": "\\frac{1}{2} e \\times 3"} fine', {"f": "\\frac{1}{2} e \\times 3"}),
    ('{"f": "$\\sqrt{x}$ e \\alpha"}', {"f": "$\\sqrt{x}$ e \\alpha"}),
    ('{"f": "riga\\nnuova \\\\(x\\\\) \\u00e8"}', {"f": "riga\nnuova \\(x\\) è"}),
    ('{"f": "a \\neq b"}', {"f": "a \\neq b"}),
])
def test_model_json_is_recovered_with_latex_intact(raw, expected):
    assert vc.parse_json(raw) == expected


def test_reply_without_json_is_rejected():
    with pytest.raises(ValueError):
        vc.parse_json("Non posso aiutarti")
