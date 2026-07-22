from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class CodingMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class CodingProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    session_id: Optional[UUID] = None
    brief_id: Optional[UUID] = None
    template_key: str = Field(default="vite-react", max_length=64)
    initial_prompt: Optional[str] = Field(default=None, max_length=20000)


class CodingBriefCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    session_id: UUID
    description: Optional[str] = None
    constraints_json: dict[str, Any] = Field(default_factory=dict)
    rubric_json: dict[str, Any] = Field(default_factory=dict)
    allowed_templates_json: list[str] = Field(default_factory=lambda: ["vite-react"])
    publication_policy: str = "teacher_review"


class CodingVersionCreate(BaseModel):
    parent_version_id: Optional[UUID] = None
    source_manifest_json: dict[str, Any] = Field(default_factory=dict)
    artifact_manifest_json: dict[str, Any] = Field(default_factory=dict)
    build_status: str = "pending"
    review_status: str = "pending"


class CodingGeneratedFile(BaseModel):
    path: str
    content: str
    language: Optional[str] = None


class CodingGenerateRequest(BaseModel):
    prompt: Optional[str] = Field(default=None, min_length=1, max_length=20000)
    # Current editor files (edits + knowledge-base .md). When provided, they are the base
    # for this generation so unsaved edits and added files are respected.
    files: Optional[list[CodingGeneratedFile]] = None
    # Which generation model to use ("sonnet" | "haiku" | "gpt-mini"). Resolved to a
    # provider/model pair server-side; unknown/empty falls back to the configured default.
    model_key: Optional[str] = Field(default=None, max_length=40)
    # Pasted/attached screenshots as data URLs ("data:image/png;base64,..."). Described by a
    # vision model server-side and folded into the prompt, so they work regardless of which
    # codegen model is selected (some, like DeepSeek, have no vision support at all).
    attachments: Optional[list[str]] = Field(default=None, max_length=3)


class CodingMessageResponse(BaseModel):
    id: UUID
    project_id: UUID
    actor_type: str
    actor_id: Optional[UUID]
    agent_name: Optional[str]
    role: str
    content: str
    metadata_json: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class CodingVersionResponse(BaseModel):
    id: UUID
    project_id: UUID
    parent_version_id: Optional[UUID]
    version_number: int
    source_manifest_json: dict[str, Any]
    artifact_manifest_json: dict[str, Any]
    prompt_message_id: Optional[UUID]
    build_status: str
    review_status: str
    created_by_actor_type: str
    created_at: datetime

    class Config:
        from_attributes = True


class CodingGenerateResponse(BaseModel):
    version: CodingVersionResponse
    files: list[CodingGeneratedFile]
    summary: str


class CodingProjectResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    session_id: UUID
    brief_id: Optional[UUID]
    owner_student_id: Optional[UUID]
    owner_user_id: Optional[UUID]
    owner_display_name: Optional[str] = None
    owner_kind: Optional[str] = None
    is_owned_by_current_user: bool = False
    title: str
    slug: str
    template_key: str
    status: str
    current_version_id: Optional[UUID]
    visibility: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CodingProjectDetail(CodingProjectResponse):
    messages: list[CodingMessageResponse] = Field(default_factory=list)
    versions: list[CodingVersionResponse] = Field(default_factory=list)


class DesignSystemSuggestRequest(BaseModel):
    # Free-form intent used to propose a coherent starting point. All optional: the wizard can
    # ask for a suggestion from a single mood or from the project idea.
    mood: Optional[str] = Field(default=None, max_length=120)
    audience: Optional[str] = Field(default=None, max_length=200)
    idea: Optional[str] = Field(default=None, max_length=4000)
    title: Optional[str] = Field(default=None, max_length=255)


class DesignSystemCompileRequest(BaseModel):
    # Structured tokens edited in the wizard. Kept as a permissive dict so the front-end can
    # evolve the token shape without lock-stepping the schema; the backend normalises/validates.
    tokens: dict[str, Any] = Field(default_factory=dict)


class DesignSystemContrastCheck(BaseModel):
    label: str
    foreground: str
    background: str
    ratio: float
    passes_aa: bool


class DesignSystemCompileResponse(BaseModel):
    tokens: dict[str, Any]
    markdown: str
    path: str = "design-system.md"
    contrast_checks: list[DesignSystemContrastCheck] = Field(default_factory=list)
    coherence_score: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class DesignSystemSuggestResponse(BaseModel):
    tokens: dict[str, Any]
    rationale: dict[str, str] = Field(default_factory=dict)


class DesignSystemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=2000)
    session_id: Optional[UUID] = None
    tokens: dict[str, Any] = Field(default_factory=dict)


class DesignSystemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=2000)
    tokens: Optional[dict[str, Any]] = None


class DesignSystemResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    session_id: Optional[UUID]
    owner_student_id: Optional[UUID]
    owner_user_id: Optional[UUID]
    name: str
    description: Optional[str]
    tokens_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CodingBriefResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    teacher_id: Optional[UUID]
    session_id: UUID
    title: str
    description: Optional[str]
    constraints_json: dict[str, Any]
    rubric_json: dict[str, Any]
    allowed_templates_json: list[str]
    publication_policy: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CodingProjectDataPut(BaseModel):
    value: Any = None


class CodingProjectDataResponse(BaseModel):
    key: str
    value: Any = None
    updated_at: datetime


class CodingProjectDataListResponse(BaseModel):
    items: list[CodingProjectDataResponse]
    total_size_bytes: int
    max_size_bytes: int
