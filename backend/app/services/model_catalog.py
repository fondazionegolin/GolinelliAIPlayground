"""LLM model catalogue: discovery of new models, official price checks, runtime price overrides.

Discovery uses each provider's authenticated ``/models`` endpoint (reliable). Prices have no API, so they are read
from the official pricing pages on a best-effort basis; whatever the parsers find is stored as a *proposal* that an
admin applies explicitly - billing never changes silently. A provider whose page cannot be parsed is reported, not guessed.
"""
from __future__ import annotations

import asyncio
import html as htmllib
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.pricing import PRICING_CATALOG, usd
from app.models.ai_model import AIModel, AIModelScan

logger = logging.getLogger(__name__)

PRICING_URLS = {
    "anthropic": "https://platform.claude.com/docs/en/about-claude/pricing",
    "openai": "https://developers.openai.com/api/docs/pricing",
    "deepseek": "https://api-docs.deepseek.com/quick_start/pricing",
}
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
PRICE_EPSILON = 0.0005
SCAN_INTERVAL_SECONDS = 24 * 3600
OPENAI_CHAT_PREFIXES = ("gpt-", "o1", "o3", "o4", "chatgpt-")

# Official list prices read on 2026-10-07 (USD per 1M tokens): (provider, id, name, input, output, cached input, context).
# DeepSeek prices are the PEAK rate (off-peak is half) so budgets are never underestimated.
SEED: list[tuple[str, str, str, float, float, float | None, int | None]] = [
    ("anthropic", "claude-fable-5-1", "Claude Fable 5.1", 10, 50, 0.25, None),
    ("anthropic", "claude-fable-5", "Claude Fable 5", 10, 50, 1, None),
    ("anthropic", "claude-opus-5-5", "Claude Opus 5.5", 4, 20, 0.20, None),
    ("anthropic", "claude-opus-5", "Claude Opus 5", 5, 25, 0.50, None),
    ("anthropic", "claude-opus-4-8", "Claude Opus 4.8", 5, 25, 0.50, None),
    ("anthropic", "claude-opus-4-7", "Claude Opus 4.7", 5, 25, 0.50, None),
    ("anthropic", "claude-opus-4-6", "Claude Opus 4.6", 5, 25, 0.50, 1_000_000),
    ("anthropic", "claude-opus-4-5", "Claude Opus 4.5", 5, 25, 0.50, None),
    ("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5", 2, 10, 0.20, None),
    ("anthropic", "claude-sonnet-5", "Claude Sonnet 5", 2, 10, 0.20, None),
    ("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", 3, 15, 0.30, 1_000_000),
    ("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", 3, 15, 0.30, None),
    ("anthropic", "claude-haiku-4-5-20251001", "Claude Haiku 4.5", 1, 5, 0.10, None),
    ("openai", "gpt-6-astra", "GPT-6 Astra", 10, 50, 1, None),
    ("openai", "gpt-6.1-sol", "GPT-6.1 Sol", 2, 10, 0.1, None),
    ("openai", "gpt-6-sol", "GPT-6 Sol", 2, 10, 0.2, None),
    ("openai", "gpt-6-luna", "GPT-6 Luna", 0.1, 0.5, 0.01, None),
    ("openai", "gpt-5.6-sol", "GPT-5.6 Sol", 4, 20, 0.4, 1_050_000),
    ("openai", "gpt-5.6-terra", "GPT-5.6 Terra", 2, 12, 0.2, 1_050_000),
    ("openai", "gpt-5.6-luna", "GPT-5.6 Luna", 0.2, 1.2, 0.02, 1_050_000),
    ("openai", "gpt-5.5", "GPT-5.5", 5, 30, 0.5, None),
    ("openai", "gpt-5.4", "GPT-5.4", 2.5, 15, 0.25, None),
    ("openai", "gpt-5.4-mini", "GPT-5.4 mini", 0.75, 4.5, 0.075, None),
    ("openai", "gpt-5.4-nano", "GPT-5.4 nano", 0.2, 1.25, 0.02, None),
    ("openai", "gpt-5.2", "GPT-5.2", 1.75, 14, 0.175, None),
    ("openai", "gpt-5.1", "GPT-5.1", 1.25, 10, 0.125, None),
    ("openai", "gpt-5", "GPT-5", 1.25, 10, 0.125, None),
    ("openai", "gpt-5-mini", "GPT-5 mini", 0.25, 2, 0.025, None),
    ("openai", "gpt-5-nano", "GPT-5 nano", 0.05, 0.4, 0.005, None),
    ("openai", "gpt-4.1", "GPT-4.1", 2, 8, 0.5, None),
    ("openai", "gpt-4.1-mini", "GPT-4.1 mini", 0.4, 1.6, 0.1, None),
    ("openai", "gpt-4.1-nano", "GPT-4.1 nano", 0.1, 0.4, 0.025, None),
    ("openai", "gpt-4o", "GPT-4o", 2.5, 10, 1.25, None),
    ("openai", "gpt-4o-mini", "GPT-4o mini", 0.15, 0.6, 0.075, None),
    ("openai", "o3", "o3", 2, 8, 0.5, None),
    ("openai", "o4-mini", "o4-mini", 1.1, 4.4, 0.275, None),
    ("deepseek", "deepseek-flash", "DeepSeek V4.1 Flash", 0.30, 1.20, 0.006, 1_000_000),
    ("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash (alias legacy → Flash)", 0.30, 1.20, 0.006, 1_000_000),
    ("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", 1.32, 3.96, 0.044, 1_000_000),
]
# Non-text models: (provider, id, name, kind, USD per image or None, price note). Prices read from the OpenAI listing on 2026-10-07;
# per-image figures are the platform's historical estimates for a standard 1024px request.
SEED_OTHER: list[tuple[str, str, str, str, float | None, str]] = [
    ("openai", "gpt-image-2-2026-04-21", "GPT Image 2 (snapshot 2026-04-21)", "image", 0.020, "≈ $0.02 per immagine 1024px (stima)"),
    ("openai", "gpt-image-2", "GPT Image 2", "image", 0.020, "≈ $0.02 per immagine 1024px (stima)"),
    ("openai", "gpt-image-1.5", "GPT Image 1.5", "image", 0.034, "≈ $0.034 per immagine 1024px (stima)"),
    ("openai", "gpt-image-1", "GPT Image 1", "image", 0.040, "≈ $0.04 per immagine 1024px (stima)"),
    ("openai", "dall-e-3", "DALL·E 3", "image", 0.040, "≈ $0.04 per immagine 1024px"),
    ("openai", "gpt-realtime-2.1", "GPT Realtime 2.1", "realtime", None, "Audio $32 in / $64 out · testo $4 / $24 per 1M token"),
    ("openai", "gpt-realtime-2.1-mini", "GPT Realtime 2.1 mini", "realtime", None, "Audio $10 in / $20 out · testo $0.60 / $2.40 per 1M token"),
    ("openai", "gpt-realtime-2", "GPT Realtime 2", "realtime", None, "Audio $32 in / $64 out per 1M token"),
    ("openai", "gpt-realtime-mini", "GPT Realtime mini", "realtime", None, "vedi listino"),
    ("openai", "gpt-4o-mini-transcribe", "GPT-4o mini Transcribe", "transcribe", None, "≈ $0.003 al minuto"),
    ("openai", "gpt-4o-transcribe", "GPT-4o Transcribe", "transcribe", None, "vedi listino"),
    ("openai", "whisper-1", "Whisper", "transcribe", None, "≈ $0.006 al minuto"),
]
# Models offered in the users' model selectors until the admin changes it (the list the platform shipped with).
SEED_OFFERED = {"gpt-5.6-luna", "claude-haiku-4-5-20251001"}

