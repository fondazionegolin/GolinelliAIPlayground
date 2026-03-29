from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, List
from uuid import UUID
import uuid

from app.core.database import get_db
from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.models.desktop import UserDesktop, DesktopWidget

router = APIRouter()

MAX_DESKTOPS = 10


# ── Helpers ──────────────────────────────────────────────────────────────────

def _owner_filter(actor: StudentOrTeacher):
    """Return (teacher_id, student_id, tenant_id) for ownership queries."""
    if actor.is_teacher:
        return actor.teacher.id, None, actor.teacher.tenant_id
    return None, actor.student.id, actor.student.tenant_id


def _desktop_to_dict(d: UserDesktop) -> dict:
    return {
        "id": str(d.id),
        "title": d.title,
        "wallpaper_key": d.wallpaper_key,
        "sort_order": d.sort_order,
        "created_at": d.created_at.isoformat(),
        "updated_at": d.updated_at.isoformat(),
    }


def _widget_to_dict(w: DesktopWidget) -> dict:
    return {
        "id": str(w.id),
        "desktop_id": str(w.desktop_id),
        "widget_type": w.widget_type,
        "grid_x": w.grid_x,
        "grid_y": w.grid_y,
        "grid_w": w.grid_w,
        "grid_h": w.grid_h,
        "config_json": w.config_json,
        "created_at": w.created_at.isoformat(),
        "updated_at": w.updated_at.isoformat(),
    }


async def _get_desktop_or_404(
    desktop_id: UUID,
    actor: StudentOrTeacher,
    db: AsyncSession,
) -> UserDesktop:
    teacher_id, student_id, _ = _owner_filter(actor)
    result = await db.execute(select(UserDesktop).where(UserDesktop.id == desktop_id))
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")
    if teacher_id and desktop.owner_teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if student_id and desktop.owner_student_id != student_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return desktop


# ── Desktop CRUD ─────────────────────────────────────────────────────────────

