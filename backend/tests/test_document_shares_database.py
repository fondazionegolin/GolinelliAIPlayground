"""Development-only integration tests; all documents, links and users are rolled back."""
import json
import os
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.deps import StudentOrTeacher
from app.api.v1.endpoints import document_shares as routes
from app.core.config import settings
from app.models.document_draft import DocumentDraft, DocumentDraftVersion
from app.models.document_share import DocumentShareLink
from app.models.enums import UserRole, SessionStatus, Scope, OwnerType
from app.models.file import File
from app.models.session import Class, Session, SessionStudent
from app.models.task import Task, TaskType
from app.models.tenant import Tenant
from app.models.user import User

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(os.getenv('DOCUMENT_SHARES_DB_TESTS') != '1', reason='Development PostgreSQL only')]
engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)


@asynccontextmanager
async def isolated():
    async with engine.connect() as connection:
        outer = await connection.begin()
        db = AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode='create_savepoint')
        try:
            tenant = Tenant(id=uuid4(), name='Share test', slug=f'share-{uuid4()}')
            db.add(tenant); await db.flush()
            teacher = User(id=uuid4(), tenant_id=tenant.id, email=f'{uuid4()}@example.invalid', role=UserRole.TEACHER, is_active=True, is_verified=True)
            other = User(id=uuid4(), tenant_id=tenant.id, email=f'{uuid4()}@example.invalid', role=UserRole.TEACHER, is_active=True, is_verified=True)
            db.add_all([teacher, other]); await db.flush()
            cls = Class(id=uuid4(), tenant_id=tenant.id, teacher_id=teacher.id, name='Share class')
            db.add(cls); await db.flush()
            session = Session(id=uuid4(), tenant_id=tenant.id, class_id=cls.id, title='Share session', join_code=str(uuid4())[:5], status=SessionStatus.ACTIVE)
            db.add(session); await db.flush()
            student = SessionStudent(id=uuid4(), tenant_id=tenant.id, session_id=session.id, nickname='Share student', join_token=str(uuid4()))
            db.add(student); await db.flush()
            draft = DocumentDraft(id=uuid4(), tenant_id=tenant.id, owner_teacher_id=teacher.id, title='Shared document', doc_type='document', content_json=json.dumps({'type': 'document_v1', 'htmlContent': '<p>Originale</p>'}))
            db.add(draft); await db.flush()
            yield db, teacher, other, student, draft
        finally:
            await db.close(); await outer.rollback()


async def new_link(db, auth, source, permission='view', kind='draft'):
    return await routes.create_link(routes.CreateLink(source_kind=kind, source_id=source.id, permission=permission), db, auth)


async def test_owner_links_are_distinct_reused_revocable_and_private():
    async with isolated() as (db, teacher, other, student, draft):
        auth = StudentOrTeacher(teacher=teacher)
        draft.content_json = json.dumps({'htmlContent': '<p>Originale</p>', 'source': {'fileId': 'owner-private-source'}})
        view = await new_link(db, auth, draft)
        edit = await new_link(db, auth, draft, 'edit')
        assert len(view['token']) == 43 and view['token'] != edit['token']
        assert (await new_link(db, auth, draft))['token'] == view['token']
        assert len(await routes.list_links('draft', draft.id, db, auth)) == 2
        for intruder in [StudentOrTeacher(teacher=other), StudentOrTeacher(student=student)]:
            with pytest.raises(HTTPException) as error:
                await routes.list_links('draft', draft.id, db, intruder)
            assert error.value.status_code == 404
            with pytest.raises(HTTPException):
                await routes.revoke_link(UUID(view['id']), db, intruder)
        response = Response()
        public = await routes.read_public(view['token'], response, db)
        assert public['title'] == draft.title and response.headers['cache-control'] == 'no-store'
        await routes.revoke_link(UUID(view['id']), db, auth)
        with pytest.raises(HTTPException) as error:
            await routes.read_public(view['token'], Response(), db)
        assert error.value.status_code == 410
        assert (await routes.read_public(edit['token'], Response(), db))['permission'] == 'edit'


