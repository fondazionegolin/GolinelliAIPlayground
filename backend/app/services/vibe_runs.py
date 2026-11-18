"""Serialize project-generation startup across workers without holding a DB connection during AI work."""
from contextlib import asynccontextmanager
import hashlib

from fastapi import HTTPException
from sqlalchemy import select, text

from app.core.database import AsyncSessionLocal
from app.models.background_job import BackgroundJob


def project_lock_key(tenant_id, project_id) -> int:
    return int.from_bytes(hashlib.sha256(f'vibe:{tenant_id}:{project_id}'.encode()).digest()[:8], 'big', signed=True)


@asynccontextmanager
async def generation_start(tenant_id, project_id):
    # A separate, short transaction survives the request session's preflight commits. Once the
    # durable background job exists we release it: later requests check that running job instead.
    async with AsyncSessionLocal() as guard:
        acquired = await guard.scalar(text('SELECT pg_try_advisory_xact_lock(:key)'), {'key': project_lock_key(tenant_id, project_id)})
        if not acquired:
            raise HTTPException(409, {'code': 'generation_running', 'message': 'Una generazione di questo progetto è già in avvio. Attendi e riapri il progetto.'})
        active = await guard.scalar(select(BackgroundJob).where(
            BackgroundJob.tenant_id == tenant_id, BackgroundJob.resource_id == str(project_id),
            BackgroundJob.kind == 'vibe_generate', BackgroundJob.status == 'running',
        ).order_by(BackgroundJob.created_at.desc()).limit(1))
        if active:
            raise HTTPException(409, {'code': 'generation_running', 'message': 'Questo progetto ha già una generazione in corso. Riaprilo per seguirla.', 'job_id': str(active.id)})
        yield
        # Context exit rolls the guard transaction back, releasing the advisory lock on every path.
