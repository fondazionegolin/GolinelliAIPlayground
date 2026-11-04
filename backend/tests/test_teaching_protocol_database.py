"""Opt-in development PostgreSQL checks; provider calls and file writes are mocked, rows roll back."""
import copy
import base64
import json
import os
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1.endpoints import teaching_protocol as api
from app.core.config import settings
from app.models.document_draft import DocumentDraft
from app.models.credits import CreditLimit, CreditTransaction
from app.models.drive import DriveItem
from app.models.enums import Scope, UserRole
from app.models.file import File
from app.models.llm import TeacherConversation, TeacherConversationMessage
from app.models.teacherbot import Teacherbot, TeacherbotStatus
from app.models.tenant import Tenant
from app.models.user import User

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(os.getenv("TEACHING_PROTOCOL_DB_TESTS") != "1", reason="Opt-in development database checks")]
engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)


@asynccontextmanager
async def isolated():
    async with engine.connect() as connection:
        outer = await connection.begin()
        db = AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        try:
            tenant = Tenant(id=uuid4(), name="Protocol test", slug=f"protocol-test-{uuid4()}")
            db.add(tenant); await db.flush()
            teacher = User(id=uuid4(), tenant_id=tenant.id, email=f"{uuid4()}@example.invalid", role=UserRole.TEACHER, is_active=True)
            db.add(teacher); await db.flush()
            conversation = TeacherConversation(id=uuid4(), tenant_id=tenant.id, teacher_id=teacher.id,
                title="Protocollo", document_json={"type": "document", "content": "Protocollo: spiegare il ciclo dell'acqua e fare un quiz."})
            db.add(conversation); await db.commit()
            yield db, teacher, conversation
        finally:
            await db.close(); await outer.rollback()


async def test_plan_background_execution_review_recovery_and_idempotent_save(monkeypatch):
    from app.services.teaching_protocol import ProtocolPlan
    async with isolated() as (db, teacher, conversation):
        planned = {"title": "Ciclo dell'acqua", "objective": "Capire evaporazione e condensazione", "tasks": [
            {"id": "lesson", "kind": "document", "title": "Lezione", "instructions": "Spiega il ciclo"},
            {"id": "quiz", "kind": "quiz", "title": "Verifica", "instructions": "Crea una domanda", "depends_on": ["lesson"]},
        ]}
        doc = {"title": "Lezione", "text": "L'acqua evapora. Poi condensa."}
        quiz = {"title": "Verifica", "description": "Verifica il ciclo dell'acqua", "questions": [
            {"question": "Spiega cosa succede all'acqua", "type": "open", "sampleAnswer": "Evapora e condensa"}]}
        generation = AsyncMock(side_effect=[json.dumps(planned), json.dumps(doc), json.dumps(quiz)])
        monkeypatch.setattr(api, "text_generation", generation)
        monkeypatch.setattr(api.credit_service, "check_availability", AsyncMock(return_value=True))
        work_holder = {}
        job_id = uuid4()

        async def start_job(*args, **kwargs):
            work_holder["work"] = kwargs["work"]
            return job_id

        @asynccontextmanager
        async def worker_session():
            yield db

        monkeypatch.setattr(api.background_jobs, "start_task_job", start_job)
        monkeypatch.setattr(api.background_jobs, "is_live", lambda _: True)
        monkeypatch.setattr(api, "AsyncSessionLocal", worker_session)
        response = await api.propose(db, teacher, conversation.id, "Vai in modalità agentica", [])
        assert "Protocollo: spiegare" in generation.call_args.args[3]
        message_id = UUID(response["assistant_message"]["id"])
        state = response["assistant_message"]["protocol"]
        assert state["phase"] == "plan" and len(state["plan"]["tasks"]) == 2
        assert "protocol_sources" not in response["assistant_message"]
        await api.run(message_id, api.RunRequest(revision=1, plan=ProtocolPlan.model_validate(planned)), db, teacher)
        with pytest.raises(HTTPException) as repeated:
            await api.run(message_id, api.RunRequest(revision=1), db, teacher)
        assert repeated.value.status_code == 409
        await work_holder["work"](SimpleNamespace())
        state = (await api.get_state(message_id, db, teacher))["protocol"]
        assert state["phase"] == "review" and all(r["status"] == "ready" for r in state["results"].values())
        assert "Lezione" in generation.call_args.args[3]  # Dependency data reaches the quiz agent.
        revision = state["revision"]
        saved = await api.review(message_id, "lesson", api.ReviewRequest(revision=revision, data=doc, save=True), db, teacher)
        resource = saved["protocol"]["results"]["lesson"]["resource"]
        draft = await db.get(DocumentDraft, UUID(resource["id"]))
        assert draft.owner_teacher_id == teacher.id and draft.session_id is None
        drive_item = await db.scalar(select(DriveItem).where(DriveItem.source_id == draft.id))
        assert drive_item.public_token is None
        repeated = await api.review(message_id, "lesson", api.ReviewRequest(revision=revision, data=doc, save=True), db, teacher)
        assert repeated["protocol"]["results"]["lesson"]["resource"] == resource
        assert await db.scalar(select(func.count()).select_from(DocumentDraft).where(DocumentDraft.owner_teacher_id == teacher.id)) == 1
        other = SimpleNamespace(id=uuid4(), tenant_id=teacher.tenant_id)
        with pytest.raises(HTTPException) as forbidden:
            await api.get_state(message_id, db, other)
        assert forbidden.value.status_code == 404
        wrong_tenant = SimpleNamespace(id=teacher.id, tenant_id=uuid4())
        with pytest.raises(HTTPException):
            await api.review(message_id, "lesson", api.ReviewRequest(revision=revision + 1, data=doc, save=True), db, wrong_tenant)


