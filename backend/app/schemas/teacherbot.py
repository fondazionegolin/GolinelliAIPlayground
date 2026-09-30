from pydantic import BaseModel, Field, model_validator
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


# ==================== Inquiry (investigative NPC) ====================

INQUIRY_FLAGS = ("defensive", "nervous", "persuasive", "dramatic", "humorous", "cooperative")


class InquirySuspect(BaseModel):
    id: str = Field(..., max_length=40)
    name: str = Field(default="", max_length=80)
    role: str = Field(default="", max_length=200)
    personality: str = Field(default="", max_length=800)
    knowledge: str = Field(default="", max_length=3000)  # what this NPC knows / hides / lies about
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    voice: Optional[str] = Field(default=None, max_length=20)
    is_culprit: bool = False


class InquiryClue(BaseModel):
    id: str = Field(..., max_length=40)
    suspect_id: Optional[str] = Field(default=None, max_length=40)  # who can give it; None = anyone
    text: str = Field(..., max_length=1000)  # what the NPC lets slip once unlocked
    tier: int = Field(default=1, ge=1, le=3)  # 1 easy · 2 needs trust/pressure · 3 needs both, late
    unlock_hint: str = Field(default="", max_length=400)  # what kind of question earns this clue


class InquiryConfig(BaseModel):
    # Legacy single-NPC fields: folded into ``suspects`` on load.
    npc_name: str = Field(default="", max_length=80)
    npc_role: str = Field(default="", max_length=200)
    npc_personality: str = Field(default="", max_length=800)
    suspects: list[InquirySuspect] = Field(default_factory=list, max_length=8)
    case_title: str = Field(default="", max_length=200)
    case_brief: str = Field(default="", max_length=2000)  # what the student is told upfront
    truth: str = Field(default="", max_length=6000)  # hidden full truth, never sent to the browser
    final_question: str = Field(default="", max_length=400)
    correct_answer: str = Field(default="", max_length=1200)
    min_clues: int = Field(default=3, ge=1, le=10)
    clues: list[InquiryClue] = Field(default_factory=list, max_length=20)
    # Per-flag theatrical intensity 0 (off) .. 3 (maximum).
    flag_intensity: dict[str, int] = Field(default_factory=lambda: {f: 2 for f in INQUIRY_FLAGS})

    @model_validator(mode="after")
    def _normalise(self):
        if not self.suspects and (self.npc_name or self.npc_role or self.npc_personality):
            self.suspects = [InquirySuspect(
                id="s1", name=self.npc_name, role=self.npc_role, personality=self.npc_personality,
            )]
        ids = [sp.id for sp in self.suspects]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate suspect id")
        for clue in self.clues:
            if clue.suspect_id and clue.suspect_id not in ids:
                clue.suspect_id = None
        if len(self.suspects) > 1:
            culprits = [sp for sp in self.suspects if sp.is_culprit]
            if len(culprits) > 1:
                for sp in culprits[1:]:
                    sp.is_culprit = False
        self.flag_intensity = {
            f: max(0, min(3, int(self.flag_intensity.get(f, 2)))) for f in INQUIRY_FLAGS
        }
        seen: set[str] = set()
        for clue in self.clues:
            if clue.id in seen:
                raise ValueError(f"Duplicate clue id: {clue.id}")
            seen.add(clue.id)
        self.min_clues = min(self.min_clues, max(1, len(self.clues))) if self.clues else self.min_clues
        return self


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
    enable_inquiry: bool = False
    inquiry_config: Optional[InquiryConfig] = None
    enable_escape_room: bool = False
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
    enable_inquiry: Optional[bool] = None
    inquiry_config: Optional[InquiryConfig] = None
    enable_escape_room: Optional[bool] = None
    enable_reporting: Optional[bool] = None
    report_prompt: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    status: Optional[str] = None  # draft, testing, published, archived


class TeacherbotResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    teacher_id: Optional[UUID] = None
    creator_student_id: Optional[UUID] = None
    name: str
    synopsis: Optional[str]
    description: Optional[str]
    icon: str
    color: str
    system_prompt: str
    is_proactive: bool
    proactive_message: Optional[str]
    enable_live_voice: bool
    enable_inquiry: bool = False
    inquiry_config: Optional[dict[str, Any]] = None
    enable_escape_room: bool
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
    enable_escape_room: bool = False
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


class EscapeRoomAnswerRequest(BaseModel):
    value: str = Field(..., min_length=1, max_length=300)


class EscapeRoomChallengeResponse(BaseModel):
    number: int
    false_statement: str
    prompt: str


class EscapeRoomStateResponse(BaseModel):
    enabled: bool = True
    status: str
    title: Optional[str] = None
    narrative_intro: Optional[str] = None
    mission: Optional[str] = None
    current_step: int = 0
    total_steps: int = 0
    attempts: int = 0
    current_challenge: Optional[EscapeRoomChallengeResponse] = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    inventory: list[dict[str, Any]] = Field(default_factory=list)
    achievement: Optional[dict[str, Any]] = None
    message: Optional[str] = None
    correct: Optional[bool] = None


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
    enable_inquiry: bool = False
    enable_escape_room: bool = False
    is_studentbot: bool = False

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
    teacherbot_id: Optional[UUID] = None
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