@router.get("/desktop", response_model=List[dict])
async def list_desktops(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    teacher_id, student_id, _ = _owner_filter(actor)
    if teacher_id:
        q = select(UserDesktop).where(UserDesktop.owner_teacher_id == teacher_id)
    else:
        q = select(UserDesktop).where(UserDesktop.owner_student_id == student_id)
    result = await db.execute(q.order_by(UserDesktop.sort_order))
    desktops = result.scalars().all()

    # Auto-create default desktop on first access
    if not desktops:
        teacher_id2, student_id2, tenant_id = _owner_filter(actor)
        desktop = UserDesktop(
            tenant_id=tenant_id,
            owner_teacher_id=teacher_id2,
            owner_student_id=student_id2,
            title="Desktop",
            sort_order=0,
        )
        db.add(desktop)
        await db.commit()
        await db.refresh(desktop)
        desktops = [desktop]

    # Attach widgets
    desktop_ids = [d.id for d in desktops]
    w_result = await db.execute(
        select(DesktopWidget).where(DesktopWidget.desktop_id.in_(desktop_ids))
    )
    widgets = w_result.scalars().all()
    widgets_by_desktop: dict = {}
    for w in widgets:
        widgets_by_desktop.setdefault(str(w.desktop_id), []).append(_widget_to_dict(w))

    return [
        {**_desktop_to_dict(d), "widgets": widgets_by_desktop.get(str(d.id), [])}
        for d in desktops
    ]


@router.post("/desktop", response_model=dict, status_code=201)
async def create_desktop(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    teacher_id, student_id, tenant_id = _owner_filter(actor)
    if teacher_id:
        count_q = select(UserDesktop).where(UserDesktop.owner_teacher_id == teacher_id)
    else:
        count_q = select(UserDesktop).where(UserDesktop.owner_student_id == student_id)
    result = await db.execute(count_q)
    existing = result.scalars().all()
    if len(existing) >= MAX_DESKTOPS:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_DESKTOPS} desktops allowed")

    desktop = UserDesktop(
        tenant_id=tenant_id,
        owner_teacher_id=teacher_id,
        owner_student_id=student_id,
        title=request.get("title", f"Desktop {len(existing) + 1}"),
        wallpaper_key=request.get("wallpaper_key", "gradient_midnight"),
        sort_order=len(existing),
    )
    db.add(desktop)
    await db.commit()
    await db.refresh(desktop)
    return {**_desktop_to_dict(desktop), "widgets": []}


@router.patch("/desktop/{desktop_id}", response_model=dict)
async def update_desktop(
    desktop_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    desktop = await _get_desktop_or_404(desktop_id, actor, db)
    if "title" in request:
        desktop.title = str(request["title"])[:100]
    if "wallpaper_key" in request:
        desktop.wallpaper_key = str(request["wallpaper_key"])[:200]
    await db.commit()
    await db.refresh(desktop)
    return _desktop_to_dict(desktop)


@router.delete("/desktop/{desktop_id}", status_code=204)
async def delete_desktop(
    desktop_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    desktop = await _get_desktop_or_404(desktop_id, actor, db)
    teacher_id, student_id, _ = _owner_filter(actor)
    if teacher_id:
        count_q = select(UserDesktop).where(UserDesktop.owner_teacher_id == teacher_id)
    else:
        count_q = select(UserDesktop).where(UserDesktop.owner_student_id == student_id)
    result = await db.execute(count_q)
    if len(result.scalars().all()) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last desktop")
    await db.delete(desktop)
    await db.commit()


@router.patch("/desktop/reorder", response_model=List[dict])
async def reorder_desktops(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """request body: {"ids": ["uuid1", "uuid2", ...]} in new order"""
    ids: List[str] = request.get("ids", [])
    teacher_id, student_id, _ = _owner_filter(actor)
    for i, did in enumerate(ids):
        result = await db.execute(select(UserDesktop).where(UserDesktop.id == uuid.UUID(did)))
        desktop = result.scalar_one_or_none()
        if not desktop:
            continue
        if teacher_id and desktop.owner_teacher_id != teacher_id:
            continue
        if student_id and desktop.owner_student_id != student_id:
            continue
        desktop.sort_order = i
    await db.commit()
    return await list_desktops(db=db, actor=actor)


# ── Widget CRUD ───────────────────────────────────────────────────────────────

@router.post("/desktop/{desktop_id}/widgets", response_model=dict, status_code=201)
async def add_widget(
    desktop_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    desktop = await _get_desktop_or_404(desktop_id, actor, db)
    _, _, tenant_id = _owner_filter(actor)
    widget = DesktopWidget(
        tenant_id=tenant_id,
        desktop_id=desktop.id,
        widget_type=request.get("widget_type", "NOTE"),
        grid_x=request.get("grid_x", 0),
        grid_y=request.get("grid_y", 0),
        grid_w=request.get("grid_w", 4),
        grid_h=request.get("grid_h", 3),
        config_json=request.get("config_json", {}),
    )
    db.add(widget)
    await db.commit()
    await db.refresh(widget)
    return _widget_to_dict(widget)


@router.patch("/desktop/{desktop_id}/widgets/{widget_id}", response_model=dict)
async def update_widget(
    desktop_id: UUID,
    widget_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _get_desktop_or_404(desktop_id, actor, db)
    result = await db.execute(
        select(DesktopWidget).where(
            DesktopWidget.id == widget_id,
            DesktopWidget.desktop_id == desktop_id,
        )
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")

    for field in ("grid_x", "grid_y", "grid_w", "grid_h"):
        if field in request:
            setattr(widget, field, int(request[field]))
    if "config_json" in request:
        widget.config_json = request["config_json"]

    await db.commit()
    await db.refresh(widget)
    return _widget_to_dict(widget)


@router.delete("/desktop/{desktop_id}/widgets/{widget_id}", status_code=204)
async def delete_widget(
    desktop_id: UUID,
    widget_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _get_desktop_or_404(desktop_id, actor, db)
    result = await db.execute(
        select(DesktopWidget).where(
            DesktopWidget.id == widget_id,
            DesktopWidget.desktop_id == desktop_id,
        )
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")
    await db.delete(widget)
    await db.commit()
