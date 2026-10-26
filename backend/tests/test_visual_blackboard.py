import copy

import pytest
from pydantic import ValidationError

from app.services.visual_blackboard import DrawingScene, Fretboard, Plot, Rhythm, validate_scene
from app.services.visual_comprehension import Grounding


def mark(kind, **kwargs):
    return {"id": kind, "kind": kind, "space": "board", **kwargs}


BOX = {"x": 10, "y": 10, "width": 80, "height": 70}
SCENE = {"title": "Scrivo e collego", "layout": "side", "steps": ["Scrittura", "Freccia"], "elements": [
    mark("number", box=BOX, text="15"),
    mark("arrow", points=[{"x": 20, "y": 80}, {"x": 80, "y": 90}], step=1),
]}


def test_teacher_can_write_numbers_and_draw_free_geometry():
    raw = copy.deepcopy(SCENE)
    raw["elements"].extend([
        mark("line", points=[{"x": 10, "y": 20}, {"x": 80, "y": 20}]),
        mark("polyline", points=[{"x": 10, "y": 20}, {"x": 40, "y": 5}, {"x": 60, "y": 40}]),
        mark("rectangle", box=BOX), mark("ellipse", box=BOX),
        mark("formula", box=BOX, text=r"x^2+2x+1=(x+1)^2"),
        mark("brace", points=[{"x": 10, "y": 20}, {"x": 80, "y": 20}]),
    ])
    assert len(DrawingScene.model_validate(raw).elements) == 8


def test_colored_boxes_alone_are_not_an_explanatory_drawing():
    with pytest.raises(ValueError, match="non solo riquadri"):
        DrawingScene.model_validate({**SCENE, "elements": [mark("rectangle", box=BOX)]})
    with pytest.raises(ValueError, match="non solo riquadri"):
        DrawingScene.model_validate({**SCENE, "elements": [mark("rectangle", box=BOX), mark("text", box=BOX, text="Solo un'etichetta")]})


@pytest.mark.parametrize("broken", [
    mark("text", text="15"), mark("number", box=BOX, text=""),
    mark("arrow", points=[{"x": 5, "y": 5}]),
    mark("polyline", points=[{"x": -1, "y": 5}, {"x": 20, "y": 20}]),
    mark("javascript", text="alert(1)"),
    mark("formula", box=BOX, text="x", html="<script>bad()</script>"),
    mark("plot", box=BOX),
])
def test_invalid_and_executable_programs_are_rejected(broken):
    with pytest.raises(ValidationError):
        DrawingScene.model_validate({**SCENE, "elements": [broken]})


def test_source_to_drawing_connectors_must_resolve_both_ends():
    grounding = Grounding.model_validate({"subject": "Accordo", "overview": "Un Am", "regions": [
        {"id": "chord", "label": "Am", "text": "Am", "confidence": "high", "box": BOX}]})
    raw = {**SCENE, "elements": [*SCENE["elements"], mark("connector", from_region_id="chord", to_element_id="number")]}
    assert validate_scene(raw, grounding).elements[-1].kind == "connector"
    raw["elements"][-1]["from_region_id"] = "invented"
    with pytest.raises(ValueError, match="sconosciuta"):
        validate_scene(raw, grounding)


def test_board_space_and_animation_steps_have_valid_coordinates():
    with pytest.raises(ValueError, match="dichiara le lavagne"):
        DrawingScene.model_validate({**SCENE, "layout": "overlay"})
    with pytest.raises(ValueError, match="passo"):
        DrawingScene.model_validate({**SCENE, "steps": ["Unica fase"]})


def test_am_fingering_is_a_real_six_string_diagram():
    chord = Fretboard(label="Am", frets=[-1, 0, 2, 2, 1, 0], fingers=[0, 0, 2, 3, 1, 0])
    assert chord.frets[0] == -1 and chord.fingers[4] == 1
    for override in [{"frets": [0, 0]}, {"fingers": [0, 0, 8, 0, 0, 0]}, {"start_fret": 5}]:
        with pytest.raises(ValueError):
            Fretboard.model_validate({**chord.model_dump(), **override})


def test_math_plot_requires_real_axes_and_bounded_curves():
    base = {"x_min": -3, "x_max": 3, "y_min": 0, "y_max": 9, "curves": [{"kind": "polynomial", "coefficients": [0, 0, 1]}]}
    assert Plot.model_validate(base).curves[0].coefficients == [0, 0, 1]
    for override in [{"x_max": -3}, {"y_min": float("nan")}, {"curves": []}, {"curves": [{"kind": "polynomial", "coefficients": [float("inf")]}]}]:
        with pytest.raises(ValueError):
            Plot.model_validate({**base, **override})


