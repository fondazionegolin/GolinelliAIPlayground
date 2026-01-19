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
    image_provider: Optional[str] = "flux-schnell"  # "dall-e" or "flux-schnell"
    image_size: Optional[str] = "1024x1024"  # "1024x1024", "1024x768", "768x1024", "1920x1080", "1080x1920"
    verbose_mode: Optional[bool] = False  # If True, generate detailed responses


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
