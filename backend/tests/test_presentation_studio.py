import pytest

from app.services.presentation_layouts import LAYOUTS, render_outline_slide
from app.services.presentation_quality import _painted_background, check_and_fix_slide, plain_text
from app.services.presentation_studio import apply_theme, normalize_outline, render_outline
from app.services.presentation_themes import THEMES, contrast_ratio, resolve_theme

W, H = 960, 540

SAMPLE = {
    "layout": None,
    "title": "La fotosintesi clorofilliana spiegata in modo semplice",
    "subtitle": "Come le piante trasformano la luce in energia",
    "points": ["Clorofilla: cattura la luce solare", "Acqua: arriva dalle radici", "Anidride carbonica: entra dalle foglie"],
    "points_right": ["Glucosio come riserva di energia", "Ossigeno liberato nell'aria"],
    "left_label": "Ingredienti",
    "right_label": "Prodotti",
    "stat_value": "70%",
    "stat_label": "dell'ossigeno viene dagli oceani",
    "quote": "Le piante sono le cuoche del pianeta.",
    "attribution": "Una studentessa",
    "image_prompt": "foglia al microscopio",
}


def _text_contrasts(slide):
    blocks = slide["blocks"]
    for index, block in enumerate(blocks):
        if block["type"] != "text":
            continue
        background = _painted_background(blocks, index, "#FFFFFF")
        yield block, contrast_ratio(block["style"]["color"], background)


@pytest.mark.parametrize("theme_id", [t["id"] for t in THEMES])
@pytest.mark.parametrize("layout", list(LAYOUTS))
def test_every_theme_and_layout_renders_readable_in_bounds_text(theme_id, layout):
    theme = resolve_theme(theme_id)
    slide = render_outline_slide({**SAMPLE, "layout": layout}, 3, W, H, theme)
    assert slide["blocks"], "slide must not be empty"
    for block, ratio in _text_contrasts(slide):
        assert ratio >= 3.0, f"{theme_id}/{layout}: {plain_text(block['content'])!r} contrast {ratio:.2f}"
    for block in slide["blocks"]:
        assert block["x"] >= -0.5 and block["y"] >= -0.5
        assert block["x"] + block["width"] <= W + 0.5 and block["y"] + block["height"] <= H + 0.5
    issues = check_and_fix_slide(slide, 3, W, H, theme, fix=False)
    assert not [i for i in issues if i["code"] in {"low_contrast", "degenerate_shape", "off_canvas"}], issues


def test_accent_override_keeps_text_readable():
    theme = resolve_theme("aula", {"accent": "#FFFF66"})
    assert contrast_ratio(theme["colors"]["on_accent"], "#FFFF66") >= 4.5
    assert contrast_ratio(theme["colors"]["accent_text"], theme["colors"]["background"]) >= 4.5


def test_quality_pass_fixes_white_on_white_and_drops_meaningless_shapes():
    slide = {"blocks": [
        {"id": "bg", "type": "rectangle", "x": 0, "y": 0, "width": W, "height": H, "zIndex": 0,
         "style": {"fill": "#FFFFFF", "stroke": "#FFFFFF", "strokeWidth": 0}},
        {"id": "ghost", "type": "ellipse", "x": 100, "y": 100, "width": 80, "height": 80, "zIndex": 1,
         "style": {"fill": "#FFFFFF", "strokeWidth": 0}},
        {"id": "dot", "type": "rectangle", "x": 10, "y": 10, "width": 1, "height": 1, "zIndex": 2, "style": {"fill": "#000"}},
        {"id": "t", "type": "text", "content": "Testo invisibile", "x": 50, "y": 50, "width": 400, "height": 60, "zIndex": 3,
         "style": {"color": "#FFFFFF", "fontSize": 20}},
        {"id": "far", "type": "text", "content": "Fuori", "x": 900, "y": 500, "width": 300, "height": 80, "zIndex": 4,
         "style": {"color": "#111111", "fontSize": 20}},
    ]}
    issues = check_and_fix_slide(slide, 0, W, H, resolve_theme("aula"))
    codes = {i["code"] for i in issues}
    assert {"low_contrast", "invisible_shape", "degenerate_shape", "off_canvas"} <= codes
    ids = [b["id"] for b in slide["blocks"]]
    assert "ghost" not in ids and "dot" not in ids
    text = next(b for b in slide["blocks"] if b["id"] == "t")
    assert contrast_ratio(text["style"]["color"], "#FFFFFF") >= 4.5
    far = next(b for b in slide["blocks"] if b["id"] == "far")
    assert far["x"] + far["width"] <= W and far["y"] + far["height"] <= H


def test_inline_unreadable_colour_is_stripped():
    slide = {"blocks": [{"id": "t", "type": "text", "x": 0, "y": 0, "width": 400, "height": 60, "zIndex": 0,
                         "content": '<p><span style="color: #fefefe">ciao</span></p>', "style": {"color": "#111111", "fontSize": 20}}]}
    check_and_fix_slide(slide, 0, W, H)
    assert "#fefefe" not in slide["blocks"][0]["content"]


