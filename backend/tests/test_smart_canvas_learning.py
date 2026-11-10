import json

import pytest

from app.services import smart_canvas as ai


def test_quiz_ops_are_validated_and_kept():
    reply = ai.CanvasReply.model_validate({"message": "ok", "ops": [
        {"kind": "quiz", "id": "q1", "x": 0, "y": 0, "text": "2+2?", "options": ["3", "4"], "correct": [1], "explanation": "somma"},
        {"kind": "flashcard", "id": "f1", "x": 0, "y": 0, "text": "Fotosintesi", "back": "luce → zuccheri"},
        {"kind": "check", "id": "c1", "x": 0, "y": 0, "text": "Perché?", "expected": "Perché sì"},
    ]})
    assert [op.kind for op in ai.sanitize(reply, set()).ops] == ["quiz", "flashcard", "check"]


@pytest.mark.parametrize("op", [
    {"kind": "quiz", "id": "q", "x": 0, "y": 0, "text": "?", "options": ["a", "b"], "correct": [2]},
    {"kind": "flashcard", "id": "f", "x": 0, "y": 0, "text": "fronte"},
    {"kind": "check", "id": "c", "x": 0, "y": 0, "text": "domanda"},
])
def test_incomplete_cards_are_rejected(op):
    with pytest.raises(ValueError):
        ai.CanvasReply.model_validate({"message": "ok", "ops": [op]})


def test_board_facts_tell_who_did_what():
    content = json.dumps({"type": "canvas_v1", "items": [
        {"id": "fr", "type": "frame", "x": 0, "y": 0, "w": 500, "h": 400, "text": "Idee", "by": "Anna", "at": 1_760_000_000_000},
        {"id": "p1", "type": "postit", "x": 10, "y": 60, "w": 150, "h": 130, "text": "più alberi", "by": "Luca", "at": 1_760_000_060_000, "parentFrameId": "fr"},
        {"id": "q", "type": "quiz", "x": 600, "y": 0, "w": 340, "h": 300, "question": "Cosa serve?", "options": ["a", "b"], "correct": [0], "ai": True, "by": "Anna",
         "answers": {"u1": {"name": "Luca", "ok": True, "at": 1}, "u2": {"name": "Sara", "ok": False, "at": 2}}},
        {"id": "old", "type": "postit", "x": 0, "y": 0, "w": 100, "h": 100, "text": "vecchio"},
    ]})
    facts = ai.board_facts(content, [{"role": "user", "author": "Anna", "content": "raggruppa"}, {"role": "assistant", "content": "fatto"}])
    assert any("Luca: post-it «più alberi» (in «Idee»)" in e for e in facts["events"])
    assert any(e.startswith("[] (autore non registrato)") for e in facts["events"])
    assert facts["quizzes"][0]["right"] == 1 and facts["quizzes"][0]["total"] == 2
    assert facts["people"]["Anna"]["richieste all'assistente"] == 1
    assert facts["people"]["assistente IA"]["quiz"] == 1
    assert facts["people"]["Sara"]["risposte"] == 1


def test_cluster_can_reuse_an_existing_section():
    reply = ai.CanvasReply(message="ok", ops=[
        ai.CanvasOp(kind="cluster", target="n1", text="Spazi", members=["n4"]),
        ai.CanvasOp(kind="cluster", target="n2", text="Tempo"),  # only renamed/summarised: still valid
        ai.CanvasOp(kind="cluster", target="ghost", text="Nuovo", members=["n5"]),  # unknown section and no id: dropped
        ai.CanvasOp(kind="cluster", id="arte", target="ghost", text="Arte", members=["n5"]),  # unknown section with id: new one
    ])
    ops = ai.sanitize(reply, {"n1", "n2", "n4", "n5"}).ops
    assert [(op.target, op.text, op.members) for op in ops] == [("n1", "Spazi", ["n4"]), ("n2", "Tempo", []), (None, "Arte", ["n5"])]
