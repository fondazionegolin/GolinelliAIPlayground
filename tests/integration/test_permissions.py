"""Integration tests for authorization and permission enforcement."""

import uuid

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.core.security import create_access_token, create_student_join_token

API = settings.API_V1_PREFIX


class TestUnauthenticated:
    async def test_unauthenticated_teacher_endpoint(self, client: AsyncClient):
        resp = await client.get(f"{API}/teacher/classes")
        assert resp.status_code in (401, 403)

    async def test_unauthenticated_student_endpoint(self, client: AsyncClient):
        resp = await client.get(f"{API}/student/session")
        assert resp.status_code in (401, 403)

    async def test_unauthenticated_admin_endpoint(self, client: AsyncClient):
        resp = await client.get(f"{API}/admin/tenants")
        assert resp.status_code in (401, 403)


class TestRoleEnforcement:
    async def test_student_cannot_access_teacher_endpoints(
        self, student_client: AsyncClient
    ):
        resp = await student_client.get(f"{API}/teacher/classes")
        assert resp.status_code in (401, 403)

    async def test_teacher_cannot_access_admin_endpoints(
        self, teacher_client: AsyncClient
    ):
        resp = await teacher_client.get(f"{API}/admin/tenants")
        assert resp.status_code == 403


class TestFrozenStudent:
    async def test_frozen_student_gets_403(
        self, client: AsyncClient, seed_student, db_session
    ):
        seed_student.is_frozen = True
        seed_student.frozen_reason = "Inappropriate behavior"
        await db_session.flush()

        client.headers["student-token"] = seed_student.join_token
        resp = await client.get(f"{API}/student/session")
        assert resp.status_code == 403


class TestExpiredToken:
    async def test_expired_teacher_token(self, client: AsyncClient):
        from datetime import timedelta

        token = create_access_token(
            subject=str(uuid.uuid4()),
            token_type="access",
            expires_delta=timedelta(seconds=-1),
        )
        client.headers["Authorization"] = f"Bearer {token}"
        resp = await client.get(f"{API}/teacher/classes")
        assert resp.status_code == 401


class TestCrossTenantIsolation:
    async def test_teacher_cannot_see_other_tenant_class(
        self, teacher_client: AsyncClient, db_session
    ):
        """A teacher should not see classes from a different tenant."""
        from app.models.tenant import Tenant
        from app.models.user import User
        from app.models.session import Class
        from app.models.enums import TenantStatus, UserRole
        from app.core.security import get_password_hash

        # Create a different tenant with its own teacher and class
        other_tenant = Tenant(
            id=uuid.uuid4(), name="Other School", slug="other-school",
            status=TenantStatus.ACTIVE,
        )
        db_session.add(other_tenant)
        await db_session.flush()

        other_teacher = User(
            id=uuid.uuid4(), tenant_id=other_tenant.id, email="other@other.com",
            password_hash=get_password_hash("pass"), role=UserRole.TEACHER,
            is_active=True, is_verified=True,
        )
        db_session.add(other_teacher)
        await db_session.flush()

        other_class = Class(
            id=uuid.uuid4(), tenant_id=other_tenant.id,
            teacher_id=other_teacher.id, name="Secret Class",
        )
        db_session.add(other_class)
        await db_session.flush()

        # Our teacher should not see the other tenant's class
        resp = await teacher_client.get(f"{API}/teacher/classes")
        assert resp.status_code == 200
        class_ids = [c["id"] for c in resp.json()]
        assert str(other_class.id) not in class_ids
