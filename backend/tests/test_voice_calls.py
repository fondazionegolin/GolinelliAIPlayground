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
