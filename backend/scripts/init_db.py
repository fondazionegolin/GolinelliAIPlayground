"""Bootstrap and repair a dev database.

For local/dev environments we support two scenarios:
1. Fresh DB (no `users` table): create schema from ORM metadata, then stamp Alembic.
2. Existing DB: run `alembic upgrade head`.

After either path, we verify that all ORM tables exist and auto-create any
missing ones. This self-heals dev databases that were previously stamped to
head but are missing tables.
"""

import asyncio
import subprocess
import sys

from sqlalchemy import text

from app.core.database import engine, Base
from app.models.base import *  # noqa: F401, F403 — registers all models


def _run_alembic(*args: str) -> None:
    cmd = ["alembic", *args]
    print(f"[init_db] Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


async def _table_exists(table_name: str) -> bool:
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = :table_name
                )
                """
            ),
            {"table_name": table_name},
        )
        return bool(result.scalar())


async def _get_existing_tables() -> set[str]:
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                """
            )
        )
        return {row[0] for row in result.fetchall()}


async def _create_all_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _repair_missing_tables() -> None:
    expected_tables = set(Base.metadata.tables.keys())
    existing_tables = await _get_existing_tables()
    missing_tables = sorted(expected_tables - existing_tables)

    if not missing_tables:
        print("[init_db] Schema check passed: no missing ORM tables.")
        return

    print(f"[init_db] Detected missing tables: {', '.join(missing_tables)}")
    print("[init_db] Creating missing tables via Base.metadata.create_all(checkfirst=True)...")
    await _create_all_tables()

    final_existing_tables = await _get_existing_tables()
    still_missing = sorted(expected_tables - final_existing_tables)
    if still_missing:
        raise RuntimeError(
            "Schema is still missing tables after repair: " + ", ".join(still_missing)
        )

    print("[init_db] Missing tables repaired.")


async def init_db() -> None:
    users_exists = await _table_exists("users")

    if users_exists:
        print("[init_db] Base tables already exist, running alembic upgrade head...")
        _run_alembic("upgrade", "head")
    else:
        print("[init_db] Fresh database detected. Creating schema from ORM metadata...")
        await _create_all_tables()
        print("[init_db] Base tables created. Stamping alembic to head...")
        _run_alembic("stamp", "head")

    await _repair_missing_tables()
    print("[init_db] Done.")


if __name__ == "__main__":
    try:
        asyncio.run(init_db())
    except Exception as e:
        print(f"[init_db] Error: {e}", file=sys.stderr)
        sys.exit(1)
