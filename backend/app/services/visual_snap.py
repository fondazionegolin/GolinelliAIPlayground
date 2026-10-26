"""Snap the model's estimated boxes to the real pixels of the element they describe.

Vision models place boxes a few percent off. For regions that hold readable content (a button, a label, a digit)
we look around the estimate, separate ink from the local background, and keep the connected components that sit
inside the estimate; components that run out of the search window (axes, panel borders) are not part of it.
Pure numpy/scipy, deterministic, no extra model call.
"""
import base64
import io

import numpy as np
from PIL import Image
from scipy import ndimage

from app.services.visual_comprehension import Box, Grounding, Region

INK_THRESHOLD = 38       # colour distance from the background that counts as content
MAX_GROWTH = 3.0         # a snapped box may not be more than 3x the estimate...
MIN_SHRINK = .12         # ...or less than 12% of it
MAX_REGION_SHARE = .35   # containers (whole panels, whole figures) are left as they are


def decode(image: str) -> np.ndarray:
    raw = base64.b64decode(image.split(",", 1)[1])
    with Image.open(io.BytesIO(raw)) as img:
        return np.asarray(img.convert("RGB"), dtype=np.int16)


def snap_box(pixels: np.ndarray, box: Box) -> Box | None:
    """Tight box around the content the estimate points at, or None when there is nothing reliable to snap to."""
    height, width = pixels.shape[:2]
    x0, y0 = box.x / 100 * width, box.y / 100 * height
    x1, y1 = x0 + box.width / 100 * width, y0 + box.height / 100 * height
    pad = min(max(4, .35 * max(x1 - x0, y1 - y0)), .08 * max(width, height))
    cx0, cy0 = int(max(0, x0 - pad)), int(max(0, y0 - pad))
    cx1, cy1 = int(min(width, x1 + pad)), int(min(height, y1 + pad))
    crop = pixels[cy0:cy1, cx0:cx1]
    if crop.shape[0] < 4 or crop.shape[1] < 4:
        return None
    border = np.concatenate([crop[0], crop[-1], crop[:, 0], crop[:, -1]])
    background = np.median(border, axis=0)
    mask = np.abs(crop - background).max(axis=2) > INK_THRESHOLD
    if mask.mean() < .003:
        return None
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    if not count:
        return None
    # The estimate in crop coordinates; a component belongs to it if most of it lies inside.
    ex0, ey0, ex1, ey1 = x0 - cx0, y0 - cy0, x1 - cx0, y1 - cy0
    keep = []
    for index, sl in enumerate(ndimage.find_objects(labels), start=1):
        ys, xs = sl
        touches_edge = ys.start == 0 or xs.start == 0 or ys.stop == crop.shape[0] or xs.stop == crop.shape[1]
        if touches_edge:
            continue
        component = labels[sl] == index
        size = component.sum()
        iy0, iy1 = max(ys.start, int(ey0)), min(ys.stop, int(np.ceil(ey1)))
        ix0, ix1 = max(xs.start, int(ex0)), min(xs.stop, int(np.ceil(ex1)))
        inside = component[iy0 - ys.start:iy1 - ys.start, ix0 - xs.start:ix1 - xs.start].sum() if iy1 > iy0 and ix1 > ix0 else 0
        if inside >= .5 * size:
            keep.append(sl)
    if not keep:
        return None
    sx0 = min(s[1].start for s in keep) + cx0 - 1
    sy0 = min(s[0].start for s in keep) + cy0 - 1
    sx1 = max(s[1].stop for s in keep) + cx0 + 1
    sy1 = max(s[0].stop for s in keep) + cy0 + 1
    ratio = (sx1 - sx0) * (sy1 - sy0) / max(1, (x1 - x0) * (y1 - y0))
    if not MIN_SHRINK <= ratio <= MAX_GROWTH:
        return None
    sx0, sy0, sx1, sy1 = max(0, sx0), max(0, sy0), min(width, sx1), min(height, sy1)
    return Box(x=sx0 / width * 100, y=sy0 / height * 100, width=(sx1 - sx0) / width * 100, height=(sy1 - sy0) / height * 100)


def snap_grounding(image: str, grounding: Grounding) -> Grounding:
    """Returns the grounding with readable regions snapped to their pixels; anything uncertain is left untouched."""
    try:
        pixels = decode(image)
    except (ValueError, OSError):
        return grounding  # nothing to snap to; the estimates stay usable
    regions: list[Region] = []
    for region in grounding.regions:
        box = region.box
        if region.text.strip() and box.width * box.height / 1e4 <= MAX_REGION_SHARE:
            box = snap_box(pixels, box) or box
        regions.append(region.model_copy(update={"box": box}))
    return grounding.model_copy(update={"regions": regions})


