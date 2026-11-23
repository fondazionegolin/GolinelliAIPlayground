"""Validation of the figure specs the smart-canvas assistant writes (`figure` op).

The model supplies DATA; the browser computes and draws (see frontend canvasFigures.ts). Strict typed models give the model
precise errors to correct itself, and keep out anything that could reach the network or run code (Vega-Lite `url`/`href`,
JSXGraph types outside a whitelist)."""
from __future__ import annotations

import json
import re
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, field_validator, model_validator

COLOR = r"^#[0-9a-fA-F]{6}$"
Title = Annotated[str | None, Field(default=None, max_length=120)]
Label = Annotated[str, Field(min_length=1, max_length=60)]
Num = Annotated[float, Field(ge=-1e12, le=1e12, allow_inf_nan=False)]


class _S(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    guided: bool = Field(default=False, description="Modalità guidata: disegna il supporto visivo ma NON mostra i risultati (frazione risultato, probabilità, tabella compilata, statistiche...)")


class Slice(_S):
    label: Label
    value: Annotated[float, Field(ge=0, le=1e12, allow_inf_nan=False)]
    color: str | None = Field(default=None, pattern=COLOR)


class Pie(_S):
    fig: Literal["pie"]
    title: Title = None
    slices: list[Slice] = Field(min_length=1, max_length=12)
    donut: bool = False
    show: Literal["percent", "value", "both", "none"] = "percent"


class Series(_S):
    name: Label
    values: list[Num] = Field(min_length=1, max_length=60)
    color: str | None = Field(default=None, pattern=COLOR)


class Bar(_S):
    fig: Literal["bar"]
    title: Title = None
    categories: list[Label] = Field(min_length=1, max_length=30)
    series: list[Series] = Field(min_length=1, max_length=6)
    orientation: Literal["vertical", "horizontal"] = "vertical"
    stacked: bool = False
    x_label: str | None = Field(default=None, max_length=60)
    y_label: str | None = Field(default=None, max_length=60)

    @model_validator(mode="after")
    def lengths(self):
        for s in self.series:
            if len(s.values) != len(self.categories):
                raise ValueError(f"bar: la serie «{s.name}» ha {len(s.values)} valori ma ci sono {len(self.categories)} categorie")
        return self


class Line(_S):
    fig: Literal["line"]
    title: Title = None
    x: list[Num | Annotated[str, Field(max_length=30)]] = Field(min_length=2, max_length=60)
    series: list[Series] = Field(min_length=1, max_length=6)
    x_label: str | None = Field(default=None, max_length=60)
    y_label: str | None = Field(default=None, max_length=60)
    markers: bool = True

    @model_validator(mode="after")
    def lengths(self):
        for s in self.series:
            if len(s.values) != len(self.x):
                raise ValueError(f"line: la serie «{s.name}» ha {len(s.values)} valori ma x ne ha {len(self.x)}")
        return self


class Histogram(_S):
    fig: Literal["histogram"]
    title: Title = None
    values: list[Num] = Field(min_length=2, max_length=500)
    bins: int | None = Field(default=None, ge=2, le=40)
    x_label: str | None = Field(default=None, max_length=60)


class Scatter(_S):
    fig: Literal["scatter"]
    title: Title = None
    points: list[Annotated[list[Num], Field(min_length=2, max_length=2)]] = Field(min_length=2, max_length=300)
    regression: bool = False
    x_label: str | None = Field(default=None, max_length=60)
    y_label: str | None = Field(default=None, max_length=60)


class Group(_S):
    name: Label
    values: list[Num] = Field(min_length=3, max_length=500)


class Boxplot(_S):
    fig: Literal["boxplot"]
    title: Title = None
    groups: list[Group] = Field(min_length=1, max_length=8)
    y_label: str | None = Field(default=None, max_length=60)


class Normal(_S):
    fig: Literal["normal"]
    title: Title = None
    mean: Num
    sd: Annotated[float, Field(gt=0, le=1e9, allow_inf_nan=False)]
    from_: Num | None = Field(default=None, alias="from")
    to: Num | None = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Fraction(_S):
    fig: Literal["fraction"]
    title: Title = None
    op: Literal["show", "compare", "add", "sub", "multiply", "divide"]
    model: Literal["pie", "bar"] = "pie"
    fractions: list[Annotated[list[int], Field(min_length=2, max_length=2)]] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def check(self):
        for n, d in self.fractions:
            if d <= 0 or d > 60 or abs(n) > 600:
                raise ValueError("fraction: denominatore tra 1 e 60 e numeratore al massimo 600 (frazioni come [numeratore, denominatore])")
            if n < 0:
                raise ValueError("fraction: i modelli grafici usano frazioni positive")
        if self.op in ("add", "sub", "multiply", "divide") and len(self.fractions) != 2:
            raise ValueError(f"fraction: l'operazione {self.op} richiede esattamente 2 frazioni")
        if self.op == "divide" and self.fractions[1][0] == 0:
            raise ValueError("fraction: non si divide per zero")
        if self.op == "compare" and len(self.fractions) < 2:
            raise ValueError("fraction: compare richiede almeno 2 frazioni")
        return self


class VennSet(_S):
    label: Label


class VennRegion(_S):
    sets: str = Field(pattern=r"^[ABC]{1,3}$", description="Quali insiemi: 'A', 'AB', 'ABC'... (A = primo insieme)")
    text: str = Field(max_length=120)


class Venn(_S):
    fig: Literal["venn"]
    title: Title = None
    sets: list[VennSet] = Field(min_length=2, max_length=3)
    regions: list[VennRegion] = Field(default_factory=list, max_length=8)
    outside: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def check(self):
        allowed = "ABC"[: len(self.sets)]
        for r in self.regions:
            if any(c not in allowed for c in r.sets):
                raise ValueError(f"venn: la regione «{r.sets}» usa un insieme che non esiste (insiemi: {', '.join(allowed)})")
        return self


class NlPoint(_S):
    value: Num
    label: str | None = Field(default=None, max_length=20)
    open: bool = False


class NlInterval(_S):
    from_: Num = Field(alias="from")
    to: Num
    from_open: bool = False
    to_open: bool = False
    label: str | None = Field(default=None, max_length=30)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Numberline(_S):
    fig: Literal["numberline"]
    title: Title = None
    min: Num
    max: Num
    step: Annotated[float, Field(gt=0)] | None = None
    denominator: int | None = Field(default=None, ge=1, le=24, description="Segna le tacche come frazioni con questo denominatore")
    points: list[NlPoint] = Field(default_factory=list, max_length=12)
    intervals: list[NlInterval] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def check(self):
        if self.min >= self.max:
            raise ValueError("numberline: min deve essere minore di max")
        if (self.max - self.min) / (self.step or ((self.max - self.min) / 10)) > 200:
            raise ValueError("numberline: troppe tacche, aumenta lo step")
        return self


# ─── boolean expressions (same grammar as the browser) ───────────────────────

_TOKEN = [
    (re.compile(r"<->|<=>|↔|⇔"), "iff"), (re.compile(r"->|=>|→|⇒"), "imp"), (re.compile(r"&&|&|∧|\bAND\b|\bE\b", re.I), "and"),
    (re.compile(r"\|\||\||∨|\bOR\b|\bO\b", re.I), "or"), (re.compile(r"\^|⊕|\bXOR\b", re.I), "xor"), (re.compile(r"¬|!|~|\bNOT\b|\bNON\b", re.I), "not"),
    (re.compile(r"\("), "("), (re.compile(r"\)"), ")"),
]
_ID = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|[01]\b")


def bool_vars(expr: str) -> set[str] | None:
    """Variables used by a boolean expression, or None when it does not parse."""
    toks: list[str] = []
    s, i = expr, 0
    while i < len(s):
        if s[i].isspace():
            i += 1
            continue
        for rx, name in _TOKEN:
            m = rx.match(s, i)
            if m and m.end() > i:
                toks.append(name)
                i = m.end()
                break
        else:
            m = _ID.match(s, i)
            if not m:
                return None
            toks.append("v:" + m.group(0))
            i = m.end()
    pos = 0
    used: set[str] = set()

    def peek():
        return toks[pos] if pos < len(toks) else None

    def level(names, nxt, right=False):
        nonlocal pos
        if not nxt():
            return False
        while peek() in names:
            pos += 1
            if not (level(names, nxt, True) if right else nxt()):
                return False
            if right:
                break
        return True

    def atom():
        nonlocal pos
        t = peek()
        if t is None:
            return False
        pos += 1
        if t == "not":
            return atom()
        if t == "(":
            if not iff() or peek() != ")":
                return False
            pos += 1
            return True
        if t.startswith("v:"):
            name = t[2:]
            if name not in ("0", "1") and name.lower() not in ("true", "false", "vero", "falso"):
                used.add(name)
            return True
        return False

    def and_():
        return level(("and",), atom)

    def xor_():
        return level(("xor",), and_)

    def or_():
        return level(("or",), xor_)

    def imp():
        return level(("imp",), or_, True)

    def iff():
        return level(("iff",), imp, True)

    ok = bool(toks) and iff() and pos == len(toks)
    return used if ok else None


class TruthTable(_S):
    fig: Literal["truth_table"]
    title: Title = None
    variables: list[str] = Field(min_length=1, max_length=4)
    expressions: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(min_length=1, max_length=4)
    symbols: Literal["VF", "10"] = "VF"

    @field_validator("variables")
    @classmethod
    def names(cls, v):
        for n in v:
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,7}", n):
                raise ValueError(f"truth_table: nome di variabile non valido «{n}»")
        if len(set(v)) != len(v):
            raise ValueError("truth_table: variabili duplicate")
        return v

    @model_validator(mode="after")
    def parse(self):
        for e in self.expressions:
            used = bool_vars(e)
            if used is None:
                raise ValueError(f"truth_table: l'espressione «{e}» non si legge (usa AND, OR, NOT, XOR, ->, <-> e parentesi)")
            missing = used - set(self.variables)
            if missing:
                raise ValueError(f"truth_table: «{e}» usa variabili non dichiarate: {', '.join(sorted(missing))}")
        return self


