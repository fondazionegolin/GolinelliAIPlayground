from app.api.v1.endpoints.boards import _normalize_external, _sniff_image


def test_sniff_image_accepts_real_images_only():
    assert _sniff_image(b"\x89PNG\r\n\x1a\n" + b"0" * 20) == "png"
    assert _sniff_image(b"\xff\xd8\xff\xe0" + b"0" * 20) == "jpg"
    assert _sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "webp"
    assert _sniff_image(b"<svg onload=alert(1)>") is None
    assert _sniff_image(b"MZ\x90\x00") is None


def test_external_people_are_trimmed_deduplicated_and_get_ids():
    people = _normalize_external([{"name": "  Mario   Rossi "}, {"name": "mario rossi"}, {"name": ""}, {"id": "ext_1", "name": "Anna"}])
    assert [p["name"] for p in people] == ["Mario Rossi", "Anna"]
    assert people[0]["id"].startswith("ext_") and people[1]["id"] == "ext_1"
