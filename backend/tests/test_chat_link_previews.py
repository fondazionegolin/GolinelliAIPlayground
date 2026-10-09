import pytest

from app.services.web_search_service import UrlFetchResult, augment_chat_messages_with_urls, web_search_service


@pytest.mark.asyncio
async def test_link_context_reaches_followup_without_changing_history(monkeypatch):
    async def fetch(url, max_chars=12000):
        return UrlFetchResult(url=url, final_url=url, title="Articolo di prova", content="La macchina è una Nikon F3.")

    monkeypatch.setattr(web_search_service, "fetch_user_url", fetch)
    messages = [
        {"role": "user", "content": "Leggi https://example.org/articolo"},
        {"role": "assistant", "content": "Ho letto la pagina."},
        {"role": "user", "content": "Che macchina usa?"},
    ]
    augmented = await augment_chat_messages_with_urls(messages)
    assert "Nikon F3" in augmented[-1]["content"]
    assert "https://example.org/articolo" in augmented[-1]["content"]
    assert messages[-1]["content"] == "Che macchina usa?"


@pytest.mark.asyncio
async def test_no_url_skips_fetch(monkeypatch):
    async def fail(*args, **kwargs):
        raise AssertionError("URL fetch should not run")

    monkeypatch.setattr(web_search_service, "fetch_user_url", fail)
    messages = [{"role": "user", "content": "Ciao"}]
    assert await augment_chat_messages_with_urls(messages) is messages
