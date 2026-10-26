"""Synthetic golden set for the visual tutor: small, reproducible images with a known right answer."""
import base64
import io
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_DIRS = [Path(__file__).resolve().parents[2] / "fonts", Path("/usr/share/fonts/truetype/dejavu")]


def font(size):
    for directory in FONT_DIRS:
        for candidate in sorted(directory.glob("*.ttf")) if directory.exists() else []:
            if "Bold" not in candidate.name and "Italic" not in candidate.name:
                return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size)


def canvas(w=1000, h=700):
    image = Image.new("RGB", (w, h), "white")
    return image, ImageDraw.Draw(image)


def addition():
    image, d = canvas(800, 600)
    d.text((40, 30), "Esegui l'addizione in colonna", fill="black", font=font(34))
    for i, (digits, y) in enumerate([("4 7 8", 160), ("+ 2 6 5", 260)]):
        d.text((260, y), digits, fill="black", font=font(90))
    d.line((240, 380, 620, 380), fill="black", width=6)
    return image


def triangle():
    image, d = canvas()
    d.text((40, 30), "Calcola l'area del triangolo ABC.", fill="black", font=font(32))
    d.polygon([(150, 560), (850, 560), (420, 130)], outline="#333", width=5)
    d.text((110, 570), "A", fill="black", font=font(34)); d.text((860, 570), "B", fill="black", font=font(34))
    d.text((405, 85), "C", fill="black", font=font(34)); d.text((430, 585), "AB = 7 cm,  altezza = 5 cm", fill="black", font=font(30))
    return image


def parabola():
    image, d = canvas(900, 700)
    d.text((40, 20), "Disegna il grafico di f(x) = x^2 - 4", fill="black", font=font(32))
    d.line((100, 400, 820, 400), fill="black", width=3); d.line((460, 90, 460, 650), fill="black", width=3)
    d.text((830, 380), "x", fill="black", font=font(28)); d.text((470, 90), "y", fill="black", font=font(28))
    for k in range(-4, 5):
        x = 460 + k * 80
        d.line((x, 392, x, 408), fill="black", width=2)
    return image


def tab():
    image, d = canvas(1000, 420)
    d.text((40, 20), "Riff in Mi minore - 4/4", fill="black", font=font(32))
    for i in range(6):
        y = 120 + i * 40
        d.line((60, y, 940, y), fill="black", width=2)
        d.text((20, y - 14), "EBGDAE"[i], fill="black", font=font(26))
    notes = [(120, 5, "0"), (220, 4, "2"), (320, 3, "2"), (440, 5, "0"), (560, 4, "2"), (680, 3, "2"), (800, 2, "0")]
    for x, string, fret in notes:
        y = 120 + (6 - string) * 40
        d.rectangle((x - 14, y - 16, x + 14, y + 16), fill="white")
        d.text((x - 8, y - 16), fret, fill="black", font=font(28))
    return image


def schrodinger():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig = plt.figure(figsize=(10, 4), dpi=100)
    fig.text(.5, .5, r"$i\hbar\,\frac{\partial}{\partial t}\Psi = \hat{H}\Psi$", fontsize=64, ha="center", va="center")
    out = io.BytesIO()
    fig.savefig(out, format="png", facecolor="white")
    plt.close(fig)
    return Image.open(io.BytesIO(out.getvalue())).convert("RGB")


