import base64
import io

from PIL import Image, ImageDraw

from app.services.visual_comprehension import Box, Grounding
from app.services.visual_snap import decode, snap_box, snap_grounding


def data_url(img):
    out = io.BytesIO(); img.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def ui():
    """A toolbar with a blue button at (200,40)-(320,80), a search field and a long divider line."""
    img = Image.new("RGB", (800, 500), "#f4f5f7")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((200, 40, 320, 80), 8, fill="#3e63dd")
    d.text((225, 52), "Salva", fill="white")
    d.rectangle((400, 40, 700, 80), outline="#9aa1ad", width=2, fill="white")
    d.line((0, 120, 800, 120), fill="#333", width=3)
    d.text((60, 200), "4 7 8", fill="black")
    return img


def percent(x0, y0, x1, y1, w=800, h=500):
    return Box(x=x0 / w * 100, y=y0 / h * 100, width=(x1 - x0) / w * 100, height=(y1 - y0) / h * 100)


def close(box, expected, tol=1.2):
    return all(abs(getattr(box, k) - getattr(expected, k)) <= tol for k in ("x", "y", "width", "height"))


def test_an_offset_estimate_snaps_onto_the_button():
    pixels = decode(data_url(ui()))
    guess = percent(185, 30, 300, 75)  # shifted up-left and too small
    snapped = snap_box(pixels, guess)
    assert snapped and close(snapped, percent(200, 40, 321, 81))


def test_a_line_running_through_the_window_is_not_mistaken_for_the_element():
    pixels = decode(data_url(ui()))
    assert snap_box(pixels, percent(380, 110, 420, 130)) is None


def test_empty_background_gives_no_snap():
    pixels = decode(data_url(ui()))
    assert snap_box(pixels, percent(100, 300, 160, 340)) is None


def test_only_readable_regions_are_snapped():
    regions = [{"id": "save", "label": "Salva", "text": "Salva", "box": percent(185, 30, 300, 75).model_dump(), "confidence": "high"},
               {"id": "vertex", "label": "Vertice", "text": "", "box": percent(185, 30, 300, 75).model_dump(), "confidence": "high"}]
    g = snap_grounding(data_url(ui()), Grounding(subject="UI", overview="toolbar", regions=regions))
    assert close(g.regions[0].box, percent(200, 40, 321, 81)) and g.regions[1].box == Grounding(subject="x", overview="x", regions=regions).regions[1].box


def sines():
    """A blue fast sine and a red slow sine crossing a black axis, like a textbook figure."""
    import math
    img = Image.new("RGB", (800, 500), "white")
    d = ImageDraw.Draw(img)
    d.line((0, 250, 800, 250), fill="black", width=2)
    d.line([(x, 250 - 120 * math.sin(x / 40)) for x in range(800)], fill=(80, 90, 230), width=3)
    d.line([(x, 250 - 120 * math.sin(x / 160)) for x in range(800)], fill=(230, 60, 80), width=3)
    return img


def scene_with_pin(point, text="Equazione blu"):
    from app.services.visual_blackboard import DrawingScene
    return DrawingScene.model_validate({"title": "t", "layout": "overlay", "steps": ["s"], "points": [point],
        "elements": [{"id": "c", "kind": "callout", "space": "image", "target": point["id"], "text": text}]})


def test_a_pin_named_after_a_colour_lands_on_that_curve():
    import math
    from app.services.visual_snap import snap_pins
    g = Grounding(subject="x", overview="x", regions=[])
    # floating above the blue curve near its crest at x=63 (sin(63/40) ≈ 1 -> y ≈ 130)
    scene = snap_pins(data_url(sines()), scene_with_pin({"id": "p", "kind": "xy", "x": 63 / 8, "y": 22}), g)
    p = scene.points[0]
    x, y = p.x * 8, p.y * 5
    assert abs(y - (250 - 120 * math.sin(x / 40))) < 4  # on the blue curve, not on the red one


def test_region_pins_use_the_colour_in_the_region_name():
    from app.services.visual_snap import snap_pins
    g = Grounding(subject="x", overview="x", regions=[{"id": "red", "label": "Curva rossa", "box": {"x": 30, "y": 20, "width": 40, "height": 40}, "confidence": "high"}])
    scene = snap_pins(data_url(sines()), scene_with_pin({"id": "p", "kind": "region", "region": "red", "at": "center"}, "lenta"), g)
    p = scene.points[0]
    r, gg, b = sines().getpixel((int(p.x * 8), int(p.y * 5)))
    assert p.kind == "xy" and r > b  # landed on red ink


def test_points_shared_with_other_marks_are_left_alone():
    from app.services.visual_blackboard import DrawingScene
    from app.services.visual_snap import snap_pins
    scene = DrawingScene.model_validate({"title": "t", "layout": "overlay", "steps": ["s"], "points": [{"id": "p", "kind": "xy", "x": 8, "y": 22}, {"id": "q", "kind": "xy", "x": 50, "y": 50}],
        "elements": [{"id": "c", "kind": "callout", "space": "image", "target": "p", "text": "blu"}, {"id": "a", "kind": "arrow", "space": "image", "anchors": ["q", "p"]}]})
    assert snap_pins(data_url(sines()), scene, Grounding(subject="x", overview="x", regions=[])).points[0].x == 8


def test_dominant_ink_is_the_saturated_colour_of_the_region():
    from app.services.visual_snap import dominant_ink
    img = Image.new("RGB", (200, 200), "white")
    ImageDraw.Draw(img).line((0, 100, 200, 120), fill=(220, 40, 60), width=4)
    r, g, b = dominant_ink(decode(data_url(img)), Box(x=0, y=0, width=100, height=100))
    assert r > 150 and b < 120
