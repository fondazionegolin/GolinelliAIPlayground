"""Vibe Lab collaboration flow on the development PostgreSQL. Everything is rolled back."""
import os
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.deps import StudentOrTeacher
from app.api.v1.endpoints import coding as routes
from app.core.config import settings
from app.models.coding import CodingProject, CodingVersion
from app.models.enums import SessionStatus, UserRole
from app.models.session import Class, Session, SessionStudent
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.coding import CodingCollaboratorsUpdate, CodingPullRequestCreate, CodingPullRequestResolve

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(os.getenv("DRIVE_DB_TESTS") != "1", reason="Development PostgreSQL only")]
engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)

APP = "a\nb\nc\nd\ne\n"


@asynccontextmanager
async def isolated():
    async with engine.connect() as connection:
        transaction = await connection.begin()
        db = AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        try:
            tenant = Tenant(id=uuid4(), name="Coding test", slug=f"coding-{uuid4()}")
            db.add(tenant); await db.flush()
            teacher = User(id=uuid4(), tenant_id=tenant.id, email=f"{uuid4()}@example.invalid", role=UserRole.TEACHER, is_active=True)
            db.add(teacher); await db.flush()
            cls = Class(id=uuid4(), tenant_id=tenant.id, teacher_id=teacher.id, name="Class")
            db.add(cls); await db.flush()
            session = Session(id=uuid4(), tenant_id=tenant.id, class_id=cls.id, title="S", join_code=uuid4().hex[:5], status=SessionStatus.ACTIVE)
            other_session = Session(id=uuid4(), tenant_id=tenant.id, class_id=cls.id, title="S2", join_code=uuid4().hex[:5], status=SessionStatus.ACTIVE)
            db.add_all([session, other_session]); await db.flush()
            students = [SessionStudent(id=uuid4(), tenant_id=tenant.id, session_id=session.id, nickname=n, join_token=str(uuid4())) for n in ("Marco", "Giulia", "Luca")]
            stranger = SessionStudent(id=uuid4(), tenant_id=tenant.id, session_id=other_session.id, nickname="Altro", join_token=str(uuid4()))
            db.add_all([*students, stranger]); await db.flush()

            main = CodingProject(id=uuid4(), tenant_id=tenant.id, session_id=session.id, owner_student_id=students[0].id, title="App", slug="app", status="generated")
            db.add(main); await db.flush()
            version = CodingVersion(id=uuid4(), project_id=main.id, version_number=1, created_by_actor_type="student",
                                    source_manifest_json={"files": [{"path": "src/App.js", "language": "javascript", "content": APP}, {"path": "notes.md", "language": "markdown", "content": "hi\n"}]})
            db.add(version); await db.flush()
            main.current_version_id = version.id
            await db.flush()
            db.info['teacher'] = teacher
            yield db, main, students, stranger
        finally:
            await db.close(); await transaction.rollback()


def me(student):
    return StudentOrTeacher(student=student)


async def edit(db, project, path, content):
    version = await db.get(CodingVersion, project.current_version_id)
    manifest = dict(version.source_manifest_json)
    manifest["files"] = [{**f, "content": content} if f["path"] == path else f for f in manifest["files"]]
    version.source_manifest_json = manifest
    await db.flush()


