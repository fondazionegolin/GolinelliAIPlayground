"""Presentation Studio API: outline (LLM) → style (templates) → deterministic render + quality pass.

See app.services.presentation_studio for the workflow rationale.
"""
import asyncio
import json
import logging
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.api.v1.endpoints.llm import _extract_json_object, get_ui_language, safe_track_usage
from app.core.database import AsyncSessionLocal, get_db
from app.models.session import Class, Session
from app.services import background_jobs, model_roles, model_selection
from app.services import presentation_agents as agents
from app.services import presentation_studio as studio
from app.services.credit_service import credit_service
from app.services.education_level import get_school_grade_instruction
from app.services.environmental_impact import enrich_usage_with_environmental_impact
from app.services.llm_service import llm_service
from app.services.presentation_sources import MAX_SOURCE_BYTES, MAX_SOURCE_CHARS, MAX_SLIDES, extract_notes
from app.services.presentation_quality import check_and_fix_slides
from app.services.presentation_themes import FONT_CHOICES, resolve_theme, theme_catalog, theme_from_deck

logger = logging.getLogger(__name__)
router = APIRouter()


class StudioBrief(BaseModel):
    topic: str = Field("", max_length=4000)
    audience: str = Field("", max_length=200)
    goal: str = Field("", max_length=400)
    tone: str = Field("", max_length=200)
    slide_count: int = Field(8, ge=0, le=MAX_SLIDES)  # 0 = the AI decides from the material
    density: Literal["essenziale", "bilanciata", "dettagliata"] = "bilanciata"
    source_text: str = Field("", max_length=MAX_SOURCE_CHARS)


class OutlineRequest(BaseModel):
    brief: StudioBrief
    mode: Literal["create", "revise", "slide"] = "create"
    outline: Optional[dict] = None
    instruction: str = Field("", max_length=2000)
    slide_index: Optional[int] = None
    llm_provider: Optional[str] = Field(None, max_length=20)  # model picked in the Documenti menu (Admin → Modelli)
    llm_model: Optional[str] = Field(None, max_length=120)


class Dims(BaseModel):
    width: float = Field(960, ge=320, le=1920)
    height: float = Field(540, ge=240, le=1440)


class RenderRequest(BaseModel):
    outline: dict
    theme_id: str = "aula"
    options: dict = Field(default_factory=dict)
    format: Literal["16:9", "4:3"] = "16:9"
    dims: Dims = Field(default_factory=Dims)
    slide_indexes: Optional[list[int]] = None


class PreviewRequest(BaseModel):
    outline: dict
    theme_ids: list[str] = Field(default_factory=list, max_length=12)
    options: dict = Field(default_factory=dict)
    dims: Dims = Field(default_factory=Dims)
    slide_indexes: list[int] = Field(default_factory=lambda: [0, 1], max_length=4)


class RethemeRequest(BaseModel):
    slides: list[dict] = Field(max_length=200)
    theme_id: str = "aula"
    options: dict = Field(default_factory=dict)
    dims: Dims = Field(default_factory=Dims)


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=1200)
    deck_title: str = Field("", max_length=200)
    slide_title: str = Field("", max_length=200)
    theme: Optional[dict] = None


class QualityRequest(BaseModel):
    slides: list[dict] = Field(max_length=200)
    theme: Optional[dict] = None
    dims: Dims = Field(default_factory=Dims)
    fix: bool = False


@router.post("/source")
async def import_source(
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    file: UploadFile = File(...),
):
    """Read source notes without invoking a model, creating a document or storing the upload."""
    data = await file.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise HTTPException(413, "Il file supera il limite di 10 MB.")
    filename = (file.filename or "appunti.txt").replace("\\", "/").rsplit("/", 1)[-1]
    try:
        text = await extract_notes(data, filename)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        logger.warning("Presentation source extraction failed: %s", type(exc).__name__)
        raise HTTPException(422, "Non è stato possibile leggere il file. Prova a esportarlo come Markdown o TXT.") from exc
    return {"filename": filename, "text": text, "char_count": len(text), "max_chars": MAX_SOURCE_CHARS}


async def _billing_context(db: AsyncSession, auth: StudentOrTeacher) -> dict:
    if not auth.is_student:
        return {"tenant_id": auth.teacher.tenant_id, "teacher_id": auth.teacher.id, "class_id": None,
                "session_id": None, "student_id": None, "school_grade": None}
    context = {"tenant_id": auth.student.tenant_id, "teacher_id": None, "class_id": None,
               "session_id": auth.student.session_id, "student_id": auth.student.id, "school_grade": None}
    row = (await db.execute(
        select(Session, Class).join(Class, Session.class_id == Class.id).where(Session.id == auth.student.session_id)
    )).first()
    if row:
        session_obj, class_obj = row
        context.update(teacher_id=class_obj.teacher_id, class_id=class_obj.id, session_id=session_obj.id,
                       school_grade=class_obj.school_grade)
    return context


