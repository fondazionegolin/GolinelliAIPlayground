"""Task/Assignment models for teacher-assigned work"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class TaskStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CLOSED = "closed"


class TaskType(str, enum.Enum):
    QUIZ = "quiz"
    EXERCISE = "exercise"
    READING = "reading"
    DISCUSSION = "discussion"
    PROJECT = "project"
    LESSON = "lesson"
    PRESENTATION = "presentation"
    STUDENT_SUBMISSION = "student_submission"  # Document submitted by student
    UDA = "uda"  # Unità Didattica — class-level container task


class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    # session_id is nullable: UDA tasks live at class level
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True)
    # class_id for class-level tasks (UDAs propagate to all sessions in the class)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=True, index=True)
    # parent_uda_id for child tasks inside a UDA
    parent_uda_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=True, index=True)
    # uda_phase tracks the UDA workflow: briefing | kb | plan | generating | review | published
    uda_phase = Column(String(50), nullable=True)
    
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    task_type = Column(
        SQLEnum(TaskType, values_callable=lambda x: [e.value for e in x]),
        default=TaskType.EXERCISE
    )
    status = Column(
        SQLEnum(TaskStatus, values_callable=lambda x: [e.value for e in x]),
        default=TaskStatus.DRAFT
    )
    
    due_at = Column(DateTime, nullable=True)
    points = Column(String(50), nullable=True)  # e.g., "10 punti" or "bonus"
    
    content_json = Column(Text, nullable=True)  # JSON for quiz questions, etc.
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    submissions = relationship("TaskSubmission", back_populates="task", cascade="all, delete-orphan")
    # UDA child tasks
    uda_children = relationship(
        "Task",
        foreign_keys="Task.parent_uda_id",
        backref="parent_uda",
        cascade="all, delete-orphan",
    )


class TaskSubmission(Base):
    __tablename__ = "task_submissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=False)
    
    content = Column(Text, nullable=True)
    content_json = Column(Text, nullable=True)  # For structured responses
    
    submitted_at = Column(DateTime, default=datetime.utcnow)
    score = Column(String(50), nullable=True)
    feedback = Column(Text, nullable=True)
    
    # Relationships
    task = relationship("Task", back_populates="submissions")
