import copy

from app.services.presentation_styles import apply_style, describe_style, normalize_style
from app.services.presentation_themes import contrast_ratio

W, H = 960, 540


def deck(with_rect: bool = False):
    blocks = []
    if with_rect:
        blocks.append({"id": "bg", "type": "rectangle", "x": 0, "y": 0, "width": W, "height": H, "locked": True,
                       "themeRole": {"fill": "background"}, "style": {"fill": "#FFFFFF"}})
    blocks += [
        {"id": "t", "type": "text", "content": '<p style="color:#ffffff;font-size:20px">Titolo</p>', "x": 60, "y": 36, "width": 840, "height": 80,
         "style": {"fontSize": 40, "fontWeight": "bold", "color": "#1a1a2e"}},
        {"id": "b", "type": "text", "content": "<p>Corpo</p>", "x": 60, "y": 140, "width": 840, "height": 300,
         "style": {"fontSize": 24, "color": "#2d2d2d"}},
    ]
    return [{"id": "s1", "title": "A", "blocks": blocks}, {"id": "s2", "title": "B", "blocks": copy.deepcopy(blocks)}]


def test_normalize_drops_garbage_and_clamps():
    style = normalize_style({"background": "white", "title": {"font": "Playfair Display", "size": 999, "color": "nope"},
                             "body": {"fontFamily": "x; drop table", "fontSize": 3}, "accent": "#abc"})
    assert style["background"] == "#FFFFFF"
    assert style["title"] == {"fontFamily": "'Playfair Display', Inter, Arial, sans-serif", "fontSize": 140}
    assert style["body"] == {"fontSize": 10}
    assert style["accent"] == "#AABBCC"
    assert normalize_style({"background": "bogus"}) == {}


def test_white_background_sets_slide_property_without_adding_shapes():
    slides, changed = apply_style(deck(), {"background": "#FFFFFF"}, W, H)
    assert changed == 2
    assert all(s["backgroundColor"] == "#FFFFFF" for s in slides)
    assert all(len(s["blocks"]) == 2 for s in slides)  # no covering rectangles


def test_background_updates_full_slide_rect_and_detaches_theme_role():
    slides, _ = apply_style(deck(with_rect=True), {"background": "#0F172A"}, W, H)
    rect = slides[0]["blocks"][0]
    assert rect["style"]["fill"] == "#0F172A" and "themeRole" not in rect


def test_dark_background_makes_dark_text_readable():
    slides, _ = apply_style(deck(), {"background": "#0F172A"}, W, H)
    for block in slides[0]["blocks"]:
        assert contrast_ratio(block["style"]["color"], "#0F172A") >= 4.5


def test_title_and_body_styles_target_the_right_blocks_and_strip_inline_overrides():
    slides, _ = apply_style(deck(), {"title": {"fontFamily": "Georgia", "fontSize": 52, "color": "#112233"}, "body": {"fontSize": 28}}, W, H, slide_ids=["s1"])
    title, body = slides[0]["blocks"]
    assert title["style"]["fontSize"] == 52 and title["style"]["color"] == "#112233" and "Georgia" in title["style"]["fontFamily"]
    assert "style=" not in title["content"]
    assert body["style"]["fontSize"] == 28 and body["style"]["color"] == "#2d2d2d"
    assert slides[1]["blocks"][0]["style"]["fontSize"] == 40  # other slide untouched


def test_input_is_not_mutated_and_describe_is_readable():
    original = deck()
    snapshot = copy.deepcopy(original)
    apply_style(original, {"background": "#000000"}, W, H)
    assert original == snapshot
    assert "sfondo #FFFFFF" in describe_style({"background": "#FFFFFF"})


def test_sizes_scale_proportionally_and_small_text_is_left_alone():
    from app.services.presentation_layouts import render_outline_slide
    from app.services.presentation_themes import resolve_theme

    theme = resolve_theme("aula")
    slide = render_outline_slide({"layout": "cards", "title": "Carte", "points": ["a: x", "b: y", "c: z"]}, 1, 960, 540, theme)
    before = {b["id"]: dict(b["style"]) for b in slide["blocks"] if b["type"] == "text"}
    out, _ = apply_style([slide], {"title": {"fontSize": 48, "color": "#C2410C"}, "body": {"fontSize": 30, "color": "#0F766E"}}, 960, 540, theme)
    for block in out[0]["blocks"]:
        if block["type"] != "text":
            continue
        old = before[block["id"]]
        if old["fontSize"] <= 14:
            assert block["style"]["fontSize"] == old["fontSize"] and block["style"]["color"] == old["color"]
        elif old["fontSize"] >= 30:
            assert block["style"]["fontSize"] == 48 and block["style"]["color"] == "#C2410C"
        else:
            assert block["style"]["color"] == "#0F766E"
    sizes = sorted({b["style"]["fontSize"] for b in out[0]["blocks"] if b["type"] == "text" and before[b["id"]]["fontSize"] > 14 and before[b["id"]]["fontSize"] < 30})
    assert sizes and sizes[-1] > sizes[0]  # card labels and card text keep their hierarchy (overflow pass may shrink small boxes)
