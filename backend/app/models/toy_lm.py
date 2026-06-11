from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid
from app.core.database import Base


class ToyLMJob(Base):
    __tablename__ = "toy_lm_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    name = Column(String, nullable=False, default="Modello senza nome")

    # Status lifecycle: draft → queued → running → (paused | completed | failed | stopped)
    status = Column(String, nullable=False, default="draft")

    corpus_text = Column(Text, nullable=True)
    corpus_char_count = Column(Integer, default=0)

    hyperparams_json = Column(JSONB, nullable=False, default=dict)
    vocab_json = Column(JSONB, nullable=True)   # {charToIndex, indexToChar, vocabSize}

    # Epoch-level metrics saved to DB after each epoch (batch-level only streamed via SSE)
    metrics_json = Column(JSONB, nullable=False, default=list)
    saved_epoch = Column(Integer, default=0)
    param_count = Column(Integer, default=0)

    checkpoint_path = Column(String, nullable=True)

    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class ToyLMJobPublication(Base):
    __tablename__ = "toy_lm_job_publications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("toy_lm_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    chat_message_id = Column(UUID(as_uuid=True), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("job_id", "session_id", name="uq_toy_lm_publication_job_session"),
    )
