from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class TuringExperimentCreate(BaseModel):
    title: str = Field(default="Test di Turing", min_length=1, max_length=160)
    persona_prompt: str = Field(min_length=20, max_length=4000)
    max_questions: int = Field(default=5, ge=1, le=10)
    temperature: float = Field(default=0.7, ge=0, le=1.2)
    confidence_style: int = Field(default=3, ge=1, le=5)
    response_length: int = Field(default=2, ge=1, le=5)
    emoji_usage: int = Field(default=1, ge=0, le=3)


class TuringMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class TuringGuessCreate(BaseModel):
    guess: Literal["HUMAN", "AI"]
    confidence: int = Field(ge=1, le=5)
    rationale: Optional[str] = Field(default=None, max_length=2000)
