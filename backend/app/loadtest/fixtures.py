"""Test data of the stress test: one reusable tenant/class/session, and cleanup by exact IDs.

The tenant is dedicated (slug `loadtest-stress`) so a test never touches a real school's credits or its
«students connected at once» limit. Cleanup deletes only the rows whose IDs a run recorded itself (students
it created through the real join endpoint, their projects and jobs) — never by name or time window.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import generate_join_code
from app.models.enums import SessionStatus
from app.models.session import Class, Session, SessionModule
from app.models.tenant import Tenant
from app.models.user import User

TENANT_SLUG = "loadtest-stress"
SESSION_TITLE = "Stress test Vibe Lab (dati sintetici)"


async def ensure_fixture(db: AsyncSession, admin: User) -> Session:
    tenant = (await db.execute(select(Tenant).where(Tenant.slug == TENANT_SLUG))).scalar_one_or_none()
    if tenant is None:
        tenant = Tenant(name="Stress test (dati sintetici)", slug=TENANT_SLUG,
                        max_students_per_class=5000, max_students_per_teacher=5000)
        db.add(tenant)
        await db.flush()
    else:
        tenant.max_students_per_class = max(tenant.max_students_per_class or 0, 5000)
        tenant.max_students_per_teacher = max(tenant.max_students_per_teacher or 0, 5000)

    cls = (await db.execute(select(Class).where(Class.tenant_id == tenant.id, Class.name == "Stress test"))).scalar_one_or_none()
    if cls is None:
        cls = Class(tenant_id=tenant.id, teacher_id=admin.id, name="Stress test", is_system=True)
        db.add(cls)
        await db.flush()

    session = (await db.execute(select(Session).where(Session.class_id == cls.id, Session.deleted_at.is_(None))
                                .order_by(Session.created_at.asc()).limit(1))).scalar_one_or_none()
    if session is None:
        code = generate_join_code()
        while (await db.execute(select(Session.id).where(Session.join_code == code))).scalar_one_or_none():
            code = generate_join_code()
        session = Session(tenant_id=tenant.id, class_id=cls.id, created_by_teacher_id=admin.id, title=SESSION_TITLE,
                          join_code=code, status=SessionStatus.ACTIVE, is_persistent=True)
        db.add(session)
        await db.flush()
    session.status = SessionStatus.ACTIVE
    module = (await db.execute(select(SessionModule).where(SessionModule.session_id == session.id,
                                                           SessionModule.module_key == "coding"))).scalar_one_or_none()
    if module is None:
        db.add(SessionModule(tenant_id=tenant.id, session_id=session.id, module_key="coding", is_enabled=True, config_json={}))
    else:
        module.is_enabled = True
    await db.commit()
    await db.refresh(session)
    return session


async def cleanup(db: AsyncSession, *, student_ids: list[str], project_ids: list[str], job_ids: list[str]) -> dict:
    """Delete exactly the rows a run created. Returns per-table counts."""
    students = [uuid.UUID(s) for s in student_ids]
    projects = [uuid.UUID(p) for p in project_ids]
    jobs = [uuid.UUID(j) for j in job_ids]
    report: dict[str, int] = {}

    errors: list[str] = []

    async def run(label: str, sql: str, **params) -> None:
        try:
            async with db.begin_nested():  # one failing table must not abort the rest
                result = await db.execute(text(sql), params)
            report[label] = report.get(label, 0) + (result.rowcount or 0)
        except Exception as exc:
            errors.append(f"{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")

    if jobs:
        await run("background_jobs", "DELETE FROM background_jobs WHERE id = ANY(:ids)", ids=jobs)
    if projects:
        await run("coding_projects", "DELETE FROM coding_projects WHERE id = ANY(:ids)", ids=projects)
    if students:
        # Every table pointing at session_students without ON DELETE: delete the test students' rows first.
        refs = (await db.execute(text("""
            SELECT kcu.table_name, kcu.column_name, rc.delete_rule
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name
            WHERE ccu.table_name = 'session_students' AND ccu.column_name = 'id'
        """))).all()
        for table, column, rule in refs:
            if rule in ("NO ACTION", "RESTRICT"):
                await run(table, f'DELETE FROM "{table}" WHERE "{column}" = ANY(:ids)', ids=students)
        await run("session_students", "DELETE FROM session_students WHERE id = ANY(:ids)", ids=students)
    await db.commit()
    return {"deleted": {k: v for k, v in report.items() if v}, "errors": errors}
