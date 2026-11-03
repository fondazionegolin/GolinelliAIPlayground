"""PowerPoint → slide-editor import.

Everything the editor can model stays editable: text, tables, pictures, plain shapes and lines,
including what the slide inherits from its layout and master. What it cannot model (charts,
SmartArt, freeforms, arrows, gradients, shadows, OLE objects, picture effects…) is rendered by
LibreOffice from an overlay copy of the deck that contains only those shapes, and placed as a
transparent picture at the same position, so nothing silently disappears.
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
import math
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

import fitz
import numpy as np
from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.oxml.ns import qn

from app.services import pptx_rich

logger = logging.getLogger(__name__)

WebImage = Callable[[bytes, str], tuple[bytes, str]]
RunOffice = Callable[..., bytes]

MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
NATIVE_SHAPE_PRESETS = {"rect", "roundRect", "ellipse", "flowChartProcess"}
VISIBLE_EFFECTS = {"outerShdw", "innerShdw", "glow", "softEdge", "reflection", "prstShdw"}
PICTURE_EFFECTS = {"duotone", "biLevel", "grayscl", "clrChange", "lum", "alphaModFix"}
MAX_IMAGE_SIDE = 2000
RENDER_ZOOM = 2.0  # canvas px → raster px
# Blur of a shadow extends past the shape's frame.
EFFECT_MARGIN_EMU = 228600


@dataclass
class Pending:
    """Image block waiting for its pixels from the overlay render."""
    block: dict[str, Any]
    bounds: tuple[float, float, float, float]  # EMU, axis-aligned


@dataclass
class SlideState:
    blocks: list[dict[str, Any]] = field(default_factory=list)
    pending: list[Pending] = field(default_factory=list)
    keep: set[Any] = field(default_factory=set)  # slide XML elements kept in the overlay
    title: str | None = None


def _id() -> str:
    return str(uuid.uuid4())


def _data_url(blob: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(blob).decode('ascii')}"


def _compact_image(blob: bytes, mime: str, crop: tuple[float, float, float, float] | None, flip: tuple[bool, bool], box: tuple[float, float]) -> tuple[bytes, str]:
    """Crop (a:srcRect), flip and downscale to what the slide can show. Decks often embed
    camera originals, and every image lives inside the document JSON."""
    needs_pixels = bool(crop) or any(flip)
    if mime == "image/svg+xml":
        return blob, mime
    try:
        image = Image.open(io.BytesIO(blob))
        image.load()
    except Exception:
        return blob, mime
    if getattr(image, "is_animated", False):
        return blob, mime
    if crop:
        width, height = image.size
        left, top, right, bottom = crop
        window = (round(width * left), round(height * top), round(width * (1 - right)), round(height * (1 - bottom)))
        if window[2] > window[0] and window[3] > window[1]:
            image = image.crop(window)
    if flip[0]:
        image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if flip[1]:
        image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    limit = min(MAX_IMAGE_SIDE, max(480, round(max(box) * 2.5)))
    oversized = max(image.size) > limit * 1.1
    if oversized:
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    if not needs_pixels and not oversized and len(blob) < 400_000:
        return blob, mime
    has_alpha = image.mode in {"RGBA", "LA", "PA"} or (image.mode == "P" and "transparency" in image.info)
    if has_alpha:
        converted = image.convert("RGBA")
        if converted.getchannel("A").getextrema()[0] < 250:
            output = io.BytesIO()
            converted.save(output, format="PNG", optimize=True)
            return output.getvalue(), "image/png"
    output = io.BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=86, optimize=True)
    result = output.getvalue()
    return (blob, mime) if not needs_pixels and len(result) >= len(blob) else (result, "image/jpeg")


def _rotated_bounds(x: float, y: float, w: float, h: float, rotation: float) -> tuple[float, float, float, float]:
    if not rotation:
        return x, y, w, h
    radians = math.radians(rotation)
    cos, sin = abs(math.cos(radians)), abs(math.sin(radians))
    new_w, new_h = w * cos + h * sin, w * sin + h * cos
    return x + (w - new_w) / 2, y + (h - new_h) / 2, new_w, new_h


def _has_visible_effect(sp_pr: Any) -> bool:
    if sp_pr is None:
        return False
    for child in sp_pr:
        name = etree.QName(child).localname
        if name == "effectLst" and any(etree.QName(e).localname in VISIBLE_EFFECTS for e in child):
            return True
        if name in {"effectDag", "sp3d"}:
            return True
    return False


def _picture_is_native(element: Any) -> bool:
    sp_pr = element.find(qn("p:spPr"))
    geometry = sp_pr.find(qn("a:prstGeom")) if sp_pr is not None else None
    if sp_pr is not None and sp_pr.find(qn("a:custGeom")) is not None:
        return False
    if geometry is not None and geometry.get("prst") != "rect":
        return False
    if _has_visible_effect(sp_pr):
        return False
    line = sp_pr.find(qn("a:ln")) if sp_pr is not None else None
    if line is not None and line.find(qn("a:noFill")) is None and len(line):
        return False
    blip = element.find(".//" + qn("a:blip"))
    if blip is None:
        return True
    for child in blip:
        name = etree.QName(child).localname
        if name in PICTURE_EFFECTS and not (name == "alphaModFix" and int(child.get("amt", "100000")) >= 100000):
            return False
    return True


class SlideWalker:
    def __init__(self, presentation: Any, slide: Any, theme: Any, pt_to_px: float, sx: float, sy: float, web_image: WebImage, table_styles: dict[str, Any]):
        self.presentation, self.slide, self.theme = presentation, slide, theme
        self.pt_to_px, self.sx, self.sy = pt_to_px, sx, sy
        self.web_image = web_image
        self.table_styles = table_styles
        self.state = SlideState()
        self.is_decor = False

    def box(self, x: float, y: float, w: float, h: float, minimum: float = 8) -> dict[str, float]:
        return {
            "x": round(x * self.sx, 2), "y": round(y * self.sy, 2),
            "width": max(minimum, round(w * self.sx, 2)), "height": max(minimum, round(h * self.sy, 2)),
        }

    def push(self, block: dict[str, Any]) -> None:
        if self.is_decor:
            block["locked"] = True
        self.state.blocks.append(block)

    def defer_render(self, element: Any, bounds: tuple[float, float, float, float]) -> None:
        """The overlay render will fill this block; consecutive overlapping shapes share one picture."""
        self.state.keep.add(element)
        x, y, w, h = bounds
        pendings = self.state.pending
        if pendings and self.state.blocks and self.state.blocks[-1] is pendings[-1].block:
            px, py, pw, ph = pendings[-1].bounds
            gap = 91440
            if x <= px + pw + gap and px <= x + w + gap and y <= py + ph + gap and py <= y + h + gap:
                left, top = min(x, px), min(y, py)
                pendings[-1].bounds = (left, top, max(x + w, px + pw) - left, max(y + h, py + ph) - top)
                pendings[-1].block.update(self.box(*pendings[-1].bounds))
                return
        block = {"id": _id(), "type": "image", "content": "", **self.box(x, y, w, h), "style": {}}
        self.push(block)
        pendings.append(Pending(block, bounds))

    def text(self, shape: Any, geometry: dict[str, float], rotation: float) -> None:
        body_chain = pptx_rich.inherited_body_properties(shape, self.slide)
        scale = pptx_rich.autofit_scale(body_chain)
        imported = pptx_rich.text_frame_to_html(shape, self.slide, self.presentation, self.theme, self.pt_to_px, scale)
        if not imported.plain.strip():
            return
        try:
            title_shape = self.slide.shapes.title
            is_title = title_shape is not None and title_shape._element is shape._element
        except Exception:
            is_title = False
        if is_title:
            self.state.title = imported.plain.strip().splitlines()[0][:200]

        def inset(attribute: str, default: int) -> float:
            raw = pptx_rich.body_attr(body_chain, attribute)
            return (int(raw) if raw and raw.lstrip("-").isdigit() else default) * (self.sy if attribute in {"tIns", "bIns"} else self.sx)

        style: dict[str, Any] = {
            "fontSize": imported.font_px or round(18 * self.pt_to_px, 1),
            "color": imported.color or "#000000",
            **({"fontFamily": imported.font_family} if imported.font_family else {}),
            "fontWeight": "bold" if imported.bold else "normal",
            "textAlign": imported.align or "left",
            "lineHeight": 1.2,
            "paddingTop": round(inset("tIns", 45720), 1), "paddingRight": round(inset("rIns", 91440), 1),
            "paddingBottom": round(inset("bIns", 45720), 1), "paddingLeft": round(inset("lIns", 91440), 1),
            # The original's size is authoritative: never shrink imported text to fit a substitute font.
            "autoFit": False,
        }
        anchor = pptx_rich.body_attr(body_chain, "anchor")
        if anchor in {"ctr", "b"}:
            style["verticalAlign"] = "middle" if anchor == "ctr" else "bottom"
        if pptx_rich.body_attr(body_chain, "wrap") == "none":
            style["whiteSpace"] = "nowrap"
        vertical = pptx_rich.body_attr(body_chain, "vert")
        if vertical in {"vert", "vert270", "eaVert", "wordArtVert"}:
            # Vertical text is a turned box in the editor's model.
            center_x, center_y = geometry["x"] + geometry["width"] / 2, geometry["y"] + geometry["height"] / 2
            geometry = {
                "x": round(center_x - geometry["height"] / 2, 2), "y": round(center_y - geometry["width"] / 2, 2),
                "width": geometry["height"], "height": geometry["width"],
            }
            rotation = (rotation + (270 if vertical == "vert270" else 90)) % 360
        self.push({
            "id": _id(), "type": "text", "content": imported.html, **geometry,
            **({"rotation": rotation} if rotation else {}), "style": style,
        })

    def picture(self, shape: Any, element: Any, emu: tuple[float, float, float, float], rotation: float) -> bool:
        try:
            image = shape.image
        except Exception:
            return False
        if not _picture_is_native(element):
            self.defer_render(element, self._effect_bounds(emu, rotation))
            return True
        blob, mime = self.web_image(image.blob, image.content_type)
        if not blob:
            self.defer_render(element, _rotated_bounds(*emu, rotation))
            return True
        source = element.find(".//" + qn("a:srcRect"))
        crop = None
        if source is not None:
            values = [max(0, int(source.get(k, "0"))) / 100000 for k in ("l", "t", "r", "b")]
            crop = tuple(values) if any(values) else None
        xfrm = element.find(qn("p:spPr") + "/" + qn("a:xfrm"))
        flip = (xfrm is not None and xfrm.get("flipH") == "1", xfrm is not None and xfrm.get("flipV") == "1")
        geometry = self.box(*emu)
        blob, mime = _compact_image(blob, mime, crop, flip, (geometry["width"], geometry["height"]))
        self.push({
            "id": _id(), "type": "image", "content": _data_url(blob, mime), **geometry,
            **({"rotation": rotation} if rotation else {}), "style": {},
        })
        return True

    def _effect_bounds(self, emu: tuple[float, float, float, float], rotation: float) -> tuple[float, float, float, float]:
        x, y, w, h = _rotated_bounds(*emu, rotation)
        margin = EFFECT_MARGIN_EMU
        return x - margin, y - margin, w + 2 * margin, h + 2 * margin

    def line(self, element: Any, emu: tuple[float, float, float, float], rotation: float) -> None:
        sp_pr = element.find(qn("p:spPr"))
        line = sp_pr.find(qn("a:ln")) if sp_pr is not None else None
        geometry = sp_pr.find(qn("a:prstGeom")) if sp_pr is not None else None
        preset = geometry.get("prst") if geometry is not None else "line"
        xfrm = sp_pr.find(qn("a:xfrm")) if sp_pr is not None else None
        flipped = xfrm is not None and ("1" in {xfrm.get("flipH"), xfrm.get("flipV")})
        decorated = line is not None and any(line.find(qn(tag)) is not None for tag in ("a:headEnd", "a:tailEnd", "a:prstDash", "a:custDash"))
        if line is not None and decorated:
            head, tail = line.find(qn("a:headEnd")), line.find(qn("a:tailEnd"))
            dash = line.find(qn("a:prstDash"))
            decorated = bool(
                (head is not None and head.get("type", "none") != "none")
                or (tail is not None and tail.get("type", "none") != "none")
                or (dash is not None and dash.get("val") != "solid")
                or line.find(qn("a:custDash")) is not None
            )
        straight = preset in {"line", "straightConnector1"}
        if not straight or decorated or rotation or (flipped and emu[2] and emu[3]) or (line is not None and line.find(qn("a:gradFill")) is not None):
            x, y, w, h = _rotated_bounds(*emu, rotation)
            margin = 91440
            self.defer_render(element, (x - margin, y - margin, w + 2 * margin, h + 2 * margin))
            return
        color = pptx_rich.color_of(line, self.theme) if line is not None else None
        if color is None:
            reference = element.find(qn("p:style") + "/" + qn("a:lnRef"))
            color = pptx_rich.resolve_color(reference[0], self.theme) if reference is not None and len(reference) else None
        width_emu = float(line.get("w", 12700)) if line is not None else 12700
        self.push({
            "id": _id(), "type": "line", "content": "", **self.box(*emu, minimum=1),
            "style": {"stroke": f"#{color or '000000'}", "strokeWidth": max(1, round(width_emu / 12700 * self.pt_to_px, 1))},
        })

    def shape(self, shape: Any, element: Any, emu: tuple[float, float, float, float], rotation: float) -> None:
        sp_pr = element.find(qn("p:spPr"))
        geometry = sp_pr.find(qn("a:prstGeom")) if sp_pr is not None else None
        preset = geometry.get("prst") if geometry is not None else None
        custom = sp_pr.find(qn("a:custGeom")) if sp_pr is not None else None
        style = element.find(qn("p:style"))
        explicit_none = sp_pr is not None and sp_pr.find(qn("a:noFill")) is not None
        complex_fill = sp_pr is not None and any(sp_pr.find(qn(f"a:{tag}")) is not None for tag in ("gradFill", "blipFill", "pattFill"))
        fill_hex = pptx_rich.color_of(sp_pr, self.theme) if sp_pr is not None and sp_pr.find(qn("a:solidFill")) is not None else None
        fill_alpha = pptx_rich.alpha_of(sp_pr) if fill_hex else 1.0
        fill_reference = style.find(qn("a:fillRef")) if style is not None else None
        themed_fill = False
        if fill_hex is None and not explicit_none and not complex_fill and fill_reference is not None and fill_reference.get("idx", "0") != "0":
            themed_fill = fill_reference.get("idx") != "1"  # idx 2/3 are the theme's gradient fills
            fill_hex = pptx_rich.resolve_color(fill_reference[0], self.theme) if len(fill_reference) else None
        line = sp_pr.find(qn("a:ln")) if sp_pr is not None else None
        line_hidden = line is not None and line.find(qn("a:noFill")) is not None
        stroke_hex = pptx_rich.color_of(line, self.theme) if line is not None and not line_hidden else None
        line_reference = style.find(qn("a:lnRef")) if style is not None else None
        if stroke_hex is None and not line_hidden and line_reference is not None and line_reference.get("idx", "0") != "0" and len(line_reference):
            stroke_hex = pptx_rich.resolve_color(line_reference[0], self.theme)
        dashed = line is not None and line.find(qn("a:prstDash")) is not None and line.find(qn("a:prstDash")).get("val") != "solid"
        painted = bool(fill_hex or stroke_hex or complex_fill or custom is not None)
        visible_effect = _has_visible_effect(sp_pr)
        native = (
            preset in NATIVE_SHAPE_PRESETS and not complex_fill and not themed_fill and not visible_effect and not dashed
            and not (line is not None and line.find(qn("a:gradFill")) is not None)
        )
        has_text = getattr(shape, "has_text_frame", False) and shape.text_frame.text.strip()
        is_placeholder_only = not painted and not has_text
        if is_placeholder_only:
            return
        if native and (fill_hex or stroke_hex):
            block_style: dict[str, Any] = {
                "fill": pptx_rich.css_color(fill_hex, fill_alpha) or "transparent",
                "stroke": f"#{stroke_hex}" if stroke_hex else "transparent",
                "strokeWidth": max(1, round(float(line.get("w", 9525)) / 12700 * self.pt_to_px, 1)) if line is not None and stroke_hex else (1 if stroke_hex else 0),
            }
            if preset == "roundRect":
                adjust = element.find(".//" + qn("a:gd"))
                ratio = 0.16667
                if adjust is not None:
                    match = re.search(r"val\s+(\d+)", adjust.get("fmla") or "")
                    ratio = int(match.group(1)) / 100000 if match else ratio
                block_style["cornerRadius"] = round(min(emu[2] * self.sx, emu[3] * self.sy) * ratio, 1)
            self.push({
                "id": _id(), "type": "ellipse" if preset == "ellipse" else "rectangle", "content": "",
                **self.box(*emu), **({"rotation": rotation} if rotation else {}), "style": block_style,
            })
        elif painted:
            bounds = self._effect_bounds(emu, rotation) if visible_effect else _rotated_bounds(*emu, rotation)
            self.defer_render(element, bounds)
        if has_text:
            self.text(shape, self.box(*emu), rotation)

    def table(self, shape: Any, emu: tuple[float, float, float, float]) -> None:
        html = table_to_html(shape.table, shape, self.slide, self.presentation, self.theme, self.pt_to_px, self.sx, self.table_styles)
        # The graphic frame's stored size goes stale: PowerPoint lays tables out from columns and rows.
        width = sum(float(column.width) for column in shape.table.columns)
        height = sum(float(row.height) for row in shape.table.rows)
        self.push({
            "id": _id(), "type": "text", "content": html, **self.box(emu[0], emu[1], width or emu[2], height or emu[3]),
            "style": {
                "fontSize": round(18 * self.pt_to_px, 1), "color": "#000000", "textAlign": "left", "lineHeight": 1.2,
                "autoFit": False,
            },
        })

    def walk(self, shapes: Any, transform: tuple[float, float, float, float]) -> None:
        ox, oy, gx, gy = transform
        # python-pptx hides mc:AlternateContent (3D models, ink, math, newer shapes): the render covers them.
        python_shapes = {id(shape._element): shape for shape in shapes}
        container = shapes._spTree if hasattr(shapes, "_spTree") else shapes._grpSp
        for element in container:
            local = etree.QName(element).localname
            if local == "AlternateContent":
                bounds = _alternate_bounds(element)
                if bounds:
                    self.defer_render(element, (ox + bounds[0] * gx, oy + bounds[1] * gy, bounds[2] * gx, bounds[3] * gy))
                continue
            shape = python_shapes.get(id(element))
            if shape is None:
                continue
            try:
                left, top = float(shape.left or 0), float(shape.top or 0)
                width, height = float(shape.width or 0), float(shape.height or 0)
            except Exception:
                continue
            emu = (ox + left * gx, oy + top * gy, width * gx, height * gy)
            rotation = float(getattr(shape, "rotation", 0) or 0)
            try:
                if local == "grpSp":
                    self.group(shape, element, emu, rotation, transform)
                elif local == "pic":
                    if not self.picture(shape, element, emu, rotation):
                        self.defer_render(element, _rotated_bounds(*emu, rotation))
                elif local == "graphicFrame":
                    if getattr(shape, "has_table", False):
                        self.table(shape, emu)
                    else:
                        self.defer_render(element, emu)
                elif local == "cxnSp" or (local == "sp" and _is_line(element)):
                    self.line(element, emu, rotation)
                elif local == "sp":
                    self.shape(shape, element, emu, rotation)
                elif local == "contentPart":
                    self.defer_render(element, emu)
            except Exception:
                logger.warning("PowerPoint shape %s skipped", local, exc_info=True)

    def group(self, shape: Any, element: Any, emu: tuple[float, float, float, float], rotation: float, transform: tuple[float, float, float, float]) -> None:
        xfrm = element.find(qn("p:grpSpPr")).find(qn("a:xfrm"))
        flipped = xfrm is not None and "1" in {xfrm.get("flipH"), xfrm.get("flipV")}
        if rotation or flipped:
            # Children of a turned group need a transform the flat block list cannot express.
            self.defer_render(element, _rotated_bounds(*emu, rotation))
            return
        child_offset = xfrm.find(qn("a:chOff")) if xfrm is not None else None
        child_extent = xfrm.find(qn("a:chExt")) if xfrm is not None else None
        if child_offset is None or child_extent is None:
            self.walk(shape.shapes, transform)
            return
        ch_x, ch_y = float(child_offset.get("x", 0)), float(child_offset.get("y", 0))
        ch_w, ch_h = float(child_extent.get("cx", 1)) or 1, float(child_extent.get("cy", 1)) or 1
        scale_x, scale_y = emu[2] / ch_w, emu[3] / ch_h
        self.walk(shape.shapes, (emu[0] - ch_x * scale_x, emu[1] - ch_y * scale_y, scale_x, scale_y))


def _is_line(element: Any) -> bool:
    geometry = element.find(qn("p:spPr") + "/" + qn("a:prstGeom"))
    return geometry is not None and geometry.get("prst") in {"line", "straightConnector1"}


def _alternate_bounds(element: Any) -> tuple[float, float, float, float] | None:
    for xfrm in element.iter(qn("a:xfrm"), qn("p:xfrm")):
        offset, extent = xfrm.find(qn("a:off")), xfrm.find(qn("a:ext"))
        if offset is not None and extent is not None:
            return float(offset.get("x", 0)), float(offset.get("y", 0)), float(extent.get("cx", 0)), float(extent.get("cy", 0))
    return None


# ── tables ─────────────────────────────────────────────────────────────────────────────────

def load_table_styles(presentation: Any) -> dict[str, Any]:
    try:
        for relationship in presentation.part.rels.values():
            if relationship.reltype.endswith("/tableStyles"):
                root = etree.fromstring(relationship.target_part.blob)
                return {style.get("styleId"): style for style in root.findall(qn("a:tblStyle"))}
    except Exception:
        pass
    return {}


def _css_border(line: Any, theme: Any, pt_to_px: float) -> str | None:
    if line is None:
        return None
    if line.find(qn("a:noFill")) is not None:
        return "none"
    color = pptx_rich.color_of(line, theme)
    if not color:
        return None
    width = max(0.5, float(line.get("w", 12700)) / 12700 * pt_to_px)
    return f"{round(width, 2):g}px solid #{color}"


def _table_style_parts(table_element: Any, row: int, col: int, rows: int, cols: int, styles: dict[str, Any]) -> list[Any]:
    """Conditional parts of the table style that apply to one cell, lowest priority first."""
    properties = table_element.find(qn("a:tblPr"))
    if properties is None:
        return []
    style_id = properties.find(qn("a:tableStyleId"))
    style = styles.get(style_id.text if style_id is not None else None)
    if style is None:
        return []
    enabled = lambda name: properties.get(name) == "1"
    names = ["wholeTbl"]
    first_row, first_col = enabled("firstRow"), enabled("firstCol")
    if enabled("bandRow"):
        band = row - (1 if first_row else 0)
        if band >= 0:
            names.append("band1H" if band % 2 == 0 else "band2H")
    if enabled("bandCol"):
        band = col - (1 if first_col else 0)
        if band >= 0:
            names.append("band1V" if band % 2 == 0 else "band2V")
    if first_col and col == 0:
        names.append("firstCol")
    if enabled("lastCol") and col == cols - 1:
        names.append("lastCol")
    if enabled("lastRow") and row == rows - 1:
        names.append("lastRow")
    if first_row and row == 0:
        names.append("firstRow")
    parts = [style.find(qn(f"a:{name}")) for name in names]
    return [part for part in parts if part is not None]


def table_to_html(table: Any, shape: Any, slide: Any, presentation: Any, theme: Any, pt_to_px: float, sx: float, styles: dict[str, Any]) -> str:
    element = table._tbl
    column_widths = [round(float(column.width) * sx, 1) for column in table.columns]
    row_elements = element.findall(qn("a:tr"))
    row_count, col_count = len(row_elements), len(column_widths)
    output = ["<table><colgroup>", *[f'<col style="width: {width:g}px">' for width in column_widths], "</colgroup><tbody>"]
    for row_index, row in enumerate(table.rows):
        row_px = max(1.0, float(row.height) * pt_to_px / 12700)
        output.append(f'<tr style="height: {round(row_px, 1):g}px">')
        for col_index, cell in enumerate(row.cells):
            tc = cell._tc
            if tc.get("hMerge") == "1" or tc.get("vMerge") == "1":
                continue
            parts = _table_style_parts(element, row_index, col_index, row_count, col_count, styles)
            tc_pr = tc.find(qn("a:tcPr"))
            css: list[str] = []
            fill = None
            if tc_pr is not None and tc_pr.find(qn("a:noFill")) is None:
                fill = pptx_rich.css_color(pptx_rich.color_of(tc_pr, theme), pptx_rich.alpha_of(tc_pr))
            default_color = None
            default_bold = False
            borders: dict[str, str] = {}
            for part in parts:
                cell_style = part.find(qn("a:tcStyle"))
                if cell_style is not None:
                    fill_holder = cell_style.find(qn("a:fill"))
                    if fill is None or tc_pr is None or tc_pr.find(qn("a:solidFill")) is None:
                        candidate = pptx_rich.css_color(pptx_rich.color_of(fill_holder, theme), pptx_rich.alpha_of(fill_holder)) if fill_holder is not None else None
                        fill = candidate or fill
                    edges = cell_style.find(qn("a:tcBdr"))
                    if edges is not None:
                        for tag, side in (("left", "left"), ("right", "right"), ("top", "top"), ("bottom", "bottom"), ("insideH", "insideH"), ("insideV", "insideV")):
                            holder = edges.find(qn(f"a:{tag}"))
                            line = holder.find(qn("a:ln")) if holder is not None else None
                            css_line = _css_border(line, theme, pt_to_px)
                            if css_line:
                                borders[side] = css_line
                text_style = part.find(qn("a:tcTxStyle"))
                if text_style is not None:
                    if text_style.get("b") in {"on", "1"}:
                        default_bold = True
                    elif text_style.get("b") == "off":
                        default_bold = False
                    if len(text_style):
                        for child in text_style:
                            if etree.QName(child).localname in {"schemeClr", "srgbClr", "prstClr", "sysClr"}:
                                default_color = pptx_rich.resolve_color(child, theme) or default_color
            resolved = {
                "left": borders.get("left") if col_index == 0 else borders.get("insideV", borders.get("left")),
                "right": borders.get("right") if col_index == col_count - 1 else borders.get("insideV", borders.get("right")),
                "top": borders.get("top") if row_index == 0 else borders.get("insideH", borders.get("top")),
                "bottom": borders.get("bottom") if row_index == row_count - 1 else borders.get("insideH", borders.get("bottom")),
            }
            if tc_pr is not None:
                for tag, side in (("a:lnL", "left"), ("a:lnR", "right"), ("a:lnT", "top"), ("a:lnB", "bottom")):
                    line = _css_border(tc_pr.find(qn(tag)), theme, pt_to_px)
                    if line:
                        resolved[side] = line
            if fill:
                css.append(f"background-color: {fill}")
            for side, value in resolved.items():
                if value:
                    css.append(f"border-{side}: {value}")
            anchor = tc_pr.get("anchor") if tc_pr is not None else None
            css.append(f"vertical-align: {'middle' if anchor == 'ctr' else 'bottom' if anchor == 'b' else 'top'}")
            margin = lambda name, default: round((int(tc_pr.get(name)) if tc_pr is not None and tc_pr.get(name, "").isdigit() else default) * sx, 1)
            css.append(f"padding: {margin('marT', 45720):g}px {margin('marR', 91440):g}px {margin('marB', 45720):g}px {margin('marL', 91440):g}px")

            def chain_for(level: int, p_pr: Any) -> list[Any]:
                return pptx_rich.level_styles(shape, slide, presentation, level) + ([p_pr] if p_pr is not None else [])

            imported = pptx_rich.paragraphs_to_html(cell.text_frame.paragraphs, chain_for, theme, pt_to_px, default_color=default_color, default_bold=default_bold)
            cell_font = [
                *([f"color: {imported.color}"] if imported.color else []),
                *([f"font-size: {imported.font_px:g}px"] if imported.font_px else []),
                *([f"font-family: {imported.font_family}"] if imported.font_family else []),
                *(["font-weight: bold"] if imported.bold else []),
                *([f"text-align: {imported.align}"] if imported.align else []),
            ]
            css.extend(cell_font)
            span = "".join(
                f' {name}="{value}"' for name, value in (("colspan", cell.span_width), ("rowspan", cell.span_height)) if value and value > 1
            )
            widths = column_widths[col_index:col_index + (cell.span_width or 1)]
            colwidth = ",".join(str(round(width)) for width in widths)  # TipTap keeps column widths on the cells
            style = "; ".join(css)
            output.append(f'<td{span} colwidth="{colwidth}" style="{style}">{imported.html}</td>')
        output.append("</tr>")
    output.append("</tbody></table>")
    return "".join(output)


# ── backgrounds, master graphics ───────────────────────────────────────────────────────────

@dataclass
class Background:
    color: str | None = None
    image: tuple[bytes, str] | None = None
    needs_render: bool = False


def resolve_background(slide: Any, theme: Any) -> Background:
    """Slide background, inherited from layout/master."""
    owners = [slide]
    try:
        owners += [slide.slide_layout, slide.slide_layout.slide_master]
    except Exception:
        pass
    for owner in owners:
        background = owner._element.find(qn("p:cSld") + "/" + qn("p:bg"))
        if background is None:
            continue
        properties = background.find(qn("p:bgPr"))
        if properties is not None:
            if properties.find(qn("a:solidFill")) is not None:
                color = pptx_rich.color_of(properties, theme)
                if color:
                    return Background(color=f"#{color}")
            blip = properties.find(".//" + qn("a:blip"))
            if blip is not None and properties.find(qn("a:blipFill")) is not None:
                try:
                    part = owner.part.related_part(blip.get(qn("r:embed")))
                    return Background(image=(part.blob, part.content_type))
                except Exception:
                    return Background(needs_render=True)
            return Background(needs_render=True)
        reference = background.find(qn("p:bgRef"))
        if reference is not None:
            index = int(reference.get("idx", "1001") or 1001)
            if index > 1001:
                return Background(needs_render=True)  # theme gradient/picture background
            if len(reference):
                color = pptx_rich.resolve_color(reference[0], theme)
                if color:
                    return Background(color=f"#{color}")
    return Background()


def _decor_owners(slide: Any) -> list[Any]:
    """Layout/master that paint their non-placeholder shapes on this slide, back to front."""
    if slide._element.get("showMasterSp") == "0":
        return []
    layout = slide.slide_layout
    owners = [layout]
    if layout._element.get("showMasterSp") != "0":
        owners.insert(0, layout.slide_master)
    return owners


class DecorShapes:
    """Iterable of the non-placeholder shapes in a layout/master, for SlideWalker.walk."""

    def __init__(self, owner: Any):
        self._spTree = _Filtered(owner.shapes._spTree)
        self._shapes = [shape for shape in owner.shapes if not shape.is_placeholder]

    def __iter__(self) -> Any:
        return iter(self._shapes)


class _Filtered:
    def __init__(self, tree: Any):
        self.tree = tree

    def __iter__(self) -> Any:
        for element in self.tree:
            if element.find(".//" + qn("p:ph")) is None:
                yield element


# ── overlay render ─────────────────────────────────────────────────────────────────────────

def _clear_text(element: Any) -> None:
    for body in element.iter(qn("p:txBody")):
        for paragraph in body.findall(qn("a:p")):
            body.remove(paragraph)
        etree.SubElement(body, qn("a:p"))


def _prune_tree(tree: Any, keep_paths: set[tuple[int, ...]], path: tuple[int, ...] = ()) -> None:
    """Remove every drawable not addressed by keep_paths. A path is the child-index chain from spTree."""
    for index, element in reversed(list(enumerate(tree))):
        local = etree.QName(element).localname
        if local in {"nvGrpSpPr", "grpSpPr", "extLst"}:
            continue
        current = (*path, index)
        if current in keep_paths:
            continue
        if local == "grpSp" and any(kept[:len(current)] == current for kept in keep_paths):
            _prune_tree(element, keep_paths, current)
        else:
            tree.remove(element)


def _element_path(element: Any, root: Any) -> tuple[int, ...]:
    path: list[int] = []
    node = element
    while node is not root:
        parent = node.getparent()
        path.insert(0, list(parent).index(node))
        node = parent
    return tuple(path)


def _set_background(owner: Any, color: str | None = None) -> None:
    c_sld = owner._element.find(qn("p:cSld"))
    background = c_sld.find(qn("p:bg"))
    if background is not None:
        c_sld.remove(background)
    if color:
        background = etree.Element(qn("p:bg"))
        properties = etree.SubElement(background, qn("p:bgPr"))
        etree.SubElement(etree.SubElement(properties, qn("a:solidFill")), qn("a:srgbClr")).set("val", color)
        etree.SubElement(properties, qn("a:effectLst"))
        c_sld.insert(0, background)


def _unhide(slide: Any) -> None:
    slide._element.attrib.pop("show", None)
    timing = slide._element.find(qn("p:timing"))
    if timing is not None:
        slide._element.remove(timing)


def _pdf_of(presentation: Any, run_office: RunOffice) -> Any:
    buffer = io.BytesIO()
    presentation.save(buffer)
    return fitz.open(stream=run_office(buffer.getvalue(), "pptx", "pdf"), filetype="pdf")


def render_overlays(data: bytes, keep_by_slide: dict[int, set[tuple[int, ...]]], run_office: RunOffice, background: str) -> Any | None:
    """PDF whose page i holds only the kept shapes of slide i, without text, on a flat colour."""
    presentation = Presentation(io.BytesIO(data))
    for master in presentation.slide_masters:
        _set_background(master)
        for layout in master.slide_layouts:
            _set_background(layout)
            layout._element.set("showMasterSp", "0")
    for index, slide in enumerate(presentation.slides):
        _unhide(slide)
        _set_background(slide, background)
        slide._element.set("showMasterSp", "0")
        tree = slide.shapes._spTree
        paths = keep_by_slide.get(index, set())
        kept_elements = [_resolve_path(tree, path) for path in paths]
        _prune_tree(tree, paths)
        for element in kept_elements:
            if element is not None and etree.QName(element).localname != "pic":
                _clear_text(element)
    return _pdf_of(presentation, run_office)


def _resolve_path(tree: Any, path: tuple[int, ...]) -> Any | None:
    node = tree
    for index in path:
        children = list(node)
        if index >= len(children):
            return None
        node = children[index]
    return node


def render_base_layers(data: bytes, run_office: RunOffice) -> Any | None:
    """PDF of every slide with its own shapes removed: background plus master graphics."""
    presentation = Presentation(io.BytesIO(data))
    for slide in presentation.slides:
        _unhide(slide)
        tree = slide.shapes._spTree
        for element in reversed(list(tree)):
            if etree.QName(element).localname not in {"nvGrpSpPr", "grpSpPr"}:
                tree.remove(element)
    for master in presentation.slide_masters:
        for owner in (master, *master.slide_layouts):
            tree = owner.shapes._spTree
            for element in reversed(list(tree)):
                if etree.QName(element).localname not in {"nvGrpSpPr", "grpSpPr"} and element.find(".//" + qn("p:ph")) is not None:
                    tree.remove(element)
    return _pdf_of(presentation, run_office)


def _clip(page: Any, bounds: tuple[float, float, float, float], slide_emu: tuple[float, float]) -> tuple[Any, tuple[float, float, float, float]] | None:
    scale_x, scale_y = page.rect.width / slide_emu[0], page.rect.height / slide_emu[1]
    x, y, w, h = bounds
    clip = fitz.Rect(x * scale_x, y * scale_y, (x + w) * scale_x, (y + h) * scale_y) & page.rect
    if clip.is_empty or clip.width < 0.5 or clip.height < 0.5:
        return None
    return clip, (clip.x0 / scale_x, clip.y0 / scale_y, clip.width / scale_x, clip.height / scale_y)


def _raster(page: Any, clip: Any, zoom: float) -> np.ndarray:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False, colorspace=fitz.csRGB)
    return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3).astype(np.float32)


def _matte(on_white: np.ndarray, on_black: np.ndarray) -> Image.Image:
    """Straight-alpha RGBA from the same picture over white and over black. LibreOffice's PDF always
    paints the page, so transparency (soft shadows included) has to be recovered from the difference."""
    alpha = np.clip(255 - (on_white - on_black).mean(axis=2), 0, 255)
    visible = alpha > 0
    color = np.zeros_like(on_black)
    color[visible] = np.clip(on_black[visible] * 255 / alpha[visible][:, None], 0, 255)
    return Image.fromarray(np.dstack([color, alpha]).round().astype(np.uint8), "RGBA")


def _trimmed_png(image: Image.Image, bounds: tuple[float, float, float, float]) -> tuple[bytes, tuple[float, float, float, float]] | None:
    """Encode only what was really painted, so the block's frame hugs the graphic."""
    box = image.getchannel("A").point(lambda value: 255 if value > 3 else 0).getbbox()
    if box is None:
        return None
    width, height = image.size
    output = io.BytesIO()
    image.crop(box).save(output, format="PNG", optimize=True)
    x, y, w, h = bounds
    return output.getvalue(), (x + w * box[0] / width, y + h * box[1] / height, w * (box[2] - box[0]) / width, h * (box[3] - box[1]) / height)


