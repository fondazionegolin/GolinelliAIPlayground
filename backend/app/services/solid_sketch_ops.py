"""Sketch-based modelling for the 3D Lab agent: planes, sketches, extrusions and revolves.

The agent works like a CAD user: it draws a 2D sketch on a plane (or on a face of an object), then extrudes or
revolves it. Exact profiles are rebuilt by the browser from the sketch (same code the user's tools use); here we only
create the linked objects with a good approximation of their size and position, so the agent's geometric feedback
(bounding boxes, contacts, holes) works while it builds.
"""

from __future__ import annotations

import math
from typing import Any, Optional

Vec = list[float]

# Named sketch planes: (x axis, y axis, normal) — the normal points to the viewer, x × y = n.
PLANES: dict[str, tuple[Vec, Vec, Vec]] = {
    "top": ([1, 0, 0], [0, 1, 0], [0, 0, 1]),
    "bottom": ([1, 0, 0], [0, -1, 0], [0, 0, -1]),
    "front": ([1, 0, 0], [0, 0, 1], [0, -1, 0]),
    "back": ([-1, 0, 0], [0, 0, 1], [0, 1, 0]),
    "right": ([0, 1, 0], [0, 0, 1], [1, 0, 0]),
    "left": ([0, -1, 0], [0, 0, 1], [-1, 0, 0]),
}
ALIASES = {"xy": "top", "xz": "front", "yz": "right", "+z": "top", "-z": "bottom", "-y": "front", "+y": "back", "+x": "right", "-x": "left"}


def _add(a: Vec, b: Vec) -> Vec:
    return [a[i] + b[i] for i in range(3)]


def _mul(a: Vec, s: float) -> Vec:
    return [v * s for v in a]


def _dot(a: Vec, b: Vec) -> float:
    return sum(a[i] * b[i] for i in range(3))


def _cross(a: Vec, b: Vec) -> Vec:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _norm(a: Vec) -> Vec:
    n = math.sqrt(_dot(a, a)) or 1.0
    return [v / n for v in a]


def euler_from_basis(x: Vec, y: Vec, n: Vec) -> list[float]:
    """Euler XYZ (degrees, three.js convention) of the rotation whose columns are x, y, n."""
    m11, m12, m13 = x[0], y[0], n[0]
    m22, m23 = y[1], n[1]
    m32, m33 = y[2], n[2]
    ry = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        rx = math.atan2(-m23, m33)
        rz = math.atan2(-m12, m11)
    else:
        rx = math.atan2(m32, m22)
        rz = 0.0
    return [round(math.degrees(v), 4) + 0.0 for v in (rx, ry, rz)]


def to_world(plane: dict, u: float, v: float, w: float = 0.0) -> Vec:
    return _add(_add(_add(plane["origin"], _mul(plane["x"], u)), _mul(plane["y"], v)), _mul(plane["n"], w))


