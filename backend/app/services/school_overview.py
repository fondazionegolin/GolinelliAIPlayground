"""Admin view of every school: the onboarding funnel, the principal, the teachers they invited, and what happens inside.

Everything an admin needs to follow a school is gathered here in a few grouped queries (no per-row round trips):
invite delivery and reading, partial acceptance, legal acceptances with dates and versions, teachers' activation,
classes, sessions, students and credits.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.legal_documents import required_legal_documents
from app.models.credits import CreditTransaction
from app.models.enums import TenantType, UserRole
from app.models.school_onboarding import ItalianSchool, SchoolOnboardingInvite
from app.models.session import Class, Session, SessionStudent
from app.models.teacher_school import TeacherSchoolMembership
from app.models.tenant import Tenant
from app.models.user import ActivationToken, LegalDocumentAcceptance, User


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def invite_stage(inv: SchoolOnboardingInvite) -> str:
    """Where an invite stands, from the admin's point of view (most advanced step reached)."""
    if inv.status == "COMPLETED":
        return "COMPLETED"
    if inv.status == "REVOKED":
        return "REVOKED"
    if inv.expires_at < _now():
        return "EXPIRED"
    accepted = len((inv.progress or {}).get("accepted") or [])
    if accepted:
        return "PARTIAL"
    if inv.opened_at:
        return "LINK_OPENED"
    if inv.email_opened_at:
        return "EMAIL_READ"
    if inv.email_status == "FAILED":
        return "EMAIL_FAILED"
    if inv.email_status == "SENT":
        return "EMAIL_SENT"
    return "CREATED"


def documents_state(rows: list[LegalDocumentAcceptance], required: list[dict]) -> tuple[list[dict], bool]:
    """Latest acceptance per required document, and whether every one matches the current version."""
    latest: dict[str, LegalDocumentAcceptance] = {}
    for r in rows:
        if r.document_key not in latest or r.accepted_at > latest[r.document_key].accepted_at:
            latest[r.document_key] = r
    docs, complete = [], True
    for d in required:
        r = latest.get(d["key"])
        current = bool(r and r.document_version == d["version"])
        complete &= current
        docs.append({"key": d["key"], "title": d["title"], "required_version": d["version"],
                     "accepted_version": r.document_version if r else None, "accepted_at": iso(r.accepted_at) if r else None,
                     "current": current})
    return docs, complete


def teacher_state(user: User, token: ActivationToken | None, docs_complete: bool) -> str:
    if not user.is_active:
        return "DEACTIVATED"
    if token and not token.is_used and user.last_login_at is None:
        return "EXPIRED" if token.expires_at < _now() else "INVITED"
    if not docs_complete:
        return "TERMS_PENDING"
    return "ACTIVE"


