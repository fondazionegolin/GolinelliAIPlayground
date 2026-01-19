"""
Content schemas for teacher-generated educational materials.
Pydantic models for quiz, lesson, and exercise content validation.
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional
from enum import Enum


class TeacherIntent(str, Enum):
    """Intent categories for teacher requests"""
    QUIZ_GENERATION = "quiz_generation"
    LESSON_GENERATION = "lesson_generation"
    EXERCISE_GENERATION = "exercise_generation"
    PRESENTATION_GENERATION = "presentation_generation"
    WEB_SEARCH = "web_search"
    ANALYTICS = "analytics"
    DOCUMENT_HELP = "document_help"


class IntentResult(BaseModel):
    """Result of intent classification"""
    intent: TeacherIntent
    confidence: float = Field(ge=0.0, le=1.0)
    extracted_params: Optional[str] = None


# ============================================================================
# QUIZ SCHEMAS
# ============================================================================

class QuizQuestion(BaseModel):
    """A single quiz question with multiple choice options"""
    question: str = Field(..., min_length=5, description="The question text")
    options: List[str] = Field(..., min_items=2, max_items=6, description="Answer options")
    correctIndex: int = Field(..., ge=0, description="Index of correct answer in options list")
    explanation: Optional[str] = Field(None, description="Explanation of the correct answer")
    points: Optional[int] = Field(1, ge=0, description="Points for this question")

    @validator("correctIndex")
    def validate_correct_index(cls, v, values):
        """Ensure correctIndex is within options range"""
        if "options" in values and v >= len(values["options"]):
            raise ValueError(f"correctIndex {v} is out of range for {len(values['options'])} options")
        return v


class QuizData(BaseModel):
    """Complete quiz data structure"""
    title: str = Field(..., min_length=3, max_length=255, description="Quiz title")
    description: str = Field(..., min_length=5, description="Quiz description")
    questions: List[QuizQuestion] = Field(..., min_items=1, description="List of questions")
    total_points: Optional[int] = Field(None, ge=0, description="Total points (auto-calculated if None)")
    time_limit_minutes: Optional[int] = Field(None, ge=1, le=300, description="Time limit in minutes")

    @validator("total_points", always=True)
    def calculate_total_points(cls, v, values):
        """Auto-calculate total_points from questions if not provided"""
        if v is None and "questions" in values:
            return sum(q.points or 1 for q in values["questions"])
        return v


# ============================================================================
# LESSON SCHEMAS
# ============================================================================

class LessonSection(BaseModel):
    """A section within a lesson"""
    title: str = Field(..., min_length=3, description="Section title")
    content: str = Field(..., min_length=10, description="Section content (markdown supported)")
    duration_minutes: Optional[int] = Field(None, ge=1, le=120, description="Estimated duration")


class LessonData(BaseModel):
    """Complete lesson data structure"""
    title: str = Field(..., min_length=3, max_length=255, description="Lesson title")
    description: str = Field(..., min_length=5, description="Lesson overview")
    objectives: List[str] = Field(..., min_items=1, description="Learning objectives")
    sections: List[LessonSection] = Field(..., min_items=1, description="Lesson sections")
    activities: Optional[List[str]] = Field(default_factory=list, description="Practical activities")
    resources: Optional[List[str]] = Field(default_factory=list, description="Additional resources")


# ============================================================================
# EXERCISE SCHEMAS
# ============================================================================

class DifficultyLevel(str, Enum):
    """Exercise difficulty levels"""
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class ExerciseData(BaseModel):
    """Complete exercise data structure"""
    title: str = Field(..., min_length=3, max_length=255, description="Exercise title")
    description: str = Field(..., min_length=5, description="Exercise overview")
    instructions: str = Field(..., min_length=10, description="Detailed instructions")
    examples: Optional[List[str]] = Field(default_factory=list, description="Example solutions")
    solution: Optional[str] = Field(None, description="Complete solution (hidden from students)")
    difficulty: Optional[DifficultyLevel] = Field(DifficultyLevel.MEDIUM, description="Difficulty level")
    hint: Optional[str] = Field(None, description="Optional hint for students")


# ============================================================================
# PRESENTATION SCHEMAS
# ============================================================================

class PresentationSlide(BaseModel):
    """A single slide in a presentation"""
    order: int = Field(..., ge=0, description="Slide order (0-indexed)")
    title: str = Field(..., min_length=1, max_length=255, description="Slide title")
    content: str = Field(..., min_length=1, description="Slide content in markdown format")
    speaker_notes: Optional[str] = Field(None, description="Speaker notes for the teacher")


class PresentationData(BaseModel):
    """Complete presentation data structure"""
    title: str = Field(..., min_length=3, max_length=255, description="Presentation title")
    description: Optional[str] = Field(None, description="Presentation overview")
    slides: List[PresentationSlide] = Field(..., min_items=1, description="List of slides")
    theme: Optional[str] = Field("default", description="Visual theme (for future use)")
