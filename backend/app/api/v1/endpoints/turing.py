import logging
import secrets
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_student, get_current_teacher
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import teacher_can_access_session
from app.models.enums import SessionStatus
from app.models.session import Session, SessionStudent
from app.models.turing import TuringExperiment, TuringMessage, TuringParticipant, TuringTeacherSettings
from app.models.user import User
from app.realtime.gateway import get_online_student_ids, sio
from app.schemas.turing import TuringExperimentCreate, TuringGuessCreate, TuringMessageCreate
from app.services.llm_service import llm_service

router = APIRouter()
logger = logging.getLogger(__name__)
LOBBY, ACTIVE, COMPLETED, CANCELLED, EXCLUDED = "LOBBY", "ACTIVE", "COMPLETED", "CANCELLED", "EXCLUDED"
DEFAULT_PERSONA = ("Rispondo con tono cordiale, diretto e incoraggiante. Preferisco frasi chiare e non troppo lunghe. "
                   "Insegno valorizzando il ragionamento e faccio esempi concreti.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _included(experiment: TuringExperiment) -> list[TuringParticipant]:
    return [item for item in experiment.participants if getattr(item, "status", None) != EXCLUDED]


def _message_payload(message: TuringMessage, *, student_view: bool = False) -> dict:
    role = message.sender_role
    if student_view:
        role = "SELF" if role == "STUDENT" else "INTERLOCUTOR"
    return {"id": str(message.id), "role": role, "text": message.message_text,
            "created_at": message.created_at.isoformat() if message.created_at else _now().isoformat()}


def _settings_payload(source) -> dict:
    return {key: getattr(source, key) for key in
            ("persona_prompt", "temperature", "confidence_style", "response_length", "emoji_usage")}


def _report(experiment: TuringExperiment) -> dict:
    participants = _included(experiment)
    guessed = [p for p in participants if p.guess in {"HUMAN", "AI"}]
    tp = sum(1 for p in guessed if p.is_human and p.guess == "HUMAN")
    fn = sum(1 for p in guessed if p.is_human and p.guess == "AI")
    fp = sum(1 for p in guessed if not p.is_human and p.guess == "HUMAN")
    tn = sum(1 for p in guessed if not p.is_human and p.guess == "AI")
    return {"total_participants": len(participants), "completed_participants": len(guessed),
            "accuracy": round((tp + tn) / len(guessed), 4) if guessed else 0,
            "human_recognized": bool(tp), "false_human_guesses": fp,
            "confusion_matrix": {"human_guessed_human": tp, "human_guessed_ai": fn,
                                 "ai_guessed_human": fp, "ai_guessed_ai": tn},
            "average_confidence": round(sum(p.confidence or 0 for p in guessed) / len(guessed), 2) if guessed else 0}


def _teacher_payload(experiment: TuringExperiment) -> dict:
    participants = _included(experiment)
    human = next((p for p in participants if p.is_human), None)
    completed = experiment.status == COMPLETED
    online_ids = set(get_online_student_ids(str(experiment.session_id)))

    def serialize(p: TuringParticipant) -> dict:
        return {"id": str(p.id), "student_id": str(p.student_id), "nickname": p.student.nickname,
                "status": p.status, "online": str(p.student_id) in online_ids,
                "question_count": p.question_count, "has_guessed": p.guess is not None,
                "guess": p.guess if completed else None, "confidence": p.confidence if completed else None,
                "rationale": p.rationale if completed else None,
                "actual_role": ("HUMAN" if p.is_human else "AI") if experiment.status != LOBBY else None,
                "messages": [_message_payload(m) for m in p.messages]}

    return {"experiment": {"id": str(experiment.id), "session_id": str(experiment.session_id),
                           "title": experiment.title, "status": experiment.status,
                           "max_questions": experiment.max_questions, "participant_count": experiment.participant_count,
                           "started_at": experiment.started_at.isoformat() if experiment.started_at else None,
                           "completed_at": experiment.completed_at.isoformat() if experiment.completed_at else None,
                           **_settings_payload(experiment)},
            "human_participant": serialize(human) if human else None,
            "participants": [serialize(p) for p in participants],
            "report": _report(experiment) if completed else None}


def _student_payload(experiment: TuringExperiment, participant: TuringParticipant) -> dict:
    return {"experiment": {"id": str(experiment.id), "title": experiment.title, "status": experiment.status,
                           "max_questions": experiment.max_questions,
                           "started_at": experiment.started_at.isoformat() if experiment.started_at else None,
                           "completed_at": experiment.completed_at.isoformat() if experiment.completed_at else None},
            "participant": {"id": str(participant.id), "status": getattr(participant, "status", ACTIVE),
                            "question_count": participant.question_count, "guess": participant.guess,
                            "confidence": participant.confidence, "rationale": participant.rationale,
                            "actual_role": ("HUMAN" if participant.is_human else "AI") if experiment.status == COMPLETED else None,
                            "messages": [_message_payload(m, student_view=True) for m in participant.messages]}}


async def _load_experiment(db: AsyncSession, experiment_id: UUID) -> TuringExperiment | None:
    result = await db.execute(select(TuringExperiment).where(TuringExperiment.id == experiment_id).options(
        selectinload(TuringExperiment.participants).selectinload(TuringParticipant.student),
        selectinload(TuringExperiment.participants).selectinload(TuringParticipant.messages)))
    return result.scalar_one_or_none()


async def _teacher_experiment(db: AsyncSession, teacher: User, session_id: UUID, experiment_id: UUID) -> TuringExperiment:
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    experiment = await _load_experiment(db, experiment_id)
    if not experiment or experiment.session_id != session_id or experiment.teacher_id != teacher.id:
        raise HTTPException(status_code=404, detail="Turing test not found")
    return experiment


async def _emit_experiment_update(experiment: TuringExperiment, event_type: str) -> None:
    payload = {"experiment_id": str(experiment.id), "session_id": str(experiment.session_id), "type": event_type}
    await sio.emit("turing_update", payload, room=f"user:{experiment.teacher_id}")
    for participant in experiment.participants:
        await sio.emit("turing_update", payload, room=f"user:{participant.student_id}")


async def _valid_online_students(db: AsyncSession, session_id: UUID) -> list[SessionStudent]:
    ids = []
    for value in get_online_student_ids(str(session_id)):
        try:
            ids.append(UUID(value))
        except ValueError:
            continue
    if not ids:
        return []
    result = await db.execute(select(SessionStudent).where(SessionStudent.session_id == session_id,
                                                            SessionStudent.id.in_(ids)))
    return list(result.scalars().all())


@router.get("/teacher/settings")
async def get_teacher_settings(db: Annotated[AsyncSession, Depends(get_db)],
                               teacher: Annotated[User, Depends(get_current_teacher)]):
    saved = (await db.execute(select(TuringTeacherSettings).where(
        TuringTeacherSettings.teacher_id == teacher.id))).scalar_one_or_none()
    return _settings_payload(saved) if saved else {"persona_prompt": DEFAULT_PERSONA, "temperature": 0.7,
                                                    "confidence_style": 3, "response_length": 2, "emoji_usage": 1}


@router.get("/teacher/sessions/{session_id}/available-students")
async def get_available_students(session_id: UUID, db: Annotated[AsyncSession, Depends(get_db)],
                                 teacher: Annotated[User, Depends(get_current_teacher)]):
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    students = await _valid_online_students(db, session_id)
    return {"count": len(students), "students": [
        {"id": str(student.id), "nickname": student.nickname} for student in students
    ]}


@router.post("/teacher/sessions/{session_id}/experiments")
async def prepare_experiment(session_id: UUID, request: TuringExperimentCreate,
                             db: Annotated[AsyncSession, Depends(get_db)],
                             teacher: Annotated[User, Depends(get_current_teacher)]):
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    session_obj = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one_or_none()
    if not session_obj or session_obj.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="La sessione deve essere attiva")
    existing = (await db.execute(select(TuringExperiment.id).where(
        TuringExperiment.session_id == session_id, TuringExperiment.status.in_([LOBBY, ACTIVE])).limit(1))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Esiste già un Test di Turing in preparazione o attivo")
    students = await _valid_online_students(db, session_id)
    if len(students) < 2:
        raise HTTPException(status_code=409, detail="Servono almeno due studenti connessi")
    values = request.model_dump()
    setting_keys = ("persona_prompt", "temperature", "confidence_style", "response_length", "emoji_usage")
    saved = (await db.execute(select(TuringTeacherSettings).where(
        TuringTeacherSettings.teacher_id == teacher.id))).scalar_one_or_none()
    if saved:
        for key in setting_keys:
            setattr(saved, key, values[key])
    else:
        db.add(TuringTeacherSettings(tenant_id=session_obj.tenant_id, teacher_id=teacher.id,
                                     **{key: values[key] for key in setting_keys}))
    experiment = TuringExperiment(tenant_id=session_obj.tenant_id, session_id=session_id, teacher_id=teacher.id,
                                  title=request.title.strip(), persona_prompt=request.persona_prompt.strip(),
                                  max_questions=request.max_questions, temperature=request.temperature,
                                  confidence_style=request.confidence_style, response_length=request.response_length,
                                  emoji_usage=request.emoji_usage, participant_count=0, status=LOBBY)
    db.add(experiment)
    await db.flush()
    for student in students:
        db.add(TuringParticipant(experiment_id=experiment.id, student_id=student.id,
                                 is_human=False, status="INVITED"))
    await db.commit()
    experiment = await _load_experiment(db, experiment.id)
    await _emit_experiment_update(experiment, "INVITED")
    return _teacher_payload(experiment)


@router.post("/teacher/sessions/{session_id}/experiments/{experiment_id}/reinvite")
async def reinvite_students(session_id: UUID, experiment_id: UUID,
                            db: Annotated[AsyncSession, Depends(get_db)],
                            teacher: Annotated[User, Depends(get_current_teacher)]):
    experiment = await _teacher_experiment(db, teacher, session_id, experiment_id)
    if experiment.status != LOBBY:
        raise HTTPException(status_code=409, detail="La verifica disponibilità è già conclusa")
    existing_ids = {p.student_id for p in experiment.participants}
    for student in await _valid_online_students(db, session_id):
        if student.id not in existing_ids:
            db.add(TuringParticipant(experiment_id=experiment.id, student_id=student.id,
                                     is_human=False, status="INVITED"))
    await db.commit()
    experiment = await _load_experiment(db, experiment.id)
    await _emit_experiment_update(experiment, "INVITED")
    return _teacher_payload(experiment)


@router.post("/teacher/sessions/{session_id}/experiments/{experiment_id}/start")
async def start_prepared_experiment(session_id: UUID, experiment_id: UUID,
                                    db: Annotated[AsyncSession, Depends(get_db)],
                                    teacher: Annotated[User, Depends(get_current_teacher)]):
    experiment = await _teacher_experiment(db, teacher, session_id, experiment_id)
    if experiment.status != LOBBY:
        raise HTTPException(status_code=409, detail="Il test non è in attesa di avvio")
    online_ids = set(get_online_student_ids(str(session_id)))
    ready = [p for p in experiment.participants if p.status == "READY" and str(p.student_id) in online_ids]
    if len(ready) < 2:
        raise HTTPException(status_code=409, detail="Servono almeno due studenti pronti e ancora connessi")
    human = secrets.choice(ready)
    ready_ids = {p.id for p in ready}
    for participant in experiment.participants:
        participant.status = ACTIVE if participant.id in ready_ids else EXCLUDED
        participant.is_human = participant.id == human.id
    experiment.human_student_id, experiment.participant_count = human.student_id, len(ready)
    experiment.status, experiment.started_at = ACTIVE, _now()
    await db.commit()
    experiment = await _load_experiment(db, experiment.id)
    await _emit_experiment_update(experiment, "STARTED")
    return _teacher_payload(experiment)


@router.get("/teacher/sessions/{session_id}/experiments/current")
async def get_current_teacher_experiment(session_id: UUID, db: Annotated[AsyncSession, Depends(get_db)],
                                         teacher: Annotated[User, Depends(get_current_teacher)]):
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    experiment_id = (await db.execute(select(TuringExperiment.id).where(
        TuringExperiment.session_id == session_id, TuringExperiment.teacher_id == teacher.id,
        TuringExperiment.status.in_([LOBBY, ACTIVE])).order_by(TuringExperiment.created_at.desc()).limit(1))).scalar_one_or_none()
    if not experiment_id:
        experiment_id = (await db.execute(select(TuringExperiment.id).where(
            TuringExperiment.session_id == session_id, TuringExperiment.teacher_id == teacher.id,
            TuringExperiment.status == COMPLETED).order_by(TuringExperiment.completed_at.desc()).limit(1))).scalar_one_or_none()
    if not experiment_id:
        return {"active": False}
    experiment = await _load_experiment(db, experiment_id)
    return {"active": experiment.status in {LOBBY, ACTIVE}, **_teacher_payload(experiment)}


@router.get("/teacher/sessions/{session_id}/experiments/{experiment_id}")
async def get_teacher_experiment(session_id: UUID, experiment_id: UUID,
                                 db: Annotated[AsyncSession, Depends(get_db)],
                                 teacher: Annotated[User, Depends(get_current_teacher)]):
    return _teacher_payload(await _teacher_experiment(db, teacher, session_id, experiment_id))


@router.post("/teacher/sessions/{session_id}/experiments/{experiment_id}/participants/{participant_id}/messages")
async def send_teacher_message(session_id: UUID, experiment_id: UUID, participant_id: UUID,
                               request: TuringMessageCreate, db: Annotated[AsyncSession, Depends(get_db)],
                               teacher: Annotated[User, Depends(get_current_teacher)]):
    experiment = await _teacher_experiment(db, teacher, session_id, experiment_id)
    if experiment.status != ACTIVE:
        raise HTTPException(status_code=409, detail="Il test non è attivo")
    participant = next((p for p in experiment.participants if p.id == participant_id), None)
    if not participant or not participant.is_human or participant.status == EXCLUDED:
        raise HTTPException(status_code=404, detail="Questa conversazione è gestita dal chatbot")
    if not participant.messages or participant.messages[-1].sender_role != "STUDENT":
        raise HTTPException(status_code=409, detail="Attendi una domanda dello studente")
    message = TuringMessage(experiment_id=experiment.id, participant_id=participant.id,
                            sender_role="TEACHER", message_text=request.text.strip())
    db.add(message)
    await db.commit()
    await db.refresh(message)
    await sio.emit("turing_message", {"experiment_id": str(experiment.id),
                                      "message": _message_payload(message, student_view=True)},
                   room=f"user:{participant.student_id}")
    await sio.emit("turing_update", {"experiment_id": str(experiment.id), "type": "MESSAGE"},
                   room=f"user:{teacher.id}")
    return _message_payload(message)


@router.post("/teacher/sessions/{session_id}/experiments/{experiment_id}/complete")
async def complete_experiment(session_id: UUID, experiment_id: UUID,
                              db: Annotated[AsyncSession, Depends(get_db)],
                              teacher: Annotated[User, Depends(get_current_teacher)]):
    experiment = await _teacher_experiment(db, teacher, session_id, experiment_id)
    if experiment.status == ACTIVE:
        experiment.status, experiment.completed_at = COMPLETED, _now()
        await db.commit()
        experiment = await _load_experiment(db, experiment.id)
        await _emit_experiment_update(experiment, "COMPLETED")
    return _teacher_payload(experiment)


@router.post("/teacher/sessions/{session_id}/experiments/{experiment_id}/cancel")
async def cancel_experiment(session_id: UUID, experiment_id: UUID,
                            db: Annotated[AsyncSession, Depends(get_db)],
                            teacher: Annotated[User, Depends(get_current_teacher)]):
    experiment = await _teacher_experiment(db, teacher, session_id, experiment_id)
    if experiment.status in {LOBBY, ACTIVE}:
        experiment.status, experiment.completed_at = CANCELLED, _now()
        await db.commit()
        experiment = await _load_experiment(db, experiment.id)
        await _emit_experiment_update(experiment, "CANCELLED")
    return {"status": experiment.status}


async def _student_experiment(db: AsyncSession, student: SessionStudent,
                              experiment_id: UUID) -> tuple[TuringExperiment, TuringParticipant]:
    experiment = await _load_experiment(db, experiment_id)
    if not experiment or experiment.session_id != student.session_id:
        raise HTTPException(status_code=404, detail="Turing test not found")
    participant = next((p for p in experiment.participants if p.student_id == student.id), None)
    if not participant:
        raise HTTPException(status_code=403, detail="Non partecipi a questo test")
    return experiment, participant


@router.get("/student/experiments/current")
async def get_current_student_experiment(db: Annotated[AsyncSession, Depends(get_db)],
                                         student: Annotated[SessionStudent, Depends(get_current_student)]):
    participant = (await db.execute(select(TuringParticipant).join(TuringExperiment).where(
        TuringParticipant.student_id == student.id, TuringParticipant.status != EXCLUDED,
        TuringExperiment.session_id == student.session_id,
        TuringExperiment.status.in_([LOBBY, ACTIVE])).order_by(TuringExperiment.created_at.desc()).limit(1))).scalar_one_or_none()
    if not participant:
        return {"active": False}
    experiment = await _load_experiment(db, participant.experiment_id)
    participant = next(p for p in experiment.participants if p.student_id == student.id)
    return {"active": True, **_student_payload(experiment, participant)}


@router.get("/student/experiments/{experiment_id}")
async def get_student_experiment(experiment_id: UUID, db: Annotated[AsyncSession, Depends(get_db)],
                                 student: Annotated[SessionStudent, Depends(get_current_student)]):
    experiment, participant = await _student_experiment(db, student, experiment_id)
    return _student_payload(experiment, participant)


@router.post("/student/experiments/{experiment_id}/delivered")
async def mark_invitation_delivered(experiment_id: UUID, db: Annotated[AsyncSession, Depends(get_db)],
                                    student: Annotated[SessionStudent, Depends(get_current_student)]):
    experiment, participant = await _student_experiment(db, student, experiment_id)
    if experiment.status == LOBBY and participant.status == "INVITED":
        participant.status = "DELIVERED"
        await db.commit()
        experiment = await _load_experiment(db, experiment.id)
        participant = next(p for p in experiment.participants if p.student_id == student.id)
        await sio.emit("turing_update", {"experiment_id": str(experiment.id), "type": "DELIVERED"},
                       room=f"user:{experiment.teacher_id}")
    return _student_payload(experiment, participant)


@router.post("/student/experiments/{experiment_id}/ready")
async def mark_student_ready(experiment_id: UUID, db: Annotated[AsyncSession, Depends(get_db)],
                             student: Annotated[SessionStudent, Depends(get_current_student)]):
    experiment, participant = await _student_experiment(db, student, experiment_id)
    if experiment.status != LOBBY or participant.status == EXCLUDED:
        raise HTTPException(status_code=409, detail="L'invito non è più attivo")
    participant.status = "READY"
    await db.commit()
    experiment = await _load_experiment(db, experiment.id)
    participant = next(p for p in experiment.participants if p.student_id == student.id)
    await sio.emit("turing_update", {"experiment_id": str(experiment.id), "type": "READY"},
                   room=f"user:{experiment.teacher_id}")
    return _student_payload(experiment, participant)


@router.post("/student/experiments/{experiment_id}/messages")
async def send_student_message(experiment_id: UUID, request: TuringMessageCreate,
                               db: Annotated[AsyncSession, Depends(get_db)],
                               student: Annotated[SessionStudent, Depends(get_current_student)]):
    experiment, participant = await _student_experiment(db, student, experiment_id)
    if experiment.status != ACTIVE or participant.status == EXCLUDED or participant.guess:
        raise HTTPException(status_code=409, detail="Il test non è attivo")
    if participant.question_count >= experiment.max_questions:
        raise HTTPException(status_code=409, detail="Hai già posto tutte le domande")
    if participant.messages and participant.messages[-1].sender_role == "STUDENT":
        raise HTTPException(status_code=409, detail="Attendi la risposta dell’interlocutore")
    question = TuringMessage(experiment_id=experiment.id, participant_id=participant.id,
                             sender_role="STUDENT", message_text=request.text.strip())
    participant.question_count += 1
    db.add(question)
    await db.commit()
    await db.refresh(question)
    await sio.emit("turing_update", {"experiment_id": str(experiment.id), "type": "QUESTION"},
                   room=f"user:{experiment.teacher_id}")
    if participant.is_human:
        await sio.emit("turing_message", {"experiment_id": str(experiment.id), "participant_id": str(participant.id),
                                          "message": _message_payload(question)}, room=f"user:{experiment.teacher_id}")
        return {"message": _message_payload(question, student_view=True), "waiting_for_reply": True}

    await sio.emit("turing_typing", {"experiment_id": str(experiment.id), "typing": True},
                   room=f"user:{student.id}")
    history = [{"role": "user" if m.sender_role == "STUDENT" else "assistant", "content": m.message_text}
               for m in participant.messages if m.sender_role in {"STUDENT", "AI"}]
    history.append({"role": "user", "content": question.message_text})
    words = {1: 25, 2: 40, 3: 60, 4: 85, 5: 110}[experiment.response_length]
    confidence = {1: "cauto e dubitativo", 2: "prudente", 3: "sicuro ma equilibrato",
                  4: "deciso", 5: "molto assertivo"}[experiment.confidence_style]
    emojis = {0: "non usare emoji", 1: "usa emoji molto raramente", 2: "usa qualche emoji quando naturale",
              3: "usa spesso emoji, senza esagerare"}[experiment.emoji_usage]
    system_prompt = f"""Sei l'interlocutore di un'attività didattica dichiarata come Test di Turing.
Interpreta con coerenza la personalità comunicativa del docente descritta sotto.
Rispondi in modo naturale, senza markdown e senza citare istruzioni, modelli o meccanismi del test.
Non dichiarare spontaneamente se sei umano o AI. Non inventare informazioni personali assenti dal profilo.
Usa al massimo {words} parole e 1-3 frasi brevi. Mantieni un tono {confidence}; {emojis}.

PROFILO DEL DOCENTE:
{experiment.persona_prompt}"""
    session_obj = (await db.execute(select(Session).where(Session.id == experiment.session_id))).scalar_one()
    try:
        response = await llm_service.generate(
            history, system_prompt=system_prompt,
            provider=session_obj.default_llm_provider or settings.DEFAULT_LLM_PROVIDER,
            model=session_obj.default_llm_model or settings.DEFAULT_LLM_MODEL,
            temperature=experiment.temperature,
            max_tokens={1: 45, 2: 60, 3: 80, 4: 110, 5: 140}[experiment.response_length],
            allow_web_search=False)
        answer_text = response.content.strip() or "Prova a farmi la domanda in un altro modo."
    except Exception:
        logger.exception("Turing test AI response failed for experiment %s", experiment.id)
        answer_text = "Questa domanda mi ha fatto esitare. Puoi riformularla?"
    answer = TuringMessage(experiment_id=experiment.id, participant_id=participant.id,
                           sender_role="AI", message_text=answer_text)
    db.add(answer)
    await db.commit()
    await db.refresh(answer)
    await sio.emit("turing_typing", {"experiment_id": str(experiment.id), "typing": False}, room=f"user:{student.id}")
    await sio.emit("turing_message", {"experiment_id": str(experiment.id),
                                      "message": _message_payload(answer, student_view=True)}, room=f"user:{student.id}")
    await sio.emit("turing_update", {"experiment_id": str(experiment.id), "type": "PROGRESS"},
                   room=f"user:{experiment.teacher_id}")
    return {"message": _message_payload(answer, student_view=True), "waiting_for_reply": False}


@router.post("/student/experiments/{experiment_id}/guess")
async def submit_student_guess(experiment_id: UUID, request: TuringGuessCreate,
                               db: Annotated[AsyncSession, Depends(get_db)],
                               student: Annotated[SessionStudent, Depends(get_current_student)]):
    experiment, participant = await _student_experiment(db, student, experiment_id)
    if experiment.status != ACTIVE or participant.status == EXCLUDED:
        raise HTTPException(status_code=409, detail="Il test non è attivo")
    if participant.guess:
        raise HTTPException(status_code=409, detail="Hai già inviato la valutazione")
    if participant.question_count < experiment.max_questions:
        raise HTTPException(status_code=409, detail="Completa prima tutte le domande")
    if participant.messages and participant.messages[-1].sender_role == "STUDENT":
        raise HTTPException(status_code=409, detail="Attendi l’ultima risposta")
    participant.guess, participant.confidence = request.guess, request.confidence
    participant.rationale = request.rationale.strip() if request.rationale else None
    participant.status, participant.guessed_at = COMPLETED, _now()
    if all(item.guess is not None for item in _included(experiment)):
        experiment.status, experiment.completed_at = COMPLETED, _now()
    await db.commit()
    experiment = await _load_experiment(db, experiment.id)
    participant = next(p for p in experiment.participants if p.student_id == student.id)
    await _emit_experiment_update(experiment, "COMPLETED" if experiment.status == COMPLETED else "GUESS_SUBMITTED")
    return _student_payload(experiment, participant)