async def test_full_collaboration_flow():
    async with isolated() as (db, main, students, stranger):
        owner, collab, third = students
        # only classmates of the same session can be invited
        with pytest.raises(HTTPException):
            await routes.replace_collaborators(main.id, CodingCollaboratorsUpdate(student_ids=[str(stranger.id)]), db, me(owner))
        with pytest.raises(HTTPException):  # not the creator
            await routes.replace_collaborators(main.id, CodingCollaboratorsUpdate(student_ids=[str(third.id)]), db, me(collab))
        await routes.replace_collaborators(main.id, CodingCollaboratorsUpdate(student_ids=[str(collab.id)]), db, me(owner))

        # pending invitation shows the main project with role "invited"; no write access
        listed = await routes.list_projects(db, me(collab), None)
        assert [p["id"] for p in listed] == [main.id] and listed[0]["my_role"] == "invited"
        with pytest.raises(HTTPException):
            await routes._get_accessible_project(db, me(collab), main.id)

        # accept -> private working copy, shown as the creator's project
        accepted = await routes.answer_invitation(main.id, "accept", db, me(collab))
        branch_id = accepted["id"]
        assert accepted["my_role"] == "collaborator" and accepted["owner_display_name"] == "Marco"
        assert accepted["main_project_id"] == main.id
        listed = await routes.list_projects(db, me(collab), None)
        assert [p["id"] for p in listed] == [branch_id]
        branch = await db.get(CodingProject, branch_id)

        # nothing to propose yet
        with pytest.raises(HTTPException):
            await routes.create_pull_request(main.id, CodingPullRequestCreate(title="x"), db, me(collab))

        # collaborator edits the top; creator edits the bottom of the same file meanwhile
        await edit(db, branch, "src/App.js", "A\nb\nc\nd\ne\n")
        await edit(db, main, "src/App.js", "a\nb\nc\nd\nE\n")

        pr = await routes.create_pull_request(main.id, CodingPullRequestCreate(title="Titolo maiuscolo"), db, me(collab))
        assert pr["status"] == "open" and [c["path"] for c in pr["changes"]] == ["src/App.js"]
        # creator sees it, collaborator-only access rules hold
        assert len(await routes.list_pull_requests(main.id, db, me(owner))) == 1
        with pytest.raises(HTTPException):
            await routes.test_pull_request(main.id, pr["id"], db, me(collab))
        with pytest.raises(HTTPException):  # merge before testing is refused
            await routes.merge_pull_request(main.id, pr["id"], db, me(owner))

        tested = await routes.test_pull_request(main.id, pr["id"], db, me(owner))
        assert tested["status"] == "testing" and tested["conflict_paths"] == []
        assert {f["path"]: f["content"] for f in tested["test_files"]}["src/App.js"] == "A\nb\nc\nd\nE\n"
        # main is untouched by testing
        assert (await db.get(CodingVersion, main.current_version_id)).version_number == 1

        # main moves after the test: merge asks for a new test
        await edit(db, main, "notes.md", "changed\n")
        with pytest.raises(HTTPException) as moved:
            await routes.merge_pull_request(main.id, pr["id"], db, me(owner))
        assert moved.value.status_code == 409

        merged = await routes.merge_pull_request(main.id, pr["id"], db, me(owner))
        assert merged["status"] == "merged"
        await db.refresh(main)
        final = await db.get(CodingVersion, main.current_version_id)
        assert final.version_number == 2
        files = {f["path"]: f["content"] for f in final.source_manifest_json["files"]}
        assert files == {"src/App.js": "A\nb\nc\nd\nE\n", "notes.md": "changed\n"}
        assert merged["previous_version_id"] == str(final.parent_version_id)

        # rollback of the merge is the existing endpoint on the previous version
        await routes.rollback_project_version(main.id, final.parent_version_id, db, me(owner))
        await db.refresh(main)
        back = await db.get(CodingVersion, main.current_version_id)
        assert {f["path"]: f["content"] for f in back.source_manifest_json["files"]}["src/App.js"] == "a\nb\nc\nd\nE\n"


async def test_conflict_must_be_resolved_and_update_from_main_is_safe():
    async with isolated() as (db, main, students, _stranger):
        owner, collab, _third = students
        await routes.replace_collaborators(main.id, CodingCollaboratorsUpdate(student_ids=[str(collab.id)]), db, me(owner))
        accepted = await routes.answer_invitation(main.id, "accept", db, me(collab))
        branch = await db.get(CodingProject, accepted["id"])

        await edit(db, branch, "src/App.js", "a\nX\nc\nd\ne\n")
        await edit(db, main, "src/App.js", "a\nY\nc\nd\ne\n")

        # updating from main would hide a conflict -> refused, nothing changes
        with pytest.raises(HTTPException) as sync:
            await routes.pull_project_upstream(branch.id, db, me(collab))
        assert sync.value.status_code == 409

        pr = await routes.create_pull_request(main.id, CodingPullRequestCreate(title="Conflitto"), db, me(collab))
        tested = await routes.test_pull_request(main.id, pr["id"], db, me(owner))
        assert tested["conflict_paths"] == ["src/App.js"]
        with pytest.raises(HTTPException):
            await routes.merge_pull_request(main.id, pr["id"], db, me(owner))
        resolved = await routes.resolve_pull_request_conflict(
            main.id, pr["id"], CodingPullRequestResolve(path="src/App.js", choice="theirs"), db, me(owner))
        assert resolved["conflict_paths"] == []
        merged = await routes.merge_pull_request(main.id, pr["id"], db, me(owner))
        assert {f["path"]: f["content"] for f in merged["test_files"]}["src/App.js"] == "a\nX\nc\nd\ne\n"


