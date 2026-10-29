from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import aiosmtplib

from app.core.legal_documents import DEPLOYER_AGREEMENT, TEACHER_USE_DECLARATION, required_legal_documents
from app.core.school_documents import deployer_agreement_html, family_notice_html, teacher_declaration_html
from app.services.email_service import describe_smtp_error
from app.services.school_overview import documents_state, invite_stage, teacher_state

NOW = datetime.now(timezone.utc)


def invite(**over):
    base = dict(status="PENDING", expires_at=NOW + timedelta(days=5), progress={}, opened_at=None,
                email_opened_at=None, email_status=None)
    return SimpleNamespace(**{**base, **over})


def test_the_funnel_reports_the_furthest_step_reached():
    assert invite_stage(invite()) == "CREATED"
    assert invite_stage(invite(email_status="FAILED")) == "EMAIL_FAILED"
    assert invite_stage(invite(email_status="SENT")) == "EMAIL_SENT"
    assert invite_stage(invite(email_status="SENT", email_opened_at=NOW)) == "EMAIL_READ"
    assert invite_stage(invite(email_status="SENT", opened_at=NOW)) == "LINK_OPENED"
    assert invite_stage(invite(opened_at=NOW, progress={"accepted": ["license_terms"]})) == "PARTIAL"
    assert invite_stage(invite(status="COMPLETED")) == "COMPLETED"
    assert invite_stage(invite(expires_at=NOW - timedelta(days=1), progress={"accepted": ["x"]})) == "EXPIRED"
    assert invite_stage(invite(status="REVOKED")) == "REVOKED"


def acceptance(key, version, days_ago=0):
    return SimpleNamespace(document_key=key, document_version=version, accepted_at=NOW - timedelta(days=days_ago))


def test_acceptances_are_judged_by_the_current_version_with_their_dates():
    required = required_legal_documents(is_school_owner=True, in_school_tenant=True)
    rows = [acceptance(d["key"], d["version"]) for d in required if d["key"] != DEPLOYER_AGREEMENT["key"]]
    rows.append(acceptance(DEPLOYER_AGREEMENT["key"], "2026-10", days_ago=10))  # accepted before the privacy v2.0 update
    docs, complete = documents_state(rows, required)
    assert not complete
    contract = next(d for d in docs if d["key"] == DEPLOYER_AGREEMENT["key"])
    assert contract["accepted_version"] == "2026-10" and not contract["current"] and contract["accepted_at"]
    rows.append(acceptance(DEPLOYER_AGREEMENT["key"], DEPLOYER_AGREEMENT["version"]))
    assert documents_state(rows, required)[1]


def test_teacher_states():
    user = SimpleNamespace(is_active=True, last_login_at=None)
    pending = SimpleNamespace(is_used=False, expires_at=NOW + timedelta(hours=5))
    assert teacher_state(user, pending, False) == "INVITED"
    assert teacher_state(user, SimpleNamespace(is_used=False, expires_at=NOW - timedelta(hours=1)), False) == "EXPIRED"
    assert teacher_state(SimpleNamespace(is_active=True, last_login_at=NOW), None, False) == "TERMS_PENDING"
    assert teacher_state(SimpleNamespace(is_active=True, last_login_at=NOW), None, True) == "ACTIVE"
    assert teacher_state(SimpleNamespace(is_active=False, last_login_at=NOW), None, True) == "DEACTIVATED"


def test_smtp_failures_are_explained():
    rejected = aiosmtplib.SMTPAuthenticationError(535, "5.7.8 Username and Password not accepted. BadCredentials")
    assert "password per le app" in describe_smtp_error(rejected)
    assert "chiuso la connessione" in describe_smtp_error(aiosmtplib.SMTPServerDisconnected("Connection lost"))
    assert "non raggiungibile" in describe_smtp_error(aiosmtplib.SMTPConnectError("refused"))


def test_onboarding_texts_follow_the_privacy_policy_of_26_october():
    contract, declaration, notice = deployer_agreement_html("IC Test", "BOIC00000X"), teacher_declaration_html("IC Test"), family_notice_html("IC Test")
    for html in (contract, declaration, notice):
        assert "v2.0 del 26 ottobre 2026" in html and "/docs/informativa-privacy-v2.0.pdf" in html
    assert "Titolare autonomo" in contract  # teachers' data: the Foundation, not the school
    assert "30 giorni dopo la chiusura" in contract and "30 giorni dopo la chiusura" in notice
    assert "privacy@fondazionegolinelli.it" in notice and "[da inserire dal DPO della Fondazione]" not in notice
    assert "DeepSeek" in notice and "nickname" in notice
    assert DEPLOYER_AGREEMENT["version"] == TEACHER_USE_DECLARATION["version"] == "2026-10-27"