class TreeNode(_S):
    label: Label
    p: float | Annotated[str, Field(max_length=12)] | None = None
    children: list["TreeNode"] = Field(default_factory=list, max_length=6)


def _tree_size(n: TreeNode, depth: int = 0) -> tuple[int, int]:
    count, deepest = 1, depth
    for c in n.children:
        k, d = _tree_size(c, depth + 1)
        count += k
        deepest = max(deepest, d)
    return count, deepest


class Tree(_S):
    fig: Literal["tree"]
    title: Title = None
    root: TreeNode

    @model_validator(mode="after")
    def check(self):
        count, depth = _tree_size(self.root)
        if count > 40 or depth > 4:
            raise ValueError("tree: al massimo 40 nodi e 4 livelli")
        return self


# ─── fill-in tables: cells the learner completes, checked against hidden keys ─────────────────────

import hashlib
import secrets
from fractions import Fraction as Frac


def norm_answer(raw: str) -> str:
    """Canonical form of an answer (identical to normAnswer in the browser): numbers and fractions become one reduced
    fraction (0,5 = 1/2 = 2/4), anything else is lower-cased text with single spaces."""
    s = raw.strip().lower().replace("−", "-").replace("–", "-")
    compact = re.sub(r"\s+", "", s).replace(",", ".").lstrip("+")
    m = re.fullmatch(r"(-?\d+)/(\d+)", compact)
    if m and int(m.group(2)) > 0:
        f = Frac(int(m.group(1)), int(m.group(2)))
        return str(f.numerator) if f.denominator == 1 else f"{f.numerator}/{f.denominator}"
    if re.fullmatch(r"-?\d+(\.\d+)?", compact):
        f = Frac(compact)
        return str(f.numerator) if f.denominator == 1 else f"{f.numerator}/{f.denominator}"
    return re.sub(r"[.]+$", "", " ".join(s.split()))


