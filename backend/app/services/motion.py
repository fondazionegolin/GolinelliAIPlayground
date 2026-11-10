"""Motion graphics: the model writes a declarative animation scene (data, never code); this module validates it
by actually evaluating every expression over time, and feeds problems back to the model until the scene is sound.

The browser engine (frontend `components/motion/spec.ts`) draws exactly this format.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from pathlib import Path
from typing import Awaitable, Callable, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.services import visual_math
from app.services.llm_service import LLMResponse, llm_service
from app.services.model_roles import pair_for
from app.services.visual_comprehension import _thinking_off, parse_json

logger = logging.getLogger(__name__)
EXAMPLES = Path(__file__).parent / "motion_examples"

TYPES = ("circle", "rect", "ellipse", "line", "arrow", "path", "text", "atom", "bond", "body", "orbit", "wave", "helix", "particles", "spring")
NUMERIC = ("x", "y", "rotate", "scale", "opacity", "strokeWidth", "light", "r", "w", "h", "rx", "x2", "y2", "draw", "size", "progress", "phase", "amp", "speed", "spread")
COLORS = ("fill", "stroke")
BACKGROUNDS = ("space", "lab", "cell", "paper", "dark")
HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


class Keys(BaseModel):
    model_config = ConfigDict(extra="ignore")
    keys: list[list[Union[float, str]]] = Field(min_length=1, max_length=40)
    ease: Literal["linear", "in", "out", "inout"] | None = None


Val = Union[float, str, Keys]


class Entity(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,32}$")
    type: Literal[TYPES]  # type: ignore[valid-type]
    parent: str | None = None
    x: Val | None = None
    y: Val | None = None
    rotate: Val | None = None
    scale: Val | None = None
    opacity: Val | None = None
    fill: Val | None = None
    stroke: Val | None = None
    strokeWidth: Val | None = None
    dash: bool | None = None
    glow: bool | None = None
    shade: bool | None = None
    light: Val | None = None
    r: Val | None = None
    w: Val | None = None
    h: Val | None = None
    rx: Val | None = None
    x2: Val | None = None
    y2: Val | None = None
    d: str | None = Field(default=None, max_length=1500)
    draw: Val | None = None
    text: str | None = Field(default=None, max_length=160)
    size: Val | None = None
    anchor: Literal["start", "middle", "end"] | None = None
    bold: bool | None = None
    el: str | None = Field(default=None, max_length=3)
    a: str | None = None
    b: str | None = None
    order: int | None = Field(default=None, ge=1, le=3)
    progress: Val | None = None
    kind: str | None = Field(default=None, max_length=16)
    phase: Val | None = None
    count: int | None = Field(default=None, ge=1, le=200)
    amp: Val | None = None
    wavelength: float | None = Field(default=None, gt=2, le=2000)
    speed: Val | None = None
    turns: float | None = Field(default=None, gt=0, le=12)
    seed: int | None = Field(default=None, ge=0, le=100000)
    mode: Literal["brownian", "rise", "flow"] | None = None
    fill2: str | None = None
    ratio: float | None = Field(default=None, ge=0, le=1)
    spread: Val | None = None
    coils: int | None = Field(default=None, ge=2, le=30)


class Step(BaseModel):
    model_config = ConfigDict(extra="ignore")
    at: float = Field(ge=0, le=120)
    text: str = Field(min_length=1, max_length=170)


class Scene(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(min_length=1, max_length=90)
    width: int = Field(default=800, ge=400, le=1600)
    height: int = Field(default=450, ge=225, le=900)
    duration: float = Field(ge=3, le=60)
    loop: bool = True
    background: str = Field(default="dark", max_length=20)
    entities: list[Entity] = Field(min_length=2, max_length=140)
    steps: list[Step] = Field(default_factory=list, max_length=14)


# ─── Evaluation twin of the browser engine ─────────────────────────────────────

def _scalar(v, env: dict) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    return float(visual_math.evaluate(visual_math.parse(v), env))


def num(v, env: dict, fallback: float) -> float:
    if v is None:
        return fallback
    if isinstance(v, Keys):
        keys = sorted(v.keys, key=lambda k: k[0])
        t = env["t"]
        if t <= keys[0][0]:
            return _scalar(keys[0][1], env)
        if t >= keys[-1][0]:
            return _scalar(keys[-1][1], env)
        for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
            if t0 <= t <= t1:
                u = (t - t0) / max(t1 - t0, 1e-9)
                a, b = _scalar(v0, env), _scalar(v1, env)
                return a + (b - a) * u
    return _scalar(v, env)


def frames(scene: Scene, env: dict) -> dict[str, tuple[float, float, float, float, float]]:
    by_id = {e.id: e for e in scene.entities}
    out: dict = {}

    def resolve(i: str, depth=0):
        if i in out:
            return out[i]
        e = by_id[i]
        x, y, rot = num(e.x, env, 0), num(e.y, env, 0), num(e.rotate, env, 0)
        sc, op = num(e.scale, env, 1), max(0.0, min(1.0, num(e.opacity, env, 1)))
        if e.parent in by_id and depth < 12:
            px, py, pr, ps, po = resolve(e.parent, depth + 1)
            c, s = math.cos(math.radians(pr)), math.sin(math.radians(pr))
            out[i] = (px + ps * (x * c - y * s), py + ps * (x * s + y * c), pr + rot, ps * sc, po * op)
        else:
            out[i] = (x, y, rot, sc, op)
        return out[i]

    for e in scene.entities:
        resolve(e.id)
    return out


def lint(scene: Scene) -> list[str]:
    """Everything that would draw nothing, crash a value or fly off stage, found by evaluating the scene over time."""
    problems: list[str] = []
    ids = [e.id for e in scene.entities]
    if len(ids) != len(set(ids)):
        dup = sorted({i for i in ids if ids.count(i) > 1})
        problems.append(f"id duplicati: {', '.join(dup)}")
    by_id = {e.id: e for e in scene.entities}
    if scene.background not in BACKGROUNDS and not HEX.match(scene.background):
        problems.append(f"background «{scene.background}» non valido: usa {', '.join(BACKGROUNDS)} oppure un colore #rrggbb")
    for e in scene.entities:
        if e.parent and (e.parent not in by_id or e.parent == e.id):
            problems.append(f"{e.id}: parent «{e.parent}» non esiste")
        if e.type == "bond" and not (e.a in by_id and e.b in by_id):
            problems.append(f"{e.id}: il legame richiede a e b che siano id di entità esistenti")
        if e.type == "text" and not e.text:
            problems.append(f"{e.id}: il testo è vuoto")
        if e.type == "path" and not e.d:
            problems.append(f"{e.id}: il path richiede d")
        if e.type == "atom" and not e.el:
            problems.append(f"{e.id}: l'atomo richiede el (simbolo, es. H, O, C)")
        for name in COLORS:
            v = getattr(e, name)
            if isinstance(v, str) and not (HEX.match(v) or v == "none"):
                problems.append(f"{e.id}.{name}: «{v}» non è un colore #rrggbb")
            if isinstance(v, Keys) and any(not (isinstance(k[1], str) and HEX.match(k[1])) for k in v.keys):
                problems.append(f"{e.id}.{name}: i keyframe di colore devono essere #rrggbb")
    if sum(e.count or 40 for e in scene.entities if e.type == "particles") > 400:
        problems.append("troppe particelle: massimo 400 in totale")
    if problems:
        return problems[:8]

    D = scene.duration
    samples = [D * i / 16 for i in range(17)]
    visible_at: dict[str, bool] = {e.id: False for e in scene.entities}
    on_stage: dict[str, bool] = {e.id: False for e in scene.entities}
    for t in samples:
        env = {"t": t, "D": D, "p": t / D}
        for e in scene.entities:
            for name in NUMERIC:
                v = getattr(e, name)
                if v is None:
                    continue
                try:
                    val = num(v, env, 0.0)
                    if not math.isfinite(val):
                        raise ValueError("non finito")
                except Exception as exc:  # noqa: BLE001 - any math failure is a scene problem
                    problems.append(f"{e.id}.{name} non calcolabile a t={t:.1f}s: {exc}")
        if problems:
            return list(dict.fromkeys(problems))[:8]
        fr = frames(scene, env)
        for e in scene.entities:
            x, y, _, _, op = fr[e.id]
            if e.type == "bond":
                continue
            if op > 0.05:
                visible_at[e.id] = True
                if -60 <= x <= scene.width + 60 and -60 <= y <= scene.height + 60:
                    on_stage[e.id] = True
    for e in scene.entities:
        if e.type == "bond":
            continue
        if not visible_at[e.id]:
            problems.append(f"{e.id}: non è mai visibile (opacity sempre ~0)")
        elif not on_stage[e.id]:
            problems.append(f"{e.id}: è sempre fuori dalla scena ({scene.width}×{scene.height}): controlla x e y")
    for s in scene.steps:
        if s.at > D:
            problems.append(f"didascalia a {s.at}s oltre la durata {D}s")
    if not scene.steps:
        problems.append("servono didascalie (steps) che raccontino cosa succede, almeno 3")
    return list(dict.fromkeys(problems))[:8]


# ─── Generation ────────────────────────────────────────────────────────────────

def _example(name: str) -> str:
    return json.dumps(json.loads((EXAMPLES / f"{name}.json").read_text()), ensure_ascii=False, separators=(",", ":"))


SYSTEM = """Sei un regista di animazioni scientifiche per la scuola (chimica, biochimica, fisica, astronomia, biologia)
e di ANIMAZIONI CONCETTUALI che spiegano le idee emerse da un brainstorming o un'attività di design thinking.
Produci UNA scena JSON che un motore deterministico disegna in SVG. Solo dati, mai codice. Rispondi SOLO con il JSON della scena.

