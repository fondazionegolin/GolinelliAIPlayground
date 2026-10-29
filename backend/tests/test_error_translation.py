import json

from app.core import error_translation
from app.core.error_translation import translate_detail


def test_exact_and_template_messages_are_translated_only_in_english(tmp_path, monkeypatch):
    catalog = tmp_path / "en_errors.json"
    catalog.write_text(json.dumps({
        "Sessione non trovata": "Session not found",
        "Supera il limite di {} MB": "Exceeds the {} MB limit",
        "Il documento è di tipo «{}», non «{}»": "The document is a «{}», not a «{}»",
    }), encoding="utf-8")
    monkeypatch.setattr(error_translation, "CATALOG_PATH", catalog)
    error_translation._catalog.cache_clear()
    try:
        assert translate_detail("Sessione non trovata", "en") == "Session not found"
        assert translate_detail("Sessione non trovata", "it") == "Sessione non trovata"
        assert translate_detail("Supera il limite di 25 MB", "en") == "Exceeds the 25 MB limit"
        assert translate_detail("Il documento è di tipo «sheet», non «document»", "en") == "The document is a «sheet», not a «document»"
        assert translate_detail("Messaggio sconosciuto", "en") == "Messaggio sconosciuto"
    finally:
        error_translation._catalog.cache_clear()


def test_shipped_catalog_keeps_placeholders():
    data = json.loads(error_translation.CATALOG_PATH.read_text(encoding="utf-8"))
    assert data, "catalog must not be empty"
    for italian, english in data.items():
        assert italian.count("{}") == english.count("{}"), italian
