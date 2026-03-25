"""Integration tests for assessment endpoints — lessons, quizzes, quiz attempts, badges."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import MagicMock

from app.core.config import settings
from app.models.assessment import Lesson, Quiz, QuizAttempt, Badge, BadgeAward
from app.models.enums import LessonLevel, LessonCreatedBy

API = settings.API_V1_PREFIX
SELF = f"{API}/self"


# ---------------------------------------------------------------------------
# Lesson generation
# ---------------------------------------------------------------------------


class TestLessons:
    async def test_generate_lesson(
        self, student_client: AsyncClient, mock_llm_service
    ):
        """Student generates a lesson on a topic."""
        # Mock LLM response to return markdown lesson content
        response = MagicMock()
        response.content = "# Photosynthesis\n\nPhotosynthesis is the process..."
        mock_llm_service.generate.return_value = response

        resp = await student_client.post(
            f"{SELF}/lessons/generate",
            json={"topic": "Photosynthesis", "level": "SEC_I"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["topic"] == "Photosynthesis"
        assert data["level"] == "SEC_I"
        assert len(data["content_md"]) > 0
        assert "id" in data

    async def test_list_lessons(
        self, student_client: AsyncClient, seed_tenant, db_session
    ):
        lesson = Lesson(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            topic="Biology",
            level=LessonLevel.SEC_I,
            content_md="# Biology\nContent here.",
            created_by=LessonCreatedBy.SYSTEM,
        )
        db_session.add(lesson)
        await db_session.flush()

        resp = await student_client.get(f"{SELF}/lessons")
        assert resp.status_code == 200
        lessons = resp.json()
        assert any(l["id"] == str(lesson.id) for l in lessons)

    async def test_get_lesson_by_id(
        self, student_client: AsyncClient, seed_tenant, db_session
    ):
        lesson = Lesson(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            topic="Chemistry",
            level=LessonLevel.SEC_II,
            content_md="# Chemistry\nAtoms and molecules.",
            created_by=LessonCreatedBy.SYSTEM,
        )
        db_session.add(lesson)
        await db_session.flush()

        resp = await student_client.get(f"{SELF}/lessons/{lesson.id}")
        assert resp.status_code == 200
        assert resp.json()["topic"] == "Chemistry"

    async def test_list_lessons_filter_by_level(
        self, student_client: AsyncClient, seed_tenant, db_session
    ):
        for level in [LessonLevel.PRIMARY, LessonLevel.SEC_II]:
            db_session.add(Lesson(
                id=uuid.uuid4(),
                tenant_id=seed_tenant.id,
                topic=f"Topic {level.value}",
                level=level,
                content_md="Content",
                created_by=LessonCreatedBy.SYSTEM,
            ))
        await db_session.flush()

        resp = await student_client.get(
            f"{SELF}/lessons", params={"level": "PRIMARY"}
        )
        assert resp.status_code == 200
        for lesson in resp.json():
            assert lesson["level"] == "PRIMARY"


# ---------------------------------------------------------------------------
# Quiz generation and attempts
# ---------------------------------------------------------------------------


class TestQuizzes:
    async def test_generate_quiz_from_lesson(
        self, student_client: AsyncClient, seed_tenant, db_session, mock_llm_service
    ):
        lesson = Lesson(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            topic="Physics",
            level=LessonLevel.SEC_I,
            content_md="# Physics\nNewton's laws of motion.",
            created_by=LessonCreatedBy.SYSTEM,
        )
        db_session.add(lesson)
        await db_session.flush()

        # Mock LLM to return valid quiz JSON
        quiz_response = MagicMock()
        quiz_response.content = (
            '{"questions": [{"id": "q1", "type": "multiple_choice",'
            ' "question": "What is Newton\'s first law?",'
            ' "options": ["A", "B", "C", "D"], "correct": "A",'
            ' "feedback": "Correct!"}], "passing_score": 0.6}'
        )
        mock_llm_service.generate.return_value = quiz_response

        resp = await student_client.post(
            f"{SELF}/quizzes/generate",
            json={"lesson_id": str(lesson.id)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "quiz_json" in data
        assert data["lesson_id"] == str(lesson.id)

    async def test_submit_quiz_attempt(
        self,
        student_client: AsyncClient,
        seed_session,
        seed_student,
        seed_tenant,
        db_session,
    ):
        lesson = Lesson(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            topic="Math",
            level=LessonLevel.SEC_I,
            content_md="# Math",
            created_by=LessonCreatedBy.SYSTEM,
        )
        db_session.add(lesson)
        await db_session.flush()

        quiz = Quiz(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            lesson_id=lesson.id,
            quiz_json={
                "questions": [
                    {
                        "id": 1,
                        "type": "multiple_choice",
                        "question": "2 + 2 = ?",
                        "options": ["3", "4", "5", "6"],
                        "correct": "4",
                        "feedback": "4 is correct",
                    },
                    {
                        "id": 2,
                        "type": "multiple_choice",
                        "question": "3 * 3 = ?",
                        "options": ["6", "9", "12", "15"],
                        "correct": "9",
                        "feedback": "9 is correct",
                    },
                ],
                "passing_score": 0.5,
            },
        )
        db_session.add(quiz)
        await db_session.flush()

        resp = await student_client.post(
            f"{SELF}/quizzes/{quiz.id}/attempt",
            json={"answers_json": {"1": "4", "2": "9"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "score_json" in data
        assert data["quiz_id"] == str(quiz.id)


# ---------------------------------------------------------------------------
# Badges
# ---------------------------------------------------------------------------


class TestBadges:
    async def test_list_badges(
        self, student_client: AsyncClient, seed_tenant, db_session
    ):
        badge = Badge(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            key="first_quiz",
            name="First Quiz Completed",
            description="Awarded after completing your first quiz",
        )
        db_session.add(badge)
        await db_session.flush()

        resp = await student_client.get(f"{SELF}/badges")
        assert resp.status_code == 200
        badges = resp.json()
        assert any(b["key"] == "first_quiz" for b in badges)

    async def test_list_badge_awards_teacher(
        self,
        teacher_client: AsyncClient,
        seed_session,
        seed_student,
        seed_tenant,
        db_session,
    ):
        badge = Badge(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            key="star_student",
            name="Star Student",
        )
        db_session.add(badge)
        await db_session.flush()

        award = BadgeAward(
            id=uuid.uuid4(),
            tenant_id=seed_tenant.id,
            session_id=seed_session.id,
            student_id=seed_student.id,
            badge_id=badge.id,
        )
        db_session.add(award)
        await db_session.flush()

        resp = await teacher_client.get(
            f"{SELF}/badges/awards",
            params={"session_id": str(seed_session.id)},
        )
        assert resp.status_code == 200
        awards = resp.json()
        assert len(awards) >= 1
