from typing import Optional, AsyncGenerator
from dataclasses import dataclass
import httpx
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic

from app.core.config import settings


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
        
        if settings.OPENAI_API_KEY:
            self.openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        if settings.ANTHROPIC_API_KEY:
            self.anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    
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
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": model,
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
            model=model,
            prompt_tokens=data.get("prompt_eval_count", 0),
            completion_tokens=data.get("eval_count", 0),
        )
    
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
        provider: str = "dall-e",  # "dall-e", "sdxl", "sd-turbo", "flux-schnell", "flux-dev"
    ) -> str:
        """Generate an image using DALL-E 3 or Golinelli API (SDXL/SD-Turbo/FLUX) and return the URL/base64"""
        
        golinelli_models = ["flux-schnell", "flux-dev", "flux", "sdxl", "sd-turbo"]
        if provider in golinelli_models:
            # Map provider to actual model name
            model = provider
            if provider == "flux":
                model = "flux-schnell"
            return await self._generate_image_flux(prompt, size, model=model)
        else:
            # Use OpenAI DALL-E
            return await self._generate_image_dalle(prompt, size, quality, style)
    
    async def _generate_image_dalle(
        self,
        prompt: str,
        size: str = "1024x1024",
        quality: str = "standard",
        style: str = "vivid",
    ) -> str:
        """Generate an image using DALL-E 3"""
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
        
        return response.data[0].url
    
    async def _generate_image_flux(
        self,
        prompt: str,
        size: str = "1024x1024",
        model: str = "sdxl",
    ) -> str:
        """Generate an image using Golinelli image API (SDXL, SD-Turbo, or FLUX models)"""
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
            
            # Return base64 data URL with proper prefix
            base64_image = data.get("image", "")
            if base64_image and not base64_image.startswith("data:"):
                base64_image = f"data:image/png;base64,{base64_image}"
            return base64_image


llm_service = LLMService()
