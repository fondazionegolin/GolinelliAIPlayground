import pytest
import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "app" / "services" / "teacherbot_escape_room.py"
SPEC = importlib.util.spec_from_file_location("teacherbot_escape_room", MODULE_PATH)
assert SPEC and SPEC.loader
escape_room = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(escape_room)

extract_step_count = escape_room.extract_step_count
normalize_answer = escape_room.normalize_answer
answers_match = escape_room.answers_match
public_state = escape_room.public_state
validate_plan = escape_room.validate_plan


def test_extract_step_count_defaults_and_clamps():
    assert extract_step_count("Escape room sulla Rivoluzione francese") == 5
    assert extract_step_count("Numero di indizi: 7") == 7
    assert extract_step_count("Crea 20 chiavi progressive") == 10


def test_normalize_answer_is_strict_but_user_friendly():
    assert normalize_answer("  Marie   Curie. ") == "marie curie"
    assert normalize_answer("12/10/1492") != normalize_answer("1492")


def test_answers_match_equivalent_century_formats():
    assert answers_match("13", ["XIII secolo"])
    assert answers_match("tredicesimo", ["13° secolo"])
    assert answers_match("xiii", ["13"])
    assert answers_match("  MARIE curie ", ["Marie Curie"])
    assert not answers_match("XIV", ["XIII secolo"])


def test_validate_plan_hides_answers_from_public_state():
    plan = validate_plan({
        "title": "Storia alterata",
        "narrative_intro": "Sei nelle segrete del castello.",
        "mission": "Correggi un indizio per aprire la porta.",
        "challenges": [{
            "false_statement": "Roma fu fondata nel 753 d.C.",
            "prompt": "Inserisci la data corretta",
            "input_label": "data",
            "accepted_answers": ["753 a.C.", "753 avanti Cristo"],
            "explanation": "La data tradizionale è il 753 a.C.",
        }],
    }, 1)

    exposed = public_state(plan)
    assert exposed["current_challenge"]["false_statement"]
    assert "accepted_answers" not in exposed["current_challenge"]
    assert "input_label" not in exposed["current_challenge"]
    assert exposed["narrative_intro"] == "Sei nelle segrete del castello."
    assert plan["challenges"][0]["achievement"]["name"]
    assert exposed["inventory"] == []
    assert "753 a.C." not in str(exposed)


def test_validate_plan_rejects_missing_answers():
    with pytest.raises(ValueError):
        validate_plan({
            "challenges": [{
                "false_statement": "Un fatto falso",
                "prompt": "Correggi",
                "accepted_answers": [],
            }],
        }, 1)
