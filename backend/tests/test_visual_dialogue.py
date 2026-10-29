import copy
import asyncio
import base64
import io
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image

from app.api.deps import get_current_admin, get_current_user
from app.api.v1.endpoints.visual_sessions import UpdateSession, router
from app.models.enums import UserRole
from app.services import visual_dialogue as dialogue
from app.services import visual_sessions as sessions
from app.services.llm_service import LLMResponse


INVENTORY = {
    "grounding": {"subject": "Brano per chitarra", "overview": "Due battute di TAB", "warnings": [], "regions": [
        {"id": "bar1", "label": "Battuta 1", "text": "0 1 0 2", "box": {"x": 5, "y": 10, "width": 40, "height": 60}, "confidence": "high"},
        {"id": "bar2", "label": "Battuta 2", "text": "Am E", "box": {"x": 50, "y": 10, "width": 40, "height": 60}, "confidence": "high"},
    ]},
    "units": [
        {"id": "measure1", "label": "Prima battuta", "region_id": "bar1", "content": "Quattro note da un quarto, in ordine"},
        {"id": "measure2", "label": "Seconda battuta", "region_id": "bar2", "content": "Due accordi da due quarti ciascuno"},
    ],
}
DRAFT = {
    "intent": "guide", "message": "Partiamo dalla prima battuta: esegui le quattro note lentamente, contando un battito per ciascuna.",
    "objective": "Eseguire l'intero brano", "scope": "all", "memory": "L'utente vuole suonare tutto il brano, non soltanto leggere la chiave.",
    "drawing_brief": "Scrivi il conteggio sopra le note e traccia una freccia fra le due battute.",
    "coverage": [
        {"id": "part1", "title": "Prima battuta", "scope": "Tutte le quattro note, durate e diteggiatura", "source_unit_ids": ["measure1"], "status": "active", "evidence": ""},
        {"id": "part2", "title": "Seconda battuta", "scope": "Entrambi gli accordi e loro durata", "source_unit_ids": ["measure2"], "status": "pending", "evidence": ""},
    ],
    "complete": False, "pending_check": None,
    "overlays": [{"kind": "highlight", "region_id": "bar1", "label": "Prima battuta", "color": "violet"}],
    "region_updates": [],
}
DRAWING = {"title": "Contiamo insieme", "layout": "overlay", "steps": ["Conteggio", "Collegamento"], "elements": [
    {"id": "count", "kind": "text", "space": "image", "box": {"x": 10, "y": 5, "width": 30, "height": 8}, "text": "1 2 3 4"},
    {"id": "flow", "kind": "arrow", "space": "image", "points": [{"x": 40, "y": 70}, {"x": 60, "y": 70}], "step": 1},
]}


def test_full_piece_cannot_be_reduced_to_a_single_preliminary_check():
    incomplete = {**DRAFT, "coverage": DRAFT["coverage"][:1], "complete": True}
    _, state, _ = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), incomplete)
    assert state["complete"] is False
    assert state["coverage"][-1]["status"] == "pending" and state["coverage"][-1]["source_unit_ids"] == ["measure2"]


def test_pending_measures_prevent_false_completion():
    _, state, _ = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), {**DRAFT, "complete": True})
    assert state["complete"] is False


def test_units_the_image_does_not_have_are_dropped_from_the_plan():
    raw = {**DRAFT, "coverage": [{**DRAFT["coverage"][0], "source_unit_ids": ["measure1", "invented"]}, *DRAFT["coverage"][1:]]}
    _, state, _ = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), raw)
    assert state["coverage"][0]["source_unit_ids"] == ["measure1"]


def test_explanation_can_continue_without_an_exam_question():
    _, state, message = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), DRAFT)
    assert state["pending_check"] is None
    assert message["content"] == DRAFT["message"]
    assert state["coverage"][1]["status"] == "pending"


def test_completed_work_requires_concrete_evidence():
    raw = copy.deepcopy(DRAFT)
    raw["coverage"][0]["status"] = "completed"
    with pytest.raises(ValueError, match="evidenza"):
        dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), raw)