def test_diagram_edges_cannot_reference_missing_nodes():
    node = {"id": "input", "label": "Ingresso", "box": BOX}
    raw = {**SCENE, "elements": [mark("diagram", box=BOX, diagram={"nodes": [node], "edges": [{"source": "input", "target": "missing"}]})]}
    with pytest.raises(ValueError, match="inesistenti"):
        DrawingScene.model_validate(raw)


def test_rhythm_durations_are_beats_with_finite_phrase_length():
    assert sum(e.beats for e in Rhythm(events=[{"label": "Am", "beats": 2}, {"label": "E", "beats": 2}]).events) == 4
    for beats in [0, -1, float("nan")]:
        with pytest.raises(ValueError):
            Rhythm(events=[{"beats": beats}])


GROUNDING = Grounding.model_validate({"subject": "Triangolo", "overview": "Un triangolo", "regions": [
    {"id": "base", "label": "Base", "box": {"x": 10, "y": 70, "width": 60, "height": 10}, "confidence": "high"}]})
OVERLAY = {"title": "Altezza", "layout": "overlay", "steps": ["Altezza", "Angolo retto"]}


def anchored(**extra):
    return {**OVERLAY, "points": [
        {"id": "a", "kind": "region", "region": "base", "at": "bottom_left"},
        {"id": "b", "kind": "region", "region": "base", "at": "bottom_right"},
        {"id": "apex", "kind": "xy", "x": 40, "y": 15},
        {"id": "h", "kind": "foot", "refs": ["apex", "a", "b"]},
    ], "elements": [
        {"id": "alt", "kind": "dimension", "space": "image", "anchors": ["apex", "h"], "text": "h"},
        {"id": "ang", "kind": "right_angle", "space": "image", "anchors": ["apex", "h", "b"], "step": 1},
        {"id": "note", "kind": "callout", "space": "image", "target": "h", "text": "piede dell'altezza", "step": 1},
    ], **extra}


def test_derived_points_and_new_tools_validate_against_real_regions():
    scene = validate_scene(anchored(), GROUNDING)
    assert [p.kind for p in scene.points] == ["region", "region", "xy", "foot"]


@pytest.mark.parametrize("mutate,message", [
    (lambda r: r["points"].__setitem__(3, {"id": "h", "kind": "foot", "refs": ["apex", "a"]}), "richiede 3"),
    (lambda r: r["points"].__setitem__(3, {"id": "h", "kind": "foot", "refs": ["apex", "a", "nope"]}), "inesistenti"),
    (lambda r: r["elements"][0].__setitem__("anchors", ["apex"]), "richiede 2"),
    (lambda r: r["elements"][2].__setitem__("target", "ghost"), "inesistenti"),
    (lambda r: r["elements"][0].__setitem__("points", [{"x": 1, "y": 1}, {"x": 5, "y": 5}]), "non entrambi"),
])
def test_broken_anchor_references_are_rejected(mutate, message):
    raw = anchored()
    mutate(raw)
    with pytest.raises(ValueError, match=message):
        validate_scene(raw, GROUNDING)


def test_unknown_region_in_a_point_is_rejected():
    raw = anchored()
    raw["points"][0]["region"] = "elsewhere"
    with pytest.raises(ValueError, match="regione sconosciuta"):
        validate_scene(raw, GROUNDING)


def test_circular_dependencies_between_points_and_elements_are_rejected():
    raw = anchored()
    raw["points"].append({"id": "loop", "kind": "element", "element": "alt"})
    raw["elements"][0]["anchors"] = ["apex", "loop"]
    with pytest.raises(ValueError, match="circolari"):
        validate_scene(raw, GROUNDING)


def test_element_points_cannot_follow_a_callout():
    raw = anchored()
    raw["points"].append({"id": "onnote", "kind": "element", "element": "note"})
    with pytest.raises(ValueError, match="non callout"):
        validate_scene(raw, GROUNDING)


