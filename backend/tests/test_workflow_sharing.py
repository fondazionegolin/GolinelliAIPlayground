from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.v1.endpoints.agentic_sharing import _app_payload, _blocked_nodes, _strip


def _workflow(nodes):
    return SimpleNamespace(
        id="w1", title="T", graph_json={"nodes": nodes, "edges": [{"from": "a", "to": "b", "sourcePort": "x"}]},
        updated_at=datetime.now(timezone.utc),
    )


def test_blocked_nodes_lists_private_data_nodes():
    wf = _workflow([{"id": "chatbot.say", "instanceId": "a"}, {"id": "platform.files", "instanceId": "b"}, {"id": "data.saved_dataset", "instanceId": "c"}])
    assert _blocked_nodes(wf) == ["platform.files"]
    assert _blocked_nodes(_workflow([{"id": "llm_chatbot", "instanceId": "a"}])) == []


def test_public_payload_never_exposes_prompts_or_keys():
    wf = _workflow([{"id": "llm_chatbot", "instanceId": "a", "config": {"system_prompt": "SEGRETO", "model": "x", "message": "ciao"}},
                    {"id": "chatbot.ask", "instanceId": "b", "config": {"question": "Nome?"}}])
    payload = _app_payload(wf, "Docente")
    assert payload["chat"] is True
    assert payload["graph"]["nodes"][0]["config"] == {"message": "ciao"}
    assert payload["graph"]["nodes"][1]["config"] == {"question": "Nome?"}
    assert "SEGRETO" not in str(payload)


def test_strip_removes_prompts_recursively():
    assert _strip({"history": [{"role": "user", "content": "x", "system_prompt": "s"}], "prompt": "p", "ok": 1}) == {"history": [{"role": "user", "content": "x"}], "ok": 1}