async def test_update_from_main_merges_non_overlapping_changes():
    async with isolated() as (db, main, students, _stranger):
        owner, collab, _third = students
        await routes.replace_collaborators(main.id, CodingCollaboratorsUpdate(student_ids=[str(collab.id)]), db, me(owner))
        accepted = await routes.answer_invitation(main.id, "accept", db, me(collab))
        branch = await db.get(CodingProject, accepted["id"])
        await edit(db, branch, "src/App.js", "A\nb\nc\nd\ne\n")
        await edit(db, main, "src/App.js", "a\nb\nc\nd\nE\n")
        status = await routes.get_project_upstream_status(branch.id, db, me(collab))
        assert status["update_available"] is True
        await routes.pull_project_upstream(branch.id, db, me(collab))
        await db.refresh(branch)
        version = await db.get(CodingVersion, branch.current_version_id)
        assert {f["path"]: f["content"] for f in version.source_manifest_json["files"]}["src/App.js"] == "A\nb\nc\nd\nE\n"
        assert (await routes.get_project_upstream_status(branch.id, db, me(collab)))["update_available"] is False


async def test_teacher_can_be_the_creator_and_invite_session_students():
    async with isolated() as (db, _student_main, students, stranger):
        teacher = db.info["teacher"]
        owner_actor = StudentOrTeacher(teacher=teacher)
        collab = students[1]
        tmain = CodingProject(id=uuid4(), tenant_id=teacher.tenant_id, session_id=collab.session_id, owner_user_id=teacher.id, title="Lezione", slug="lezione", status="generated")
        db.add(tmain); await db.flush()
        v = CodingVersion(id=uuid4(), project_id=tmain.id, version_number=1, created_by_actor_type="teacher",
                          source_manifest_json={"files": [{"path": "a.js", "language": "javascript", "content": APP}]})
        db.add(v); await db.flush()
        tmain.current_version_id = v.id
        await db.flush()

        # the teacher sees the whole session as candidates, but strangers from other sessions are refused
        info = await routes.list_collaborators(tmain.id, db, owner_actor)
        assert {c["name"] for c in info["candidates"]} == {"Marco", "Giulia", "Luca"}
        with pytest.raises(HTTPException):
            await routes.replace_collaborators(tmain.id, CodingCollaboratorsUpdate(student_ids=[str(stranger.id)]), db, owner_actor)
        await routes.replace_collaborators(tmain.id, CodingCollaboratorsUpdate(student_ids=[str(collab.id)]), db, owner_actor)
        with pytest.raises(HTTPException):  # a student cannot manage a teacher's project
            await routes.replace_collaborators(tmain.id, CodingCollaboratorsUpdate(student_ids=[]), db, me(collab))

        accepted = await routes.answer_invitation(tmain.id, "accept", db, me(collab))
        assert accepted["my_role"] == "collaborator" and accepted["main_project_id"] == tmain.id
        branch = await db.get(CodingProject, accepted["id"])
        await edit(db, branch, "a.js", "A\nb\nc\nd\ne\n")

        team = await routes.get_project_team(branch.id, db, me(collab))
        assert team["owner"]["role"] == "teacher" and [m["name"] for m in team["members"]] == ["Giulia"]
        assert (await routes.get_project_team(tmain.id, db, owner_actor))["main_project_id"] == str(tmain.id)

        pr = await routes.create_pull_request(tmain.id, CodingPullRequestCreate(title="Maiuscola"), db, me(collab))
        listed = await routes.list_pull_requests(tmain.id, db, owner_actor)
        assert len(listed) == 1
        await routes.test_pull_request(tmain.id, pr["id"], db, owner_actor)
        merged = await routes.merge_pull_request(tmain.id, pr["id"], db, owner_actor)
        assert merged["status"] == "merged"
        listed_projects = await routes.list_projects(db, owner_actor, None)
        mine = next(p for p in listed_projects if p["id"] == tmain.id)
        assert mine["my_role"] == "owner" and mine["collaborator_count"] == 1