# Third-party quality figures (Artificial Analysis Intelligence Index, read 2026-10-07): indicative, edit freely.
SEED_QUALITY = {"claude-opus-5-5": 58, "claude-sonnet-5-5": 56, "gpt-5.6-terra": 42, "deepseek-v4-pro": 36}
QUALITY_SOURCE = "Artificial Analysis Intelligence Index (2026-10-07, da verificare)"


def blended_usd(input_usd: float | None, output_usd: float | None) -> float | None:
    """Cost of a typical request mix (3 input tokens : 1 output token) per 1M tokens."""
    if input_usd is None or output_usd is None:
        return None
    return (3 * input_usd + output_usd) / 4


# ── runtime pricing ───────────────────────────────────────────────────────────

def apply_runtime_prices(models: list[AIModel]) -> int:
    """Make credit calculations follow the catalogue: DB prices replace the static ``PRICING_CATALOG`` entries."""
    applied = 0
    for model in models:
        if model.status == "deprecated":
            continue
        if model.kind == "text" and model.input_usd is not None and model.output_usd is not None:
            PRICING_CATALOG[model.model_id] = usd(model.input_usd, model.output_usd)
            applied += 1
        elif model.kind == "image" and model.input_usd is not None:
            PRICING_CATALOG[model.model_id] = usd(model.input_usd, 0.0, per_image=True)
            applied += 1
    return applied


