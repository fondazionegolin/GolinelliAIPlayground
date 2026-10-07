"""Admin «Modelli»: LLM catalogue with prices, quality scores, new-model discovery and price proposals."""
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.config import settings
from app.core.database import get_db
from app.core.pricing import USD_TO_EUR
from app.models.ai_model import AIModel, AIModelRole, AIModelScan
from app.models.user import User
import asyncio

from app.services import model_catalog, model_roles

router = APIRouter()
Admin = Annotated[User, Depends(get_current_admin)]
Db = Annotated[AsyncSession, Depends(get_db)]


class ModelUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    status: Literal["active", "available", "deprecated"] | None = None
    input_usd: float | None = Field(default=None, ge=0)
    output_usd: float | None = Field(default=None, ge=0)
    cached_input_usd: float | None = Field(default=None, ge=0)
    context_window: int | None = Field(default=None, ge=0)
    quality_score: float | None = Field(default=None, ge=0, le=100)
    quality_source: str | None = Field(default=None, max_length=200)
    notes: str | None = None
    offered: bool | None = None


class RoleAssign(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    provider: Literal["openai", "anthropic", "deepseek"]
    model_id: str = Field(min_length=1, max_length=120)


class ModelCreate(ModelUpdate):
    provider: Literal["openai", "anthropic", "deepseek"]
    model_id: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=160)


def _serialize(model: AIModel) -> dict:
    blended = model_catalog.blended_usd(model.input_usd, model.output_usd)
    return {
        "id": str(model.id), "kind": model.kind, "offered": model.offered, "price_note": model.price_note, "provider": model.provider, "model_id": model.model_id, "display_name": model.display_name, "status": model.status,
        "input_usd": model.input_usd, "output_usd": model.output_usd, "cached_input_usd": model.cached_input_usd,
        "context_window": model.context_window, "quality_score": model.quality_score, "quality_source": model.quality_source,
        "pricing_url": model.pricing_url, "notes": model.notes, "blended_usd": blended,
        "value_score": round(model.quality_score / blended, 2) if model.quality_score and blended else None,
        "proposed_input_usd": model.proposed_input_usd, "proposed_output_usd": model.proposed_output_usd,
        "proposed_at": model.proposed_at, "price_checked_at": model.price_checked_at, "seen_in_api": model.seen_in_api,
        "is_new": not model.acknowledged, "first_seen_at": model.first_seen_at,
    }


