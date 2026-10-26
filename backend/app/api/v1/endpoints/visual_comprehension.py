"""Temporary admin-only visual comprehension beta; no uploaded images are persisted."""
import asyncio
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.api.deps import get_current_admin
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.services.credit_service import credit_service
from app.services.llm_service import LLMResponse
from app.services.visual_comprehension import VisualLesson, TutorReply, build_lesson, normalize_image, tutor_turn

logger = logging.getLogger(__name__)
router = APIRouter()


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AnalyzeRequest(BaseModel):
    image: str = Field(min_length=30, max_length=11_200_000)
    prompt: str = Field(min_length=2, max_length=3000)
    history: list[Message] = Field(default_factory=list, max_length=12)
    current_step: str = Field(default="", max_length=4000)


class TurnRequest(BaseModel):
    image: str = Field(min_length=30, max_length=11_200_000)
    context: VisualLesson
    step_index: int = Field(ge=0, le=39)
    completed_steps: int = Field(ge=0, le=40)
    action: Literal["answer", "hint", "simplify", "question"] = "answer"
    message: str = Field(default="", max_length=3000)
    history: list[Message] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def active_step_only(self):
        if self.step_index >= len(self.context.lesson.steps) or self.completed_steps > len(self.context.lesson.steps):
            raise ValueError("Passo non valido")
        if self.step_index > self.completed_steps:
            raise ValueError("Completa prima il passo corrente")
        if self.action != "question" and self.step_index != self.completed_steps:
            raise ValueError("Puoi verificare o scomporre solo il passo attivo")
        if self.action in {"answer", "question"} and not self.message.strip():
            raise ValueError("Scrivi una risposta o una domanda")
        return self


async def _prepare(image_data: str, admin: User):
    try:
        image = await asyncio.to_thread(normalize_image, image_data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    async with AsyncSessionLocal() as db:
        allowed = await credit_service.check_availability(db, admin.tenant_id, estimated_cost=0.05, teacher_id=admin.id)
    if not allowed:
        raise HTTPException(status_code=402, detail="Crediti AI esauriti.")

    async def on_usage(response: LLMResponse, stage: str):
        cost = credit_service.calculate_cost_for_model(
            response.provider, response.model, response.prompt_tokens, response.completion_tokens,
        )
        async with AsyncSessionLocal() as db:
            await credit_service.track_usage(
                db, admin.tenant_id, response.provider, response.model, cost,
                {"type": "visual_comprehension", "stage": stage, "prompt_tokens": response.prompt_tokens,
                 "completion_tokens": response.completion_tokens}, teacher_id=admin.id,
            )
    return image, on_usage


@router.post("/analyze", response_model=VisualLesson)
async def analyze(body: AnalyzeRequest, admin: Annotated[User, Depends(get_current_admin)]):
    image, on_usage = await _prepare(body.image, admin)
    try:
        return await build_lesson(image, body.prompt, [m.model_dump() for m in body.history], body.current_step, on_usage)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="L'analisi ha richiesto troppo tempo. Riprova con un ritaglio più piccolo.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Visual comprehension failed")
        raise HTTPException(status_code=502, detail="Analisi visuale non disponibile. Controlla il modello Vision configurato e riprova.") from exc


@router.post("/interact", response_model=TutorReply)
async def interact(body: TurnRequest, admin: Annotated[User, Depends(get_current_admin)]):
    image, on_usage = await _prepare(body.image, admin)
    try:
        return await tutor_turn(image, body.context, body.step_index, body.completed_steps, body.action,
                                body.message.strip(), [m.model_dump() for m in body.history], on_usage)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="La verifica sta richiedendo troppo tempo. La tua risposta è conservata: riprova.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Visual tutor check failed")
        raise HTTPException(status_code=502, detail="Verifica non disponibile. Riprova: il tuo avanzamento è conservato.") from exc
