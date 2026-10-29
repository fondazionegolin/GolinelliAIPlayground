"""Onboarding istituti: invito al dirigente, doppia accettazione, pannello dirigente.

Tre router:
- `admin_router`  (/admin/school-onboarding)  inviti + registro MIM, solo ADMIN
- `public_router` (/school-onboarding)        pagina d'invito del dirigente (token)
- `owner_router`  (/school-owner)             pannello del dirigente (max docenti)
"""
import re
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Annotated, Literal, Optional
from uuid import UUID

import base64
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_current_teacher, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.legal_documents import DEPLOYER_AGREEMENT, LEGAL_DOCUMENTS
from app.core.school_documents import (
    PLATFORM_SUMMARY,
    deployer_agreement_html,
    family_notice_html,
    legal_doc_html,
)
from app.core.security import create_access_token, get_password_hash
from app.core.url_utils import resolve_frontend_url
from app.models.enums import TenantType, UserRole
from app.models.school_onboarding import ItalianSchool, SchoolOnboardingInvite
from app.models.tenant import Tenant
from app.models.user import ActivationToken, LegalDocumentAcceptance, User
from app.services import school_overview, school_registry
from app.services.credit_service import credit_service
from app.services.email_service import email_service

admin_router = APIRouter()
public_router = APIRouter()
owner_router = APIRouter()

MAX_PILOT_TEACHERS = 5  # docenti invitabili dal dirigente, escluso il dirigente stesso
DEFAULT_INVITE_DAYS = 30


# ── helpers ──────────────────────────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", school_registry.normalize(value)).strip("-")
    return slug[:60] or "istituto"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    slug, n = base, 2
    while (await db.execute(select(Tenant.id).where(Tenant.slug == slug))).first():
        slug = f"{base}-{n}"
        n += 1
    return slug


def _effective_status(inv: SchoolOnboardingInvite) -> str:
    if inv.status == "PENDING" and inv.expires_at < _now():
        return "EXPIRED"
    return inv.status


def _invite_link(origin: str | None, token: str) -> str:
    return f"{resolve_frontend_url(origin)}/school-invite/{token}"


def _record_delivery(obj, sent: bool, error: str | None) -> None:
    """Every send attempt leaves a trace on the invite (or activation token): outcome, reason, count."""
    obj.email_attempts = (obj.email_attempts or 0) + 1
    obj.email_status = "SENT" if sent else "FAILED"
    obj.email_error = None if sent else error
    if sent:
        obj.email_sent_at = _now()


def _pixel(origin: str | None, kind: str, ident) -> str:
    """1×1 image that tells us the e-mail was opened (an estimate: some clients block images, some prefetch them)."""
    url = f"{resolve_frontend_url(origin)}{settings.API_V1_PREFIX}/school-onboarding/track/{kind}/{ident}.gif"
    return f'<img src="{escape(url)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">'


def _organization(inv: SchoolOnboardingInvite) -> dict | None:
    if not inv.organization_name:
        return None
    return {"name": inv.organization_name, "comune": inv.organization_comune, "province": inv.organization_province}


def _invite_to_dict(inv: SchoolOnboardingInvite, origin: str | None, tenant: Tenant | None = None) -> dict:
    return {
        **school_overview.invite_summary(inv),
        "id": str(inv.id),
        "mode": inv.mode,
        "status": _effective_status(inv),
        "tenant_id": str(inv.tenant_id) if inv.tenant_id else None,
        "tenant_name": tenant.name if tenant else None,
        "mechanographic_code": inv.mechanographic_code,
        "email": inv.email,
        "first_name": inv.first_name,
        "last_name": inv.last_name,
        "label": inv.label,
        "link": _invite_link(origin, inv.token) if inv.status == "PENDING" else None,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
        "expires_at": inv.expires_at.isoformat(),
        "opened_at": inv.opened_at.isoformat() if inv.opened_at else None,
        "completed_at": inv.completed_at.isoformat() if inv.completed_at else None,
        "email_sent_at": inv.email_sent_at.isoformat() if inv.email_sent_at else None,
        "organization": _organization(inv),
        "registry_verified": bool(tenant and tenant.registry_verified),
    }