# ── deck ───────────────────────────────────────────────────────────────────────────────────

def pptx_to_native(data: bytes, web_image: WebImage, run_office: RunOffice) -> dict[str, Any]:
    presentation = Presentation(io.BytesIO(data))
    width = int(presentation.slide_width or 1)
    height = int(presentation.slide_height or 1)
    format_name = "4:3" if abs((width / height) - (4 / 3)) < 0.08 else "16:9"
    target_width, target_height = ((800, 600) if format_name == "4:3" else (960, 540))
    sx, sy = target_width / width, target_height / height
    pt_to_px = target_width / (width / 914400 * 72)  # canvas width spans the whole slide width
    table_styles = load_table_styles(presentation)

    slides: list[dict[str, Any]] = []
    overlay_keep: dict[int, set[tuple[int, ...]]] = {}
    overlay_pending: dict[int, list[Pending]] = {}
    base_requests: dict[int, dict[str, Any]] = {}

    for slide_index, slide in enumerate(presentation.slides):
        try:
            theme = pptx_rich.theme_for_slide(slide)
        except Exception:
            theme = pptx_rich.load_theme(presentation)
        background = resolve_background(slide, theme)
        blocks: list[dict[str, Any]] = []

        decor = SlideWalker(presentation, slide, theme, pt_to_px, sx, sy, web_image, table_styles)
        decor.is_decor = True
        needs_base = background.needs_render
        for owner in _decor_owners(slide):
            decor.walk(DecorShapes(owner), (0.0, 0.0, 1.0, 1.0))
        if decor.state.pending:
            needs_base = True

        if needs_base:
            # One flat picture of background + master graphics: they never change per slide.
            base_block = {"id": _id(), "type": "image", "locked": True, "content": "", "x": 0, "y": 0, "width": target_width, "height": target_height, "style": {}}
            blocks.append(base_block)
            base_requests[slide_index] = base_block
        else:
            if background.image:
                blob, mime = web_image(*background.image)
                blob, mime = _compact_image(blob, mime, None, (False, False), (target_width, target_height))
                blocks.append({
                    "id": _id(), "type": "image", "locked": True, "content": _data_url(blob, mime),
                    "x": 0, "y": 0, "width": target_width, "height": target_height, "style": {},
                })
            blocks.extend(decor.state.blocks)

        walker = SlideWalker(presentation, slide, theme, pt_to_px, sx, sy, web_image, table_styles)
        walker.walk(slide.shapes, (0.0, 0.0, 1.0, 1.0))
        blocks.extend(walker.state.blocks)
        if walker.state.pending:
            overlay_keep[slide_index] = {_element_path(element, slide.shapes._spTree) for element in walker.state.keep}
            overlay_pending[slide_index] = walker.state.pending

        native: dict[str, Any] = {"id": _id(), "title": walker.state.title or f"Slide {slide_index + 1}", "blocks": blocks}
        if background.color:
            native["backgroundColor"] = background.color
        notes = pptx_rich.read_notes(slide)
        if notes:
            native["notes"] = notes
        slides.append(native)

    _fill_renders(data, slides, overlay_keep, overlay_pending, base_requests, (float(width), float(height)), (sx, sy), run_office)
    return {
        "type": "presentation_v2", "format": format_name,
        "slides": slides or [{"id": _id(), "title": "Slide 1", "blocks": []}],
    }


