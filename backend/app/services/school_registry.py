"""Registro scuole italiane: import dai dati aperti MIM e ricerca per nome/codice."""
from __future__ import annotations

import csv
import io
import logging
import re
import unicodedata
from typing import Iterable

import httpx
from sqlalchemy import case, delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.school_onboarding import ItalianSchool

logger = logging.getLogger(__name__)

CATALOG_BASE = "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/"
CATALOG_INDEX = CATALOG_BASE + "?area=Scuole"
_FILE_RE = re.compile(r"SCUANAGRAFE(STAT|PAR)(\d{14})\.csv", re.I)
_CODE_RE = re.compile(r"^[A-Z0-9]{10}$")
_MISSING = {"", "non disponibile", "n.d.", "nd"}


def normalize(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return None if value.lower() in _MISSING else value


def _title(value: str | None) -> str | None:
    value = _clean(value)
    return value


def _build_row(*, code, name, kind, typology, plessi, region, province, comune, address, cap,
               email, pec, website, year, extra_search: Iterable[str] = ()) -> dict:
    search = normalize(" ".join(filter(None, [name, code, comune, province, region, typology, *extra_search])))
    return {
        "code": code, "name": name, "kind": kind, "typology": typology, "plessi_summary": plessi,
        "region": region, "province": province, "comune": comune, "address": address, "cap": cap,
        "email": email, "pec": pec, "website": website, "school_year": year, "search_text": search,
    }


def parse_statali(text: str) -> list[dict]:
    """Aggrega i plessi statali per istituto di riferimento."""
    groups: dict[str, list[dict]] = {}
    for row in csv.DictReader(io.StringIO(text)):
        ref = (row.get("CODICEISTITUTORIFERIMENTO") or "").strip().upper()
        if _CODE_RE.match(ref):
            groups.setdefault(ref, []).append(row)
    out = []
    for ref, rows in groups.items():
        seat = next((r for r in rows if (r.get("CODICESCUOLA") or "").strip().upper() == ref), rows[0])
        names = []
        for r in rows:
            label = f"{(r.get('DENOMINAZIONESCUOLA') or '').strip()} ({(r.get('DESCRIZIONETIPOLOGIAGRADOISTRUZIONESCUOLA') or '').strip().title()}, {(r.get('DESCRIZIONECOMUNE') or '').strip().title()})"
            if label not in names:
                names.append(label)
        typologies = sorted({(r.get("DESCRIZIONETIPOLOGIAGRADOISTRUZIONESCUOLA") or "").strip().title() for r in rows} - {""})
        out.append(_build_row(
            code=ref,
            name=(seat.get("DENOMINAZIONEISTITUTORIFERIMENTO") or "").strip(),
            kind="STATALE",
            typology=", ".join(typologies)[:255] or None,
            plessi="\n".join(names[:25]),
            region=_title(seat.get("REGIONE")), province=_title(seat.get("PROVINCIA")),
            comune=_title(seat.get("DESCRIZIONECOMUNE")), address=_clean(seat.get("INDIRIZZOSCUOLA")),
            cap=_clean(seat.get("CAPSCUOLA")), email=_clean(seat.get("INDIRIZZOEMAILSCUOLA")),
            pec=_clean(seat.get("INDIRIZZOPECSCUOLA")), website=_clean(seat.get("SITOWEBSCUOLA")),
            year=(seat.get("ANNOSCOLASTICO") or "").strip() or None,
            extra_search=[r.get("DENOMINAZIONESCUOLA") or "" for r in rows],
        ))
    return out


def parse_paritarie(text: str) -> list[dict]:
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        code = (row.get("CODICESCUOLA") or "").strip().upper()
        if not _CODE_RE.match(code):
            continue
        out[code] = _build_row(
            code=code, name=(row.get("DENOMINAZIONESCUOLA") or "").strip(), kind="PARITARIA",
            typology=_clean(row.get("DESCRIZIONETIPOLOGIAGRADOISTRUZIONESCUOLA")), plessi=None,
            region=_title(row.get("REGIONE")), province=_title(row.get("PROVINCIA")),
            comune=_title(row.get("DESCRIZIONECOMUNE")), address=_clean(row.get("INDIRIZZOSCUOLA")),
            cap=_clean(row.get("CAPSCUOLA")), email=_clean(row.get("INDIRIZZOEMAILSCUOLA")),
            pec=_clean(row.get("INDIRIZZOPECSCUOLA")), website=_clean(row.get("SITOWEBSCUOLA")),
            year=(row.get("ANNOSCOLASTICO") or "").strip() or None,
        )
    return list(out.values())


def _decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


async def sync_registry(db: AsyncSession) -> dict:
    """Scarica gli ultimi CSV MIM (statali + paritarie) e sostituisce il registro."""
    async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
        index = (await client.get(CATALOG_INDEX)).text
        latest: dict[str, str] = {}
        for kind, stamp in _FILE_RE.findall(index):
            kind = kind.upper()
            if stamp > latest.get(kind, ""):
                latest[kind] = stamp
        if "STAT" not in latest or "PAR" not in latest:
            raise RuntimeError("File anagrafe scuole non trovati nel catalogo MIM")
        rows: list[dict] = []
        files = {}
        for kind, parser in (("STAT", parse_statali), ("PAR", parse_paritarie)):
            fname = f"SCUANAGRAFE{kind}{latest[kind]}.csv"
            resp = await client.get(CATALOG_BASE + fname)
            resp.raise_for_status()
            parsed = parser(_decode(resp.content))
            if len(parsed) < 1000:
                raise RuntimeError(f"{fname}: troppe poche righe ({len(parsed)}), import annullato")
            rows.extend(parsed)
            files[kind] = {"file": fname, "rows": len(parsed)}

    # I codici statali/paritari sono disgiunti; in caso contrario vince lo statale.
    unique = {r["code"]: r for r in reversed(rows)}
    await db.execute(delete(ItalianSchool))
    values = list(unique.values())
    for i in range(0, len(values), 2000):
        await db.execute(insert(ItalianSchool), values[i:i + 2000])
    await db.commit()
    logger.info("School registry synced: %s", files)
    return {"total": len(values), "files": files}


async def registry_stats(db: AsyncSession) -> dict:
    rows = (await db.execute(
        select(ItalianSchool.kind, func.count(), func.max(ItalianSchool.school_year)).group_by(ItalianSchool.kind)
    )).all()
    return {
        "total": sum(r[1] for r in rows),
        "by_kind": {r[0]: r[1] for r in rows},
        "school_year": max((r[2] for r in rows if r[2]), default=None),
    }


async def search_schools(
    db: AsyncSession, q: str, *, province: str | None = None, kind: str | None = None, limit: int = 15,
) -> list[ItalianSchool]:
    q = (q or "").strip()
    if len(q) < 2:
        return []
    code = q.upper().replace(" ", "")
    tokens = normalize(q).split()
    stmt = select(ItalianSchool)
    if re.fullmatch(r"[A-Z0-9]{4,10}", code) and any(ch.isdigit() for ch in code):
        # sembra un codice meccanografico (anche parziale): ricerca per prefisso
        stmt = stmt.where(ItalianSchool.code.like(f"{code}%"))
    else:
        for token in tokens:
            stmt = stmt.where(ItalianSchool.search_text.ilike(f"%{token}%"))
    if province:
        stmt = stmt.where(func.lower(ItalianSchool.province) == province.strip().lower())
    if kind in ("STATALE", "PARITARIA"):
        stmt = stmt.where(ItalianSchool.kind == kind)
    first = tokens[0] if tokens else ""
    stmt = stmt.order_by(
        case((ItalianSchool.code == code, 0), (ItalianSchool.search_text.like(f"{first}%"), 1), else_=2),
        ItalianSchool.name,
    ).limit(max(1, min(limit, 50)))
    return list((await db.execute(stmt)).scalars().all())


def school_to_dict(s: ItalianSchool) -> dict:
    return {
        "code": s.code, "name": s.name, "kind": s.kind, "typology": s.typology,
        "region": s.region, "province": s.province, "comune": s.comune, "address": s.address,
        "cap": s.cap, "email": s.email, "pec": s.pec, "website": s.website,
        "plessi": (s.plessi_summary or "").split("\n") if s.plessi_summary else [],
    }
