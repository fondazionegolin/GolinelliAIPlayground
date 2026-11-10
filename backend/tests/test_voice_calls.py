from app.services.voice_calls import CODE_ALPHABET, generate_code, normalize_code


def test_generated_codes_are_canonical():
    for _ in range(200):
        code = generate_code()
        assert len(code) == 12 and code.count("-") == 2
        assert set(code.replace("-", "")) <= set(CODE_ALPHABET)
        assert normalize_code(code) == code


def test_normalize_accepts_spacing_case_and_links():
    assert normalize_code("KQF MXTA VBE") == "kqf-mxta-vbe"
    assert normalize_code("kqfmxtavbe") == "kqf-mxta-vbe"
    assert normalize_code("https://ai.golinelli.it/call/kqf-mxta-vbe/") == "kqf-mxta-vbe"


def test_normalize_rejects_wrong_length():
    assert normalize_code("") is None
    assert normalize_code("abc-def") is None
    assert normalize_code("kqf-mxta-vbex") is None


def test_merge_timeline_orders_speakers_and_joins_turns():
    from types import SimpleNamespace
    from app.services.call_recordings import merge_timeline

    teacher = SimpleNamespace(identity="teacher:1", speaker_name="Prof", offset_ms=0, duration_ms=60000,
                              transcript=[{"start": 0.0, "end": 4.0, "text": "Buongiorno."},
                                          {"start": 5.0, "end": 8.0, "text": "Oggi frazioni."},
                                          {"start": 30.0, "end": 33.0, "text": "Esatto."}])
    student = SimpleNamespace(identity="student:2", speaker_name="Anna", offset_ms=10000, duration_ms=60000,
                              transcript=[{"start": 5.0, "end": 9.0, "text": "Cos'è il denominatore?"}])
    lines, participants = merge_timeline([teacher, student])
    assert [(l["speaker"], l["text"]) for l in lines] == [
        ("Prof", "Buongiorno. Oggi frazioni."),
        ("Anna", "Cos'è il denominatore?"),
        ("Prof", "Esatto."),
    ]
    assert lines[1]["start"] == 15.0
    assert participants[0]["role"] == "teacher" and participants[1]["turns"] == 1


def test_hallucination_filter():
    from app.services.call_recordings import _HALLUCINATIONS
    assert _HALLUCINATIONS.search("Sottotitoli creati dalla comunità Amara.org")
    assert not _HALLUCINATIONS.search("Il numeratore sta sopra la linea")
