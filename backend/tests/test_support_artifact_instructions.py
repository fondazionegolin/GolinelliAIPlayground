from unittest.mock import AsyncMock

import pytest

from app.services import teacher_agent


@pytest.mark.asyncio
@pytest.mark.parametrize("provider,model", [
    ("openai", "chosen-openai"), ("anthropic", "chosen-claude"),
    ("openrouter", "mistralai/mistral-small"), ("ollama", "mistral-nemo"),
    ("deepseek", "chosen-deepseek"), ("openrouter", "qwen/chosen"),
])
async def test_every_chat_provider_receives_artifact_contract_even_with_custom_prompt(monkeypatch, provider, model):
    calls = []

    async def generate_stream(**kwargs):
        calls.append(kwargs)
        yield "<!DOCTYPE html><html><body>Pronto</body></html>"

    monkeypatch.setattr(teacher_agent.llm_service, "generate_stream", generate_stream)
    chunks = [chunk async for chunk in teacher_agent.generate_with_analytics_stream(
        [{"role": "user", "content": "Crea una pagina"}], "", provider, model,
        custom_system_prompt="Sei il mio assistente personalizzato.",
    )]
    assert "Pronto" in "".join(chunks)
    assert calls[0]["provider"] == provider and calls[0]["model"] == model
    assert teacher_agent.SUPPORT_ARTIFACT_SPEC in calls[0]["system_prompt"]
    assert "assistente personalizzato" in calls[0]["system_prompt"]


@pytest.mark.asyncio
async def test_non_streaming_support_chat_has_the_same_artifact_contract(monkeypatch):
    generate = AsyncMock(return_value=type("Response", (), {"content": "pagina"})())
    monkeypatch.setattr(teacher_agent.llm_service, "generate", generate)
    assert await teacher_agent.generate_with_analytics([], "", "openrouter", "mistralai/chosen") == "pagina"
    assert teacher_agent.SUPPORT_ARTIFACT_SPEC in generate.call_args.kwargs["system_prompt"]


@pytest.mark.asyncio
async def test_provider_timeout_becomes_a_visible_generation_error(monkeypatch):
    async def generate_stream(**kwargs):
        raise TimeoutError("provider timeout")
        yield  # pragma: no cover

    monkeypatch.setattr(teacher_agent.llm_service, "generate_stream", generate_stream)
    with pytest.raises(RuntimeError, match="5 minuti"):
        async for _ in teacher_agent.generate_with_analytics_stream([], "", "openrouter", "mistralai/chosen"):
            pass