FORMATO
{"title","width":800,"height":450,"duration":secondi (6-30),"loop":true,"background":"space|lab|cell|paper|dark|#rrggbb",
 "entities":[...], "steps":[{"at":secondi,"text":"didascalia"}]}
Coordinate: stage 800×450, origine in alto a sinistra, y verso il basso. Tieni il contenuto entro y<380: in basso c'è la didascalia.

VALORI (ogni proprietà numerica, tranne dove indicato)
- numero fisso; oppure ESPRESSIONE di t (secondi, ripetuto sul ciclo), D (durata) e p (=t/D, 0..1): "400+120*cos(2*pi*p)", "250*sin(0.6*cos(2*pi*t/4))".
  Operatori + - * / ^ e funzioni sin cos tan sqrt abs exp ln log; costante pi. Una sola lettera per variabile; usa sempre * esplicito.
- KEYFRAME {"keys":[[t,valore],...],"ease":"inout|in|out|linear"}: interpola tra i tempi, tiene il primo/ultimo valore fuori intervallo. Per i colori i valori sono #rrggbb.
Fisica esatta con le espressioni (orbite, oscillatori, proiettili, onde); transizioni narrative (avvicinamenti, comparsa) con i keyframe.

ENTITÀ (id univoco [a-z0-9_-], type, x,y = centro; rotate gradi; scale; opacity 0..1; parent = id di un'altra entità: x,y diventano relativi a lei, così muovi una molecola intera)
- circle {r, fill, stroke, strokeWidth, shade:true per effetto sfera, glow}; rect {w,h,rx}; ellipse {w,h}; text {text,size,fill,anchor,bold}
- line / arrow {x,y inizio; x2,y2 = vettore verso la fine, animabile (frecce di forza e velocità)}; spring {x2,y2,coils}
- path {d: path SVG in coordinate locali attorno a (0,0), fill, stroke, draw 0..1 per disegnarlo progressivamente}
- atom {el:"H|C|N|O|S|P|Cl|Na|Fe...", colore e raggio CPK automatici, etichetta inclusa}; bond {a,b = id di due entità, order 1-3, progress 0..1 (cresce da a verso b), opacity per romperlo/formarlo}. I legami si disegnano SOTTO.
- body {kind:sun|earth|moon|mars|venus|mercury|jupiter|saturn|star|generic, r, light = direzione luce in gradi (0 destra, 90 giù, 180 sinistra, 270 su), phase 0..1 (0 nuova, 0.5 piena)}
- orbit {w,h} ellisse tratteggiata guida; wave {w,amp,wavelength,speed} onda che viaggia; helix {w,h,turns,speed,stroke,fill2} doppia elica DNA che ruota
- particles {w,h area, count, r, fill, fill2, ratio, mode brownian|rise|flow, speed, spread 0..1 (frazione di larghezza occupata: animala per mostrare la diffusione), seed}

REGIA
1. Racconta UN fenomeno con un arco: situazione iniziale → processo → risultato. Le didascalie (steps, 3-7, ≤120 caratteri, italiano chiaro e corretto) accompagnano ogni fase; il loro 'at' coincide con ciò che si vede.
2. Rigore scientifico: geometrie, proporzioni, versi e numeri giusti (angoli di legame, stechiometria, direzione della luce, periodo del moto, conservazione). Mai inventare.
3. Etichette brevi sugli oggetti importanti (text), niente affollamento: massimo ~35 entità, ritmo calmo (le fasi durano 2-4 s).
4. Colori leggibili sullo sfondo: 'dark'/'space' con testi chiari (default automatico), 'lab'/'paper'/'cell' con testi scuri. Codice colore coerente (stesso elemento = stesso colore).
5. Ciclo che si ripete bene: a fine durata la scena può tornare all'inizio (fai svanire/riapparire con opacity).
6. Per cambiare una scena esistente restituisci la scena COMPLETA modificata.
7. ANIMAZIONE CONCETTUALE (il piano parla di idee, temi, post-it, sintesi): niente fenomeni fisici inventati. Usa text, rect (rx alto),
   circle come insiemi tematici, arrow per relazioni. Arco: le idee dei partecipanti compaiono (testi esatti del piano, brevi) → si spostano
   nel loro tema con keyframe → i temi si collegano → frase di sintesi finale. Sfondo 'paper', un colore per tema, al massimo ~8 idee visibili.

ESEMPIO 1 (fisica, espressioni):
""" + _example("pendulum") + """

ESEMPIO 2 (biochimica, keyframe):
""" + _example("enzyme") + """

ESEMPIO 3 (animazione concettuale di un brainstorming, keyframe):
""" + _example("concepts")


async def generate_scene(brief: str, request: str, width: int, height: int, previous: dict | None,
                         on_usage: Callable[[LLMResponse, str], Awaitable[None]]) -> Scene:
    provider, model = pair_for("vision.motion")
    options = {"output_config": {"effort": "low" if model.startswith(("claude-opus-5-5", "claude-fable-5")) else "medium"}, **_thinking_off(model)}
    ask = (f"RICHIESTA DELL'UTENTE: {request}\n\nPIANO DELL'ANIMAZIONE: {brief}\n\n"
           f"Dimensioni dello stage: {width}×{height}. Durata a tua scelta (6-30 s).")
    if previous:
        ask += "\n\nSCENA ATTUALE DA MODIFICARE (restituiscila completa, cambiando solo ciò che serve):\n" + json.dumps(previous, ensure_ascii=False, separators=(",", ":"))
    messages = [{"role": "user", "content": ask}]
    last_error = ""
    for attempt in range(3):
        async with asyncio.timeout(110):
            response = await llm_service.generate(messages=messages, system_prompt=SYSTEM, provider=provider, model=model, max_tokens=14000,
                                                  temperature=0.4, allow_web_search=False, anthropic_options=options)
        await on_usage(response, "motion")
        try:
            scene = Scene.model_validate(parse_json(response.content))
            problems = lint(scene)
            if not problems:
                return scene
            last_error = "; ".join(problems)
        except (ValidationError, ValueError, TypeError) as exc:
            last_error = str(exc)[:1500]
        logger.warning("motion attempt %d invalid: %s", attempt + 1, last_error[:400])
        if response.content.strip():
            messages = [*messages[:1], {"role": "assistant", "content": response.content},
                        {"role": "user", "content": f"La scena non è valida: {last_error}\nCorreggi e restituisci la scena JSON completa."}]
    raise ValueError("Non sono riuscito a costruire una scena valida. Riprova con una descrizione più precisa.")
