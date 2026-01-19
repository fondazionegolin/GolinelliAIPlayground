#!/usr/bin/env python3
"""Script to create an admin user."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.tenant import Tenant
from app.core.security import get_password_hash
from app.models.enums import UserRole, TenantStatus
from sqlalchemy import select


async def create_admin(email: str, password: str):
    async with AsyncSessionLocal() as db:
        # Check if admin already exists
        result = await db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()

        if existing:
            print(f"User {email} already exists")
            return

        # Create default tenant if it doesn't exist
        result = await db.execute(select(Tenant).where(Tenant.slug == "default"))
        tenant = result.scalar_one_or_none()

        if not tenant:
            tenant = Tenant(
                name="Default Organization",
                slug="default",
                status=TenantStatus.ACTIVE,
            )
            db.add(tenant)
            await db.flush()
            print(f"Created default tenant")

        admin = User(
            email=email,
            password_hash=get_password_hash(password),
            role=UserRole.ADMIN,
            is_verified=True,
            tenant_id=tenant.id,
        )
        db.add(admin)
        await db.commit()
        print(f"Admin created successfully!")
        print(f"  Email: {email}")
        print(f"  Password: {password}")
        print(f"  Role: ADMIN")


if __name__ == "__main__":
    email = sys.argv[1] if len(sys.argv) > 1 else "admin@example.com"
    password = sys.argv[2] if len(sys.argv) > 2 else "admin123"

    asyncio.run(create_admin(email, password))