async def school_overview(db: AsyncSession, tenant_ids: list[UUID] | None = None) -> list[dict]:
    stmt = select(Tenant).where(Tenant.tenant_type == TenantType.SCHOOL.value).order_by(Tenant.created_at.desc())
    if tenant_ids is not None:
        stmt = stmt.where(Tenant.id.in_(tenant_ids))
    tenants = (await db.execute(stmt)).scalars().all()
    if not tenants:
        return []
    ids = [t.id for t in tenants]
    month = _now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    week = _now() - timedelta(days=7)

    codes = [t.mechanographic_code for t in tenants if t.mechanographic_code]
    registry = {s.code: s for s in (await db.execute(select(ItalianSchool).where(ItalianSchool.code.in_(codes)))).scalars().all()} if codes else {}

    invites: dict[UUID, list[SchoolOnboardingInvite]] = defaultdict(list)
    for inv in (await db.execute(select(SchoolOnboardingInvite).where(SchoolOnboardingInvite.tenant_id.in_(ids))
                                 .order_by(SchoolOnboardingInvite.created_at.desc()))).scalars().all():
        invites[inv.tenant_id].append(inv)

    # A school's teachers: accounts created in its tenant (principal and invited teachers) and teachers of other
    # tenants added to it as members.
    members: dict[UUID, set[UUID]] = defaultdict(set)
    for teacher_id, school_id in (await db.execute(select(TeacherSchoolMembership.teacher_id, TeacherSchoolMembership.school_tenant_id)
                                                   .where(TeacherSchoolMembership.school_tenant_id.in_(ids)))).all():
        members[school_id].add(teacher_id)
    member_ids = set().union(*members.values()) if members else set()
    users = (await db.execute(select(User).where(or_(User.tenant_id.in_(ids), User.id.in_(member_ids)), User.role == UserRole.TEACHER)
                              .order_by(User.created_at.asc()))).scalars().all()
    user_ids = [u.id for u in users]
    tokens: dict[UUID, ActivationToken] = {}
    acceptances: dict[UUID, list[LegalDocumentAcceptance]] = defaultdict(list)
    if user_ids:
        for tok in (await db.execute(select(ActivationToken).where(ActivationToken.user_id.in_(user_ids))
                                     .order_by(ActivationToken.created_at.asc()))).scalars().all():
            tokens[tok.user_id] = tok  # the latest one wins
        for row in (await db.execute(select(LegalDocumentAcceptance).where(LegalDocumentAcceptance.user_id.in_(user_ids)))).scalars().all():
            acceptances[row.user_id].append(row)

    # Activity belongs to the school of the class it happens in (a member teacher's class names the school).
    school_of = func.coalesce(Class.school_tenant_id, Class.tenant_id)
    classes = {(r[0], r[1]): r[2] for r in (await db.execute(select(school_of, Class.teacher_id, func.count(Class.id))
                                                             .where(school_of.in_(ids)).group_by(school_of, Class.teacher_id))).all()}
    sessions_q = (select(school_of, Class.teacher_id, func.count(Session.id), func.max(Session.created_at))
                  .join(Class, Class.id == Session.class_id).where(school_of.in_(ids), Session.deleted_at.is_(None))
                  .group_by(school_of, Class.teacher_id))
    sessions = {(r[0], r[1]): (r[2], r[3]) for r in (await db.execute(sessions_q)).all()}
    students_q = (select(school_of, Class.teacher_id, func.count(SessionStudent.id), func.max(SessionStudent.last_seen_at),
                         func.count(SessionStudent.id).filter(SessionStudent.last_seen_at >= week))
                  .join(Session, Session.id == SessionStudent.session_id).join(Class, Class.id == Session.class_id)
                  .where(school_of.in_(ids)).group_by(school_of, Class.teacher_id))
    students = {(r[0], r[1]): (r[2], r[3], r[4]) for r in (await db.execute(students_q)).all()}
    spent_in = func.coalesce(Class.school_tenant_id, Class.tenant_id, CreditTransaction.tenant_id)
    credits_q = (select(spent_in, CreditTransaction.teacher_id, func.sum(CreditTransaction.cost),
                        func.sum(CreditTransaction.cost).filter(CreditTransaction.timestamp >= month), func.max(CreditTransaction.timestamp))
                 .outerjoin(Class, Class.id == CreditTransaction.class_id)
                 .where(spent_in.in_(ids)).group_by(spent_in, CreditTransaction.teacher_id))
    credits: dict[UUID, dict] = defaultdict(lambda: {"total": 0.0, "month": 0.0, "last": None, "by_teacher": {}})
    for tenant_id, teacher_id, total, this_month, last in (await db.execute(credits_q)).all():
        c = credits[tenant_id]
        c["total"] += total or 0
        c["month"] += this_month or 0
        c["last"] = max(filter(None, [c["last"], last]), default=None)
        if teacher_id:
            c["by_teacher"][teacher_id] = {"total": total or 0, "month": this_month or 0}

    by_tenant: dict[UUID, list[User]] = defaultdict(list)
    for u in users:
        for school_id in ids:
            if u.tenant_id == school_id or u.id in members[school_id]:
                by_tenant[school_id].append(u)

    out = []
    for t in tenants:
        tenant_credits = credits[t.id]

        def person(u: User, owner: bool) -> dict:
            tok = tokens.get(u.id)
            member = u.tenant_id != t.id  # a teacher of another tenant added to this school
            docs, complete = documents_state(acceptances[u.id], required_legal_documents(is_school_owner=owner, in_school_tenant=not member))
            n_sessions, last_session = sessions.get((t.id, u.id), (0, None))
            n_students, last_student, active_students = students.get((t.id, u.id), (0, None, 0))
            spent = tenant_credits["by_teacher"].get(u.id, {"total": 0, "month": 0})
            return {
                "id": str(u.id), "first_name": u.first_name, "last_name": u.last_name, "email": u.email,
                "state": teacher_state(u, None if owner else tok, complete),
                "invited_at": iso(u.created_at), "activated_at": iso(tok.used_at) if tok and tok.is_used else (iso(u.created_at) if owner else None),
                "last_login_at": iso(u.last_login_at), "deactivated_at": iso(u.deactivated_at),
                "invite_email": {"status": tok.email_status, "error": tok.email_error, "attempts": tok.email_attempts,
                                 "sent_at": iso(tok.email_sent_at), "opened_at": iso(tok.email_opened_at),
                                 "expires_at": iso(tok.expires_at)} if tok and not owner else None,
                "documents": docs, "documents_complete": complete, "member": member,
                "classes": classes.get((t.id, u.id), 0), "sessions": n_sessions, "students": n_students, "students_active_7d": active_students,
                "last_activity_at": iso(max(filter(None, [u.last_login_at, last_session, last_student]), default=None)),
                "credits_month": spent["month"], "credits_total": spent["total"],
            }

        members = by_tenant[t.id]
        owner = next((u for u in members if u.id == t.owner_user_id), None)
        teachers = [person(u, False) for u in members if u.id != t.owner_user_id]
        principal = person(owner, True) if owner else None
        school = registry.get(t.mechanographic_code) if t.mechanographic_code else None
        latest = invites[t.id][0] if invites[t.id] else None
        everyone = ([principal] if principal else []) + teachers
        out.append({
            "id": str(t.id), "name": t.name, "status": getattr(t.status, "value", t.status), "created_at": iso(t.created_at),
            "mechanographic_code": t.mechanographic_code, "registry_verified": t.registry_verified,
            "max_teachers": t.max_teachers, "monthly_credit_pool": t.monthly_credit_pool,
            "registry": {"kind": school.kind, "comune": school.comune, "province": school.province, "region": school.region,
                         "address": school.address, "email": school.email, "pec": school.pec, "website": school.website} if school else None,
            "organization": {"name": latest.organization_name, "comune": latest.organization_comune, "province": latest.organization_province}
            if latest and latest.organization_name else None,
            "invite": invite_summary(latest) if latest else None,
            "invites_count": len(invites[t.id]),
            "principal": principal,
            "teachers": teachers,
            "stats": {
                "teachers_total": len(teachers),
                "teachers_active": sum(1 for p in teachers if p["state"] == "ACTIVE"),
                "teachers_pending": sum(1 for p in teachers if p["state"] in ("INVITED", "EXPIRED", "TERMS_PENDING")),
                "classes": sum(p["classes"] for p in everyone), "sessions": sum(p["sessions"] for p in everyone),
                "students": sum(p["students"] for p in everyone), "students_active_7d": sum(p["students_active_7d"] for p in everyone),
                "credits_month": tenant_credits["month"], "credits_total": tenant_credits["total"],
                "last_activity_at": max(filter(None, [p["last_activity_at"] for p in everyone] + [iso(tenant_credits["last"])]), default=None),
            },
        })
    return out


def invite_summary(inv: SchoolOnboardingInvite) -> dict:
    progress = inv.progress or {}
    return {
        "id": str(inv.id), "mode": inv.mode, "stage": invite_stage(inv), "status": inv.status,
        "email": inv.email, "first_name": inv.first_name, "last_name": inv.last_name, "label": inv.label,
        "created_at": iso(inv.created_at), "expires_at": iso(inv.expires_at),
        "email_status": inv.email_status, "email_error": inv.email_error, "email_attempts": inv.email_attempts or 0,
        "email_sent_at": iso(inv.email_sent_at), "email_opened_at": iso(inv.email_opened_at),
        "opened_at": iso(inv.opened_at), "last_opened_at": iso(inv.last_opened_at), "open_count": inv.open_count or 0,
        "accepted": list(progress.get("accepted") or []), "progress_at": progress.get("updated_at"),
        "completed_at": iso(inv.completed_at),
    }
