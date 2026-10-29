from app.services.solid_modeler_agent import sanitize_scene


def test_polyhedra_and_edge_fillets_survive_scene_save_roundtrip():
    edge = "0.50000,0.50000,-0.50000|0.50000,0.50000,0.50000"
    scene = [{"id": "poly", "kind": "polyhedron", "size": [20, 30, 40],
              "params": {"faces": 9, "edgeFillets": {edge: 1.5}}}]
    saved = sanitize_scene(scene)
    assert saved[0]["kind"] == "polyhedron"
    assert saved[0]["params"] == scene[0]["params"]
    assert sanitize_scene(saved) == saved


def test_invalid_fillets_are_removed_and_face_count_is_bounded():
    edge = "0,0,0|1,1,1"
    saved = sanitize_scene([{"id": "poly", "kind": "polyhedron", "params": {
        "faces": 1000, "edgeFillets": {edge: float("nan"), "bad": 2, "0,0,0|0,0,1": -2},
    }}])
    assert saved[0]["params"] == {"faces": 64, "edgeFillets": {}}


if __name__ == "__main__":
    test_polyhedra_and_edge_fillets_survive_scene_save_roundtrip()
    test_invalid_fillets_are_removed_and_face_count_is_bounded()
    print("2 scene persistence checks passed")
