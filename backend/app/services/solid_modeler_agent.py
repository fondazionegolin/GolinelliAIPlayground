"""Agentic builder for the 3D Lab solid modeler (Tinkercad-like prototype).

The LLM never writes geometry directly: it emits JSON actions (add, update,
pattern, mirror, group, ...) that are executed on a plain-JSON scene. After
every step the agent receives a geometric observation (bounding boxes and
sanity warnings such as floating parts or holes that cut nothing) so it can
inspect its own work and fix it before declaring the model done.

Scene conventions are shared with the frontend editor
(`frontend/src/components/solidModeler/`):
- units are millimetres, Z is up, the work plate is the XY plane at z=0;
- every primitive exactly fills its `size` box [x, y, z], centred on `position`;
- `rotation` is Euler XYZ in degrees (three.js order: M = Rx · Ry · Rz);
- a group carries `children` in group-local coordinates plus `scale`;
  inside a group solids are unioned and holes subtracted.
"""
from __future__ import annotations

import copy
import json
import math
import re
from dataclasses import dataclass
from typing import Any, Optional

from app.services.json_extract import extract_json
from app.services import solid_sketch_ops as sk

PRIMITIVE_KINDS = {
    "box", "cylinder", "sphere", "cone", "pyramid", "hemisphere",
    "wedge", "torus", "tube", "star", "text", "polyhedron", "extrusion", "sketch", "revolve",
}
PLATE_SIZE = 200.0
MAX_OBJECTS = 160
PALETTE = ["#e8453c", "#f59e0b", "#facc15", "#22c55e", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#94a3b8", "#f8fafc"]

SYSTEM_PROMPT = """Sei l'assistente di modellazione 3D di un modellatore solido stile Tinkercad per la scuola.
Costruisci oggetti COMBINANDO PRIMITIVE, ragionando come un bravo maker: scomponi l'oggetto in parti,
stima le proporzioni reali, posiziona le parti in modo che si tocchino/compenetrino, usa i FORI (hole) e i GRUPPI per scavare.

## Sistema di coordinate
- Unità: millimetri. Asse Z verso l'alto. Il piatto di lavoro è il piano XY (z=0), 200x200 mm centrato nell'origine.
- Orientamento: il FRONTE del piatto (targhetta "FRONTE") è il lato -Y, il retro è +Y, la destra è +X, la sinistra è -X.
  Porte, facce, occhi, scritte e tutto ciò che "guarda avanti" va sul lato -Y dell'oggetto.
- Ogni primitiva riempie ESATTAMENTE il suo box `size` = [larghezza X, profondità Y, altezza Z], centrato in `position` = [x, y, z].
  Quindi un oggetto appoggiato sul piatto ha z = altezza/2. Un oggetto sopra un altro alto H ha z = H + propria_altezza/2.
- `rotation` = [rx, ry, rz] in gradi (Euler XYZ). Per un cilindro orizzontale lungo X usa rotation [0, 90, 0] e size [d, d, lunghezza]
  (la size è sempre nel riferimento locale, prima della rotazione).
- Oggetti ragionevoli: 20–150 mm. Pareti stampabili ≥ 1.2 mm.

## Primitive (kind) e params opzionali
- box: parallelepipedo. params.radius (0–0.49, raccordo (fillet) di TUTTI gli spigoli, come frazione del lato più corto; default 0).
- cylinder: asse Z. params.sides (3–64, default 32; 6 = prisma esagonale).
- cone: punta in alto (+Z). params.topRatio (0 = punta, 0.5 = tronco di cono), params.sides.
- pyramid: base quadrata, punta in alto.
- polyhedron: piramide a base poligonale, params.faces (4–64, default 7) indica il numero totale di facce.
- params.edgeFillets: mappa identificativo spigolo → raggio in mm; preserva questi raccordi nelle modifiche.
- sphere: sfera/ellissoide.
- hemisphere: cupola, base piatta in basso.
- wedge: cuneo/rampa: faccia piena a -X alta quanto size z, scende a 0 verso +X.
- torus: ciambella piatta nel piano XY. params.thickness (0.05–0.45, frazione dello spessore del tubo rispetto alla larghezza, default 0.2).
- tube: cilindro cavo verticale. params.wall (0.05–0.45, frazione della parete rispetto al diametro, default 0.12).
- star: stella estrusa verticale. params.points (default 5), params.inner (0.2–0.9, default 0.5).
- text: testo estruso, params.text (max 24 caratteri); la size è il box del testo.
- extrusion: profilo 2D chiuso estruso lungo Z locale (creato da uno sketch: preferisci l'azione extrude).
  params.profile = [{"outer": [[x,y],...], "holes": [[[x,y],...]]}] in mm, centrato sull'origine; size = [ingombro X, ingombro Y, spessore].
  Puoi crearne di nuovi per sagome che le primitive non danno (es. profilo a L, lettera, sagoma) e puoi spostarle/ridimensionarle;
  NON modificare né rimuovere params.sketch (serve all'utente per riaprire lo sketch).
- revolve: solido di rotazione di un profilo 2D attorno a un asse (params.revolve = profile, axis, angle), creato dall'utente. Come extrusion:
  puoi spostarlo/ridimensionarlo ma NON toccare params.revolve né params.source (collegano il solido allo sketch).
- sketch: disegno 2D nella scena (pellicola azzurra, non è solido): è la base di extrusion/revolve. Gli sketch dell'utente
  non vanno cancellati; puoi crearne di tuoi (azione sketch) e modificarli (sketch_edit).

## Modellazione da SKETCH (come in un CAD: usala per pezzi complessi, curvi o torniti)
Le primitive vanno bene per forme semplici. Per pezzi veri (penne, bottiglie, vasi, manopole, pennini, sagome, staffe)
lavora come un progettista CAD: disegna uno SKETCH 2D quotato su un piano, poi ESTRUDILO o RUOTALO attorno a un asse.
Puoi alternare liberamente sketch e primitive: per esempio corpo tornito da sketch + clip con primitive + foro da sketch.

Piani (`plane`): "top" (XY, guarda +Z), "front" (XZ, guarda -Y: u=X, v=Z), "right" (YZ, guarda +X: u=Y, v=Z),
"back", "left", "bottom"; oppure {"face": {"object": "id", "side": "+z"}} per disegnare sulla faccia di un oggetto
(il piano giace sulla faccia, ma u, v restano le coordinate del MONDO lungo gli assi del piano: su "+x" u=Y, v=Z;
su "+z" u=X, v=Y; su "-y" (fronte) u=X, v=Z); "offset": mm lungo la normale. Le coordinate delle entità sono [u, v] in mm.
Sul piano "front" quindi u = X del mondo e v = Z (altezza): ideale per i profili da ruotare attorno all'asse verticale.

Entità (ogni entità ha un "id" univoco nello sketch):
- {"id":"l1","type":"line","a":[u,v],"b":[u,v]}
- {"id":"r1","type":"rect","a":[u,v],"b":[u,v]}   (angoli opposti)
- {"id":"c1","type":"circle","c":[u,v],"r":5}
- {"id":"e1","type":"ellipse","c":[u,v],"rx":6,"ry":3,"rot":0}
- {"id":"p1","type":"polygon","c":[u,v],"r":8,"n":6,"rot":0}
- {"id":"a1","type":"arc","c":[u,v],"r":5,"a0":0,"a1":1.5708}   (radianti, antiorario da a0 ad a1)
- {"id":"s1","type":"spline","pts":[[u,v],...]}   (curva morbida che PASSA per i punti: profili organici)
- {"id":"b1","type":"bezier","pts":[[u,v],[u,v],[u,v],[u,v]]}   (inizio, controllo 1, controllo 2, fine)
- {"id":"q1","type":"polyline","pts":[[u,v],...],"closed":true}
Un profilo è estrudibile solo se i tratti formano una figura CHIUSA (estremi coincidenti esattamente).

Azioni sketch:
- {"op":"sketch","id":"profilo_corpo","name":"Profilo corpo","plane":"front","entities":[...]}
- {"op":"sketch_edit","id":"profilo_corpo","entities":[...],"remove":["l3"]}   (sostituisce/aggiunge entità per id; i solidi collegati si aggiornano)
- {"op":"extrude","id":"pennino","sketch":"sk_pennino","distance":0.8,"mode":"solid"}
    distance > 0 verso la normale del piano, < 0 dal lato opposto; "symmetric":true centra lo spessore sul piano;
    oppure "from"/"to" (mm lungo la normale). "mode":"hole" crea un FORO da raggruppare con i solidi da scavare.
    "points":[[u,v]] (opzionale) = un punto dentro ciascun profilo da usare, se lo sketch ne ha più d'uno.
- {"op":"revolve","id":"corpo","sketch":"profilo_corpo","axis":"asse","entities":["s1","l1","l2"],"angle":360,"mode":"solid"}
    axis = id di una LINEA dello sketch, oppure "x"/"y" (assi del piano). entities = tratti da ruotare (default: tutti tranne l'asse).
    Il profilo deve stare tutto da UN lato dell'asse. Una curva APERTA i cui estremi non toccano l'asse viene chiusa da sola
    con perpendicolari sull'asse: basta disegnare la sagoma esterna (es. metà silhouette di una penna o di un vaso).
    "mode":"hole" + group con il solido = cavità interna tornita (es. serbatoio dell'inchiostro, interno di una bottiglia).
Gli sketch compaiono nella SCENA come {"kind":"sketch", entities:[id:tipo]} e i solidi derivati con "from_sketch".

Esempio di ragionamento (penna stilografica, asse verticale Z, appoggiata in piedi):
1. sketch "profilo_corpo" su "front" con una spline della metà destra della silhouette (u = raggio 0–7 mm, v = 0–130 mm)
   e una linea "asse" su u=0; revolve attorno a "asse" → corpo e cappuccio torniti.
2. sketch "profilo_cavita" su "front" (rettangolo stretto u 0–3, v 10–110) + linea asse → revolve mode "hole" → serbatoio.
3. sketch "sk_pennino" su un piano "front" con offset adatto: spline/bezier chiuse della sagoma del pennino + slot (rect sottile)
   → extrude distance 0.8 symmetric; un sketch del foro di sfiato (circle) → extrude mode "hole".
4. clip con box/rect estruso; poi group dei fori con i solidi giusti. Controlla le bbox nell'osservazione e correggi.

## Solidi, fori, gruppi
- Ogni oggetto è solido (hole=false) o FORO (hole=true). Un foro NON scava nulla finché non viene RAGGRUPPATO con i solidi da scavare.
- `group` unisce i solidi e sottrae i fori: è così che si fanno cavità, fessure, maniglie, finestre.
- Dopo il gruppo i figli non sono più indirizzabili; il gruppo si muove/ruota/scala come un oggetto unico (update su id del gruppo).
- Raggruppa SOLO alla fine di una parte, quando le posizioni sono verificate.
- Un gruppo ha UN SOLO colore (quello del primo solido o il `color` del gruppo): se parti diverse devono restare
  di colori diversi (es. scritta in rilievo colorata), NON raggrupparle insieme; raggruppa solo ciò che serve per i fori.

## Formato risposta (SOLO JSON, niente testo fuori)
{
  "thought": "piano breve in italiano: parti, dimensioni, cosa fai in questo passo / cosa correggi",
  "actions": [ ... ],
  "done": false,
  "message": "messaggio finale breve per il docente (solo quando done=true)"
}

## Azioni
- {"op":"add","id":"gamba_1","kind":"cylinder","name":"Gamba","size":[8,8,40],"position":[30,20,20],"rotation":[0,0,0],"color":"#22c55e","hole":false,"params":{}}
- {"op":"update","id":"...","size":[...],"position":[...],"rotation":[...],"color":"...","hole":true,"name":"...","params":{}}  (solo i campi da cambiare)
- {"op":"move","id":"...","by":[dx,dy,dz]}
- {"op":"delete","id":"..."}
- {"op":"duplicate","id":"...","new_id":"...","offset":[dx,dy,dz]}
- {"op":"mirror","id":"...","new_id":"...","axis":"x","about":0}   (copia specchiata rispetto al piano x=about oppure y=about)
- {"op":"pattern_linear","id":"...","count":4,"step":[20,0,0],"id_prefix":"dente"}   (crea count-1 copie aggiuntive)
- {"op":"pattern_circular","id":"...","count":6,"center":[0,0],"id_prefix":"petalo","rotate":true}   (copie attorno all'asse Z; l'originale è la prima)
- {"op":"group","ids":["a","b","foro"],"id":"corpo","name":"Corpo","color":"#0ea5e9"}
- {"op":"drop","id":"..."}   (appoggia l'oggetto sul piatto, z_min = 0)

## Metodo di lavoro (agentico)
1. Primo passo: nel thought scomponi l'oggetto in parti con misure; poi aggiungi TUTTE le parti principali.
2. Dopo ogni passo ricevi un'OSSERVAZIONE con i bounding box reali (min/max) e avvisi (parti sospese, fori che non tagliano nulla,
   oggetti sotto il piatto, compenetrazioni mancanti). Controlla numericamente i contatti tra parti e correggi.
3. Solo quando la geometria è coerente: crea i gruppi necessari (fori inclusi) e rispondi con done=true.
4. Massimo {max_steps} passi totali: sii efficiente, usa pattern e mirror per parti ripetute/simmetriche.
5. Se nella scena ci sono già oggetti del docente, modificali o costruisci accanto a seconda della richiesta; non cancellare
   oggetti non pertinenti.
6. Colori vivaci e sensati (hex). Nomi degli oggetti in italiano.
"""


@dataclass
class AgentStepResult:
    thought: str
    actions: list[dict]
    errors: list[str]
    warnings: list[str]
    done: bool
    message: str


# ── Math helpers (mirror three.js: Euler XYZ → M = Rx·Ry·Rz) ──────────────

Mat = list[list[float]]


def _mat_identity() -> Mat:
    return [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]


def _mat_mul(a: Mat, b: Mat) -> Mat:
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _compose(position: list[float], rotation_deg: list[float], scale: list[float]) -> Mat:
    rx, ry, rz = (math.radians(v) for v in rotation_deg)
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    rx_m = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    ry_m = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    rz_m = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]

    def m3(a, b):
        return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]

    r = m3(m3(rx_m, ry_m), rz_m)
    m = _mat_identity()
    for i in range(3):
        for j in range(3):
            m[i][j] = r[i][j] * scale[j]
        m[i][3] = position[i]
    return m