def resolve_plane(spec: Any, offset: Any, bbox_of) -> tuple[Optional[dict], Optional[str]]:
    """Plane from the agent's spec: a name ("top", "front", …), {"face": {"object": id, "side": "+z"}} or
    {"origin": [...], "x": [...], "y": [...]}; `offset` moves it along its normal."""
    target = None
    if isinstance(spec, str):
        name = ALIASES.get(spec.lower(), spec.lower())
        if name not in PLANES:
            return None, f"piano sconosciuto '{spec}' (usa top/front/right/back/left/bottom o face)"
        x, y, n = PLANES[name]
        origin: Vec = [0.0, 0.0, 0.0]
    elif isinstance(spec, dict) and isinstance(spec.get("face"), dict):
        face = spec["face"]
        side = ALIASES.get(str(face.get("side", "+z")).lower(), str(face.get("side", "+z")).lower())
        if side not in PLANES:
            return None, f"faccia '{face.get('side')}' non valida (usa +z, -z, +x, -x, +y, -y)"
        box = bbox_of(face.get("object"))
        if not box:
            return None, f"oggetto '{face.get('object')}' non trovato per la faccia"
        mn, mx = box
        x, y, n = PLANES[side]
        # Origin on the face but at the world origin's projection: u, v are plain world coordinates along the plane axes.
        axis = [i for i in range(3) if abs(n[i]) > 0.5][0]
        origin = [0.0, 0.0, 0.0]
        origin[axis] = mx[axis] if n[axis] > 0 else mn[axis]
        target = str(face.get("object"))
    elif isinstance(spec, dict) and isinstance(spec.get("origin"), list) and isinstance(spec.get("x"), list) and isinstance(spec.get("y"), list):
        try:
            origin = [float(v) for v in spec["origin"][:3]]
            x = _norm([float(v) for v in spec["x"][:3]])
            y0 = [float(v) for v in spec["y"][:3]]
        except (TypeError, ValueError):
            return None, "piano personalizzato non valido"
        n = _norm(_cross(x, y0))
        y = _cross(n, x)
    else:
        return None, "manca 'plane' (es. \"top\", \"front\", {\"face\": {\"object\": \"id\", \"side\": \"+z\"}})"
    if isinstance(spec, dict) and isinstance(spec.get("origin"), list) and "face" not in spec and len(spec["origin"]) == 3:
        try:
            origin = [float(v) for v in spec["origin"]]
        except (TypeError, ValueError):
            pass
    try:
        off = float(offset or 0)
    except (TypeError, ValueError):
        off = 0.0
    origin = _add(origin, _mul(list(n), off))
    plane = {"origin": [round(v, 4) for v in origin], "x": list(x), "y": list(y), "n": list(n)}
    if target:
        plane["target"] = target
    return plane, None


def sketch_object(obj_id: str, name: str, plane: dict, entities: list[dict]) -> dict:
    sketch: dict = {"entities": entities, "z": 0.0, "base": [1.0, 1.0, 1.0]}
    if plane.get("target"):
        sketch["target"] = plane["target"]
    return {
        "id": obj_id, "name": name, "kind": "sketch", "color": "#2563eb", "hole": False,
        "position": list(plane["origin"]), "rotation": euler_from_basis(plane["x"], plane["y"], plane["n"]),
        "size": [1.0, 1.0, 1.0], "params": {"sketch": sketch},
    }


def plane_of(sketch: dict, matrix_of) -> dict:
    """Plane frame of a sketch object (origin = position, axes = its rotation)."""
    m = matrix_of({**sketch, "size": [1, 1, 1]})
    col = lambda i: _norm([m[0][i], m[1][i], m[2][i]])  # noqa: E731
    return {"origin": list(sketch["position"]), "x": col(0), "y": col(1), "n": col(2)}


def entity_points(e: dict) -> list[tuple[float, float]]:
    t = e.get("type")
    if t in ("line", "rect"):
        a, b = e["a"], e["b"]
        return [(a[0], a[1]), (b[0], b[1])] if t == "line" else [(a[0], a[1]), (b[0], a[1]), (b[0], b[1]), (a[0], b[1])]
    if t in ("polyline", "spline", "bezier"):
        return [(p[0], p[1]) for p in e["pts"]]
    if t == "point":
        return [(e["p"][0], e["p"][1])]
    if t == "circle":
        return [(e["c"][0] + e["r"] * math.cos(k * math.pi / 12), e["c"][1] + e["r"] * math.sin(k * math.pi / 12)) for k in range(24)]
    if t == "arc":
        sweep = (e["a1"] - e["a0"]) % (2 * math.pi) or 2 * math.pi
        return [(e["c"][0] + e["r"] * math.cos(e["a0"] + sweep * k / 16), e["c"][1] + e["r"] * math.sin(e["a0"] + sweep * k / 16)) for k in range(17)]
    if t == "ellipse":
        c, s = math.cos(e["rot"]), math.sin(e["rot"])
        out = []
        for k in range(24):
            px, py = e["rx"] * math.cos(k * math.pi / 12), e["ry"] * math.sin(k * math.pi / 12)
            out.append((e["c"][0] + px * c - py * s, e["c"][1] + px * s + py * c))
        return out
    if t == "polygon":
        n = max(3, int(e.get("n", 6)))
        return [(e["c"][0] + e["r"] * math.cos(e["rot"] + 2 * math.pi * k / n), e["c"][1] + e["r"] * math.sin(e["rot"] + 2 * math.pi * k / n)) for k in range(n)]
    return []


