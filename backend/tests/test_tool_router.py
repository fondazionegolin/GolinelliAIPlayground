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
    assert (await tool_router.decide_tool("fai una brochure sul museo"))["tool"] == "chat"


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
