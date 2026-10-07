"""Platform API catalogue: discover and run platform actions (Files, documents, images, 3D, live sessions).

The catalogue is the contract used by external callers and by the Data Flow Studio; see
``app.services.platform_actions``.  Actions run as the authenticated teacher, with the same permissions and
credit metering as the matching UI feature.
"""
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_teacher
from app.core.database import get_db
from app.models.user import User
from app.services import platform_actions as platform

router = APIRouter()


class ActionRun(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


@router.get("/catalog")
async def get_catalog(teacher: Annotated[User, Depends(get_current_teacher)]):
    del teacher
    return platform.catalog()


@router.get("/catalog/{action_id}")
async def get_action(action_id: str, teacher: Annotated[User, Depends(get_current_teacher)]):
    del teacher
    act = platform.ACTIONS.get(action_id)
    if act is None:
        raise HTTPException(status_code=404, detail=f"Azione sconosciuta: {action_id}")
    return act.spec()


@router.post("/actions/{action_id}")
async def run_action(
    action_id: str,
    body: ActionRun,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    return {"action": action_id, "result": await platform.execute(action_id, body.params, platform.ActionContext(db=db, teacher=teacher))}