def answer_hash(salt: str, raw: str) -> str:
    return hashlib.sha256(f"{salt}:{norm_answer(raw)}".encode()).hexdigest()


class FillCell(_S):
    v: str | None = Field(default=None, max_length=60, description="Valore GIÀ dato (visibile)")
    a: str | None = Field(default=None, max_length=80, description="Risposta attesa di una cella DA COMPILARE (alternative equivalenti separate da |); non viene mai mostrata")
    hint: str | None = Field(default=None, max_length=140, description="Indizio mostrato solo se la cella è sbagliata (una domanda, mai la risposta)")

    @model_validator(mode="after")
    def one(self):
        if self.v is not None and self.a is not None:
            raise ValueError("fillin: una cella ha 'v' (valore dato) oppure 'a' (da compilare), non entrambi")
        return self


class FillRow(_S):
    label: str = Field(default="", max_length=40)
    cells: list[FillCell] = Field(min_length=1, max_length=8)


class FillIn(_S):
    fig: Literal["fillin"]
    title: Title = None
    instruction: str | None = Field(default=None, max_length=200, description="Consegna breve sopra la tabella (non la regola, non la soluzione)")
    corner: str | None = Field(default=None, max_length=30, description="Intestazione della colonna delle etichette di riga")
    columns: list[Annotated[str, Field(max_length=30)]] = Field(min_length=1, max_length=8)
    rows: list[FillRow] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def check(self):
        blanks = 0
        for r in self.rows:
            if len(r.cells) != len(self.columns):
                raise ValueError(f"fillin: la riga «{r.label}» ha {len(r.cells)} celle ma ci sono {len(self.columns)} colonne")
            blanks += sum(1 for c in r.cells if c.a is not None)
        if blanks == 0:
            raise ValueError("fillin: serve almeno una cella DA COMPILARE (campo 'a'): lo studente scrive la risposta, tu non la mostri")
        return self


