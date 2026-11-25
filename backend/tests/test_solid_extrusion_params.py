from app.services.solid_modeler_agent import SceneExecutor, sanitize_scene


def _extrusion():
    return {
        "id": "ext-1", "kind": "extrusion", "size": [40, 20, 5], "position": [0, 0, 2.5],
        "params": {
            "profile": [{"outer": [[-20, -10], [20, -10], [20, 10], [-20, 10]], "holes": [[[-2, -2], [-2, 2], [2, 2], [2, -2]]]}],
            "sketch": {
                "entities": [
                    {"id": "r", "type": "rect", "a": [-20, -10], "b": [20, 10]},
                    {"id": "c", "type": "circle", "c": [0, 0], "r": 2},
                    {"id": "a", "type": "arc", "c": [0, 0], "r": 5, "a0": 0, "a1": 1.5708},
                    {"id": "p", "type": "polygon", "c": [5, 5], "r": 3, "n": 6, "rot": 0},
                    {"id": "q", "type": "polyline", "pts": [[0, 0], [1, 1], [2, 0]], "closed": True},
                ],
                "z": 2.5,
                "base": [40, 20, 5],
            },
        },
    }


def test_extrusion_profile_and_sketch_survive_save_roundtrip():
    saved = sanitize_scene([_extrusion()])
    assert saved[0]["kind"] == "extrusion"
    assert saved[0]["params"] == _extrusion()["params"] | {"sketch": {**_extrusion()["params"]["sketch"], "base": [40.0, 20.0, 5.0]}}
    assert sanitize_scene(saved) == saved


def test_invalid_profile_points_and_entities_are_dropped():
    raw = _extrusion()
    raw["params"]["profile"].append({"outer": [[0, 0], [1, "x"]]})
    raw["params"]["sketch"]["entities"].append({"id": "bad", "type": "spline", "pts": []})
    raw["params"]["sketch"]["entities"].append({"id": "nan", "type": "circle", "c": [0, 0], "r": float("nan")})
    saved = sanitize_scene([raw])
    assert len(saved[0]["params"]["profile"]) == 1
    assert [e["id"] for e in saved[0]["params"]["sketch"]["entities"]] == ["r", "c", "a", "p", "q"]


def test_agent_can_add_an_extrusion_profile():
    ex = SceneExecutor([])
    errors = ex.run([{"op": "add", "id": "l_profile", "kind": "extrusion", "size": [30, 30, 4], "position": [0, 0, 2],
                      "params": {"profile": [{"outer": [[-15, -15], [15, -15], [15, -10], [-10, -10], [-10, 15], [-15, 15]]}]}}])
    assert not errors
    assert ex.scene[0]["params"]["profile"][0]["outer"][0] == [-15.0, -15.0]


def test_sketch_objects_roundtrip_and_are_listed_compactly_for_the_agent():
    from app.services.solid_modeler_agent import describe_scene, scene_warnings
    sketch = {
        "id": "sk-1", "kind": "sketch", "size": [1, 1, 1], "position": [0, 0, 20], "rotation": [0, 0, 0],
        "params": {"sketch": {"entities": [
            {"id": "r", "type": "rect", "a": [-5, -5], "b": [5, 5]},
            {"id": "m", "type": "point", "p": [0, 5]},
            {"id": "x", "type": "point", "p": ["bad", 1]},
        ], "z": 0, "base": [1, 1, 1], "target": "box-1"}},
    }
    saved = sanitize_scene([sketch, {"id": "box-1", "kind": "box", "size": [40, 40, 20], "position": [0, 0, 10]}])
    assert saved[0]["kind"] == "sketch"
    assert [e["id"] for e in saved[0]["params"]["sketch"]["entities"]] == ["r", "m"]
    assert saved[0]["params"]["sketch"]["target"] == "box-1"
    assert sanitize_scene(saved) == saved
    rows = describe_scene(saved)
    assert rows[0] == {"id": "sk-1", "kind": "sketch", "name": "sketch", "origin": [0, 0, 20], "rotation": [0, 0, 0], "entities": ["r:rect", "m:point"]}
    assert "bbox_min" in rows[1]
    assert not any("sk-1" in w for w in scene_warnings(saved, final=True))


def test_revolve_curves_and_feature_source_roundtrip():
    revolve = {
        "id": "rev-1", "kind": "revolve", "size": [20, 20, 8], "position": [0, 0, 4],
        "params": {
            "revolve": {"profile": [{"outer": [[5, 0], [10, 0], [10, 4], [5, 4]]}], "axis": {"a": [0, 0], "d": [0, 1]}, "angle": 270},
            "source": {"sketchId": "sk-1", "points": [[7, 2]], "op": "revolve", "entityIds": ["e1", "e2", 7], "axis": {"a": [0, 0], "d": [0, 1]}, "angle": 270},
        },
    }
    sketch = {
        "id": "sk-1", "kind": "sketch", "size": [1, 1, 1],
        "params": {"sketch": {"entities": [
            {"id": "b", "type": "bezier", "pts": [[0, 0], [0, 5], [5, 5], [5, 0]]},
            {"id": "bad", "type": "bezier", "pts": [[0, 0], [1, 1]]},
            {"id": "s", "type": "spline", "pts": [[0, 0], [2, 3], [5, 1]]},
        ], "z": 0, "base": [1, 1, 1]}},
    }
    saved = sanitize_scene([revolve, sketch])
    assert saved[0]["kind"] == "revolve"
    assert saved[0]["params"]["revolve"]["angle"] == 270.0
    assert saved[0]["params"]["source"]["sketchId"] == "sk-1"
    assert saved[0]["params"]["source"]["entityIds"] == ["e1", "e2"]
    assert [e["id"] for e in saved[1]["params"]["sketch"]["entities"]] == ["b", "s"]
    assert sanitize_scene(saved) == saved
    broken = sanitize_scene([{"id": "r", "kind": "revolve", "params": {"revolve": {"profile": [], "axis": {}}}}])
    assert broken[0]["params"] == {}
