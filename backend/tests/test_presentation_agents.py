import asyncio
import json
from types import SimpleNamespace

from app.services import presentation_agents as agents


def _response(content: str):
    return SimpleNamespace(content=content, prompt_tokens=10, completion_tokens=5, provider="p", model="m")


def test_split_source_respects_size_and_keeps_all_text():
    text = "\n".join(f"Paragrafo {i}. " + "parola " * 80 for i in range(60))
    sections = agents.split_source(text, size=2000)
    assert len(sections) > 3
    assert all(len(s) <= 2200 for s in sections)
    joined = " ".join(sections)
    assert "Paragrafo 0." in joined and "Paragrafo 59." in joined


def test_split_source_cuts_single_huge_paragraph():
    sections = agents.split_source("Frase lunga. " * 2000, size=3000)
    assert len(sections) > 1 and all(len(s) <= 3100 for s in sections)


def test_harmonize_plan_enforces_cover_summary_rhythm_and_image_budget():
    raw = [{"layout": "title_bullets", "title": f"T{i}", "brief": "b"} for i in range(6)]
    raw += [{"layout": "image_split", "title": f"I{i}", "brief": "b"} for i in range(5)]
    raw.append({"layout": "bogus", "title": "X", "brief": "b"})
    plan = agents.harmonize_plan(raw, "Deck", "Sub")
    assert plan[0]["layout"] == "cover"
    assert plan[-1]["layout"] in ("summary", "title_bullets")
    assert sum(s["layout"] == "image_split" for s in plan) <= agents.MAX_IMAGE_SLIDES
    run = 1
    for a, b in zip(plan, plan[1:]):
        run = run + 1 if a["layout"] == b["layout"] else 1
        assert run <= agents.MAX_SAME_LAYOUT_RUN
    assert [s["index"] for s in plan] == list(range(len(plan)))


def test_pipeline_streams_slides_and_degrades_failed_writer():
    source = "\n\n".join(f"Capitolo {i}. " + "contenuto " * 600 for i in range(6))  # long → digest path

    plan = {
        "title": "Deck", "subtitle": "s", "core_message": "m",
        "recommended_templates": [{"id": "aula", "reason": "r"}],
        "slides": [{"layout": "cover", "title": "Deck", "brief": "apertura", "sources": []}]
        + [{"layout": "title_bullets", "title": f"S{i}", "brief": f"b{i}", "sources": [f"S{i}"]} for i in range(1, 4)]
        + [{"layout": "summary", "title": "Fine", "brief": "sintesi", "sources": []}],
    }

    async def generate(prompt, system, max_tokens, temperature):
        if system == agents.READER_SYSTEM_PROMPT:
            return _response("riassunto")
        if system == agents.ARCHITECT_SYSTEM_PROMPT:
            return _response(json.dumps(plan))
        if "→ 3. " in prompt:
            return _response("not json at all")  # writer of slide 3 fails twice
        return _response(json.dumps({"title": "Titolo", "points": ["uno", "due"], "notes": "n"}))

    async def run():
        usage = agents.UsageLog()
        return usage, [e async for e in agents.run_create_pipeline(
            {"topic": "t", "source_text": source, "density": "bilanciata", "slide_count": 0}, "it", generate, usage)]

    usage, events = asyncio.run(run())
    types = [e["type"] for e in events]
    assert types[-1] == "done" and "plan" in types
    assert sum(t == "slide" for t in types) == 5
    done = events[-1]
    assert len(done["outline"]["slides"]) == 5
    assert done["degraded"] == 1
    assert done["outline"]["recommended_templates"][0]["id"] == "aula"
    assert len(usage.responses) > 6


# ── Wording-only deck edits keep formatting ─────────────────────────────────

