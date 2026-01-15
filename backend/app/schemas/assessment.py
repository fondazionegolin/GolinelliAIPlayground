from pydantic import BaseModel
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


class LessonGenerateRequest(BaseModel):
    topic: str
    level: str


class LessonResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    topic: str
    level: str
    content_md: str
    created_by: str
    created_at: datetime

    class Config:
        from_attributes = True


class QuizGenerateRequest(BaseModel):
    lesson_id: UUID


class QuizResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    lesson_id: UUID
    quiz_json: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class QuizAttemptCreate(BaseModel):
    answers_json: dict[str, Any]


class QuizAttemptResponse(BaseModel):
    id: UUID
    session_id: UUID
    student_id: UUID
    quiz_id: UUID
    answers_json: dict[str, Any]
    score_json: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class BadgeResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    key: str
    name: str
    description: Optional[str]
    rule_json: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class BadgeAwardResponse(BaseModel):
    id: UUID
    session_id: UUID
    student_id: UUID
    badge_id: UUID
    badge: BadgeResponse
    created_at: datetime

    class Config:
        from_attributes = True