def _apply(m: Mat, p: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
    )


_UNIT_CORNERS = [(x, y, z) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)]


def object_matrix(obj: dict) -> Mat:
    scale = obj.get("scale") if obj.get("kind") == "group" else obj.get("size")
    return _compose(obj.get("position") or [0, 0, 0], obj.get("rotation") or [0, 0, 0], scale or [1, 1, 1])


def _points(obj: dict, parent: Mat, include_holes: bool) -> list[tuple[float, float, float]]:
    m = _mat_mul(parent, object_matrix(obj))
    if obj.get("kind") != "group":
        return [_apply(m, c) for c in _UNIT_CORNERS]
    children = obj.get("children") or []
    solids = [c for c in children if not c.get("hole")]
    source = children if (include_holes or not solids) else solids
    pts: list[tuple[float, float, float]] = []
    for child in source:
        pts.extend(_points(child, m, include_holes))
    return pts


def object_bbox(obj: dict) -> tuple[list[float], list[float]]:
    pts = _points(obj, _mat_identity(), include_holes=False)
    if not pts:
        p = obj.get("position") or [0, 0, 0]
        return list(p), list(p)
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    return mn, mx


def _boxes_touch(a: tuple[list[float], list[float]], b: tuple[list[float], list[float]], tol: float = 0.6) -> bool:
    return all(a[0][i] <= b[1][i] + tol and b[0][i] <= a[1][i] + tol for i in range(3))