def _email_shell(title: str, body_html: str, cta_label: str, link: str, pixel: str = "") -> str:
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px">
<div style="background:#1a1a2e;padding:24px;border-radius:10px 10px 0 0;text-align:center">
<h1 style="color:#fff;margin:0;font-size:22px">Golinelli.ai</h1></div>
<div style="background:#fff;padding:28px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px">
<h2 style="margin-top:0">{escape(title)}</h2>{body_html}
<div style="text-align:center;margin:28px 0"><a href="{escape(link)}" style="background:#e85c8d;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:600">{escape(cta_label)}</a></div>
<p style="font-size:12px;color:#777">Se il pulsante non funziona copia questo indirizzo nel browser:<br>{escape(link)}</p>
</div>{pixel}</body></html>"""


async def _send_principal_invite_email(inv: SchoolOnboardingInvite, school_name: str | None, link: str,
                                       origin: str | None = None) -> bool:
    """Sends the invite and records the outcome on it (sent, or why not)."""
    if not inv.email:
        return False
    greeting = f"Gentile {escape(' '.join(filter(None, [inv.first_name, inv.last_name])))}," if (inv.first_name or inv.last_name) else "Gentile Dirigente,"
    school = f" per <strong>{escape(school_name)}</strong>" if school_name else ""
    note = f'<p style="padding:10px;background:#f6f6f9;border-radius:6px">{escape(inv.custom_message)}</p>' if inv.custom_message else ""
    body = (
        f"<p>{greeting}</p>"
        f"<p>la Fondazione Golinelli la invita ad attivare l'accesso{school} alla sperimentazione di "
        f"<strong>Golinelli.ai</strong>.</p><p>{escape(PLATFORM_SUMMARY)}</p>"
        "<p>Seguendo il link potrà leggere e accettare le condizioni d'uso in qualità di Dirigente, "
        "creare il proprio accesso e gestire il pannello dell'Istituto: da lì potrà invitare fino a "
        f"<strong>{MAX_PILOT_TEACHERS} docenti</strong> e troverà la bozza di informativa per le famiglie.</p>{note}"
    )
    sent, error = await email_service.send_email_result(
        to_email=inv.email,
        subject="Invito alla sperimentazione Golinelli.ai per il Suo istituto",
        html_content=_email_shell("Invito alla sperimentazione", body, "Apri l'invito", link, _pixel(origin, "invite", inv.id)),
        text_content=f"Invito alla sperimentazione Golinelli.ai. Apra il link per accettare le condizioni e attivare l'accesso: {link}",
    )
    _record_delivery(inv, sent, error)
    return sent


# ═════════════════════════════ ADMIN ═════════════════════════════════════════
class InviteCreate(BaseModel):
    mode: Literal["EMAIL", "SINGLE_USE_LINK"] = "EMAIL"
    mechanographic_code: Optional[str] = Field(default=None, max_length=16)
    email: Optional[EmailStr] = None
    first_name: Optional[str] = Field(default=None, max_length=120)
    last_name: Optional[str] = Field(default=None, max_length=120)
    custom_message: Optional[str] = Field(default=None, max_length=1000)
    label: Optional[str] = Field(default=None, max_length=160)
    expires_in_days: int = Field(default=DEFAULT_INVITE_DAYS, ge=1, le=180)
    send_email: bool = True
    # Organizzazione fuori dal registro MIM (scuole non statali/paritarie, enti, scuole estere, …).
    organization_name: Optional[str] = Field(default=None, max_length=255)
    organization_comune: Optional[str] = Field(default=None, max_length=128)
    organization_province: Optional[str] = Field(default=None, max_length=64)


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


async def _manual_school_tenant(db: AsyncSession, name: str) -> Tenant:
    """A school (or other organization) that is not in the MIM registry: a SCHOOL tenant without a code.

    An existing one with the same name and no principal yet is reused, so a second invite does not duplicate it.
    """
    existing = (await db.execute(
        select(Tenant).where(func.lower(Tenant.name) == name.lower(), Tenant.tenant_type == TenantType.SCHOOL.value,
                             Tenant.mechanographic_code.is_(None))
    )).scalars().first()
    if existing:
        if existing.owner_user_id:
            raise HTTPException(status_code=409, detail=f"L'organizzazione «{existing.name}» ha già un dirigente attivo")
        return existing
    tenant = Tenant(
        name=name, slug=await _unique_slug(db, _slugify(name)), tenant_type=TenantType.SCHOOL.value,
        max_teachers=MAX_PILOT_TEACHERS, mechanographic_code=None, registry_verified=False,
    )
    db.add(tenant)
    await db.flush()
    await credit_service.ensure_school_global_limit(db, tenant.id, tenant.monthly_credit_pool or 10.0)
    return tenant


@admin_router.get("/registry/search")
async def admin_registry_search(
    q: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    province: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 15,
):
    schools = await school_registry.search_schools(db, q, province=province, kind=kind, limit=limit)
    codes = [s.code for s in schools]
    taken = {}
    if codes:
        rows = await db.execute(
            select(Tenant.mechanographic_code, Tenant.id, Tenant.name).where(Tenant.mechanographic_code.in_(codes))
        )
        taken = {r[0]: {"tenant_id": str(r[1]), "tenant_name": r[2]} for r in rows.all()}
    return [{**school_registry.school_to_dict(s), "tenant": taken.get(s.code)} for s in schools]


@admin_router.get("/registry/status")
async def admin_registry_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    return await school_registry.registry_stats(db)


@admin_router.post("/registry/sync")
async def admin_registry_sync(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Riscarica l'anagrafe scuole dal portale open data del MIM (statali + paritarie)."""
    try:
        return await school_registry.sync_registry(db)
    except Exception as exc:  # rete / formato file
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Sincronizzazione registro fallita: {exc}")


