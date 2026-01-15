from pydantic import BaseModel
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


class MLDatasetCreate(BaseModel):
    scope: str
    class_id: Optional[UUID] = None
    session_id: Optional[UUID] = None
    source_type: str
    file_id: Optional[UUID] = None


class MLDatasetResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    scope: str
    class_id: Optional[UUID]
    session_id: Optional[UUID]
    owner_teacher_id: Optional[UUID]
    owner_student_id: Optional[UUID]
    source_type: str
    file_id: Optional[UUID]
    schema_json: dict[str, Any]
    preview_json: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class SyntheticDatasetRequest(BaseModel):
    prompt: str
    session_id: UUID
    num_rows: int = 100


class MLExperimentCreate(BaseModel):
    session_id: UUID
    dataset_id: UUID
    task_type: str
    config_json: dict[str, Any] = {}


class MLExperimentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    session_id: UUID
    student_id: Optional[UUID]
    teacher_id: Optional[UUID]
    task_type: str
    dataset_id: UUID
    config_json: dict[str, Any]
    status: str
    created_at: datetime
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


class MLResultResponse(BaseModel):
    experiment_id: UUID
    metrics_json: dict[str, Any]
    artifacts_json: dict[str, Any]
    explainability_json: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class ExplainExperimentRequest(BaseModel):
    experiment_id: UUID


class ExplainExperimentResponse(BaseModel):
    experiment_id: UUID
    explanation: str
    visualizations: list[str]