def _boxes_overlap(a: tuple[list[float], list[float]], b: tuple[list[float], list[float]]) -> bool:
    return all(a[0][i] < b[1][i] - 0.05 and b[0][i] < a[1][i] - 0.05 for i in range(3))


def _r(v: float) -> float:
    return round(float(v), 1)


# ── Scene sanitation ──────────────────────────────────────────────────────

def _vec3(value: Any, fallback: list[float], lo: float = -2000.0, hi: float = 2000.0) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return list(fallback)
    out = []
    for i, v in enumerate(value):
        try:
            f = float(v)
        except (TypeError, ValueError):
            f = fallback[i]
        if not math.isfinite(f):
            f = fallback[i]
        out.append(max(lo, min(hi, f)))
    return out


_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _color(value: Any, fallback: str) -> str:
    return value if isinstance(value, str) and _HEX.match(value) else fallback


def _clean_params(kind: str, params: Any) -> dict:
    if not isinstance(params, dict):
        return {}
    out: dict = {}
    for key in ("sides", "points", "faces"):
        if key in params:
            try:
                out[key] = max(4 if key == "faces" else 3, min(64, int(params[key])))
            except (TypeError, ValueError):
                pass
    for key, lo, hi in (("radius", 0.0, 0.5), ("topRatio", 0.0, 1.0), ("thickness", 0.05, 0.45), ("wall", 0.05, 0.45), ("inner", 0.2, 0.9)):
        if key in params:
            try:
                out[key] = max(lo, min(hi, float(params[key])))
            except (TypeError, ValueError):
                pass
    if isinstance(params.get("edgeFillets"), dict):
        fillets = {}
        for edge, radius in list(params["edgeFillets"].items())[:192]:
            if not isinstance(edge, str) or len(edge) > 160 or not re.fullmatch(r"[-0-9.,]+\|[-0-9.,]+", edge):
                continue
            try:
                value = float(radius)
                if math.isfinite(value) and value >= 0:
                    fillets[edge] = min(200.0, value)
            except (TypeError, ValueError):
                pass
        out["edgeFillets"] = fillets
    if kind == "text":
        out["text"] = str(params.get("text") or "Testo")[:24]
    source = _clean_source(params.get("source"))
    if source:
        out["source"] = source
    if kind == "revolve":
        revolve = _clean_revolve(params.get("revolve"))
        if revolve:
            out["revolve"] = revolve
    if kind in ("extrusion", "sketch"):
        profile = _clean_profile(params.get("profile")) if kind == "extrusion" else []
        if profile:
            out["profile"] = profile
        sketch = _clean_sketch(params.get("sketch"))
        if sketch:
            out["sketch"] = sketch
    return out