# Italian colour words the model and the source use for objects ("la curva blu", "retta rossa").
COLOR_WORDS = {"blu": (45, 80, 225), "azzurr": (60, 150, 240), "ross": (215, 45, 55), "verd": (40, 155, 75), "giall": (225, 195, 30),
               "arancio": (240, 140, 25), "viola": (125, 60, 200), "rosa": (235, 100, 170), "ner": (25, 25, 25), "grigi": (128, 128, 128)}
COLOR_MATCH = 120   # RGB distance that still counts as "that colour" (antialiased strokes are lighter)


def color_hint(*texts: str) -> tuple[int, int, int] | None:
    words = " ".join(texts).lower()
    return next((rgb for word, rgb in COLOR_WORDS.items() if word in words), None)


def _ink_mask(window: np.ndarray, color: tuple[int, int, int] | None) -> np.ndarray:
    border = np.concatenate([window[0], window[-1], window[:, 0], window[:, -1]])
    mask = np.abs(window - np.median(border, axis=0)).max(axis=2) > INK_THRESHOLD
    if color is not None:
        mask &= np.sqrt(((window - np.array(color)) ** 2).sum(axis=2)) < COLOR_MATCH
    return mask


def dominant_ink(pixels: np.ndarray, box: Box) -> tuple[int, int, int] | None:
    """Most frequent saturated ink colour in a region (the colour of 'its' curve), if it has one."""
    h, w = pixels.shape[:2]
    crop = pixels[int(box.y / 100 * h):int((box.y + box.height) / 100 * h), int(box.x / 100 * w):int((box.x + box.width) / 100 * w)]
    if crop.shape[0] < 3 or crop.shape[1] < 3:
        return None
    ink = crop[_ink_mask(crop, None)]
    saturated = ink[(ink.max(axis=1) - ink.min(axis=1)) > 60]
    if len(saturated) < 20:
        return None
    bins, counts = np.unique(saturated // 48, axis=0, return_counts=True)
    top = bins[counts.argmax()]
    return tuple(int(v) for v in saturated[(saturated // 48 == top).all(axis=1)].mean(axis=0))


def nearest_ink(pixels: np.ndarray, x: float, y: float, radius: float, color=None) -> tuple[float, float] | None:
    h, w = pixels.shape[:2]
    x0, y0, x1, y1 = int(max(0, x - radius)), int(max(0, y - radius)), int(min(w, x + radius + 1)), int(min(h, y + radius + 1))
    window = pixels[y0:y1, x0:x1]
    if window.shape[0] < 3 or window.shape[1] < 3:
        return None
    ys, xs = np.nonzero(_ink_mask(window, color))
    if not len(xs):
        return None
    d = (xs + x0 - x) ** 2 + (ys + y0 - y) ** 2
    i = d.argmin()
    return (xs[i] + x0 + .5, ys[i] + y0 + .5) if d[i] <= radius ** 2 else None


AT = {"center": (.5, .5), "top": (.5, 0), "bottom": (.5, 1), "left": (0, .5), "right": (1, .5),
      "top_left": (0, 0), "top_right": (1, 0), "bottom_left": (0, 1), "bottom_right": (1, 1)}


def snap_pins(image: str, scene, grounding: Grounding):
    """Puts the pin of each callout on the source onto the object it names: the nearest ink of the right colour."""
    try:
        pixels = decode(image)
    except (ValueError, OSError):
        return scene
    h, w = pixels.shape[:2]
    regions = {r.id: r for r in grounding.regions}
    points = {p.id: p for p in scene.points}
    users: dict[str, set[str]] = {}
    for m in scene.elements:
        for pid in [*m.anchors, *([m.target] if m.target else [])]:
            users.setdefault(pid, set()).add(m.kind)
    for p in scene.points:  # a point other points are built from must stay where it is
        for r in p.refs:
            users.setdefault(r, set()).add("point")
    moved = {}
    for m in scene.elements:
        p = points.get(m.target) if m.kind == "callout" and m.target else None
        if not p or p.space != "image" or p.kind not in ("xy", "region") or users.get(p.id) != {"callout"} or p.id in moved:
            continue
        region = regions.get(p.region) if p.kind == "region" else None
        if p.kind == "xy":
            x, y = p.x + p.dx, p.y + p.dy
        elif region:
            fx, fy = AT[p.at]
            x, y = region.box.x + region.box.width * fx + p.dx, region.box.y + region.box.height * fy + p.dy
        else:
            continue
        hint = color_hint(m.text, region.label if region else "", region.text if region else "")
        if hint is None and region is not None:
            hint = dominant_ink(pixels, region.box)
        radius = .035 * max(w, h)
        found = nearest_ink(pixels, x / 100 * w, y / 100 * h, radius, hint)
        if found:
            moved[p.id] = p.model_copy(update={"kind": "xy", "x": found[0] / w * 100, "y": found[1] / h * 100, "dx": 0, "dy": 0, "region": None})
    if not moved:
        return scene
    return scene.model_copy(update={"points": [moved.get(p.id, p) for p in scene.points]})
