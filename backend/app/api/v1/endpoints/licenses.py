"""Licence terms: bulk updates from the admin panel and the signed-in user's own status."""
from datetime import date, datetime, time
from typing import Annotated, Literal, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.enums import UserRole
from app.models.tenant import Tenant
from app.models.user import User
from app.services import license as licensing

admin_router = APIRouter()
me_router = APIRouter()
Db = Annotated[AsyncSession, Depends(get_db)]
ROME = ZoneInfo("Europe/Rome")


class LicenseChange(BaseModel):
    mode: Literal["date", "extend", "renew", "none"]
    expires_on: Optional[date] = None  # inclusive: the licence works through the end of that day (Rome time)
    months: Optional[int] = Field(default=None, ge=1, le=120)
    term_months: Optional[int] = Field(default=None, ge=1, le=120)
    auto_renew: Optional[bool] = None


class UsersLicenseUpdate(LicenseChange):
    user_ids: list[UUID] = Field(min_length=1, max_length=1000)


def _apply(holder, body: LicenseChange) -> None:
    expires = datetime.combine(body.expires_on, time(23, 59, 59), tzinfo=ROME) if body.expires_on else None
    try:
        licensing.apply(holder, mode=body.mode, expires_at=expires, months=body.months, auto_renew=body.auto_renew, term_months=body.term_months)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@admin_router.put("/users")
async def update_user_licenses(body: UsersLicenseUpdate, db: Db, admin: Annotated[User, Depends(get_current_admin)]):
    """Set the same licence term on a group of teachers at once."""
    ids = list(dict.fromkeys(body.user_ids))
    users = (await db.scalars(select(User).where(User.id.in_(ids), User.role == UserRole.TEACHER))).all()
    if len(users) != len(ids):
        raise HTTPException(404, "Uno o più docenti non sono stati trovati")
    for user in users:
        _apply(user, body)
    await db.commit()
    return {"ok": True, "changed": len(users), "licenses": {str(u.id): licensing.describe(u) for u in users}}


@admin_router.put("/tenants/{tenant_id}")
async def update_tenant_license(tenant_id: UUID, body: LicenseChange, db: Db, admin: Annotated[User, Depends(get_current_admin)]):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Istituto non trovato")
    _apply(tenant, body)
    await db.commit()
    return {"ok": True, "license": licensing.describe(tenant)}


@me_router.get("/me")
async def my_license(db: Db, user: Annotated[User, Depends(get_current_user)]):
    tenant = await db.get(Tenant, user.tenant_id) if user.tenant_id else None
    return licensing.effective(user, tenant)