_MAX_PROFILE_POINTS = 40000
_SKETCH_TYPES = {"line", "arc", "circle", "ellipse", "rect", "polygon", "polyline", "point", "bezier", "spline"}


def _num(value: Any, lo: float = -5000.0, hi: float = 5000.0) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return round(max(lo, min(hi, f)), 4)


def _pt(value: Any) -> Optional[list[float]]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    x, y = _num(value[0]), _num(value[1])
    return None if x is None or y is None else [x, y]


def _loop(value: Any, budget: list[int]) -> Optional[list[list[float]]]:
    if not isinstance(value, list) or len(value) < 3 or len(value) > budget[0]:
        return None
    pts = [p for p in (_pt(v) for v in value) if p]
    if len(pts) < 3:
        return None
    budget[0] -= len(pts)
    return pts


def _clean_profile(raw: Any) -> list[dict]:
    """Closed regions of an extrusion: [{"outer": [[x, y], ...], "holes": [[[x, y], ...], ...]}]."""
    if not isinstance(raw, list):
        return []
    budget = [_MAX_PROFILE_POINTS]
    out = []
    for region in raw[:64]:
        if not isinstance(region, dict):
            continue
        outer = _loop(region.get("outer"), budget)
        if not outer:
            continue
        holes = [h for h in (_loop(h, budget) for h in (region.get("holes") or [])[:128] if isinstance(region.get("holes"), list)) if h]
        out.append({"outer": outer, "holes": holes})
    return out


def _clean_source(raw: Any) -> Optional[dict]:
    """Link from an extrusion / revolve to the sketch it was made from (kept so it can follow sketch edits)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("sketchId"), str) or not raw["sketchId"]:
        return None
    op = raw.get("op")
    if op not in ("extrude", "revolve"):
        return None
    points = [p for p in (_pt(v) for v in (raw.get("points") or [])[:64]) if p] if isinstance(raw.get("points"), list) else []
    out: dict = {"sketchId": raw["sketchId"][:64], "points": points, "op": op}
    for key in ("lo", "hi"):
        v = _num(raw.get(key), -5000, 5000)
        if v is not None:
            out[key] = v
    axis = raw.get("axis")
    if isinstance(axis, dict) and _pt(axis.get("a")) and _pt(axis.get("d")):
        out["axis"] = {"a": _pt(axis["a"]), "d": _pt(axis["d"])}
    angle = _num(raw.get("angle"), 1, 360)
    if angle is not None:
        out["angle"] = angle
    if isinstance(raw.get("entityIds"), list):
        out["entityIds"] = [i[:40] for i in raw["entityIds"][:400] if isinstance(i, str) and i]
    return out


def _clean_revolve(raw: Any) -> Optional[dict]:
    """Profile (sketch coordinates), axis and sweep angle of a solid of revolution."""
    if not isinstance(raw, dict):
        return None
    profile = _clean_profile(raw.get("profile"))
    axis = raw.get("axis")
    if not profile or not isinstance(axis, dict) or not _pt(axis.get("a")) or not _pt(axis.get("d")):
        return None
    angle = _num(raw.get("angle"), 1, 360)
    return {"profile": profile, "axis": {"a": _pt(axis["a"]), "d": _pt(axis["d"])}, "angle": angle if angle is not None else 360.0}


def _clean_entity(raw: Any, budget: list[int]) -> Optional[dict]:
    if not isinstance(raw, dict) or raw.get("type") not in _SKETCH_TYPES:
        return None
    kind = raw["type"]
    ent: dict = {"id": str(raw.get("id") or "e")[:40], "type": kind}
    points = {"point": ("p",), "line": ("a", "b"), "rect": ("a", "b"), "arc": ("c",), "circle": ("c",), "ellipse": ("c",), "polygon": ("c",)}
    scalars = {"arc": ("r", "a0", "a1"), "circle": ("r",), "ellipse": ("rx", "ry", "rot"), "polygon": ("r", "rot")}
    for key in points.get(kind, ()):
        p = _pt(raw.get(key))
        if p is None:
            return None
        ent[key] = p
    for key in scalars.get(kind, ()):
        v = _num(raw.get(key), -1e5, 1e5)
        if v is None:
            return None
        ent[key] = v
    if kind == "polygon":
        try:
            ent["n"] = max(3, min(64, int(raw.get("n"))))
        except (TypeError, ValueError):
            return None
    if kind in ("polyline", "spline", "bezier"):
        pts = raw.get("pts")
        if not isinstance(pts, list) or len(pts) < 2 or len(pts) > min(budget[0], 400):
            return None
        clean = [p for p in (_pt(v) for v in pts) if p]
        if len(clean) < 2 or (kind == "bezier" and len(clean) != 4):
            return None
        budget[0] -= len(clean)
        ent["pts"] = clean
        if kind == "polyline":
            ent["closed"] = bool(raw.get("closed"))
    return ent


def _clean_sketch(raw: Any) -> Optional[dict]:
    """Source sketch of an extrusion (kept only so the user can reopen and edit it)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("entities"), list):
        return None
    budget = [_MAX_PROFILE_POINTS]
    entities = [e for e in (_clean_entity(e, budget) for e in raw["entities"][:600]) if e]
    if not entities:
        return None
    z = _num(raw.get("z"))
    out = {
        "entities": entities,
        "z": z if z is not None else 0.0,
        "base": _vec3(raw.get("base"), [1, 1, 1], 0.01, 5000),
    }
    if isinstance(raw.get("target"), str) and raw["target"]:
        out["target"] = raw["target"][:64]
    return out


