"""Opt-in regression of the whole generation pipeline, rolled back; no real model calls."""
import json
import os
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from app.api.deps import StudentOrTeacher
from app.api.v1.endpoints import coding
from app.core.config import settings
from app.models.coding import CodingProject, CodingVersion
from app.models.enums import UserRole, SessionStatus
from app.models.session import Class, Session
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.coding import CodingGenerateRequest, CodingVersionCreate
from app.services import background_jobs, vibe_pipeline, vibe_quality, vibe_runs

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(os.getenv('VIBE_DB_TESTS') != '1', reason='Opt-in development database')]
engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)


@pytest.fixture(autouse=True)
def isolated_guard_pool(monkeypatch):
    monkeypatch.setattr(vibe_runs, 'AsyncSessionLocal', async_sessionmaker(engine, expire_on_commit=False))


@asynccontextmanager
async def isolated():
    async with engine.connect() as conn:
        transaction = await conn.begin()
        db = AsyncSession(bind=conn, expire_on_commit=False, join_transaction_mode='create_savepoint')
        try:
            tenant=Tenant(id=uuid4(),name='Vibe regression',slug=f'vibe-{uuid4()}');db.add(tenant);await db.flush()
            teacher=User(id=uuid4(),tenant_id=tenant.id,email=f'{uuid4()}@example.invalid',role=UserRole.TEACHER,is_active=True,is_verified=True);db.add(teacher);await db.flush()
            cls=Class(id=uuid4(),tenant_id=tenant.id,teacher_id=teacher.id,name='Vibe regression');db.add(cls);await db.flush()
            session=Session(id=uuid4(),tenant_id=tenant.id,class_id=cls.id,title='Vibe regression',join_code=str(uuid4())[:5],status=SessionStatus.ACTIVE);db.add(session);await db.flush()
            project=CodingProject(id=uuid4(),tenant_id=tenant.id,session_id=session.id,owner_user_id=teacher.id,title='Regression',slug=f'vibe-{uuid4()}');db.add(project);await db.flush()
            yield db, StudentOrTeacher(teacher=teacher), project
        finally:
            await db.close();await transaction.rollback()


def install_models(monkeypatch, mode):
    files=[{'path':'App.tsx','content':'export default function App(){return <div>Funziona</div>}'}, {'path':'styles.css','content':'body{margin:0}'}]
    if mode == 'missing_root': files=[{'path':'types.ts','content':'export const x=1'}]
    if mode=='bad_export':
        files[0]['content']="import { DEMO_USERS } from './types';export default function App(){return <div>{DEMO_USERS.length}</div>}"
        files.append({'path':'types.ts','content':'export const OTHER=[]'})
    canonical='\n'.join('=== FILE: '+f['path']+' ===\n'+f['content']+'\n=== END ===' for f in files)
    if mode == 'no_end': canonical=canonical.removesuffix('\n=== END ===')
    repairs=[]
    async def stream(**kwargs):
        if 'Risposta precedente non utilizzabile' in kwargs['messages'][0]['content']:
            repairs.append(kwargs)
            yield json.dumps({'files':files}) if mode=='repair' else 'not usable'
            return
        yield json.dumps({'files':files}) if mode=='json' else 'Ho finito' if mode in {'repair','unusable'} else canonical
    monkeypatch.setattr(vibe_pipeline.llm_service,'generate_stream',stream)
    monkeypatch.setattr(coding,'_resolve_vibelab_model',AsyncMock(return_value=('test','model')))
    monkeypatch.setattr(coding,'_vibe_team',AsyncMock(return_value=(('test','model'),('test','model'))))
    monkeypatch.setattr(coding.vibe_qa,'available',lambda:False)
    monkeypatch.setattr(coding.model_selection,'default_pair',lambda _:('test','model'))
    monkeypatch.setattr(coding.model_selection,'scoped_models',AsyncMock(return_value=[]))
    monkeypatch.setattr(coding,'_record_coding_cost',AsyncMock())
    events=[];state=background_jobs.ProgressState()
    async def inline(owner,**kwargs):
        async for chunk in kwargs['stream']:
            parsed,_=background_jobs._parse_events(chunk,'sse')
            for event in parsed:
                events.append(event);kwargs['progress_fn'](event,state)
        return uuid4()
    monkeypatch.setattr(background_jobs,'start_stream_job',inline)
    monkeypatch.setattr(background_jobs,'stream_response',lambda *args:None)
    return events,state,repairs