class TenantRegistryLink(BaseModel):
    mechanographic_code: str = Field(min_length=4, max_length=16)


@admin_router.put("/tenants/{tenant_id}/registry")
async def link_tenant_to_registry(
    tenant_id: UUID,
    body: TenantRegistryLink,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Mappa un tenant esistente a una scuola del registro (certifica il meccanografico)."""
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant non trovato")
    code = body.mechanographic_code.strip().upper()
    school = (await db.execute(select(ItalianSchool).where(ItalianSchool.code == code))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=404, detail="Codice meccanografico non presente nel registro MIM")
    clash = (await db.execute(
        select(Tenant.name).where(Tenant.mechanographic_code == code, Tenant.id != tenant.id)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(status_code=409, detail=f"Codice già associato a «{clash}»")
    tenant.mechanographic_code = code
    tenant.registry_verified = True
    await db.commit()
    return {"tenant_id": str(tenant.id), "mechanographic_code": code, "registry_verified": True,
            "school": school_registry.school_to_dict(school)}


@admin_router.delete("/tenants/{tenant_id}/registry")
async def unlink_tenant_from_registry(
    tenant_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant non trovato")
    tenant.mechanographic_code = None
    tenant.registry_verified = False
    await db.commit()
    return {"ok": True}


async def _get_or_create_school_tenant(db: AsyncSession, school: ItalianSchool) -> Tenant:
    tenant = (await db.execute(
        select(Tenant).where(Tenant.mechanographic_code == school.code)
    )).scalar_one_or_none()
    if tenant:
        return tenant
    tenant = Tenant(
        name=school.name.title() if school.name.isupper() else school.name,
        slug=await _unique_slug(db, _slugify(f"{school.name}-{school.code}")),
        tenant_type=TenantType.SCHOOL.value,
        max_teachers=MAX_PILOT_TEACHERS,
        mechanographic_code=school.code,
        registry_verified=True,
    )
    db.add(tenant)
    await db.flush()
    await credit_service.ensure_school_global_limit(db, tenant.id, tenant.monthly_credit_pool or 10.0)
    return tenant


@admin_router.post("/invites")
async def create_school_invite(
    body: InviteCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    if body.mode == "EMAIL" and not body.email:
        raise HTTPException(status_code=400, detail="Per l'invito via e-mail serve l'indirizzo del dirigente")
    email = str(body.email).strip().lower() if body.email else None
    if email and (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(status_code=400, detail="Questa e-mail è già registrata sulla piattaforma")

    tenant: Tenant | None = None
    code: str | None = None
    if body.mechanographic_code:
        code = body.mechanographic_code.strip().upper()
        school = (await db.execute(select(ItalianSchool).where(ItalianSchool.code == code))).scalar_one_or_none()
        if not school:
            raise HTTPException(status_code=404, detail="Codice meccanografico non presente nel registro MIM")
        tenant = await _get_or_create_school_tenant(db, school)
        if tenant.owner_user_id:
            raise HTTPException(status_code=409, detail=f"L'istituto «{tenant.name}» ha già un dirigente attivo")
    elif organization := _clean(body.organization_name):
        tenant = await _manual_school_tenant(db, organization)
    # un solo invito PENDING per istituto: i precedenti vengono revocati
    if tenant:
        for old in (await db.execute(
            select(SchoolOnboardingInvite).where(
                SchoolOnboardingInvite.tenant_id == tenant.id, SchoolOnboardingInvite.status == "PENDING"
            )
        )).scalars().all():
            old.status = "REVOKED"

    inv = SchoolOnboardingInvite(
        token=secrets.token_urlsafe(32),
        mode=body.mode,
        tenant_id=tenant.id if tenant else None,
        mechanographic_code=code,
        email=email,
        first_name=body.first_name,
        last_name=body.last_name,
        custom_message=body.custom_message,
        label=body.label,
        created_by_id=admin.id,
        expires_at=_now() + timedelta(days=body.expires_in_days),
        organization_name=None if code else _clean(body.organization_name),
        organization_comune=None if code else _clean(body.organization_comune),
        organization_province=None if code else _clean(body.organization_province),
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)

    origin = request.headers.get("origin")
    email_sent = False
    if body.mode == "EMAIL" and body.send_email:
        email_sent = await _send_principal_invite_email(inv, tenant.name if tenant else None, _invite_link(origin, inv.token), origin)
        await db.commit()
    return {**_invite_to_dict(inv, origin, tenant), "email_sent": email_sent}


@admin_router.get("/invites")
async def list_school_invites(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    tenant_id: Optional[UUID] = None,
):
    stmt = select(SchoolOnboardingInvite, Tenant).outerjoin(Tenant, Tenant.id == SchoolOnboardingInvite.tenant_id)
    if tenant_id:
        stmt = stmt.where(SchoolOnboardingInvite.tenant_id == tenant_id)
    stmt = stmt.order_by(SchoolOnboardingInvite.created_at.desc()).limit(300)
    origin = request.headers.get("origin")
    return [_invite_to_dict(inv, origin, t) for inv, t in (await db.execute(stmt)).all()]


async def _load_invite(db: AsyncSession, invite_id: UUID) -> SchoolOnboardingInvite:
    inv = (await db.execute(
        select(SchoolOnboardingInvite).where(SchoolOnboardingInvite.id == invite_id)
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invito non trovato")
    return inv


@admin_router.post("/invites/{invite_id}/revoke")
async def revoke_school_invite(
    invite_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    inv = await _load_invite(db, invite_id)
    if inv.status != "PENDING":
        raise HTTPException(status_code=400, detail="Solo gli inviti in attesa possono essere revocati")
    inv.status = "REVOKED"
    await db.commit()
    return {"ok": True}


@admin_router.post("/invites/{invite_id}/resend")
async def resend_school_invite(
    invite_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    inv = await _load_invite(db, invite_id)
    if inv.status != "PENDING":
        raise HTTPException(status_code=400, detail="Invito non più valido: creane uno nuovo")
    if not inv.email:
        raise HTTPException(status_code=400, detail="Invito senza e-mail: copia il link e inviarlo manualmente")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == inv.tenant_id))).scalar_one_or_none() if inv.tenant_id else None
    inv.expires_at = max(inv.expires_at, _now() + timedelta(days=DEFAULT_INVITE_DAYS))
    origin = request.headers.get("origin")
    sent = await _send_principal_invite_email(inv, tenant.name if tenant else None, _invite_link(origin, inv.token), origin)
    await db.commit()
    return {"email_sent": sent, "email_error": inv.email_error}


_EMAIL_HEALTH: dict = {}


@admin_router.get("/email-health")
async def email_health(admin: Annotated[User, Depends(get_current_admin)], refresh: bool = False):
    """Can the platform send e-mail? Logs in to the SMTP server (nothing is sent); cached for two minutes."""
    if refresh or not _EMAIL_HEALTH or time.monotonic() - _EMAIL_HEALTH["at"] > 120:
        ok, error = await email_service.check()
        _EMAIL_HEALTH.update(at=time.monotonic(), ok=ok, error=error, checked_at=_now().isoformat(),
                             sender=settings.SMTP_FROM_EMAIL, host=settings.SMTP_HOST)
    return {k: v for k, v in _EMAIL_HEALTH.items() if k != "at"}


@admin_router.get("/schools")
async def admin_school_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    """Every school with its funnel, principal, invited teachers, activity and credits."""
    return await school_overview.school_overview(db)


# ═════════════════════════════ PUBLIC (dirigente) ════════════════════════════
async def _valid_invite(db: AsyncSession, token: str) -> SchoolOnboardingInvite:
    inv = (await db.execute(
        select(SchoolOnboardingInvite).where(SchoolOnboardingInvite.token == token)
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invito non valido")
    state = _effective_status(inv)
    if state == "COMPLETED":
        raise HTTPException(status_code=410, detail="Questo invito è già stato utilizzato")
    if state == "REVOKED":
        raise HTTPException(status_code=410, detail="Questo invito è stato revocato")
    if state == "EXPIRED":
        raise HTTPException(status_code=410, detail="Questo invito è scaduto: chiedi un nuovo link")
    return inv


def _principal_documents() -> list[dict]:
    return [*LEGAL_DOCUMENTS, DEPLOYER_AGREEMENT]


@public_router.get("/invites/{token}")
async def get_invite_public(token: str, db: Annotated[AsyncSession, Depends(get_db)]):
    inv = await _valid_invite(db, token)
    inv.opened_at = inv.opened_at or _now()
    inv.last_opened_at = _now()
    inv.open_count = (inv.open_count or 0) + 1
    await db.commit()
    school = None
    if inv.mechanographic_code:
        row = (await db.execute(
            select(ItalianSchool).where(ItalianSchool.code == inv.mechanographic_code)
        )).scalar_one_or_none()
        school = school_registry.school_to_dict(row) if row else None
    # Fuori registro: l'organizzazione indicata dall'admin, o da indicare a mano da chi apre il link.
    organization = _organization(inv)
    tenant = await _invite_tenant(db, inv)
    if not organization and tenant and not school:
        organization = {"name": tenant.name, "comune": None, "province": None}
    return {
        "mode": inv.mode,
        "school": school,
        "email": inv.email,
        "first_name": inv.first_name,
        "last_name": inv.last_name,
        "custom_message": inv.custom_message,
        "platform_summary": PLATFORM_SUMMARY,
        "max_teachers": MAX_PILOT_TEACHERS,
        "documents": _principal_documents(),
        "expires_at": inv.expires_at.isoformat(),
        "organization": organization,
        "accepted": list((inv.progress or {}).get("accepted") or []),
    }


async def _invite_tenant(db: AsyncSession, inv: SchoolOnboardingInvite) -> Tenant | None:
    if not inv.tenant_id:
        return None
    return (await db.execute(select(Tenant).where(Tenant.id == inv.tenant_id))).scalar_one_or_none()


class InviteProgress(BaseModel):
    accepted: list[str] = Field(default_factory=list, max_length=20)


@public_router.post("/invites/{token}/progress")
async def invite_progress(token: str, body: InviteProgress, db: Annotated[AsyncSession, Depends(get_db)]):
    """Documents ticked so far on the invite page: the admin sees a partial acceptance before it is confirmed."""
    inv = await _valid_invite(db, token)
    keys = {d["key"] for d in _principal_documents()}
    inv.progress = {"accepted": [k for k in dict.fromkeys(body.accepted) if k in keys], "updated_at": _now().isoformat()}
    await db.commit()
    return {"ok": True, "accepted": inv.progress["accepted"], "total": len(keys)}


_GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")


@public_router.get("/track/{kind}/{ident}.gif", include_in_schema=False)
async def track_email_open(kind: str, ident: str, db: Annotated[AsyncSession, Depends(get_db)]):
    """Pixel of the invite e-mails: the first load marks the e-mail as read. Always answers with the image."""
    try:
        key = UUID(ident)
        model = {"invite": SchoolOnboardingInvite, "teacher": ActivationToken}.get(kind)
        if model is not None:
            row = (await db.execute(select(model).where(model.id == key))).scalar_one_or_none()
            if row is not None and row.email_opened_at is None:
                row.email_opened_at = _now()
                await db.commit()
    except (ValueError, TypeError):
        pass
    return Response(content=_GIF, media_type="image/gif",
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache"})


@public_router.get("/invites/{token}/registry-search")
async def invite_registry_search(
    token: str,
    q: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    province: Optional[str] = None,
):
    """Ricerca nel registro MIM per chi apre un link monouso (serve un token valido)."""
    await _valid_invite(db, token)
    schools = await school_registry.search_schools(db, q, province=province, limit=12)
    codes = [s.code for s in schools]
    taken: set[str] = set()
    if codes:
        taken = {r[0] for r in (await db.execute(
            select(Tenant.mechanographic_code).where(
                Tenant.mechanographic_code.in_(codes), Tenant.owner_user_id.is_not(None)
            )
        )).all()}
    return [
        {**{k: v for k, v in school_registry.school_to_dict(s).items() if k not in ("email", "pec")},
         "available": s.code not in taken}
        for s in schools
    ]


class InviteComplete(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    mechanographic_code: Optional[str] = Field(default=None, max_length=16)
    accepted_documents: list[str]
    # Per chi apre un link monouso e non trova il proprio istituto nel registro MIM.
    organization_name: Optional[str] = Field(default=None, max_length=255)
    organization_comune: Optional[str] = Field(default=None, max_length=128)
    organization_province: Optional[str] = Field(default=None, max_length=64)


@public_router.post("/invites/{token}/complete")
async def complete_invite(
    token: str,
    body: InviteComplete,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    inv = await _valid_invite(db, token)
    docs = _principal_documents()
    missing = [d["title"] for d in docs if d["key"] not in set(body.accepted_documents)]
    if missing:
        raise HTTPException(status_code=400, detail="Devi accettare tutti i documenti: " + "; ".join(missing))

    email = str(body.email).strip().lower()
    if inv.email and inv.email.lower() != email:
        email = inv.email.lower()  # per gli inviti nominativi l'e-mail è quella dell'invito
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(status_code=400, detail="Questa e-mail è già registrata sulla piattaforma")

    # The school was fixed by the admin (from the registry or by hand), picked from the registry, or typed in.
    tenant = await _invite_tenant(db, inv)
    code = (inv.mechanographic_code or ("" if tenant else body.mechanographic_code) or "").strip().upper() or None
    if not tenant and code:
        school = (await db.execute(select(ItalianSchool).where(ItalianSchool.code == code))).scalar_one_or_none()
        if not school:
            raise HTTPException(status_code=400, detail="Istituto non presente nel registro MIM")
        tenant = await _get_or_create_school_tenant(db, school)
    elif not tenant:
        organization = _clean(body.organization_name)
        if not organization:
            raise HTTPException(status_code=400, detail="Seleziona il tuo istituto dal registro o scrivi il nome dell'organizzazione")
        tenant = await _manual_school_tenant(db, organization)
        inv.organization_name = organization
        inv.organization_comune = _clean(body.organization_comune)
        inv.organization_province = _clean(body.organization_province)
    if tenant.owner_user_id:
        raise HTTPException(status_code=409, detail="Per questo istituto è già stato attivato un dirigente")

    owner = User(
        tenant_id=tenant.id,
        email=email,
        password_hash=get_password_hash(body.password),
        role=UserRole.TEACHER,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        institution=tenant.name,
        is_verified=True,
        is_school_owner=True,
    )
    db.add(owner)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Questa e-mail è già registrata sulla piattaforma")
    tenant.owner_user_id = owner.id
    tenant.max_teachers = tenant.max_teachers or MAX_PILOT_TEACHERS

    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    for doc in docs:
        db.add(LegalDocumentAcceptance(
            tenant_id=tenant.id, user_id=owner.id, document_key=doc["key"],
            document_title=doc["title"], document_version=doc["version"], ip_address=ip, user_agent=ua,
        ))
    inv.status = "COMPLETED"
    inv.completed_at = _now()
    inv.claimed_user_id = owner.id
    inv.tenant_id = tenant.id
    inv.mechanographic_code = code or tenant.mechanographic_code
    await db.commit()

    access_token = create_access_token(
        subject=str(owner.id),
        extra_claims={"role": owner.role.value, "tenant_id": str(tenant.id)},
    )
    response.set_cookie(
        key="access_token", value=access_token, httponly=True, secure=True, samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    return {"access_token": access_token, "user_id": str(owner.id), "role": owner.role.value,
            "tenant_id": str(tenant.id), "redirect": "/teacher/school"}


@public_router.get("/documents/{key}")
async def public_legal_document(
    key: str,
    school_name: Optional[str] = None,
    code: Optional[str] = None,
):
    """Testo HTML dei documenti dell'onboarding (accordo dirigente, dichiarazione docente)."""
    ctx = {"school_name": school_name or "[Istituto]"}
    if key == "deployer-agreement":
        ctx["code"] = code
    found = legal_doc_html(key, **ctx)
    if not found:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    title, html = found
    return {"key": key, "title": title, "html": html}


# ═════════════════════════════ PANNELLO DIRIGENTE ═════════════════════════════
async def _owner_tenant(db: AsyncSession, owner: User) -> Tenant:
    if not owner.is_school_owner:
        raise HTTPException(status_code=403, detail="Solo il dirigente dell'istituto può accedere a questo pannello")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == owner.tenant_id))).scalar_one_or_none()
    if not tenant or str(getattr(tenant.tenant_type, "value", tenant.tenant_type)) != TenantType.SCHOOL.value:
        raise HTTPException(status_code=403, detail="Funzione disponibile solo per gli istituti")
    return tenant


