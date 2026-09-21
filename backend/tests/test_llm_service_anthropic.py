from types import SimpleNamespace

import pytest

from app.services.llm_service import LLMService


class _Messages:
    def __init__(self):
        self.create_kwargs = None
        self.stream_kwargs = None

    async def create(self, **kwargs):
        self.create_kwargs = kwargs
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text="Risposta diversa")],
            usage=SimpleNamespace(input_tokens=7, output_tokens=3),
        )

    def stream(self, **kwargs):
        self.stream_kwargs = kwargs
        return _StreamContext()


class _StreamContext:
    async def __aenter__(self):
        return SimpleNamespace(text_stream=self._texts())

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    @staticmethod
    async def _texts():
        for text in ("Risposta ", "streaming"):
            yield text


def _service_with_fake_anthropic():
    service = object.__new__(LLMService)
    messages = _Messages()
    service.anthropic_client = SimpleNamespace(messages=messages)
    return service, messages


@pytest.mark.asyncio
async def test_anthropic_generate_uses_sdk_v1_request_shape():
    service, messages = _service_with_fake_anthropic()

    response = await service._generate_anthropic(
        messages=[{"role": "user", "content": "Chi sei?"}],
        system_prompt="Rispondi come un personaggio.",
        model="claude-haiku-4-5-20251001",
        temperature=0.8,
        max_tokens=128,
    )

    assert response.content == "Risposta diversa"
    assert messages.create_kwargs["max_tokens"] == 128
    assert "temperature" not in messages.create_kwargs


@pytest.mark.asyncio
async def test_anthropic_stream_uses_sdk_v1_request_shape():
    service, messages = _service_with_fake_anthropic()

    chunks = [
        chunk
        async for chunk in service._stream_anthropic(
            messages=[{"role": "user", "content": "Cosa insegni?"}],
            system_prompt="Rispondi come un personaggio.",
            model="claude-haiku-4-5-20251001",
            temperature=0.8,
            max_tokens=128,
        )
    ]

    assert chunks == ["Risposta ", "streaming"]
    assert messages.stream_kwargs["max_tokens"] == 128
    assert "temperature" not in messages.stream_kwargs
