import math

import pytest
from pydantic import ValidationError

from app.services import visual_math
from app.services.visual_widgets import Exercise, Explorer, keep_latest, with_ids


def test_the_server_reads_the_same_language_as_the_board():
    f = visual_math.parse_equation("y^2/9 - x^2/16 = 1")
    assert visual_math.evaluate(f, {"x": 0, "y": 3}) == pytest.approx(0)
    assert visual_math.evaluate(visual_math.parse("A sin(kx + φ)"), {"A": 2, "k": 1, "phi": 0, "x": math.pi / 2}) == pytest.approx(2)
    assert visual_math.evaluate(visual_math.parse("3x² − 0,5"), {"x": 1}) == pytest.approx(2.5)
    with pytest.raises(visual_math.MathError):
        visual_math.parse("x; import os")


def explorer(**extra):
    return {"kind": "explorer", "title": "Seno", "equation": "y = A*sin(k*x + phi)", "formula": "y = A·sin(kx + φ)",
            "params": [{"name": "A", "label": "A", "min": 0, "max": 3, "step": .1, "value": 1},
                       {"name": "k", "label": "k", "min": .5, "max": 4, "step": .1, "value": 1},
                       {"name": "phi", "label": "φ", "min": -3, "max": 3, "step": .1, "value": 0}], **extra}


def test_an_explorer_must_name_every_letter_as_a_parameter_and_be_visible():
    assert Explorer.model_validate(explorer()).params[2].label == "φ"
    with pytest.raises(ValidationError, match="parametro"):
        Explorer.model_validate(explorer(equation="y = A*sin(k*x + c)"))
    with pytest.raises(ValidationError, match="finestra"):
        Explorer.model_validate(explorer(equation="y = A*sin(k*x + phi) + 100"))


def test_an_exercise_has_a_concrete_target_and_well_formed_blanks():
    ok = Exercise.model_validate({"kind": "exercise", "title": "Iperbole", "prompt": "Scrivi l'equazione", "target": "y^2/9 - x^2/16 = 1",
                                  "template": "y^2/[a] - x^2/[b] = 1", "hints": ["Guarda dove taglia l'asse y"]})
    assert ok.template
    with pytest.raises(ValidationError, match="solo x e y"):
        Exercise.model_validate({"kind": "exercise", "title": "x", "prompt": "x", "target": "y = a*x"})
    with pytest.raises(ValidationError, match="caselle"):
        Exercise.model_validate({"kind": "exercise", "title": "x", "prompt": "x", "target": "y = x", "template": "y = [m]x + [m]"})


def test_widgets_stay_on_the_board_newest_last():
    new = with_ids([Explorer.model_validate(explorer())])
    assert len(new[0]["id"]) == 10
    assert [w["id"] for w in keep_latest([{"id": str(i)} for i in range(4)], new)] == ["1", "2", "3", new[0]["id"]]


@pytest.mark.parametrize("equation,expected", [("y = 3x + 1", "retta"), ("y = x^2 - 4", "parabola"), ("x^2 + y^2 = 9", "circonferenza"),
                                               ("x^2/9 + y^2/4 = 1", "ellisse"), ("y^2/9 - x^2/16 = 1", "iperbole"), ("xy = 2", "iperbole"),
                                               ("y = sin(x)", "altro"), ("y = x^2/a^2", "parabola")])
def test_the_server_knows_which_conic_an_equation_draws(equation, expected):
    assert visual_math.family(equation, {"a": 2}) == expected


def test_a_solid_is_a_catalogue_shape_with_readable_proportions():
    from app.services.visual_widgets import Solid
    s = Solid.model_validate({"kind": "solid", "title": "Prisma", "shape": "prism", "sides": 6, "a": 2, "c": 5, "unfold": True})
    assert s.sides == 6 and s.unfold
    assert not Solid.model_validate({"kind": "solid", "title": "Sfera", "shape": "sphere", "unfold": True}).unfold  # no net
    with pytest.raises(ValidationError):
        Solid.model_validate({"kind": "solid", "title": "?", "shape": "torus"})
    with pytest.raises(ValidationError, match="sproporzionate"):
        Solid.model_validate({"kind": "solid", "title": "Ago", "shape": "cuboid", "a": 1, "b": 1, "c": 100})


def test_a_new_model_of_the_same_solid_replaces_the_old_card():
    old = [{"id": "c", "kind": "solid", "shape": "cube"}, {"id": "t", "kind": "solid", "shape": "tetrahedron"}, {"id": "e", "kind": "explorer"}]
    assert [w["id"] for w in keep_latest(old, [{"id": "n", "kind": "solid", "shape": "cube"}])] == ["t", "e", "n"]