async def _teacher_rows(db: AsyncSession, tenant: Tenant, owner: User) -> list[dict]:
    """The principal's teachers, with the same states, e-mail delivery and acceptances the admin sees."""
    overview = await school_overview.school_overview(db, [tenant.id])
    return overview[0]["teachers"] if overview else []


@owner_router.get("/status")
async def owner_status(current_user: Annotated[User, Depends(get_current_user)]):
    """Leggero: serve alla navbar per mostrare il link «Istituto» solo al dirigente."""
    return {"is_school_owner": bool(current_user.is_school_owner and current_user.role == UserRole.TEACHER)}


@owner_router.get("/panel")
async def owner_panel(
    db: Annotated[AsyncSession, Depends(get_db)],
    owner: Annotated[User, Depends(get_current_teacher)],
):
    tenant = await _owner_tenant(db, owner)
    teachers = await _teacher_rows(db, tenant, owner)
    used = sum(1 for t in teachers if t["state"] != "DEACTIVATED")
    school = None
    if tenant.mechanographic_code:
        row = (await db.execute(
            select(ItalianSchool).where(ItalianSchool.code == tenant.mechanographic_code)
        )).scalar_one_or_none()
        school = school_registry.school_to_dict(row) if row else None
    return {
        "school": {
            "name": tenant.name, "mechanographic_code": tenant.mechanographic_code,
            "registry_verified": tenant.registry_verified, "registry": school,
        },
        "principal": {"first_name": owner.first_name, "last_name": owner.last_name, "email": owner.email},
        "max_teachers": MAX_PILOT_TEACHERS,
        "used_slots": used,
        "teachers": teachers,
    }