def test_a_new_chord_can_be_explored_after_completing_the_previous_task():
    previous = {**DRAFT, "complete": True, "memory": "Le due battute sono state spiegate completamente."}
    raw = copy.deepcopy(DRAFT)
    raw.update(intent="redirect", objective="Approfondire il primo accordo", scope="selection")
    raw["coverage"] = [{**raw["coverage"][1], "status": "active"}]
    _, state, _ = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), raw, previous)
    assert state["objective"] == "Approfondire il primo accordo"
    assert state["goal_history"][0]["objective"] == previous["objective"]
    assert state["goal_history"][0]["complete"] is True


def test_broken_overlays_are_dropped_without_failing_the_turn():
    raw = {**DRAFT, "overlays": [{"kind": "arrow", "region_id": "bar1", "to_region_id": "invented"},
                                 {"kind": "arrow", "region_id": "bar1"}, {"kind": "highlight", "region_id": "bar1"}]}
    _, _, reply = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), raw)
    assert [o["kind"] for o in reply["focus"]["overlays"]] == ["highlight"]


@pytest.mark.asyncio
async def test_a_drawing_that_fails_twice_does_not_lose_the_explanation(monkeypatch):
    replies = [{**DRAFT, "intent": "continue"}, {"title": "x"}, {"title": "x"}]
    generate = AsyncMock(side_effect=[LLMResponse(json.dumps(value), "anthropic", "test", 10, 20) for value in replies])
    from app.services.visual_comprehension import llm_service
    monkeypatch.setattr(llm_service, "generate", generate)
    _, state, reply = await dialogue.converse("data:image/png;base64,test", INVENTORY, DRAFT,
        [{"role": "user", "content": "continua"}], AsyncMock())
    assert reply["content"] == DRAFT["message"] and "drawing" not in reply["focus"] and "drawing" not in state


@pytest.mark.asyncio
async def test_follow_up_uses_saved_scope_and_memory_without_rescanning(monkeypatch):
    generate = AsyncMock(side_effect=[LLMResponse(json.dumps(value), "openai", "test", 10, 20) for value in [{**DRAFT, "intent": "continue"}, DRAWING]])
    from app.services.visual_comprehension import llm_service
    monkeypatch.setattr(llm_service, "generate", generate)
    usage = AsyncMock()
    _, state, _ = await dialogue.converse("data:image/png;base64,test", INVENTORY, DRAFT,
        [{"role": "user", "content": "Andiamo avanti con la seconda battuta"}], usage)
    assert generate.await_count == 2
    assert state["coverage"][1]["source_unit_ids"] == ["measure2"]
    assert [c.args[1] for c in usage.await_args_list] == ["dialogue", "blackboard"]
    assert state["drawing"]["elements"][0]["text"] == "1 2 3 4"


def test_drafts_preserve_whitespace_and_titles_are_trimmed():
    assert UpdateSession(draft="  mia bozza\n", revision=0).draft == "  mia bozza\n"
    assert UpdateSession(title="  Chitarra  ").title == "Chitarra"


def test_stale_pending_turns_become_retryable_without_losing_history():
    request_id = uuid.uuid4()
    s = SimpleNamespace(active_request_id=request_id, request_started_at=datetime.now(timezone.utc) - timedelta(seconds=181),
        revision=3, messages=[{"role": "user", "request_id": str(request_id), "content": "continuiamo", "status": "pending"}])
    assert sessions.recover_stale(s)
    assert s.active_request_id is None and s.revision == 4
    assert s.messages[0]["status"] == "failed" and s.messages[0]["content"] == "continuiamo"


@pytest.mark.asyncio
@pytest.mark.parametrize("role,expected", [(None, 401), (UserRole.TEACHER, 403)])
async def test_saved_sessions_remain_admin_only(role, expected):
    app = FastAPI()
    app.include_router(router, prefix="/sessions")
    if role:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=role)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        result = await client.get("/sessions")
    assert result.status_code == expected


