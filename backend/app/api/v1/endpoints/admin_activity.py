"""Admin «Sessioni»: who is running sessions and live activities right now, and how close each session is to its capacity.

The older ``/admin/teachers/status`` counts a teacher's sessions only through the classes they *own*. A teacher invited to
someone else's class who then creates a live escape room there (the typical co-teaching case) therefore looked inactive.
This read model attributes activity to whoever actually did it: owner, co-teacher (class or session invite) or creator
of a live interaction. «Online» means a live socket or a heartbeat in the last ``ONLINE_WINDOW_MINUTES`` minutes, and is what the capacity
limit counts; ``registered`` is the cumulative number of student accounts of the session (informational).
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.credits import CreditTransaction
from app.models.enums import UserRole
from app.models.invitation import ClassTeacher, SessionTeacher
from app.models.live_interaction import LiveInteraction
from app.models.session import Class as TeacherClass, Session, SessionStudent
from app.models.tenant import Tenant
from app.models.user import User
from app.realtime.gateway import get_online_student_ids
from app.services.session_capacity import ONLINE_WINDOW

router = APIRouter()
Admin = Annotated[User, Depends(get_current_admin)]
Db = Annotated[AsyncSession, Depends(get_db)]
ONLINE_WINDOW_MINUTES = int(ONLINE_WINDOW.total_seconds() // 60)
NEAR_CAPACITY = 0.9


def _name(user: User | None) -> str:
    if not user:
        return "—"
    full = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full or user.email


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _latest(*values: datetime | None) -> datetime | None:
    present = [v if v.tzinfo else v.replace(tzinfo=timezone.utc) for v in values if v]
    return max(present) if present else None


@router.get("")
async def activity_overview(_: Admin, db: Db, days: int = Query(30, ge=1, le=365)) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    online_since = now - timedelta(minutes=ONLINE_WINDOW_MINUTES)

    users = {u.id: u for u in (await db.execute(select(User).where(User.role.in_([UserRole.TEACHER, UserRole.ADMIN])))).scalars().all()}
    rows = (await db.execute(
        select(Session, TeacherClass, Tenant)
        .join(TeacherClass, TeacherClass.id == Session.class_id)
        .join(Tenant, Tenant.id == Session.tenant_id)
    )).all()

    student_stats = {
        row.session_id: row for row in (await db.execute(
            select(
                SessionStudent.session_id,
                func.count(SessionStudent.id).label("registered"),
                func.coalesce(func.sum(case((SessionStudent.last_seen_at >= online_since, 1), else_=0)), 0).label("online"),
                func.coalesce(func.sum(case((SessionStudent.is_frozen.is_(True), 1), else_=0)), 0).label("frozen"),
                func.max(SessionStudent.last_seen_at).label("last_seen"),
            ).group_by(SessionStudent.session_id)
        )).all()
    }
    heartbeat_online: dict[Any, set] = defaultdict(set)
    for session_id, student_id in (await db.execute(
        select(SessionStudent.session_id, SessionStudent.id).where(SessionStudent.last_seen_at >= online_since)
    )).all():
        heartbeat_online[session_id].add(str(student_id))
    live_rows = (await db.execute(
        select(
            LiveInteraction.session_id, LiveInteraction.created_by,
            func.count(LiveInteraction.id).label("total"),
            func.coalesce(func.sum(case((LiveInteraction.status == "ACTIVE", 1), else_=0)), 0).label("active"),
            func.max(LiveInteraction.created_at).label("last_created"),
        ).group_by(LiveInteraction.session_id, LiveInteraction.created_by)
    )).all()
    class_members: dict[Any, set] = defaultdict(set)
    for class_id, teacher_id in (await db.execute(select(ClassTeacher.class_id, ClassTeacher.teacher_id))).all():
        class_members[class_id].add(teacher_id)
    session_members: dict[Any, set] = defaultdict(set)
    for session_id, teacher_id in (await db.execute(select(SessionTeacher.session_id, SessionTeacher.teacher_id))).all():
        session_members[session_id].add(teacher_id)
    last_spend = {tid: ts for tid, ts in (await db.execute(
        select(CreditTransaction.teacher_id, func.max(CreditTransaction.timestamp)).where(CreditTransaction.teacher_id.is_not(None)).group_by(CreditTransaction.teacher_id)
    )).all()}

    live_by_session: dict[Any, list] = defaultdict(list)
    for row in live_rows:
        live_by_session[row.session_id].append(row)

    sessions: list[dict[str, Any]] = []
    teachers: dict[Any, dict[str, Any]] = {
        uid: {"id": str(uid), "name": _name(u), "email": u.email, "role": u.role.value, "tenant_id": str(u.tenant_id) if u.tenant_id else None,
              "last_login_at": _iso(u.last_login_at), "owned_sessions": 0, "other_sessions": 0, "live_total": 0, "live_active": 0,
              "registered_students": 0, "online_students": 0, "involved": [], "_last": u.last_login_at, "last_spend": last_spend.get(uid)}
        for uid, u in users.items()
    }

    for session, klass, tenant in rows:
        stats = student_stats.get(session.id)
        registered = int(stats.registered) if stats else 0
        online = len(heartbeat_online.get(session.id, set()) | set(get_online_student_ids(str(session.id))))  # same rule as the join limit
        limit = int(tenant.max_students_per_class or 30)
        live_here = live_by_session.get(session.id, [])
        creators = {row.created_by: row for row in live_here}
        co_ids = (class_members.get(klass.id, set()) | session_members.get(session.id, set())) - {klass.teacher_id}
        last_live = _latest(*[row.last_created for row in live_here])
        last_activity = _latest(stats.last_seen if stats else None, last_live, session.created_at)
        relevant = session.status.value != "ended" or (last_activity and last_activity >= since)
        if not relevant:
            continue
        involved = {klass.teacher_id: "owner", **{tid: "co-teacher" for tid in co_ids}}
        for tid in creators:
            involved.setdefault(tid, "live-creator")
        people = []
        for tid, role in involved.items():
            user = users.get(tid)
            row = creators.get(tid)
            people.append({"id": str(tid), "name": _name(user), "email": user.email if user else None, "role": role,
                           "live_total": int(row.total) if row else 0, "live_active": int(row.active) if row else 0})
            record = teachers.get(tid)
            if record:
                record["owned_sessions" if role == "owner" else "other_sessions"] += 1
                if row:
                    record["live_total"] += int(row.total)
                    record["live_active"] += int(row.active)
                    record["_last"] = _latest(record["_last"], row.last_created)
                if role == "owner":
                    record["registered_students"] += registered
                    record["online_students"] += online
                record["involved"].append({"session_id": str(session.id), "title": session.title, "join_code": session.join_code, "role": role,
                                           "status": session.status.value, "live_total": int(row.total) if row else 0, "live_active": int(row.active) if row else 0,
                                           "registered": registered, "online": online, "limit": limit})
        sessions.append({
            "id": str(session.id), "title": session.title, "join_code": session.join_code, "status": session.status.value, "created_at": _iso(session.created_at),
            "tenant": {"id": str(tenant.id), "name": tenant.name, "max_students_per_class": limit},
            "owner": {"id": str(klass.teacher_id), "name": _name(users.get(klass.teacher_id)), "email": users[klass.teacher_id].email if klass.teacher_id in users else None},
            "teachers": sorted(people, key=lambda p: ("owner", "co-teacher", "live-creator").index(p["role"])),
            "registered": registered, "online": online, "frozen": int(stats.frozen) if stats else 0, "limit": limit,
            "full": online >= limit, "near_full": online >= limit * NEAR_CAPACITY,
            "live_total": sum(int(r.total) for r in live_here), "live_active": sum(int(r.active) for r in live_here),
            "last_activity": _iso(last_activity),
        })

    for record in teachers.values():
        record["last_activity"] = _iso(_latest(record.pop("_last"), record.pop("last_spend")))
        record["at_capacity"] = sum(1 for item in record["involved"] if item["online"] >= item["limit"] * NEAR_CAPACITY and item["status"] != "ended")

    teacher_list = [t for t in teachers.values() if t["owned_sessions"] or t["other_sessions"] or t["live_total"]
                    or (t["last_activity"] and t["last_activity"] >= since.isoformat())]
    teacher_list.sort(key=lambda t: t["last_activity"] or "", reverse=True)
    sessions.sort(key=lambda s: s["last_activity"] or "", reverse=True)
    sessions.sort(key=lambda s: (s["status"] != "active", -s["online"]))  # live sessions first, busiest first, then most recent
    live_now = [s for s in sessions if s["status"] == "active"]
    return {
        "generated_at": now.isoformat(), "online_window_minutes": ONLINE_WINDOW_MINUTES, "days": days,
        "totals": {
            "active_sessions": len(live_now), "online_students": sum(s["online"] for s in sessions),
            "full_sessions": sum(1 for s in sessions if s["full"] and s["status"] != "ended"),
            "near_full_sessions": sum(1 for s in sessions if s["near_full"] and not s["full"] and s["status"] != "ended"),
            "teachers_active_24h": sum(1 for t in teacher_list if t["last_activity"] and t["last_activity"] >= (now - timedelta(hours=24)).isoformat()),
            "active_live_interactions": sum(s["live_active"] for s in sessions),
        },
        "sessions": sessions, "teachers": teacher_list,
    }
