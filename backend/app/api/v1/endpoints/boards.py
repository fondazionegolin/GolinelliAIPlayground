from typing import Annotated, Optional
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.core.database import get_db
from app.models.board import Board, BoardCard
from app.models.session import Session, SessionModule
from app.services.llm_service import LLMService

router = APIRouter()

TEMPLATES = [
    {
        "id": "kanban",
        "label": "Kanban",
        "columns": [
            {"id": "todo", "label": "Da fare", "hint": "Task da iniziare", "color": "#64748b"},
            {"id": "doing", "label": "In corso", "hint": "Attività in lavorazione", "color": "#0ea5e9"},
            {"id": "review", "label": "Revisione", "hint": "Controllo e feedback", "color": "#a855f7"},
            {"id": "done", "label": "Fatto", "hint": "Completato", "color": "#10b981"},
        ],
    },
    {
        "id": "swot",
        "label": "SWOT",
        "columns": [
            {"id": "strengths", "label": "Punti di forza", "hint": "Cosa funziona", "color": "#10b981"},
            {"id": "weaknesses", "label": "Debolezze", "hint": "Cosa limita", "color": "#f59e0b"},
            {"id": "opportunities", "label": "Opportunità", "hint": "Cosa sfruttare", "color": "#0ea5e9"},
            {"id": "threats", "label": "Rischi", "hint": "Cosa può bloccare", "color": "#ef4444"},
        ],
    },
    {
        "id": "blank",
        "label": "Personalizzata",
        "columns": [
            {"id": "col_1", "label": "Colonna 1", "hint": "", "color": "#64748b"},
            {"id": "col_2", "label": "Colonna 2", "hint": "", "color": "#0ea5e9"},
        ],
    },
]


class BoardColumn(BaseModel):
    id: str
    label: str
    hint: Optional[str] = ""
    color: Optional[str] = "#64748b"


class BoardCreate(BaseModel):
    title: str
    description: Optional[str] = None
    session_id: Optional[str] = None
    template_key: Optional[str] = "kanban"
    columns: Optional[list[BoardColumn]] = None
    visibility: str = "private"
    students_can_edit: bool = False


class BoardUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    columns: Optional[list[BoardColumn]] = None
    visibility: Optional[str] = None
    students_can_edit: Optional[bool] = None
    coding_project_id: Optional[str] = None


class CardCreate(BaseModel):
    title: str
    description: Optional[str] = None
    column_id: Optional[str] = None
    color: Optional[str] = None


class CardUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    column_id: Optional[str] = None
    color: Optional[str] = None
    coding_project_id: Optional[str] = None
    coding_status: Optional[str] = None
    sort_order: Optional[str] = None


class BoardAiMessage(BaseModel):
    message: str
    history: list[dict] = []
    generate_tasks: bool = False


class BoardBulkCards(BaseModel):
    cards: list[CardCreate]


def _template_columns(key: Optional[str]) -> list[dict]:
    template = next((t for t in TEMPLATES if t["id"] == (key or "kanban")), TEMPLATES[0])
    return template["columns"]


def _normalize_columns(columns: list[dict] | None) -> list[dict]:
    raw = columns or _template_columns("kanban")
    out: list[dict] = []
    seen: set[str] = set()
    for idx, col in enumerate(raw[:12]):
        label = str(col.get("label") or "").strip() or f"Colonna {idx + 1}"
        col_id = str(col.get("id") or "").strip().lower().replace(" ", "_")
        if not col_id or col_id in seen:
            col_id = f"col_{idx + 1}"
        seen.add(col_id)
        out.append({
            "id": col_id[:48],
            "label": label[:80],
            "hint": str(col.get("hint") or "")[:180],
            "color": str(col.get("color") or "#64748b")[:24],
        })
    return out or _template_columns("kanban")


def _actor_name(actor: StudentOrTeacher) -> str:
    if actor.is_student:
        return actor.student.nickname or "Studente"
    user = actor.teacher
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email


async def _student_boards_enabled(db: AsyncSession, actor: StudentOrTeacher) -> bool:
    if not actor.is_student:
        return True
    result = await db.execute(
        select(SessionModule).where(
            SessionModule.session_id == actor.student.session_id,
            SessionModule.module_key == "boards",
            SessionModule.is_enabled == True,
        )
    )
    return result.scalar_one_or_none() is not None


