"""Development PostgreSQL integration checks. Fixtures are rolled back."""
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.deps import StudentOrTeacher
from app.api.v1.endpoints import drive as routes
from app.core.config import settings
from app.models.drive import DriveItem, DriveShare
from app.models.enums import UserRole, SessionStatus
from app.models.session import Class, Session, SessionStudent
from app.models.tenant import Tenant
from app.models.user import User
from app.services import drive_service as drive

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(os.getenv('DRIVE_DB_TESTS') != '1', reason='Development PostgreSQL only')]
engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)


@asynccontextmanager
async def isolated():
    async with engine.connect() as connection:
        transaction = await connection.begin()
        db = AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode='create_savepoint')
        try:
            tenant = Tenant(id=uuid4(), name='Drive test', slug=f'drive-{uuid4()}')
            db.add(tenant); await db.flush()
            teacher = User(id=uuid4(), tenant_id=tenant.id, email=f'{uuid4()}@example.invalid', role=UserRole.TEACHER, is_active=True)
            other = User(id=uuid4(), tenant_id=tenant.id, email=f'{uuid4()}@example.invalid', role=UserRole.TEACHER, is_active=True)
            db.add_all([teacher, other]); await db.flush()
            cls = Class(id=uuid4(), tenant_id=tenant.id, teacher_id=teacher.id, name='Class test')
            db.add(cls); await db.flush()
            session = Session(id=uuid4(), tenant_id=tenant.id, class_id=cls.id, title='Session test', join_code=uuid4().hex[:5], status=SessionStatus.ACTIVE)
            db.add(session); await db.flush()
            students = [SessionStudent(id=uuid4(), tenant_id=tenant.id, session_id=session.id, nickname=f'Student {i}', join_token=str(uuid4())) for i in range(3)]
            db.add_all(students); await db.flush()
            yield db, teacher, other, students
        finally:
            await db.close(); await transaction.rollback()


def node(teacher, parent=None, student=None, name='Folder', kind='folder'):
    return DriveItem(id=uuid4(), tenant_id=teacher.tenant_id, owner_teacher_id=teacher.id,
                     owner_student_id=student.id if student else None, parent_id=parent.id if parent else None, kind=kind, name=name)


async def test_folder_access_is_inherited_new_children_revocation_and_individual_isolation():
    async with isolated() as (db, teacher, other, students):
        folder = node(teacher)
        db.add(folder); await db.flush()
        child = node(teacher, parent=folder, name='child.txt', kind='file')
        db.add(child); await db.flush()
        owner = StudentOrTeacher(teacher=teacher)
        await routes.put_shares(folder.id, routes.SharesUpdate(shares=[routes.ShareEntry(target_type='student', target_id=students[0].id)]), db, owner)
        recipient = await drive.principal_for(db, None, students[0])
        outsider = await drive.principal_for(db, None, students[1])
        assert (await drive.resolve_role(db, recipient, child))[0] == 'viewer'
        assert (await drive.resolve_role(db, outsider, child))[0] is None
        later = node(teacher, parent=folder, name='New child')
        db.add(later); await db.flush()
        assert (await drive.resolve_role(db, recipient, later))[0] == 'viewer'
        with pytest.raises(HTTPException):
            await routes._require(db, recipient, child, 'editor')
        await routes.put_shares(folder.id, routes.SharesUpdate(shares=[]), db, owner)
        assert (await drive.resolve_role(db, recipient, child))[0] is None


async def test_student_can_share_own_folder_with_peer_and_teacher_but_peer_cannot_reshare():
    async with isolated() as (db, teacher, other, students):
        folder = node(teacher, student=students[0])
        db.add(folder); await db.flush()
        auth = StudentOrTeacher(student=students[0])
        await routes.put_shares(folder.id, routes.SharesUpdate(shares=[
            routes.ShareEntry(target_type='student', target_id=students[1].id, role='editor'),
            routes.ShareEntry(target_type='teacher', target_id=teacher.id),
        ]), db, auth)
        assert len((await routes.get_shares(folder.id, db, auth))['shares']) == 2
        peer = await drive.principal_for(db, None, students[1])
        assert (await drive.resolve_role(db, peer, folder))[0] == 'editor'
        assert (await drive.resolve_role(db, drive.DrivePrincipal(teacher=teacher), folder))[0] == 'viewer'
        with pytest.raises(HTTPException):
            await routes.put_shares(folder.id, routes.SharesUpdate(shares=[]), db, StudentOrTeacher(student=students[1]))
        with pytest.raises(HTTPException):
            await routes._check_targets(db, await drive.principal_for(db, None, students[0]), [routes.ShareEntry(target_type='teacher', target_id=other.id)])
        with pytest.raises(HTTPException):
            await routes._check_targets(db, await drive.principal_for(db, None, students[0]), [routes.ShareEntry(target_type='student', target_id=uuid4())])


