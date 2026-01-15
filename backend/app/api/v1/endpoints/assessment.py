from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Annotated, Optional
from datetime import datetime
from uuid import UUID

from app.core.database import get_db
from app.api.deps import get_current_teacher, get_current_student, get_student_or_teacher, StudentOrTeacher
from app.models.user import User
from app.models.session import Session, SessionStudent, Class
from app.models.assessment import Lesson, Quiz, QuizAttempt, Badge, BadgeAward
from app.models.enums import LessonLevel, LessonCreatedBy
from app.schemas.assessment import (
    LessonGenerateRequest, LessonResponse,
    QuizGenerateRequest, QuizResponse,
    QuizAttemptCreate, QuizAttemptResponse,
    BadgeResponse, BadgeAwardResponse,
)

router = APIRouter()


@router.post("/lessons/generate", response_model=LessonResponse)
async def generate_lesson(
    request: LessonGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    level = LessonLevel(request.level)
    tenant_id = auth.teacher.tenant_id if auth.is_teacher else auth.student.tenant_id
    
    # TODO: Generate lesson content using LLM
    content_md = f"""# {request.topic}

## Introduzione
[Contenuto generato placeholder per {request.topic}]

## Concetti chiave
- Concetto 1
- Concetto 2
- Concetto 3

## Esempi
[Esempi pratici]

## Riepilogo
[Riepilogo dei punti principali]
"""
    
    lesson = Lesson(
        tenant_id=tenant_id,
        topic=request.topic,
        level=level,
        content_md=content_md,
        created_by=LessonCreatedBy.SYSTEM,
    )
    db.add(lesson)
    await db.commit()
    await db.refresh(lesson)
    return lesson


@router.get("/lessons", response_model=list[LessonResponse])
async def list_lessons(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    level: Optional[str] = None,
):
    tenant_id = auth.teacher.tenant_id if auth.is_teacher else auth.student.tenant_id
    
    query = select(Lesson).where(Lesson.tenant_id == tenant_id)
    if level:
        query = query.where(Lesson.level == LessonLevel(level))
    
    result = await db.execute(query.order_by(Lesson.created_at.desc()))
    return result.scalars().all()


@router.get("/lessons/{lesson_id}", response_model=LessonResponse)
async def get_lesson(
    lesson_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
    lesson = result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    return lesson


@router.post("/quizzes/generate", response_model=QuizResponse)
async def generate_quiz(
    request: QuizGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(Lesson).where(Lesson.id == request.lesson_id))
    lesson = result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    
    # TODO: Generate quiz using LLM based on lesson content
    quiz_json = {
        "questions": [
            {
                "id": 1,
                "type": "multiple_choice",
                "question": f"Domanda di esempio su {lesson.topic}?",
                "options": ["Opzione A", "Opzione B", "Opzione C", "Opzione D"],
                "correct": 0,
                "feedback": "Spiegazione della risposta corretta.",
            },
            {
                "id": 2,
                "type": "true_false",
                "question": f"Affermazione vera/falsa su {lesson.topic}.",
                "correct": True,
                "feedback": "Spiegazione.",
            },
            {
                "id": 3,
                "type": "multiple_choice",
                "question": "Altra domanda di esempio?",
                "options": ["A", "B", "C", "D"],
                "correct": 2,
                "feedback": "Spiegazione.",
            },
        ],
        "passing_score": 0.6,
    }
    
    quiz = Quiz(
        tenant_id=lesson.tenant_id,
        lesson_id=lesson.id,
        quiz_json=quiz_json,
    )
    db.add(quiz)
    await db.commit()
    await db.refresh(quiz)
    return quiz


@router.post("/quizzes/{quiz_id}/attempt", response_model=QuizAttemptResponse)
async def submit_quiz_attempt(
    quiz_id: UUID,
    request: QuizAttemptCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    result = await db.execute(select(Quiz).where(Quiz.id == quiz_id))
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quiz not found")
    
    # Calculate score
    quiz_data = quiz.quiz_json
    questions = quiz_data.get("questions", [])
    answers = request.answers_json
    
    correct = 0
    total = len(questions)
    details = []
    
    for q in questions:
        q_id = str(q["id"])
        user_answer = answers.get(q_id)
        is_correct = user_answer == q.get("correct")
        if is_correct:
            correct += 1
        details.append({
            "question_id": q_id,
            "user_answer": user_answer,
            "correct_answer": q.get("correct"),
            "is_correct": is_correct,
            "feedback": q.get("feedback", ""),
        })
    
    score = correct / total if total > 0 else 0
    passed = score >= quiz_data.get("passing_score", 0.6)
    
    score_json = {
        "correct": correct,
        "total": total,
        "score": score,
        "passed": passed,
        "details": details,
    }
    
    attempt = QuizAttempt(
        tenant_id=student.tenant_id,
        session_id=student.session_id,
        student_id=student.id,
        quiz_id=quiz_id,
        answers_json=request.answers_json,
        score_json=score_json,
    )
    db.add(attempt)
    
    # Check for badge awards
    if passed:
        # TODO: Check badge rules and award badges
        pass
    
    await db.commit()
    await db.refresh(attempt)
    return attempt


@router.get("/badges", response_model=list[BadgeResponse])
async def list_badges(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    tenant_id = auth.teacher.tenant_id if auth.is_teacher else auth.student.tenant_id
    
    result = await db.execute(
        select(Badge).where(Badge.tenant_id == tenant_id)
    )
    return result.scalars().all()


@router.get("/badges/awards")
async def list_badge_awards(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    session_id: Optional[UUID] = None,
):
    query = select(BadgeAward).options(selectinload(BadgeAward.badge))
    
    if session_id:
        # Verify teacher owns session
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == session_id)
            .where(Class.teacher_id == teacher.id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        query = query.where(BadgeAward.session_id == session_id)
    
    result = await db.execute(query.order_by(BadgeAward.created_at.desc()))
    awards = result.scalars().all()
    
    return [
        {
            "id": str(a.id),
            "session_id": str(a.session_id),
            "student_id": str(a.student_id),
            "badge_id": str(a.badge_id),
            "badge_name": a.badge.name if a.badge else None,
            "created_at": a.created_at.isoformat(),
        }
        for a in awards
    ]
