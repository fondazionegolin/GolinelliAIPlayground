"""Integration tests for admin endpoints (tenants, teacher requests, users)."""

import pytest
from httpx import AsyncClient

from app.core.config import settings

API = settings.API_V1_PREFIX


class TestTenantCRUD:
    async def test_list_tenants(self, admin_client: AsyncClient, seed_tenant):
        resp = await admin_client.get(f"{API}/admin/tenants")
        assert resp.status_code == 200
        tenants = resp.json()
        assert any(t["id"] == str(seed_tenant.id) for t in tenants)

    async def test_create_tenant(self, admin_client: AsyncClient):
        resp = await admin_client.post(
            f"{API}/admin/tenants",
            json={"name": "New School", "slug": "new-school"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "New School"
        assert data["slug"] == "new-school"

    async def test_update_tenant(self, admin_client: AsyncClient, seed_tenant):
        resp = await admin_client.patch(
            f"{API}/admin/tenants/{seed_tenant.id}",
            json={"name": "Renamed School"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed School"


class TestTeacherRequestAdmin:
    async def test_list_teacher_requests(self, admin_client: AsyncClient):
        resp = await admin_client.get(f"{API}/admin/teacher-requests")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestUserManagement:
    async def test_list_users(self, admin_client: AsyncClient, seed_teacher):
        resp = await admin_client.get(f"{API}/admin/users")
        assert resp.status_code == 200
        users = resp.json()
        assert len(users) >= 1

    async def test_get_usage(self, admin_client: AsyncClient):
        resp = await admin_client.get(f"{API}/admin/usage")
        assert resp.status_code == 200

    async def test_dashboard_overview(self, admin_client: AsyncClient):
        resp = await admin_client.get(f"{API}/admin/dashboard/overview")
        assert resp.status_code == 200