@pytest.mark.skipif(os.getenv("RUN_VISUAL_SESSION_INTEGRATION") != "1", reason="Requires the development Postgres and MinIO services")
@pytest.mark.asyncio
async def test_durable_sessions_owner_isolation_retry_and_idempotency(monkeypatch):
    from sqlalchemy import delete, select
    from app.core.database import AsyncSessionLocal
    from app.models.user import User
    from app.models.visual_comprehension import VisualComprehensionSession
    from app.services.storage_service import storage_service

    png = io.BytesIO()
    Image.new("RGB", (160, 100), "white").save(png, "PNG")
    image_data = "data:image/png;base64," + base64.b64encode(png.getvalue()).decode()

    owner_ids = [uuid.uuid4(), uuid.uuid4()]
    async with AsyncSessionLocal() as db:
        for owner_id in owner_ids:
            db.add(User(id=owner_id, role=UserRole.ADMIN, is_active=True, email=f"visual-test-{owner_id}@example.invalid"))
        await db.commit()
    actor = {"id": owner_ids[0]}
    app = FastAPI()
    app.include_router(router, prefix="/sessions")
    app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id=actor["id"], tenant_id=None)
    monkeypatch.setattr(sessions, "usage_callback", AsyncMock(return_value=AsyncMock()))

    async def fake_turn(*_):
        from app.services.visual_blackboard import DrawingScene
        inventory, state, reply = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), DRAFT)
        state["drawing"] = DrawingScene.model_validate(DRAWING).model_dump()
        reply["focus"]["drawing"] = state["drawing"]
        return inventory, state, reply
    generate = AsyncMock(side_effect=fake_turn)
    monkeypatch.setattr(sessions, "converse", generate)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            created = await client.post("/sessions", json={"image": image_data, "image_name": "tab.png", "title": "Chitarra"})
            assert created.status_code == 201, created.text
            session = created.json()
            url = f"/sessions/{session['id']}"
            await client.patch(url, json={"draft": "  Spiegami la battuta\n", "revision": 0})
            assert (await client.get(url)).json()["draft"] == "  Spiegami la battuta\n"

            actor["id"] = owner_ids[1]
            assert (await client.get("/sessions")).json() == []
            for method, suffix, payload in [("GET", "", None), ("GET", "/image", None), ("PATCH", "", {"title": "altro"}), ("DELETE", "", None)]:
                assert (await client.request(method, url + suffix, json=payload)).status_code == 404
            actor["id"] = owner_ids[0]
            request_id = str(uuid.uuid4())
            body = {"request_id": request_id, "revision": 0, "content": "Aiutami a eseguire tutto il brano"}
            result = await client.post(url + "/messages", json=body)
            assert result.status_code == 200, result.text
            saved = result.json()
            assert len(saved["messages"]) == 2 and saved["revision"] == 2
            assert saved["messages"][1]["focus"]["drawing"] == saved["dialogue"]["drawing"]
            assert (await client.get(url)).json()["dialogue"]["coverage"][1]["status"] == "pending"
            assert (await client.post(url + "/messages", json=body)).status_code == 200
            assert generate.await_count == 1  # lost response replay incurs no new model call
            assert (await client.patch(url, json={"draft": "stale", "revision": 0})).status_code == 409

            generate.side_effect = RuntimeError("provider unavailable")
            retry_id = str(uuid.uuid4())
            failed_body = {"request_id": retry_id, "revision": 2, "content": "Andiamo avanti"}
            assert (await client.post(url + "/messages", json=failed_body)).status_code == 502
            failed = (await client.get(url)).json()
            assert failed["busy"] is False and failed["messages"][-1]["status"] == "failed"
            generate.side_effect = fake_turn
            result = await client.post(url + "/messages", json={**failed_body, "revision": failed["revision"]})
            assert result.status_code == 200
            assert len(result.json()["messages"]) == 4  # retry reuses the failed user message

            entered, release = asyncio.Event(), asyncio.Event()

            async def delayed_turn(*args):
                entered.set()
                await release.wait()
                return await fake_turn(*args)

            generate.side_effect = delayed_turn
            task = asyncio.create_task(client.post(url + "/messages", json={"request_id": str(uuid.uuid4()),
                "revision": result.json()["revision"], "content": "Ora il primo accordo"}))
            await asyncio.wait_for(entered.wait(), timeout=10)
            try:
                pending = (await client.get(url)).json()
                assert pending["busy"] and pending["messages"][-1]["status"] == "pending"
                assert (await client.post(url + "/messages", json={"request_id": str(uuid.uuid4()),
                    "revision": pending["revision"], "content": "Richiesta concorrente"})).status_code == 409
            finally:
                release.set()
                assert (await task).status_code == 200
            assert (await client.get(url + "/image")).status_code == 200
            assert (await client.delete(url)).status_code == 204
            assert (await client.get(url)).status_code == 404
    finally:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(VisualComprehensionSession).where(VisualComprehensionSession.owner_id.in_(owner_ids)))).scalars().all()
            for row in rows:
                storage_service.delete_file(row.image_key)
            await db.execute(delete(VisualComprehensionSession).where(VisualComprehensionSession.owner_id.in_(owner_ids)))
            await db.execute(delete(User).where(User.id.in_(owner_ids)))
            await db.commit()


