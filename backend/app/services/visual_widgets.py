"""Interactive objects the tutor puts on the board: an explorable graph or an exercise the student solves by writing.

They are written by the tutor in the same answer as its message (so "here is the graph" always comes with the graph),
checked here with the safe math language, and kept in the session so they stay on the canvas independently of the
step-by-step tour.
"""
import re
import uuid
from typing import Literal

from pydantic import Field, model_validator

from app.services.visual_comprehension import DataModel
from app.services import visual_math

PARAM = r"^[a-zA-Z]{1,6}$"
BLANK = re.compile(r"\[([a-zA-Z][a-zA-Z0-9]{0,7})\]")
MAX_WIDGETS = 4


class Window(DataModel):
    x_min: float = Field(default=-8, ge=-1e4, le=1e4)
    x_max: float = Field(default=8, ge=-1e4, le=1e4)
    y_min: float = Field(default=-6, ge=-1e4, le=1e4)
    y_max: float = Field(default=6, ge=-1e4, le=1e4)

    @model_validator(mode="after")
    def positive(self):
        if self.x_min >= self.x_max or self.y_min >= self.y_max:
            raise ValueError("La finestra del grafico deve avere ampiezza positiva")
        return self

    def bounds(self):
        return (self.x_min, self.x_max, self.y_min, self.y_max)


class Param(DataModel):
    name: str = Field(pattern=PARAM, description="Nome nell'espressione: lettere (A, k, a, b, phi…)")
    label: str = Field(min_length=1, max_length=12, description="Come mostrarlo (A, k, φ)")
    min: float = Field(ge=-1e4, le=1e4)
    max: float = Field(ge=-1e4, le=1e4)
    step: float = Field(gt=0, le=1e4)
    value: float = Field(ge=-1e4, le=1e4)

    @model_validator(mode="after")
    def in_range(self):
        if self.min >= self.max or not self.min <= self.value <= self.max or (self.max - self.min) / self.step > 2000:
            raise ValueError(f"Parametro {self.name}: min < valore < max, al massimo 2000 scatti")
        return self


class Explorer(DataModel):
    kind: Literal["explorer"] = Field(json_schema_extra={"type": "string"})  # single-value literals need an explicit type for structured outputs
    title: str = Field(min_length=1, max_length=80)
    equation: str = Field(min_length=1, max_length=160, description="Nel linguaggio della lavagna: 'y = A*sin(k*x + phi)', "
                          "'x^2/a^2 - y^2/b^2 = 1'. Operatori + - * / ^, funzioni sin cos tan sqrt abs ln log exp, pi")
    formula: str = Field(default="", max_length=120, description="Come mostrarla allo studente, es. 'y = A·sin(kx + φ)'")
    params: list[Param] = Field(min_length=1, max_length=4)
    window: Window = Field(default_factory=Window)
    note: str = Field(default="", max_length=300, description="Cosa osservare muovendo i cursori (1 frase)")

    @model_validator(mode="after")
    def checked(self):
        f = visual_math.parse_equation(self.equation)
        names = {p.name for p in self.params}
        unknown = visual_math.variables(f) - names - {"x", "y"}
        if unknown:
            raise ValueError(f"L'equazione usa {sorted(unknown)}: ogni lettera diversa da x e y deve essere un parametro")
        if not visual_math.drawable(f, {p.name: p.value for p in self.params}, self.window.bounds()):
            raise ValueError("Con i valori iniziali la curva non attraversa la finestra: allarga window o cambia i valori")
        return self


class Exercise(DataModel):
    kind: Literal["exercise"] = Field(json_schema_extra={"type": "string"})
    title: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=300, description="La consegna, es. 'Scrivi l'equazione di questa iperbole'")
    target: str = Field(min_length=1, max_length=160, description="Equazione della curva da trovare (nascosta allo studente), solo x e y")
    template: str = Field(default="", max_length=160, description="Facoltativo: equazione con caselle da riempire, es. 'y^2/[a] - x^2/[b] = 1'. "
                          "Vuoto = lo studente scrive l'equazione intera")
    show_target: bool = Field(default=True, description="Disegna la curva da trovare (tratteggiata) come riferimento")
    hints: list[str] = Field(default_factory=list, max_length=3, description="Suggerimenti progressivi, senza la soluzione")
    explanation: str = Field(default="", max_length=600, description="Spiegazione da mostrare quando lo studente risolve o chiede la soluzione")
    window: Window = Field(default_factory=Window)

    @model_validator(mode="after")
    def checked(self):
        f = visual_math.parse_equation(self.target)
        if visual_math.variables(f) - {"x", "y"}:
            raise ValueError("La curva da trovare usa solo x e y (numeri espliciti)")
        if not visual_math.drawable(f, {}, self.window.bounds()):
            raise ValueError("La curva da trovare non attraversa la finestra: allarga window")
        if self.template:
            blanks = BLANK.findall(self.template)
            if not blanks or len(blanks) != len(set(blanks)) or len(blanks) > 4:
                raise ValueError("Il template ha 1–4 caselle [nome] con nomi diversi")
            visual_math.parse_equation(BLANK.sub("1", self.template))
        return self


Widget = Explorer | Exercise  # `kind` tells them apart; a plain union keeps the schema usable for structured outputs


def with_ids(widgets: list) -> list[dict]:
    return [{**w.model_dump(), "id": uuid.uuid4().hex[:10]} for w in widgets]


def keep_latest(previous: list[dict], new: list[dict]) -> list[dict]:
    """The board keeps the most recent interactive objects (newest last), independent of the drawings' steps."""
    return [*previous, *new][-MAX_WIDGETS:]