def test_highlight_and_lens_need_real_regions():
    ok = {**OVERLAY, "steps": ["x"], "elements": [
        {"id": "hl", "kind": "highlight", "space": "image", "from_region_id": "base"},
        {"id": "lens", "kind": "lens", "space": "image", "from_region_id": "base", "box": {"x": 60, "y": 5, "width": 30, "height": 20}},
        {"id": "ar", "kind": "arrow", "space": "image", "points": [{"x": 1, "y": 1}, {"x": 9, "y": 9}]}]}
    validate_scene(ok, GROUNDING)
    ok["elements"][0]["from_region_id"] = "ghost"
    with pytest.raises(ValueError, match="Regione sconosciuta"):
        validate_scene(ok, GROUNDING)


def test_number_line_requires_a_readable_interval():
    base = {**OVERLAY, "steps": ["x"], "elements": [{"id": "nl", "kind": "numberline", "space": "image",
        "box": {"x": 5, "y": 5, "width": 80, "height": 20}, "numberline": {"min": 0, "max": 20, "step": 1,
        "jumps": [{"start": 8, "end": 13, "label": "+5"}]}}]}
    DrawingScene.model_validate(base)
    base["elements"][0]["numberline"]["max"] = 1000
    with pytest.raises(ValidationError):
        DrawingScene.model_validate(base)


def test_text_can_sit_on_a_named_point_but_not_on_several():
    raw = anchored()
    raw["elements"].append({"id": "carry", "kind": "number", "space": "image", "box": {"x": 0, "y": 0, "width": 4, "height": 4}, "text": "1", "anchors": ["apex"]})
    validate_scene(raw, GROUNDING)
    raw["elements"][-1]["anchors"] = ["apex", "h"]
    with pytest.raises(ValueError, match="al massimo a un punto"):
        validate_scene(raw, GROUNDING)


def test_a_mostly_valid_scene_keeps_its_good_marks():
    from app.services.visual_blackboard import salvage_scene
    raw = anchored()
    raw["elements"] += [
        {"id": "ok1", "kind": "arrow", "space": "image", "points": [{"x": 1, "y": 1}, {"x": 9, "y": 9}], "step": 5},
        {"id": "ok2", "kind": "highlight", "space": "image", "from_region_id": "base"},
        {"id": "bad", "kind": "arc", "space": "image", "anchors": ["apex"]},
    ]
    scene = salvage_scene(raw, GROUNDING)
    assert {e.id for e in scene.elements} == {"alt", "ang", "note", "ok1", "ok2"}
    assert next(e for e in scene.elements if e.id == "ok1").step == 1


def test_removing_a_point_removes_what_hangs_on_it():
    from app.services.visual_blackboard import salvage_scene
    raw = anchored()
    raw["points"][3]["refs"] = ["apex", "a", "ghost"]  # h breaks -> alt, ang, note lose their anchor
    raw["elements"] += [{"id": f"t{i}", "kind": "arrow", "space": "image", "points": [{"x": 1, "y": 1}, {"x": 9, "y": 9}]} for i in range(6)]
    scene = salvage_scene(raw, GROUNDING)
    assert {e.id for e in scene.elements} == {f"t{i}" for i in range(6)}


def test_a_mostly_broken_scene_still_fails_so_the_model_retries():
    from app.services.visual_blackboard import salvage_scene
    raw = anchored()
    raw["points"][3]["refs"] = ["apex"]
    with pytest.raises(ValueError):
        salvage_scene(raw, GROUNDING)


def test_connector_can_reach_an_anchored_mark():
    raw = anchored()
    raw["elements"].append({"id": "link", "kind": "connector", "space": "image", "from_region_id": "base", "to_element_id": "alt"})
    validate_scene(raw, GROUNDING)


def test_a_curve_can_be_calibrated_on_the_source_axes():
    raw = anchored()
    raw["elements"].append({"id": "curve", "kind": "plot", "space": "image", "anchors": ["a", "b", "apex"],
        "plot": {"x_min": -3, "x_max": 3, "y_min": -5, "y_max": 5, "x_ref": 1, "y_ref": 1, "curves": [{"kind": "polynomial", "coefficients": [-4, 0, 1]}]}})
    validate_scene(raw, GROUNDING)
    raw["elements"][-1]["anchors"] = ["a", "b"]
    validate_scene(raw, GROUNDING)
    raw["elements"][-1]["anchors"] = ["a"]
    with pytest.raises(ValueError, match="tacca x"):
        validate_scene(raw, GROUNDING)