def test_text_only_edit_patches_text_and_keeps_formatting(monkeypatch):
    from app.api.v1.endpoints import llm as llm_module

    assert llm_module._is_text_only_request("Traduci tutta la presentazione in inglese")
    assert not llm_module._is_text_only_request("Traduci e cambia i colori")

    slides = [{
        "id": "s1", "title": "Ciao", "speakerNotes": "Note", "layout": "title_bullets", "content": {"title": "Ciao"},
        "blocks": [
            {"id": "b1", "type": "text", "content": "<p>Ciao mondo</p>", "x": 40, "y": 30, "width": 400, "height": 80,
             "style": {"fontSize": 32, "color": "#123456"}, "themeRole": {"color": "text", "font": "heading"}},
            {"id": "b2", "type": "rectangle", "content": "", "x": 0, "y": 0, "width": 960, "height": 540,
             "style": {"fill": "#fff"}, "themeRole": {"fill": "background"}},
        ],
    }]

    async def fake_generate(**kwargs):
        reply = {"slides": [{"slide_id": "s1", "title": "Hello", "notes": "Notes",
                             "texts": [{"block_id": "b1", "content": "<p>Hello world</p>"}]}]}
        return _response(json.dumps(reply))

    monkeypatch.setattr(llm_module.llm_service, "generate", fake_generate)
    work, _title, responses, edited = asyncio.run(llm_module._text_only_deck_edit(
        prompt="traduci in inglese", deck_title="", slides=slides, language="it", provider="p", model="m",
        dims=(960, 540), theme=None,
    ))
    block = work[0]["blocks"][0]
    assert block["content"] == "<p>Hello world</p>"
    assert (block["x"], block["width"], block["style"]["color"], block["themeRole"]) == (40, 400, "#123456", {"color": "text", "font": "heading"})
    assert work[0]["blocks"][1]["themeRole"] == {"fill": "background"}
    assert work[0]["title"] == "Hello" and work[0]["speakerNotes"] == "Notes"
    assert work[0]["customized"] is True and edited == 1 and len(responses) == 1
    assert slides[0]["blocks"][0]["content"] == "<p>Ciao mondo</p>"  # input untouched


def test_apply_theme_survives_malformed_blocks():
    from app.services.presentation_studio import apply_theme
    from app.services.presentation_themes import resolve_theme

    slides = [{"id": "x", "title": "t", "customized": True, "blocks": [
        {"id": "a", "type": "text", "content": "x", "x": 0, "y": 0, "width": 100, "height": 40, "style": None},
        "garbage",
        {"id": "b", "type": "rectangle", "x": 0, "y": 0, "width": 960, "height": 540},
    ]}]
    result, _issues = apply_theme(slides, resolve_theme("aula"), 960, 540)
    assert len(result[0]["blocks"]) == 2


def test_deck_patch_keeps_everything_not_mentioned():
    from app.api.v1.endpoints import llm as llm_module

    original = [
        {"id": "s1", "title": "A", "backgroundColor": "#101010", "layout": "section", "content": {"title": "A"},
         "blocks": [
             {"id": "bg", "type": "rectangle", "x": 0, "y": 0, "width": 960, "height": 540, "locked": True,
              "style": {"fill": "#101010"}, "themeRole": {"fill": "background"}},
             {"id": "t", "type": "text", "content": "<p>Parte uno</p>", "x": 300, "y": 200, "width": 500, "height": 90,
              "style": {"fontSize": 40, "color": "#FFFFFF"}, "themeRole": {"color": "text", "font": "heading"}},
         ]},
        {"id": "s2", "title": "B", "blocks": [{"id": "u", "type": "text", "content": "<p>x</p>", "x": 1, "y": 1, "width": 100, "height": 40, "style": {}}]},
    ]
    patch = {"slides": [{"slide_id": "s1", "blocks": [{"id": "t", "content": "<p>Part <strong>one</strong></p>"}]}]}
    merged = llm_module._merge_deck_patch(original, patch, 960, 540, None, allow_structure=True)
    assert [s["id"] for s in merged] == ["s1", "s2"]
    s1 = merged[0]
    strip = lambda b: {k: v for k, v in b.items() if k != "zIndex"}  # the quality pass only adds a paint order
    assert s1["backgroundColor"] == "#101010" and strip(s1["blocks"][0]) == original[0]["blocks"][0]
    text = s1["blocks"][1]
    assert "<strong>one</strong>" in text["content"]
    assert (text["x"], text["style"]["color"], text["themeRole"]) == (300, "#FFFFFF", {"color": "text", "font": "heading"})
    assert {**merged[1], "blocks": [strip(b) for b in merged[1]["blocks"]]} == original[1]

    # explicit colour change drops only that theme role; subset mode ignores structure
    patch = {"slides": [{"slide_id": "s1", "blocks": [{"id": "t", "style": {"color": "#FF0000"}}]}], "delete_slide_ids": ["s2"]}
    merged = llm_module._merge_deck_patch(original, patch, 960, 540, None, allow_structure=False)
    assert len(merged) == 2
    assert merged[0]["blocks"][1]["style"]["color"] == "#FF0000" and merged[0]["blocks"][1]["themeRole"] == {"font": "heading"}
    assert llm_module._is_text_only_request("Evidenzia le parole chiave e mettile in grassetto")