async def seed_if_empty(db: AsyncSession) -> None:
    """Insert the catalogue entries that are missing (idempotent: existing rows and admin edits are never touched)."""
    existing = {(row.provider, row.model_id) for row in (await db.execute(select(AIModel))).scalars().all()}
    checked = datetime(2026, 10, 7, tzinfo=timezone.utc)
    added = False
    for provider, model_id, name, price_in, price_out, cached, context in SEED:
        if (provider, model_id) in existing:
            continue
        db.add(AIModel(provider=provider, model_id=model_id, display_name=name, status="active", kind="text", input_usd=price_in, output_usd=price_out,
                       cached_input_usd=cached, context_window=context, pricing_url=PRICING_URLS[provider], price_checked_at=checked,
                       quality_score=SEED_QUALITY.get(model_id), quality_source=QUALITY_SOURCE if model_id in SEED_QUALITY else None,
                       offered=model_id in SEED_OFFERED, acknowledged=True))
        added = True
    for provider, model_id, name, kind, per_image, note in SEED_OTHER:
        if (provider, model_id) in existing:
            continue
        db.add(AIModel(provider=provider, model_id=model_id, display_name=name, status="active", kind=kind, input_usd=per_image, price_note=note,
                       pricing_url=PRICING_URLS[provider], price_checked_at=checked, acknowledged=True))
        added = True
    # First run with the selector flag: offer the platform's historical list so selectors never come up empty.
    rows = list((await db.execute(select(AIModel))).scalars().all())
    if not any(row.offered for row in rows):
        from app.services import model_roles
        keep = SEED_OFFERED | {model_roles.model_for("chat.default")}
        for row in rows:
            if row.kind == "text" and row.model_id in keep:
                row.offered = True
                added = True
    if added:
        await db.commit()


async def load_runtime_prices() -> None:
    """Startup hook: load stored prices into the live pricing table."""
    try:
        async with AsyncSessionLocal() as db:
            await seed_if_empty(db)
            count = apply_runtime_prices(list((await db.execute(select(AIModel))).scalars().all()))
        logger.info("Model catalogue: %s prices applied to the runtime pricing table", count)
    except Exception:  # catalogue is optional: never block startup (e.g. migration not applied yet)
        logger.warning("Model catalogue could not be loaded", exc_info=True)


# ── discovery ─────────────────────────────────────────────────────────────────

def _openai_kind(model_id: str) -> str | None:
    """Catalogue kind of an OpenAI model id, or None for models the platform has no use for."""
    if any(word in model_id for word in ("embedding", "moderation", "tts", "diarize", "codex", "search", "instruct")):
        return None
    if "realtime" in model_id or model_id.startswith("gpt-live"):
        return "realtime"
    if "transcribe" in model_id or model_id.startswith("whisper"):
        return "transcribe"
    if "image" in model_id or model_id.startswith("dall-e"):
        return "image"
    if model_id.startswith(OPENAI_CHAT_PREFIXES) and "audio" not in model_id:
        return "text"
    return None


