import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class CodingBrief(Base):
    __tablename__ = "coding_briefs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    constraints_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    rubric_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    allowed_templates_json = Column(JSONB, nullable=False, default=list, server_default="[]")
    publication_policy = Column(String(32), nullable=False, default="teacher_review", server_default="teacher_review")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    projects = relationship("CodingProject", back_populates="brief", lazy="dynamic")


class CodingProject(Base):
    __tablename__ = "coding_projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    brief_id = Column(UUID(as_uuid=True), ForeignKey("coding_briefs.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    title = Column(String(255), nullable=False)
    slug = Column(String(160), nullable=False)
    template_key = Column(String(64), nullable=False, default="vite-react", server_default="vite-react")
    status = Column(String(32), nullable=False, default="draft", server_default="draft")
    current_version_id = Column(UUID(as_uuid=True), nullable=True)
    visibility = Column(String(32), nullable=False, default="private", server_default="private")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    brief = relationship("CodingBrief", back_populates="projects")
    messages = relationship("CodingMessage", back_populates="project", lazy="dynamic", cascade="all, delete-orphan")
    versions = relationship("CodingVersion", back_populates="project", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("session_id", "slug", name="uq_coding_projects_session_slug"),
    )


class CodingMessage(Base):
    __tablename__ = "coding_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_type = Column(String(32), nullable=False)
    actor_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    agent_name = Column(String(64), nullable=True)
    role = Column(String(32), nullable=False)
    content = Column(Text, nullable=False)
    metadata_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("CodingProject", back_populates="messages")


class CodingVersion(Base):
    __tablename__ = "coding_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_version_id = Column(UUID(as_uuid=True), ForeignKey("coding_versions.id", ondelete="SET NULL"), nullable=True)
    version_number = Column(Integer, nullable=False)
    source_manifest_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    artifact_manifest_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    prompt_message_id = Column(UUID(as_uuid=True), ForeignKey("coding_messages.id", ondelete="SET NULL"), nullable=True)
    build_status = Column(String(32), nullable=False, default="pending", server_default="pending")
    review_status = Column(String(32), nullable=False, default="pending", server_default="pending")
    created_by_actor_type = Column(String(32), nullable=False, default="system", server_default="system")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("CodingProject", back_populates="versions")
    files = relationship("CodingFile", back_populates="version", lazy="dynamic", cascade="all, delete-orphan")
    builds = relationship("CodingBuild", back_populates="version", lazy="dynamic", cascade="all, delete-orphan")
    reviews = relationship("CodingReview", back_populates="version", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("project_id", "version_number", name="uq_coding_versions_project_number"),
    )


class CodingFile(Base):
    __tablename__ = "coding_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id = Column(UUID(as_uuid=True), ForeignKey("coding_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    path = Column(String(512), nullable=False)
    mime_type = Column(String(128), nullable=True)
    content_hash = Column(String(128), nullable=False)
    storage_key = Column(String(1024), nullable=False)
    size_bytes = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    version = relationship("CodingVersion", back_populates="files")

    __table_args__ = (
        UniqueConstraint("version_id", "path", name="uq_coding_files_version_path"),
    )


class CodingAgentRun(Base):
    __tablename__ = "coding_agent_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id = Column(UUID(as_uuid=True), ForeignKey("coding_versions.id", ondelete="SET NULL"), nullable=True, index=True)
    job_id = Column(String(128), nullable=True, index=True)
    agent_name = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False, default="queued", server_default="queued")
    input_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    output_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    logs_storage_key = Column(String(1024), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)


class CodingBuild(Base):
    __tablename__ = "coding_builds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id = Column(UUID(as_uuid=True), ForeignKey("coding_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="queued", server_default="queued")
    runner_job_id = Column(String(128), nullable=True, index=True)
    template_key = Column(String(64), nullable=False)
    install_log_key = Column(String(1024), nullable=True)
    build_log_key = Column(String(1024), nullable=True)
    test_log_key = Column(String(1024), nullable=True)
    artifact_root_key = Column(String(1024), nullable=True)
    screenshot_keys_json = Column(JSONB, nullable=False, default=list, server_default="[]")
    console_errors_json = Column(JSONB, nullable=False, default=list, server_default="[]")
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)

    version = relationship("CodingVersion", back_populates="builds")


class CodingReview(Base):
    __tablename__ = "coding_reviews"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id = Column(UUID(as_uuid=True), ForeignKey("coding_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    review_type = Column(String(32), nullable=False)
    score_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    findings_json = Column(JSONB, nullable=False, default=list, server_default="[]")
    summary = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    version = relationship("CodingVersion", back_populates="reviews")


class CodingDesignSystem(Base):
    """A reusable design system (palette, typography, shape, spacing, visual priorities).

    Independent from any single project: it lives in the owner's library and can be applied to
    any new project (instantiated as the project's `design-system.md` knowledge-base file). The
    canonical structured tokens are kept here so the guided wizard can re-open and edit them."""

    __tablename__ = "coding_design_systems"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    name = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    tokens_json = Column(JSONB, nullable=False, default=dict, server_default="{}")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CodingPublication(Base):
    __tablename__ = "coding_publications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id = Column(UUID(as_uuid=True), ForeignKey("coding_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    publication_slug = Column(String(160), nullable=False)
    url_path = Column(String(512), nullable=False)
    status = Column(String(32), nullable=False, default="draft", server_default="draft")
    chat_message_id = Column(UUID(as_uuid=True), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True)
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("publication_slug", "version_id", name="uq_coding_publications_slug_version"),
    )


class CodingProjectData(Base):
    """Small key-value store generated apps use for their own "database" (lists, notes, scores...)
    via window.GolinelliAI.saveData/loadData. Backs the data with the platform DB instead of the
    Sandpack iframe's localStorage, so it survives version switches, device changes and browser data
    clearing — not just ordinary edits/reloads."""

    __tablename__ = "coding_project_data"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(200), nullable=False)
    value_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    size_bytes = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("project_id", "key", name="uq_coding_project_data_project_key"),
    )
