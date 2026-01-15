#!/usr/bin/env python3
"""Script to create an admin user."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import async_session
from app.models.user import User
from app.core.security import get_password_hash
from sqlalchemy import select


async def create_admin(email: str, password: str):
    async with async_session() as db:
        # Check if admin already exists
        result = await db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        
        if existing:
            print(f"User {email} already exists")
            return
        
        admin = User(
            email=email,
            hashed_password=get_password_hash(password),
            role="ADMIN",
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        print(f"Admin created successfully!")
        print(f"  Email: {email}")
        print(f"  Password: {password}")
        print(f"  Role: ADMIN")


if __name__ == "__main__":
    email = sys.argv[1] if len(sys.argv) > 1 else "admin@eduai.local"
    password = sys.argv[2] if len(sys.argv) > 2 else "admin123"
    
    asyncio.run(create_admin(email, password))