def test_deck_patch_image_prompts_become_generation_slots():
    from app.api.v1.endpoints import llm as llm_module

    original = [{"id": "s1", "title": "Cellula", "blocks": [
        {"id": "t", "type": "text", "content": "<p>La cellula</p>", "x": 40, "y": 40, "width": 880, "height": 400, "style": {}},
        {"id": "img", "type": "image", "content": "/uploads/generated/old.png", "x": 600, "y": 300, "width": 300, "height": 200, "style": {}},
    ]}]
    patch = {"slides": [{"slide_id": "s1", "blocks": [
        {"id": "t", "width": 500},
        {"id": "img", "image_prompt": "mitocondrio in sezione"},
        {"id": "", "type": "image", "content": "", "image_prompt": "nucleo cellulare", "x": 560, "y": 40, "width": 360, "height": 240},
    ]}]}
    merged = llm_module._merge_deck_patch(original, patch, 960, 540, None, allow_structure=True)
    blocks = {b["id"]: b for b in merged[0]["blocks"]}
    assert blocks["t"]["width"] == 500
    assert "placehold.co" in blocks["img"]["content"] and blocks["img"]["imagePrompt"] == "mitocondrio in sezione"
    fresh = [b for b in merged[0]["blocks"] if b["id"] not in {"t", "img"}]
    assert len(fresh) == 1 and "placehold.co" in fresh[0]["content"] and fresh[0]["imagePrompt"] == "nucleo cellulare"


def test_content_render_keeps_pictures_unless_prompt_changes():
    from app.api.v1.endpoints import llm as llm_module

    original = {"id": "s1", "title": "Cellula", "content": {"image_prompt": "cellula animale"},
                "blocks": [{"id": "i", "type": "image", "content": "/uploads/generated/a.png"}]}
    same = {"blocks": [{"type": "image", "content": "https://placehold.co/1x1", "imagePrompt": "cellula animale"}]}
    llm_module._keep_existing_slide_images(same, original)
    assert same["blocks"][0]["content"] == "/uploads/generated/a.png"
    changed = {"blocks": [{"type": "image", "content": "https://placehold.co/1x1", "imagePrompt": "cellula vegetale"}]}
    llm_module._keep_existing_slide_images(changed, original)
    assert "placehold.co" in changed["blocks"][0]["content"]


def test_slide_image_source_never_leaves_uploads():
    from app.api.v1.endpoints import llm as llm_module

    assert llm_module._slide_image_source_b64("data:image/png;base64,QUJD") == "QUJD"
    assert llm_module._slide_image_source_b64("/uploads/../../etc/passwd") is None
    assert llm_module._slide_image_source_b64("https://example.com/cat.png") is None


def test_long_markdown_partition_is_lossless_and_keeps_tail():
    source = ('# Capitolo\n\n- Un punto.\n\n**Note docente:** dettaglio\n\n' * 12000) + '# CONCLUSIONE'
    sections = agents.split_source(source)
    assert ''.join(sections) == source
    assert len(sections) <= agents.MAX_SECTIONS
    assert sections[-1].endswith('# CONCLUSIONE')


def test_json_retry_gives_incomplete_response_more_output_space():
    budgets = []

    async def generate(prompt, system, max_tokens, temperature):
        budgets.append(max_tokens)
        return _response('{"slides": [' if len(budgets) == 1 else '{"slides": []}')

    result = asyncio.run(agents._json_call(generate, agents.UsageLog(), 'prompt', 'system', 6000))
    assert result == {'slides': []}
    assert budgets == [6000, 12000]


def test_invalid_architect_recovers_with_all_source_sections():
    source = '\n\n'.join(f'# [SLIDE S{i}] Tema {i}\n' + 'contenuto ' * 550 for i in range(18))
    read = []
    writer_prompts = []

    async def generate(prompt, system, max_tokens, temperature):
        if system == agents.READER_SYSTEM_PROMPT:
            read.append(prompt)
            return _response('Riassunto dei contenuti. Note docente riservate.')
        if system == agents.ARCHITECT_SYSTEM_PROMPT:
            return _response('{"title":"Deck","slides":[')
        writer_prompts.append(prompt)
        return _response(json.dumps({'title': 'Tema XR', 'points': ['Un punto'], 'notes': 'Dettagli docente'}))

    async def run():
        return [event async for event in agents.run_create_pipeline(
            {'topic': 'XR', 'source_text': source, 'slide_count': 20}, 'it', generate, agents.UsageLog())]

    events = asyncio.run(run())
    assert len(read) == len(agents.split_source(source))
    assert events[-1]['type'] == 'done' and events[-1]['recovered_plan']
    assert len(events[-1]['outline']['slides']) == 20
    assert 'Tema 17' in '\n'.join(writer_prompts)
    assert events[-1]['degraded'] == 0


def test_normalize_keeps_large_deck():
    result = agents.studio.normalize_outline({'title': 'XR', 'slides': [
        {'layout': 'cover' if i == 0 else 'title_bullets', 'title': f'Slide {i}', 'points': ['Contenuto']} for i in range(60)
    ]}, 'bilanciata')
    assert len(result['slides']) == 60
