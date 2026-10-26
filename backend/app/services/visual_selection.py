"""A part of the image marked by the student (rectangle, lasso, scribble or brush) and what the model sees of it."""
import base64
import io
from typing import Literal

from PIL import Image, ImageDraw
from pydantic import Field, model_validator

from app.services.visual_comprehension import Box, DataModel, Grounding, Region

MARK = (255, 43, 214)    # magenta: never a colour of the tutor's own drawing
MAX_SELECTION_REGIONS = 6


class Selection(DataModel):
    shape: Literal["rect", "lasso", "scribble", "brush"]
    box: Box = Field(description="Riquadro della marcatura in percentuali dell'immagine")
    points: list[tuple[float, float]] = Field(default_factory=list, max_length=600, description="Tracciato in percentuali (lazo, scarabocchio, pennello)")
    brush: float = Field(default=0, ge=0, le=20, description="Spessore del pennello in % della larghezza")

    @model_validator(mode="after")
    def drawn(self):
        if self.shape != "rect" and len(self.points) < 2:
            raise ValueError("Una marcatura a mano libera richiede un tracciato")
        if any(not (0 <= x <= 100 and 0 <= y <= 100) for x, y in self.points):
            raise ValueError("Il tracciato deve stare dentro l'immagine")
        return self


def _open(image: str) -> Image.Image:
    with Image.open(io.BytesIO(base64.b64decode(image.split(",", 1)[1]))) as img:
        return img.convert("RGB")


def _encode(img: Image.Image) -> str:
    out = io.BytesIO()
    img.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def marked_views(image: str, selection: Selection) -> tuple[str, str]:
    """(whole image with the marking drawn on it, enlarged crop of the marked area)."""
    img = _open(image)
    w, h = img.size
    px = [(x / 100 * w, y / 100 * h) for x, y in selection.points]
    b = selection.box
    x0, y0, x1, y1 = b.x / 100 * w, b.y / 100 * h, (b.x + b.width) / 100 * w, (b.y + b.height) / 100 * h
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    stroke = max(3, round(max(w, h) * .004))
    if selection.shape == "rect":
        draw.rectangle((x0, y0, x1, y1), fill=MARK + (40,), outline=MARK + (255,), width=stroke)
    elif selection.shape == "lasso":
        draw.polygon(px, fill=MARK + (40,), outline=MARK + (255,))
        draw.line(px + px[:1], fill=MARK + (255,), width=stroke, joint="curve")
    else:
        width = max(stroke, round(selection.brush / 100 * w)) if selection.shape == "brush" else stroke
        draw.line(px, fill=MARK + (110 if selection.shape == "brush" else 255,), width=width, joint="curve")
    marked = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    pad = max(32, .35 * max(x1 - x0, y1 - y0))
    crop = img.crop((max(0, int(x0 - pad)), max(0, int(y0 - pad)), min(w, int(x1 + pad)), min(h, int(y1 + pad))))
    side = max(crop.size)
    if side < 768:  # small marks are enlarged so the model reads them as well as the student sees them
        k = 768 / side
        crop = crop.resize((round(crop.width * k), round(crop.height * k)), Image.Resampling.LANCZOS)
    return _encode(marked), _encode(crop)


def with_selection_region(grounding: Grounding, selection: Selection, region_id: str) -> Grounding:
    """Adds the marked area as a region the drawing can anchor to; only the most recent markings are kept."""
    kept = [r for r in grounding.regions if not r.id.startswith("selezione-")]
    previous = [r for r in grounding.regions if r.id.startswith("selezione-")][-(MAX_SELECTION_REGIONS - 1):]
    region = Region(id=region_id, label="Zona indicata dallo studente", text="", box=selection.box, confidence="high")
    return grounding.model_copy(update={"regions": [*kept[:48 - MAX_SELECTION_REGIONS], *previous, region]})
