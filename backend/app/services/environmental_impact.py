from __future__ import annotations

from math import ceil, sqrt
from typing import Any, Optional


BASELINE_ENERGY_WH = 0.24
BASELINE_CO2_GRAMS = 0.03
BASELINE_WATER_ML = 0.26
BASELINE_WATER_DROPS = 5

INPUT_TOKEN_WEIGHT = 0.35
OUTPUT_TOKEN_WEIGHT = 1.0
BASELINE_WEIGHTED_TOKENS = 1600.0

MODEL_INTENSITY_OVERRIDES = {
    "gpt-5-nano": 0.7,
    "gpt-5-mini": 1.0,
    "gpt-4o-mini": 0.9,
    "gpt-4o": 1.4,
    "claude-haiku-4-5-20251001": 1.05,
    "claude-3-haiku-20240307": 0.95,
    "claude-3-5-sonnet-20241022": 1.35,
    "gemini-2.0-flash-lite": 0.8,
    "gemini-2.0-flash": 0.9,
    "gemini-3.1-flash-lite-preview": 0.82,
    "mistral-nemo": 0.95,
    "mistral": 1.0,
    "deepseek-chat": 0.9,
    "deepseek-reasoner": 1.3,
}

PROVIDER_INTENSITY_FALLBACK = {
    "openai": 1.0,
    "anthropic": 1.15,
    "gemini": 0.9,
    "deepseek": 0.92,
    "ollama": 0.98,
    "flux": 1.6,
    "system": 0.0,
    "fallback": 1.0,
}

IMAGE_REQUEST_EQUIVALENT = {
    "dall-e-3": 4.5,
    "gpt-image-1": 4.8,
    "flux-schnell": 2.6,
    "flux-dev": 3.0,
    "sdxl": 2.9,
}


def estimate_tokens_from_text(text: Optional[str]) -> int:
    if not text:
        return 0
    normalized = " ".join(str(text).split())
    if not normalized:
        return 0
    return max(1, ceil(len(normalized) / 4))


def estimate_prompt_tokens_from_messages(messages: list[dict[str, Any]]) -> int:
    return sum(estimate_tokens_from_text(m.get("content")) for m in messages)


def build_estimated_token_usage(
    messages: list[dict[str, Any]],
    response_content: Optional[str],
    image_count: int = 0,
) -> dict[str, Any]:
    prompt_tokens = estimate_prompt_tokens_from_messages(messages)
    completion_tokens = estimate_tokens_from_text(response_content)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "image_count": max(0, int(image_count or 0)),
        "estimated_tokens": True,
    }


def _model_intensity(provider: Optional[str], model: Optional[str]) -> float:
    normalized_model = (model or "").strip()
    normalized_provider = (provider or "").strip().lower()

    if normalized_model in MODEL_INTENSITY_OVERRIDES:
        return MODEL_INTENSITY_OVERRIDES[normalized_model]

    for known_model, factor in MODEL_INTENSITY_OVERRIDES.items():
        if normalized_model.startswith(known_model):
            return factor

    if normalized_model.startswith("gpt-5"):
        return 1.05
    if normalized_model.startswith("gpt-4"):
        return 1.35
    if normalized_model.startswith("claude"):
        return 1.2
    if normalized_model.startswith("gemini"):
        return 0.9

    return PROVIDER_INTENSITY_FALLBACK.get(normalized_provider, 1.0)


def _image_request_equivalent(model: Optional[str], image_count: int) -> float:
    if image_count <= 0:
        return 0.0
    normalized_model = (model or "").strip()
    factor = IMAGE_REQUEST_EQUIVALENT.get(normalized_model, 3.0)
    return factor * image_count


def calculate_environmental_impact(
    *,
    provider: Optional[str],
    model: Optional[str],
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    image_count: int = 0,
    request_count_fallback: int = 1,
) -> dict[str, Any]:
    safe_prompt_tokens = max(0, int(prompt_tokens or 0))
    safe_completion_tokens = max(0, int(completion_tokens or 0))
    safe_image_count = max(0, int(image_count or 0))
    weighted_tokens = (
        safe_prompt_tokens * INPUT_TOKEN_WEIGHT
        + safe_completion_tokens * OUTPUT_TOKEN_WEIGHT
    )
    token_request_equivalent = weighted_tokens / BASELINE_WEIGHTED_TOKENS
    request_equivalent = max(
        _image_request_equivalent(model, safe_image_count),
        token_request_equivalent,
        float(request_count_fallback if weighted_tokens == 0 and safe_image_count == 0 else 0),
    )
    intensity = _model_intensity(provider, model)
    impact_factor = request_equivalent * intensity

    energy_wh = BASELINE_ENERGY_WH * impact_factor
    co2_grams = BASELINE_CO2_GRAMS * impact_factor
    water_ml = BASELINE_WATER_ML * impact_factor

    return {
        "energy_wh": round(energy_wh, 4),
        "co2_grams": round(co2_grams, 4),
        "water_ml": round(water_ml, 4),
        "water_drops": max(0, round(water_ml / BASELINE_WATER_ML * BASELINE_WATER_DROPS)),
        "prompt_tokens": safe_prompt_tokens,
        "completion_tokens": safe_completion_tokens,
        "total_tokens": safe_prompt_tokens + safe_completion_tokens,
        "image_count": safe_image_count,
        "request_equivalent": round(request_equivalent, 4),
        "model_intensity": round(intensity, 4),
    }


def enrich_usage_with_environmental_impact(
    usage: Optional[dict[str, Any]],
    *,
    provider: Optional[str],
    model: Optional[str],
    request_count_fallback: int = 1,
) -> dict[str, Any]:
    base_usage = dict(usage or {})
    impact = calculate_environmental_impact(
        provider=provider,
        model=model,
        prompt_tokens=int(base_usage.get("prompt_tokens") or 0),
        completion_tokens=int(base_usage.get("completion_tokens") or 0),
        image_count=int(base_usage.get("image_count") or 0),
        request_count_fallback=request_count_fallback,
    )
    base_usage.setdefault("total_tokens", impact["total_tokens"])
    base_usage["environmental_impact"] = impact
    return base_usage