def _fill_renders(
    data: bytes,
    slides: list[dict[str, Any]],
    overlay_keep: dict[int, set[tuple[int, ...]]],
    overlay_pending: dict[int, list[Pending]],
    base_requests: dict[int, dict[str, Any]],
    slide_emu: tuple[float, float],
    scale: tuple[float, float],
    run_office: RunOffice,
) -> None:
    """Fill in rendered pictures; a block whose render failed is dropped, the import still succeeds."""
    canvas_px = slide_emu[0] * scale[0]
    if overlay_pending:
        try:
            white_pdf = render_overlays(data, overlay_keep, run_office, "FFFFFF")
            black_pdf = render_overlays(data, overlay_keep, run_office, "000000")
            for slide_index, pendings in overlay_pending.items():
                if slide_index >= min(white_pdf.page_count, black_pdf.page_count):
                    continue
                white_page, black_page = white_pdf[slide_index], black_pdf[slide_index]
                zoom = RENDER_ZOOM * canvas_px / white_page.rect.width
                for pending in pendings:
                    clipped = _clip(white_page, pending.bounds, slide_emu)
                    if clipped is None:
                        continue
                    clip, bounds = clipped
                    trimmed = _trimmed_png(_matte(_raster(white_page, clip, zoom), _raster(black_page, clip, zoom)), bounds)
                    if trimmed is None:
                        continue
                    blob, (x, y, w, h) = trimmed
                    pending.block.update({
                        "content": _data_url(blob, "image/png"),
                        "x": round(x * scale[0], 2), "y": round(y * scale[1], 2),
                        "width": max(1, round(w * scale[0], 2)), "height": max(1, round(h * scale[1], 2)),
                    })
            white_pdf.close()
            black_pdf.close()
        except Exception:
            logger.warning("PowerPoint overlay render failed", exc_info=True)
    if base_requests:
        try:
            pdf = render_base_layers(data, run_office)
            cache: dict[str, str] = {}
            for slide_index, block in base_requests.items():
                if slide_index >= pdf.page_count:
                    continue
                page = pdf[slide_index]
                pixmap = page.get_pixmap(matrix=fitz.Matrix(RENDER_ZOOM * canvas_px / page.rect.width, RENDER_ZOOM * canvas_px / page.rect.width), alpha=False)
                blob = pixmap.tobytes("jpeg", jpg_quality=88)
                block["content"] = cache.setdefault(hashlib.sha1(blob).hexdigest(), _data_url(blob, "image/jpeg"))
            pdf.close()
        except Exception:
            logger.warning("PowerPoint base layer render failed", exc_info=True)
    for slide in slides:
        slide["blocks"] = [block for block in slide["blocks"] if block.get("type") != "image" or block.get("content")]
