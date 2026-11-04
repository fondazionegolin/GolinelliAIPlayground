"""ElevenLabs audio tools. Fixed upstream, server-side key, no paid POST retries."""
import re
import httpx
from fastapi import HTTPException
from app.services import podcasts

OUTPUT_FORMATS = {"mp3_44100_128": ("audio/mpeg", "mp3"), "mp3_44100_192": ("audio/mpeg", "mp3"),
                  "wav_44100": ("audio/wav", "wav"), "opus_48000_128": ("audio/ogg", "ogg")}


def identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", value):
        raise HTTPException(422, "Identificativo voce non valido")
    return value


class UncertainGeneration(HTTPException):
    """The provider may have processed a request before the connection failed."""


async def request(method: str, path: str, **kwargs) -> httpx.Response:
    key = podcasts.api_key()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=20)) as client:
            response = await client.request(method, podcasts.BASE_URL + path, headers={"xi-api-key": key}, **kwargs)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
        raise HTTPException(503, "Impossibile connettersi a ElevenLabs. Riprova tra poco.") from exc
    except httpx.HTTPError as exc:
        raise UncertainGeneration(504, "Connessione ElevenLabs interrotta: controlla la libreria prima di ripetere una generazione.") from exc
    if response.status_code == 422:
        raise HTTPException(422, "ElevenLabs non accetta questi parametri: verifica il modello, il formato del file e i limiti del tuo piano.")
    podcasts.provider_error(response)
    return response


def audio(response: httpx.Response) -> bytes:
    if not response.content or not response.headers.get("content-type", "").startswith(("audio/", "application/octet-stream")):
        raise HTTPException(502, "ElevenLabs non ha restituito un file audio valido")
    return response.content


async def account_voices() -> list[dict]:
    result = []
    cursor = None
    for _ in range(100):
        params = {"page_size": 100}
        if cursor:
            params["next_page_token"] = cursor
        data = (await request("GET", "/v2/voices", params=params)).json()
        result.extend({"voice_id": v["voice_id"], "name": v["name"], "description": v.get("description") or "",
                       "category": v.get("category"), "preview_url": v.get("preview_url"), "labels": v.get("labels") or {}}
                      for v in data.get("voices", []))
        next_cursor = data.get("next_page_token")
        if not data.get("has_more") or not next_cursor or next_cursor == cursor:
            return result
        cursor = next_cursor
    raise HTTPException(502, "Catalogo voci troppo esteso: impossibile completare la lettura")


async def models() -> list[dict]:
    data = (await request("GET", "/v1/models")).json()
    return [{"model_id": m["model_id"], "name": m["name"], "description": m.get("description", ""),
             "tts": m.get("can_do_text_to_speech", False), "conversion": m.get("can_do_voice_conversion", False),
             "max_characters": (m.get("maximum_text_length_per_request") or m.get("max_characters_request_free_user") or 5000),
             "languages": m.get("languages", [])} for m in data]


async def visible_voices(db, teacher) -> list[dict]:
    from sqlalchemy import select
    from app.models.voice_lab import VoiceLabItem
    records = (await db.execute(select(VoiceLabItem).where(VoiceLabItem.kind == "voice"))).scalars().all()
    private = {item.provider_id: item for item in records}
    return [{**v, "owned": v["voice_id"] in private, "item_id": str(private[v["voice_id"]].id) if v["voice_id"] in private else None}
            for v in await account_voices()
            if v["voice_id"] not in private or (private[v["voice_id"]].owner_id == teacher.id and private[v["voice_id"]].tenant_id == teacher.tenant_id)]