def sanitize_object(raw: Any, depth: int = 0) -> Optional[dict]:
    if not isinstance(raw, dict) or depth > 6:
        return None
    kind = raw.get("kind")
    obj_id = str(raw.get("id") or "")[:64]
    if not obj_id:
        return None
    base = {
        "id": obj_id,
        "name": str(raw.get("name") or kind or "Oggetto")[:60],
        "kind": kind,
        "color": _color(raw.get("color"), "#0ea5e9"),
        "hole": bool(raw.get("hole")),
        "position": _vec3(raw.get("position"), [0, 0, 0]),
        "rotation": _vec3(raw.get("rotation"), [0, 0, 0], -3600, 3600),
    }
    if kind == "group":
        children = [c for c in (sanitize_object(ch, depth + 1) for ch in (raw.get("children") or [])) if c]
        if not children:
            return None
        base["children"] = children
        base["scale"] = _vec3(raw.get("scale"), [1, 1, 1], 0.01, 100)
        return base
    if kind not in PRIMITIVE_KINDS:
        return None
    base["size"] = _vec3(raw.get("size"), [20, 20, 20], 0.1, 1000)
    base["params"] = _clean_params(kind, raw.get("params"))
    return base


def sanitize_scene(raw_scene: Any) -> list[dict]:
    if not isinstance(raw_scene, list):
        return []
    out = []
    seen: set[str] = set()
    for raw in raw_scene[:MAX_OBJECTS]:
        obj = sanitize_object(raw)
        if obj and obj["id"] not in seen:
            seen.add(obj["id"])
            out.append(obj)
    return out


# ── Scene executor ────────────────────────────────────────────────────────

