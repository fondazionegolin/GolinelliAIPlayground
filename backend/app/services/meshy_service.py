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
        *,
        ai_model: str = "meshy-7.1",
        model_type: str = "standard",
        geometry_resolution: str = "standard",
        should_remesh: bool = False,
        topology: str = "triangle",
        target_polycount: int = 30000,
        pose_mode: str = "",
        target_formats: Optional[list[str]] = None,
        auto_size: bool = False,
        alpha_thumbnail: bool = False,
    ) -> str:
        """Start a text-to-3D preview task. Returns the task_id."""
        if not settings.MESHY_API_KEY:
            raise ValueError("MESHY_API_KEY not configured")

        actual_model = "meshy-t2" if model_type == "smart-topology" else ai_model
        payload: dict = {
            "mode": "preview",
            "prompt": prompt,
            "model_type": model_type,
            "ai_model": actual_model,
            "geometry_resolution": geometry_resolution,
            "pose_mode": pose_mode,
            "target_formats": target_formats or ["glb", "obj", "fbx", "stl", "usdz"],
            "auto_size": auto_size,
            "alpha_thumbnail": alpha_thumbnail,
        }
        if model_type == "smart-topology":
            payload.update({"topology": "triangle", "target_polycount": min(target_polycount, 15000)})
        else:
            payload.update({"should_remesh": should_remesh})
            if should_remesh:
                payload.update({"topology": topology, "target_polycount": target_polycount})

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
        """Generate an image with OpenAI Images. Returns {image_data (base64), image_mime, revised_prompt}."""
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not configured")

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        response = await client.images.generate(
            model=settings.OPENAI_IMAGE_MODEL,
            prompt=prompt,
            size=size,  # type: ignore[arg-type]
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
        texture_prompt: Optional[str] = None,
        ai_model: str = "meshy-7.1",
        model_type: str = "standard",
        geometry_resolution: str = "standard",
        should_texture: bool = True,
        enable_pbr: bool = True,
        texture_resolution: str = "2k",
        should_remesh: bool = False,
        topology: str = "triangle",
        target_polycount: int = 30000,
        pose_mode: str = "",
        image_enhancement: bool = True,
        target_formats: Optional[list[str]] = None,
        auto_size: bool = False,
        alpha_thumbnail: bool = False,
    ) -> str:
        """Start an image-to-3D task (v1). Returns the task_id."""
        if not settings.MESHY_API_KEY:
            raise ValueError("MESHY_API_KEY not configured")

        image_url = f"data:{image_mime};base64,{image_data}"
        actual_model = "meshy-t2" if model_type == "smart-topology" else ai_model
        payload: dict = {
            "image_url": image_url,
            "model_type": model_type,
            "ai_model": actual_model,
            "geometry_resolution": geometry_resolution,
            "should_texture": should_texture,
            "pose_mode": pose_mode,
            "image_enhancement": image_enhancement,
            "target_formats": target_formats or ["glb", "obj", "fbx", "stl", "usdz"],
            "auto_size": auto_size,
            "alpha_thumbnail": alpha_thumbnail,
        }
        if should_texture:
            payload.update({"enable_pbr": enable_pbr, "texture_resolution": texture_resolution})
            if texture_prompt:
                payload["texture_prompt"] = texture_prompt
        if model_type == "smart-topology":
            payload["target_polycount"] = min(target_polycount, 15000)
        else:
            payload["should_remesh"] = should_remesh
            if should_remesh:
                payload.update({"topology": topology, "target_polycount": target_polycount})

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

    async def delete_task(self, mode: str, task_id: str) -> None:
        """Stop/remove a task on Meshy (used when the user interrupts a generation)."""
        if not settings.MESHY_API_KEY:
            return
        url = f"{MESHY_V2_URL}/text-to-3d/{task_id}" if mode == "text" else f"{MESHY_V1_URL}/image-to-3d/{task_id}"
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.delete(url, headers=self._headers())
            if resp.status_code not in (200, 204, 404):
                resp.raise_for_status()


meshy_service = MeshyService()
