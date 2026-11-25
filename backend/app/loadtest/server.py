"""HTTP API of the stress-test service, reached by the admin page through nginx at /loadtest/api/*.

Admin only: the platform access token (same SECRET_KEY) is verified here and the user must be an active
admin. One run at a time; its event bus is followed over SSE. Reports are kept as JSON files
(LOADTEST_REPORT_DIR, mounted from ./data/loadtest_reports) so they survive restarts.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import decode_token
import app.models  # noqa: F401  (registers every mapper before the first query)
from app.loadtest import fixtures, monitor
from app.loadtest.runner import DEFAULT_PROMPT, MAX_USERS, REPORT_DIR, SCENARIOS, TARGET, Run, RunConfig
from app.models.enums import UserRole
from app.models.user import User

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("loadtest")

app = FastAPI(title="Golinelli stress test", docs_url=None, redoc_url=None, openapi_url=None)
PREFIX = "/loadtest/api"

_current: Optional[Run] = None


async def require_admin(authorization: Annotated[Optional[str], Header()] = None) -> User:
    token = (authorization or "").removeprefix("Bearer ").strip()
    payload = decode_token(token) if token else None
    if not payload or payload.get("type") != "access" or not payload.get("sub"):
        raise HTTPException(401, "Accesso admin richiesto")
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.id == uuid.UUID(payload["sub"])))).scalar_one_or_none()
    if not user or not user.is_active or user.role != UserRole.ADMIN:
        raise HTTPException(403, "Accesso admin richiesto")
    return user


Admin = Annotated[User, Depends(require_admin)]


@app.get(f"{PREFIX}/health")
async def health():
    return {"ok": True}


@app.get(f"{PREFIX}/info")
async def info(admin: Admin):
    try:
        containers = sorted(c.service for c in await monitor.list_containers())
    except Exception:
        containers = []
    return {
        "scenarios": [{"key": k, **v} for k, v in SCENARIOS.items()],
        "max_users": MAX_USERS,
        "default_prompt": DEFAULT_PROMPT,
        "simulation_available": bool(settings.LOAD_TEST_SECRET),
        "docker_available": monitor.docker_available(),
        "containers": containers,
        "log_services": list(monitor.WATCHED),
        "target": TARGET,
        "current": _current.snapshot() if _current else None,
    }


@app.post(f"{PREFIX}/runs")
async def start_run(body: dict, admin: Admin):
    global _current
    if _current and _current.status in ("preparing", "running", "stopping"):
        raise HTTPException(409, "C'è già una prova in corso: fermala o attendi la fine.")
    try:
        config = RunConfig.from_payload(body)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    if config.llm_mode == "real" and body.get("confirm_real") != "REALE":
        raise HTTPException(400, "Per usare i modelli reali scrivi REALE nel campo di conferma: ogni generazione consuma crediti veri.")
    async with AsyncSessionLocal() as db:
        session = await fixtures.ensure_fixture(db, admin)
    run = Run(config, join_code=session.join_code, session_id=str(session.id), started_by=admin.email)
    _current = run
    run.task = asyncio.create_task(_execute(run))
    return run.snapshot()


async def _execute(run: Run) -> None:
    try:
        await run.execute()
    except Exception as exc:  # never leave a run stuck in "running"
        logger.exception("load test run %s crashed", run.id)
        run.status = "failed"
        run.log("runner", "error", f"La prova si è interrotta per un errore interno: {type(exc).__name__}: {exc}")
        await run._finish()


@app.post(f"{PREFIX}/runs/{{run_id}}/stop")
async def stop_run(run_id: str, admin: Admin):
    if not _current or _current.id != run_id:
        raise HTTPException(404, "Prova non attiva")
    _current.stop_event.set()
    return _current.snapshot()


@app.get(f"{PREFIX}/runs")
async def list_runs(admin: Admin):
    items = []
    if REPORT_DIR.exists():
        for path in sorted(REPORT_DIR.glob("*.json"), reverse=True)[:50]:
            try:
                data = json.loads(path.read_text())
            except Exception:
                continue
            gen = (data.get("steps") or {}).get("gen_total") or {}
            items.append({
                "id": data.get("id"), "label": data.get("label"), "status": data.get("status"),
                "created_at": data.get("created_at"), "duration_s": data.get("duration_s"),
                "users": len(data.get("users") or []), "llm_mode": (data.get("config") or {}).get("llm_mode"),
                "scenarios": (data.get("config") or {}).get("scenarios"),
                "gen_p50": gen.get("p50"), "gen_ok": gen.get("ok"), "gen_failed": gen.get("failed"),
                "valid": sum(r.get("valid", 0) for r in (data.get("scenarios") or {}).values()),
                "invalid": sum(r.get("invalid", 0) for r in (data.get("scenarios") or {}).values()),
                "cost": (data.get("cost") or {}).get("total"),
                "critical": sum(1 for f in data.get("findings") or [] if f.get("severity") == "critical"),
                "cleaned": bool(data.get("cleanup")),
                "created_rows": {k: len(v) for k, v in (data.get("created") or {}).items()},
            })
    return {"current": _current.snapshot() if _current else None, "reports": items}


def _report_path(run_id: str):
    if not run_id.replace("-", "").isalnum():
        raise HTTPException(400, "Id non valido")
    path = REPORT_DIR / f"{run_id}.json"
    if not path.exists():
        raise HTTPException(404, "Report non trovato")
    return path


@app.get(f"{PREFIX}/runs/{{run_id}}/report")
async def get_report(run_id: str, admin: Admin):
    if _current and _current.id == run_id and _current.report:
        return _current.report
    return json.loads(_report_path(run_id).read_text())


@app.get(f"{PREFIX}/runs/{{run_id}}/events")
async def events(run_id: str, admin: Admin, after: int = Query(default=0, ge=0)):
    if not _current or _current.id != run_id:
        raise HTTPException(404, "Prova non attiva: apri il report salvato")
    run = _current

    async def stream():
        yield f"data: {json.dumps({'kind': 'hello', 'run': run.snapshot()})}\n\n"
        async for item in run.bus.follow(after):
            yield ": ping\n\n" if item is None else f"data: {item}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post(f"{PREFIX}/runs/{{run_id}}/cleanup")
async def cleanup(run_id: str, admin: Admin):
    if _current and _current.id == run_id and _current.status in ("preparing", "running", "stopping"):
        raise HTTPException(409, "Attendi la fine della prova prima di pulire i dati")
    path = _report_path(run_id)
    report = json.loads(path.read_text())
    created = report.get("created") or {}
    async with AsyncSessionLocal() as db:
        result = await fixtures.cleanup(db, student_ids=created.get("student_ids") or [],
                                        project_ids=created.get("project_ids") or [], job_ids=created.get("job_ids") or [])
    report["cleanup"] = result
    path.write_text(json.dumps(report, default=str))
    if _current and _current.id == run_id and _current.report:
        _current.report["cleanup"] = result
    return result


@app.delete(f"{PREFIX}/runs/{{run_id}}")
async def delete_report(run_id: str, admin: Admin):
    path = _report_path(run_id)
    report = json.loads(path.read_text())
    if any(report.get("created", {}).get(k) for k in ("student_ids", "project_ids")) and not report.get("cleanup"):
        raise HTTPException(409, "Prima pulisci i dati di test creati da questa prova")
    path.unlink()
    return {"deleted": run_id}
