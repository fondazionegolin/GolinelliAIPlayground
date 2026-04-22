from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_current_admin, get_student_or_teacher
from app.core.database import get_db
from app.models.changelog import PlatformChangelogRelease
from app.models.desktop import AdminDesktopWidgetTemplate
from app.models.user import User

router = APIRouter()


class WidgetTemplatePayload(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    audience: Literal["all", "teacher", "student"] = "all"
    widget_type: str = Field(min_length=1, max_length=32)
    target_desktop_index: int = 0
    grid_x: int = 0
    grid_y: int = 0
    grid_w: int = 4
    grid_h: int = 3
    config_json: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class ChangelogItemPayload(BaseModel):
    category: Literal["new", "improved", "fixed"] = "improved"
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1)


class ChangelogReleasePayload(BaseModel):
    version_label: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=160)
    summary: str | None = None
    git_ref: str | None = Field(default=None, max_length=120)
    is_published: bool = True
    items: list[ChangelogItemPayload] = Field(default_factory=list)


def _require_tenant_id(admin: User) -> UUID:
    if not admin.tenant_id:
        raise HTTPException(status_code=400, detail="Admin tenant not configured")
    return admin.tenant_id


def _template_to_dict(item: AdminDesktopWidgetTemplate) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "title": item.title,
        "audience": item.audience,
        "widget_type": item.widget_type,
        "target_desktop_index": item.target_desktop_index,
        "grid_x": item.grid_x,
        "grid_y": item.grid_y,
        "grid_w": item.grid_w,
        "grid_h": item.grid_h,
        "config_json": item.config_json or {},
        "is_active": bool(item.is_active),
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


def _release_to_dict(item: PlatformChangelogRelease) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "version_label": item.version_label,
        "title": item.title,
        "summary": item.summary,
        "items": item.items_json or [],
        "git_ref": item.git_ref,
        "is_published": bool(item.is_published),
        "published_at": item.published_at.isoformat() if item.published_at else None,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


@router.get("/admin/backend/widget-templates", response_model=list[dict[str, Any]])
async def list_widget_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant_id = _require_tenant_id(admin)
    result = await db.execute(
        select(AdminDesktopWidgetTemplate)
        .where(AdminDesktopWidgetTemplate.tenant_id == tenant_id)
        .order_by(
            AdminDesktopWidgetTemplate.audience.asc(),
            AdminDesktopWidgetTemplate.target_desktop_index.asc(),
            AdminDesktopWidgetTemplate.created_at.asc(),
        )
    )
    return [_template_to_dict(item) for item in result.scalars().all()]


@router.post("/admin/backend/widget-templates", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
async def create_widget_template(
    payload: WidgetTemplatePayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant_id = _require_tenant_id(admin)
    item = AdminDesktopWidgetTemplate(
        tenant_id=tenant_id,
        created_by_admin_id=admin.id,
        **payload.model_dump(),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _template_to_dict(item)


@router.patch("/admin/backend/widget-templates/{template_id}", response_model=dict[str, Any])
async def update_widget_template(
    template_id: UUID,
    payload: WidgetTemplatePayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant_id = _require_tenant_id(admin)
    result = await db.execute(
        select(AdminDesktopWidgetTemplate).where(
            AdminDesktopWidgetTemplate.id == template_id,
            AdminDesktopWidgetTemplate.tenant_id == tenant_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Widget template not found")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    await db.commit()
    await db.refresh(item)
    return _template_to_dict(item)


@router.delete("/admin/backend/widget-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_widget_template(
    template_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant_id = _require_tenant_id(admin)
    result = await db.execute(
        select(AdminDesktopWidgetTemplate).where(
            AdminDesktopWidgetTemplate.id == template_id,
            AdminDesktopWidgetTemplate.tenant_id == tenant_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Widget template not found")
    await db.delete(item)
    await db.commit()


@router.get("/admin/backend/changelog", response_model=list[dict[str, Any]])
async def list_admin_changelog(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant_id = _require_tenant_id(admin)
    result = await db.execute(
        select(PlatformChangelogRelease)
        .where(PlatformChangelogRelease.tenant_id == tenant_id)
        .order_by(
            desc(PlatformChangelogRelease.published_at),
            desc(PlatformChangelogRelease.created_at),
        )
    )
    return [_release_to_dict(item) for item in result.scalars().all()]


@router.post("/admin/backend/changelog", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
async def create_changelog_release(
    payload: ChangelogReleasePayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant_id = _require_tenant_id(admin)
    item = PlatformChangelogRelease(
        tenant_id=tenant_id,
        created_by_admin_id=admin.id,
        version_label=payload.version_label,
        title=payload.title,
        summary=payload.summary,
        items_json=[release_item.model_dump() for release_item in payload.items],
        git_ref=payload.git_ref,
        is_published=payload.is_published,
        published_at=datetime.now(timezone.utc) if payload.is_published else None,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _release_to_dict(item)


@router.patch("/admin/backend/changelog/{release_id}", response_model=dict[str, Any])
async def update_changelog_release(
    release_id: UUID,
    payload: ChangelogReleasePayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant_id = _require_tenant_id(admin)
    result = await db.execute(
        select(PlatformChangelogRelease).where(
            PlatformChangelogRelease.id == release_id,
            PlatformChangelogRelease.tenant_id == tenant_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Release not found")

    item.version_label = payload.version_label
    item.title = payload.title
    item.summary = payload.summary
    item.items_json = [release_item.model_dump() for release_item in payload.items]
    item.git_ref = payload.git_ref
    item.is_published = payload.is_published
    item.published_at = datetime.now(timezone.utc) if payload.is_published else None

    await db.commit()
    await db.refresh(item)
    return _release_to_dict(item)


@router.delete("/admin/backend/changelog/{release_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_changelog_release(
    release_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    tenant_id = _require_tenant_id(admin)
    result = await db.execute(
        select(PlatformChangelogRelease).where(
            PlatformChangelogRelease.id == release_id,
            PlatformChangelogRelease.tenant_id == tenant_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Release not found")
    await db.delete(item)
    await db.commit()


@router.get("/changelog", response_model=list[dict[str, Any]])
async def list_public_changelog(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    limit: int = Query(default=20, ge=1, le=100),
):
    tenant_id = actor.teacher.tenant_id if actor.is_teacher else actor.student.tenant_id
    result = await db.execute(
        select(PlatformChangelogRelease)
        .where(
            PlatformChangelogRelease.tenant_id == tenant_id,
            PlatformChangelogRelease.is_published == True,
        )
        .order_by(
            desc(PlatformChangelogRelease.published_at),
            desc(PlatformChangelogRelease.created_at),
        )
        .limit(limit)
    )
    return [_release_to_dict(item) for item in result.scalars().all()]
