from typing import Annotated, Optional
from datetime import date, timedelta
import json
import logging
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.api.v1.endpoints.llm import safe_track_usage
from app.core.database import AsyncSessionLocal, get_db
from app.core.permissions import teacher_can_access_session
from app.models.board import Board, BoardCard, BoardShare
from app.models.enums import UserRole
from app.models.invitation import ClassTeacher, SessionTeacher
from app.models.session import Class, Session, SessionModule, SessionStudent
from app.models.user import User
from app.realtime.gateway import sio
from app.services import background_jobs
from app.services.credit_service import credit_service
from app.services.document_processor import DocumentProcessor
from app.services.json_extract import extract_json
from app.services.llm_service import LLMService

logger = logging.getLogger(__name__)

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
        "id": "scrum",
        "label": "Scrum / Agile",
        "columns": [
            {"id": "backlog", "label": "Product backlog", "hint": "Epic e user story da pianificare", "color": "#64748b"},
            {"id": "sprint", "label": "Sprint backlog", "hint": "Impegni dello sprint corrente", "color": "#6366f1"},
            {"id": "doing", "label": "In corso", "hint": "Attività in lavorazione", "color": "#0ea5e9"},
            {"id": "review", "label": "Review", "hint": "Verifica dei criteri di accettazione", "color": "#a855f7"},
            {"id": "done", "label": "Fatto", "hint": "Definition of done soddisfatta", "color": "#10b981"},
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

FRAMEWORKS = ("scrum", "kanban")
LABEL_COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#14b8a6", "#6366f1", "#84cc16", "#64748b"]
PRIORITIES = ("alta", "media", "bassa")
CARD_TYPES = ("epic", "story", "task")
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_SOURCE_CHARS = 24000
MAX_GENERATED_ITEMS = 60


class BoardColumn(BaseModel):
    id: str
    label: str
    hint: Optional[str] = ""
    color: Optional[str] = "#64748b"


class BoardLabel(BaseModel):
    id: Optional[str] = None
    name: str
    color: Optional[str] = None


class BoardSprint(BaseModel):
    id: Optional[str] = None
    name: str
    goal: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class Assignee(BaseModel):
    kind: str  # teacher|student
    id: str


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
    labels: Optional[list[BoardLabel]] = None
    sprints: Optional[list[BoardSprint]] = None
    visibility: Optional[str] = None
    students_can_edit: Optional[bool] = None
    session_id: Optional[str] = None
    coding_project_id: Optional[str] = None
    move_cards_from_column_id: Optional[str] = None
    move_cards_to_column_id: Optional[str] = None


class CardCreate(BaseModel):
    title: str
    description: Optional[str] = None
    column_id: Optional[str] = None
    color: Optional[str] = None
    labels: Optional[list[str]] = None
    assignees: Optional[list[Assignee]] = None
    priority: Optional[str] = None
    story_points: Optional[int] = None
    card_type: Optional[str] = None
    sprint_id: Optional[str] = None


class CardUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    column_id: Optional[str] = None
    color: Optional[str] = None
    coding_project_id: Optional[str] = None
    coding_status: Optional[str] = None
    sort_order: Optional[str] = None
    labels: Optional[list[str]] = None
    assignees: Optional[list[Assignee]] = None
    priority: Optional[str] = None
    story_points: Optional[int] = None
    card_type: Optional[str] = None
    sprint_id: Optional[str] = None


class BoardAiMessage(BaseModel):
    message: str
    history: list[dict] = []
    generate_tasks: bool = False


class BoardBulkCards(BaseModel):
    cards: list[CardCreate]


class ShareTarget(BaseModel):
    id: str
    can_edit: bool = True


class BoardSharesUpdate(BaseModel):
    teachers: list[ShareTarget] = []
    students: list[ShareTarget] = []


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


def _normalize_labels(labels: list[dict] | None) -> list[dict]:
    out: list[dict] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for idx, label in enumerate((labels or [])[:20]):
        name = str(label.get("name") or "").strip()[:40]
        if not name or name.lower() in seen_names:
            continue
        label_id = str(label.get("id") or "").strip()[:48] or f"lbl_{uuid.uuid4().hex[:8]}"
        if label_id in seen_ids:
            label_id = f"lbl_{uuid.uuid4().hex[:8]}"
        color = str(label.get("color") or "")
        seen_ids.add(label_id)
        seen_names.add(name.lower())
        out.append({
            "id": label_id,
            "name": name,
            "color": color if HEX_COLOR.match(color) else LABEL_COLORS[idx % len(LABEL_COLORS)],
        })
    return out


ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _normalize_sprints(sprints: list[dict] | None) -> list[dict]:
    out: list[dict] = []
    seen_ids: set[str] = set()
    for idx, sprint in enumerate((sprints or [])[:24]):
        name = str(sprint.get("name") or "").strip()[:60] or f"Sprint {idx + 1}"
        sprint_id = str(sprint.get("id") or "").strip()[:48] or f"spr_{uuid.uuid4().hex[:8]}"
        if sprint_id in seen_ids:
            sprint_id = f"spr_{uuid.uuid4().hex[:8]}"
        seen_ids.add(sprint_id)
        start, end = str(sprint.get("start_date") or ""), str(sprint.get("end_date") or "")
        out.append({
            "id": sprint_id,
            "name": name,
            "goal": str(sprint.get("goal") or "").strip()[:300],
            "start_date": start if ISO_DATE.match(start) else None,
            "end_date": end if ISO_DATE.match(end) else None,
        })
    return out


def _clean_sprint_id(board: Board, sprint_id: Optional[str]) -> Optional[str]:
    if not sprint_id:
        return None
    if sprint_id not in {sprint["id"] for sprint in _normalize_sprints(board.sprints_json)}:
        raise HTTPException(status_code=400, detail="Sprint non valido")
    return sprint_id


def _actor_name(actor: StudentOrTeacher) -> str:
    if actor.is_student:
        return actor.student.nickname or "Studente"
    return _user_name(actor.teacher)


def _user_name(user: User) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email


def _actor_tenant_id(actor: StudentOrTeacher) -> uuid.UUID:
    return actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id


def _parse_uuid(value: str, detail: str = "Identificativo non valido") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise HTTPException(status_code=400, detail=detail)


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


def _can_edit_board(board: Board, actor: StudentOrTeacher, share: Optional[BoardShare] = None) -> bool:
    if _can_manage_board(board, actor):
        return True
    if share is not None and share.can_edit:
        return True
    if actor.is_teacher:
        # Teachers reach a non-owned board only via a share or session_shared + session access.
        return board.visibility == "session_shared"
    return bool(board.students_can_edit and board.session_id == actor.student.session_id and board.visibility == "session_shared")


def _serialize_board(
    board: Board,
    cards: list[BoardCard] | None = None,
    actor: StudentOrTeacher | None = None,
    share: Optional[BoardShare] = None,
    session_title: Optional[str] = None,
) -> dict:
    return {
        "id": str(board.id),
        "tenant_id": str(board.tenant_id),
        "session_id": str(board.session_id) if board.session_id else None,
        "session_title": session_title,
        "title": board.title,
        "description": board.description,
        "template_key": board.template_key,
        "framework": board.framework,
        "coding_project_id": str(board.coding_project_id) if board.coding_project_id else None,
        "columns": _normalize_columns(board.columns_json),
        "labels": _normalize_labels(board.labels_json),
        "sprints": _normalize_sprints(board.sprints_json),
        "visibility": board.visibility,
        "students_can_edit": bool(board.students_can_edit),
        "created_by_display_name": board.created_by_display_name,
        "shared_with_me": share is not None,
        "me": ({"kind": "student", "id": str(actor.student.id)} if actor.is_student else {"kind": "teacher", "id": str(actor.teacher.id)}) if actor is not None else None,
        "can_manage": _can_manage_board(board, actor) if actor is not None else False,
        "can_edit": _can_edit_board(board, actor, share) if actor is not None else False,
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
        "labels": list(card.labels or []),
        "assignees": list(card.assignees or []),
        "card_type": card.card_type,
        "priority": card.priority,
        "story_points": card.story_points,
        "sprint_id": card.sprint_id,
        "parent_card_id": str(card.parent_card_id) if card.parent_card_id else None,
        "coding_project_id": str(card.coding_project_id) if card.coding_project_id else None,
        "coding_status": card.coding_status,
        "created_by_display_name": card.created_by_display_name,
        "last_actor_display_name": card.last_actor_display_name,
        "sort_order": card.sort_order,
        "created_at": card.created_at.isoformat(),
        "updated_at": card.updated_at.isoformat(),
    }


async def _actor_share(db: AsyncSession, board_id: uuid.UUID, actor: StudentOrTeacher) -> Optional[BoardShare]:
    condition = BoardShare.user_id == actor.teacher.id if actor.is_teacher else BoardShare.student_id == actor.student.id
    result = await db.execute(select(BoardShare).where(BoardShare.board_id == board_id, condition))
    return result.scalar_one_or_none()


async def _get_board_for_actor(db: AsyncSession, board_id: str, actor: StudentOrTeacher) -> tuple[Board, Optional[BoardShare]]:
    result = await db.execute(select(Board).where(Board.id == _parse_uuid(board_id, "Board non valida")))
    board = result.scalar_one_or_none()
    if not board:
        raise HTTPException(status_code=404, detail="Board non trovata")
    if board.tenant_id != _actor_tenant_id(actor):
        raise HTTPException(status_code=403, detail="Accesso alla board non consentito")
    if _can_manage_board(board, actor):
        if actor.is_student and not await _student_boards_enabled(db, actor):
            raise HTTPException(status_code=403, detail="Modulo board non abilitato")
        return board, None
    share = await _actor_share(db, board.id, actor)
    if share is not None:
        return board, share
    if board.visibility == "session_shared" and board.session_id is not None:
        if actor.is_teacher and await teacher_can_access_session(db, actor.teacher, board.session_id):
            return board, None
        if actor.is_student and board.session_id == actor.student.session_id:
            return board, None
    raise HTTPException(status_code=403, detail="Accesso alla board non consentito")


async def _session_titles(db: AsyncSession, session_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not session_ids:
        return {}
    result = await db.execute(select(Session.id, Session.title).where(Session.id.in_(session_ids)))
    return {row[0]: row[1] for row in result.all()}


async def _session_teacher_ids(db: AsyncSession, session_id: uuid.UUID) -> set[uuid.UUID]:
    ids: set[uuid.UUID] = set()
    result = await db.execute(select(Session.class_id, Class.teacher_id).join(Class, Class.id == Session.class_id).where(Session.id == session_id))
    row = result.first()
    if not row:
        return ids
    ids.add(row[1])
    ids.update(r[0] for r in (await db.execute(select(ClassTeacher.teacher_id).where(ClassTeacher.class_id == row[0]))).all())
    ids.update(r[0] for r in (await db.execute(select(SessionTeacher.teacher_id).where(SessionTeacher.session_id == session_id))).all())
    return ids


async def _board_members(db: AsyncSession, board: Board) -> list[dict]:
    """People who can see the board, i.e. who a task can be assigned to."""
    shares = (await db.execute(select(BoardShare).where(BoardShare.board_id == board.id))).scalars().all()
    teacher_ids = {s.user_id for s in shares if s.user_id}
    student_ids = {s.student_id for s in shares if s.student_id}
    if board.owner_user_id:
        teacher_ids.add(board.owner_user_id)
    if board.owner_student_id:
        student_ids.add(board.owner_student_id)
    students: list[SessionStudent] = []
    if board.session_id and board.visibility == "session_shared":
        teacher_ids |= await _session_teacher_ids(db, board.session_id)
        students = list((await db.execute(
            select(SessionStudent).where(SessionStudent.session_id == board.session_id).order_by(SessionStudent.nickname)
        )).scalars().all())
    elif student_ids:
        students = list((await db.execute(
            select(SessionStudent).where(SessionStudent.id.in_(student_ids)).order_by(SessionStudent.nickname)
        )).scalars().all())
    teachers = list((await db.execute(
        select(User).where(User.id.in_(teacher_ids)).order_by(User.first_name, User.last_name)
    )).scalars().all()) if teacher_ids else []
    return (
        [{"kind": "teacher", "id": str(u.id), "name": _user_name(u)} for u in teachers]
        + [{"kind": "student", "id": str(s.id), "name": s.nickname} for s in students]
    )


async def _validate_assignees(db: AsyncSession, board: Board, assignees: list[Assignee]) -> list[dict]:
    if not assignees:
        return []
    members = {(m["kind"], m["id"]): m for m in await _board_members(db, board)}
    out: list[dict] = []
    for item in assignees[:12]:
        member = members.get((item.kind, item.id))
        if member is None:
            raise HTTPException(status_code=400, detail="Assegnatario non valido per questa board")
        if member not in out:
            out.append(member)
    return out


def _clean_card_labels(board: Board, labels: Optional[list[str]]) -> list[str]:
    valid = {label["id"] for label in _normalize_labels(board.labels_json)}
    return [label_id for label_id in dict.fromkeys(labels or []) if label_id in valid][:6]


def _clean_priority(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip().lower()
    return value if value in PRIORITIES else None


def _clean_card_type(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip().lower()
    return value if value in CARD_TYPES else None


def _clean_points(value) -> Optional[int]:
    try:
        points = int(value)
    except (TypeError, ValueError):
        return None
    return points if 0 < points <= 100 else None


def _credit_scope(actor: StudentOrTeacher) -> dict:
    if actor.is_student:
        return {"session_id": actor.student.session_id, "student_id": actor.student.id}
    return {"teacher_id": actor.teacher.id}


async def _require_credits(db: AsyncSession, actor: StudentOrTeacher, estimated_cost: float) -> None:
    if not await credit_service.check_availability(db, _actor_tenant_id(actor), estimated_cost=estimated_cost, **_credit_scope(actor)):
        raise HTTPException(status_code=402, detail="Crediti AI esauriti. Attendi il rinnovo del plafond.")


async def _track_llm_usage(db: AsyncSession, actor: StudentOrTeacher, response, usage_type: str, board_id: Optional[uuid.UUID] = None) -> None:
    cost = credit_service.calculate_cost_for_model(response.provider, response.model, response.prompt_tokens, response.completion_tokens)
    await safe_track_usage(
        db, _actor_tenant_id(actor), response.provider, response.model, cost,
        {"type": usage_type, "board_id": str(board_id) if board_id else None},
        **_credit_scope(actor),
        context=usage_type,
    )


async def _notify_board_shared(board: Board) -> None:
    if board.session_id is not None and board.visibility == "session_shared":
        await sio.emit("board_shared", {"board_id": str(board.id), "title": board.title}, room=f"session:{board.session_id}")


@router.get("/templates")
async def templates():
    return TEMPLATES


@router.get("")
async def list_boards(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    session_id: Optional[str] = None,
):
    shared_rows = await db.execute(
        select(Board, BoardShare)
        .join(BoardShare, BoardShare.board_id == Board.id)
        .where(
            Board.tenant_id == _actor_tenant_id(actor),
            BoardShare.user_id == actor.teacher.id if actor.is_teacher else BoardShare.student_id == actor.student.id,
        )
    )
    shared = {board.id: (board, share) for board, share in shared_rows.all()}

    if actor.is_teacher:
        conditions = [Board.owner_user_id == actor.teacher.id]
        if session_id:
            requested_session_id = _parse_uuid(session_id, "Sessione non valida")
            if not await teacher_can_access_session(db, actor.teacher, requested_session_id):
                raise HTTPException(status_code=403, detail="Sessione non consentita")
            conditions.append((Board.session_id == requested_session_id) & (Board.visibility == "session_shared"))
        result = await db.execute(select(Board).where(Board.tenant_id == actor.teacher.tenant_id, or_(*conditions)))
    else:
        boards_enabled = await _student_boards_enabled(db, actor)
        session_shared = (Board.session_id == actor.student.session_id) & (Board.visibility == "session_shared")
        result = await db.execute(
            select(Board).where(
                Board.tenant_id == actor.student.tenant_id,
                or_(Board.owner_student_id == actor.student.id, session_shared) if boards_enabled else session_shared,
            )
        )
    boards: dict[uuid.UUID, tuple[Board, Optional[BoardShare]]] = {b.id: (b, None) for b in result.scalars().all()}
    for board_id, pair in shared.items():
        boards.setdefault(board_id, pair)
    ordered = sorted(boards.values(), key=lambda pair: pair[0].updated_at, reverse=True)
    titles = await _session_titles(db, {b.session_id for b, _ in ordered if b.session_id})
    return [_serialize_board(b, actor=actor, share=s, session_title=titles.get(b.session_id)) for b, s in ordered]


async def _resolve_create_session(db: AsyncSession, actor: StudentOrTeacher, session_id: Optional[str]) -> Optional[uuid.UUID]:
    if actor.is_student:
        if session_id and _parse_uuid(session_id, "Sessione non valida") != actor.student.session_id:
            raise HTTPException(status_code=403, detail="Sessione non consentita")
        return actor.student.session_id
    if not session_id:
        return None
    resolved = _parse_uuid(session_id, "Sessione non valida")
    if not await teacher_can_access_session(db, actor.teacher, resolved):
        raise HTTPException(status_code=403, detail="Sessione non consentita")
    return resolved


def _new_board(actor: StudentOrTeacher, session_id: Optional[uuid.UUID], **fields) -> Board:
    return Board(
        tenant_id=_actor_tenant_id(actor),
        session_id=session_id,
        owner_user_id=None if actor.is_student else actor.teacher.id,
        owner_student_id=actor.student.id if actor.is_student else None,
        created_by_display_name=_actor_name(actor),
        **fields,
    )


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
    session_id = await _resolve_create_session(db, actor, body.session_id)
    visibility = body.visibility if body.visibility in ("private", "session_shared") else "private"
    if session_id is None:
        visibility = "private"
    board = _new_board(
        actor,
        session_id,
        title=body.title.strip()[:160],
        description=body.description,
        template_key=body.template_key,
        framework=body.template_key if body.template_key in FRAMEWORKS else None,
        columns_json=cols,
        labels_json=[],
        sprints_json=[{"id": "spr_1", "name": "Sprint 1", "goal": "", "start_date": None, "end_date": None}] if body.template_key == "scrum" else [],
        visibility=visibility,
        students_can_edit=bool(body.students_can_edit),
    )
    db.add(board)
    await db.commit()
    await db.refresh(board)
    if actor.is_teacher:
        await _notify_board_shared(board)
    return _serialize_board(board, [], actor)


@router.get("/{board_id}")
async def get_board(
    board_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, share = await _get_board_for_actor(db, board_id, actor)
    result = await db.execute(
        select(BoardCard).where(BoardCard.board_id == board.id).order_by(BoardCard.created_at, BoardCard.sort_order)
    )
    titles = await _session_titles(db, {board.session_id} if board.session_id else set())
    return _serialize_board(board, result.scalars().all(), actor, share, titles.get(board.session_id))


@router.patch("/{board_id}")
async def update_board(
    board_id: str,
    body: BoardUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, share = await _get_board_for_actor(db, board_id, actor)
    if not _can_manage_board(board, actor):
        raise HTTPException(status_code=403, detail="Modifica non consentita")
    if body.title is not None:
        board.title = body.title.strip()[:160] or board.title
    if body.description is not None:
        board.description = body.description
    if body.columns is not None:
        normalized_columns = _normalize_columns([c.dict() for c in body.columns])
        previous_column_ids = {column["id"] for column in _normalize_columns(board.columns_json)}
        valid_column_ids = {column["id"] for column in normalized_columns}
        removed_column_ids = previous_column_ids - valid_column_ids
        if removed_column_ids:
            if len(removed_column_ids) != 1 or body.move_cards_from_column_id not in removed_column_ids:
                raise HTTPException(status_code=400, detail="Indica dove spostare i task della colonna eliminata")
            if not body.move_cards_to_column_id or body.move_cards_to_column_id not in valid_column_ids:
                raise HTTPException(status_code=400, detail="Colonna di destinazione non valida")
            result = await db.execute(
                select(BoardCard).where(
                    BoardCard.board_id == board.id,
                    BoardCard.column_id == body.move_cards_from_column_id,
                )
            )
            for card in result.scalars().all():
                card.column_id = body.move_cards_to_column_id
                card.last_actor_display_name = _actor_name(actor)
        elif body.move_cards_from_column_id is not None or body.move_cards_to_column_id is not None:
            raise HTTPException(status_code=400, detail="Nessuna colonna da eliminare")
        board.columns_json = normalized_columns
    if body.labels is not None:
        labels = _normalize_labels([label.dict() for label in body.labels])
        valid_label_ids = {label["id"] for label in labels}
        removed = {label["id"] for label in _normalize_labels(board.labels_json)} - valid_label_ids
        if removed:
            cards = (await db.execute(select(BoardCard).where(BoardCard.board_id == board.id))).scalars().all()
            for card in cards:
                if any(label_id in removed for label_id in (card.labels or [])):
                    card.labels = [label_id for label_id in card.labels if label_id not in removed]
        board.labels_json = labels
    if body.sprints is not None:
        sprints = _normalize_sprints([sprint.dict() for sprint in body.sprints])
        valid_sprint_ids = {sprint["id"] for sprint in sprints}
        cards = (await db.execute(select(BoardCard).where(BoardCard.board_id == board.id, BoardCard.sprint_id.is_not(None)))).scalars().all()
        for card in cards:
            if card.sprint_id not in valid_sprint_ids:
                card.sprint_id = None
        board.sprints_json = sprints
    if body.session_id is not None and actor.is_teacher:
        new_session_id = await _resolve_create_session(db, actor, body.session_id) if body.session_id else None
        if new_session_id != board.session_id:
            board.session_id = new_session_id
            # Student shares/assignees belong to the old session: drop them.
            await db.execute(delete(BoardShare).where(BoardShare.board_id == board.id, BoardShare.student_id.is_not(None)))
            cards = (await db.execute(select(BoardCard).where(BoardCard.board_id == board.id))).scalars().all()
            for card in cards:
                if any(a.get("kind") == "student" for a in (card.assignees or [])):
                    card.assignees = [a for a in card.assignees if a.get("kind") != "student"]
    previous_visibility = board.visibility
    if body.visibility is not None and body.visibility in ("private", "session_shared"):
        if body.visibility == "session_shared" and board.session_id is None:
            raise HTTPException(status_code=400, detail="Collega la board a una sessione prima di condividerla con la classe")
        board.visibility = body.visibility
    if board.session_id is None:
        board.visibility = "private"
    if body.students_can_edit is not None:
        board.students_can_edit = bool(body.students_can_edit)
    if body.coding_project_id is not None:
        board.coding_project_id = uuid.UUID(body.coding_project_id) if body.coding_project_id else None
    await db.commit()
    await db.refresh(board)
    if actor.is_teacher and previous_visibility != "session_shared":
        await _notify_board_shared(board)
    titles = await _session_titles(db, {board.session_id} if board.session_id else set())
    return _serialize_board(board, actor=actor, share=share, session_title=titles.get(board.session_id))


@router.delete("/{board_id}", status_code=204)
async def delete_board(
    board_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, _ = await _get_board_for_actor(db, board_id, actor)
    if not _can_manage_board(board, actor):
        raise HTTPException(status_code=403, detail="Eliminazione non consentita")
    await db.delete(board)
    await db.commit()
    return None


@router.get("/{board_id}/members")
async def board_members(
    board_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, _ = await _get_board_for_actor(db, board_id, actor)
    return await _board_members(db, board)


@router.get("/{board_id}/shares")
async def list_shares(
    board_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Current direct shares plus the people the owner may share with."""
    board, _ = await _get_board_for_actor(db, board_id, actor)
    if not _can_manage_board(board, actor):
        raise HTTPException(status_code=403, detail="Solo il proprietario gestisce la condivisione")
    shares = (await db.execute(select(BoardShare).where(BoardShare.board_id == board.id))).scalars().all()
    teacher_candidates: list[dict] = []
    if actor.is_teacher:
        users = (await db.execute(
            select(User).where(
                User.tenant_id == board.tenant_id,
                User.role.in_((UserRole.TEACHER, UserRole.ADMIN)),
                User.is_active == True,
                User.id != actor.teacher.id,
            ).order_by(User.first_name, User.last_name, User.email)
        )).scalars().all()
        teacher_candidates = [{"id": str(u.id), "name": _user_name(u), "email": u.email} for u in users]
    student_candidates: list[dict] = []
    if board.session_id:
        students = (await db.execute(
            select(SessionStudent).where(SessionStudent.session_id == board.session_id).order_by(SessionStudent.nickname)
        )).scalars().all()
        student_candidates = [
            {"id": str(s.id), "name": s.nickname}
            for s in students
            if not (actor.is_student and s.id == actor.student.id)
        ]
    return {
        "teachers": [{"id": str(s.user_id), "can_edit": s.can_edit} for s in shares if s.user_id],
        "students": [{"id": str(s.student_id), "can_edit": s.can_edit} for s in shares if s.student_id],
        "teacher_candidates": teacher_candidates,
        "student_candidates": student_candidates,
    }


@router.put("/{board_id}/shares")
async def replace_shares(
    board_id: str,
    body: BoardSharesUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, _ = await _get_board_for_actor(db, board_id, actor)
    if not _can_manage_board(board, actor):
        raise HTTPException(status_code=403, detail="Solo il proprietario gestisce la condivisione")
    if body.teachers and actor.is_student:
        raise HTTPException(status_code=403, detail="Gli studenti possono condividere solo con compagni di sessione")

    teacher_targets = {_parse_uuid(t.id): t.can_edit for t in body.teachers[:100]}
    teacher_targets.pop(board.owner_user_id, None)
    if teacher_targets:
        valid = (await db.execute(
            select(User.id).where(
                User.id.in_(teacher_targets.keys()),
                User.tenant_id == board.tenant_id,
                User.role.in_((UserRole.TEACHER, UserRole.ADMIN)),
            )
        )).scalars().all()
        if len(valid) != len(teacher_targets):
            raise HTTPException(status_code=400, detail="Docente non valido")

    student_targets = {_parse_uuid(s.id): s.can_edit for s in body.students[:300]}
    student_targets.pop(board.owner_student_id, None)
    if student_targets:
        if board.session_id is None:
            raise HTTPException(status_code=400, detail="Collega la board a una sessione per condividerla con gli studenti")
        valid = (await db.execute(
            select(SessionStudent.id).where(SessionStudent.id.in_(student_targets.keys()), SessionStudent.session_id == board.session_id)
        )).scalars().all()
        if len(valid) != len(student_targets):
            raise HTTPException(status_code=400, detail="Studente non appartenente alla sessione")

    existing = (await db.execute(select(BoardShare).where(BoardShare.board_id == board.id))).scalars().all()
    kept: set[tuple[str, uuid.UUID]] = set()
    added_students = False
    for share in existing:
        key, targets = (("teacher", share.user_id), teacher_targets) if share.user_id else (("student", share.student_id), student_targets)
        if key[1] in targets:
            share.can_edit = bool(targets[key[1]])
            kept.add(key)
        else:
            await db.delete(share)
    for user_id, can_edit in teacher_targets.items():
        if ("teacher", user_id) not in kept:
            db.add(BoardShare(board_id=board.id, user_id=user_id, can_edit=bool(can_edit)))
    for student_id, can_edit in student_targets.items():
        if ("student", student_id) not in kept:
            db.add(BoardShare(board_id=board.id, student_id=student_id, can_edit=bool(can_edit)))
            added_students = True
    await db.commit()
    if added_students and board.session_id:
        await sio.emit("board_shared", {"board_id": str(board.id), "title": board.title}, room=f"session:{board.session_id}")
    return await list_shares(board_id, db, actor)


@router.post("/{board_id}/cards", status_code=201)
async def create_card(
    board_id: str,
    body: CardCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, share = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor, share):
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
        labels=_clean_card_labels(board, body.labels),
        assignees=await _validate_assignees(db, board, body.assignees or []),
        priority=_clean_priority(body.priority),
        story_points=_clean_points(body.story_points),
        card_type=_clean_card_type(body.card_type),
        sprint_id=_clean_sprint_id(board, body.sprint_id),
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
    board, share = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor, share):
        raise HTTPException(status_code=403, detail="Modifica non consentita")
    result = await db.execute(select(BoardCard).where(BoardCard.id == _parse_uuid(card_id, "Card non valida"), BoardCard.board_id == board.id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card non trovata")
    fields = body.model_fields_set
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
    if body.labels is not None:
        card.labels = _clean_card_labels(board, body.labels)
    if body.assignees is not None:
        card.assignees = await _validate_assignees(db, board, body.assignees)
    if "priority" in fields:
        card.priority = _clean_priority(body.priority)
    if "story_points" in fields:
        card.story_points = _clean_points(body.story_points)
    if "card_type" in fields:
        card.card_type = _clean_card_type(body.card_type)
    if "sprint_id" in fields:
        card.sprint_id = _clean_sprint_id(board, body.sprint_id)
    card.last_actor_display_name = _actor_name(actor)
    await db.commit()
    await db.refresh(card)
    return _serialize_card(card)


@router.delete("/{board_id}/cards/{card_id}", status_code=204)
async def delete_card(
    board_id: str,
    card_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, share = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor, share):
        raise HTTPException(status_code=403, detail="Eliminazione non consentita")
    result = await db.execute(select(BoardCard).where(BoardCard.id == _parse_uuid(card_id, "Card non valida"), BoardCard.board_id == board.id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card non trovata")
    await db.delete(card)
    await db.commit()
    return None


@router.post("/{board_id}/cards/bulk", status_code=201)
async def create_cards_bulk(
    board_id: str,
    body: BoardBulkCards,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, share = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor, share):
        raise HTTPException(status_code=403, detail="Modifica non consentita")
    columns = _normalize_columns(board.columns_json)
    valid_columns = {c["id"] for c in columns}
    actor_name = _actor_name(actor)
    created: list[BoardCard] = []
    for idx, item in enumerate(body.cards[:30]):
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
            labels=_clean_card_labels(board, item.labels),
            priority=_clean_priority(item.priority),
            story_points=_clean_points(item.story_points),
            card_type=_clean_card_type(item.card_type),
            sort_order=f"{idx:04d}",
            created_by_display_name=actor_name,
            last_actor_display_name=actor_name,
        )
        db.add(card)
        created.append(card)
    await db.commit()
    for card in created:
        await db.refresh(card)
    return [_serialize_card(card) for card in created]


def _backlog_system_prompt(framework: str) -> str:
    common = (
        "Sei un project manager esperto che lavora con docenti e studenti. "
        "Analizza il progetto descritto e costruisci un backlog operativo in italiano. "
        "Prima capisci il dominio del progetto (es. sviluppo software, marketing, evento, ricerca, didattica, design, video) "
        "e crea da 4 a 8 etichette SPECIFICHE di quel dominio che distinguano la natura dei task "
        "(es. sviluppo software: Frontend, Backend, Database, Test, UX/UI, DevOps; "
        "marketing: Social media, Contenuti, SEO, Advertising, Analytics, Brand; "
        "evento: Logistica, Comunicazione, Budget, Fornitori, Programma). "
        "Ogni item deve avere da 1 a 3 etichette scelte SOLO tra quelle create. "
        "Priorità: alta, media o bassa. Titoli brevi e azionabili, descrizioni concrete (max 3 frasi). "
    )
    if framework == "scrum":
        rules = (
            "Framework: Scrum/Agile. Crea da 3 a 6 epic (type=epic, column=backlog). "
            "Per ogni epic crea da 2 a 6 user story (type=story, parent=ref dell'epic) nel formato "
            "'Come <ruolo> voglio <obiettivo> per <beneficio>'; nella descrizione aggiungi i criteri di accettazione. "
            "Stima story_points con Fibonacci (1,2,3,5,8,13). "
            "Pianifica da 2 a 4 sprint (ref S1, S2, ...) con un nome e un obiettivo (goal), bilanciando gli story point "
            "e rispettando le dipendenze: assegna OGNI story a uno sprint tramite il campo sprint (es. \"S1\"); gli epic hanno sprint=null. "
            "Le story dello sprint S1 vanno in column=sprint, le altre in column=backlog. "
        )
    else:
        rules = (
            "Framework: Kanban. Crea da 12 a 30 task operativi (type=task, parent=null, story_points=null), "
            "ciascuno completabile in poche ore o in un giorno, tutti in column=todo, ordinati per sequenza logica. "
        )
    schema = (
        "Rispondi SOLO con JSON valido, senza testo aggiuntivo: "
        "{\"title\":\"titolo breve della board\",\"description\":\"sintesi del progetto in 1-2 frasi\",\"domain\":\"...\","
        "\"labels\":[{\"name\":\"...\",\"color\":\"#rrggbb\"}],"
        "\"sprints\":[{\"ref\":\"S1\",\"name\":\"Sprint 1 - ...\",\"goal\":\"...\"}],"
        "\"items\":[{\"ref\":\"E1\",\"type\":\"epic|story|task\",\"parent\":null,\"title\":\"...\",\"description\":\"...\","
        "\"labels\":[\"nome etichetta\"],\"priority\":\"alta|media|bassa\",\"story_points\":null,\"sprint\":null,\"column\":\"...\"}]}. "
        f"Massimo {MAX_GENERATED_ITEMS} item. Usa colori etichetta diversi e leggibili."
    )
    return common + rules + schema


async def _extract_upload_text(upload: UploadFile) -> str:
    file_bytes = await upload.read()
    if len(file_bytes) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File troppo grande (max 15 MB)")
    try:
        text, *_ = await DocumentProcessor()._extract_content(file_bytes, upload.filename or "", upload.content_type or "", [])
    except Exception as exc:
        logger.warning("Board backlog: cannot extract %s: %s", upload.filename, exc)
        text = ""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Impossibile leggere il file: usa PDF, DOCX, PPTX, TXT o MD")
    return text


async def _generate_backlog_board(
    db: AsyncSession,
    actor: StudentOrTeacher,
    framework: str,
    source_parts: list[str],
    title: str,
    board_session_id: Optional[uuid.UUID],
) -> dict:
    """LLM task breakdown + board creation (runs inside a background job)."""
    try:
        response = await LLMService().generate(
            messages=[{"role": "user", "content": "\n\n".join(source_parts)}],
            system_prompt=_backlog_system_prompt(framework),
            temperature=0.3,
            max_tokens=8000,
            allow_web_search=False,
        )
    except Exception as exc:
        logger.warning("Board backlog generation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Generazione del backlog non riuscita, riprova")
    await _track_llm_usage(db, actor, response, "board_backlog_generate")
    try:
        data = extract_json(response.content or "")
    except Exception as exc:
        logger.warning("Board backlog generation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Generazione del backlog non riuscita, riprova")

    labels = _normalize_labels([label for label in (data.get("labels") or []) if isinstance(label, dict)])
    label_by_name = {label["name"].lower(): label for label in labels}
    sprint_id_by_ref: dict[str, str] = {}
    sprints: list[dict] = []
    if framework == "scrum":
        raw_sprints = [sprint for sprint in (data.get("sprints") or []) if isinstance(sprint, dict)][:8]
        # Two-week sprints back to back, starting next Monday; editable afterwards.
        first_start = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)
        sprints = _normalize_sprints([
            {
                "name": sprint.get("name"),
                "goal": sprint.get("goal"),
                "start_date": (first_start + timedelta(days=14 * idx)).isoformat(),
                "end_date": (first_start + timedelta(days=14 * idx + 11)).isoformat(),
            }
            for idx, sprint in enumerate(raw_sprints)
        ])
        for raw, sprint in zip(raw_sprints, sprints):
            if raw.get("ref"):
                sprint_id_by_ref[str(raw["ref"])] = sprint["id"]
    columns = _template_columns(framework)
    column_ids = {c["id"] for c in columns}
    board = _new_board(
        actor,
        board_session_id,
        title=(title.strip() or str(data.get("title") or "").strip() or "Backlog di progetto")[:160],
        description=str(data.get("description") or "").strip()[:2000] or None,
        template_key=framework,
        framework=framework,
        columns_json=columns,
        labels_json=labels,
        sprints_json=sprints,
        visibility="private",
        students_can_edit=False,
    )
    db.add(board)
    await db.flush()

    actor_name = _actor_name(actor)
    items = [item for item in (data.get("items") or []) if isinstance(item, dict)][:MAX_GENERATED_ITEMS]
    card_ids_by_ref: dict[str, uuid.UUID] = {}
    # Epics first so stories can point at them.
    items.sort(key=lambda item: 0 if item.get("type") == "epic" else 1)
    for idx, item in enumerate(items):
        item_title = str(item.get("title") or "").strip()
        if not item_title:
            continue
        card_labels = [label_by_name[str(n).strip().lower()] for n in (item.get("labels") or []) if str(n).strip().lower() in label_by_name]
        card_type = _clean_card_type(item.get("type")) or ("story" if framework == "scrum" else "task")
        column = str(item.get("column") or "")
        card = BoardCard(
            id=uuid.uuid4(),
            board_id=board.id,
            column_id=column if column in column_ids else columns[0]["id"],
            title=item_title[:220],
            description=str(item.get("description") or "").strip()[:4000] or None,
            color=card_labels[0]["color"] if card_labels else None,
            labels=[label["id"] for label in card_labels][:3],
            card_type=card_type,
            priority=_clean_priority(item.get("priority")),
            story_points=_clean_points(item.get("story_points")) if framework == "scrum" and card_type != "epic" else None,
            parent_card_id=card_ids_by_ref.get(str(item.get("parent") or "")),
            sprint_id=sprint_id_by_ref.get(str(item.get("sprint") or "")) if card_type != "epic" else None,
            sort_order=f"{idx:04d}",
            created_by_display_name=actor_name,
            last_actor_display_name=actor_name,
        )
        if item.get("ref"):
            card_ids_by_ref[str(item["ref"])] = card.id
        db.add(card)
        await db.flush()
    await db.commit()
    await db.refresh(board)
    cards = (await db.execute(
        select(BoardCard).where(BoardCard.board_id == board.id).order_by(BoardCard.created_at, BoardCard.sort_order)
    )).scalars().all()
    titles = await _session_titles(db, {board.session_id} if board.session_id else set())
    return _serialize_board(board, cards, actor, session_title=titles.get(board.session_id))


@router.post("/generate", status_code=202)
async def generate_board(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    framework: Annotated[str, Form()] = "kanban",
    prompt: Annotated[str, Form()] = "",
    title: Annotated[str, Form()] = "",
    session_id: Annotated[Optional[str], Form()] = None,
    file: Annotated[Optional[UploadFile], File()] = None,
):
    """Create a board with an AI task breakdown from a prompt and/or a project file.
    Runs as a background job (survives page changes): returns the job id to follow."""
    if actor.is_student and not await _student_boards_enabled(db, actor):
        raise HTTPException(status_code=403, detail="Modulo board non abilitato")
    framework = framework if framework in FRAMEWORKS else "kanban"
    source_parts = []
    if prompt.strip():
        source_parts.append(f"Richiesta:\n{prompt.strip()[:6000]}")
    if file is not None and file.filename:
        source_parts.append(f"Documento di progetto ({file.filename}):\n{(await _extract_upload_text(file))[:MAX_SOURCE_CHARS]}")
    if not source_parts:
        raise HTTPException(status_code=400, detail="Descrivi il progetto o carica un file")
    board_session_id = await _resolve_create_session(db, actor, session_id)
    await _require_credits(db, actor, estimated_cost=0.01)

    request_title = title
    source_label = prompt.strip()[:300] or (file.filename if file is not None and file.filename else "")

    async def work(ctx: background_jobs.JobContext) -> dict:
        await ctx.progress(0.1, "Analisi del progetto e scomposizione in task…", force=True)
        async with AsyncSessionLocal() as job_db:
            board = await _generate_backlog_board(job_db, actor, framework, source_parts, request_title, board_session_id)
        return {"board_id": board["id"], "title": board["title"], "cards": len(board.get("cards") or [])}

    job_id = await background_jobs.start_task_job(
        background_jobs.JobOwner.from_actor(actor),
        kind="board_backlog",
        title=f"Backlog {'Scrum' if framework == 'scrum' else 'Kanban'} con l'AI",
        description=source_label or "Generazione backlog",
        route="module:boards" if actor.is_student else "/teacher/boards",
        expected_seconds=60.0,
        work=work,
    )
    return {"job_id": str(job_id)}


@router.post("/{board_id}/ai/chat")
async def board_ai_chat(
    board_id: str,
    body: BoardAiMessage,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    board, share = await _get_board_for_actor(db, board_id, actor)
    if not _can_edit_board(board, actor, share):
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
    await _require_credits(db, actor, estimated_cost=0.002)
    try:
        response = await LLMService().generate(messages=messages, temperature=0.35, max_tokens=1800, allow_web_search=False)
        await _track_llm_usage(db, actor, response, "board_ai_chat", board.id)
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
