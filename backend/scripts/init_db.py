"""Bootstrap a fresh dev database.

The alembic migrations (001+) are incremental and assume the base tables
(users, tenants, etc.) already exist. This script:

1. If the DB is fresh (no 'users' table): creates all tables from current
   models via create_all(), then stamps alembic to head.
2. If the DB already has tables: does nothing (alembic upgrade head handles it).

Returns exit code 0 if tables were created (caller should stamp, not upgrade),
or exit code 2 if tables already existed (caller should upgrade as normal).
"""

import asyncio
import subprocess
import sys

from sqlalchemy import text

from app.core.database import engine, Base
from app.models.base import *  # noqa: F401, F403 — registers all models


async def init_db():
    async with engine.begin() as conn:
        result = await conn.execute(
            text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')")
        )
        users_exists = result.scalar()

        if users_exists:
            print("[init_db] Base tables already exist, running alembic upgrade head...")
            subprocess.run(["alembic", "upgrade", "head"], check=True)
            return

        print("[init_db] Fresh database detected. Creating base schema...")
        await conn.run_sync(Base.metadata.create_all)
        print("[init_db] Base tables created. Stamping alembic to head...")

    subprocess.run(["alembic", "stamp", "head"], check=True)
    print("[init_db] Done.")


if __name__ == "__main__":
    try:
        asyncio.run(init_db())
    except Exception as e:
        print(f"[init_db] Error: {e}", file=sys.stderr)
        sys.exit(1)
