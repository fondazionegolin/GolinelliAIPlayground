from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, Optional
from datetime import datetime
from uuid import UUID

from app.core.database import get_db
from app.api.deps import get_current_teacher, get_current_student, get_student_or_teacher, StudentOrTeacher
from app.models.user import User
from app.models.session import Session, SessionStudent, Class
from app.models.ml import MLDataset, MLExperiment, MLResult
from app.models.enums import Scope, DatasetSourceType, MLTaskType, ExperimentStatus
from app.schemas.ml import (
    MLDatasetCreate, MLDatasetResponse, SyntheticDatasetRequest,
    MLExperimentCreate, MLExperimentResponse, MLResultResponse,
    ExplainExperimentRequest, ExplainExperimentResponse,
)

router = APIRouter()


@router.post("/datasets", response_model=MLDatasetResponse)
async def create_dataset(
    request: MLDatasetCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    scope = Scope(request.scope)
    source_type = DatasetSourceType(request.source_type)
    
    if auth.is_student:
        if scope != Scope.USER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Students can only create USER scope datasets",
            )
        
        dataset = MLDataset(
            tenant_id=auth.student.tenant_id,
            scope=scope,
            session_id=auth.student.session_id,
            owner_student_id=auth.student.id,
            source_type=source_type,
            file_id=request.file_id,
            schema_json={},
            preview_json={},
        )
    else:
        dataset = MLDataset(
            tenant_id=auth.teacher.tenant_id,
            scope=scope,
            class_id=request.class_id,
            session_id=request.session_id,
            owner_teacher_id=auth.teacher.id,
            source_type=source_type,
            file_id=request.file_id,
            schema_json={},
            preview_json={},
        )
    
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return dataset


@router.post("/datasets/synthetic", response_model=MLDatasetResponse)
async def create_synthetic_dataset(
    request: SyntheticDatasetRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    # Verify session access
    if auth.is_student:
        if auth.student.session_id != request.session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        tenant_id = auth.student.tenant_id
        owner_student_id = auth.student.id
        owner_teacher_id = None
    else:
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == request.session_id)
            .where(Class.teacher_id == auth.teacher.id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        tenant_id = auth.teacher.tenant_id
        owner_teacher_id = auth.teacher.id
        owner_student_id = None
    
    # TODO: Generate synthetic data using LLM
    # For now, create placeholder dataset
    dataset = MLDataset(
        tenant_id=tenant_id,
        scope=Scope.USER if auth.is_student else Scope.SESSION,
        session_id=request.session_id,
        owner_teacher_id=owner_teacher_id,
        owner_student_id=owner_student_id,
        source_type=DatasetSourceType.SYNTHETIC,
        schema_json={"columns": [], "target": None},
        preview_json={"rows": [], "prompt": request.prompt},
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return dataset


@router.get("/datasets", response_model=list[MLDatasetResponse])
async def list_datasets(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    session_id: Optional[UUID] = None,
):
    if auth.is_student:
        query = select(MLDataset).where(
            (MLDataset.owner_student_id == auth.student.id) |
            (MLDataset.session_id == auth.student.session_id)
        )
    else:
        query = select(MLDataset).where(MLDataset.owner_teacher_id == auth.teacher.id)
        if session_id:
            query = query.where(MLDataset.session_id == session_id)
    
    result = await db.execute(query.order_by(MLDataset.created_at.desc()))
    return result.scalars().all()


@router.get("/datasets/{dataset_id}", response_model=MLDatasetResponse)
async def get_dataset(
    dataset_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(MLDataset).where(MLDataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    
    # Verify access
    if auth.is_student:
        if dataset.owner_student_id != auth.student.id and dataset.session_id != auth.student.session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    return dataset


@router.post("/experiments", response_model=MLExperimentResponse)
async def create_experiment(
    request: MLExperimentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    # Verify dataset exists and is accessible
    result = await db.execute(select(MLDataset).where(MLDataset.id == request.dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    
    task_type = MLTaskType(request.task_type)
    
    if auth.is_student:
        if auth.student.session_id != request.session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        
        experiment = MLExperiment(
            tenant_id=auth.student.tenant_id,
            session_id=request.session_id,
            student_id=auth.student.id,
            task_type=task_type,
            dataset_id=request.dataset_id,
            config_json=request.config_json,
        )
    else:
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == request.session_id)
            .where(Class.teacher_id == auth.teacher.id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        
        experiment = MLExperiment(
            tenant_id=auth.teacher.tenant_id,
            session_id=request.session_id,
            teacher_id=auth.teacher.id,
            task_type=task_type,
            dataset_id=request.dataset_id,
            config_json=request.config_json,
        )
    
    db.add(experiment)
    await db.commit()
    await db.refresh(experiment)
    
    # TODO: Enqueue training job via Celery
    
    return experiment


@router.get("/experiments", response_model=list[MLExperimentResponse])
async def list_experiments(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    session_id: Optional[UUID] = None,
):
    if auth.is_student:
        query = select(MLExperiment).where(MLExperiment.student_id == auth.student.id)
    else:
        query = select(MLExperiment).where(MLExperiment.teacher_id == auth.teacher.id)
        if session_id:
            query = query.where(MLExperiment.session_id == session_id)
    
    result = await db.execute(query.order_by(MLExperiment.created_at.desc()))
    return result.scalars().all()


@router.get("/experiments/{exp_id}", response_model=MLExperimentResponse)
async def get_experiment(
    exp_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(MLExperiment).where(MLExperiment.id == exp_id))
    experiment = result.scalar_one_or_none()
    if not experiment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    
    if auth.is_student:
        if experiment.student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    return experiment


@router.get("/experiments/{exp_id}/results", response_model=MLResultResponse)
async def get_experiment_results(
    exp_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(MLExperiment).where(MLExperiment.id == exp_id))
    experiment = result.scalar_one_or_none()
    if not experiment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    
    if auth.is_student:
        if experiment.student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    result = await db.execute(select(MLResult).where(MLResult.experiment_id == exp_id))
    ml_result = result.scalar_one_or_none()
    if not ml_result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Results not ready")
    
    return ml_result


@router.post("/experiments/{exp_id}/explain", response_model=ExplainExperimentResponse)
async def explain_experiment(
    exp_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(MLExperiment).where(MLExperiment.id == exp_id))
    experiment = result.scalar_one_or_none()
    if not experiment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    
    if auth.is_student:
        if experiment.student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # TODO: Generate explanation using LLM + SHAP/Grad-CAM
    explanation = f"[Explanation placeholder for {experiment.task_type.value} experiment]"
    
    return ExplainExperimentResponse(
        experiment_id=exp_id,
        explanation=explanation,
        visualizations=[],
    )
