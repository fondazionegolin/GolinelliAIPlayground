import base64
import io
import json

from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from app.services.document_conversion import export_document
from app.services.presentation_assets import icon_for
from app.services.presentation_studio import apply_theme, normalize_outline, render_outline, slide_image_prompt
from app.services.presentation_themes import resolve_theme


def _export(slide):
    result = export_document(json.dumps({"format": "16:9", "slides": [slide]}), "Deck", "pptx")
    return Presentation(io.BytesIO(result.content)).slides[0]


def test_title_placeholder_stays_above_background_and_preserves_rich_text():
    slide = _export({"title": "Un titolo", "speakerNotes": "Note del relatore", "blocks": [
        {"id": "bg", "type": "rectangle", "x": 0, "y": 0, "width": 960, "height": 540,
         "style": {"fill": "#fff", "strokeWidth": 0}},
        {"id": "title", "type": "text", "content": '<p style="font-style:italic">Un titolo</p>',
         "x": 60, "y": 40, "width": 800, "height": 90, "style": {"fontSize": 40, "fontFamily": "Georgia", "lineHeight": 1.1}},
        {"id": "hidden", "type": "text", "hidden": True, "content": "Nascosto", "style": {}},
    ]})
    assert len(slide.shapes) == 2
    assert slide.shapes[1] == slide.shapes.title
    assert slide.shapes.title.text == "Un titolo"
    paragraph = slide.shapes.title.text_frame.paragraphs[0]
    assert paragraph.runs[0].font.italic
    assert paragraph.runs[0].font.name == "Georgia"
    assert abs(paragraph.line_spacing.pt - 44) < 0.1
    assert "Note del relatore" in slide.notes_slide.notes_text_frame.text


def test_mixed_explicit_and_implicit_layers_follow_the_presenter_order():
    slide = _export({"title": "Metadata", "blocks": [
        {"id": "t", "type": "text", "content": "Sopra", "x": 20, "y": 20, "width": 200, "height": 80, "zIndex": 5, "style": {}},
        {"id": "bg", "type": "rectangle", "x": 0, "y": 0, "width": 960, "height": 540, "style": {"fill": "#fff"}},
    ]})
    assert slide.shapes[1].text == "Sopra"


def test_image_corners_and_alpha_survive_office_export():
    output = io.BytesIO()
    Image.new("RGBA", (100, 100), (255, 0, 0, 128)).save(output, "PNG")
    slide = _export({"title": "Foto", "blocks": [{"type": "image", "content": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
                    "x": 20, "y": 20, "width": 100, "height": 100, "style": {"borderRadius": 20}}]})
    image = Image.open(io.BytesIO(slide.shapes[0].image.blob))
    assert image.getpixel((0, 0))[3] == 0
    assert image.getpixel((100, 100))[3] == 128


def test_new_layouts_export_embedded_assets_and_keep_images_on_retheme():
    outline = normalize_outline({"title": "T", "slides": [
        {"layout": "cover", "title": "T"},
        {"layout": "icon_cards", "title": "Concetti", "points": ["Natura: ecosistemi", "Ricerca: esperimenti"], "icons": ["leaf", "flask"]},
        {"layout": "editorial", "title": "Una domanda", "points": ["Osservare: partire dalle cose reali"]},
        {"layout": "image_full", "title": "Un paesaggio", "subtitle": "Osservare il territorio", "image_prompt": "bosco"},
    ]})
    deck = render_outline(outline, "aula", {}, 960, 540)
    icon_slide = _export(deck["slides"][1])
    assert sum(s.shape_type == MSO_SHAPE_TYPE.PICTURE for s in icon_slide.shapes) == 2
    paper_slide = _export(deck["slides"][2])
    assert any(s.shape_type == MSO_SHAPE_TYPE.PICTURE for s in paper_slide.shapes)
    assert any(r.font.italic and r.font.name == "Georgia" for s in paper_slide.shapes if s.has_text_frame for p in s.text_frame.paragraphs for r in p.runs)
    photo = next(b for b in deck["slides"][3]["blocks"] if b["type"] == "image")
    photo["content"] = "/uploads/photo.png"
    themed, _ = apply_theme(deck["slides"], resolve_theme("notte"), 960, 540)
    assert next(b for b in themed[3]["blocks"] if b["type"] == "image")["content"] == "/uploads/photo.png"
    assert [b["content"] for b in themed[1]["blocks"] if b["type"] == "image"] != [b["content"] for b in deck["slides"][1]["blocks"] if b["type"] == "image"]
    assert icon_for("fotosintesi") == "leaf"
    prompt = slide_image_prompt(photo["imagePrompt"], "T", "Paesaggio", resolve_theme("aula"))
    assert "Fotografia editoriale" in prompt and "illustrazione editoriale moderna" not in prompt


def test_heading_html_and_paragraph_styles_are_exported_as_text():
    slide = _export({"title": "Metadati", "blocks": [{"type": "text", "content": '<h2 style="color:#123456;font-style:italic">Capitolo</h2><p style="font-weight:bold">Testo</p>',
                    "x": 20, "y": 20, "width": 600, "height": 300, "style": {"fontSize": 24}}]})
    text = slide.shapes[0]
    assert text.text == "Capitolo\nTesto"
    assert text.text_frame.paragraphs[0].runs[0].font.italic
    assert text.text_frame.paragraphs[1].runs[0].font.bold


def test_axis_aligned_dividers_remain_straight_in_export():
    slide = _export({"blocks": [
        {"type": "line", "x": 30, "y": 30, "width": 0, "height": 200, "style": {"stroke": "#333", "strokeWidth": 1}},
        {"type": "line", "x": 40, "y": 40, "width": 200, "height": 0, "style": {"stroke": "#333", "strokeWidth": 1}},
    ]})
    assert slide.shapes[0].width == 0
    assert slide.shapes[1].height == 0


def test_adding_a_photo_does_not_replace_icons_or_paper():
    from app.api.v1.endpoints.llm import _has_real_image, _place_image_placeholder
    slide = {"title": "Osservare", "blocks": [
        {"id": "paper", "type": "image", "assetRole": "paper", "content": "data:image/png;base64,paper", "width": 960, "height": 540},
        {"id": "icon", "type": "image", "assetRole": "icon", "content": "data:image/png;base64,icon", "x": 50, "y": 80, "width": 36, "height": 36},
    ]}
    assert not _has_real_image(slide)
    assert _place_image_placeholder(slide, "Un bosco", 960, 540)
    assert slide["blocks"][0]["content"].endswith("paper")
    assert slide["blocks"][1]["content"].endswith("icon")
    assert len(slide["blocks"]) == 3
