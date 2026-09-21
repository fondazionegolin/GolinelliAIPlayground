import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class AgenticDataset(Base):
    __tablename__ = "agentic_datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(180), nullable=False)
    source = Column(String(20), nullable=False, default="ai", server_default="ai")
    row_count = Column(Integer, nullable=False, default=0, server_default="0")
    table_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AgenticWorkflow(Base):
    __tablename__ = "agentic_workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(180), nullable=False, default="Workflow senza titolo")
    status = Column(String(32), nullable=False, default="draft", server_default="draft")
    version = Column(Integer, nullable=False, default=1, server_default="1")
    graph_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    runs = relationship("AgenticWorkflowRun", back_populates="workflow", cascade="all, delete-orphan")


class AgenticWorkflowRun(Base):
    __tablename__ = "agentic_workflow_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("agentic_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(String(32), nullable=False, default="queued", server_default="queued", index=True)
    input_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    output_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    artifacts_json = Column(JSONB, nullable=False, default=list, server_default="[]")
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    workflow = relationship("AgenticWorkflow", back_populates="runs")
    node_runs = relationship("AgenticNodeRun", back_populates="run", cascade="all, delete-orphan")


class AgenticNodeRun(Base):
    __tablename__ = "agentic_node_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("agentic_workflow_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    node_instance_id = Column(String(160), nullable=False)
    node_type = Column(String(80), nullable=False)
    label = Column(String(180), nullable=False)
    sequence = Column(Integer, nullable=False)
    status = Column(String(32), nullable=False, default="queued", server_default="queued")
    input_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    output_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    provider = Column(String(40), nullable=True)
    model = Column(String(160), nullable=True)
    prompt_tokens = Column(Integer, nullable=False, default=0, server_default="0")
    completion_tokens = Column(Integer, nullable=False, default=0, server_default="0")
    duration_ms = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    run = relationship("AgenticWorkflowRun", back_populates="node_runs")

    __table_args__ = (
        UniqueConstraint("run_id", "node_instance_id", name="uq_agentic_node_runs_run_node"),
    )
