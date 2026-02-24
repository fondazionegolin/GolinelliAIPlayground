from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, Optional
from uuid import UUID
from pathlib import Path

from app.core.database import get_db
from app.api.deps import get_current_teacher, get_current_student, get_student_or_teacher, StudentOrTeacher
from app.models.user import User
from app.models.session import Session, SessionStudent, Class
from app.models.rag import RAGDocument, RAGChunk
from app.models.file import File as FileModel
from app.models.enums import Scope, DocumentStatus
from app.schemas.rag import (
    RAGDocumentCreate, RAGDocumentResponse, RAGChunkResponse,
    RAGSearchRequest, RAGSearchResult,
)
from app.services.rag_service import rag_service
from app.services.document_processor import document_processor
from app.services.llm_service import llm_service

router = APIRouter()


@router.post("/documents", response_model=RAGDocumentResponse)
async def create_document(
    request: RAGDocumentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    scope = Scope(request.scope)
    
    if auth.is_student:
        if scope != Scope.USER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Students can only create USER scope documents",
            )
        
        document = RAGDocument(
            tenant_id=auth.student.tenant_id,
            scope=scope,
            session_id=auth.student.session_id,
            owner_student_id=auth.student.id,
            file_id=request.file_id,
            title=request.title,
            doc_type=request.doc_type,
        )
    else:
        if scope == Scope.USER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Teachers should use SESSION or CLASS scope",
            )
        
        # Verify teacher owns the session/class
        if request.session_id:
            result = await db.execute(
                select(Session)
                .join(Class)
                .where(Session.id == request.session_id)
                .where(Class.teacher_id == auth.teacher.id)
            )
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        
        if request.class_id:
            result = await db.execute(
                select(Class)
                .where(Class.id == request.class_id)
                .where(Class.teacher_id == auth.teacher.id)
            )
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")
        
        document = RAGDocument(
            tenant_id=auth.teacher.tenant_id,
            scope=scope,
            class_id=request.class_id,
            session_id=request.session_id,
            owner_teacher_id=auth.teacher.id,
            file_id=request.file_id,
            title=request.title,
            doc_type=request.doc_type,
        )
    
    db.add(document)
    await db.commit()
    await db.refresh(document)
    return document


@router.get("/documents", response_model=list[RAGDocumentResponse])
async def list_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    scope: Optional[str] = None,
    session_id: Optional[UUID] = None,
):
    if auth.is_student:
        # Students see their own docs + session/class docs
        query = select(RAGDocument).where(
            (RAGDocument.owner_student_id == auth.student.id) |
            (RAGDocument.session_id == auth.student.session_id)
        )
    else:
        query = select(RAGDocument).where(RAGDocument.owner_teacher_id == auth.teacher.id)
        if session_id:
            query = query.where(RAGDocument.session_id == session_id)
    
    if scope:
        query = query.where(RAGDocument.scope == Scope(scope))
    
    result = await db.execute(query.order_by(RAGDocument.created_at.desc()))
    return result.scalars().all()


@router.post("/documents/{doc_id}/ingest")
async def ingest_document(
    doc_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(RAGDocument).where(RAGDocument.id == doc_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
    # Verify ownership
    if auth.is_student:
        if document.owner_student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        if document.owner_teacher_id != auth.teacher.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    if document.status not in (DocumentStatus.QUEUED, DocumentStatus.FAILED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document already in status: {document.status.value}",
        )

    # Resolve file path from the linked File record
    file_result = await db.execute(select(FileModel).where(FileModel.id == document.file_id))
    file_record = file_result.scalar_one_or_none()
    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File record not found")

    # Build local path (chat uploads use uploads/{storage_key})
    file_path = Path("uploads") / file_record.storage_key
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found on disk: {file_path}",
        )

    # Read file bytes
    file_bytes = file_path.read_bytes()

    # Process document (extract text + visual analysis)
    analysis = await document_processor.process(
        file_bytes=file_bytes,
        filename=file_record.filename,
        mime_type=file_record.mime_type,
        llm_service=llm_service,
        analyze_visuals=True,
    )

    if not analysis.raw_text and not analysis.visual_descriptions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not extract content from document",
        )

    # Ingest: chunk + embed and store in DB
    content_for_rag = analysis.structured_extract or analysis.raw_text
    chunk_count = await rag_service.ingest_document(db, document, content_for_rag)

    return {
        "message": "Ingestion completed",
        "document_id": str(doc_id),
        "chunk_count": chunk_count,
        "summary": analysis.summary,
        "processing_steps": analysis.processing_steps,
    }


@router.get("/documents/{doc_id}/status")
async def get_document_status(
    doc_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(RAGDocument).where(RAGDocument.id == doc_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
    # Count chunks
    result = await db.execute(
        select(RAGChunk).where(RAGChunk.document_id == doc_id)
    )
    chunks = result.scalars().all()
    
    return {
        "document_id": str(doc_id),
        "status": document.status.value,
        "chunk_count": len(chunks),
    }


@router.post("/search", response_model=list[RAGSearchResult])
async def search_documents(
    request: RAGSearchRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify teacher owns session
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == request.session_id)
        .where(Class.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    chunks = await rag_service.search(
        db=db,
        query=request.query,
        session_id=request.session_id,
        tenant_id=teacher.tenant_id,
        top_k=request.top_k if hasattr(request, "top_k") else 5,
    )

    return [
        {
            "chunk_id": str(c.chunk_id),
            "document_id": str(c.document_id),
            "document_title": c.document_title,
            "text": c.text,
            "page": c.page,
            "score": c.score,
        }
        for c in chunks
    ]
