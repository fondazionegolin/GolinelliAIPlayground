from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from starlette.requests import Request

from app.api.v1.endpoints import auth
from app.core.legal_documents import required_legal_documents
from app.models.enums import UserRole


def acceptance(document, version=None):
    return SimpleNamespace(
        document_key=document['key'],
        document_title=document['title'],
        document_version=version or document['version'],
        accepted_at=datetime.now(timezone.utc),
    )


def test_invited_teacher_requires_privacy_before_access():
    docs = required_legal_documents(in_school_tenant=True)
    status = auth._legal_status_for(SimpleNamespace(role=UserRole.TEACHER), [], docs)
    assert status.required and not status.complete
    privacy = next(doc for doc in status.required_documents if doc.key == 'privacy_dpa')
    assert privacy.version == '2.0'
    assert privacy.source_url == '/docs/informativa-privacy-v2.0.pdf'
    assert docs[-1]['key'] == 'teacher_use_declaration'


def test_previous_privacy_acceptance_does_not_complete_current_onboarding():
    docs = required_legal_documents(in_school_tenant=True)
    teacher = SimpleNamespace(role=UserRole.TEACHER)
    rows = [acceptance(doc, '2026-02' if doc['key'] == 'privacy_dpa' else None) for doc in docs]
    status = auth._legal_status_for(teacher, rows, docs)
    assert not status.complete
    assert 'privacy_dpa' not in {row.document_key for row in status.accepted}
    rows.append(acceptance(next(doc for doc in docs if doc['key'] == 'privacy_dpa')))
    assert auth._legal_status_for(teacher, rows, docs).complete


@pytest.mark.asyncio
async def test_accept_privacy_records_version_two_and_finishes_steps(monkeypatch):
    docs = required_legal_documents()
    teacher = SimpleNamespace(id='teacher-test', tenant_id=None, role=UserRole.TEACHER)
    rows = [acceptance(doc) for doc in docs if doc['key'] != 'privacy_dpa']
    saved = []

    async def commit():
        rows.append(acceptance(next(doc for doc in docs if doc['key'] == 'privacy_dpa')))

    db = SimpleNamespace(add=saved.append, commit=commit)
    monkeypatch.setattr(auth, '_docs_for_user', AsyncMock(return_value=docs))
    monkeypatch.setattr(auth, '_current_legal_acceptances', AsyncMock(side_effect=lambda *args: list(rows)))
    request = Request({'type': 'http', 'headers': [], 'client': ('127.0.0.1', 1234)})
    status = await auth.accept_legal_consent(
        auth.LegalConsentAcceptRequest(document_key='privacy_dpa'), request, db, teacher,
    )
    assert len(saved) == 1
    assert saved[0].document_key == 'privacy_dpa'
    assert saved[0].document_version == '2.0'
    assert status.complete