def test_outline_normalisation_and_render_roundtrip():
    outline = normalize_outline({
        "title": "Fotosintesi",
        "recommended_templates": [{"id": "laboratorio", "reason": "scientifico"}, {"id": "inesistente"}],
        "slides": [
            {"layout": "title_bullets", "title": "Che cos'è", "points": ["a", "b", "c", "d", "e", "f", "g", "h"]},
            {"layout": "big_stat", "title": "Senza dato"},
            {"layout": "cards", "title": "Due", "points": ["X: uno", "Y: due"]},
        ],
    }, "essenziale")
    assert outline["slides"][0]["layout"] == "cover"  # cover added
    assert outline["recommended_templates"] == [{"id": "laboratorio", "reason": "scientifico"}]
    assert len(outline["slides"][1]["points"]) == 5 and "• f" in outline["slides"][1]["notes"]
    assert outline["slides"][2]["layout"] == "title_bullets"  # big_stat without a stat is coerced
    deck = render_outline(outline, "notte", {"slide_numbers": False}, W, H)
    assert len(deck["slides"]) == 4
    assert all(s["layout"] and s["content"] for s in deck["slides"])
    assert not [i for i in deck["quality"] if i["code"] == "low_contrast"]


def test_apply_theme_rerenders_generated_and_recolors_customised():
    deck = render_outline(normalize_outline({"title": "T", "slides": [
        {"layout": "cover", "title": "T"}, {"layout": "title_bullets", "title": "A", "points": ["uno", "due"]},
    ]}), "aula", {}, W, H)
    custom = deck["slides"][1]
    custom["customized"] = True
    custom["blocks"][0]["x"] = 0  # a hand-made edit must survive
    theme = resolve_theme("notte")
    slides, issues = apply_theme(deck["slides"], theme, W, H)
    assert slides[0]["blocks"][0]["style"]["fill"] == theme["colors"]["primary"] or slides[0]["blocks"][0]["style"]["fill"] == theme["colors"]["background"]
    assert slides[1]["blocks"][0]["style"]["fill"] == theme["colors"]["background"]
    assert not [i for i in issues if i["code"] == "low_contrast"]


@pytest.mark.parametrize("theme_id", [t["id"] for t in THEMES if t["brightness"] == "light"])
def test_dark_variant_is_dark_on_every_slide_and_readable(theme_id):
    theme = resolve_theme(theme_id, {"dark": True})
    assert theme["brightness"] == "dark"
    for layout in LAYOUTS:
        slide = render_outline_slide({**SAMPLE, "layout": layout}, 2, W, H, theme)
        background = slide["blocks"][0]
        assert background["style"]["fill"] == theme["colors"]["background"] and background.get("locked")
        for block, ratio in _text_contrasts(slide):
            assert ratio >= 3.0, f"{theme_id}/{layout}: {plain_text(block['content'])!r} {ratio:.2f}"


def test_every_slide_shares_the_deck_background():
    theme = resolve_theme("golinelli")
    for layout in LAYOUTS:
        slide = render_outline_slide({**SAMPLE, "layout": layout}, 2, W, H, theme)
        assert slide["blocks"][0]["style"]["fill"] == theme["colors"]["background"], layout


def test_retheme_keeps_generated_images():
    deck = render_outline(normalize_outline({"title": "T", "slides": [
        {"layout": "cover", "title": "T"}, {"layout": "image_split", "title": "A", "points": ["uno"], "image_prompt": "x"},
    ]}), "aula", {}, W, H)
    image = next(b for b in deck["slides"][1]["blocks"] if b["type"] == "image")
    image["content"] = "/uploads/generated/a.png"
    slides, _ = apply_theme(deck["slides"], resolve_theme("notte"), W, H)
    assert any(b.get("content") == "/uploads/generated/a.png" for b in slides[1]["blocks"])


def test_retheme_recolours_legacy_blocks_without_roles():
    slide = {"id": "s", "title": "x", "customized": True, "blocks": [
        {"id": "bg", "type": "rectangle", "x": 0, "y": 0, "width": W, "height": H, "zIndex": 0, "style": {"fill": "#FFFFFF"}},
        {"id": "card", "type": "rectangle", "x": 60, "y": 150, "width": 400, "height": 300, "zIndex": 1, "style": {"fill": "#F1F5F9"}},
        {"id": "t", "type": "text", "content": "<p>Titolo</p>", "x": 60, "y": 40, "width": 600, "height": 60, "zIndex": 2,
         "style": {"color": "#111111", "fontSize": 36, "fontWeight": "bold"}},
        {"id": "b", "type": "text", "content": "<p>Corpo</p>", "x": 80, "y": 200, "width": 300, "height": 60, "zIndex": 3,
         "style": {"color": "#111111", "fontSize": 18}},
    ]}
    theme = resolve_theme("notte")
    slides, issues = apply_theme([slide], theme, W, H)
    blocks = {b["id"]: b for b in slides[0]["blocks"]}
    assert blocks["bg"]["style"]["fill"] == theme["colors"]["background"]
    assert blocks["card"]["style"]["fill"] == theme["colors"]["surface"]
    assert blocks["t"]["style"]["color"] == theme["colors"]["text"] and blocks["t"]["style"]["fontFamily"] == theme["fonts"]["heading"]
    assert not [i for i in issues if i["code"] == "low_contrast"]