def _outline_slide_count(outline: Optional[dict]) -> int:
    return len(outline.get("slides") or []) if isinstance(outline, dict) else 0


@router.get("/templates")
async def list_templates(auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    return {
        "themes": theme_catalog(),
        "layouts": studio.layout_catalog(),
        "fonts": [key for key in FONT_CHOICES],
        "densities": {key: {"max_points": rule["max_points"], "max_words": rule["max_words"], "label": rule["label"]}
                      for key, rule in studio.DENSITY_RULES.items()},
    }


@router.post("/outline")
async def generate_outline(
    payload: OutlineRequest,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Write (mode=create), revise (mode=revise) or rewrite one slide of (mode=slide) the outline."""
    brief = payload.brief.model_dump()
    language = get_ui_language(http_request)
    billing = await _billing_context(db, auth)
    if not await credit_service.check_availability(
        db, billing["tenant_id"], 0.002, billing["teacher_id"], billing["class_id"], billing["session_id"], billing["student_id"]
    ):
        raise HTTPException(status_code=402, detail="Credit limit exceeded")

    grade_instruction = get_school_grade_instruction(billing["school_grade"]) if billing["school_grade"] else ""
    previous = studio.normalize_outline(payload.outline, brief["density"]) if _outline_slide_count(payload.outline) else None
    if payload.mode != "create" and not previous:
        raise HTTPException(status_code=400, detail="Serve la scaletta da modificare")
    if payload.mode == "slide" and (payload.slide_index is None or not 0 <= payload.slide_index < len(previous["slides"])):
        raise HTTPException(status_code=400, detail="Slide non valida")
    if payload.mode == "revise" and not payload.instruction.strip():
        raise HTTPException(status_code=400, detail="Scrivi cosa vuoi cambiare nella scaletta")

    if payload.mode == "create":
        prompt = studio.build_outline_prompt(brief, language, grade_instruction)
        max_tokens = 9000
    elif payload.mode == "revise":
        prompt = studio.build_revise_prompt(brief, previous, payload.instruction.strip(), language, grade_instruction)
        max_tokens = 9000
    else:
        prompt = studio.build_slide_prompt(brief, previous, payload.slide_index, payload.instruction.strip(), language, grade_instruction)
        max_tokens = 1800

    provider, model = await model_selection.resolve_scoped(db, "documents", payload.llm_provider, payload.llm_model)
    responses = []
    parsed: Optional[dict] = None
    last_error: Optional[Exception] = None
    if payload.mode == "create":
        usage = agents.UsageLog()

        async def generate(prompt, system, tokens, temperature):
            return await llm_service.generate(
                messages=[{"role": "user", "content": prompt}], system_prompt=system,
                provider=provider, model=model, temperature=temperature, max_tokens=tokens, allow_web_search=False,
            )

        try:
            async for event in agents.run_create_pipeline(brief, language, generate, usage, grade_instruction):
                if event["type"] == "done":
                    parsed = event["outline"]
        except Exception as exc:
            last_error = exc
        responses.extend(usage.responses)
    messages = [{"role": "user", "content": prompt}]
    for attempt in range(0 if payload.mode == "create" else 2):
        try:
            response = await llm_service.generate(
                messages=messages,
                system_prompt=studio.OUTLINE_SYSTEM_PROMPT,
                provider=provider,
                model=model,
                temperature=0.5 if attempt == 0 else 0.2,
                max_tokens=min(32000, max_tokens * (attempt + 1)),
                allow_web_search=False,
            )
            responses.append(response)
            candidate = _extract_json_object(response.content)
            if payload.mode == "slide":
                parsed = {**previous, "slides": [
                    studio.normalize_slide(candidate, brief["density"], keep_id=slide["id"]) if index == payload.slide_index else slide
                    for index, slide in enumerate(previous["slides"])
                ]}
            else:
                parsed = studio.normalize_outline(candidate, brief["density"], previous)
            break
        except Exception as exc:  # unparsable / empty: one stricter retry
            last_error = exc
            logger.warning("Presentation outline attempt %s failed: %s", attempt + 1, exc)
            messages = [{"role": "user", "content": prompt + "\n\nIMPORTANTE: rispondi esclusivamente con JSON valido e completo, senza testo prima o dopo."}]

    if responses:
        prompt_tokens = sum(r.prompt_tokens for r in responses)
        completion_tokens = sum(r.completion_tokens for r in responses)
        real_provider = responses[-1].provider or provider
        real_model = responses[-1].model or model
        await safe_track_usage(
            db, billing["tenant_id"], real_provider, real_model,
            credit_service.calculate_cost_for_model(real_provider, real_model, prompt_tokens, completion_tokens),
            enrich_usage_with_environmental_impact({
                "type": "presentation_outline",
                "mode": payload.mode,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            }, provider=real_provider, model=real_model),
            billing["teacher_id"], billing["class_id"], billing["session_id"], billing["student_id"],
            context="presentation_outline",
        )
    if parsed is None:
        logger.error("Presentation outline failed: %s", last_error)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Non è stato possibile completare la scaletta. I materiali sono conservati: riprova la generazione.")
    return parsed


def _outline_stream_progress(event: dict, state: background_jobs.ProgressState) -> None:
    if isinstance(event.get("progress"), (int, float)):
        state.progress = float(event["progress"])
    if event.get("label"):
        state.label = str(event["label"])
    if event.get("type") == "error":
        state.label = str(event.get("detail") or "Errore")[:200]


@router.post("/outline-stream")
async def stream_outline(
    payload: OutlineRequest,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Multi-agent outline (mode=create) or whole-outline revision (mode=revise), streamed as NDJSON.

    Runs as a background job so it survives page changes, and keeps bytes flowing so proxies
    (Cloudflare 524 after ~100 s of silence) never cut long-document generations.
    Events: phase / plan / slide / done / error (see app.services.presentation_agents).
    """
    if payload.mode == "slide":
        raise HTTPException(status_code=400, detail="Usa /outline per riscrivere una sola slide")
    brief = payload.brief.model_dump()
    language = get_ui_language(http_request)
    billing = await _billing_context(db, auth)
    if not await credit_service.check_availability(
        db, billing["tenant_id"], 0.01, billing["teacher_id"], billing["class_id"], billing["session_id"], billing["student_id"]
    ):
        raise HTTPException(status_code=402, detail="Credit limit exceeded")
    grade_instruction = get_school_grade_instruction(billing["school_grade"]) if billing["school_grade"] else ""
    previous = None
    if payload.mode == "revise":
        previous = studio.normalize_outline(payload.outline, brief["density"]) if _outline_slide_count(payload.outline) else None
        if not previous:
            raise HTTPException(status_code=400, detail="Serve la scaletta da modificare")
        if not payload.instruction.strip():
            raise HTTPException(status_code=400, detail="Scrivi cosa vuoi cambiare nella scaletta")
    elif not brief["topic"].strip() and not brief["source_text"].strip():
        raise HTTPException(status_code=400, detail="Descrivi l'argomento o incolla il materiale")
    provider, model = await model_selection.resolve_scoped(db, "documents", payload.llm_provider, payload.llm_model)

    usage = agents.UsageLog()

    async def generate(prompt: str, system: str, max_tokens: int, temperature: float):
        return await llm_service.generate(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=system,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            allow_web_search=False,
        )

    async def bill() -> None:
        if not usage.responses:
            return
        real_provider = usage.responses[-1].provider or provider
        real_model = usage.responses[-1].model or model
        try:
            async with AsyncSessionLocal() as session:
                await safe_track_usage(
                    session, billing["tenant_id"], real_provider, real_model,
                    credit_service.calculate_cost_for_model(real_provider, real_model, usage.prompt_tokens, usage.completion_tokens),
                    enrich_usage_with_environmental_impact({
                        "type": "presentation_outline",
                        "mode": payload.mode,
                        "calls": len(usage.responses),
                        "prompt_tokens": usage.prompt_tokens,
                        "completion_tokens": usage.completion_tokens,
                        "total_tokens": usage.prompt_tokens + usage.completion_tokens,
                    }, provider=real_provider, model=real_model),
                    billing["teacher_id"], billing["class_id"], billing["session_id"], billing["student_id"],
                    context="presentation_outline",
                )
        except Exception:
            logger.exception("Presentation outline: usage tracking failed")

    async def stream():
        try:
            if payload.mode == "create":
                events = agents.run_create_pipeline(brief, language, generate, usage, grade_instruction)
            else:
                events = agents.run_revise(brief, previous, payload.instruction.strip(), language, generate, usage, grade_instruction)
            async for event in events:
                yield agents.event_line(event)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Presentation outline pipeline failed: %s", exc)
            yield agents.event_line({
                "type": "error",
                "detail": "Non è stato possibile completare la scaletta. I materiali sono conservati: riprova la generazione.",
            })
        finally:
            await asyncio.shield(bill())

    topic = (brief["topic"] or brief["source_text"]).strip()
    job_id = await background_jobs.start_stream_job(
        background_jobs.JobOwner.from_actor(auth),
        kind="presentation_outline",
        title="Presentazione con l'AI" if payload.mode == "create" else "Revisione della scaletta",
        description=topic[:300],
        route="module:documents" if auth.is_student else "/teacher/documents",
        stream=stream(),
        event_format="ndjson",
        progress_fn=_outline_stream_progress,
        expected_seconds=120.0 if len(brief["source_text"]) > 8000 else 60.0,
    )
    return background_jobs.stream_response(job_id, "application/x-ndjson")


@router.post("/preview")
async def preview_templates(payload: PreviewRequest, auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    """Deterministic, free: render a few outline slides with several themes for the template gallery."""
    if not _outline_slide_count(payload.outline):
        raise HTTPException(status_code=400, detail="Scaletta vuota")
    outline = studio.normalize_outline(payload.outline, "dettagliata", payload.outline)
    theme_ids = payload.theme_ids or [t["id"] for t in theme_catalog()]
    previews = {}
    for theme_id in theme_ids:
        rendered = studio.render_outline(outline, theme_id, payload.options, payload.dims.width, payload.dims.height, payload.slide_indexes)
        previews[rendered["theme"]["id"]] = rendered["slides"]
    return {"previews": previews}


@router.post("/render")
async def render_presentation(payload: RenderRequest, auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    """Deterministic, free: the approved outline + chosen theme → editable deck + quality report."""
    if not _outline_slide_count(payload.outline):
        raise HTTPException(status_code=400, detail="Scaletta vuota")
    # "dettagliata" = most permissive limits: the user already approved this text, don't trim it.
    outline = studio.normalize_outline(payload.outline, "dettagliata", payload.outline)
    rendered = studio.render_outline(outline, payload.theme_id, payload.options, payload.dims.width, payload.dims.height,
                                     payload.slide_indexes)
    return {**rendered, "format": payload.format}


@router.post("/quality")
async def check_quality(payload: QualityRequest, auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    """Run the slide quality pass on arbitrary slides (optionally fixing them)."""
    slides = json.loads(json.dumps(payload.slides))  # deep copy: never mutate the request model
    issues = check_and_fix_slides(slides, payload.dims.width, payload.dims.height, theme_from_deck(payload.theme), fix=payload.fix)
    return {"issues": issues, "slides": slides if payload.fix else None}


@router.post("/retheme")
async def retheme_presentation(payload: RethemeRequest, auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    """Deterministic, free: apply another theme (or theme options) to an existing deck."""
    theme = resolve_theme(payload.theme_id, payload.options)
    slides, issues = studio.apply_theme(payload.slides, theme, payload.dims.width, payload.dims.height)
    return {"theme": {"id": theme["id"], "options": theme["options"]}, "resolved_theme": theme, "slides": slides, "quality": issues}


@router.post("/images")
async def generate_slide_image(
    payload: ImageRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """One contextual illustration for a slide image slot, in a style consistent with the deck theme."""
    billing = await _billing_context(db, auth)
    if not await credit_service.check_availability(
        db, billing["tenant_id"], 0.02, billing["teacher_id"], billing["class_id"], billing["session_id"], billing["student_id"]
    ):
        raise HTTPException(status_code=402, detail="Credit limit exceeded")
    prompt = studio.slide_image_prompt(payload.prompt, payload.deck_title, payload.slide_title, theme_from_deck(payload.theme))
    provider, model = model_roles.pair_for("image.generation")
    try:
        image_url = await llm_service.generate_image(prompt, provider=model)
    except Exception as exc:
        logger.warning("Slide image generation failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Immagine non generata: riprova.")
    cost = credit_service.calculate_cost_for_model(provider, model, 0, 0, image_count=1)
    await safe_track_usage(
        db, billing["tenant_id"], provider, model, cost,
        enrich_usage_with_environmental_impact({"type": "presentation_image", "prompt": payload.prompt, "image_count": 1},
                                               provider=provider, model=model),
        billing["teacher_id"], billing["class_id"], billing["session_id"], billing["student_id"],
        context="presentation_image",
    )
    return {"url": image_url}