async def test_student_session_share_lists_folder_and_contents_for_students_and_teacher(tmp_path, monkeypatch):
    async with isolated() as (db, teacher, other, students):
        monkeypatch.setattr(drive, 'UPLOADS_ROOT', tmp_path)
        owner, peer, newcomer = [StudentOrTeacher(student=student) for student in students]
        teacher_auth = StudentOrTeacher(teacher=teacher)
        private = await routes.upload(db, owner, [
            UploadFile(BytesIO(b'private'), filename='appunti.txt', headers=Headers({'content-type': 'text/plain'})),
        ], None, None)
        folder = await routes.create_folder(routes.FolderCreate(name='Esperimento'), db, owner)
        folder_id = UUID(folder['id'])
        personal = await routes.list_items(db, owner, view='all')
        assert {row['id'] for row in personal['items']} == {folder['id'], private['items'][0]['id']}
        targets = await routes.share_targets(db, owner)
        assert [session['id'] for session in targets['sessions']] == [str(owner.student.session_id)]
        await routes.put_shares(folder_id, routes.SharesUpdate(shares=[
            routes.ShareEntry(target_type='session', target_id=owner.student.session_id),
            routes.ShareEntry(target_type='teacher', target_id=teacher.id),
        ]), db, owner)
        uploaded = await routes.upload(db, owner, [
            UploadFile(BytesIO(b'risultati'), filename='misure.txt', headers=Headers({'content-type': 'text/plain'})),
        ], folder_id, '["Risultati/misure.txt"]')
        file_id = UUID(uploaded['items'][0]['id'])
        subfolder_id = UUID(uploaded['items'][0]['parent_id'])
        # A direct grant on a nested file must preserve the folder as the shared entry point.
        await routes.put_shares(file_id, routes.SharesUpdate(shares=[
            routes.ShareEntry(target_type='student', target_id=peer.student.id, role='editor'),
        ]), db, owner)

        for recipient in (peer, newcomer, teacher_auth):
            shared = await routes.list_items(db, recipient, view='shared')
            assert [(item['id'], item['role']) for item in shared['items']] == [(folder['id'], 'viewer')]
            combined = await routes.list_items(db, recipient, view='all')
            assert folder['id'] in {item['id'] for item in combined['items']}
            assert private['items'][0]['id'] not in {item['id'] for item in combined['items']}
            nested = await routes.list_items(db, recipient, view='folder', parent_id=folder_id)
            assert [(item['id'], item['name']) for item in nested['items']] == [(str(subfolder_id), 'Risultati')]
            contents = await routes.list_items(db, recipient, view='folder', parent_id=subfolder_id)
            assert contents['breadcrumb'][0]['id'] == folder['id']
            assert contents['items'][0]['role'] == ('editor' if recipient is peer else 'viewer')
            exported = await routes.item_export(file_id, db, recipient, None)
            assert exported.body == b'risultati'

        assert (await routes.list_items(db, StudentOrTeacher(teacher=other), view='shared'))['items'] == []
        with pytest.raises(HTTPException):
            await routes.item_export(file_id, db, StudentOrTeacher(teacher=other), None)
        with pytest.raises(HTTPException):
            await routes.put_shares(folder_id, routes.SharesUpdate(shares=[
                routes.ShareEntry(target_type='session', target_id=uuid4()),
            ]), db, owner)


async def test_bulk_share_preserves_existing_access_and_repeated_targets_are_unique():
    async with isolated() as (db, teacher, other, students):
        folders = [node(teacher, name=f'F{i}') for i in range(2)]
        db.add_all(folders); await db.flush()
        auth = StudentOrTeacher(teacher=teacher)
        await routes.put_shares(folders[0].id, routes.SharesUpdate(shares=[routes.ShareEntry(target_type='teacher', target_id=other.id)]), db, auth)
        share = routes.ShareEntry(target_type='student', target_id=students[0].id, role='editor')
        body = routes.BulkSharesUpdate(ids=[f.id for f in folders], shares=[share, share])
        await routes.add_bulk_shares(body, db, auth)
        await routes.add_bulk_shares(body, db, auth)
        assert len((await routes.get_shares(folders[0].id, db, auth))['shares']) == 2
        assert len((await routes.get_shares(folders[1].id, db, auth))['shares']) == 1
        folders[0].trashed_at = datetime.now(timezone.utc)
        with pytest.raises(HTTPException):
            await routes.add_bulk_shares(body, db, auth)


async def test_auto_rename_preserves_extensions_and_resolves_sibling_collisions(monkeypatch):
    async with isolated() as (db, teacher, other, students):
        parent = node(teacher)
        db.add(parent); await db.flush()
        items = [node(teacher, parent=parent, kind='file', name=f'IMG00{i}.txt') for i in range(2)]
        db.add_all(items); await db.flush()
        async def content(*args): return b'La fotosintesi delle piante', 'text/plain'
        async def suggest(*args, **kwargs): return 'La fotosintesi.txt'
        monkeypatch.setattr(routes, '_file_bytes', content)
        monkeypatch.setattr('app.services.drive_naming.suggest_name', suggest)
        result = await routes.auto_rename(routes.ItemIds(ids=[i.id for i in items]), db, StudentOrTeacher(teacher=teacher))
        assert [r['name'] for r in result['results']] == ['La fotosintesi.txt', 'La fotosintesi (2).txt']
        with pytest.raises(HTTPException):
            await routes.auto_rename(routes.ItemIds(ids=[items[0].id]), db, StudentOrTeacher(student=students[0]))
