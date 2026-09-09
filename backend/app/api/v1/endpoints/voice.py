import base64
import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated
import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.core.config import settings
from app.core.database import get_db
from app.models.invitation import ClassTeacher, SessionTeacher
from app.models.session import Class, Session
from app.realtime.gateway import voice_rooms


router = APIRouter()


def _generate_turn_credentials(secret: str, ttl: int) -> tuple[str, str]:
    """
    Generate time-limited TURN credentials compatible with coturn's use-auth-secret.

    coturn config must include:
        use-auth-secret
        static-auth-secret=<same value as TURN_SECRET>

    Algorithm:
        username   = "{expiry_unix_timestamp}:livekit"
        credential = base64( HMAC-SHA1(secret, username) )
    """
    expiry = int(time.time()) + ttl
    username = f"{expiry}:livekit"
    mac = hmac.new(secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1)
    credential = base64.b64encode(mac.digest()).decode("utf-8")
    return username, credential


class LiveKitTokenRequest(BaseModel):
    session_id: uuid.UUID


async def _can_access_session(
    db: AsyncSession,
    principal: StudentOrTeacher,
    session_id: uuid.UUID,
) -> bool:
    if principal.student:
        return principal.student.session_id == session_id

    teacher = principal.teacher
    if not teacher:
        return False

    result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == session_id)
        .where(Session.tenant_id == teacher.tenant_id)
    )
    row = result.first()
    if not row:
        return False

    session_obj, class_obj = row
    if class_obj.teacher_id == teacher.id:
        return True

    class_member = await db.execute(
        select(ClassTeacher)
        .where(ClassTeacher.class_id == class_obj.id)
        .where(ClassTeacher.teacher_id == teacher.id)
    )
    if class_member.scalar_one_or_none():
        return True

    session_member = await db.execute(
        select(SessionTeacher)
        .where(SessionTeacher.session_id == session_obj.id)
        .where(SessionTeacher.teacher_id == teacher.id)
    )
    return session_member.scalar_one_or_none() is not None


@router.post("/livekit-token")
async def create_livekit_token(
    request: LiveKitTokenRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if not settings.LIVEKIT_URL or not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Realtime media chat is not configured",
        )

    if not await _can_access_session(db, principal, request.session_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session access denied")

    room = f"eduai-session-{request.session_id}"
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.LIVEKIT_TOKEN_TTL_MINUTES)

    if principal.student:
        identity = f"student:{principal.student.id}"
        name = principal.student.nickname or "Studente"
        voice_state = voice_rooms.get(str(request.session_id)) or {}
        active_speaker_ids = voice_state.get("active_speaker_ids")
        if active_speaker_ids is None:
            active_speaker_ids = [voice_state.get("active_speaker_id")] if voice_state.get("active_speaker_id") else []
        can_publish = str(principal.student.id) in active_speaker_ids
    else:
        identity = f"teacher:{principal.teacher.id}"
        name = f"{principal.teacher.first_name or ''} {principal.teacher.last_name or ''}".strip() or "Docente"
        can_publish = True

    payload = {
        "iss": settings.LIVEKIT_API_KEY,
        "sub": identity,
        "name": name,
        "nbf": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "video": {
            "room": room,
            "roomJoin": True,
            "canSubscribe": True,
            "canPublish": can_publish,
            "canPublishData": True,
        },
    }
    token = jwt.encode(payload, settings.LIVEKIT_API_SECRET, algorithm="HS256")

    # Build ICE server list for the client: include the external TURN if configured.
    ice_servers = []
    if settings.TURN_HOST and settings.TURN_SECRET:
        turn_user, turn_cred = _generate_turn_credentials(
            settings.TURN_SECRET, settings.TURN_TTL_SECONDS
        )
        ice_servers.append({
            "urls": [
                f"turns:{settings.TURN_HOST}:{settings.TURN_PORT}?transport=tcp",
                f"turn:{settings.TURN_HOST}:3478?transport=udp",
            ],
            "username": turn_user,
            "credential": turn_cred,
        })

    return {
        "url": settings.LIVEKIT_URL,
        "token": token,
        "room": room,
        "identity": identity,
        "can_publish": can_publish,
        "expires_at": expires_at.isoformat(),
        "ice_servers": ice_servers,   # empty list when TURN not configured
    }