async def test_anonymous_saves_enforce_permission_revision_and_preserve_history():
    async with isolated() as (db, teacher, other, student, draft):
        auth = StudentOrTeacher(teacher=teacher)
        draft.content_json = json.dumps({'htmlContent': '<p>Originale</p>', 'source': {'fileId': 'owner-private-source'}})
        view = await new_link(db, auth, draft)
        edit = await new_link(db, auth, draft, 'edit')
        public = await routes.read_public(edit['token'], Response(), db)
        body = routes.PublicSave(title='Aggiornato', content_json=json.dumps({'htmlContent': '<p><em>Modifica anonima</em></p><script>x()</script>'}), revision=public['revision'])
        with pytest.raises(HTTPException) as error:
            await routes.save_public(view['token'], body, Response(), db)
        assert error.value.status_code == 403
        saved = await routes.save_public(edit['token'], body, Response(), db)
        assert saved['revision'] != public['revision']
        assert draft.title == 'Aggiornato' and 'Modifica anonima' in draft.content_json and '<script>' not in draft.content_json
        assert json.loads(draft.content_json)['source']['fileId'] == 'owner-private-source'
        versions = (await db.execute(select(DocumentDraftVersion).where(DocumentDraftVersion.draft_id == draft.id))).scalars().all()
        assert len(versions) == 1 and 'Originale' in versions[0].content_json
        with pytest.raises(HTTPException) as error:
            await routes.save_public(edit['token'], body, Response(), db)
        assert error.value.status_code == 409


async def test_student_owns_only_own_drafts_and_teacher_can_share_published_documents():
    async with isolated() as (db, teacher, other, student, draft):
        draft.owner_teacher_id = None; draft.owner_student_id = student.id
        await db.flush()
        assert (await new_link(db, StudentOrTeacher(student=student), draft, 'edit'))['permission'] == 'edit'
        with pytest.raises(HTTPException):
            await new_link(db, StudentOrTeacher(teacher=teacher), draft)
        task = Task(id=uuid4(), tenant_id=teacher.tenant_id, session_id=student.session_id, task_type=TaskType.PRESENTATION, title='Slide', content_json=json.dumps({'type': 'presentation_v2', 'slides': [{'id': 'one', 'title': 'T', 'blocks': []}]}))
        db.add(task); await db.flush()
        link = await new_link(db, StudentOrTeacher(teacher=teacher), task, 'edit', 'task')
        assert (await routes.read_public(link['token'], Response(), db))['doc_type'] == 'presentation'
        for intruder in [StudentOrTeacher(teacher=other), StudentOrTeacher(student=student)]:
            with pytest.raises(HTTPException):
                await new_link(db, intruder, task, 'edit', 'task')


async def test_image_grants_cannot_be_expanded_by_anonymous_edits(monkeypatch):
    async with isolated() as (db, teacher, other, student, draft):
        files = [File(id=uuid4(), tenant_id=teacher.tenant_id, owner_type=OwnerType.TEACHER, owner_teacher_id=owner.id, scope=Scope.USER,
                      storage_key=f'test/{uuid4()}', filename='image.png', mime_type='image/png', size_bytes=3, checksum_sha256='test') for owner in [teacher, other]]
        db.add_all(files); await db.flush()
        draft.content_json = json.dumps({'htmlContent': ''.join(f'<img src="/api/v1/files/{file.id}/content">' for file in files)})
        link = await new_link(db, StudentOrTeacher(teacher=teacher), draft, 'edit')
        record = await db.get(DocumentShareLink, UUID(link['id']))
        assert record.asset_ids == [str(files[0].id)]
        monkeypatch.setattr(routes.storage_service, 'download_file', lambda key: b'png')
        assert (await routes.public_asset(link['token'], files[0].id, db)).media_type == 'image/png'
        with pytest.raises(HTTPException) as error:
            await routes.public_asset(link['token'], files[1].id, db)
        assert error.value.status_code == 404
        public = await routes.read_public(link['token'], Response(), db)
        await routes.save_public(link['token'], routes.PublicSave(title='T', content_json=public['content_json'], revision=public['revision']), Response(), db)
        assert f'/api/v1/files/{files[0].id}/content' in draft.content_json
        assert '/assets/' not in draft.content_json
