import pytest

from app.services import tool_router


class _Resp:
    def __init__(self, status_code, body):
        self.status_code, self._body, self.text = status_code, body, str(body)

    def json(self):
        return self._body


def _client(resp, sent=None):
    class _C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers=None, json=None):
            if sent is not None:
                sent.append(json)
            return resp
    return _C


def _answers(action, a_conf, artifact, art_conf):
    return {"answers": [
        {"type": "choice", "name": "action", "choice": action, "confidence": a_conf,
         "probabilities": [{"value": action, "probability": a_conf}, {"value": "chat", "probability": round(1 - a_conf, 3)}]},
        {"type": "choice", "name": "artifact", "choice": artifact, "confidence": art_conf,
         "probabilities": [{"value": artifact, "probability": art_conf}, {"value": "none", "probability": round(1 - art_conf, 3)}]},
    ]}


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr(tool_router.settings, "OPENAI_API_KEY", "sk-test")


def _use(monkeypatch, body, status=200, sent=None):
    monkeypatch.setattr(tool_router.httpx, "AsyncClient", _client(_Resp(status, body), sent))


HTML = [{"type": "image"}, {"type": "html_page", "detail": "v1 · Sistema solare"}]


@pytest.mark.asyncio
async def test_create_routes_to_artifact(monkeypatch):
    _use(monkeypatch, _answers("create", 0.93, "image", 0.95))
    d = await tool_router.decide_tool("disegnami un gatto astronauta")
    assert (d["tool"], d["action"], d["routed"]) == ("image", "create", True)


@pytest.mark.asyncio
async def test_edit_targets_page_not_last_image(monkeypatch):
    sent = []
    _use(monkeypatch, _answers("edit", 0.94, "html_page", 0.9), sent=sent)
    d = await tool_router.decide_tool("modificami la pagina, la voglio con un altro stile", artifacts=HTML,
                                      recent=[{"role": "assistant", "content": "![img](/x.png)"}])
    assert (d["tool"], d["action"]) == ("html_page", "edit")
    assert "- html_page — v1 · Sistema solare" in sent[0]["input"]
    assert [q["name"] for q in sent[0]["questions"]] == ["action", "artifact"]


@pytest.mark.asyncio
async def test_edit_of_missing_artifact_becomes_create_or_latest(monkeypatch):
    _use(monkeypatch, _answers("edit", 0.9, "brochure", 0.9))
    d = await tool_router.decide_tool("rendila più colorata", artifacts=HTML)
    assert (d["tool"], d["action"]) == ("html_page", "edit")  # latest existing artifact
    d = await tool_router.decide_tool("rendi la brochure più colorata", artifacts=[])
    assert (d["tool"], d["action"]) == ("brochure", "create")


@pytest.mark.asyncio
async def test_low_confidence_and_errors_fall_back_to_chat(monkeypatch):
    _use(monkeypatch, _answers("create", 0.9, "image", 0.3))
    d = await tool_router.decide_tool("parlami dei gatti nello spazio")
    assert d["tool"] == "chat" and d["top"] == "image" and d["confidence"] == 0.3 and d["routed"]
    _use(monkeypatch, {}, status=500)
    assert (await tool_router.decide_tool("fai una brochure sul museo"))["tool"] == "brochure"


@pytest.mark.asyncio
@pytest.mark.parametrize("text,artifact", [
    ("Crea una pagina interattiva sul sistema solare", "html_page"),
    ("Genera una simulazione del pendolo", "html_page"),
    ("Build an interactive page about gravity", "html_page"),
    ("Prepara un quiz sul clima", "quiz"),
    ("Crea un dataset CSV", "dataset"),
    ("Crea una dispensa sul DNA", "dispensa"),
])
async def test_explicit_artifacts_survive_missing_routing_credentials(monkeypatch, text, artifact):
    monkeypatch.setattr(tool_router.settings, "OPENAI_API_KEY", "")
    decision = await tool_router.decide_tool(text)
    assert (decision["tool"], decision["action"]) == (artifact, "create")


@pytest.mark.asyncio
async def test_router_outage_keeps_edits_anchored_to_existing_page(monkeypatch):
    _use(monkeypatch, {}, status=503)
    for text in ["Aggiungi uno slider alla pagina", "Rendila più colorata", "cambia"]:
        decision = await tool_router.decide_tool(text, artifacts=HTML)
        assert (decision["tool"], decision["action"]) == ("html_page", "edit")


@pytest.mark.asyncio
@pytest.mark.parametrize("text", [
    "Spiegami come creare una pagina HTML", "Come posso creare un quiz?",
    "Non creare una pagina interattiva", "Mostrami solo il codice HTML",
    "What is the best way to create a web page?",
])
async def test_fallback_keeps_explanations_and_code_only_requests_in_chat(monkeypatch, text):
    monkeypatch.setattr(tool_router.settings, "OPENAI_API_KEY", "")
    assert (await tool_router.decide_tool(text, artifacts=HTML))["tool"] == "chat"


@pytest.mark.asyncio
async def test_fallback_respects_allowed_artifacts_and_does_not_edit_another_type(monkeypatch):
    monkeypatch.setattr(tool_router.settings, "OPENAI_API_KEY", "")
    assert (await tool_router.decide_tool("Crea una pagina HTML", allowed=["quiz"]))["tool"] == "chat"
    decision = await tool_router.decide_tool("Modifica la pagina HTML", artifacts=[{"type": "image"}])
    assert (decision["tool"], decision["action"]) == ("html_page", "create")


@pytest.mark.asyncio
async def test_ask_about_keeps_artifact(monkeypatch):
    _use(monkeypatch, _answers("ask_about", 0.9, "html_page", 0.9))
    d = await tool_router.decide_tool("cosa fa questa pagina?", artifacts=HTML)
    assert (d["tool"], d["action"]) == ("html_page", "ask_about")


@pytest.mark.asyncio
async def test_unsure_artifact_on_edit_anchors_to_latest(monkeypatch):
    _use(monkeypatch, _answers("edit", 0.9, "image", 0.4))
    d = await tool_router.decide_tool("rendila più colorata", artifacts=HTML)
    assert (d["tool"], d["action"]) == ("html_page", "edit")


@pytest.mark.asyncio
@pytest.mark.parametrize('text', ['voglio una deep research', 'Deep research energia Italia', 'Fammi una ricerca approfondita sul clima'])
async def test_explicit_research_does_not_need_a_model_or_api_key(monkeypatch, text):
    monkeypatch.setattr(tool_router.settings, 'OPENAI_API_KEY', '')
    decision = await tool_router.decide_tool(text, allowed=['deep_research', 'podcast'])
    assert decision['tool'] == 'deep_research' and decision['action'] == 'create'


@pytest.mark.asyncio
async def test_decision_model_can_choose_research_and_respects_allowed_tools(monkeypatch):
    sent = []
    _use(monkeypatch, _answers('create', .94, 'deep_research', .95), sent=sent)
    assert (await tool_router.decide_tool('Indaga in dettaglio le nuove politiche energetiche', allowed=['deep_research']))['tool'] == 'deep_research'
    assert 'deep_research' in {a['value'] for a in sent[0]['questions'][1]['choices']}
    _use(monkeypatch, _answers('chat', .99, 'none', .99))
    assert (await tool_router.decide_tool('Cos’è la deep research?'))['tool'] == 'chat'
    assert (await tool_router.decide_tool('voglio una deep research', allowed=['image']))['tool'] == 'chat'
