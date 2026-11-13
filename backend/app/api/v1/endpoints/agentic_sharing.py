"""Share a Dataflow workflow as a runnable app: with classes, single sessions, or an anonymous link (+ QR).

Recipients never edit the graph; they run it and see the results (or chat with it). Students run it as themselves
(AI billed to their pool); anonymous visitors run it on the owner's credits, behind per-link and per-IP limits.
Workflows that reach the teacher's platform files (platform.*) cannot be shared.
"""
import hashlib
import json
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_student, get_current_teacher
from app.api.v1.endpoints.agentic import (
    ChatInput, _has_chatbot_nodes, _resume_chat_run, _run_payload, _spawn_run,
)
from app.api.v1.endpoints.solid_modeler import _teacher_class_rows
from app.core.database import get_db
from app.models.agentic import AgenticDataset, AgenticWorkflow, AgenticWorkflowRun
from app.models.session import Session, SessionStudent
from app.models.user import User
from app.services.agentic_runtime import _credits_available

router = APIRouter()

# Only what a visitor needs to draw the conversation: never prompts, keys or other node settings.
DISPLAY_KEYS = ("welcome_message", "message", "question", "option_1", "option_2", "option_3", "option_4")
PUBLIC_RUNS_PER_IP_HOUR = 12
PUBLIC_RUNS_PER_LINK_DAY = 150
PUBLIC_MESSAGES_PER_IP_HOUR = 60
_MESSAGES: dict[str, deque] = defaultdict(deque)


class ShareWrite(BaseModel):
    class_ids: list[UUID] | None = None
    session_ids: list[UUID] | None = None
    public_enabled: bool | None = None
    regenerate_token: bool = False


class SharedRunCreate(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)


def _summary(workflow: AgenticWorkflow) -> dict[str, Any]:
    return {
        "id": str(workflow.id), "title": workflow.title,
        "shared_class_ids": workflow.shared_class_ids or [], "shared_session_ids": workflow.shared_session_ids or [],
        "public_enabled": bool(workflow.public_enabled),
        "public_token": workflow.public_token if workflow.public_enabled else None,
    }


def _blocked_nodes(workflow: AgenticWorkflow) -> list[str]:
    nodes = (workflow.graph_json or {}).get("nodes") or []
    return sorted({str(n.get("id")) for n in nodes if isinstance(n, dict) and str(n.get("id") or "").startswith("platform.")})


def _ensure_shareable(workflow: AgenticWorkflow) -> None:
    blocked = _blocked_nodes(workflow)
    if blocked:
        raise HTTPException(status_code=422, detail=(
            "Questo workflow usa nodi che leggono i tuoi dati privati (" + ", ".join(blocked) + "): rimuovili per condividerlo."))


def _app_payload(workflow: AgenticWorkflow, author: str = "") -> dict[str, Any]:
    graph = workflow.graph_json or {}
    nodes = [
        {"id": n.get("id"), "instanceId": n.get("instanceId"),
         "config": {k: (n.get("config") or {}).get(k) for k in DISPLAY_KEYS if k in (n.get("config") or {})}}
        for n in graph.get("nodes") or [] if isinstance(n, dict)
    ]
    edges = [{"from": e.get("from"), "to": e.get("to")} for e in graph.get("edges") or [] if isinstance(e, dict)]
    return {"id": str(workflow.id), "title": workflow.title, "author": author, "chat": _has_chatbot_nodes(workflow),
            "graph": {"nodes": nodes, "edges": edges}, "updated_at": workflow.updated_at.isoformat()}


def _strip(value: Any) -> Any:
    """Visitors get results, never the model prompts a node carries in its output."""
    if isinstance(value, dict):
        return {k: _strip(v) for k, v in value.items() if k not in {"system_prompt", "prompt"}}
    if isinstance(value, list):
        return [_strip(v) for v in value]
    return value


async def _visitor_run(db: AsyncSession, run: AgenticWorkflowRun) -> dict[str, Any]:
    payload = await _run_payload(db, run)
    payload.pop("input", None)
    payload["output"] = _strip(payload.get("output") or {})
    payload["nodes"] = [
        {k: (_strip(v) if k == "output" else v) for k, v in node.items()
         if k in {"node_instance_id", "visit", "label", "status", "output", "error", "sequence"}}
        for node in payload["nodes"]
    ]
    return payload


async def _owner(db: AsyncSession, workflow: AgenticWorkflow) -> User:
    owner = await db.get(User, workflow.created_by_user_id) if workflow.created_by_user_id else None
    if owner is None or getattr(owner, "is_active", True) is False:
        raise HTTPException(status_code=404, detail="Workflow non disponibile")
    return owner


