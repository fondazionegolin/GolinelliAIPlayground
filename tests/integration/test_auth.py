"""Integration tests for the /auth endpoints."""

import pytest
from httpx import AsyncClient

from app.core.config import settings

API = settings.API_V1_PREFIX


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


class TestLogin:
    async def test_login_valid_credentials(self, client: AsyncClient, seed_teacher):
        resp = await client.post(
            f"{API}/auth/login",
            json={"email": "teacher@test.com", "password": "testpass123"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["role"] == "TEACHER"
        assert data["user_id"] == str(seed_teacher.id)

    async def test_login_invalid_password(self, client: AsyncClient, seed_teacher):
        resp = await client.post(
            f"{API}/auth/login",
            json={"email": "teacher@test.com", "password": "wrongpass"},
        )
        assert resp.status_code == 401

    async def test_login_nonexistent_user(self, client: AsyncClient):
        resp = await client.post(
            f"{API}/auth/login",
            json={"email": "nobody@test.com", "password": "anything"},
        )
        assert resp.status_code == 401

    async def test_login_deactivated_user(self, client: AsyncClient, seed_teacher, db_session):
        seed_teacher.is_active = False
        await db_session.flush()

        resp = await client.post(
            f"{API}/auth/login",
            json={"email": "teacher@test.com", "password": "testpass123"},
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------


class TestLogout:
    async def test_logout(self, client: AsyncClient):
        resp = await client.post(f"{API}/auth/logout")
        assert resp.status_code == 200
        assert "Logged out" in resp.json()["message"]


# ---------------------------------------------------------------------------
# Teacher Request + Activation
# ---------------------------------------------------------------------------


class TestTeacherRequest:
    async def test_request_teacher_account_auto_approve(
        self, client: AsyncClient, seed_tenant
    ):
        """School name matching tenant name should auto-approve."""
        resp = await client.post(
            f"{API}/auth/teachers/request",
            json={
                "email": "new_teacher@test.com",
                "first_name": "New",
                "last_name": "Teacher",
                "school_name": seed_tenant.name,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "approved"
        assert data["email"] == "new_teacher@test.com"

    async def test_request_teacher_pending_when_no_school_match(
        self, client: AsyncClient, seed_tenant
    ):
        """Non-matching school name should stay pending."""
        resp = await client.post(
            f"{API}/auth/teachers/request",
            json={
                "email": "pending_teacher@test.com",
                "first_name": "Pending",
                "last_name": "Teacher",
                "tenant_slug": seed_tenant.slug,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "pending"

    async def test_request_teacher_duplicate_email_with_pending(
        self, client: AsyncClient, seed_tenant
    ):
        """Should reject if a pending request already exists for the email."""
        payload = {
            "email": "dup@test.com",
            "first_name": "Dup",
            "last_name": "Teacher",
            "tenant_slug": seed_tenant.slug,
        }
        resp1 = await client.post(f"{API}/auth/teachers/request", json=payload)
        assert resp1.status_code == 200

        resp2 = await client.post(f"{API}/auth/teachers/request", json=payload)
        assert resp2.status_code == 400

    async def test_request_teacher_existing_user_email(
        self, client: AsyncClient, seed_teacher, seed_tenant
    ):
        """Should reject if a user with the same email already exists."""
        resp = await client.post(
            f"{API}/auth/teachers/request",
            json={
                "email": seed_teacher.email,
                "first_name": "Dup",
                "last_name": "User",
                "tenant_slug": seed_tenant.slug,
            },
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Public settings
# ---------------------------------------------------------------------------


class TestPublicSettings:
    async def test_get_public_settings(self, client: AsyncClient, seed_tenant):
        resp = await client.get(f"{API}/auth/public-settings")
        assert resp.status_code == 200
        assert "beta_disclaimer_html" in resp.json()

    async def test_get_public_settings_with_slug(self, client: AsyncClient, seed_tenant):
        resp = await client.get(
            f"{API}/auth/public-settings",
            params={"tenant_slug": seed_tenant.slug},
        )
        assert resp.status_code == 200