def _box_from_local(plane: dict, pts: list[Vec]) -> tuple[Vec, Vec, Vec]:
    """Size and centre (in the plane frame) of local points (u, v, w)."""
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    size = [max(0.1, mx[i] - mn[i]) for i in range(3)]
    centre = [(mn[i] + mx[i]) / 2 for i in range(3)]
    return size, centre, to_world(plane, centre[0], centre[1], centre[2])


def extrusion_object(sketch: dict, plane: dict, lo: float, hi: float, obj_id: str, name: str, color: str, hole: bool,
                     points: list[list[float]]) -> tuple[Optional[dict], Optional[str]]:
    ents = [e for e in sketch["params"]["sketch"]["entities"] if e.get("type") != "point"]
    pts = [p for e in ents for p in entity_points(e)]
    if not pts:
        return None, "lo sketch non ha tratti da estrudere"
    local = [[u, v, w] for (u, v) in pts for w in (lo, hi)]
    size, _, world = _box_from_local(plane, local)
    return {
        "id": obj_id, "name": name, "kind": "extrusion", "color": color, "hole": hole,
        "position": [round(c, 4) for c in world], "rotation": euler_from_basis(plane["x"], plane["y"], plane["n"]),
        "size": [round(s, 4) for s in size],
        "params": {"source": {"sketchId": sketch["id"], "points": points, "op": "extrude", "lo": round(lo, 4), "hi": round(hi, 4)}},
    }, None


def revolve_object(sketch: dict, plane: dict, entity_ids: list[str], axis: dict, angle: float, obj_id: str, name: str,
                   color: str, hole: bool) -> tuple[Optional[dict], Optional[str]]:
    ents = [e for e in sketch["params"]["sketch"]["entities"] if e.get("id") in entity_ids and e.get("type") != "point"]
    pts = [p for e in ents for p in entity_points(e)]
    if not pts:
        return None, "nessun tratto da ruotare (controlla 'entities')"
    a, d = axis["a"], axis["d"]
    dl = math.hypot(d[0], d[1]) or 1.0
    du, dv = d[0] / dl, d[1] / dl
    rows = [((p[0] - a[0]) * du + (p[1] - a[1]) * dv, -(p[0] - a[0]) * dv + (p[1] - a[1]) * du) for p in pts]
    rs = [r for _, r in rows]
    if min(rs) < -1e-3 and max(rs) > 1e-3:
        return None, "il profilo attraversa l'asse: deve stare tutto da un lato (o toccarlo)"
    rmax = max(abs(r) for r in rs)
    sign = 1 if max(rs) > 1e-3 else -1
    smin, smax = min(s for s, _ in rows), max(s for s, _ in rows)
    side = (-dv * sign, du * sign)
    steps = max(4, int(angle / 15))
    local: list[Vec] = []
    for s in (smin, smax):
        base = (a[0] + du * s, a[1] + dv * s)
        for k in range(steps + 1):
            t = math.radians(angle) * k / steps
            local.append([base[0] + side[0] * rmax * math.cos(t), base[1] + side[1] * rmax * math.cos(t), rmax * math.sin(t)])
        local.append([base[0], base[1], 0.0])
    size, _, world = _box_from_local(plane, local)
    return {
        "id": obj_id, "name": name, "kind": "revolve", "color": color, "hole": hole,
        "position": [round(c, 4) for c in world], "rotation": euler_from_basis(plane["x"], plane["y"], plane["n"]),
        "size": [round(s, 4) for s in size],
        "params": {"source": {"sketchId": sketch["id"], "points": [], "op": "revolve", "entityIds": entity_ids,
                              "axis": {"a": [a[0], a[1]], "d": [d[0], d[1]]}, "angle": angle}},
    }, None


def describe_sketch(obj: dict) -> dict:
    ents = obj.get("params", {}).get("sketch", {}).get("entities", [])
    return {
        "id": obj["id"], "kind": "sketch", "name": obj.get("name"),
        "origin": [round(v, 1) for v in obj["position"]], "rotation": obj.get("rotation"),
        "entities": [f"{e.get('id')}:{e.get('type')}" for e in ents][:80],
    }
