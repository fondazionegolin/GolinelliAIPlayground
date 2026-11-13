"""Small deterministic slide assets: functional line icons and a subtle paper grain.

Embedded PNGs work in the editor, Office and Google without external font/icon dependencies.
Icons are drawn from geometric primitives, never emoji or decorative AI illustrations.
"""
import base64
import io
import random
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFilter

ICON_NAMES = ("book", "leaf", "flask", "lightbulb", "people", "target", "clock", "chart", "globe", "shield", "search", "code")
_KEYWORDS = {
    "leaf": ("natura", "piant", "ambient", "clima", "ecolog", "energia", "sostenib", "fotosint"),
    "flask": ("scienz", "chimic", "esperiment", "laborator", "acqua", "ricerca"),
    "book": ("lettur", "libr", "stori", "impar", "formaz", "studio", "educaz"),
    "people": ("person", "grupp", "collabor", "societ", "comunit", "squadra"),
    "target": ("obiettiv", "scopo", "risultat", "strateg"),
    "clock": ("tempo", "durata", "fasi", "scadenz", "pianific"),
    "chart": ("dati", "crescit", "misur", "analisi", "statist", "econom"),
    "globe": ("mondo", "global", "terra", "geograf", "paes"),
    "shield": ("sicurezz", "protez", "diritt", "privacy", "etica"),
    "search": ("osserv", "esplor", "indag", "verific", "domand"),
    "code": ("codic", "program", "digital", "tecnolog", "algorit"),
    "lightbulb": ("idea", "creativ", "innov", "soluz", "luce"),
}


def icon_for(text: str, requested: str = "") -> str:
    if requested in ICON_NAMES:
        return requested
    lowered = text.lower()
    return next((key for key, words in _KEYWORDS.items() if any(word in lowered for word in words)), "lightbulb")


def _data_uri(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


@lru_cache(maxsize=256)
def icon_image(name: str, color: str) -> str:
    image = Image.new("RGBA", (192, 192))
    d = ImageDraw.Draw(image)
    # Coordinates use a 48-unit grid, rendered at 4x for clean edges.
    def line(points, width=2):
        d.line([(round(x * 4), round(y * 4)) for x, y in points], fill=color, width=round(width * 4), joint="curve")
    def oval(box):
        d.ellipse(tuple(round(v * 4) for v in box), outline=color, width=8)
    def rect(box):
        d.rounded_rectangle(tuple(round(v * 4) for v in box), radius=8, outline=color, width=8)
    if name == "book":
        line([(24, 12), (15, 9), (5, 11), (5, 37), (15, 35), (24, 38), (33, 35), (43, 37), (43, 11), (33, 9), (24, 12), (24, 38)])
        line([(10, 17), (18, 18)]); line([(30, 18), (38, 17)])
    elif name == "leaf":
        d.arc((24, 16, 176, 164), 0, 270, fill=color, width=8)
        line([(44, 5), (42, 29), (30, 40), (15, 39), (8, 31), (10, 19), (22, 10), (44, 5)])
        line([(6, 43), (33, 17)]); line([(17, 33), (17, 22)]); line([(24, 26), (35, 26)])
    elif name == "flask":
        line([(16, 5), (32, 5)]); line([(19, 5), (19, 19), (8, 38), (10, 43), (38, 43), (40, 38), (29, 19), (29, 5)])
        line([(14, 29), (34, 29)]); oval((22, 33, 25, 36))
    elif name == "people":
        oval((17, 5, 31, 19)); oval((3, 13, 13, 23)); oval((35, 13, 45, 23))
        d.arc((48, 96, 144, 200), 180, 360, fill=color, width=8)
        line([(12, 38), (12, 43), (36, 43), (36, 38)])
        d.arc((0, 108, 64, 180), 180, 300, fill=color, width=8)
        d.arc((128, 108, 192, 180), 240, 360, fill=color, width=8)
    elif name == "target":
        oval((5, 5, 43, 43)); oval((13, 13, 35, 35)); oval((21, 21, 27, 27))
        line([(24, 24), (42, 6)]); line([(33, 6), (42, 6), (42, 15)])
    elif name == "clock":
        oval((5, 5, 43, 43)); line([(24, 12), (24, 25), (33, 30)])
    elif name == "chart":
        line([(6, 6), (6, 42), (44, 42)]); line([(14, 36), (14, 26)]); line([(24, 36), (24, 20)]); line([(34, 36), (34, 10)])
        line([(12, 21), (23, 14), (32, 16), (42, 5)])
    elif name == "globe":
        oval((4, 4, 44, 44)); oval((15, 4, 33, 44)); line([(4, 24), (44, 24)]); line([(8, 12), (40, 12)]); line([(8, 36), (40, 36)])
    elif name == "shield":
        line([(24, 4), (42, 11), (40, 29), (34, 38), (24, 44), (14, 38), (8, 29), (6, 11), (24, 4)])
        line([(15, 24), (21, 30), (33, 17)])
    elif name == "search":
        oval((5, 5, 33, 33)); line([(29, 29), (43, 43)], 3)
    elif name == "code":
        line([(16, 12), (5, 24), (16, 36)]); line([(32, 12), (43, 24), (32, 36)]); line([(28, 7), (20, 41)])
    else:
        oval((11, 4, 37, 30)); line([(16, 28), (18, 35), (30, 35), (32, 28)])
        line([(18, 40), (30, 40)]); line([(21, 44), (27, 44)])
    return _data_uri(image.resize((96, 96), Image.Resampling.LANCZOS))


@lru_cache(maxsize=1)
def paper_image() -> str:
    rng = random.Random(1729)
    image = Image.new("RGB", (480, 270))
    image.putdata([(max(0, min(255, 247 + n)), max(0, min(255, 241 + n)), max(0, min(255, 229 + n)))
                   for n in (rng.choice((-3, -2, -1, 0, 0, 1, 2, 3)) for _ in range(480 * 270))])
    return _data_uri(image.filter(ImageFilter.GaussianBlur(0.25)))