class TeacherInvite(BaseModel):
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)


async def _send_teacher_invite_email(user: User, school: str, principal: str, link: str,
                                     token: ActivationToken | None = None, origin: str | None = None) -> bool:
    body = (
        f"<p>Gentile {escape(user.first_name or '')} {escape(user.last_name or '')},</p>"
        f"<p>il Dirigente <strong>{escape(principal)}</strong> la invita a partecipare alla sperimentazione di "
        f"<strong>Golinelli.ai</strong> per <strong>{escape(school)}</strong>.</p>"
        "<p>Apra il link per scegliere la password: l'account docente sarà subito attivo. Al primo accesso "
        "le sarà chiesto di leggere e accettare le condizioni d'uso e la dichiarazione d'uso del docente.</p>"
    )
    sent, error = await email_service.send_email_result(
        to_email=user.email,
        subject=f"Invito a Golinelli.ai da {school}",
        html_content=_email_shell("Sei stato invitato", body, "Attiva il tuo account", link,
                                  _pixel(origin, "teacher", token.id) if token else ""),
        text_content=f"Invito a Golinelli.ai da {school}. Attiva il tuo account: {link}",
    )
    if token is not None:
        _record_delivery(token, sent, error)
    return sent


@owner_router.post("/teachers")
async def owner_invite_teacher(
    body: TeacherInvite,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    owner: Annotated[User, Depends(get_current_teacher)],
):
    tenant = await _owner_tenant(db, owner)
    used = (await db.execute(
        select(func.count(User.id)).where(
            User.tenant_id == tenant.id, User.role == UserRole.TEACHER,
            User.is_active == True, User.id != owner.id,  # noqa: E712
        )
    )).scalar_one() or 0
    if used >= MAX_PILOT_TEACHERS:
        raise HTTPException(status_code=403, detail=f"Hai raggiunto il limite di {MAX_PILOT_TEACHERS} docenti della sperimentazione")

    email = str(body.email).strip().lower()
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(status_code=400, detail="Questa e-mail è già registrata sulla piattaforma")

    temp_password = secrets.token_urlsafe(12)
    teacher = User(
        tenant_id=tenant.id, email=email, password_hash=get_password_hash(temp_password),
        role=UserRole.TEACHER, first_name=body.first_name.strip(), last_name=body.last_name.strip(),
        institution=tenant.name, is_verified=True,
    )
    db.add(teacher)
    await db.flush()
    activation_token = secrets.token_urlsafe(48)
    token = ActivationToken(
        user_id=teacher.id, token=activation_token, temporary_password=temp_password,
        expires_at=_now() + timedelta(hours=settings.ACTIVATION_TOKEN_EXPIRE_HOURS),
    )
    db.add(token)
    await db.commit()

    origin = request.headers.get("origin")
    link = f"{resolve_frontend_url(origin)}/activate/{activation_token}"
    principal = " ".join(filter(None, [owner.first_name, owner.last_name])) or owner.email
    sent = await _send_teacher_invite_email(teacher, tenant.name, principal, link, token, origin)
    await db.commit()
    return {"teacher_id": str(teacher.id), "email_sent": sent, "email_error": token.email_error, "link": link if not sent else None}


