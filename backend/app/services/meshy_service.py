import asyncio
import base64
import logging
import httpx
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

MESHY_V1_URL = "https://api.meshy.ai/openapi/v1"
MESHY_V2_URL = "https://api.meshy.ai/openapi/v2"


class MeshyService:
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {settings.MESHY_API_KEY}"}

    async def start_text_to_3d(
        self,
        prompt: str,
        negative_prompt: str = "low quality, low resolution, ugly",
    ) -> str:
        """Start a text-to-3D preview task. Returns the task_id."""
        if not settings.MESHY_API_KEY:
            raise ValueError("MESHY_API_KEY not configured")

        # v2 preview only accepts art_style="realistic"
        payload = {
            "mode": "preview",
            "prompt": prompt,
            "art_style": "realistic",
            "negative_prompt": negative_prompt,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{MESHY_V2_URL}/text-to-3d",
                json=payload,
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get("result")
            if not task_id:
                raise ValueError(f"Unexpected Meshy response: {data}")
            return task_id

    async def get_text_to_3d_status(self, task_id: str) -> dict:
        """Poll the status of a text-to-3D task (v2)."""
        if not settings.MESHY_API_KEY:
            raise ValueError("MESHY_API_KEY not configured")

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{MESHY_V2_URL}/text-to-3d/{task_id}",
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()

    async def generate_image(
        self,
        prompt: str,
        size: str = "1024x1024",
        quality: str = "standard",
        style: str = "natural",
    ) -> dict:
        """Generate an image with DALL-E 3. Returns {image_data (base64), image_mime, revised_prompt}."""
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not configured")

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        response = await client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            size=size,  # type: ignore[arg-type]
            quality=quality,  # type: ignore[arg-type]
            n=1,
        )
        image_data = response.data[0]
        b64_json = getattr(image_data, "b64_json", None)
        if not b64_json:
            image_url = getattr(image_data, "url", None)
            if not image_url:
                raise RuntimeError("Image generation returned neither base64 data nor a URL")
            async with httpx.AsyncClient(timeout=60.0) as http_client:
                image_response = await http_client.get(image_url)
                image_response.raise_for_status()
                b64_json = base64.b64encode(image_response.content).decode("ascii")
        return {
            "image_data": b64_json,
            "image_mime": "image/png",
            "revised_prompt": getattr(image_data, "revised_prompt", None) or prompt,
        }

    async def start_image_to_3d(
        self,
        image_data: str,  # base64-encoded image (no data URI prefix)
        image_mime: str = "image/jpeg",
        enable_pbr: bool = True,
        topology: str = "quad",
        target_polycount: int = 30000,
    ) -> str:
        """Start an image-to-3D task (v1). Returns the task_id."""
        if not settings.MESHY_API_KEY:
            raise ValueError("MESHY_API_KEY not configured")

        image_url = f"data:{image_mime};base64,{image_data}"
        payload: dict = {
            "image_url": image_url,
            "enable_pbr": enable_pbr,
            "topology": topology,
            "target_polycount": target_polycount,
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{MESHY_V1_URL}/image-to-3d",
                json=payload,
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get("result")
            if not task_id:
                raise ValueError(f"Unexpected Meshy response: {data}")
            return task_id

    async def get_image_to_3d_status(self, task_id: str) -> dict:
        """Poll the status of an image-to-3D task (v1)."""
        if not settings.MESHY_API_KEY:
            raise ValueError("MESHY_API_KEY not configured")

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{MESHY_V1_URL}/image-to-3d/{task_id}",
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()


meshy_service = MeshyService()