def test_extra_overlays_are_trimmed():
    raw = {**DRAFT, "overlays": [{"kind": "highlight", "region_id": "bar1"}] * 7}
    _, _, reply = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), raw)
    assert len(reply["focus"]["overlays"]) == 4


def test_questions_are_offered_once_then_the_tutor_must_act():
    raw = {**DRAFT, "action": "explorer", "questions": [{"question": "Quale funzione?", "options": ["sin", "cos"]}]}
    _, state, reply = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), raw)
    assert reply["questions"][0]["options"] == ["sin", "cos"] and "questions" not in state and state["action"] == "explorer"
    from tests.test_visual_widgets import explorer
    _, _, reply = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), {**raw, "widgets": [explorer()]}, answering=True)
    assert "questions" not in reply and reply["widgets"][0]["kind"] == "explorer"


def test_the_tutor_reads_its_own_questions_back():
    seen = dialogue.transcript({"role": "assistant", "content": "Due scelte:", "questions": [{"question": "Quale?", "options": ["a", "b"]}]})
    assert "Quale? (a, b)" in seen["content"]


@pytest.mark.asyncio
async def test_a_question_turn_does_not_spend_a_drawing(monkeypatch):
    reply = {**DRAFT, "questions": [{"question": "Quale funzione?", "options": ["sin", "cos"]}]}
    generate = AsyncMock(side_effect=[LLMResponse(json.dumps(reply), "anthropic", "test", 10, 20)])
    from app.services.visual_comprehension import llm_service
    monkeypatch.setattr(llm_service, "generate", generate)
    _, _, out = await dialogue.converse("data:image/png;base64,test", INVENTORY, DRAFT, [{"role": "user", "content": "fammi un grafico"}], AsyncMock())
    assert generate.await_count == 1 and out["questions"] and "drawing" not in out["focus"]


def test_an_announced_interactive_graph_must_come_with_its_widget():
    from tests.test_visual_widgets import explorer
    with pytest.raises(ValueError, match="widgets"):
        dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), {**DRAFT, "action": "explorer"})
    _, state, reply = dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), {**DRAFT, "action": "explorer", "widgets": [explorer()]},
                                                {"widgets": [{"id": "old"}]})
    assert reply["widgets"][0]["kind"] == "explorer" and [w["id"] for w in state["widgets"]] == ["old", reply["widgets"][0]["id"]]


