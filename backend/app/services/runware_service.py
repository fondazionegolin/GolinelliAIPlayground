"""Thin async client for the Runware inference API (https://runware.ai/docs).

Every request is a JSON array of task objects posted to one endpoint. Images come back inline;
videos run asynchronously (`deliveryMethod: async`) and are polled with `getResponse`.
"""
import asyncio
import logging
import time
import uuid
from typing import Any, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RUNWARE_URL = "https://api.runware.ai/v1"


class RunwareError(RuntimeError):
    pass


def _first_error(payload: dict) -> Optional[str]:
    errors = payload.get("errors") or ([payload["error"]] if payload.get("error") else [])
    if not errors:
        return None
    e = errors[0]
    if isinstance(e, dict):
        return f"{e.get('code', 'error')}: {e.get('message', e)}"
    return str(e)


class RunwareService:
    @property
    def configured(self) -> bool:
        return bool(settings.RUNWARE_API_KEY)

    def _headers(self) -> dict:
        if not settings.RUNWARE_API_KEY:
            raise RunwareError("RUNWARE_API_KEY non configurata")
        return {"Authorization": f"Bearer {settings.RUNWARE_API_KEY}", "Content-Type": "application/json"}

    async def _post(self, tasks: list[dict], timeout: float = 120.0) -> dict:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(RUNWARE_URL, json=tasks, headers=self._headers())
        try:
            payload = resp.json()
        except Exception:
            raise RunwareError(f"Risposta non valida da Runware (HTTP {resp.status_code})")
        err = _first_error(payload)
        if err:
            raise RunwareError(err)
        if resp.status_code >= 400:
            raise RunwareError(f"HTTP {resp.status_code}")
        return payload

    async def generate_image(
        self,
        prompt: str,
        width: int,
        height: int,
        reference_uuids: Optional[list[str]] = None,
        model: Optional[str] = None,
    ) -> dict:
        """Returns {uuid, url, cost}."""
        task: dict[str, Any] = {
            "taskType": "imageInference",
            "taskUUID": str(uuid.uuid4()),
            "model": model or settings.RUNWARE_IMAGE_MODEL,
            "positivePrompt": prompt,
            "width": width,
            "height": height,
            "outputType": "URL",
            "outputFormat": "JPG",
            "includeCost": True,
        }
        if reference_uuids:
            task["inputs"] = {"referenceImages": reference_uuids[:14]}
        payload = await self._post([task])
        data = (payload.get("data") or [None])[0]
        if not data or not data.get("imageURL"):
            raise RunwareError("Nessuna immagine restituita")
        return {"uuid": data.get("imageUUID"), "url": data["imageURL"], "cost": float(data.get("cost") or 0)}

    async def generate_video(
        self,
        prompt: str,
        first_frame_uuid: str,
        duration: int = 5,
        resolution: str = "720p",
        model: Optional[str] = None,
        poll_timeout: float = 600.0,
    ) -> dict:
        """Image-to-video from a first frame. Returns {url, cost}."""
        task_uuid = str(uuid.uuid4())
        task: dict[str, Any] = {
            "taskType": "videoInference",
            "taskUUID": task_uuid,
            "model": model or settings.RUNWARE_VIDEO_MODEL,
            "positivePrompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "outputType": "URL",
            "outputFormat": "MP4",
            "deliveryMethod": "async",
            "includeCost": True,
            "inputs": {"frameImages": [{"image": first_frame_uuid, "frame": "first"}]},
        }
        ack = await self._post([task])
        # Some models answer synchronously despite deliveryMethod=async.
        for item in ack.get("data") or []:
            if item.get("videoURL"):
                return {"url": item["videoURL"], "cost": float(item.get("cost") or 0)}

        started = time.monotonic()
        delay = 5.0
        while time.monotonic() - started < poll_timeout:
            await asyncio.sleep(delay)
            delay = min(delay * 1.4, 15.0)
            payload = await self._post([{"taskType": "getResponse", "taskUUID": task_uuid}], timeout=60.0)
            for item in payload.get("data") or []:
                if item.get("taskUUID") != task_uuid:
                    continue
                status = item.get("status")
                if status == "success" and item.get("videoURL"):
                    return {"url": item["videoURL"], "cost": float(item.get("cost") or 0)}
                if status == "error":
                    raise RunwareError(str(item.get("message") or item.get("code") or "errore video"))
        raise RunwareError("Timeout generazione video")

    async def download(self, url: str) -> bytes:
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content


runware_service = RunwareService()