async def test_edited_parent_invalidates_unsaved_descendants_and_rejects_stale_revision():
    async with isolated() as (db, teacher, conversation):
        plan = {"title": "Attività", "tasks": [
            {"id": "a", "kind": "document", "title": "A", "instructions": "Spiega"},
            {"id": "b", "kind": "document", "title": "B", "instructions": "Riassumi", "depends_on": ["a"]}]}
        state = {"phase": "review", "revision": 2, "plan": plan, "results": {
            "a": {"status": "ready", "data": {"title": "A", "text": "Vecchio"}},
            "b": {"status": "ready", "data": {"title": "B", "text": "Da invalidare"}}}}
        message = TeacherConversationMessage(id=uuid4(), tenant_id=teacher.tenant_id, conversation_id=conversation.id,
            role="assistant", content="Piano", attachments_json={"protocol": copy.deepcopy(state)})
        db.add(message); await db.commit()
        updated = await api.review(message.id, "a", api.ReviewRequest(revision=2, data={"title": "A", "text": "Nuovo"}), db, teacher)
        assert updated["protocol"]["results"]["b"]["status"] == "blocked"
        with pytest.raises(HTTPException) as stale:
            await api.review(message.id, "a", api.ReviewRequest(revision=2, data={"title": "A", "text": "Obsoleto"}), db, teacher)
        assert stale.value.status_code == 409


async def test_billing_refreshes_balances_changed_by_another_agent(monkeypatch):
    monkeypatch.setattr(api.credit_service, "calculate_cost_for_model", lambda *args, **kwargs: 0.02)
    async with isolated() as (db, teacher, _):
        limits = await api.credit_service.get_applicable_limits(db, teacher.tenant_id, teacher.id)
        await db.commit()
        applicable = [limit for limit in limits if limit.level.value == "TEACHER"]
        assert applicable
        balance = applicable[0]
        await db.execute(update(CreditLimit).where(CreditLimit.id == balance.id).values(current_usage=0.5)
                         .execution_options(synchronize_session=False))
        assert balance.current_usage == 0
        await api.record_usage(db, teacher, "openai", "gpt-4o-mini", 100, 20)
        assert balance.current_usage == pytest.approx(0.52)
        assert await db.scalar(select(func.count()).select_from(CreditTransaction).where(CreditTransaction.teacher_id == teacher.id)) == 1


async def test_recovery_after_restart_preserves_completed_materials():
    async with isolated() as (db, teacher, conversation):
        state = {"phase": "running", "revision": 2, "job_id": str(uuid4()), "plan": {"title": "Attività", "tasks": []},
                 "results": {"done": {"status": "ready", "data": {"title": "Pronto", "text": "Testo"}},
                             "interrupted": {"status": "running"}, "waiting": {"status": "pending"}}}
        message = TeacherConversationMessage(id=uuid4(), tenant_id=teacher.tenant_id, conversation_id=conversation.id,
            role="assistant", content="Piano", attachments_json={"protocol": state})
        db.add(message); await db.commit()
        recovered = (await api.get_state(message.id, db, teacher))["protocol"]
        assert recovered["phase"] == "review"
        assert recovered["results"]["done"] == state["results"]["done"]
        assert recovered["results"]["interrupted"]["status"] == "error"
        assert recovered["results"]["waiting"]["status"] == "error"


