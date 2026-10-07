from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_current_admin, get_student_or_teacher
from app.core.database import get_db
from app.models.agentic import AgenticDataset, AgenticNodeRun, AgenticWorkflow, AgenticWorkflowRun
from app.models.session import Session
from app.models.user import User
from app.services.agentic_runtime import NODE_REGISTRY, advance_conversation, configured_models, execute_node_isolated, execute_run, validate_graph


router = APIRouter()


class WorkflowWrite(BaseModel):
    title: str = Field(default="Workflow senza titolo", min_length=1, max_length=180)
    graph: dict[str, Any]


class RunCreate(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)
    session_id: UUID | None = None


class ChatInput(BaseModel):
    content: str = Field(min_length=1, max_length=12000)


class NodeExecute(BaseModel):
    node: dict[str, Any]
    inputs: dict[str, Any] = Field(default_factory=dict)


def _workflow_payload(workflow: AgenticWorkflow) -> dict[str, Any]:
    return {
        "id": str(workflow.id), "title": workflow.title, "status": workflow.status,
        "version": workflow.version, "graph": workflow.graph_json,
        "created_at": workflow.created_at.isoformat(), "updated_at": workflow.updated_at.isoformat(),
    }


def _node_run_payload(node_run: AgenticNodeRun) -> dict[str, Any]:
    return {
        "id": str(node_run.id), "node_instance_id": node_run.node_instance_id,
        "node_type": node_run.node_type, "label": node_run.label, "sequence": node_run.sequence, "visit": node_run.visit,
        "status": node_run.status, "input": node_run.input_json, "output": node_run.output_json,
        "provider": node_run.provider, "model": node_run.model,
        "prompt_tokens": node_run.prompt_tokens, "completion_tokens": node_run.completion_tokens,
        "duration_ms": node_run.duration_ms, "error": node_run.error_message,
        "started_at": node_run.started_at.isoformat() if node_run.started_at else None,
        "completed_at": node_run.completed_at.isoformat() if node_run.completed_at else None,
    }


async def _owned_workflow(db: AsyncSession, workflow_id: UUID, admin: User) -> AgenticWorkflow:
    result = await db.execute(select(AgenticWorkflow).where(
        AgenticWorkflow.id == workflow_id,
        AgenticWorkflow.created_by_user_id == admin.id,
    ))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow non trovato")
    return workflow