def test_boards_open_space_on_the_infinite_canvas():
    raw = {**SCENE, "layout": "overlay", "boards": [{"id": "graf", "side": "right", "width": 1.2}],
           "elements": [{**e, "space": "graf"} for e in SCENE["elements"]], "focus": [{"step": 1, "target": "graf"}]}
    scene = DrawingScene.model_validate(raw)
    assert scene.spaces() == {"image", "graf"}
    with pytest.raises(ValueError, match="fase inesistente"):
        DrawingScene.model_validate({**raw, "focus": [{"step": 5, "target": "graf"}]})
    with pytest.raises(ValueError, match="univoci"):
        DrawingScene.model_validate({**raw, "boards": [{"id": "image"}]})


def test_marks_on_undeclared_boards_are_moved_not_lost():
    from app.services.visual_blackboard import salvage_scene
    raw = anchored(boards=[{"id": "lav"}])
    raw["elements"][2]["space"] = "nowhere"
    scene = salvage_scene(raw, GROUNDING)
    assert next(e for e in scene.elements if e.id == "note").space == "lav"


def test_spotlight_and_soft_curves():
    raw = anchored()
    raw["elements"] += [{"id": "sp", "kind": "spotlight", "space": "image", "from_region_id": "base", "step": 1},
                        {"id": "wave", "kind": "polyline", "space": "image", "anchors": ["a", "apex", "b"]}]
    scene = validate_scene(raw, GROUNDING)
    assert next(e for e in scene.elements if e.id == "wave").sharp is False


def test_critic_fixes_are_applied_and_still_valid():
    from app.services.visual_review import ReviewOp, apply_ops
    from app.services.visual_blackboard import salvage_scene
    raw = anchored()
    raw["elements"].append({"id": "lbl", "kind": "text", "space": "image", "text": "una etichetta molto lunga", "box": {"x": 90, "y": 5, "width": 8, "height": 4}})
    ops = [ReviewOp(op="move", id="lbl", dx=20), ReviewOp(op="relabel", id="lbl", text="h"), ReviewOp(op="delete", id="ang"),
           ReviewOp(op="restyle", id="alt", color="blue"), ReviewOp(op="to_board", id="lbl", board="new"), ReviewOp(op="delete", id="ghost")]
    fixed, applied = apply_ops(raw, ops)
    assert applied == 5 and raw["elements"][-1]["text"] == "una etichetta molto lunga"  # original untouched
    scene = salvage_scene(fixed, GROUNDING)
    lbl = next(e for e in scene.elements if e.id == "lbl")
    assert lbl.box.x + lbl.box.width <= 100 and lbl.text == "h" and lbl.space == "board1"
    assert "ang" not in {e.id for e in scene.elements} and scene.boards[0].id == "board1"


@pytest.mark.asyncio
async def test_a_drawing_missing_the_point_goes_back_to_the_director_once(monkeypatch):
    from app.services import visual_review
    calls = {}

    async def critic(*args, **kwargs):
        return visual_review.Review(insight=1, legibility=3, alignment=3, clarity=1, restraint=4, verdict="redo", notes=["Manca l'altezza"])

    async def director(source, grounding, explanation, brief, previous, on_usage, feedback=None, action="explain"):
        calls["feedback"] = feedback
        return DrawingScene.model_validate(anchored())
    monkeypatch.setattr(visual_review, "generate_validated", critic)
    monkeypatch.setattr(visual_review, "compose_blackboard", director)
    scene, review, applied = await visual_review.review_drawing("data:image/png;base64,x", anchored(), GROUNDING, "spiega", [], None, source="data:image/png;base64,y")
    assert applied == -1 and calls["feedback"] == ["Manca l'altezza"] and scene["elements"][0]["id"] == "alt"


def test_plot_settings_written_one_level_too_high_are_moved_into_the_plot():
    from app.services.visual_blackboard import salvage_scene
    raw = anchored()
    raw["elements"].append({"id": "curve", "kind": "plot", "space": "image", "anchors": ["a", "b"], "x_ref": 2,
        "plot": {"x_min": -3, "x_max": 3, "y_min": -5, "y_max": 5, "curves": [{"kind": "gaussian", "a": 1, "b": 1}]}})
    scene = salvage_scene(raw, GROUNDING)
    assert next(e for e in scene.elements if e.id == "curve").plot.x_ref == 2


def test_degenerate_circles_and_arrows_are_rejected():
    raw = anchored()
    raw["elements"].append({"id": "dot", "kind": "circle", "space": "image", "anchors": ["apex", "apex"]})
    with pytest.raises(ValueError, match="distinti"):
        validate_scene(raw, GROUNDING)


