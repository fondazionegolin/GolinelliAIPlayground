"""Deep research endpoints for the teacher chatbot (plan proposal + background multi-agent run)."""

import logging
from datetime import datetime
from typing import Annotated, Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_teacher
from app.api.v1.endpoints.llm import get_ui_language, safe_track_usage
from app.core.database import AsyncSessionLocal, get_db
from app.models.user import User
from app.services import background_jobs, deep_research
from app.services.credit_service import credit_service
from app.core.config import settings
from app.services.llm_service import default_model_for, normalize_llm_model
from app.services.ui_language import build_output_language_instruction

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_LOG_LINES_PER_AGENT = 25


def _provider_model(request: dict) -> tuple[str, str]:
    provider = request.get("provider") or settings.DEFAULT_LLM_PROVIDER
    model = normalize_llm_model(provider, request.get("model") or default_model_for(provider)) or default_model_for(provider)
    return provider, model


@router.post("/plan")
async def propose_research_plan(
    request: dict,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Step 1: the chatbot proposes the research topics (or asks a clarifying question) for the teacher to approve."""
    content = str(request.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content required")
    provider, model = _provider_model(request)
    result = await deep_research.propose_plan(
        content, request.get("history") or [], provider, model,
        build_output_language_instruction(get_ui_language(http_request)),
        existing_title=request.get("existing_title"),
    )
    usage = result.pop("usage", None)
    if usage:
        cost = credit_service.calculate_cost_for_model(provider, model, usage["prompt_tokens"], usage["completion_tokens"])
        await safe_track_usage(db, teacher.tenant_id, provider, model, cost, {**usage, "type": "deep_research_plan"},
                               teacher_id=teacher.id, context="deep_research_plan")
    return result


@router.post("/run")
async def run_research(
    request: dict,
    http_request: Request,
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Step 2: run the approved plan as a background job streaming every sub-agent's activity (SSE)."""
    raw_plan = request.get("plan") or {}
    plan = deep_research.normalize_plan(raw_plan, "Ricerca")
    if not plan["subtopics"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Il piano non contiene sottoargomenti")
    provider, model = _provider_model(request)
    language_hint = build_output_language_instruction(get_ui_language(http_request))
    existing = request.get("existing_document") or None
    existing_content = str(existing.get("content") or "") if existing else None
    conversation_id = request.get("conversation_id")
    teacher_id, tenant_id = teacher.id, teacher.tenant_id
    base_version = int(existing.get("version") or 1) if existing else 0
    existing_title = str(existing.get("title") or "") if existing else ""

    async def stream():
        agents: dict[str, dict[str, Any]] = {}
        rounds: list[dict[str, Any]] = []
        async for event in deep_research.run_deep_research(plan, provider, model, language_hint, existing_content):
            kind = event.get("type")
            if kind == "agent":
                info = event["agent"]
                entry = agents.setdefault(info["id"], {"logs": []})
                entry.update(info)
            elif kind == "agent_log" and event["id"] in agents:
                logs = agents[event["id"]]["logs"]
                if len(logs) < MAX_LOG_LINES_PER_AGENT:
                    logs.append(event["message"])
            elif kind == "round" and event.get("status") == "done":
                rounds.append(event)
            if kind != "done":
                yield deep_research.sse(event)
                continue

            doc = event["document"]
            usage = event["usage"]
            title = existing_title or doc["title"]
            added = [s["title"] for s in plan["subtopics"]]
            message = (
                f"Ho aggiunto al documento **{title}**: " + ", ".join(added) + "."
                if existing else
                f"**Deep Research completata**: «{title}» — {len(doc['sources'])} fonti analizzate in {len(rounds)} giri. Il documento è nel pannello a destra: puoi modificarlo o chiedermi di estenderlo."
            )
            document = {
                "type": "research", "title": title, "content": doc["content"], "version": base_version + 1,
                "sources": doc["sources"], "run": {"agents": list(agents.values()), "rounds": rounds},
            }
            cost = credit_service.calculate_cost_for_model(provider, model, usage["prompt_tokens"], usage["completion_tokens"])
            async with AsyncSessionLocal() as track_db:
                await safe_track_usage(track_db, tenant_id, provider, model, cost, {**usage, "type": "deep_research_run"},
                                       teacher_id=teacher_id, context="deep_research_run")
            yield deep_research.sse({
                "type": "done", "content": message, "document": document, "provider": provider, "model": model,
                "token_usage": {**usage, "total_tokens": usage["prompt_tokens"] + usage["completion_tokens"]},
            })

    def track_progress(event: dict, state: background_jobs.ProgressState) -> None:
        kind = event.get("type")
        if kind == "status":
            state.label = str(event.get("message") or "")[:200] or state.label
        elif kind == "agent" and event["agent"].get("status") == "running":
            state.label = str(event["agent"].get("label") or "")[:200] or state.label
        elif kind == "done":
            state.data["final"] = event
            state.label = "Ricerca completata"

    async def persist_if_abandoned(status_: str, state: background_jobs.ProgressState, listening: bool) -> None:
        final = state.data.get("final")
        if listening or status_ != "succeeded" or not final or not conversation_id:
            return
        from app.models import TeacherConversation, TeacherConversationMessage
        try:
            conversation_uuid = UUID(str(conversation_id))
        except ValueError:
            return
        async with AsyncSessionLocal() as persist_db:
            conversation = (await persist_db.execute(
                select(TeacherConversation)
                .where(TeacherConversation.id == conversation_uuid, TeacherConversation.teacher_id == teacher_id)
            )).scalar_one_or_none()
            if conversation is None:
                return
            persist_db.add(TeacherConversationMessage(
                tenant_id=tenant_id, conversation_id=conversation_uuid, role="assistant",
                content=str(final.get("content") or ""), provider=final.get("provider"), model=final.get("model"),
            ))
            conversation.document_json = final.get("document")
            conversation.updated_at = datetime.utcnow()
            await persist_db.commit()

    job_id = await background_jobs.start_stream_job(
        background_jobs.JobOwner(tenant_id=tenant_id, user_id=teacher_id),
        kind="deep_research",
        title="Deep Research",
        description=(plan.get("objective") or plan["title"])[:4000],
        route="/teacher/assistant",
        resource_id=str(conversation_id) if conversation_id else None,
        stream=stream(),
        event_format="sse",
        progress_fn=track_progress,
        expected_seconds=240.0,
        on_finish=persist_if_abandoned,
    )
    return background_jobs.stream_response(job_id, "text/event-stream")