async def _owned_run(db: AsyncSession, run_id: UUID, admin: User) -> tuple[AgenticWorkflowRun, AgenticWorkflow]:
    result = await db.execute(
        select(AgenticWorkflowRun, AgenticWorkflow)
        .join(AgenticWorkflow, AgenticWorkflow.id == AgenticWorkflowRun.workflow_id)
        .where(AgenticWorkflowRun.id == run_id, AgenticWorkflow.created_by_user_id == admin.id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Run non trovata")
    return row[0], row[1]


async def _run_payload(db: AsyncSession, run: AgenticWorkflowRun) -> dict[str, Any]:
    result = await db.execute(select(AgenticNodeRun).where(AgenticNodeRun.run_id == run.id).order_by(AgenticNodeRun.sequence))
    node_runs = result.scalars().all()
    return {
        "id": str(run.id), "workflow_id": str(run.workflow_id), "status": run.status,
        "input": run.input_json, "output": run.output_json, "artifacts": run.artifacts_json,
        "error": run.error_message,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_at": run.created_at.isoformat(),
        "nodes": [_node_run_payload(item) for item in node_runs],
    }


def _has_chatbot_nodes(workflow: AgenticWorkflow) -> bool:
    nodes = (workflow.graph_json or {}).get("nodes") or []
    return any(str(node.get("id") or "").startswith("chatbot.") or node.get("id") == "llm_chatbot" for node in nodes if isinstance(node, dict))


async def _ensure_session_access(db: AsyncSession, session_id: UUID, actor: StudentOrTeacher) -> Session:
    if actor.student and actor.student.session_id != session_id:
        raise HTTPException(status_code=403, detail="La sessione non appartiene allo studente")
    query = select(Session).where(Session.id == session_id, Session.deleted_at.is_(None))
    if actor.teacher:
        query = query.where(Session.tenant_id == actor.teacher.tenant_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    return session


async def _resume_chat_run(db: AsyncSession, run: AgenticWorkflowRun, workflow: AgenticWorkflow,
                           content: str, actor: Any) -> dict[str, Any]:
    if run.status != "waiting":
        reason = {
            "failed": f"La conversazione si è interrotta per un errore: {run.error_message or 'sconosciuto'}",
            "cancelled": "La conversazione è stata fermata",
            "completed": "La conversazione è già conclusa",
            "running": "Il flusso sta ancora elaborando il passo precedente: attendi o premi Stop",
        }.get(run.status, "La conversazione non attende una risposta")
        raise HTTPException(status_code=409, detail=reason)
    await advance_conversation(db, workflow, run, actor, user_input=content)
    return await _run_payload(db, run)


@router.get("/registry")
async def get_registry(admin: Annotated[User, Depends(get_current_admin)]):
    del admin
    return {
        "models": configured_models(),
        "portTypes": ["TABLE", "SERIES", "ARRAY_3D", "MODEL", "METRICS", "PARAMS", "ANY"],
        "paramTypes": ["STRING", "NUMBER", "INTEGER", "BOOLEAN", "SELECT", "MULTI_SELECT", "SLIDER", "COLOR", "FILE", "CODE", "COLUMN", "COLUMNS", "DATASET"],
        "nodes": list(NODE_REGISTRY.values()),
    }


def _dataset_payload(dataset: AgenticDataset) -> dict[str, Any]:
    return {
        "id": str(dataset.id), "title": dataset.title, "source": dataset.source,
        "row_count": dataset.row_count, "columns": (dataset.table_json or {}).get("columns", []),
        "created_at": dataset.created_at.isoformat(),
    }


@router.get("/datasets")
async def list_datasets(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(select(AgenticDataset).where(
        AgenticDataset.tenant_id == admin.tenant_id,
    ).order_by(AgenticDataset.created_at.desc()).limit(100))
    return [_dataset_payload(item) for item in result.scalars().all()]


class DatasetCreate(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    table: dict[str, Any]


@router.post("/datasets", status_code=status.HTTP_201_CREATED)
async def create_dataset(
    request: DatasetCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    rows = request.table.get("rows")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=422, detail="La tabella da salvare è vuota o non valida")
    dataset = AgenticDataset(
        tenant_id=admin.tenant_id, created_by_user_id=admin.id, title=request.title.strip(),
        source="upload", row_count=int(request.table.get("rowCount") or len(rows)), table_json=request.table,
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return _dataset_payload(dataset)


@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    dataset_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(select(AgenticDataset).where(
        AgenticDataset.id == dataset_id, AgenticDataset.tenant_id == admin.tenant_id,
    ))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset non trovato")
    await db.delete(dataset)
    await db.commit()


@router.post("/validate")
async def validate_workflow(
    request: WorkflowWrite,
    admin: Annotated[User, Depends(get_current_admin)],
):
    del admin
    try:
        validate_graph(request.graph)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"valid": True, "nodes": len(request.graph["nodes"]), "edges": len(request.graph["edges"])}


@router.post("/execute-node")
async def execute_single_node(
    request: NodeExecute,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    try:
        return await execute_node_isolated(request.node, request.inputs, db=db, actor=admin)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/workflows")
async def list_workflows(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    result = await db.execute(select(AgenticWorkflow).where(
        AgenticWorkflow.created_by_user_id == admin.id,
    ).order_by(AgenticWorkflow.updated_at.desc()))
    return [_workflow_payload(item) for item in result.scalars().all()]


@router.post("/workflows", status_code=status.HTTP_201_CREATED)
async def create_workflow(
    request: WorkflowWrite,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    try:
        validate_graph(request.graph)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    workflow = AgenticWorkflow(
        tenant_id=admin.tenant_id, created_by_user_id=admin.id,
        title=request.title.strip(), graph_json=request.graph,
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)
    return _workflow_payload(workflow)


@router.get("/workflows/{workflow_id}")
async def get_workflow(
    workflow_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    return _workflow_payload(await _owned_workflow(db, workflow_id, admin))


@router.put("/workflows/{workflow_id}")
async def update_workflow(
    workflow_id: UUID,
    request: WorkflowWrite,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    try:
        validate_graph(request.graph)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    workflow = await _owned_workflow(db, workflow_id, admin)
    workflow.title = request.title.strip()
    workflow.graph_json = request.graph
    workflow.version += 1
    await db.commit()
    await db.refresh(workflow)
    return _workflow_payload(workflow)


@router.delete("/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    workflow = await _owned_workflow(db, workflow_id, admin)
    await db.delete(workflow)
    await db.commit()


@router.post("/workflows/{workflow_id}/runs", status_code=status.HTTP_201_CREATED)
async def create_run(
    workflow_id: UUID,
    request: RunCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    workflow = await _owned_workflow(db, workflow_id, admin)
    if request.session_id:
        result = await db.execute(select(Session).where(
            Session.id == request.session_id,
            Session.tenant_id == admin.tenant_id,
            Session.deleted_at.is_(None),
        ))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Sessione di classe non trovata")
        if not _has_chatbot_nodes(workflow):
            raise HTTPException(status_code=422, detail="Il workflow non contiene nodi chatbot")
    run = AgenticWorkflowRun(
        workflow_id=workflow.id, tenant_id=admin.tenant_id,
        created_by_user_id=admin.id,
        input_json={**request.inputs, **({"_session_id": str(request.session_id)} if request.session_id else {})},
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    if _has_chatbot_nodes(workflow):
        await advance_conversation(db, workflow, run, admin)
    else:
        await execute_run(db, workflow, run, admin)
    return await _run_payload(db, run)


@router.get("/workflows/{workflow_id}/runs")
async def list_runs(
    workflow_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    workflow = await _owned_workflow(db, workflow_id, admin)
    result = await db.execute(select(AgenticWorkflowRun).where(
        AgenticWorkflowRun.workflow_id == workflow.id,
    ).order_by(AgenticWorkflowRun.created_at.desc()).limit(30))
    return [await _run_payload(db, item) for item in result.scalars().all()]


@router.get("/runs/{run_id}")
async def get_run(
    run_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    run, _ = await _owned_run(db, run_id, admin)
    return await _run_payload(db, run)


@router.post("/runs/{run_id}/stop")
async def stop_run(
    run_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    run, _ = await _owned_run(db, run_id, admin)
    if run.status in {"running", "waiting"}:
        run.status = "cancelled"
        await db.commit()
        await db.refresh(run)
    return await _run_payload(db, run)


@router.post("/runs/{run_id}/input")
async def provide_chat_input(
    run_id: UUID,
    request: ChatInput,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    run, workflow = await _owned_run(db, run_id, admin)
    return await _resume_chat_run(db, run, workflow, request.content, admin)


@router.get("/sessions/{session_id}/chatbot")
async def get_session_chatbot(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _ensure_session_access(db, session_id, actor)
    result = await db.execute(
        select(AgenticWorkflowRun, AgenticWorkflow)
        .join(AgenticWorkflow, AgenticWorkflow.id == AgenticWorkflowRun.workflow_id)
        .where(
            AgenticWorkflowRun.input_json.op("->>")("_session_id") == str(session_id),
            AgenticWorkflowRun.tenant_id == (actor.student.tenant_id if actor.student else actor.teacher.tenant_id),
        )
        .order_by(AgenticWorkflowRun.created_at.desc())
        .limit(20)
    )
    runs = []
    for run, workflow in result.all():
        if not _has_chatbot_nodes(workflow):
            continue
        runs.append({"workflow_title": workflow.title, **await _run_payload(db, run)})
    return {"enabled": bool(runs), "runs": runs}


@router.post("/sessions/{session_id}/chatbot/runs/{run_id}/input")
async def provide_session_chat_input(
    session_id: UUID,
    run_id: UUID,
    request: ChatInput,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _ensure_session_access(db, session_id, actor)
    result = await db.execute(
        select(AgenticWorkflowRun, AgenticWorkflow)
        .join(AgenticWorkflow, AgenticWorkflow.id == AgenticWorkflowRun.workflow_id)
        .where(
            AgenticWorkflowRun.id == run_id,
            AgenticWorkflowRun.input_json.op("->>")("_session_id") == str(session_id),
        )
    )
    row = result.first()
    if not row or not _has_chatbot_nodes(row[1]):
        raise HTTPException(status_code=404, detail="Conversazione dataflow non trovata")
    return await _resume_chat_run(db, row[0], row[1], request.content, actor.student or actor.teacher)
