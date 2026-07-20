from pydantic import BaseModel, Field, model_validator
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


# ==================== Teacherbot Schemas ====================

class TeacherbotCreate(BaseModel):
    name: str = Field(..., max_length=100)
    synopsis: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    icon: str = Field(default="bot", max_length=50)
    color: str = Field(default="indigo", max_length=20)
    system_prompt: str
    is_proactive: bool = False
    proactive_message: Optional[str] = None
    enable_live_voice: bool = False
    enable_reporting: bool = False
    report_prompt: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)


class TeacherbotUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    synopsis: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    icon: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=20)
    system_prompt: Optional[str] = None
    is_proactive: Optional[bool] = None
    proactive_message: Optional[str] = None
    enable_live_voice: Optional[bool] = None
    enable_reporting: Optional[bool] = None
    report_prompt: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    status: Optional[str] = None  # draft, testing, published, archived


class TeacherbotResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    teacher_id: UUID
    name: str
    synopsis: Optional[str]
    description: Optional[str]
    icon: str
    color: str
    system_prompt: str
    is_proactive: bool
    proactive_message: Optional[str]
    enable_live_voice: bool
    enable_reporting: bool
    report_prompt: Optional[str]
    llm_provider: Optional[str]
    llm_model: Optional[str]
    temperature: float
    status: str
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime]

    class Config:
        from_attributes = True


class TeacherbotListResponse(BaseModel):
    """Lightweight response for list views"""
    id: UUID
    name: str
    synopsis: Optional[str]
    icon: str
    color: str
    status: str
    is_proactive: bool
    enable_reporting: bool
    created_at: datetime
    updated_at: datetime
    publication_count: int = 0
    conversation_count: int = 0

    class Config:
        from_attributes = True


# ==================== Publication Schemas ====================

class TeacherbotPublishRequest(BaseModel):
    class_id: Optional[UUID] = None
    student_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _exactly_one_target(self):
        if (self.class_id is None) == (self.student_id is None):
            raise ValueError("Specify exactly one of class_id or student_id")
        return self


class TeacherbotPublicationResponse(BaseModel):
    id: UUID
    teacherbot_id: UUID
    class_id: Optional[UUID] = None
    class_name: Optional[str] = None
    student_id: Optional[UUID] = None
    student_nickname: Optional[str] = None
    is_active: bool
    published_at: datetime
    published_by_id: UUID

    class Config:
        from_attributes = True


# ==================== Conversation Schemas ====================

class TeacherbotConversationCreate(BaseModel):
    session_id: UUID


class TeacherbotConversationResponse(BaseModel):
    id: UUID
    teacherbot_id: UUID
    student_id: UUID
    session_id: UUID
    title: Optional[str]
    created_at: datetime
    updated_at: datetime
    report_json: Optional[dict[str, Any]] = None
    report_generated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TeacherbotConversationWithDetails(TeacherbotConversationResponse):
    """Conversation with student and bot details for teacher reports view"""
    student_nickname: str
    teacherbot_name: str
    message_count: int = 0


# ==================== Message Schemas ====================

class TeacherbotMessageCreate(BaseModel):
    content: str


class TeacherbotMessageResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    role: str
    content: str
    provider: Optional[str]
    model: Optional[str]
    token_usage_json: Optional[dict[str, Any]]
    created_at: datetime

    class Config:
        from_attributes = True


# ==================== Test Chat Schemas ====================

class TeacherbotTestMessage(BaseModel):
    content: str
    history: Optional[list[dict[str, str]]] = None  # [{role, content}, ...]
    # Optional overrides so the teacher can test unsaved edits before hitting "Save"
    system_prompt: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None


class TeacherbotTestResponse(BaseModel):
    content: str
    provider: str
    model: str
    token_usage_json: Optional[dict[str, Any]] = None


# ==================== Report Schemas ====================

class TeacherbotReportResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    teacherbot_id: UUID
    teacherbot_name: str
    student_id: UUID
    student_nickname: str
    session_id: UUID
    session_title: str
    summary: Optional[str] = None
    observations: Optional[str] = None
    suggestions: Optional[str] = None
    topics: Optional[list[str]] = None
    message_count: int = 0
    report_generated_at: Optional[datetime] = None
    conversation_created_at: datetime

    class Config:
        from_attributes = True


# ==================== Student-facing Schemas ====================

class StudentTeacherbotResponse(BaseModel):
    """Teacherbot info visible to students"""
    id: UUID
    name: str
    synopsis: Optional[str]
    description: Optional[str]
    icon: str
    color: str
    is_proactive: bool
    proactive_message: Optional[str] = None
    enable_live_voice: bool = False

    class Config:
        from_attributes = True


# ==================== Share Link Schemas ====================

class ShareLinkCreate(BaseModel):
    expires_at: datetime
    label: Optional[str] = Field(None, max_length=120)
    access_code: Optional[str] = Field(None, min_length=4, max_length=12)


class ShareLinkResponse(BaseModel):
    id: UUID
    teacherbot_id: UUID
    token: str
    access_code: str
    label: Optional[str]
    expires_at: datetime
    is_active: bool
    created_at: datetime
    revoked_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ShareLinkVerifyRequest(BaseModel):
    access_code: str


class ShareLinkPublicInfo(BaseModel):
    """Non-sensitive bot info shown before the access-code gate"""
    name: str
    synopsis: Optional[str]
    icon: str
    color: str
    is_proactive: bool
    proactive_message: Optional[str] = None


class ShareVisitorMessageCreate(BaseModel):
    content: str


class ShareConversationResponse(BaseModel):
    id: UUID
    share_link_id: UUID
    visitor_label: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ShareMessageResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    role: str
    content: str
    provider: Optional[str]
    model: Optional[str]
    token_usage_json: Optional[dict[str, Any]]
    created_at: datetime

    class Config:
        from_attributes = True