async def _get(db: AsyncSession, model_id: UUID) -> AIModel:
    model = await db.get(AIModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    return model


async def _reapply(db: AsyncSession) -> None:
    model_catalog.apply_runtime_prices(list((await db.execute(select(AIModel))).scalars().all()))


@router.get("")
async def list_models(_: Admin, db: Db) -> dict:
    await model_catalog.seed_if_empty(db)
    models = (await db.execute(select(AIModel).order_by(AIModel.provider, desc(AIModel.input_usd)))).scalars().all()
    last = (await db.execute(select(AIModelScan).order_by(desc(AIModelScan.ran_at)).limit(1))).scalar_one_or_none()
    return {
        "models": [_serialize(m) for m in models],
        "usd_to_eur": USD_TO_EUR,
        "last_scan": {"ran_at": last.ran_at, "trigger": last.trigger, "summary": last.summary_json} if last else None,
        "provider_keys": {"openai": bool(settings.OPENAI_API_KEY), "anthropic": bool(settings.ANTHROPIC_API_KEY), "deepseek": bool(settings.DEEPSEEK_API_KEY)},
        "pricing_urls": model_catalog.PRICING_URLS,
    }


@router.post("/scan")
async def scan_models(_: Admin, db: Db) -> dict:
    return await model_catalog.run_scan(db, "manual")


@router.post("", status_code=201)
async def create_model(payload: ModelCreate, _: Admin, db: Db) -> dict:
    exists = (await db.execute(select(AIModel.id).where(AIModel.provider == payload.provider, AIModel.model_id == payload.model_id))).first()
    if exists:
        raise HTTPException(status_code=409, detail="Modello già presente")
    data = payload.model_dump(exclude_unset=True)
    model = AIModel(**{"status": "active", "pricing_url": model_catalog.PRICING_URLS[payload.provider], **data})
    db.add(model)
    await db.commit()
    await _reapply(db)
    return _serialize(model)


@router.patch("/{model_id}")
async def update_model(model_id: UUID, payload: ModelUpdate, _: Admin, db: Db) -> dict:
    model = await _get(db, model_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(model, key, value)
    if {"input_usd", "output_usd"} & payload.model_fields_set:
        model.proposed_input_usd = model.proposed_output_usd = model.proposed_at = None
    model.acknowledged = True
    await db.commit()
    await _reapply(db)
    return _serialize(model)


@router.post("/{model_id}/apply-proposal")
async def apply_proposal(model_id: UUID, _: Admin, db: Db) -> dict:
    model = await _get(db, model_id)
    if model.proposed_input_usd is None or model.proposed_output_usd is None:
        raise HTTPException(status_code=409, detail="Nessuna proposta di prezzo da applicare")
    model.input_usd, model.output_usd = model.proposed_input_usd, model.proposed_output_usd
    model.proposed_input_usd = model.proposed_output_usd = model.proposed_at = None
    model.price_checked_at = datetime.now(timezone.utc)
    if model.status == "available":
        model.status = "active"
    model.acknowledged = True
    await db.commit()
    await _reapply(db)
    return _serialize(model)


@router.post("/{model_id}/dismiss-proposal")
async def dismiss_proposal(model_id: UUID, _: Admin, db: Db) -> dict:
    model = await _get(db, model_id)
    model.proposed_input_usd = model.proposed_output_usd = model.proposed_at = None
    await db.commit()
    return _serialize(model)


@router.post("/{model_id}/acknowledge")
async def acknowledge(model_id: UUID, _: Admin, db: Db) -> dict:
    model = await _get(db, model_id)
    model.acknowledged = True
    await db.commit()
    return _serialize(model)


# ── roles: which model each part of the platform uses ────────────────────────

def _provider_ready(provider: str) -> bool:
    return bool({"openai": settings.OPENAI_API_KEY, "anthropic": settings.ANTHROPIC_API_KEY, "deepseek": settings.DEEPSEEK_API_KEY}.get(provider))


def _candidate(model: AIModel, recommended: set[str]) -> dict:
    data = _serialize(model)
    data.update(ready=_provider_ready(model.provider), recommended=model.model_id in recommended)
    return data


@router.get("/roles")
async def list_roles(_: Admin, db: Db) -> dict:
    await model_catalog.seed_if_empty(db)
    catalogue = list((await db.execute(select(AIModel).where(AIModel.status != "deprecated"))).scalars().all())
    rows = {row.role: row for row in (await db.execute(select(AIModelRole))).scalars().all()}
    by_key = {(m.provider, m.model_id): m for m in catalogue}
    roles = []
    for role in model_roles.ROLES.values():
        pool = [m for m in catalogue if m.kind == role.kind and (not role.providers or m.provider in role.providers)]
        scored = [m for m in pool if m.quality_score and m.blended_usd_value]
        best = sorted(scored, key=lambda m: m.quality_score / m.blended_usd_value, reverse=True)[:2]
        recommended = {m.model_id for m in best}
        provider, model = model_roles.pair_for(role.id)
        current = by_key.get((provider, model))
        row = rows.get(role.id)
        roles.append({
            "id": role.id, "group": role.group, "label": role.label, "description": role.description, "kind": role.kind, "where": list(role.where),
            "current": {"provider": provider, "model_id": model, "display_name": current.display_name if current else model, "model": _serialize(current) if current else None},
            "default": {"provider": role.default[0], "model_id": role.default[1]},
            "overridden": model_roles.is_overridden(role.id),
            "updated_by": row.updated_by if row else None, "updated_at": row.updated_at if row else None,
            "candidates": sorted((_candidate(m, recommended) for m in pool), key=lambda c: (c["provider"], -(c["input_usd"] or 0))),
        })
    return {"roles": roles, "fixed": model_roles.FIXED_MODELS}


async def _smoke_test(provider: str, model: str) -> None:
    from app.services.llm_service import llm_service
    try:
        await asyncio.wait_for(llm_service.generate(messages=[{"role": "user", "content": "Rispondi solo: ok"}], system_prompt="Test di raggiungibilità.",
                                                    provider=provider, model=model, max_tokens=64), timeout=45)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Il modello {model} non risponde: {str(exc)[:200]}") from exc


@router.put("/roles/{role_id}")
async def assign_role(role_id: str, payload: RoleAssign, admin: Admin, db: Db) -> dict:
    role = model_roles.ROLES.get(role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Ruolo sconosciuto")
    model = (await db.execute(select(AIModel).where(AIModel.provider == payload.provider, AIModel.model_id == payload.model_id))).scalar_one_or_none()
    if not model or model.kind != role.kind or (role.providers and payload.provider not in role.providers):
        raise HTTPException(status_code=422, detail="Modello non compatibile con questa funzione")
    if not _provider_ready(payload.provider):
        raise HTTPException(status_code=422, detail=f"Chiave API {payload.provider} non configurata")
    if role.kind == "text" and (model.input_usd is None or model.output_usd is None):
        raise HTTPException(status_code=422, detail="Imposta prima il prezzo del modello: senza listino le chiamate non verrebbero addebitate")
    if role.kind == "image" and model.input_usd is None:
        raise HTTPException(status_code=422, detail="Imposta prima il prezzo per immagine del modello")
    if role.kind == "text":
        await _smoke_test(payload.provider, payload.model_id)
    await model_roles.save_override(role_id, payload.provider, payload.model_id, admin.email)
    model.acknowledged = True
    if model.status == "available":
        model.status = "active"
    if role_id == "chat.default":
        model.offered = True  # the platform default must be selectable in every chat
    await db.commit()
    await _reapply(db)
    return await list_roles(admin, db)


@router.delete("/roles/{role_id}")
async def reset_role(role_id: str, admin: Admin, db: Db) -> dict:
    if role_id not in model_roles.ROLES:
        raise HTTPException(status_code=404, detail="Ruolo sconosciuto")
    await model_roles.reset_override(role_id)
    return await list_roles(admin, db)
