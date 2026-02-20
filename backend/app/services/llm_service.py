from typing import Optional, AsyncGenerator
from dataclasses import dataclass
import httpx
import base64
import uuid
import aiofiles
from pathlib import Path
import logging
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class LLMResponse:
    content: str
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    confidence_score: Optional[float] = None


class LLMService:
    def __init__(self):
        self.openai_client = None
        self.anthropic_client = None
        self.deepseek_client = None
        
        if settings.OPENAI_API_KEY:
            self.openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        if settings.ANTHROPIC_API_KEY:
            self.anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

        if settings.DEEPSEEK_API_KEY:
            self.deepseek_client = AsyncOpenAI(
                api_key=settings.DEEPSEEK_API_KEY,
                base_url=settings.DEEPSEEK_BASE_URL,
            )
    
    async def generate(
        self,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> LLMResponse:
        provider = provider or settings.DEFAULT_LLM_PROVIDER
        model = model or settings.DEFAULT_LLM_MODEL
        
        if provider == "openai":
            return await self._generate_openai(messages, system_prompt, model, temperature, max_tokens)
        elif provider == "anthropic":
            return await self._generate_anthropic(messages, system_prompt, model, temperature, max_tokens)
        elif provider == "deepseek":
            return await self._generate_deepseek(messages, system_prompt, model, temperature, max_tokens)
        elif provider == "ollama":
            return await self._generate_ollama(messages, system_prompt, model, temperature, max_tokens)
        else:
            raise ValueError(f"Unknown provider: {provider}")
    
    async def _generate_openai(
        self,
        messages: list[dict],
        system_prompt: Optional[str],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> LLMResponse:
        if not self.openai_client:
            raise RuntimeError("OpenAI client not configured")
        
        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        formatted_messages.extend(messages)
        
        # GPT-5 and o-series models require max_completion_tokens and don't support custom temperature
        if model.startswith("gpt-5") or model.startswith("o1") or model.startswith("o3"):
            response = await self.openai_client.chat.completions.create(
                model=model,
                messages=formatted_messages,
                max_completion_tokens=max_tokens,
            )
        else:
            response = await self.openai_client.chat.completions.create(
                model=model,
                messages=formatted_messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        
        return LLMResponse(
            content=response.choices[0].message.content,
            provider="openai",
            model=model,
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
        )
    
    async def _generate_anthropic(
        self,
        messages: list[dict],
        system_prompt: Optional[str],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> LLMResponse:
        if not self.anthropic_client:
            raise RuntimeError("Anthropic client not configured")
        
        response = await self.anthropic_client.messages.create(
            model=model,
            system=system_prompt or "",
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        
        return LLMResponse(
            content=response.content[0].text,
            provider="anthropic",
            model=model,
            prompt_tokens=response.usage.input_tokens,
            completion_tokens=response.usage.output_tokens,
        )
    
    async def _generate_ollama(
        self,
        messages: list[dict],
        system_prompt: Optional[str],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> LLMResponse:
        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        formatted_messages.extend(messages)

        resolved_model = await self._resolve_ollama_model_name(model)
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": resolved_model,
                    "messages": formatted_messages,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                    },
                    "stream": False,
                },
                timeout=120.0,
            )
            response.raise_for_status()
            data = response.json()
        
        return LLMResponse(
            content=data["message"]["content"],
            provider="ollama",
            model=resolved_model,
            prompt_tokens=data.get("prompt_eval_count", 0),
            completion_tokens=data.get("eval_count", 0),
        )

    async def _generate_deepseek(
        self,
        messages: list[dict],
        system_prompt: Optional[str],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> LLMResponse:
        if not self.deepseek_client:
            raise RuntimeError("DeepSeek client not configured")

        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        formatted_messages.extend(messages)

        response = await self.deepseek_client.chat.completions.create(
            model=model,
            messages=formatted_messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        usage = response.usage
        return LLMResponse(
            content=response.choices[0].message.content,
            provider="deepseek",
            model=model,
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
        )

    async def _resolve_ollama_model_name(self, model: str) -> str:
        """Resolve short model aliases (e.g. mistral-nemo) to installed Ollama tags."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{settings.OLLAMA_BASE_URL}/api/tags",
                    timeout=10.0,
                )
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            logger.warning("Ollama model resolution skipped for '%s': %s", model, exc)
            return model

        installed = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        if not installed:
            return model

        if model in installed:
            return model

        if ":" not in model:
            latest_candidate = f"{model}:latest"
            if latest_candidate in installed:
                return latest_candidate
            for installed_model in installed:
                if installed_model.startswith(f"{model}:"):
                    return installed_model

        return model
    
    async def generate_stream(
        self,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncGenerator[str, None]:
        provider = provider or settings.DEFAULT_LLM_PROVIDER
        model = model or settings.DEFAULT_LLM_MODEL
        
        if provider == "openai":
            async for chunk in self._stream_openai(messages, system_prompt, model, temperature, max_tokens):
                yield chunk
        elif provider == "anthropic":
            async for chunk in self._stream_anthropic(messages, system_prompt, model, temperature, max_tokens):
                yield chunk
        elif provider == "deepseek":
            async for chunk in self._stream_deepseek(messages, system_prompt, model, temperature, max_tokens):
                yield chunk
        else:
            response = await self.generate(messages, system_prompt, provider, model, temperature, max_tokens)
            yield response.content
    
    async def _stream_openai(
        self,
        messages: list[dict],
        system_prompt: Optional[str],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        if not self.openai_client:
            raise RuntimeError("OpenAI client not configured")
        
        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        formatted_messages.extend(messages)
        
        # GPT-5 and o-series models require max_completion_tokens and don't support custom temperature
        if model.startswith("gpt-5") or model.startswith("o1") or model.startswith("o3"):
            stream = await self.openai_client.chat.completions.create(
                model=model,
                messages=formatted_messages,
                max_completion_tokens=max_tokens,
                stream=True,
            )
        else:
            stream = await self.openai_client.chat.completions.create(
                model=model,
                messages=formatted_messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
        
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    
    async def _stream_anthropic(
        self,
        messages: list[dict],
        system_prompt: Optional[str],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        if not self.anthropic_client:
            raise RuntimeError("Anthropic client not configured")
        
        async with self.anthropic_client.messages.stream(
            model=model,
            system=system_prompt or "",
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def _stream_deepseek(
        self,
        messages: list[dict],
        system_prompt: Optional[str],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        if not self.deepseek_client:
            raise RuntimeError("DeepSeek client not configured")

        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        formatted_messages.extend(messages)

        stream = await self.deepseek_client.chat.completions.create(
            model=model,
            messages=formatted_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )

        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    
    async def compute_embeddings(self, texts: list[str]) -> list[list[float]]:
        if not self.openai_client:
            raise RuntimeError("OpenAI client not configured for embeddings")
        
        response = await self.openai_client.embeddings.create(
            model=settings.EMBEDDING_MODEL,
            input=texts,
        )
        
        return [item.embedding for item in response.data]
    
    async def generate_image(
        self,
        prompt: str,
        size: str = "1024x1024",
        quality: str = "standard",
        style: str = "vivid",
        provider: str = "flux-schnell",  # Default changed to flux-schnell
        image_base64: Optional[str] = None, # For image-to-image
        strength: float = 0.8,
    ) -> str:
        """Generate an image using BFL (Flux), DALL-E 3 or Golinelli API"""
        
        # BFL Models
        bfl_models = [
            "flux-pro-1.1", "flux-pro", "flux-dev", "flux-schnell", 
            "flux-pro-1.1-ultra", "flux-pro-fill", "flux-pro-canny", 
            "flux-pro-depth", "flux-pro-redaction",
            "flux-2-pro", "flux-2-dev", "flux-2-klein", "flux-2-max", "flux-2-flex"
        ]
        
        if provider in bfl_models or provider.startswith("flux-"):
            return await self._generate_image_bfl(prompt, size, model=provider, image_base64=image_base64, strength=strength)
        
        golinelli_models = ["sdxl", "sd-turbo"]
        if provider in golinelli_models:
            return await self._generate_image_flux(prompt, size, model=provider)
        
        if provider == "dall-e":
            return await self._generate_image_dalle(prompt, size, quality, style)
            
        # Fallback to BFL schnell
        return await self._generate_image_bfl(prompt, size, model="flux-schnell")

    async def _generate_image_bfl(
        self,
        prompt: str,
        size: str = "1024x1024",
        model: str = "flux-schnell",
        image_base64: Optional[str] = None,
        strength: float = 0.8,
    ) -> str:
        """Generate an image using Black Forest Labs API (asynchronous)"""
        if not settings.BFL_API_KEY:
            # Fallback to Golinelli if BFL key missing
            logger.warning("BFL_API_KEY not configured, falling back to Golinelli API")
            return await self._generate_image_flux(prompt, size, model="flux-schnell")

        # Map frontend model names to BFL endpoint names
        model_map = {
            "flux-pro-1.1": "flux-pro-1.1",
            "flux-pro": "flux-pro-1.0",
            "flux-dev": "flux-dev",
            "flux-schnell": "flux-schnell",
            "flux-pro-1.1-ultra": "flux-pro-1.1-ultra",
            "flux-2-pro": "flux-2-pro",
            "flux-2-dev": "flux-2-dev",
            "flux-2-klein": "flux-2-klein",
            "flux-2-max": "flux-2-max",
            "flux-2-flex": "flux-2-flex",
        }
        bfl_model = model_map.get(model, model)
        
        # Handle image-to-image if image_base64 is provided
        # Note: In a real implementation, we'd check which BFL models support img2img.
        # Usually, it involves a different endpoint or extra params.
        # For simplicity, we use the requested model.
        
        endpoint = f"https://api.bfl.ml/v1/{bfl_model}"
        
        # Parse size
        try:
            width, height = map(int, size.split("x"))
        except:
            width, height = 1024, 1024

        payload = {
            "prompt": prompt,
            "width": width,
            "height": height,
        }
        
        if image_base64:
            payload["image"] = image_base64
            payload["strength"] = strength

        async with httpx.AsyncClient(timeout=120.0) as client:
            # 1. Post request
            logger.info(f"BFL Request: endpoint={endpoint}, payload_keys={list(payload.keys())}")
            response = await client.post(
                endpoint,
                headers={
                    "X-Key": settings.BFL_API_KEY,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            
            if response.status_code != 200:
                logger.error(f"BFL Error Response: {response.status_code} - {response.text}")
                raise RuntimeError(f"BFL image generation request failed: {response.text}")
            
            data = response.json()
            request_id = data.get("id")
            logger.info(f"BFL Request success: id={request_id}")
            if not request_id:
                raise RuntimeError(f"BFL API did not return a request ID: {data}")

            # 2. Poll for results
            import asyncio
            max_retries = 60
            for i in range(max_retries):
                await asyncio.sleep(2.0) # Wait 2 seconds between polls
                
                status_response = await client.get(
                    "https://api.bfl.ml/v1/get_result",
                    headers={"X-Key": settings.BFL_API_KEY},
                    params={"id": request_id}
                )
                
                if status_response.status_code != 200:
                    logger.warning(f"BFL Poll Error: {status_response.status_code}")
                    continue # Try again
                
                status_data = status_response.json()
                status = status_data.get("status")
                
                if status == "Ready":
                    logger.info(f"BFL Result Ready: {request_id}")
                    result_url = status_data.get("result", {}).get("sample")
                    if not result_url:
                        raise RuntimeError("BFL result ready but no sample URL found")
                    
                    # Download and save locally for persistence
                    return await self._download_and_save_image(result_url)
                elif status == "Failed":
                    logger.error(f"BFL Generation Failed: {status_data}")
                    raise RuntimeError(f"BFL generation failed: {status_data.get('error', 'Unknown error')}")
                
                # Still processing...
            
            raise TimeoutError("BFL image generation timed out")

    async def _download_and_save_image(self, url: str) -> str:
        """Download image from URL and save locally"""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                img_response = await client.get(url)
                if img_response.status_code == 200:
                    upload_dir = Path("/app/uploads/generated")
                    upload_dir.mkdir(parents=True, exist_ok=True)
                    
                    filename = f"{uuid.uuid4()}.png"
                    file_path = upload_dir / filename
                    
                    async with aiofiles.open(file_path, 'wb') as f:
                        await f.write(img_response.content)
                    
                    return f"/uploads/generated/{filename}"
        except Exception as e:
            logger.error(f"Failed to save image locally: {e}")
        return url

    async def _generate_image_dalle(
        self,
        prompt: str,
        size: str = "1024x1024",
        quality: str = "standard",
        style: str = "vivid",
    ) -> str:
        """Generate an image using DALL-E 3 and save locally for persistence"""
        if not self.openai_client:
            raise RuntimeError("OpenAI client not configured for image generation")
        
        response = await self.openai_client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            size=size,
            quality=quality,
            style=style,
            n=1,
        )
        
        temp_url = response.data[0].url
        
        # Download and save the image locally for persistence
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                img_response = await client.get(temp_url)
                if img_response.status_code == 200:
                    # Save to uploads/generated directory
                    upload_dir = Path("/app/uploads/generated")
                    upload_dir.mkdir(parents=True, exist_ok=True)
                    
                    filename = f"{uuid.uuid4()}.png"
                    file_path = upload_dir / filename
                    
                    async with aiofiles.open(file_path, 'wb') as f:
                        await f.write(img_response.content)
                    
                    # Return persistent URL
                    return f"/uploads/generated/{filename}"
        except Exception as e:
            print(f"Failed to save DALL-E image locally: {e}")
        
        # Fallback to temporary URL if saving fails
        return temp_url
    
    async def _generate_image_flux(
        self,
        prompt: str,
        size: str = "1024x1024",
        model: str = "sdxl",
    ) -> str:
        """Generate an image using Golinelli image API (SDXL, SD-Turbo, or FLUX models) and save locally"""
        # Parse size
        try:
            width, height = map(int, size.split("x"))
        except:
            width, height = 1024, 1024
        
        # Model-specific settings
        model_configs = {
            "flux-schnell": {"steps": 4, "max_size": 1024},
            "flux-dev": {"steps": 28, "max_size": 1024},
            "sdxl": {"steps": 30, "max_size": 1024},
            "sd-turbo": {"steps": 1, "max_size": 512},
        }
        config = model_configs.get(model, {"steps": 4, "max_size": 1024})
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                "https://image.golinelli.ai/api/v1/generate/text2img",
                headers={
                    "X-API-Key": settings.GOLINELLI_IMAGE_API_KEY or "",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "prompt": prompt,
                    "width": min(width, config["max_size"]),
                    "height": min(height, config["max_size"]),
                    "steps": config["steps"],
                    "output_format": "png",
                },
            )
            
            if response.status_code != 200:
                raise RuntimeError(f"Flux image generation failed: {response.text}")
            
            data = response.json()
            if not data.get("success"):
                raise RuntimeError(f"Flux image generation failed: {data.get('error', 'Unknown error')}")
            
            # Get base64 image data
            base64_image = data.get("image", "")
            
            # Save to file for persistence
            try:
                # Remove data URL prefix if present
                if base64_image.startswith("data:"):
                    base64_image = base64_image.split(",", 1)[1]
                
                image_bytes = base64.b64decode(base64_image)
                
                upload_dir = Path("/app/uploads/generated")
                upload_dir.mkdir(parents=True, exist_ok=True)
                
                filename = f"{uuid.uuid4()}.png"
                file_path = upload_dir / filename
                
                async with aiofiles.open(file_path, 'wb') as f:
                    await f.write(image_bytes)
                
                # Return persistent URL
                return f"/uploads/generated/{filename}"
            except Exception as e:
                print(f"Failed to save Flux image locally: {e}")
                # Fallback to base64 data URL
                if not base64_image.startswith("data:"):
                    base64_image = f"data:image/png;base64,{base64_image}"
                return base64_image


llm_service = LLMService()
