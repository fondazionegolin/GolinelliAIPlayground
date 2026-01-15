from sqlalchemy import Column, String, Enum, DateTime, ForeignKey, Text, Integer, func, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
import uuid

from app.core.database import Base
from app.models.enums import Scope, DocumentStatus
from app.core.config import settings


class RAGDocument(Base):
    __tablename__ = "rag_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    scope = Column(Enum(Scope), nullable=False)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True, index=True)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True)
    file_id = Column(UUID(as_uuid=True), ForeignKey("files.id"), nullable=False)
    title = Column(String, nullable=False)
    doc_type = Column(String, nullable=False)
    status = Column(Enum(DocumentStatus), default=DocumentStatus.QUEUED, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    chunks = relationship("RAGChunk", back_populates="document", lazy="dynamic", cascade="all, delete-orphan")


class RAGChunk(Base):
    __tablename__ = "rag_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey("rag_documents.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    page = Column(Integer, nullable=True)
    text = Column(Text, nullable=False)
    meta_json = Column(JSONB, default=dict, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    document = relationship("RAGDocument", back_populates="chunks")
    embedding = relationship("RAGEmbedding", back_populates="chunk", uselist=False, cascade="all, delete-orphan")


class RAGEmbedding(Base):
    __tablename__ = "rag_embeddings"

    chunk_id = Column(UUID(as_uuid=True), ForeignKey("rag_chunks.id"), primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    embedding = Column(Vector(settings.EMBEDDING_DIMENSION), nullable=False)

    # Relationships
    chunk = relationship("RAGChunk", back_populates="embedding")


class RAGCitation(Base):
    __tablename__ = "rag_citations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    conversation_message_id = Column(UUID(as_uuid=True), ForeignKey("conversation_messages.id"), nullable=False, index=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey("rag_documents.id"), nullable=False)
    chunk_id = Column(UUID(as_uuid=True), ForeignKey("rag_chunks.id"), nullable=False)
    quote = Column(Text, nullable=False)
    page = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    conversation_message = relationship("ConversationMessage", back_populates="citations")
