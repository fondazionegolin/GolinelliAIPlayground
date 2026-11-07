"""Licence terms for teachers and schools.

A licence has an expiry (NULL = none), a term length and an auto-renew flag. With auto-renew the expiry
moves forward by whole terms when it passes; a fixed date chosen by the admin switches auto-renew off.
A teacher can use the platform only while their own licence AND the licence of their school tenant are valid.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from dateutil.relativedelta import relativedelta
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)
DEFAULT_TERM_MONTHS = 12
EXPIRING_DAYS = 30


def now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def add_months(value: datetime, months: int) -> datetime:
    return value + relativedelta(months=months)


def current_expiry(expires_at: Optional[datetime], auto_renew: bool, term_months: int, at: Optional[datetime] = None) -> Optional[datetime]:
    """The expiry that applies right now, rolling an auto-renewing licence forward by whole terms."""
    expires = _aware(expires_at)
    at = at or now()
    if expires is None:
        return None
    if auto_renew and term_months > 0:
        while expires <= at:
            expires = add_months(expires, term_months)
    return expires


def state(expires: Optional[datetime], at: Optional[datetime] = None) -> str:
    at = at or now()
    if expires is None:
        return "none"
    if expires <= at:
        return "expired"
    return "expiring" if (expires - at).days < EXPIRING_DAYS else "active"


def describe(holder: Any, at: Optional[datetime] = None) -> dict:
    """Licence fields of a User or Tenant row."""
    at = at or now()
    expires = current_expiry(holder.license_expires_at, holder.license_auto_renew, holder.license_term_months, at)
    return {
        "expires_at": expires.isoformat() if expires else None,
        "started_at": _aware(holder.license_started_at).isoformat() if holder.license_started_at else None,
        "auto_renew": bool(holder.license_auto_renew) and expires is not None,
        "term_months": holder.license_term_months,
        "state": state(expires, at),
    }


def effective(user: Any, tenant: Any = None, at: Optional[datetime] = None) -> dict:
    """What actually limits a teacher: the earlier of their own licence and their school tenant's."""
    at = at or now()
    own = describe(user, at)
    is_school = tenant is not None and str(getattr(tenant.tenant_type, "value", tenant.tenant_type)).upper() == "SCHOOL"
    school = describe(tenant, at) if is_school else None
    candidates = [("user", own)] + ([("school", school)] if school else [])
    dated = [(src, d) for src, d in candidates if d["expires_at"]]
    if not dated:
        return {**own, "source": None, "own": own, "school": school}
    src, chosen = min(dated, key=lambda item: item[1]["expires_at"])
    return {**chosen, "source": src, "own": own, "school": school}


def apply(holder: Any, *, mode: str, expires_at: Optional[datetime] = None, months: Optional[int] = None,
          auto_renew: Optional[bool] = None, term_months: Optional[int] = None) -> None:
    """Change the licence of a User or Tenant row.

    mode: date (fixed end, no auto-renew) | extend (add months to the current expiry or to today, whichever is later)
          renew (restart a standard term from today, auto-renew on) | none (no expiry)
    """
    at = now()
    if mode == "date":
        if expires_at is None:
            raise ValueError("Scegli una data di scadenza")
        holder.license_expires_at = _aware(expires_at)
        holder.license_auto_renew = False
    elif mode == "extend":
        if not months or months < 1 or months > 120:
            raise ValueError("Scegli da 1 a 120 mesi")
        base = max(current_expiry(holder.license_expires_at, holder.license_auto_renew, holder.license_term_months, at) or at, at)
        holder.license_expires_at = add_months(base, months)
    elif mode == "renew":
        term = term_months or holder.license_term_months or DEFAULT_TERM_MONTHS
        holder.license_term_months = term
        holder.license_expires_at = add_months(at, term)
        holder.license_auto_renew = True if auto_renew is None else auto_renew
    elif mode == "none":
        holder.license_expires_at = None
        holder.license_auto_renew = True
    else:
        raise ValueError("Modalità di licenza non valida")
    if holder.license_started_at is None or mode == "renew":
        holder.license_started_at = at
    if mode in {"date", "extend"} and auto_renew is not None:
        holder.license_auto_renew = auto_renew
    if term_months and mode != "renew":
        holder.license_term_months = term_months


def start_default(holder: Any, fixed_end: Optional[datetime] = None) -> None:
    """New account/tenant: standard 12 months with auto-renew, or the fixed end chosen at invite time."""
    at = now()
    holder.license_started_at = at
    if fixed_end:
        holder.license_expires_at = _aware(fixed_end)
        holder.license_auto_renew = False
    else:
        holder.license_term_months = DEFAULT_TERM_MONTHS
        holder.license_expires_at = add_months(at, DEFAULT_TERM_MONTHS)
        holder.license_auto_renew = True


async def renew_due(db: AsyncSession) -> int:
    """Persist auto-renewals that are due. Reads already roll forward, so this only keeps stored values tidy."""
    from app.models.tenant import Tenant
    from app.models.user import User
    changed = 0
    at = now()
    for model in (User, Tenant):
        rows = (await db.scalars(select(model).where(model.license_expires_at.is_not(None), model.license_expires_at <= at,
                                                     model.license_auto_renew.is_(True)))).all()
        for row in rows:
            row.license_expires_at = current_expiry(row.license_expires_at, True, row.license_term_months, at)
            changed += 1
    if changed:
        await db.commit()
    return changed


async def renew_loop() -> None:
    import asyncio
    from app.core.database import AsyncSessionLocal
    while True:
        try:
            async with AsyncSessionLocal() as db:
                count = await renew_due(db)
                if count:
                    logger.info("Auto-renewed %s licences", count)
        except Exception:
            logger.warning("Licence renewal failed", exc_info=True)
        await asyncio.sleep(6 * 3600)
