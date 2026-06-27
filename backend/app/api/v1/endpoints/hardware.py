from typing import Annotated, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.core.config import settings


router = APIRouter()


class CircuitPlaygroundCompileRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=40000)


class CircuitPlaygroundCompileResponse(BaseModel):
    ok: bool
    board: str
    filename: str
    mime_type: str
    size_bytes: int
    uf2_base64: str
    logs: Optional[str] = None


@router.post(
    "/circuit-playground/compile",
    response_model=CircuitPlaygroundCompileResponse,
)
async def compile_circuit_playground(
    payload: CircuitPlaygroundCompileRequest,
    _actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    compiler_url = settings.PXT_COMPILER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=settings.PXT_COMPILER_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{compiler_url}/compile/circuitplayground",
                json={"code": payload.code},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Il compilatore MakeCode/PXT non ha risposto in tempo.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Il microservizio MakeCode/PXT non e raggiungibile.",
        ) from exc

    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = {"error": response.text}
        raise HTTPException(status_code=response.status_code, detail=detail)

    return response.json()