def _can_manage_board(board: Board, actor: StudentOrTeacher) -> bool:
    if actor.is_teacher:
        return board.owner_user_id == actor.teacher.id
    return board.owner_student_id == actor.student.id


def _serialize_board(board: Board, cards: list[BoardCard] | None = None, actor: StudentOrTeacher | None = None) -> dict:
    return {
        "id": str(board.id),
        "tenant_id": str(board.tenant_id),
        "session_id": str(board.session_id) if board.session_id else None,
        "title": board.title,
        "description": board.description,
        "template_key": board.template_key,
        "coding_project_id": str(board.coding_project_id) if board.coding_project_id else None,
        "columns": _normalize_columns(board.columns_json),
        "visibility": board.visibility,
        "students_can_edit": bool(board.students_can_edit),
        "created_by_display_name": board.created_by_display_name,
        "can_manage": _can_manage_board(board, actor) if actor is not None else False,
        "created_at": board.created_at.isoformat(),
        "updated_at": board.updated_at.isoformat(),
        "cards": [_serialize_card(c) for c in cards] if cards is not None else None,
    }


def _serialize_card(card: BoardCard) -> dict:
    return {
        "id": str(card.id),
        "board_id": str(card.board_id),
        "column_id": card.column_id,
        "title": card.title,
        "description": card.description,
        "color": card.color,
        "coding_project_id": str(card.coding_project_id) if card.coding_project_id else None,
        "coding_status": card.coding_status,
        "created_by_display_name": card.created_by_display_name,
        "last_actor_display_name": card.last_actor_display_name,
        "sort_order": card.sort_order,
        "created_at": card.created_at.isoformat(),
        "updated_at": card.updated_at.isoformat(),
    }


async def _get_board_for_actor(db: AsyncSession, board_id: str, actor: StudentOrTeacher) -> Board:
    result = await db.execute(select(Board).where(Board.id == uuid.UUID(board_id)))
    board = result.scalar_one_or_none()
    if not board:
        raise HTTPException(status_code=404, detail="Board non trovata")
    if actor.is_teacher:
        if board.tenant_id != actor.teacher.tenant_id:
            raise HTTPException(status_code=403, detail="Accesso alla board non consentito")
        if board.owner_user_id == actor.teacher.id or board.visibility == "session_shared":
            return board
    else:
        if not await _student_boards_enabled(db, actor):
            raise HTTPException(status_code=403, detail="Modulo board non abilitato")
        if board.tenant_id != actor.student.tenant_id:
            raise HTTPException(status_code=403, detail="Accesso alla board non consentito")
        if board.owner_student_id == actor.student.id:
            return board
        if board.session_id == actor.student.session_id and board.visibility == "session_shared":
            return board
    raise HTTPException(status_code=403, detail="Accesso alla board non consentito")


def _can_edit_board(board: Board, actor: StudentOrTeacher) -> bool:
    if actor.is_teacher:
        return board.owner_user_id == actor.teacher.id
    if board.owner_student_id == actor.student.id:
        return True
    return bool(board.students_can_edit and board.session_id == actor.student.session_id and board.visibility == "session_shared")


@router.get("/templates")
async def templates():
    return TEMPLATES