def app_ui():
    image, d = canvas(1200, 760)
    d.rectangle((0, 0, 1200, 64), fill="#1f2a3d")
    d.text((24, 20), "Quaderno", fill="white", font=font(26))
    for x, label in [(760, "Nuovo"), (880, "Salva"), (1000, "Condividi")]:
        d.rounded_rectangle((x, 14, x + 104, 50), 8, fill="#3e63dd")
        d.text((x + 14, 22), label, fill="white", font=font(18))
    d.rounded_rectangle((220, 16, 600, 48), 16, fill="#ffffff")
    d.text((240, 22), "Cerca appunti...", fill="#8a94a6", font=font(18))
    d.rectangle((0, 64, 220, 760), fill="#eef1f6")
    for i, label in enumerate(["Tutti gli appunti", "Preferiti", "Condivisi con me", "Cestino"]):
        d.text((24, 96 + i * 44), label, fill="#1f2a3d", font=font(20))
    d.rounded_rectangle((12, 88, 208, 124), 6, outline="#3e63dd", width=2)
    for i, (title, date) in enumerate([("Fotosintesi", "12 ott"), ("Equazioni di 2o grado", "10 ott"), ("La Divina Commedia", "8 ott")]):
        y = 100 + i * 150
        d.rounded_rectangle((260, y, 1160, y + 120), 10, fill="#ffffff", outline="#d5dae3", width=2)
        d.text((290, y + 22), title, fill="#1f2a3d", font=font(26))
        d.text((290, y + 70), "Modificato il " + date, fill="#6b7385", font=font(18))
        d.ellipse((1100, y + 44, 1132, y + 76), outline="#9aa1ad", width=3)
    return image


def sines():
    import math
    image, d = canvas(900, 520)
    d.line((20, 260, 880, 260), fill="black", width=2)
    for k, label in [(1, "π / 2"), (2, "π"), (3, "3π / 2")]:
        x = 20 + k * 215
        d.line((x, 252, x, 268), fill="black", width=2)
        d.text((x - 22, 278), label, fill="#333", font=font(20))
    d.line([(x, 260 - 140 * math.sin((x - 20) / 215 * math.pi / 2 * 4 / 2 * 2)) for x in range(20, 880)], fill=(90, 95, 235), width=3)
    d.line([(x, 260 - 140 * math.sin((x - 20) / 215 * math.pi / 2)) for x in range(20, 880)], fill=(235, 70, 90), width=3)
    return image


def identities():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig = plt.figure(figsize=(7, 8), dpi=100)
    fig.text(.5, .94, "Basic Algebra Formulas", fontsize=24, ha="center", color="#a0522d")
    for i, f in enumerate([r"$a^2-b^2=(a+b)(a-b)$", r"$a^2+b^2=(a+b)^2-2ab$", r"$(a+b)^2=a^2+2ab+b^2$",
                           r"$(a-b)^2=a^2-2ab+b^2$", r"$a^3+b^3=(a+b)(a^2-ab+b^2)$"]):
        fig.text(.5, .8 - i * .16, f, fontsize=26, ha="center")
    out = io.BytesIO()
    fig.savefig(out, format="png", facecolor="white")
    plt.close(fig)
    return Image.open(io.BytesIO(out.getvalue())).convert("RGB")


CASES = {
    "addition": (addition, "Spiegami come si fa questa addizione, un passo alla volta."),
    "triangle": (triangle, "Come calcolo l'area? Fammi vedere l'altezza sul disegno."),
    "parabola": (parabola, "Aiutami a disegnare questa funzione, partendo dai punti notevoli."),
    "tab": (tab, "Spiegami la prima battuta di questa tablatura."),
    "ui": (app_ui, "Spiegami come si usa questa interfaccia."),
    "ui_selection": (app_ui, "A cosa serve questo?", {"shape": "lasso", "box": {"x": 82.5, "y": 1.0, "width": 10.5, "height": 7.0},
                     "points": [[82.5, 1.0], [93.0, 1.0], [93.0, 8.0], [82.5, 8.0]]}),
    "sines": (sines, "Indicami qual è la curva blu e disegnami accanto il grafico di y = A·sin(kx + φ) con i parametri che posso cambiare, per capire cosa fanno."),
    "identities": (identities, "Dammi una dimostrazione visiva di (a+b)^2 = a^2 + 2ab + b^2"),
    "schrodinger": (schrodinger, "Spiegami il significato di questa equazione, termine per termine, anche con un disegno di cosa descrive."),
}


def data_url(image) -> str:
    out = io.BytesIO(); image.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()