async def _owned_teacher(db: AsyncSession, owner: User, tenant: Tenant, teacher_id: UUID) -> User:
    teacher = (await db.execute(
        select(User).where(User.id == teacher_id, User.tenant_id == tenant.id, User.id != owner.id,
                           User.role == UserRole.TEACHER)
    )).scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Docente non trovato")
    return teacher


@owner_router.post("/teachers/{teacher_id}/resend")
async def owner_resend_teacher_invite(
    teacher_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    owner: Annotated[User, Depends(get_current_teacher)],
):
    tenant = await _owner_tenant(db, owner)
    teacher = await _owned_teacher(db, owner, tenant, teacher_id)
    tok = (await db.execute(
        select(ActivationToken).where(ActivationToken.user_id == teacher.id)
        .order_by(ActivationToken.created_at.desc())
    )).scalars().first()
    if not tok or tok.is_used:
        raise HTTPException(status_code=400, detail="Il docente ha già attivato l'account")
    tok.expires_at = _now() + timedelta(hours=settings.ACTIVATION_TOKEN_EXPIRE_HOURS)
    origin = request.headers.get("origin")
    link = f"{resolve_frontend_url(origin)}/activate/{tok.token}"
    principal = " ".join(filter(None, [owner.first_name, owner.last_name])) or owner.email
    sent = await _send_teacher_invite_email(teacher, tenant.name, principal, link, tok, origin)
    await db.commit()
    return {"email_sent": sent, "email_error": tok.email_error, "link": link if not sent else None}


@owner_router.delete("/teachers/{teacher_id}")
async def owner_remove_teacher(
    teacher_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    owner: Annotated[User, Depends(get_current_teacher)],
):
    """Libera uno slot: disattiva il docente (i suoi contenuti restano nell'istituto)."""
    tenant = await _owner_tenant(db, owner)
    teacher = await _owned_teacher(db, owner, tenant, teacher_id)
    teacher.is_active = False
    teacher.deactivated_at = _now()
    await db.commit()
    return {"ok": True}


@owner_router.get("/family-notice")
async def owner_family_notice(
    db: Annotated[AsyncSession, Depends(get_db)],
    owner: Annotated[User, Depends(get_current_teacher)],
):
    tenant = await _owner_tenant(db, owner)
    comune = None
    if tenant.mechanographic_code:
        comune = (await db.execute(
            select(ItalianSchool.comune).where(ItalianSchool.code == tenant.mechanographic_code)
        )).scalar_one_or_none()
    principal = " ".join(filter(None, [owner.first_name, owner.last_name])) or None
    return {
        "title": "Informativa alle famiglie – bozza",
        "html": family_notice_html(tenant.name, tenant.mechanographic_code, comune, principal),
    }
