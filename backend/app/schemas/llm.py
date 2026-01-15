from pydantic import BaseModel
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


class LLMProfileResponse(BaseModel):
    id: UUID
    key: str
    ui_schema_json: dict[str, Any]
    allowed_tools_json: list[str]
    default_model_pref: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class ConversationCreate(BaseModel):
    session_id: UUID
    profile_key: str
    title: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None


class ConversationResponse(BaseModel):
    id: UUID
    session_id: UUID
    student_id: UUID
    profile_key: str
    title: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    content: str
    content_json: Optional[dict[str, Any]] = None


class ConversationMessageResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    role: str
    content: Optional[str]
    content_json: Optional[dict[str, Any]]
    provider: Optional[str]
    model: Optional[str]
    token_usage_json: Optional[dict[str, Any]]
    confidence_json: Optional[dict[str, Any]]
    created_at: datetime

    class Config:
        from_attributes = True


class ExplainRequest(BaseModel):
    message_id: UUID


class ExplainResponse(BaseModel):
    message_id: UUID
    explanation: str
    level: str
    created_at: datetime
