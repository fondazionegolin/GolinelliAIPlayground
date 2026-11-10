from app.api.v1.endpoints import llm


def test_image_requests_are_recognised():
    assert llm._is_image_placeholder_request("Genera un'immagine per ogni slide")
    assert llm._is_image_placeholder_request("aggiungi immagini a tutte le slide")
    assert not llm._is_image_placeholder_request("togli le immagini")
    assert not llm._is_image_placeholder_request("crea una nuova slide con un'immagine")
    assert not llm._is_image_placeholder_request("correggi gli errori")


def _slide():
    return {"id": "s1", "title": "Fotosintesi", "blocks": [
        {"id": "bg", "type": "rectangle", "x": 0, "y": 0, "width": 960, "height": 540, "locked": True, "style": {}},
        {"id": "t", "type": "text", "content": "<h1>Fotosintesi</h1>", "x": 60, "y": 30, "width": 840, "height": 80, "style": {}},
        {"id": "b", "type": "text", "content": "<p>Luce, acqua, CO2</p>", "x": 60, "y": 140, "width": 840, "height": 300, "style": {}},
    ]}


def test_placeholder_makes_room_on_the_right():
    slide = _slide()
    assert llm._place_image_placeholder(slide, "Una foglia al sole", 960, 540)
    image = slide["blocks"][-1]
    body = next(b for b in slide["blocks"] if b["id"] == "b")
    assert image["type"] == "image" and image["imagePrompt"] == "Una foglia al sole" and "placehold.co" in image["content"]
    assert body["x"] + body["width"] <= image["x"]
    assert next(b for b in slide["blocks"] if b["id"] == "bg")["width"] == 960  # background untouched


def test_real_pictures_are_kept_unless_replacing():
    slide = _slide()
    slide["blocks"].append({"id": "img", "type": "image", "content": "/uploads/a.png", "x": 500, "y": 140, "width": 400, "height": 300, "style": {}})
    assert not llm._place_image_placeholder(slide, "nuova", 960, 540)
    assert slide["blocks"][-1]["content"] == "/uploads/a.png"
    assert llm._place_image_placeholder(slide, "nuova", 960, 540, replace=True)
    assert slide["blocks"][-1]["imagePrompt"] == "nuova" and "placehold.co" in slide["blocks"][-1]["content"]
