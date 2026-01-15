from sqlalchemy import Column, String, Enum, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import Scope, DatasetSourceType, MLTaskType, ExperimentStatus


class MLDataset(Base):
    __tablename__ = "ml_datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    scope = Column(Enum(Scope), nullable=False)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True, index=True)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True)
    source_type = Column(Enum(DatasetSourceType), nullable=False)
    file_id = Column(UUID(as_uuid=True), ForeignKey("files.id"), nullable=True)
    schema_json = Column(JSONB, default=dict, nullable=False)
    preview_json = Column(JSONB, default=dict, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    experiments = relationship("MLExperiment", back_populates="dataset", lazy="dynamic")


class MLExperiment(Base):
    __tablename__ = "ml_experiments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    task_type = Column(Enum(MLTaskType), nullable=False)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("ml_datasets.id"), nullable=False)
    config_json = Column(JSONB, default=dict, nullable=False)
    status = Column(Enum(ExperimentStatus), default=ExperimentStatus.QUEUED, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    dataset = relationship("MLDataset", back_populates="experiments")
    result = relationship("MLResult", back_populates="experiment", uselist=False, cascade="all, delete-orphan")


class MLResult(Base):
    __tablename__ = "ml_results"

    experiment_id = Column(UUID(as_uuid=True), ForeignKey("ml_experiments.id"), primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    metrics_json = Column(JSONB, default=dict, nullable=False)
    artifacts_json = Column(JSONB, default=dict, nullable=False)
    explainability_json = Column(JSONB, default=dict, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    experiment = relationship("MLExperiment", back_populates="result")