def harden_spec(raw: str) -> str:
    """Fill-in keys leave the server only as salted hashes: the board, the conversation and the network never carry them."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if not isinstance(data, dict) or data.get("fig") != "fillin" or "salt" in data:
        return raw
    salt = secrets.token_hex(6)
    data["salt"] = salt
    for row in data.get("rows", []):
        for cell in row.get("cells", []):
            key = cell.pop("a", None)
            if key is not None:
                cell["h"] = [answer_hash(salt, alt) for alt in str(key).split("|") if alt.strip()]
    return json.dumps(data, ensure_ascii=False)


# ─── declarative engines ─────────────────────────────────────────────────────

VEGA_BANNED = {"url", "href", "loader"}


def _scan_banned(v: Any, banned: set[str], depth: int = 0) -> str | None:
    if depth > 30:
        return "struttura troppo profonda"
    if isinstance(v, dict):
        for k, x in v.items():
            if k in banned:
                return k
            r = _scan_banned(x, banned, depth + 1)
            if r:
                return r
    elif isinstance(v, list):
        for x in v:
            r = _scan_banned(x, banned, depth + 1)
            if r:
                return r
    return None


class Vega(_S):
    fig: Literal["vega"]
    title: Title = None
    def_: dict[str, Any] = Field(alias="def", description="Specifica Vega-Lite v5 con dati INLINE (data.values)")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def safe(self):
        d = self.def_
        if not any(k in d for k in ("mark", "layer", "hconcat", "vconcat", "concat", "facet", "repeat")):
            raise ValueError("vega: la specifica deve avere 'mark' (o layer/hconcat/vconcat/facet)")
        bad = _scan_banned(d, VEGA_BANNED)
        if bad:
            raise ValueError(f"vega: «{bad}» non è consentito: i dati vanno scritti inline in data.values, niente link")
        if len(json.dumps(d)) > 60_000:
            raise ValueError("vega: specifica troppo grande (max ~60 KB): riduci i dati")
        return self


JSX_TYPES = {"point", "glider", "line", "segment", "ray", "circle", "polygon", "regularpolygon", "angle", "arc", "sector", "functiongraph", "curve", "slider", "text",
             "intersection", "perpendicular", "parallel", "midpoint", "tangent", "normal", "vector", "ellipse", "parabola", "hyperbola", "conic", "reflection", "bisector",
             "integral", "riemannsum", "inequality", "arrow", "circumcircle", "incircle"}
_JSX_STR = re.compile(r"^[A-Za-z0-9_+\-*/^().,<>=!@$%\[\]|:?'\" °²³½¼¾πα-ωΑ-Ω√≤≥≠àèéìòùÀÈÉÌÒÙ]{0,200}$")
_JSX_ID = re.compile(r"^[a-z][a-z0-9_]{0,15}$")


def _jsx_arg(a: Any, ids: set[str], depth: int = 0) -> None:
    if depth > 3:
        raise ValueError("jsxgraph: args troppo annidati")
    if isinstance(a, bool) or a is None:
        raise ValueError("jsxgraph: gli args sono numeri, stringhe o liste")
    if isinstance(a, (int, float)):
        return
    if isinstance(a, str):
        if not _JSX_STR.match(a):
            raise ValueError(f"jsxgraph: stringa non consentita «{a[:40]}»")
        if a.startswith("@") and a[1:] not in ids:
            raise ValueError(f"jsxgraph: il riferimento «{a}» non esiste (deve essere un id definito PRIMA)")
        return
    if isinstance(a, list):
        for x in a:
            _jsx_arg(x, ids, depth + 1)
        return
    raise ValueError("jsxgraph: gli args sono numeri, stringhe o liste")


class JsxElement(_S):
    id: str | None = None
    type: str
    args: list[Any] = Field(default_factory=list, max_length=12)
    attrs: dict[str, str | float | int | bool] = Field(default_factory=dict)

    @field_validator("type")
    @classmethod
    def known(cls, v):
        if v not in JSX_TYPES:
            raise ValueError(f"jsxgraph: tipo «{v}» non disponibile (usa: {', '.join(sorted(JSX_TYPES))})")
        return v

    @field_validator("id")
    @classmethod
    def ident(cls, v):
        if v is not None and not _JSX_ID.match(v):
            raise ValueError("jsxgraph: id come 'a', 'p1', 'f' (minuscole, cifre, _)")
        return v


class JsxDef(_S):
    boundingbox: list[Num] | None = Field(default=None, min_length=4, max_length=4, description="[xmin, ymax, xmax, ymin]")
    axis: bool = True
    grid: bool = True
    elements: list[JsxElement] = Field(min_length=1, max_length=60)

    @model_validator(mode="after")
    def check(self):
        if self.boundingbox and not (self.boundingbox[0] < self.boundingbox[2] and self.boundingbox[3] < self.boundingbox[1]):
            raise ValueError("jsxgraph: boundingbox = [xmin, ymax, xmax, ymin] con xmin<xmax e ymin<ymax")
        ids: set[str] = set()
        for el in self.elements:
            for a in el.args:
                _jsx_arg(a, ids)
            if el.id:
                if el.id in ids:
                    raise ValueError(f"jsxgraph: id duplicato «{el.id}»")
                ids.add(el.id)
        return self


class JsxGraph(_S):
    fig: Literal["jsxgraph"]
    title: Title = None
    def_: JsxDef = Field(alias="def")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


Figure = Annotated[Union[Pie, Bar, Line, Histogram, Scatter, Boxplot, Normal, Fraction, Venn, Numberline, TruthTable, Tree, Vega, JsxGraph, FillIn], Field(discriminator="fig")]
_adapter = TypeAdapter(Figure)

FIG_NAMES = ["pie", "bar", "line", "histogram", "scatter", "boxplot", "normal", "fraction", "venn", "numberline", "truth_table", "tree", "vega", "jsxgraph", "fillin"]


def validate_spec(raw: str) -> None:
    """Raises ValueError with a message the model can act on."""
    if len(raw) > 70_000:
        raise ValueError("figure: spec troppo grande")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"figure: 'spec' non è JSON valido ({exc.msg})") from exc
    if not isinstance(data, dict) or data.get("fig") not in FIG_NAMES:
        raise ValueError(f"figure: lo spec deve essere un oggetto con \"fig\" tra: {', '.join(FIG_NAMES)}")
    try:
        _adapter.validate_python(data)
    except ValidationError as exc:
        lines = []
        for err in exc.errors()[:5]:
            where = ".".join(str(x) for x in err["loc"][1:])  # [0] is the discriminator tag
            msg = str(err["msg"]).removeprefix("Value error, ")
            lines.append(f"{where}: {msg}" if where and not msg.startswith(data["fig"]) else msg)
        raise ValueError(f"figure «{data['fig']}»: " + " | ".join(lines)) from exc
