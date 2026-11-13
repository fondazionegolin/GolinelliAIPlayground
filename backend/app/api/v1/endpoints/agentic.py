import asyncio
import json
import logging
from types import SimpleNamespace
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_current_teacher, get_student_or_teacher
from app.models.session import SessionModule
from app.core.database import AsyncSessionLocal, get_db
from app.models.agentic import AgenticAssistantConversation, AgenticDataset, AgenticNodeRun, AgenticWorkflow, AgenticWorkflowRun
from app.models.session import Session, SessionStudent
from app.models.user import User
from app.services import agentic_assistant, agentic_assistant_agents
from app.services.agentic_assistant import student_catalog
from app.services import model_selection
from app.services.agentic_runtime import (
    NODE_REGISTRY, StudentRunActor, _credits_available, advance_conversation, billing_user, configured_models, execute_node_isolated, execute_run,
    _dataset_owner, student_node_allowed, validate_graph,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class WorkflowWrite(BaseModel):
    title: str = Field(default="Workflow senza titolo", min_length=1, max_length=180)
    graph: dict[str, Any]


class RunCreate(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)
    session_id: UUID | None = None
    # The Studio asks for the run to continue on the server and polls it, so the canvas follows the real node.
    background: bool = False


class ChatInput(BaseModel):
    content: str = Field(min_length=1, max_length=12000)
    background: bool = False


class NodeExecute(BaseModel):
    node: dict[str, Any]
    inputs: dict[str, Any] = Field(default_factory=dict)
    workflow_id: str | None = None  # needed by db.* nodes: named tables belong to a saved workflow


class AssistantCompile(BaseModel):
    blueprint: dict[str, Any]
    allow_destructive: bool = False


class AssistantIntake(BaseModel):
    intent: str = Field(min_length=1, max_length=4000)
    answers: list[dict[str, str]] = Field(default_factory=list, max_length=6)


class AssistantPlan(BaseModel):
    intent: str = Field(min_length=1, max_length=4000)
    understanding: str = Field(min_length=1, max_length=1000)
    assumptions: list[str] = Field(default_factory=list, max_length=8)
    answers: list[dict[str, str]] = Field(default_factory=list, max_length=6)
    allow_destructive: bool = False
    previous_blueprint: dict[str, Any] | None = None  # revise this plan instead of designing from scratch
    feedback: str = Field(default="", max_length=2000)


class AssistantEdit(BaseModel):
    graph: dict[str, Any]
    instruction: str = Field(min_length=1, max_length=2000)
    selected: str | None = None
    history: list[dict[str, str]] = Field(default_factory=list, max_length=24)
    allow_destructive: bool = False


class AssistantLint(BaseModel):
    graph: dict[str, Any]


class ConversationCreate(BaseModel):
    workflow_id: UUID | None = None
    title: str = Field(default="Nuova conversazione", max_length=180)
    messages: list[dict[str, Any]] = Field(default_factory=list, max_length=400)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    workflow_id: UUID | None = None
    messages: list[dict[str, Any]] | None = Field(default=None, max_length=400)


def _workflow_payload(workflow: AgenticWorkflow) -> dict[str, Any]:
    return {
        "id": str(workflow.id), "title": workflow.title, "status": workflow.status,
        "version": workflow.version, "graph": workflow.graph_json, "shared_from_teacher": workflow.source_workflow_id is not None,
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


DATAFLOW_MODULE = "dataflow"


async def dataflow_actor(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> "User | StudentRunActor":
    """Any verified teacher; students only while their session enables the Dataflow Studio module."""
    if actor.is_student:
        enabled = await db.scalar(select(SessionModule.is_enabled).where(
            SessionModule.session_id == actor.student.session_id, SessionModule.module_key == DATAFLOW_MODULE))
        if not enabled:
            from app.api.v1.endpoints.agentic_sharing import has_shared_workflows
            enabled = await has_shared_workflows(db, actor.student)  # a teacher-shared workflow opens the Studio for that student
        if not enabled:
            raise HTTPException(status_code=403, detail="Il Dataflow Studio non è attivo in questa sessione")
        return StudentRunActor(actor.student)
    return await get_current_teacher(db, actor.teacher)  # same license / legal checks as the teacher-only endpoints


Runner = Annotated[Any, Depends(dataflow_actor)]


def _conversation_owner(owner: "User | StudentRunActor"):
    if isinstance(owner, StudentRunActor):
        return AgenticAssistantConversation.owner_student_id == owner.id
    return AgenticAssistantConversation.created_by_user_id == owner.id


async def _require_credits(db: AsyncSession, owner: "User | StudentRunActor") -> None:
    """Students' assistant calls draw on the student pool: stop before the model call when it is empty."""
    if isinstance(owner, StudentRunActor) and not await _credits_available(db, owner):
        raise HTTPException(status_code=402, detail="Crediti esauriti: chiedi al docente di verificare il limite della sessione.")


def _owner_clause(owner: "User | StudentRunActor"):
    if isinstance(owner, StudentRunActor):
        return AgenticWorkflow.owner_student_id == owner.id
    return AgenticWorkflow.created_by_user_id == owner.id


def _check_student_graph(graph: dict[str, Any], owner: "User | StudentRunActor") -> None:
    if not isinstance(owner, StudentRunActor):
        return
    for node in graph.get("nodes") or []:
        node_id = str(node.get("id") or "") if isinstance(node, dict) else ""
        if not student_node_allowed(node_id):
            raise HTTPException(status_code=422, detail=f"Il nodo «{node_id}» non è disponibile per gli studenti")


async def _owned_workflow(db: AsyncSession, workflow_id: UUID, teacher: "User | StudentRunActor") -> AgenticWorkflow:
    result = await db.execute(select(AgenticWorkflow).where(
        AgenticWorkflow.id == workflow_id,
        _owner_clause(teacher),
    ))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow non trovato")
    return workflow


async def _owned_run(db: AsyncSession, run_id: UUID, teacher: "User | StudentRunActor") -> tuple[AgenticWorkflowRun, AgenticWorkflow]:
    result = await db.execute(
        select(AgenticWorkflowRun, AgenticWorkflow)
        .join(AgenticWorkflow, AgenticWorkflow.id == AgenticWorkflowRun.workflow_id)
        .where(AgenticWorkflowRun.id == run_id, _owner_clause(teacher))
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


_RUN_TASKS: set[asyncio.Task] = set()  # strong references: a bare create_task can be garbage-collected mid-run


async def _run_in_background(workflow_id: UUID, run_id: UUID, actor_id: UUID, content: str | None, student: bool = False) -> None:
    """Execute (or resume) a run on its own session. Progress is committed node by node, so a poller sees the real state."""
    try:
        async with AsyncSessionLocal() as db:
            run = await db.get(AgenticWorkflowRun, run_id)
            workflow = await db.get(AgenticWorkflow, workflow_id)
            if student:
                from app.models.session import SessionStudent
                row = await db.get(SessionStudent, actor_id)
                actor = StudentRunActor(row) if row is not None else None
            else:
                actor = await db.get(User, actor_id)
            if run is None or workflow is None or actor is None:
                return
            if _has_chatbot_nodes(workflow):
                await advance_conversation(db, workflow, run, actor, user_input=content)
            else:
                await execute_run(db, workflow, run, actor)
    except Exception as exc:
        logger.exception("Background run %s crashed", run_id)
        async with AsyncSessionLocal() as db:
            run = await db.get(AgenticWorkflowRun, run_id)
            if run is not None and run.status in {"queued", "running"}:
                run.status, run.error_message = "failed", str(exc) or exc.__class__.__name__
                await db.commit()


def _spawn_run(workflow_id: UUID, run_id: UUID, actor: "User | StudentRunActor", content: str | None = None) -> None:
    task = asyncio.create_task(_run_in_background(workflow_id, run_id, actor.id, content, isinstance(actor, StudentRunActor)))
    _RUN_TASKS.add(task)
    task.add_done_callback(_RUN_TASKS.discard)


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
    # Students chatting with a published dataflow bot: the AI tokens are billed to the workflow's owner.
    owner = actor if isinstance(actor, (User, StudentRunActor)) else await db.get(User, workflow.created_by_user_id)
    token = billing_user.set(owner)
    try:
        await advance_conversation(db, workflow, run, actor, user_input=content)
    finally:
        billing_user.reset(token)
    return await _run_payload(db, run)


@router.get("/registry")
async def get_registry(teacher: Runner):
    await model_selection.refresh_cache()  # the editor shows the admin's latest Agentic list, not the 30 s cache
    models = configured_models()
    return {
        "models": models,
        "portTypes": ["TABLE", "SERIES", "ARRAY_3D", "MODEL", "METRICS", "PARAMS", "ANY"],
        "paramTypes": ["STRING", "NUMBER", "INTEGER", "BOOLEAN", "SELECT", "MULTI_SELECT", "SLIDER", "COLOR", "FILE", "CODE", "COLUMN", "COLUMNS", "DATASET"],
        "nodes": [_with_model_menu(node, models) for node in NODE_REGISTRY.values()
                  if not isinstance(teacher, StudentRunActor) or student_node_allowed(node["id"])],
    }


def _with_model_menu(node: dict[str, Any], models: list[dict[str, str]]) -> dict[str, Any]:
    """Show the free-text provider/model params as one menu of the models enabled for Agentic (Admin → Modelli)."""
    names = {p["name"] for p in node.get("params", [])}
    if not {"provider", "model"} <= names:
        return node
    options = [""] + [f"{m['provider']}|{m['model']}" for m in models]
    labels = {"": "Predefinito", **{f"{m['provider']}|{m['model']}": m["name"] for m in models}}
    params = [p if p["name"] != "model" else {**p, "type": "SELECT", "label": "Modello", "options": options, "optionLabels": labels}
              for p in node["params"] if p["name"] != "provider"]
    return {**node, "params": params}


def _dataset_scope(owner: "User | StudentRunActor"):
    """Teachers share the school's library; a student sees only the datasets they made."""
    if isinstance(owner, StudentRunActor):
        return AgenticDataset.owner_student_id == owner.id
    return and_(AgenticDataset.tenant_id == owner.tenant_id, AgenticDataset.owner_student_id.is_(None))


def _dataset_payload(dataset: AgenticDataset) -> dict[str, Any]:
    return {
        "id": str(dataset.id), "title": dataset.title, "source": dataset.source,
        "row_count": dataset.row_count, "columns": (dataset.table_json or {}).get("columns", []),
        "created_at": dataset.created_at.isoformat(),
    }


def _conversation_payload(item: AgenticAssistantConversation, with_messages: bool = True) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": str(item.id), "title": item.title,
        "workflow_id": str(item.workflow_id) if item.workflow_id else None,
        "message_count": len(item.messages or []),
        "created_at": item.created_at.isoformat(), "updated_at": item.updated_at.isoformat(),
    }
    if with_messages:
        payload["messages"] = item.messages or []
    return payload


async def _owned_conversation(db: AsyncSession, conversation_id: UUID, teacher: Any) -> AgenticAssistantConversation:
    result = await db.execute(select(AgenticAssistantConversation).where(
        AgenticAssistantConversation.id == conversation_id,
        _conversation_owner(teacher),
    ))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Conversazione non trovata")
    return item


@router.get("/assistant/conversations")
async def list_assistant_conversations(
    teacher: Runner, db: Annotated[AsyncSession, Depends(get_db)],
    workflow_id: UUID | None = None,
):
    """Saved assistant chats of the user, newest first; `workflow_id` narrows them to one workflow."""
    query = select(AgenticAssistantConversation).where(_conversation_owner(teacher))
    if workflow_id:
        query = query.where(AgenticAssistantConversation.workflow_id == workflow_id)
    result = await db.execute(query.order_by(AgenticAssistantConversation.updated_at.desc()).limit(50))
    return {"conversations": [_conversation_payload(item, with_messages=False) for item in result.scalars()]}


@router.post("/assistant/conversations", status_code=status.HTTP_201_CREATED)
async def create_assistant_conversation(
    request: ConversationCreate, teacher: Runner, db: Annotated[AsyncSession, Depends(get_db)],
):
    if request.workflow_id:
        await _owned_workflow(db, request.workflow_id, teacher)
    item = AgenticAssistantConversation(
        created_by_user_id=None if isinstance(teacher, StudentRunActor) else teacher.id,
        owner_student_id=teacher.id if isinstance(teacher, StudentRunActor) else None, workflow_id=request.workflow_id,
        title=request.title.strip() or "Nuova conversazione", messages=request.messages,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _conversation_payload(item)


@router.get("/assistant/conversations/{conversation_id}")
async def get_assistant_conversation(
    conversation_id: UUID, teacher: Runner, db: Annotated[AsyncSession, Depends(get_db)],
):
    return _conversation_payload(await _owned_conversation(db, conversation_id, teacher))


@router.put("/assistant/conversations/{conversation_id}")
async def update_assistant_conversation(
    conversation_id: UUID, request: ConversationUpdate,
    teacher: Runner, db: Annotated[AsyncSession, Depends(get_db)],
):
    item = await _owned_conversation(db, conversation_id, teacher)
    if request.title is not None:
        item.title = request.title.strip() or item.title
    if request.workflow_id is not None:
        await _owned_workflow(db, request.workflow_id, teacher)
        item.workflow_id = request.workflow_id
    if request.messages is not None:
        item.messages = request.messages
    await db.commit()
    await db.refresh(item)
    return _conversation_payload(item)


@router.delete("/assistant/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assistant_conversation(
    conversation_id: UUID, teacher: Runner, db: Annotated[AsyncSession, Depends(get_db)],
):
    item = await _owned_conversation(db, conversation_id, teacher)
    await db.delete(item)
    await db.commit()


@router.get("/assistant/catalog")
async def assistant_catalog(teacher: Runner):
    token = student_catalog.set(isinstance(teacher, StudentRunActor))
    try:
        return {**agentic_assistant.catalog_for_llm(), "text": agentic_assistant.catalog_text()}
    finally:
        student_catalog.reset(token)


@router.post("/assistant/intake")
async def assistant_intake(
    request: AssistantIntake,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    """«Ho capito bene?»: the assistant restates the intention, lists its assumptions and may ask up to 3 questions."""
    token = student_catalog.set(isinstance(teacher, StudentRunActor))
    try:
        await _require_credits(db, teacher)
        return await agentic_assistant_agents.run_intake(db, teacher, request.intent, request.answers)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("assistant intake failed")
        raise HTTPException(status_code=502, detail="L'assistente non riesce a rispondere in questo momento: riprova.") from exc
    finally:
        student_catalog.reset(token)


def _assistant_stream(teacher: Any, run: Any, failure: str) -> StreamingResponse:
    """SSE wrapper for the long model calls: ``status`` / ``ping`` while it works, then one ``result`` or ``error``.

    ``run(session, actor, report)`` returns the result dict; it gets its own session because the stream outlives the request's.
    """
    student = isinstance(teacher, StudentRunActor)
    actor = (SimpleNamespace(id=teacher.id, tenant_id=teacher.tenant_id, session_id=teacher.session_id, is_student=True)
             if student else SimpleNamespace(id=teacher.id, tenant_id=teacher.tenant_id))
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def report(message: str) -> None:
        await queue.put({"type": "status", "message": message})

    async def work() -> None:
        student_catalog.set(student)  # task-local: this coroutine runs in its own task context
        try:
            async with AsyncSessionLocal() as session:
                if student and not await _credits_available(session, teacher):
                    raise ValueError("Crediti esauriti: chiedi al docente di verificare il limite della sessione.")
                result = await run(session, actor, report)
                if student:
                    _check_student_graph(result.get("graph") or {}, teacher)
            await queue.put({"type": "result", **result})
        except ValueError as exc:
            await queue.put({"type": "error", "message": str(exc)})
        except Exception:
            logger.exception("assistant stream failed")
            await queue.put({"type": "error", "message": failure})
        finally:
            await queue.put(None)

    async def stream():
        task = asyncio.create_task(work())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=8)
                except asyncio.TimeoutError:
                    yield "data: " + json.dumps({"type": "ping"}) + "\n\n"  # keeps proxies from closing a long model wait
                    continue
                if item is None:
                    break
                yield "data: " + json.dumps(item, ensure_ascii=False) + "\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/assistant/plan")
async def assistant_plan(request: AssistantPlan, teacher: Runner):
    """The architect designs (or, with ``previous_blueprint`` + ``feedback``, revises) the workflow. SSE: status / ping / result / error."""
    async def run(session: AsyncSession, actor: Any, report: Any) -> dict[str, Any]:
        return await agentic_assistant_agents.run_architect(
            session, actor, request.intent, request.understanding, request.assumptions, request.answers,
            allow_destructive=request.allow_destructive, on_status=report,
            previous_blueprint=request.previous_blueprint, feedback=request.feedback,
        )
    return _assistant_stream(teacher, run, "L'assistente non è riuscito a progettare il workflow: riprova.")


async def _annotate_saved_datasets(db: AsyncSession, actor: Any, graph: dict[str, Any]) -> dict[str, Any]:
    """Give the editor agent the columns of saved datasets (and which ones are time axes), unknown from the graph alone."""
    from app.services.dataflow_forecast import time_columns
    from app.services.dataflow_nodes import table_frame

    nodes = []
    for node in graph.get("nodes") or []:
        dataset_id = str((node.get("config") or {}).get("dataset_id") or "")
        if node.get("id") == "data.saved_dataset" and dataset_id:
            try:
                dataset = await db.get(AgenticDataset, UUID(dataset_id))
            except ValueError:
                dataset = None
            if dataset is not None and (dataset.owner_student_id == actor.id if isinstance(actor, StudentRunActor) else dataset.tenant_id == actor.tenant_id and dataset.owner_student_id is None):
                table = dataset.table_json or {}
                try:
                    temporal = time_columns(table_frame(table)) if table.get("rows") else []
                except ValueError:
                    temporal = []
                node = {**node, "config": {**node["config"], "_dataset": {"columns": table.get("columns") or [], "time_columns": temporal}}}
        nodes.append(node)
    return {**graph, "nodes": nodes}


def _strip_annotations(graph: Any) -> None:
    for node in (graph or {}).get("nodes") or [] if isinstance(graph, dict) else []:
        (node.get("config") or {}).pop("_dataset", None)


@router.post("/assistant/edit")
async def assistant_edit(request: AssistantEdit, teacher: Runner):
    """Edit the workflow already on the canvas. SSE result: ``graph``, canvas ``ops`` (diff), human ``summary``, ``issues``, ``explanation``."""
    _check_student_graph(request.graph, teacher)
    try:
        validate_graph(request.graph)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Il Canvas non è valido: {exc}") from exc

    async def run(session: AsyncSession, actor: Any, report: Any) -> dict[str, Any]:
        graph = await _annotate_saved_datasets(session, actor, request.graph)
        result = await agentic_assistant_agents.run_editor(
            session, actor, graph, request.instruction, request.selected, request.history,
            allow_destructive=request.allow_destructive, on_status=report,
        )
        _strip_annotations(result.get("graph"))
        for op in result.get("ops") or []:
            if isinstance(op.get("config"), dict):
                op["config"].pop("_dataset", None)
            if isinstance(op.get("node"), dict):
                (op["node"].get("config") or {}).pop("_dataset", None)
        return result
    return _assistant_stream(teacher, run, "L'assistente non è riuscito a preparare la modifica: riprova.")


@router.post("/assistant/compile")
async def assistant_compile(request: AssistantCompile, teacher: Runner):
    """Blueprint → graph, canvas operations, cost estimate and static review. Pure: nothing is saved or executed."""
    token = student_catalog.set(isinstance(teacher, StudentRunActor))
    try:
        return agentic_assistant.compile_blueprint(request.blueprint, allow_destructive=request.allow_destructive)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        student_catalog.reset(token)


@router.post("/assistant/lint")
async def assistant_lint(request: AssistantLint, teacher: Runner):
    _check_student_graph(request.graph, teacher)
    return {"issues": agentic_assistant.lint_graph(request.graph), "estimate": agentic_assistant.estimate_cost(request.graph)}


@router.get("/datasets")
async def list_datasets(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    result = await db.execute(select(AgenticDataset).where(
        _dataset_scope(teacher),
    ).order_by(AgenticDataset.created_at.desc()).limit(100))
    return [_dataset_payload(item) for item in result.scalars().all()]


class DatasetCreate(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    table: dict[str, Any]


@router.post("/datasets", status_code=status.HTTP_201_CREATED)
async def create_dataset(
    request: DatasetCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    rows = request.table.get("rows")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=422, detail="La tabella da salvare è vuota o non valida")
    dataset = AgenticDataset(
        tenant_id=teacher.tenant_id, **_dataset_owner(teacher), title=request.title.strip(),
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
    teacher: Runner,
):
    result = await db.execute(select(AgenticDataset).where(
        AgenticDataset.id == dataset_id, _dataset_scope(teacher),
    ))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset non trovato")
    await db.delete(dataset)
    await db.commit()


@router.post("/validate")
async def validate_workflow(
    request: WorkflowWrite,
    teacher: Runner,
):
    try:
        _check_student_graph(request.graph, teacher)
        validate_graph(request.graph)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"valid": True, "nodes": len(request.graph["nodes"]), "edges": len(request.graph["edges"])}


@router.post("/execute-node")
async def execute_single_node(
    request: NodeExecute,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    try:
        if request.workflow_id:
            try:
                owned_id = UUID(str(request.workflow_id))
            except ValueError:
                raise HTTPException(status_code=422, detail="workflow_id non valido") from None
            await _owned_workflow(db, owned_id, teacher)  # db.* nodes read/write that workflow's tables
        return await execute_node_isolated(request.node, request.inputs, db=db, actor=teacher, workflow_id=request.workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/workflows")
async def list_workflows(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    if isinstance(teacher, StudentRunActor):
        from app.api.v1.endpoints.agentic_sharing import materialize_shared_copies
        student = await db.get(SessionStudent, teacher.id)
        if student is not None:
            await materialize_shared_copies(db, student)
    result = await db.execute(select(AgenticWorkflow).where(
        _owner_clause(teacher), AgenticWorkflow.status != "dismissed",
    ).order_by(AgenticWorkflow.updated_at.desc()))
    return [_workflow_payload(item) for item in result.scalars().all()]


@router.post("/workflows", status_code=status.HTTP_201_CREATED)
async def create_workflow(
    request: WorkflowWrite,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    _check_student_graph(request.graph, teacher)
    try:
        validate_graph(request.graph)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    student = isinstance(teacher, StudentRunActor)
    workflow = AgenticWorkflow(
        tenant_id=teacher.tenant_id,
        created_by_user_id=None if student else teacher.id, owner_student_id=teacher.id if student else None,
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
    teacher: Runner,
):
    return _workflow_payload(await _owned_workflow(db, workflow_id, teacher))


@router.put("/workflows/{workflow_id}")
async def update_workflow(
    workflow_id: UUID,
    request: WorkflowWrite,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    _check_student_graph(request.graph, teacher)
    try:
        validate_graph(request.graph)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    workflow = await _owned_workflow(db, workflow_id, teacher)
    workflow.title = request.title.strip()
    workflow.graph_json = request.graph
    workflow.version += 1
    await db.commit()
    await db.refresh(workflow)
    return _workflow_payload(workflow)


@router.post("/workflows/{workflow_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_workflow(
    workflow_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    """An independent copy of the graph (not of its runs, sharing settings or db.* table contents)."""
    source = await _owned_workflow(db, workflow_id, teacher)
    student = isinstance(teacher, StudentRunActor)
    copy = AgenticWorkflow(
        tenant_id=source.tenant_id,
        created_by_user_id=None if student else teacher.id, owner_student_id=teacher.id if student else None,
        title=f"{source.title} (copia)"[:180], graph_json=json.loads(json.dumps(source.graph_json or {})),
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return _workflow_payload(copy)


@router.delete("/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    workflow = await _owned_workflow(db, workflow_id, teacher)
    if workflow.source_workflow_id is not None and isinstance(teacher, StudentRunActor):
        workflow.status = "dismissed"  # tombstone: the shared workflow must not come back as a new copy
        workflow.graph_json = {}
    else:
        await db.delete(workflow)
    await db.commit()


@router.post("/workflows/{workflow_id}/runs", status_code=status.HTTP_201_CREATED)
async def create_run(
    workflow_id: UUID,
    request: RunCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    workflow = await _owned_workflow(db, workflow_id, teacher)
    if isinstance(teacher, StudentRunActor):
        request.session_id = None  # student workflows never publish a chatbot to the class
    if request.session_id:
        result = await db.execute(select(Session).where(
            Session.id == request.session_id,
            Session.tenant_id == teacher.tenant_id,
            Session.deleted_at.is_(None),
        ))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Sessione di classe non trovata")
        if not _has_chatbot_nodes(workflow):
            raise HTTPException(status_code=422, detail="Il workflow non contiene nodi chatbot")
    run = AgenticWorkflowRun(
        workflow_id=workflow.id, tenant_id=teacher.tenant_id,
        created_by_user_id=None if isinstance(teacher, StudentRunActor) else teacher.id,
        input_json={**request.inputs, **({"_session_id": str(request.session_id)} if request.session_id else {})},
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    if request.background:
        run.status = "running"
        await db.commit()
        _spawn_run(workflow.id, run.id, teacher)
        return await _run_payload(db, run)
    if _has_chatbot_nodes(workflow):
        await advance_conversation(db, workflow, run, teacher)
    else:
        await execute_run(db, workflow, run, teacher)
    return await _run_payload(db, run)


@router.get("/workflows/{workflow_id}/runs")
async def list_runs(
    workflow_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    workflow = await _owned_workflow(db, workflow_id, teacher)
    result = await db.execute(select(AgenticWorkflowRun).where(
        AgenticWorkflowRun.workflow_id == workflow.id,
    ).order_by(AgenticWorkflowRun.created_at.desc()).limit(30))
    return [await _run_payload(db, item) for item in result.scalars().all()]


@router.get("/runs/{run_id}")
async def get_run(
    run_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    run, _ = await _owned_run(db, run_id, teacher)
    return await _run_payload(db, run)


@router.post("/runs/{run_id}/stop")
async def stop_run(
    run_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Runner,
):
    run, _ = await _owned_run(db, run_id, teacher)
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
    teacher: Runner,
):
    run, workflow = await _owned_run(db, run_id, teacher)
    if request.background:
        if run.status != "waiting":
            return await _resume_chat_run(db, run, workflow, request.content, teacher)  # raises the 409 with the reason
        run.status = "running"
        await db.commit()
        _spawn_run(workflow.id, run.id, teacher, request.content)
        return await _run_payload(db, run)
    return await _resume_chat_run(db, run, workflow, request.content, teacher)


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