def test_a_step_pointing_at_three_buttons_becomes_three_steps():
    from app.services.visual_blackboard import one_element_per_step
    grounding = Grounding.model_validate({"subject": "UI", "overview": "toolbar", "regions": [
        {"id": r, "label": r.title(), "box": {"x": 10 * i, "y": 5, "width": 8, "height": 5}, "confidence": "high"} for i, r in enumerate(["nuovo", "salva", "condividi"], 1)]})
    raw = {"title": "Barra", "layout": "overlay", "steps": ["Barra superiore", "Fine"], "notes": ["Tre azioni.", "Ultimo."],
           "points": [{"id": f"p_{r}", "kind": "region", "region": r} for r in ["nuovo", "salva", "condividi"]],
           "elements": [*({"id": f"hl_{r}", "kind": "highlight", "space": "image", "from_region_id": r} for r in ["nuovo", "salva", "condividi"]),
                        *({"id": f"c_{r}", "kind": "callout", "space": "image", "target": f"p_{r}", "text": r.upper()} for r in ["nuovo", "salva", "condividi"]),
                        {"id": "arrow", "kind": "arrow", "space": "image", "points": [{"x": 1, "y": 1}, {"x": 9, "y": 9}]},
                        {"id": "last", "kind": "callout", "space": "image", "target": "p_salva", "text": "fine", "step": 1}]}
    scene = one_element_per_step(validate_scene(raw, grounding), grounding)
    assert scene.steps == ["NUOVO", "SALVA", "CONDIVIDI", "Fine"]
    assert {e.id: e.step for e in scene.elements} == {"hl_nuovo": 0, "c_nuovo": 0, "arrow": 0, "hl_salva": 1, "c_salva": 1,
                                                       "hl_condividi": 2, "c_condividi": 2, "last": 3}
    assert [f.target for f in scene.focus] == ["nuovo", "salva", "condividi"] and scene.notes[2] == "Tre azioni."


def test_boards_with_nothing_on_them_are_dropped():
    from app.services.visual_blackboard import one_element_per_step
    raw = anchored(boards=[{"id": "empty"}], focus=[{"step": 0, "target": "empty"}])
    scene = one_element_per_step(validate_scene(raw, GROUNDING), GROUNDING)
    assert scene.boards == [] and scene.focus == []


def test_marks_without_a_space_stay_on_the_image_when_a_scene_is_salvaged():
    from app.services.visual_blackboard import salvage_scene
    raw = anchored(boards=[{"id": "lav"}])
    for e in raw["elements"]:
        e.pop("space")
    raw["elements"].append({"id": "broken", "kind": "arc", "anchors": ["apex"]})  # forces the salvage path
    raw["elements"].append({"id": "onboard", "kind": "text", "space": "lav", "text": "x", "box": {"x": 1, "y": 1, "width": 9, "height": 9}})
    scene = salvage_scene(raw, GROUNDING)
    assert {e.id: e.space for e in scene.elements} == {"alt": "image", "ang": "image", "note": "image", "onboard": "lav"}


def test_an_alternative_explanation_must_open_a_board():
    from app.services.visual_blackboard import require_action
    scene = validate_scene(anchored(), GROUNDING)
    with pytest.raises(ValueError, match="lavagna"):
        require_action(scene, "side")
    assert require_action(scene, "explorer") is scene  # the interactive graph is a widget, not part of the drawing


def test_an_area_model_is_a_real_grid_with_steps_that_exist():
    raw = {**OVERLAY, "boards": [{"id": "prova"}], "steps": ["Quadrato", "a²", "ab", "b²"], "elements": [{"id": "sq", "kind": "area_model", "space": "prova",
        "box": {"x": 10, "y": 10, "width": 80, "height": 80}, "area_model": {"cols": [{"size": 3, "label": "a"}, {"size": 2, "label": "b"}],
        "rows": [{"size": 3, "label": "a"}, {"size": 2, "label": "b"}], "top": "a + b", "side": "a + b",
        "cells": [[{"label": "a²", "color": "blue", "step": 1}, {"label": "ab", "color": "amber", "step": 2}],
                  [{"label": "ab", "color": "amber", "step": 2}, {"label": "b²", "color": "red", "step": 3}]]}}]}
    assert validate_scene(raw, GROUNDING).elements[0].area_model.cells[1][1].label == "b²"
    raw["elements"][0]["area_model"]["cells"] = raw["elements"][0]["area_model"]["cells"][:1]
    with pytest.raises(ValueError, match="una riga per ogni rows"):
        validate_scene(raw, GROUNDING)
