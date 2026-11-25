from app.services.solid_modeler_agent import SceneExecutor, describe_scene, object_bbox, sanitize_scene
from app.services.solid_sketch_ops import euler_from_basis


def _run(actions, scene=None):
    ex = SceneExecutor(scene or [])
    errors = ex.run(actions)
    return ex, errors


def test_euler_matches_named_planes():
    assert euler_from_basis([1, 0, 0], [0, 1, 0], [0, 0, 1]) == [0.0, 0.0, 0.0]
    assert euler_from_basis([1, 0, 0], [0, 0, 1], [0, -1, 0]) == [90.0, 0.0, 0.0]


def test_pen_like_body_revolved_from_a_front_sketch():
    ex, errors = _run([
        {"op": "sketch", "id": "profilo", "plane": "front", "entities": [
            {"id": "asse", "type": "line", "a": [0, 0], "b": [0, 130]},
            {"id": "s1", "type": "spline", "pts": [[0, 0], [5, 4], [7, 40], [7, 100], [4, 128], [0, 130]]},
        ]},
        {"op": "revolve", "id": "corpo", "sketch": "profilo", "axis": "asse"},
        {"op": "sketch", "id": "cav", "plane": "front", "entities": [
            {"id": "ax", "type": "line", "a": [0, 0], "b": [0, 130]}, {"id": "r", "type": "rect", "a": [0, 10], "b": [3, 110]},
        ]},
        {"op": "revolve", "id": "serbatoio", "sketch": "cav", "axis": "ax", "mode": "hole"},
        {"op": "group", "ids": ["corpo", "serbatoio"], "id": "penna"},
    ])
    assert errors == []
    body = next(o for o in ex.scene if o["id"] == "penna")
    mn, mx = object_bbox(body)
    assert abs(mn[2]) < 1 and abs(mx[2] - 130) < 1
    assert abs(mx[0] - 7) < 1 and abs(mn[0] + 7) < 1
    assert abs(mx[1] - 7) < 1 and abs(mn[1] + 7) < 1
    corpo = next(c for c in body["children"] if c["id"] == "corpo")
    assert corpo["params"]["source"]["entityIds"] == ["s1"]
    rows = describe_scene(ex.scene)
    assert any(r.get("kind") == "sketch" and "asse:line" in r["entities"] for r in rows)
    assert sanitize_scene(ex.scene)  # survives a save


def test_extrude_on_a_face_and_errors_are_explained():
    ex, errors = _run([
        {"op": "add", "id": "base", "kind": "box", "size": [40, 40, 10], "position": [0, 0, 5]},
        {"op": "sketch", "id": "foro_sk", "plane": {"face": {"object": "base", "side": "+z"}}, "entities": [{"id": "c", "type": "circle", "c": [0, 0], "r": 5}]},
        {"op": "extrude", "id": "foro", "sketch": "foro_sk", "distance": -6, "mode": "hole"},
    ])
    assert errors == []
    foro = next(o for o in ex.scene if o["id"] == "foro")
    mn, mx = object_bbox(foro)
    assert abs(mx[2] - 10.1) < 0.01 and abs(mn[2] - 4) < 0.01
    assert foro["hole"] is True
    _, errs = _run([
        {"op": "sketch", "id": "s", "plane": "top", "entities": [{"id": "l", "type": "line", "a": [0, 0], "b": [10, 0]}, {"id": "r", "type": "rect", "a": [-5, 2], "b": [5, 8]}]},
        {"op": "revolve", "id": "x", "sketch": "s", "axis": "l", "entities": ["r"]},
        {"op": "revolve", "id": "y", "sketch": "s", "axis": "y", "entities": ["r"]},
        {"op": "extrude", "id": "z", "sketch": "manca"},
        {"op": "sketch", "id": "bad", "plane": "nowhere", "entities": []},
    ])
    assert any("attraversa l'asse" in e for e in errs)
    assert any("non trovato" in e for e in errs)
    assert any("piano sconosciuto" in e for e in errs)


def test_sketch_edit_marks_linked_features_for_rebuild():
    ex, errors = _run([
        {"op": "sketch", "id": "s", "plane": "top", "entities": [{"id": "r", "type": "rect", "a": [0, 0], "b": [10, 10]}]},
        {"op": "extrude", "id": "e", "sketch": "s", "distance": 5},
    ])
    ex.scene[-1]["params"]["profile"] = [{"outer": [[0, 0], [1, 0], [1, 1]], "holes": []}]
    errors += ex.run([{"op": "sketch_edit", "id": "s", "entities": [{"id": "r", "type": "rect", "a": [0, 0], "b": [20, 10]}]}])
    assert errors == []
    assert "profile" not in ex.scene[-1]["params"]
    assert ex.scene[0]["params"]["sketch"]["entities"][0]["b"] == [20.0, 10.0]