def _client_key(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    host = forwarded or (request.client.host if request.client else "unknown")
    return hashlib.sha256(host.encode()).hexdigest()[:16]


# ── Teacher: choose who can reach the workflow ───────────────────────────

async def _teacher_sessions(db: AsyncSession, classes: list) -> list[Session]:
    ids = [c.id for c in classes]
    if not ids:
        return []
    result = await db.execute(
        select(Session).where(Session.class_id.in_(ids), Session.deleted_at.is_(None)).order_by(Session.created_at.desc()).limit(80))
    return list(result.scalars().all())


@router.get("/share/targets")
async def share_targets(
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    classes = await _teacher_class_rows(db, teacher)
    names = {c.id: c.name for c in classes}
    return {
        "classes": [{"id": str(c.id), "name": c.name, "school_grade": c.school_grade} for c in classes],
        "sessions": [{"id": str(s.id), "title": s.title, "class_id": str(s.class_id), "class_name": names.get(s.class_id, "")}
                     for s in await _teacher_sessions(db, classes)],
    }


async def _mine(db: AsyncSession, workflow_id: UUID, teacher: User) -> AgenticWorkflow:
    workflow = await db.scalar(select(AgenticWorkflow).where(
        AgenticWorkflow.id == workflow_id, AgenticWorkflow.created_by_user_id == teacher.id))
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow non trovato")
    return workflow


@router.get("/share/workflows/{workflow_id}")
async def get_share(workflow_id: UUID, teacher: Annotated[User, Depends(get_current_teacher)], db: Annotated[AsyncSession, Depends(get_db)]):
    return _summary(await _mine(db, workflow_id, teacher))


@router.put("/share/workflows/{workflow_id}")
async def update_share(
    workflow_id: UUID, body: ShareWrite,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workflow = await _mine(db, workflow_id, teacher)
    classes = await _teacher_class_rows(db, teacher)
    allowed_classes = {c.id for c in classes}
    if body.class_ids is not None:
        if any(cid not in allowed_classes for cid in body.class_ids):
            raise HTTPException(status_code=403, detail="Puoi condividere solo con le tue classi")
        workflow.shared_class_ids = sorted({str(cid) for cid in body.class_ids})
    if body.session_ids is not None:
        allowed_sessions = {s.id for s in await _teacher_sessions(db, classes)}
        if any(sid not in allowed_sessions for sid in body.session_ids):
            raise HTTPException(status_code=403, detail="Puoi condividere solo con le sessioni delle tue classi")
        workflow.shared_session_ids = sorted({str(sid) for sid in body.session_ids})
    if body.public_enabled is not None:
        workflow.public_enabled = body.public_enabled
    if workflow.public_enabled and (not workflow.public_token or body.regenerate_token):
        workflow.public_token = secrets.token_urlsafe(18)
    if workflow.public_enabled or workflow.shared_class_ids or workflow.shared_session_ids:
        _ensure_shareable(workflow)
    await db.commit()
    await db.refresh(workflow)
    return _summary(workflow)


# ── Students: workflows shared with their session or class ───────────────

async def _student_shared(db: AsyncSession, student: SessionStudent) -> list[AgenticWorkflow]:
    session = await db.get(Session, student.session_id)
    if not session:
        return []
    result = await db.execute(
        select(AgenticWorkflow).where(
            AgenticWorkflow.tenant_id == student.tenant_id,
            or_(AgenticWorkflow.shared_class_ids.contains([str(session.class_id)]),
                AgenticWorkflow.shared_session_ids.contains([str(session.id)])),
        ).order_by(AgenticWorkflow.updated_at.desc()))
    return [w for w in result.scalars().all() if not _blocked_nodes(w)]


async def _graph_for_student(db: AsyncSession, workflow: AgenticWorkflow, student: SessionStudent) -> dict[str, Any]:
    """The copy's saved-dataset nodes point at private copies of the teacher's datasets (a student cannot read the school library)."""
    graph = json.loads(json.dumps(workflow.graph_json or {}))
    for node in graph.get("nodes") or []:
        config = node.get("config") if isinstance(node, dict) else None
        if not isinstance(config, dict) or node.get("id") != "data.saved_dataset" or not config.get("dataset_id"):
            continue
        try:
            source = await db.get(AgenticDataset, UUID(str(config["dataset_id"])))
        except ValueError:
            source = None
        if source is None or source.tenant_id != workflow.tenant_id:
            continue
        mine = AgenticDataset(id=uuid4(), tenant_id=student.tenant_id, owner_student_id=student.id, title=source.title,
                              source="shared", row_count=source.row_count, table_json=source.table_json)
        db.add(mine)
        config["dataset_id"] = str(mine.id)
    return graph


async def materialize_shared_copies(db: AsyncSession, student: SessionStudent) -> None:
    """Give the student their own copy of every workflow shared with their session/class (once; deleting it keeps a tombstone)."""
    shared = await _student_shared(db, student)
    if not shared:
        return
    have = set((await db.execute(select(AgenticWorkflow.source_workflow_id).where(
        AgenticWorkflow.owner_student_id == student.id, AgenticWorkflow.source_workflow_id.is_not(None)))).scalars().all())
    created = False
    for workflow in shared:
        if workflow.id in have:
            continue
        db.add(AgenticWorkflow(
            tenant_id=student.tenant_id, created_by_user_id=None, owner_student_id=student.id, source_workflow_id=workflow.id,
            title=workflow.title, graph_json=await _graph_for_student(db, workflow, student)))
        created = True
    if created:
        try:
            await db.commit()
        except IntegrityError:  # two polls raced: the other one created the copies
            await db.rollback()


async def has_shared_workflows(db: AsyncSession, student: SessionStudent) -> bool:
    return bool(await _student_shared(db, student))


def _share_tag(kind: str, ref: str, **extra: Any) -> dict[str, Any]:
    return {"_share": kind, "_share_ref": ref, **extra}


async def _own_shared_run(db: AsyncSession, run_id: UUID, kind: str, ref: str) -> tuple[AgenticWorkflowRun, AgenticWorkflow]:
    run = await db.get(AgenticWorkflowRun, run_id)
    data = (run.input_json or {}) if run else {}
    if not run or data.get("_share") != kind or data.get("_share_ref") != ref:
        raise HTTPException(status_code=404, detail="Esecuzione non trovata")
    workflow = await db.get(AgenticWorkflow, run.workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow non disponibile")
    return run, workflow


@router.get("/share/student")
async def list_student_apps(
    student: Annotated[SessionStudent, Depends(get_current_student)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    out = []
    for workflow in await _student_shared(db, student):
        owner = await db.get(User, workflow.created_by_user_id) if workflow.created_by_user_id else None
        author = " ".join(p for p in (getattr(owner, "first_name", None), getattr(owner, "last_name", None)) if p)
        out.append(_app_payload(workflow, author))
    return out


# ── Anonymous link ───────────────────────────────────────────────────────

async def _public_workflow(db: AsyncSession, token: str) -> AgenticWorkflow:
    workflow = await db.scalar(select(AgenticWorkflow).where(
        AgenticWorkflow.public_token == token, AgenticWorkflow.public_enabled.is_(True)))
    if not workflow or _blocked_nodes(workflow):
        raise HTTPException(status_code=404, detail="Link non valido o disattivato")
    return workflow


@router.get("/share/public/{token}")
async def get_public_app(token: str, db: Annotated[AsyncSession, Depends(get_db)]):
    workflow = await _public_workflow(db, token)
    owner = await db.get(User, workflow.created_by_user_id) if workflow.created_by_user_id else None
    author = " ".join(p for p in (getattr(owner, "first_name", None), getattr(owner, "last_name", None)) if p)
    return _app_payload(workflow, author)


@router.post("/share/public/{token}/runs", status_code=201)
async def start_public_app(token: str, _body: SharedRunCreate, request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    workflow = await _public_workflow(db, token)
    owner = await _owner(db, workflow)
    visitor = _client_key(request)
    now = datetime.now(timezone.utc)

    async def recent(extra, since: timedelta) -> int:
        return int(await db.scalar(select(func.count()).select_from(AgenticWorkflowRun).where(
            AgenticWorkflowRun.workflow_id == workflow.id, AgenticWorkflowRun.created_at > now - since, *extra)) or 0)

    if await recent([AgenticWorkflowRun.input_json.op("->>")("_visitor") == visitor], timedelta(hours=1)) >= PUBLIC_RUNS_PER_IP_HOUR \
            or await recent([AgenticWorkflowRun.input_json.op("->>")("_share") == "public"], timedelta(days=1)) >= PUBLIC_RUNS_PER_LINK_DAY:
        raise HTTPException(status_code=429, detail="Troppe richieste a questo link: riprova più tardi.")
    if not await _credits_available(db, owner):
        raise HTTPException(status_code=503, detail="Il servizio non è al momento disponibile.")
    run = AgenticWorkflowRun(workflow_id=workflow.id, tenant_id=workflow.tenant_id, created_by_user_id=owner.id, status="running",
                             input_json=_share_tag("public", token, _visitor=visitor))
    db.add(run)
    await db.commit()
    await db.refresh(run)
    _spawn_run(workflow.id, run.id, owner)
    return await _visitor_run(db, run)


@router.get("/share/public/{token}/runs/{run_id}")
async def get_public_app_run(token: str, run_id: UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    await _public_workflow(db, token)
    run, _ = await _own_shared_run(db, run_id, "public", token)
    return await _visitor_run(db, run)


@router.post("/share/public/{token}/runs/{run_id}/input")
async def public_app_input(token: str, run_id: UUID, body: ChatInput, request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    workflow = await _public_workflow(db, token)
    run, _ = await _own_shared_run(db, run_id, "public", token)
    owner = await _owner(db, workflow)
    window = _MESSAGES[_client_key(request)]
    now = time.monotonic()
    while window and now - window[0] > 3600:
        window.popleft()
    if len(window) >= PUBLIC_MESSAGES_PER_IP_HOUR:
        raise HTTPException(status_code=429, detail="Troppi messaggi: riprova più tardi.")
    window.append(now)
    if not await _credits_available(db, owner):
        raise HTTPException(status_code=503, detail="Il servizio non è al momento disponibile.")
    if run.status == "waiting":
        run.status = "running"
        await db.commit()
        _spawn_run(workflow.id, run.id, owner, body.content)
        return await _visitor_run(db, run)
    await _resume_chat_run(db, run, workflow, body.content, owner)  # raises 409 with the reason
    return await _visitor_run(db, run)