async def _discover(client: httpx.AsyncClient, provider: str) -> list[dict[str, str]]:
    if provider == "anthropic" and settings.ANTHROPIC_API_KEY:
        response = await client.get("https://api.anthropic.com/v1/models", params={"limit": 1000},
                                    headers={"x-api-key": settings.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01"})
        response.raise_for_status()
        return [{"id": item["id"], "name": item.get("display_name") or item["id"]} for item in response.json().get("data", [])]
    if provider == "openai" and settings.OPENAI_API_KEY:
        response = await client.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"})
        response.raise_for_status()
        found = []
        for item in response.json().get("data", []):
            kind = _openai_kind(item["id"])
            if kind and not re.search(r"-\d{4}-\d{2}-\d{2}$", item["id"]):
                found.append({"id": item["id"], "name": item["id"], "kind": kind})
        return found
    if provider == "deepseek" and settings.DEEPSEEK_API_KEY:
        response = await client.get(f"{settings.DEEPSEEK_BASE_URL.rstrip('/')}/models", headers={"Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}"})
        response.raise_for_status()
        return [{"id": item["id"], "name": item["id"]} for item in response.json().get("data", [])]
    raise LookupError("chiave API non configurata")


# ── official pricing pages ────────────────────────────────────────────────────

def _page_text(raw: str) -> str:
    cleaned = re.sub(r"<script.*?</script>|<style.*?</style>", "", raw, flags=re.S)
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", "|", cleaned)))


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def parse_anthropic(raw: str) -> dict[str, tuple[float, float]]:
    """{slug of the displayed name: (input, output)} from the first pricing table («Claude Opus 4.8 | $5 | $25 | …»)."""
    text = _page_text(raw)
    prices: dict[str, tuple[float, float]] = {}
    start = text.find("Base input tokens")
    # Column order in the page: name | input | output | 5m cache write | 1h cache write | cache hit.
    # Rows may carry a tagline between the name and the first price, and a tier note after a price
    # («$0.10 / MTok for prompts up to 100,000 tokens $0.50 / MTok»). Budgets are never underestimated, so when a row
    # has a long-prompt tier («… for prompts over 100,000 tokens $0.50 / MTok … $2.50 / MTok») the higher prices win.
    body = text[max(start, 0):]
    for match in re.finditer(r"(Claude [A-Z][A-Za-z]+ [\d.]+)[^$]{0,140}?\$([\d.]+)[| /]*MTok[^$]{0,60}\$([\d.]+)[| /]*MTok", body):
        slug = _slug(match.group(1))
        if slug in prices:
            continue
        price_in, price_out = float(match.group(2)), float(match.group(3))
        row_tail = body[match.end():match.end() + 420].split("Claude ")[0]  # never read into the next model's row
        tier = re.search(r"\$([\d.]+)[| /]*MTok[| ]*for prompts over[^$]{0,40}\$([\d.]+)[| /]*MTok", row_tail)
        if tier:
            price_in, price_out = max(price_in, float(tier.group(1))), max(price_out, float(tier.group(2)))
        prices[slug] = (price_in, price_out)
    return prices


def parse_openai(raw: str) -> dict[str, tuple[float, float]]:
    """{model id: (input, output)} from the embedded standard-tier table: cells are [name, input, cached, …, output]."""
    page = htmllib.unescape(raw)
    start = page.find('"tier":[0,"standard"]')
    if start < 0:
        return {}
    segment = page[start:start + 120000]
    end = segment.find('"tier":', 20)
    segment = segment[:end] if end > 0 else segment
    prices: dict[str, tuple[float, float]] = {}
    for row in re.findall(r'\[1,\[(\[0,"[^"]*"\](?:,\[0,(?:"[^"]*"|[\d.]+)\])+)\]\]', segment):
        cells = [cell.strip('"') for cell in re.findall(r'\[0,("[^"]*"|[\d.]+)\]', row)]
        name = re.sub(r"\s*\(.*\)$", "", cells[0]).strip()
        try:
            prices[name] = (float(cells[1]), float(cells[-1]))
        except ValueError:
            continue
    return prices


def parse_deepseek(raw: str) -> dict[str, tuple[float, float]]:
    """Peak-rate (higher) cache-miss input and output price; both listed models share one table."""
    text = _page_text(raw)
    names = re.search(r"MODEL\s*\|+\s*(deepseek-[\w-]+)[| ]*(?:\(\d\))?[| ]*(deepseek-[\w-]+)", text)
    miss = re.search(r"CACHE MISS\)?[| ]+OFF-PEAK[| ]+\$([\d.]+)[| ]+\$([\d.]+)[| ]+PEAK[| ]+\$([\d.]+)[| ]+\$([\d.]+)", text)
    out = re.search(r"OUTPUT TOKENS[| ]+OFF-PEAK[| ]+\$([\d.]+)[| ]+\$([\d.]+)[| ]+PEAK[| ]+\$([\d.]+)[| ]+\$([\d.]+)", text)
    if not (names and miss and out):
        return {}
    first, second = names.group(1), names.group(2)
    prices = {first: (float(miss.group(3)), float(out.group(3))), second: (float(miss.group(4)), float(out.group(4)))}
    if first == "deepseek-flash":
        prices["deepseek-v4-flash"] = prices[first]  # documented legacy alias, billed at the Flash price
    return prices


PARSERS = {"anthropic": parse_anthropic, "openai": parse_openai, "deepseek": parse_deepseek}


def _lookup(provider: str, model: AIModel, prices: dict[str, tuple[float, float]]) -> tuple[float, float] | None:
    if provider != "anthropic":
        return prices.get(model.model_id)
    # Anthropic's page shows display names: match them to the id («claude-opus-4-8» ← «Claude Opus 4.8»).
    for slug, value in prices.items():
        if model.model_id == slug or model.model_id.startswith(slug + "-2") or _slug(model.display_name) == slug:
            return value
    return None


# ── scan ──────────────────────────────────────────────────────────────────────

async def run_scan(db: AsyncSession, trigger: str = "manual") -> dict[str, Any]:
    await seed_if_empty(db)
    now = datetime.now(timezone.utc)
    summary: dict[str, Any] = {"new_models": [], "price_changes": [], "not_in_api": [], "errors": {}, "pricing_unverified": [], "providers": {}}
    models = list((await db.execute(select(AIModel))).scalars().all())
    by_key = {(m.provider, m.model_id): m for m in models}

    async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
        for provider in PRICING_URLS:
            # 1) discovery of released models
            try:
                discovered = await _discover(client, provider)
                summary["providers"][provider] = {"discovered": len(discovered)}
                seen = {item["id"] for item in discovered}
                # Undated aliases (claude-opus-4-5) are accepted by the API in place of the dated id (claude-opus-4-5-20251101).
                seen |= {m.model_id for m in models if m.provider == provider and any(found.startswith(m.model_id + "-20") for found in seen)}
                for item in discovered:
                    if (provider, item["id"]) not in by_key and not any(m.provider == provider and item["id"].startswith(m.model_id + "-20") for m in models):
                        model = AIModel(provider=provider, model_id=item["id"], display_name=item["name"], status="available", kind=item.get("kind", "text"),
                                        pricing_url=PRICING_URLS[provider], acknowledged=False)
                        db.add(model)
                        by_key[(provider, item["id"])] = model
                        models.append(model)
                        summary["new_models"].append({"provider": provider, "model_id": item["id"], "name": item["name"]})
                for model in models:
                    if model.provider == provider:
                        model.seen_in_api = model.model_id in seen
                        if not model.seen_in_api and model.status == "active":
                            summary["not_in_api"].append({"provider": provider, "model_id": model.model_id})
            except LookupError as exc:
                summary["errors"][provider] = f"Scoperta modelli non eseguita: {exc}"
            except Exception as exc:
                logger.warning("Model discovery failed for %s", provider, exc_info=True)
                summary["errors"][provider] = f"Scoperta modelli fallita: {type(exc).__name__}"
            # 2) official price check
            try:
                page = await client.get(PRICING_URLS[provider], headers={"User-Agent": BROWSER_UA, "Accept-Language": "en"})
                page.raise_for_status()
                prices = PARSERS[provider](page.text)
                if not prices:
                    raise ValueError("tabella prezzi non riconosciuta")
                for model in models:
                    if model.provider != provider or model.kind != "text":
                        continue
                    found = _lookup(provider, model, prices)
                    if not found:
                        continue
                    model.price_checked_at = now
                    changed = model.input_usd is None or model.output_usd is None or abs(model.input_usd - found[0]) > PRICE_EPSILON or abs(model.output_usd - found[1]) > PRICE_EPSILON
                    if changed:
                        model.proposed_input_usd, model.proposed_output_usd, model.proposed_at = found[0], found[1], now
                        summary["price_changes"].append({"provider": provider, "model_id": model.model_id, "old": [model.input_usd, model.output_usd], "new": list(found)})
                    else:
                        model.proposed_input_usd = model.proposed_output_usd = model.proposed_at = None
                summary["providers"].setdefault(provider, {})["prices_read"] = len(prices)
            except Exception as exc:
                logger.warning("Pricing page check failed for %s", provider, exc_info=True)
                summary["pricing_unverified"].append(provider)
                summary["errors"].setdefault(provider, f"Prezzi non verificabili automaticamente ({type(exc).__name__}: {exc})")

    db.add(AIModelScan(trigger=trigger, summary_json=summary))
    await db.commit()
    return summary


async def scan_loop() -> None:
    """Daily scheduled scan (first run a few minutes after startup)."""
    await asyncio.sleep(300)
    while True:
        try:
            if any((settings.ANTHROPIC_API_KEY, settings.OPENAI_API_KEY, settings.DEEPSEEK_API_KEY)):
                async with AsyncSessionLocal() as db:
                    await run_scan(db, "scheduled")
        except Exception:
            logger.warning("Scheduled model scan failed", exc_info=True)
        await asyncio.sleep(SCAN_INTERVAL_SECONDS)