@pytest.mark.parametrize('mode',['canonical','no_end','json','repair','unusable','bad_export','missing_root'])
async def test_generation_recovery_and_truthful_result(monkeypatch,mode):
    events,state,repairs=install_models(monkeypatch,mode)
    async with isolated() as (db,actor,project):
        await coding.generate_project_code_stream(project.id,CodingGenerateRequest(prompt='Crea un saluto'),db,actor)
        if mode=='unusable':
            assert any(e.get('code')=='unusable_output' for e in events)
            assert project.current_version_id is None
            assert state.result['diagnostics']['recovery']
            assert len(repairs)==1
            return
        done=next(e for e in events if e['type']=='done')
        version=await db.get(CodingVersion,project.current_version_id)
        assert version.artifact_manifest_json['validation']==done['validation']
        assert done['validation']['runtime']=='not_checked'
        if mode in {'bad_export','missing_root'}:
            assert done['needs_review'] and version.build_status=='needs_review'
            assert done['validation']['build']=='failed'
            assert 'controlli da completare' in state.label
        else:
            assert not done['needs_review'] and version.build_status=='build_passed'
            assert done['validation']['build']=='passed'
            assert len([c for c in state.result['diagnostics']['calls'] if c['kind']!='architect']) == (2 if mode=='repair' else 1)
        if mode in {'canonical','no_end','json'}:assert not repairs
        if mode=='repair':assert len(repairs)==1


async def test_manual_edit_invalidates_observation_and_stale_reports_are_rejected(monkeypatch):
    install_models(monkeypatch,'canonical')
    async with isolated() as (db,actor,project):
        await coding.generate_project_code_stream(project.id,CodingGenerateRequest(prompt='Crea un saluto'),db,actor)
        version=await db.get(CodingVersion,project.current_version_id)
        fingerprint=version.artifact_manifest_json['validation']['source_hash']
        reported=await coding.verify_project_preview(project.id,version.id,coding.PreviewVerification(source_hash=fingerprint,status='observed'),db,actor)
        assert reported.artifact_manifest_json['validation']['runtime']=='observed'
        files=[{'path':'App.tsx','content':'export default function App(){return <h1>Edited</h1>}'}]
        draft=await coding.save_project_draft(project.id,CodingVersionCreate(source_manifest_json={'files':files},build_status='ready',artifact_manifest_json={'validation':reported.artifact_manifest_json['validation']}),db,actor)
        assert draft.build_status=='generated'
        assert draft.artifact_manifest_json['validation']['runtime']=='not_checked'
        with pytest.raises(HTTPException) as exc:
            await coding.verify_project_preview(project.id,version.id,coding.PreviewVerification(source_hash=fingerprint,status='observed'),db,actor)
        assert exc.value.status_code==409


async def test_postgres_start_lock_is_exclusive_and_released():
    tenant,project=uuid4(),uuid4()
    async with vibe_runs.generation_start(tenant,project):
        with pytest.raises(HTTPException) as exc:
            async with vibe_runs.generation_start(tenant,project):pytest.fail('simultaneous generation accepted')
        assert exc.value.status_code==409
        async with vibe_runs.generation_start(tenant,uuid4()):pass
    async with vibe_runs.generation_start(tenant,project):pass


async def test_default_build_has_no_review_stages_and_refine_is_on_demand(monkeypatch):
    events, state, repairs = install_models(monkeypatch, 'canonical')
    quality_calls = []

    async def fake_loop(files, **kwargs):
        quality_calls.append(kwargs.get('focus'))
        yield ('result', {'files': files, 'scorecard': {'overall': 91, 'defects': {'blocker': 0, 'major': 0, 'minor': 1}, 'css_coverage': '3/3'}, 'rounds': [{'round': 1, 'overall': 91}], 'tests': 2, 'ran': True, 'defects': []})
    monkeypatch.setattr(coding, '_quality_loop', fake_loop)
    async with isolated() as (db, actor, project):
        await coding.generate_project_code_stream(project.id, CodingGenerateRequest(prompt='Crea un saluto'), db, actor)
        assert quality_calls == []  # the default build never runs the deep review
        assert not any(e['type'] in {'quality', 'conformance'} for e in events)
        first = project.current_version_id
        events.clear()
        await coding.generate_project_code_stream(project.id, CodingGenerateRequest(mode='refine', prompt='più bello su telefono'), db, actor)
        done = next(e for e in events if e['type'] == 'done')
        assert quality_calls == ['più bello su telefono'] and done['refine'] is True
        assert done['validation']['quality']['score']['overall'] == 91
        assert project.current_version_id != first