async def test_image_generation_preview_and_approval_use_private_blobs(monkeypatch, tmp_path):
    from app.services.meshy_service import meshy_service
    async with isolated() as (db, teacher, conversation):
        planned = {"title": "Illustrazione", "tasks": [{"id": "image", "kind": "image", "title": "Acqua", "instructions": "Illustra il ciclo"}]}
        monkeypatch.setattr(api, "text_generation", AsyncMock(side_effect=[json.dumps(planned), "Un ciclo dell'acqua illustrato"]))
        monkeypatch.setattr(api, "record_usage", AsyncMock())
        monkeypatch.setattr(api.credit_service, "check_availability", AsyncMock(return_value=True))
        png = b"\x89PNG\r\n\x1a\nprivate-test-image"
        monkeypatch.setattr(meshy_service, "generate_image", AsyncMock(return_value={"image_data": base64.b64encode(png).decode(), "image_mime": "image/png"}))
        real_path = api.drive_service.blob_path
        def temporary_path(key):
            # Enforce the actual Drive prefix/path validation before mapping to a temporary directory.
            assert real_path(key) is not None
            return tmp_path / key
        monkeypatch.setattr(api.drive_service, "blob_path", temporary_path)
        monkeypatch.setattr(api.drive_service, "drive_usage_bytes", AsyncMock(return_value=0))
        holder = {}
        async def start_job(*args, **kwargs):
            holder["work"] = kwargs["work"]
            return uuid4()
        @asynccontextmanager
        async def session():
            yield db
        monkeypatch.setattr(api.background_jobs, "start_task_job", start_job)
        monkeypatch.setattr(api.background_jobs, "is_live", lambda _: True)
        monkeypatch.setattr(api, "AsyncSessionLocal", session)
        proposal = await api.propose(db, teacher, conversation.id, "Crea l'illustrazione del protocollo", [])
        message_id = UUID(proposal["assistant_message"]["id"])
        await api.run(message_id, api.RunRequest(revision=1), db, teacher)
        await holder["work"](SimpleNamespace())
        message = await api.get_state(message_id, db, teacher)
        result = message["protocol"]["results"]["image"]
        assert result["status"] == "ready" and "image_storage_key" not in result["data"]
        assert "image_url" in result["data"]
        preview = await api.preview_image(message_id, "image", db, teacher)
        assert preview.body == png
        with pytest.raises(HTTPException) as denied:
            await api.preview_image(message_id, "image", db, SimpleNamespace(id=uuid4(), tenant_id=teacher.tenant_id))
        assert denied.value.status_code == 404
        approved = await api.review(message_id, "image", api.ReviewRequest(revision=2, data={"title": "Ciclo dell'acqua"}, save=True), db, teacher)
        item = await db.get(DriveItem, UUID(approved["protocol"]["results"]["image"]["resource"]["id"]))
        assert api.drive_service.read_blob((await db.get(File, item.file_id)).storage_key) == png


@pytest.mark.parametrize("kind,data", [
    ("teacherbot", {"name": "Tutor", "system_prompt": "Guida senza dare le risposte", "knowledge": "L'acqua evapora"}),
    ("sheet", {"title": "Rilevazioni", "rows": [["Ora", "Temperatura"], [1, 20]]}),
    ("presentation", {"title": "Ciclo", "slides": [{"title": "Acqua", "body": "Evaporazione", "notes": "Chiedere esempi"}]}),
    ("dispensa", {"title": "Dispensa", "text": "Spiegazioni ed esempi"}),
    ("html_page", {"title": "Pagina", "html": "<!doctype html><html><body>Interattiva</body></html>"}),
    ("quiz", {"title": "Verifica", "questions": []}),
])
async def test_all_artifact_adapters_remain_private(monkeypatch, kind, data):
    monkeypatch.setattr(api.drive_service, "write_blob", lambda *args: None)
    monkeypatch.setattr(api.drive_service, "drive_usage_bytes", AsyncMock(return_value=0))
    async with isolated() as (db, teacher, _):
        resource = await api.save_artifact(db, teacher, kind, data)
        await db.commit()
        if kind == "teacherbot":
            bot = await db.get(Teacherbot, UUID(resource["id"]))
            assert bot.status == TeacherbotStatus.DRAFT and bot.teacher_id == teacher.id
            assert "L'acqua evapora" in bot.system_prompt
        elif kind in ("html_page", "quiz"):
            item = await db.get(DriveItem, UUID(resource["id"]))
            file = await db.get(File, item.file_id)
            assert file.scope == Scope.USER and file.owner_teacher_id == teacher.id
            assert item.public_token is None
        else:
            draft = await db.get(DocumentDraft, UUID(resource["id"]))
            assert draft.owner_teacher_id == teacher.id and draft.session_id is None