class SceneExecutor:
    def __init__(self, scene: list[dict]):
        self.scene: list[dict] = copy.deepcopy(scene)
        self._color_i = 0

    def _find(self, obj_id: Any) -> Optional[dict]:
        return next((o for o in self.scene if o["id"] == obj_id), None)

    def _unique_id(self, wanted: Any, fallback: str) -> str:
        base = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(wanted or fallback))[:40] or fallback
        candidate = base
        n = 2
        existing = {o["id"] for o in self.scene}
        while candidate in existing:
            candidate = f"{base}_{n}"
            n += 1
        return candidate

    def _next_color(self) -> str:
        c = PALETTE[self._color_i % len(PALETTE)]
        self._color_i += 1
        return c

    def run(self, actions: list[Any]) -> list[str]:
        errors: list[str] = []
        for i, action in enumerate(actions[:60]):
            if not isinstance(action, dict):
                errors.append(f"azione #{i + 1}: non è un oggetto JSON")
                continue
            op = action.get("op")
            handler = getattr(self, f"_op_{op}", None) if isinstance(op, str) else None
            if not handler:
                errors.append(f"azione #{i + 1}: op sconosciuta '{op}'")
                continue
            try:
                err = handler(action)
                if err:
                    errors.append(f"{op} #{i + 1}: {err}")
            except Exception as exc:  # defensive: bad LLM payloads must not kill the loop
                errors.append(f"{op} #{i + 1}: {exc}")
        return errors

    # ── Sketch based modelling ──────────────────────────────────────────

    def _bbox_of(self, obj_id: Any) -> Optional[tuple[list[float], list[float]]]:
        obj = self._find(obj_id)
        return object_bbox(obj) if obj and obj.get("kind") != "sketch" else None

    def _op_sketch(self, a: dict) -> Optional[str]:
        if len(self.scene) >= MAX_OBJECTS:
            return "troppi oggetti nella scena"
        plane, err = sk.resolve_plane(a.get("plane"), a.get("offset"), self._bbox_of)
        if err:
            return err
        cleaned = _clean_sketch({"entities": a.get("entities") or [], "z": 0, "base": [1, 1, 1]})
        if not cleaned:
            return "entities mancanti o non valide (vedi formato delle entità)"
        ids = [e["id"] for e in cleaned["entities"]]
        if len(set(ids)) != len(ids):
            return "id delle entità duplicati nello sketch"
        obj_id = self._unique_id(a.get("id"), "sketch")
        self.scene.append(sk.sketch_object(obj_id, str(a.get("name") or "Sketch")[:60], plane, cleaned["entities"]))
        return None

    def _op_sketch_edit(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj or obj.get("kind") != "sketch":
            return f"sketch '{a.get('id')}' non trovato"
        current = obj["params"]["sketch"]["entities"]
        remove = set(map(str, a.get("remove") or []))
        merged = [e for e in current if e["id"] not in remove]
        if isinstance(a.get("entities"), list):
            replace = {str(e.get("id")): e for e in a["entities"] if isinstance(e, dict)}
            merged = [replace.pop(e["id"], e) for e in merged] + list(replace.values())
        cleaned = _clean_sketch({"entities": merged, "z": 0, "base": [1, 1, 1]})
        if not cleaned:
            return "lo sketch resterebbe vuoto"
        obj["params"]["sketch"]["entities"] = cleaned["entities"]
        # Features made from this sketch are rebuilt by the browser from the new strokes.
        for o in self.scene:
            src = (o.get("params") or {}).get("source") if o.get("kind") in ("extrusion", "revolve") else None
            if src and src.get("sketchId") == obj["id"]:
                o["params"].pop("profile", None)
                o["params"].pop("revolve", None)
        return None

    def _sketch_for(self, a: dict) -> tuple[Optional[dict], Optional[dict], Optional[str]]:
        sketch = self._find(a.get("sketch"))
        if not sketch or sketch.get("kind") != "sketch":
            return None, None, f"sketch '{a.get('sketch')}' non trovato"
        return sketch, sk.plane_of(sketch, object_matrix), None

    def _op_extrude(self, a: dict) -> Optional[str]:
        sketch, plane, err = self._sketch_for(a)
        if err:
            return err
        hole = a.get("mode") in ("hole", "cut")
        try:
            if "from" in a or "to" in a:
                lo, hi = float(a.get("from", 0)), float(a.get("to", 0))
            else:
                d = float(a.get("distance", 10))
                lo, hi = (-abs(d) / 2, abs(d) / 2) if a.get("symmetric") else ((0.0, d) if d >= 0 else (d, 0.0))
        except (TypeError, ValueError):
            return "distance / from / to devono essere numeri"
        lo, hi = min(lo, hi), max(lo, hi)
        if hi - lo < 0.1:
            return "profondità troppo piccola"
        if hole:  # cuts poke slightly out of the face they start from, so the CSG never meets coplanar faces
            if abs(hi) < 1e-6:
                hi = 0.1
            if abs(lo) < 1e-6:
                lo = -0.1
        points = [p for p in (a.get("points") or []) if isinstance(p, list) and len(p) == 2][:32]
        obj_id = self._unique_id(a.get("id"), "estrusione")
        obj, err = sk.extrusion_object(sketch, plane, lo, hi, obj_id, str(a.get("name") or ("Foro" if hole else "Estrusione"))[:60],
                                       _color(a.get("color"), "#a3a3a3" if hole else self._next_color()), hole, points)
        if err:
            return err
        self.scene.append(obj)
        return None

    def _op_revolve(self, a: dict) -> Optional[str]:
        sketch, plane, err = self._sketch_for(a)
        if err:
            return err
        ents = sketch["params"]["sketch"]["entities"]
        spec = a.get("axis", "y")
        axis_id = None
        if spec in ("x", "y"):
            axis = {"a": [0.0, 0.0], "d": [1.0, 0.0] if spec == "x" else [0.0, 1.0]}
        elif isinstance(spec, str):
            line = next((e for e in ents if e["id"] == spec), None)
            if not line or line["type"] != "line":
                return f"asse '{spec}': serve l'id di una linea dello sketch, oppure 'x' / 'y'"
            axis = {"a": line["a"], "d": [line["b"][0] - line["a"][0], line["b"][1] - line["a"][1]]}
            axis_id = spec
        elif isinstance(spec, dict) and isinstance(spec.get("a"), list) and isinstance(spec.get("d"), list):
            axis = {"a": [float(v) for v in spec["a"][:2]], "d": [float(v) for v in spec["d"][:2]]}
        else:
            return "axis non valido"
        wanted = a.get("entities")
        entity_ids = [str(i) for i in wanted] if isinstance(wanted, list) and wanted else [
            e["id"] for e in ents if e["type"] != "point" and e["id"] != axis_id
        ]
        try:
            angle = max(1.0, min(360.0, float(a.get("angle", 360))))
        except (TypeError, ValueError):
            angle = 360.0
        hole = a.get("mode") in ("hole", "cut")
        obj_id = self._unique_id(a.get("id"), "rivoluzione")
        obj, err = sk.revolve_object(sketch, plane, entity_ids, axis, angle, obj_id,
                                     str(a.get("name") or ("Foro" if hole else "Rivoluzione"))[:60],
                                     _color(a.get("color"), "#a3a3a3" if hole else self._next_color()), hole)
        if err:
            return err
        self.scene.append(obj)
        return None

    def _op_add(self, a: dict) -> Optional[str]:
        if len(self.scene) >= MAX_OBJECTS:
            return "troppi oggetti nella scena"
        kind = a.get("kind")
        if kind not in PRIMITIVE_KINDS:
            return f"kind non valido '{kind}'"
        obj_id = self._unique_id(a.get("id"), kind)
        obj = sanitize_object({
            **a,
            "id": obj_id,
            "color": _color(a.get("color"), self._next_color()),
            "name": a.get("name") or kind,
        })
        if not obj:
            return "oggetto non valido"
        self.scene.append(obj)
        return None

    def _op_update(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj:
            return f"id '{a.get('id')}' non trovato"
        if "position" in a:
            obj["position"] = _vec3(a["position"], obj["position"])
        if "rotation" in a:
            obj["rotation"] = _vec3(a["rotation"], obj["rotation"], -3600, 3600)
        if "size" in a:
            if obj["kind"] == "group":
                cur_min, cur_max = object_bbox(obj)
                cur = [max(cur_max[i] - cur_min[i], 0.01) for i in range(3)]
                wanted = _vec3(a["size"], cur, 0.1, 1000)
                obj["scale"] = [obj["scale"][i] * wanted[i] / cur[i] for i in range(3)]
            else:
                obj["size"] = _vec3(a["size"], obj["size"], 0.1, 1000)
        if "scale" in a and obj["kind"] == "group":
            obj["scale"] = _vec3(a["scale"], obj["scale"], 0.01, 100)
        if "color" in a:
            obj["color"] = _color(a["color"], obj["color"])
        if "hole" in a:
            obj["hole"] = bool(a["hole"])
        if "name" in a:
            obj["name"] = str(a["name"])[:60]
        if "params" in a and obj["kind"] != "group":
            obj["params"] = {**obj.get("params", {}), **_clean_params(obj["kind"], a["params"])}
        return None

    def _op_move(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj:
            return f"id '{a.get('id')}' non trovato"
        d = _vec3(a.get("by"), [0, 0, 0])
        obj["position"] = [obj["position"][i] + d[i] for i in range(3)]
        return None

    def _op_drop(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj:
            return f"id '{a.get('id')}' non trovato"
        mn, _ = object_bbox(obj)
        obj["position"][2] -= mn[2]
        return None

    def _op_delete(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj:
            return f"id '{a.get('id')}' non trovato"
        self.scene.remove(obj)
        return None

    def _clone(self, obj: dict, new_id: Any) -> dict:
        clone = copy.deepcopy(obj)
        clone["id"] = self._unique_id(new_id, obj["id"])
        _reid_children(clone)
        return clone

    def _op_duplicate(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj:
            return f"id '{a.get('id')}' non trovato"
        clone = self._clone(obj, a.get("new_id") or f"{obj['id']}_copia")
        d = _vec3(a.get("offset"), [0, 0, 0])
        clone["position"] = [clone["position"][i] + d[i] for i in range(3)]
        self.scene.append(clone)
        return None

    def _op_mirror(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj:
            return f"id '{a.get('id')}' non trovato"
        axis = a.get("axis", "x")
        if axis not in ("x", "y"):
            return "axis deve essere 'x' o 'y'"
        about = float(a.get("about") or 0)
        clone = self._clone(obj, a.get("new_id") or f"{obj['id']}_spec")
        i = 0 if axis == "x" else 1
        clone["position"][i] = 2 * about - clone["position"][i]
        rx, ry, rz = clone["rotation"]
        # Reflection P·R·P of an XYZ Euler rotation (P = diag(-1,1,1) or diag(1,-1,1)).
        clone["rotation"] = [rx, -ry, -rz] if axis == "x" else [-rx, ry, -rz]
        if clone["kind"] == "group":
            _mirror_children(clone["children"], i)
        self.scene.append(clone)
        return None

    def _op_pattern_linear(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj:
            return f"id '{a.get('id')}' non trovato"
        count = max(2, min(40, int(a.get("count") or 2)))
        step = _vec3(a.get("step"), [20, 0, 0])
        prefix = a.get("id_prefix") or obj["id"]
        for k in range(1, count):
            clone = self._clone(obj, f"{prefix}_{k + 1}")
            clone["position"] = [obj["position"][i] + step[i] * k for i in range(3)]
            self.scene.append(clone)
        return None

    def _op_pattern_circular(self, a: dict) -> Optional[str]:
        obj = self._find(a.get("id"))
        if not obj:
            return f"id '{a.get('id')}' non trovato"
        count = max(2, min(60, int(a.get("count") or 6)))
        center = a.get("center") if isinstance(a.get("center"), (list, tuple)) and len(a.get("center")) >= 2 else [0, 0]
        cx, cy = float(center[0]), float(center[1])
        rotate = a.get("rotate", True) is not False
        prefix = a.get("id_prefix") or obj["id"]
        px, py = obj["position"][0] - cx, obj["position"][1] - cy
        for k in range(1, count):
            ang = 2 * math.pi * k / count
            ca, sa = math.cos(ang), math.sin(ang)
            clone = self._clone(obj, f"{prefix}_{k + 1}")
            clone["position"] = [cx + px * ca - py * sa, cy + px * sa + py * ca, obj["position"][2]]
            if rotate:
                clone["rotation"] = [clone["rotation"][0], clone["rotation"][1], clone["rotation"][2] + math.degrees(ang)]
            self.scene.append(clone)
        return None

    def _op_group(self, a: dict) -> Optional[str]:
        ids = a.get("ids")
        if not isinstance(ids, list) or len(ids) < 2:
            return "servono almeno 2 ids"
        members = [self._find(i) for i in ids]
        missing = [ids[k] for k, m in enumerate(members) if m is None]
        if missing:
            return f"id non trovati: {missing}"
        group = build_group(members, self._unique_id(a.get("id"), "gruppo"), a.get("name"), a.get("color"))
        insert_at = min(self.scene.index(m) for m in members)
        for m in members:
            self.scene.remove(m)
        self.scene.insert(min(insert_at, len(self.scene)), group)
        return None


def _reid_children(obj: dict) -> None:
    for child in obj.get("children") or []:
        child["id"] = f"{obj['id']}.{child['id'].split('.')[-1]}"
        _reid_children(child)


def _mirror_children(children: list[dict], axis_index: int) -> None:
    for child in children:
        child["position"][axis_index] = -child["position"][axis_index]
        rx, ry, rz = child["rotation"]
        child["rotation"] = [rx, -ry, -rz] if axis_index == 0 else [-rx, ry, -rz]
        if child.get("kind") == "group":
            _mirror_children(child["children"], axis_index)


def build_group(members: list[dict], group_id: str, name: Any = None, color: Any = None) -> dict:
    """Same algorithm as the frontend `groupObjects`: translate-only group frame at the solids' bbox centre."""
    boxes = [object_bbox(m) for m in members if not m.get("hole")] or [object_bbox(m) for m in members]
    mn = [min(b[0][i] for b in boxes) for i in range(3)]
    mx = [max(b[1][i] for b in boxes) for i in range(3)]
    center = [(mn[i] + mx[i]) / 2 for i in range(3)]
    children = []
    for m in members:
        child = copy.deepcopy(m)
        child["position"] = [child["position"][i] - center[i] for i in range(3)]
        children.append(child)
    first_solid = next((m for m in members if not m.get("hole")), None)
    return {
        "id": group_id,
        "name": str(name or (first_solid or members[0]).get("name") or "Gruppo")[:60],
        "kind": "group",
        "color": _color(color, (first_solid or members[0]).get("color", "#0ea5e9")),
        "hole": first_solid is None,
        "position": center,
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1],
        "children": children,
    }


# ── Observation ───────────────────────────────────────────────────────────

def _is_sketch(obj: dict) -> bool:
    return obj.get("kind") == "sketch"


def describe_scene(scene: list[dict]) -> list[dict]:
    rows = []
    for obj in scene:
        if _is_sketch(obj):
            rows.append(sk.describe_sketch(obj))
            continue
        mn, mx = object_bbox(obj)
        row: dict = {
            "id": obj["id"],
            "name": obj["name"],
            "kind": obj["kind"],
            "hole": obj["hole"],
            "position": [_r(v) for v in obj["position"]],
            "bbox_min": [_r(v) for v in mn],
            "bbox_max": [_r(v) for v in mx],
        }
        if obj["kind"] == "group":
            row["children"] = [f"{c['id']}({'foro' if c.get('hole') else c['kind']})" for c in obj["children"]]
            if any(abs(s - 1) > 1e-3 for s in obj["scale"]):
                row["scale"] = [round(s, 3) for s in obj["scale"]]
        else:
            row["size"] = [_r(v) for v in obj["size"]]
            params = obj.get("params") or {}
            if obj["kind"] in ("extrusion", "revolve"):
                src = params.get("source") or {}
                row["from_sketch"] = {k: src[k] for k in ("sketchId", "op", "lo", "hi", "angle", "entityIds") if k in src}
            elif params:
                row["params"] = params
        if any(abs(v) > 1e-6 for v in obj["rotation"]):
            row["rotation"] = [_r(v) for v in obj["rotation"]]
        rows.append(row)
    return rows


def scene_warnings(scene: list[dict], final: bool = False) -> list[str]:
    warnings: list[str] = []
    scene = [o for o in scene if not _is_sketch(o)]
    boxes = {o["id"]: object_bbox(o) for o in scene}
    solids = [o for o in scene if not o["hole"]]
    holes = [o for o in scene if o["hole"]]
    for obj in scene:
        mn, mx = boxes[obj["id"]]
        if mn[2] < -0.5 and not obj["hole"]:
            warnings.append(f"'{obj['id']}' scende sotto il piatto (z_min={_r(mn[2])}).")
        dims = [mx[i] - mn[i] for i in range(3)]
        if max(dims) > PLATE_SIZE * 1.25:
            warnings.append(f"'{obj['id']}' è molto grande ({', '.join(str(_r(d)) for d in dims)} mm) rispetto al piatto 200x200.")
        if obj["kind"] != "group" and min(obj["size"]) < 0.8 and not obj["hole"]:
            warnings.append(f"'{obj['id']}' ha uno spessore < 0.8 mm: poco stampabile.")
    for obj in solids:
        mn, _ = boxes[obj["id"]]
        if mn[2] > 0.5:
            supported = any(
                other["id"] != obj["id"] and _boxes_touch(boxes[obj["id"]], boxes[other["id"]])
                for other in solids
            )
            if not supported:
                warnings.append(f"'{obj['id']}' è sospeso (z_min={_r(mn[2])}) e non tocca nessun altro solido.")
    for hole in holes:
        if not any(_boxes_overlap(boxes[hole["id"]], boxes[s["id"]]) for s in solids):
            warnings.append(f"il foro '{hole['id']}' non interseca nessun solido: non scaverà nulla.")
        elif final:
            warnings.append(f"il foro '{hole['id']}' non è raggruppato: raggruppalo con i solidi da scavare, altrimenti non taglia.")
    return warnings


def build_observation(scene: list[dict], errors: list[str], warnings: list[str], step: int, max_steps: int) -> str:
    parts = [f"OSSERVAZIONE dopo il passo {step}/{max_steps}."]
    if errors:
        parts.append("ERRORI nelle azioni:\n- " + "\n- ".join(errors))
    parts.append("SCENA (bbox in mm):\n" + json.dumps(describe_scene(scene), ensure_ascii=False))
    parts.append("AVVISI:\n- " + "\n- ".join(warnings) if warnings else "AVVISI: nessuno.")
    remaining = max_steps - step
    if remaining <= 1:
        parts.append("ULTIMO PASSO: completa i gruppi necessari e rispondi con done=true.")
    else:
        parts.append(f"Passi rimasti: {remaining}. Correggi i problemi, poi raggruppa e chiudi con done=true.")
    parts.append("Rispondi solo con il JSON.")
    return "\n\n".join(parts)


def initial_user_message(prompt: str, scene: list[dict], selection: list[str]) -> str:
    parts = [f"RICHIESTA DEL DOCENTE: {prompt.strip()}"]
    if scene:
        parts.append("SCENA ATTUALE:\n" + json.dumps(describe_scene(scene), ensure_ascii=False))
        if selection:
            parts.append(f"Oggetti selezionati dal docente (probabile soggetto della richiesta): {selection}")
    else:
        parts.append("SCENA ATTUALE: vuota.")
    parts.append("Rispondi solo con il JSON.")
    return "\n\n".join(parts)


def parse_step(content: str) -> AgentStepResult:
    data = extract_json(content)
    actions = data.get("actions") if isinstance(data.get("actions"), list) else []
    return AgentStepResult(
        thought=str(data.get("thought") or "")[:1200],
        actions=actions,
        errors=[],
        warnings=[],
        done=bool(data.get("done")),
        message=str(data.get("message") or "")[:1200],
    )


def summarize_actions(actions: list[dict]) -> list[str]:
    out = []
    for a in actions[:60]:
        if not isinstance(a, dict):
            continue
        op = a.get("op")
        if op == "add":
            out.append(f"+ {a.get('kind')} {a.get('name') or a.get('id')}{' (foro)' if a.get('hole') else ''}")
        elif op == "group":
            out.append(f"⊕ gruppo {a.get('id')} ← {', '.join(map(str, a.get('ids') or []))}")
        elif op in ("pattern_linear", "pattern_circular"):
            out.append(f"⋯ {op.replace('_', ' ')} {a.get('id')} ×{a.get('count')}")
        elif op == "sketch":
            out.append(f"✎ sketch {a.get('id')} ({len(a.get('entities') or [])} tratti)")
        elif op == "extrude":
            out.append(f"⇡ estrudi {a.get('sketch')} → {a.get('id')}{' (foro)' if a.get('mode') in ('hole', 'cut') else ''}")
        elif op == "revolve":
            out.append(f"⟳ ruota {a.get('sketch')} → {a.get('id')}{' (foro)' if a.get('mode') in ('hole', 'cut') else ''}")
        else:
            out.append(f"{op} {a.get('id') or ''}".strip())
    return out