@pytest.mark.parametrize("text,expected", [
    ("Aiutami a fare esercizio sulle equazioni dell'iperbole", "exercise"),
    ("mettimi alla prova sulle parabole", "exercise"),
    ("Fammi un grafico interattivo per giocare con i valori", "explorer"),
    ("come cambia se modifico i parametri?", "explorer"),
    ("spiegamelo in un altro modo, di lato", "side"),
    ("cos'è questo pulsante?", None),
])
def test_explicit_requests_are_recognised(text, expected):
    assert dialogue.requested_action([{"role": "user", "content": text}]) == expected


def test_answers_refer_back_to_the_original_request():
    msgs = [{"role": "user", "content": "voglio esercitarmi"}, {"role": "assistant", "content": "?"}, {"role": "user", "content": "Risposte:\n• Quale? → iperbole"}]
    assert dialogue.requested_action(msgs) == "exercise"


def test_a_tutor_that_ignores_the_request_is_sent_back():
    with pytest.raises(ValueError, match="ESERCIZIO"):
        dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), DRAFT, requested="exercise")


def test_an_exercise_on_the_wrong_curve_is_sent_back():
    raw = {**DRAFT, "action": "exercise", "widgets": [{"kind": "exercise", "title": "Seno", "prompt": "Scrivi", "target": "y = sin(x)"}]}
    with pytest.raises(ValueError, match="iperbole"):
        dialogue.compile_dialogue(dialogue.Inventory.model_validate(INVENTORY), raw, requested="exercise", topic="iperbole")
    assert dialogue.requested_family([{"role": "user", "content": "esercizi sulle iperboli"}]) == "iperbole"


@pytest.mark.parametrize("text,expected", [
    ("fammi vedere il modello 3D del tetraedro", "solid"),
    ("adesso fammi lo sviluppo piano, animato", "solid"),
    ("la piramide ha base quadrata di lato 4", None),
    ("calcola x al cubo", None),
    ("mostrami lo svolgimento dell'esercizio", None),
])
def test_explicit_solid_requests_are_recognised(text, expected):
    found = dialogue.requested_action([{"role": "user", "content": text}])
    assert found == expected if expected else found != "solid"


def test_an_announced_solid_must_come_with_its_widget():
    inventory = dialogue.Inventory.model_validate(INVENTORY)
    with pytest.raises(ValueError, match="solid"):
        dialogue.compile_dialogue(inventory, {**DRAFT, "action": "solid"})
    solid = {"kind": "solid", "title": "Icosaedro", "shape": "icosahedron", "unfold": True}
    # A topic named for curves does not apply to a solid.
    _, _, reply = dialogue.compile_dialogue(inventory, {**DRAFT, "action": "solid", "widgets": [solid]}, requested="solid", topic="parabola")
    assert reply["widgets"][0]["shape"] == "icosahedron"


def test_watermarks_are_not_content():
    raw = copy.deepcopy(INVENTORY)
    raw["grounding"]["regions"].append({"id": "wm", "label": "Watermark del sito", "text": "© esercizi.it", "box": {"x": 70, "y": 90, "width": 28, "height": 8}, "confidence": "high"})
    raw["units"].append({"id": "credits", "label": "Crediti", "region_id": "wm", "content": "© esercizi.it"})
    clean = dialogue.without_noise(dialogue.Inventory.model_validate(raw))
    assert [r.id for r in clean.grounding.regions] == ["bar1", "bar2"] and [u.id for u in clean.units] == ["measure1", "measure2"]


def test_the_students_canvas_notes_reach_the_tutor():
    text = dialogue.notes_brief([{"id": "n1", "x": 30.4, "y": 120, "text": "L'altezza divide la base a metà"}])
    assert "L'altezza divide la base a metà" in text and "30%" in text and "120%" in text
    assert dialogue.notes_brief([]) == ""
    assert sessions.with_notes({"memory": "m"}, [dialogue.StudentNote(id="n1", x=1, y=2, text="ok")]) == {
        "memory": "m", "student_notes": [{"id": "n1", "x": 1, "y": 2, "text": "ok"}]}
    assert sessions.with_notes({"student_notes": [1]}, None) == {"student_notes": [1]}
