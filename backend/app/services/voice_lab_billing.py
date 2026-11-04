"""Standard ElevenAPI prices, converted to the platform's internal EUR units.

Public PAYG rates, excluding tax; not the customer's subscription invoice.
https://elevenlabs.io/pricing/api (2026-11-03)
"""
import asyncio
import json
import math
import subprocess
import tempfile
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from app.core.pricing import USD_TO_EUR
from app.models.credits import CreditLimit, CreditTransaction
from app.services.credit_service import credit_service, to_credits

SOURCE = "https://elevenlabs.io/pricing/api"
RATES = {"tts": .08 / 1000, "tts_fast": .04 / 1000, "dialogue": .08 / 1000,
         "music": .15 / 60, "sound_effects": .12 / 60, "convert": .12 / 60,
         "isolate": .12 / 60, "transcribe": .22 / 3600, "alignment": .22 / 3600,
         "dubbing": .50 / 60, "voice_design": .08 / 1000}


def quote(action, *, characters=0, seconds=0, model=""):
    fast = any(token in (model or "").lower() for token in ("flash", "turbo", "conversational"))
    rate = RATES["tts_fast" if action == "tts" and fast else action]
    by_chars = action in {"tts", "dialogue", "voice_design"}
    quantity = characters if by_chars else seconds
    if not math.isfinite(quantity) or quantity < 0:
        raise HTTPException(422, "Durata o quantità non valida")
    usd = round(quantity * rate, 10)
    cost = round(usd * USD_TO_EUR, 10)
    return {"action": action, "cost": cost, "credits": to_credits(cost), "usd": usd,
            "quantity": quantity, "unit": "characters" if by_chars else "seconds",
            "rate_usd": rate, "usd_to_eur": USD_TO_EUR, "source": SOURCE,
            "pricing_basis": "stt_equivalent_estimate" if action == "alignment" else "tts_equivalent_estimate" if action == "voice_design" else "standard_api"}


def _duration(data):
    with tempfile.NamedTemporaryFile(suffix=".media") as media:
        media.write(data); media.flush()
        try:
            result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", media.name], capture_output=True, timeout=30, check=True)
            seconds = float(json.loads(result.stdout)["format"]["duration"])
            if not math.isfinite(seconds) or not 0 < seconds <= 10800:
                raise ValueError("duration")
            return seconds
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
            raise HTTPException(422, "Impossibile leggere la durata del file. Usa un audio valido, fino a 3 ore.") from exc


async def duration(data):
    return await asyncio.to_thread(_duration, data)


async def reserve(db, teacher, price, model=""):
    # Serialize reservations on the same budget; never hold locks during provider I/O.
    limits = await credit_service.get_applicable_limits(db, teacher.tenant_id, teacher_id=teacher.id)
    if limits:
        limits = list((await db.scalars(select(CreditLimit).where(CreditLimit.id.in_([v.id for v in limits])).order_by(CreditLimit.id).with_for_update().execution_options(populate_existing=True))).all())
    if not await credit_service.check_availability(db, teacher.tenant_id, price["cost"], teacher_id=teacher.id):
        raise HTTPException(402, "Crediti insufficienti per questa generazione")
    details = {"type": "voice_lab", "service": "Voice Lab", "action": price["action"],
               "billing_status": "reserved", "pricing": price,
               "limit_periods": {str(v.id): v.period_start.isoformat() for v in limits}}
    tx = await credit_service.track_usage(db, teacher.tenant_id, "elevenlabs", model or price["action"], price["cost"], details, teacher_id=teacher.id)
    return tx


async def settle(db, tx_id, price=None, *, status="settled", commit=True):
    tx = await db.scalar(select(CreditTransaction).where(CreditTransaction.id == UUID(str(tx_id))).with_for_update().execution_options(populate_existing=True))
    if not tx or tx.provider != "elevenlabs" or tx.usage_details.get("billing_status") != "reserved":
        return tx
    delta = (price["cost"] if price else 0) - tx.cost
    snapshots = tx.usage_details.get("limit_periods", {})
    if snapshots:
        limits = (await db.scalars(select(CreditLimit).where(CreditLimit.id.in_([UUID(v) for v in snapshots])).order_by(CreditLimit.id).with_for_update().execution_options(populate_existing=True))).all()
        for limit in limits:
            # A late refund must not subtract usage from a new monthly cycle.
            if snapshots[str(limit.id)] == limit.period_start.isoformat():
                limit.current_usage = max(0, limit.current_usage + delta)
                limit.last_updated = datetime.now(timezone.utc)
                await credit_service.sync_alert(db, limit)
    tx.cost = price["cost"] if price else 0
    tx.usage_details = {**tx.usage_details, "billing_status": status, **({"pricing": price} if price else {})}
    if commit:
        await db.commit()
    return tx


def details(tx, price):
    return {"billing_transaction_id": str(tx.id), "credits": price["credits"], "pricing": price}