@router.get("")
async def list_boards(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if actor.is_student and not await _student_boards_enabled(db, actor):
        return []
    if actor.is_teacher:
        result = await db.execute(
            select(Board).where(
                Board.tenant_id == actor.teacher.tenant_id,
                or_(Board.owner_user_id == actor.teacher.id, Board.visibility == "session_shared"),
            ).order_by(Board.updated_at.desc())
        )
    else:
        result = await db.execute(
            select(Board).where(
                Board.tenant_id == actor.student.tenant_id,
                or_(
                    Board.owner_student_id == actor.student.id,
                    (Board.session_id == actor.student.session_id) & (Board.visibility == "session_shared"),
                ),
            ).order_by(Board.updated_at.desc())
        )
    return [_serialize_board(board, actor=actor) for board in result.scalars().all()]


@router.post("", status_code=201)
async def create_board(
    body: BoardCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if actor.is_student and not await _student_boards_enabled(db, actor):
        raise HTTPException(status_code=403, detail="Modulo board non abilitato")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Titolo obbligatorio")
    cols = _normalize_columns([c.dict() for c in body.columns] if body.columns else _template_columns(body.template_key))
    session_id = uuid.UUID(body.session_id) if body.session_id else (actor.student.session_id if actor.is_student else None)
    if session_id is not None:
        tenant_id = actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id
        session_result = await db.execute(select(Session.id).where(Session.id == session_id, Session.tenant_id == tenant_id))
        if session_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=403, detail="Sessione non consentita")
    board = Board(
        tenant_id=actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id,
        session_id=session_id,
        owner_user_id=None if actor.is_student else actor.teacher.id,
        owner_student_id=actor.student.id if actor.is_student else None,
        title=body.title.strip()[:160],
        description=body.description,
        template_key=body.template_key,
        columns_json=cols,
        visibility=body.visibility if body.visibility in ("private", "session_shared") else "private",
        students_can_edit=bool(body.students_can_edit),
        created_by_display_name=_actor_name(actor),
    )
    db.add(board)
    await db.commit()
    await db.refresh(board)
    return _serialize_board(board, [], actor)


@router.get("/{board_id}")
async def get_board(
    board_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board = await _get_board_for_actor(db, board_id, actor)
    result = await db.execute(select(BoardCard).where(BoardCard.board_id == board.id).order_by(BoardCard.created_at))
    return _serialize_board(board, result.scalars().all(), actor)


@router.patch("/{board_id}")
async def update_board(
    board_id: str,
    body: BoardUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board = await _get_board_for_actor(db, board_id, actor)
    if not _can_manage_board(board, actor):
        raise HTTPException(status_code=403, detail="Modifica non consentita")
    if body.title is not None:
        board.title = body.title.strip()[:160] or board.title
    if body.description is not None:
        board.description = body.description
    if body.columns is not None:
        board.columns_json = _normalize_columns([c.dict() for c in body.columns])
    if body.visibility is not None:
        board.visibility = body.visibility if body.visibility in ("private", "session_shared") else board.visibility
    if body.students_can_edit is not None:
        board.students_can_edit = bool(body.students_can_edit)
    if body.coding_project_id is not None:
        board.coding_project_id = uuid.UUID(body.coding_project_id) if body.coding_project_id else None
    await db.commit()
    await db.refresh(board)
    return _serialize_board(board, actor=actor)


@router.delete("/{board_id}", status_code=204)
async def delete_board(
    board_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board = await _get_board_for_actor(db, board_id, actor)
    if not _can_manage_board(board, actor):
        raise HTTPException(status_code=403, detail="Eliminazione non consentita")
    await db.delete(board)
    await db.commit()
    return None


@router.post("/{board_id}/cards", status_code=201)
async def create_card(
    board_id: str,
    body: CardCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor):
        raise HTTPException(status_code=403, detail="Modifica non consentita")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Titolo card obbligatorio")
    columns = _normalize_columns(board.columns_json)
    column_id = body.column_id or columns[0]["id"]
    if column_id not in {c["id"] for c in columns}:
        raise HTTPException(status_code=400, detail="Colonna non valida")
    actor_name = _actor_name(actor)
    card = BoardCard(
        board_id=board.id,
        column_id=column_id,
        title=body.title.strip()[:220],
        description=body.description,
        color=(body.color or None),
        created_by_display_name=actor_name,
        last_actor_display_name=actor_name,
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return _serialize_card(card)


@router.patch("/{board_id}/cards/{card_id}")
async def update_card(
    board_id: str,
    card_id: str,
    body: CardUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor):
        raise HTTPException(status_code=403, detail="Modifica non consentita")
    result = await db.execute(select(BoardCard).where(BoardCard.id == uuid.UUID(card_id), BoardCard.board_id == board.id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card non trovata")
    if body.title is not None:
        card.title = body.title.strip()[:220] or card.title
    if body.description is not None:
        card.description = body.description
    if body.color is not None:
        card.color = body.color[:24] or None
    if body.column_id is not None:
        if body.column_id not in {c["id"] for c in _normalize_columns(board.columns_json)}:
            raise HTTPException(status_code=400, detail="Colonna non valida")
        card.column_id = body.column_id
    if body.coding_project_id is not None:
        card.coding_project_id = uuid.UUID(body.coding_project_id) if body.coding_project_id else None
    if body.coding_status is not None:
        card.coding_status = body.coding_status[:40] or None
    if body.sort_order is not None:
        card.sort_order = body.sort_order
    card.last_actor_display_name = _actor_name(actor)
    await db.commit()
    await db.refresh(card)
    return _serialize_card(card)


@router.post("/{board_id}/cards/bulk", status_code=201)
async def create_cards_bulk(
    board_id: str,
    body: BoardBulkCards,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor):
        raise HTTPException(status_code=403, detail="Modifica non consentita")
    columns = _normalize_columns(board.columns_json)
    valid_columns = {c["id"] for c in columns}
    actor_name = _actor_name(actor)
    created: list[BoardCard] = []
    for item in body.cards[:30]:
        if not item.title.strip():
            continue
        column_id = item.column_id or columns[0]["id"]
        if column_id not in valid_columns:
            column_id = columns[0]["id"]
        card = BoardCard(
            board_id=board.id,
            column_id=column_id,
            title=item.title.strip()[:220],
            description=item.description,
            color=(item.color or None),
            created_by_display_name=actor_name,
            last_actor_display_name=actor_name,
        )
        db.add(card)
        created.append(card)
    await db.commit()
    for card in created:
        await db.refresh(card)
    return [_serialize_card(card) for card in created]


@router.post("/{board_id}/ai/chat")
async def board_ai_chat(
    board_id: str,
    body: BoardAiMessage,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor):
        raise HTTPException(status_code=403, detail="Modifica non consentita")
    columns = _normalize_columns(board.columns_json)
    column_labels = ", ".join([f"{c['id']}={c['label']}" for c in columns])
    system = (
        "Sei un product coach per una classe che deve trasformare un'idea di app in task operativi. "
        "Dialoga in italiano, fai domande concrete se l'idea e' vaga, e quando richiesto genera task piccoli e realizzabili. "
        f"Colonne disponibili: {column_labels}. "
        "Se generi task, rispondi SOLO con JSON valido: "
        "{\"reply\":\"testo breve\", \"tasks\":[{\"title\":\"...\", \"description\":\"...\", \"column_id\":\"...\", \"color\":\"#0ea5e9\"}]}. "
        "Usa colori diversi e leggibili. Se non generi task, usa comunque JSON con tasks vuoto."
    )
    messages = [{"role": "system", "content": system}]
    for item in body.history[-10:]:
        role = "assistant" if item.get("role") == "assistant" else "user"
        content = str(item.get("content") or "")[:2000]
        if content:
            messages.append({"role": role, "content": content})
    suffix = "\n\nGenera ora i task strutturati." if body.generate_tasks else ""
    messages.append({"role": "user", "content": f"{body.message[:4000]}{suffix}"})
    try:
        response = await LLMService().generate(messages=messages, temperature=0.35, max_tokens=1800, allow_web_search=False)
        raw = (response.content or "").strip()
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start:end + 1] if start >= 0 and end >= start else raw)
        tasks = []
        valid_columns = {c["id"] for c in columns}
        for task in (data.get("tasks") or [])[:24]:
            title = str(task.get("title") or "").strip()
            if not title:
                continue
            col = str(task.get("column_id") or columns[0]["id"])
            tasks.append({
                "title": title[:220],
                "description": str(task.get("description") or "")[:2000],
                "column_id": col if col in valid_columns else columns[0]["id"],
                "color": str(task.get("color") or "#0ea5e9")[:24],
            })
        return {"reply": str(data.get("reply") or "Ho preparato una proposta di task."), "tasks": tasks}
    except Exception:
        return {
            "reply": "Ho bisogno di qualche dettaglio in piu': obiettivo dell'app, utenti, dati da gestire e schermate principali.",
            "tasks": [],
        }
