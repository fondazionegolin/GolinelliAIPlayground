import socketio
from datetime import datetime
from typing import Optional
import json

from app.core.security import decode_token
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from app.models.session import SessionStudent, Session, Class, SessionModule
from app.models.invitation import ClassTeacher, SessionTeacher
from app.models.user import User
from app.models.enums import SessionStatus

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.all_cors_origins,
    logger=True,
    engineio_logger=True,
)

socket_app = socketio.ASGIApp(sio, socketio_path="")

# In-memory state (use Redis in production for multi-instance)
connected_users: dict[str, dict] = {}  # sid -> user info
session_presence: dict[str, set] = {}  # session_id -> set of sids
user_activities: dict[str, dict] = {}  # student_id -> activity info
student_nicknames: dict[str, str] = {}  # student_id -> nickname
student_avatars: dict[str, str] = {}  # student_id -> avatar_url
student_accents: dict[str, str] = {}  # student_id -> ui_accent
teacher_accents: dict[str, str] = {}  # teacher_id -> ui_accent

# Cache for session teacher IDs (session_id -> teacher_id)
# In production with multiple workers, this should be in Redis
session_teacher_cache: dict[str, str] = {}

async def get_session_teacher_id(session_id: str) -> Optional[str]:
    if session_id in session_teacher_cache:
        return session_teacher_cache[session_id]
        
    try:
        async with AsyncSessionLocal() as db:
            # Query session -> class -> teacher_id
            result = await db.execute(
                select(Class.teacher_id)
                .join(Session, Session.class_id == Class.id)
                .where(Session.id == session_id)
            )
            teacher_id = result.scalar_one_or_none()
            
            if teacher_id:
                teacher_id_str = str(teacher_id)
                session_teacher_cache[session_id] = teacher_id_str
                return teacher_id_str
    except Exception as e:
        print(f"[Gateway] Error fetching teacher for session {session_id}: {e}")
        
    return None


async def can_user_access_session(user: dict, session_id: str) -> bool:
    try:
        async with AsyncSessionLocal() as db:
            if user.get("type") == "student":
                return str(user.get("session_id") or "") == str(session_id)

            teacher_id = user.get("id")
            tenant_id = user.get("tenant_id")
            if not teacher_id or not tenant_id:
                return False

            result = await db.execute(
                select(Session, Class)
                .join(Class, Session.class_id == Class.id)
                .where(Session.id == session_id)
                .where(Session.tenant_id == tenant_id)
            )
            row = result.first()
            if not row:
                return False

            session_obj, class_obj = row
            if str(class_obj.teacher_id) == str(teacher_id):
                return True

            class_member = await db.execute(
                select(ClassTeacher)
                .where(ClassTeacher.class_id == class_obj.id)
                .where(ClassTeacher.teacher_id == teacher_id)
            )
            if class_member.scalar_one_or_none():
                return True

            session_member = await db.execute(
                select(SessionTeacher)
                .where(SessionTeacher.session_id == session_obj.id)
                .where(SessionTeacher.teacher_id == teacher_id)
            )
            return session_member.scalar_one_or_none() is not None
    except Exception as e:
        print(f"[Gateway] can_user_access_session error for user {user.get('id')} session {session_id}: {e}")
        return False


async def get_session_status(session_id: str) -> Optional[SessionStatus]:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Session.status).where(Session.id == session_id)
            )
            return result.scalar_one_or_none()
    except Exception as e:
        print(f"[Gateway] Error fetching session status for {session_id}: {e}")
        return None


async def is_private_chat_enabled(session_id: str) -> bool:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(SessionModule.is_enabled)
                .where(SessionModule.session_id == session_id)
                .where(SessionModule.module_key == "chat")
                .limit(1)
            )
            enabled = result.scalar_one_or_none()
            return True if enabled is None else bool(enabled)
    except Exception as e:
        print(f"[Gateway] Error fetching private chat state for {session_id}: {e}")
        return False


async def revoke_student_session_access(session_id: str, reason: str, revoked_status: str):
    student_sids = [
        sid for sid in list(session_presence.get(session_id, set()))
        if connected_users.get(sid, {}).get("type") == "student"
        and str(connected_users.get(sid, {}).get("session_id") or "") == str(session_id)
    ]

    for sid in student_sids:
        try:
            await sio.emit(
                "session_access_revoked",
                {
                    "session_id": session_id,
                    "status": revoked_status,
                    "reason": reason,
                },
                room=sid,
            )
            await sio.disconnect(sid)
        except Exception as e:
            print(f"[Gateway] Failed to revoke session access for sid {sid}: {e}")

# Helper to send teacher notification
async def notify_session_teacher(session_id: str, notification_data: dict):
    teacher_id = await get_session_teacher_id(session_id)
    if teacher_id:
        print(f"[Gateway] Sending notification to teacher {teacher_id} for session {session_id}")
        await sio.emit(
            "teacher_notification",
            notification_data,
            room=f"user:{teacher_id}"
        )
    
    # Still emit to session room for redundancy/other listeners
    await sio.emit(
        "teacher_notification",
        notification_data,
        room=f"session:{session_id}"
    )


def get_user_from_token(token: str) -> Optional[dict]:
    payload = decode_token(token)
    if not payload:
        return None
    
    token_type = payload.get("type")
    if token_type == "student":
        return {
            "type": "student",
            "id": payload.get("sub"),
            "session_id": payload.get("session_id"),
            "nickname": payload.get("nickname"),
        }
    elif token_type == "access":
        return {
            "type": "teacher",
            "id": payload.get("sub"),
            "tenant_id": payload.get("tenant_id"),
        }
    return None


@sio.event
async def connect(sid, environ, auth):
    token = auth.get("token") if auth else None
    if not token:
        print(f"[Gateway] Connection rejected: no token provided for sid {sid}")
        return False

    user = get_user_from_token(token)
    if not user:
        print(f"[Gateway] Connection rejected: invalid token for sid {sid}")
        return False

    print(f"[Gateway] User connected: {user.get('id')} ({user.get('type')}) sid={sid}")
    connected_users[sid] = user
    
    # All users join their personal room for DMs
    user_id = user["id"]
    await sio.enter_room(sid, f"user:{user_id}")

    if user["type"] == "student":
        session_id = user["session_id"]
        student_id = user["id"]
        nickname = user.get("nickname", "Studente")
        session_status = await get_session_status(session_id)
        if session_status != SessionStatus.ACTIVE:
            print(f"[Gateway] Connection rejected: student {student_id} session {session_id} not active ({session_status})")
            return False
        
        # Store nickname for later use
        student_nicknames[student_id] = nickname
        
        # Fetch and store avatar URL from database
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SessionStudent).where(SessionStudent.id == student_id)
                )
                student_obj = result.scalar_one_or_none()
                if student_obj:
                    if student_obj.is_frozen:
                        print(f"[Gateway] Connection rejected: student {student_id} frozen")
                        return False
                    if student_obj.avatar_url:
                        student_avatars[student_id] = student_obj.avatar_url
                    if student_obj.ui_accent:
                        student_accents[student_id] = student_obj.ui_accent
        except Exception as e:
            print(f"Error fetching student avatar: {e}")

        if session_id not in session_presence:
            session_presence[session_id] = set()
        session_presence[session_id].add(sid)
        print(f"[Gateway] Student {student_id} added to session {session_id}, total: {len(session_presence[session_id])}")

        await sio.enter_room(sid, f"session:{session_id}")
        # Also join personal room for private messages
        await sio.enter_room(sid, f"student:{student_id}")
        
        # Notify others in session
        await sio.emit(
            "presence_update",
            {
                "student_id": student_id,
                "nickname": nickname,
                "avatar_url": student_avatars.get(student_id),
                "ui_accent": student_accents.get(student_id),
                "status": "online",
                "last_seen_at": datetime.utcnow().isoformat(),
            },
            room=f"session:{session_id}",
            skip_sid=sid,
        )
        
        # Send teacher notification for student join
        await notify_session_teacher(
            session_id,
            {
                "type": "student_joined",
                "session_id": session_id,
                "student_id": student_id,
                "nickname": nickname,
                "message": f"{nickname} è entrato nella sessione",
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    else:
        teacher_id = user["id"]
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(User).where(User.id == teacher_id)
                )
                teacher_obj = result.scalar_one_or_none()
                if teacher_obj and teacher_obj.ui_accent:
                    teacher_accents[teacher_id] = teacher_obj.ui_accent
        except Exception as e:
            print(f"Error fetching teacher accent: {e}")
    
    return True


@sio.event
async def disconnect(sid):
    user = connected_users.pop(sid, None)
    if not user:
        print(f"[Gateway] Disconnect: unknown sid {sid}")
        return

    print(f"[Gateway] User disconnected: {user.get('id')} ({user.get('type')}) sid={sid}")

    if user["type"] == "student":
        session_id = user["session_id"]
        if session_id in session_presence:
            session_presence[session_id].discard(sid)
            print(f"[Gateway] Student {user['id']} removed from session {session_id}, remaining: {len(session_presence[session_id])}")
        
        user_activities.pop(user["id"], None)
        nickname = student_nicknames.get(user["id"], "Studente")
        
        await sio.emit(
            "presence_update",
            {
                "student_id": user["id"],
                "status": "offline",
                "last_seen_at": datetime.utcnow().isoformat(),
            },
            room=f"session:{session_id}",
        )
        
        # Send teacher notification for student leave
        await notify_session_teacher(
            session_id,
            {
                "type": "student_left",
                "session_id": session_id,
                "student_id": user["id"],
                "nickname": nickname,
                "message": f"{nickname} ha lasciato la sessione",
                "timestamp": datetime.utcnow().isoformat(),
            }
        )


@sio.event
async def join_session(sid, data):
    user = connected_users.get(sid)
    if not user:
        print(f"[Gateway] join_session failed: sid {sid} not authenticated")
        return {"error": "Not authenticated"}

    requested_session_id = data.get("session_id")
    session_id = user.get("session_id") if user.get("type") == "student" else requested_session_id
    if user.get("type") == "teacher" and not session_id:
        session_id = user.get("session_id")
    if not session_id:
        print(f"[Gateway] join_session failed: no session_id for user {user.get('id')}")
        return {"error": "Session ID required"}

    if not await can_user_access_session(user, session_id):
        print(f"[Gateway] join_session denied: user {user.get('id')} cannot access session {session_id}")
        return {"error": "Forbidden"}

    if user.get("type") == "student":
        session_status = await get_session_status(session_id)
        if session_status != SessionStatus.ACTIVE:
            print(f"[Gateway] join_session denied: student {user.get('id')} session {session_id} not active ({session_status})")
            return {"error": "Session unavailable"}

    print(f"[Gateway] User {user.get('id')} ({user.get('type')}) joining session {session_id}")
    await sio.enter_room(sid, f"session:{session_id}")
    
    # Add to presence set
    if session_id not in session_presence:
        session_presence[session_id] = set()
    session_presence[session_id].add(sid)

    # Broadcast presence update for this user (Teacher or Student)
    user_role = user.get("type", "student")
    nickname = student_nicknames.get(user["id"], user.get("nickname", "Studente")) if user_role == "student" else "Docente"
    avatar = student_avatars.get(user["id"]) if user_role == "student" else None
    accent = student_accents.get(user["id"]) if user_role == "student" else teacher_accents.get(user["id"])
    
    await sio.emit(
        "presence_update",
        {
            "student_id": user["id"],
            "nickname": nickname,
            "avatar_url": avatar,
            "ui_accent": accent,
            "status": "online",
            "role": user_role
        },
        room=f"session:{session_id}",
        skip_sid=sid,
    )

    # Get current online users
    online_users = []
    if session_id in session_presence:
        print(f"[Gateway] Session {session_id} has {len(session_presence[session_id])} connected sids")
        for s in session_presence[session_id]:
            u = connected_users.get(s)
            if u:
                role = u.get("type", "student")
                user_info = {
                    "student_id": u["id"],
                    "nickname": student_nicknames.get(u["id"], u.get("nickname", "Studente")) if role == "student" else "Docente",
                    "avatar_url": student_avatars.get(u["id"]) if role == "student" else None,
                    "ui_accent": student_accents.get(u["id"]) if role == "student" else teacher_accents.get(u["id"]),
                    "activity": user_activities.get(u["id"], {}) if role == "student" else None,
                    "role": role
                }
                # Avoid duplicates if multiple sids for same user (simple check)
                if not any(x['student_id'] == u['id'] for x in online_users):
                    online_users.append(user_info)
    else:
        print(f"[Gateway] Session {session_id} has no presence entries yet")

    print(f"[Gateway] Returning {len(online_users)} online users to {user.get('id')}")

    return {
        "session_id": session_id,
        "online_students": online_users, # Keep key for frontend compat, but contains all users
    }


@sio.event
async def heartbeat_activity(sid, data):
    user = connected_users.get(sid)
    if not user or user["type"] != "student":
        return
    
    student_id = user["id"]
    session_id = user["session_id"]
    session_status = await get_session_status(session_id)
    if session_status != SessionStatus.ACTIVE:
        await sio.emit(
            "session_access_revoked",
            {
                "session_id": session_id,
                "status": session_status.value if session_status else "unavailable",
                "reason": "La sessione non è attualmente disponibile.",
            },
            room=sid,
        )
        await sio.disconnect(sid)
        return
    
    activity = {
        "module_key": data.get("module_key"),
        "step": data.get("step"),
        "context": data.get("context"),
        "last_event": datetime.utcnow().isoformat(),
    }
    user_activities[student_id] = activity
    
    await sio.emit(
        "activity_update",
        {
            "student_id": student_id,
            **activity,
        },
        room=f"session:{session_id}",
        skip_sid=sid,
    )


@sio.event
async def teacher_set_modules(sid, data):
    user = connected_users.get(sid)
    if not user or user["type"] != "teacher":
        return {"error": "Teacher access required"}
    
    session_id = data.get("session_id")
    modules = data.get("modules", [])
    
    # TODO: Persist to database
    
    await sio.emit(
        "modules_updated",
        {"modules": modules},
        room=f"session:{session_id}",
    )
    
    return {"success": True}


@sio.event
async def teacher_freeze_user(sid, data):
    user = connected_users.get(sid)
    if not user or user["type"] != "teacher":
        return {"error": "Teacher access required"}
    
    session_id = data.get("session_id")
    student_id = data.get("student_id")
    reason = data.get("reason", "Frozen by teacher")
    
    # TODO: Persist to database
    
    await sio.emit(
        "user_frozen",
        {
            "student_id": student_id,
            "reason": reason,
        },
        room=f"session:{session_id}",
    )
    
    return {"success": True}


@sio.event
async def teacher_unfreeze_user(sid, data):
    user = connected_users.get(sid)
    if not user or user["type"] != "teacher":
        return {"error": "Teacher access required"}
    
    session_id = data.get("session_id")
    student_id = data.get("student_id")
    
    # TODO: Persist to database
    
    await sio.emit(
        "user_unfrozen",
        {"student_id": student_id},
        room=f"session:{session_id}",
    )
    
    return {"success": True}


@sio.event
async def chat_public_message(sid, data):
    user = connected_users.get(sid)
    if not user:
        return {"error": "Not authenticated"}
    
    session_id = data.get("session_id") or user.get("session_id")
    text = data.get("text", "")
    attachments = data.get("attachments", [])
    reply_to_id = data.get("reply_to_id")
    reply_preview = data.get("reply_preview")
    
    # Refresh sender metadata from DB for consistent cross-client rendering.
    if user["type"] == "student":
        sender_name = student_nicknames.get(user["id"], "Studente")
        sender_avatar_url = student_avatars.get(user["id"])
        sender_accent = student_accents.get(user["id"])
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(SessionStudent).where(SessionStudent.id == user["id"]))
                student_obj = result.scalar_one_or_none()
                if student_obj:
                    sender_name = student_obj.nickname or sender_name
                    sender_avatar_url = student_obj.avatar_url
                    sender_accent = student_obj.ui_accent
                    student_nicknames[user["id"]] = sender_name
                    if sender_avatar_url:
                        student_avatars[user["id"]] = sender_avatar_url
                    if sender_accent:
                        student_accents[user["id"]] = sender_accent
        except Exception as e:
            print(f"[Gateway] Error refreshing student sender metadata: {e}")
    else:
        sender_name = "Docente"
        sender_avatar_url = None  # TODO: Add teacher avatar support
        sender_accent = teacher_accents.get(user["id"])
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(User).where(User.id == user["id"]))
                teacher_obj = result.scalar_one_or_none()
                if teacher_obj:
                    sender_accent = teacher_obj.ui_accent
                    if sender_accent:
                        teacher_accents[user["id"]] = sender_accent
        except Exception as e:
            print(f"[Gateway] Error refreshing teacher sender accent: {e}")
    
    # Note: Message persistence is handled by the API endpoint (sendSessionMessage)
    # which is called before this socket event. This socket event only broadcasts
    # the message in real-time. The API has already saved to database.
    
    import uuid
    message = {
        "id": str(uuid.uuid4()),
        "sender_type": user["type"].upper(),
        "sender_id": user["id"],
        "sender_name": sender_name,
        "sender_avatar_url": sender_avatar_url,
        "sender_accent": sender_accent,
        "text": text,
        "attachments": attachments,
        "reply_to_id": reply_to_id,
        "reply_preview": reply_preview,
        "created_at": datetime.utcnow().isoformat(),
    }

    await sio.emit(
        "chat_message",
        {
            "room_type": "PUBLIC",
            "session_id": session_id,
            "message": message,
        },
        room=f"session:{session_id}",
    )
    
    # Send teacher notification for public chat if student
    if user["type"] == "student":
        await notify_session_teacher(
            session_id,
            {
                "type": "public_chat",
                "session_id": session_id,
                "student_id": user["id"],
                "nickname": sender_name,
                "message": f"{sender_name} ha inviato un messaggio nella chat di classe",
                "preview": text[:100] + ("..." if len(text) > 100 else ""),
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    return {"success": True}


@sio.event
async def chat_private_message(sid, data):
    user = connected_users.get(sid)
    if not user:
        return {"error": "Not authenticated"}
    
    target_id = data.get("target_id") or data.get("room_id")
    text = data.get("text", "")
    attachments = data.get("attachments", [])

    if not target_id:
        return {"error": "Target required"}

    session_id = user.get("session_id")
    if user["type"] == "student":
        if not session_id:
            return {"error": "Session unavailable"}
        if not await is_private_chat_enabled(session_id):
            return {"error": "Private chat disabled"}
        teacher_id = await get_session_teacher_id(session_id)
        if not teacher_id or str(target_id) != str(teacher_id):
            return {"error": "Students can only message the teacher privately"}
    else:
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SessionStudent).where(SessionStudent.id == target_id)
                )
                target_student = result.scalar_one_or_none()
                if not target_student:
                    return {"error": "Student not found in session"}
                session_id = str(target_student.session_id)
        except Exception as e:
            print(f"[Gateway] Error validating DM target {target_id}: {e}")
            return {"error": "Unable to validate DM target"}
    
    # Refresh sender metadata from DB for consistent cross-client rendering.
    if user["type"] == "student":
        sender_name = student_nicknames.get(user["id"], "Studente")
        sender_avatar_url = student_avatars.get(user["id"])
        sender_accent = student_accents.get(user["id"])
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(SessionStudent).where(SessionStudent.id == user["id"]))
                student_obj = result.scalar_one_or_none()
                if student_obj:
                    sender_name = student_obj.nickname or sender_name
                    sender_avatar_url = student_obj.avatar_url
                    sender_accent = student_obj.ui_accent
                    student_nicknames[user["id"]] = sender_name
                    if sender_avatar_url:
                        student_avatars[user["id"]] = sender_avatar_url
                    if sender_accent:
                        student_accents[user["id"]] = sender_accent
        except Exception as e:
            print(f"[Gateway] Error refreshing student DM sender metadata: {e}")
    else:
        sender_name = "Docente"
        sender_avatar_url = None  # TODO: Add teacher avatar support
        sender_accent = teacher_accents.get(user["id"])
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(User).where(User.id == user["id"]))
                teacher_obj = result.scalar_one_or_none()
                if teacher_obj:
                    sender_accent = teacher_obj.ui_accent
                    if sender_accent:
                        teacher_accents[user["id"]] = sender_accent
        except Exception as e:
            print(f"[Gateway] Error refreshing teacher DM sender accent: {e}")
    
    message = {
        "id": f"dm-{datetime.utcnow().timestamp()}",
        "sender_type": user["type"].upper(),
        "sender_id": user["id"],
        "sender_name": sender_name,
        "sender_avatar_url": sender_avatar_url,
        "sender_accent": sender_accent,
        "text": text,
        "attachments": attachments,
        "created_at": datetime.utcnow().isoformat(),
        "is_private": True,
    }
    
    # Send to target user's personal room
    await sio.emit(
        "chat_message",
        {
            "room_type": "DM",
            "target_id": target_id,
            "message": message,
        },
        room=f"user:{target_id}",
    )
    
    # Also send back to sender's other sessions/tabs
    await sio.emit(
        "chat_message",
        {
            "room_type": "DM",
            "target_id": target_id,
            "message": message,
        },
        room=f"user:{user['id']}",
    )
    
    # If target is a teacher (or student is messaging anyone), send notification if applicable
    # We can detect if target_id belongs to a teacher by checking connected_users
    is_target_teacher = False
    for u in connected_users.values():
        if u["id"] == target_id and u["type"] == "teacher":
            is_target_teacher = True
            break
            
    if is_target_teacher and user["type"] == "student":
        await notify_session_teacher(
            session_id,
            {
                "type": "private_message",
                "session_id": session_id,
                "student_id": user["id"],
                "nickname": sender_name,
                "message": f"{sender_name} ti ha inviato un messaggio privato",
                "preview": text[:50] + ("..." if len(text) > 50 else ""),
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    
    return {"success": True}


@sio.event
async def llm_prompt_submitted(sid, data):
    user = connected_users.get(sid)
    if not user or user["type"] != "student":
        return
    
    session_id = user["session_id"]
    
    await sio.emit(
        "llm_user_prompt_submitted",
        {
            "student_id": user["id"],
            "conversation_id": data.get("conversation_id"),
            "preview": data.get("preview", "")[:200],
        },
        room=f"session:{session_id}",
        skip_sid=sid,
    )


@sio.event
async def teacher_publish_task(sid, data):
    """Teacher publishes a task - notify all students in session"""
    user = connected_users.get(sid)
    if not user or user["type"] != "teacher":
        return {"error": "Teacher access required"}
    
    session_id = data.get("session_id")
    task_id = data.get("task_id")
    title = data.get("title")
    task_type = data.get("task_type", "exercise")
    
    await sio.emit(
        "task_published",
        {
            "task_id": task_id,
            "title": title,
            "task_type": task_type,
        },
        room=f"session:{session_id}",
    )
    
    # Also send as chat message
    await sio.emit(
        "chat_message",
        {
            "room_type": "PUBLIC",
            "session_id": session_id,
            "message": {
                "sender_type": "TEACHER",
                "sender_id": user["id"],
                "sender_name": "Docente",
                "sender_accent": teacher_accents.get(user["id"]),
                "text": f"📋 Nuovo compito assegnato: {title}",
                "created_at": datetime.utcnow().isoformat(),
                "is_notification": True,
                "notification_type": task_type,
                "notification_data": {"task_id": task_id, "title": title},
            },
        },
        room=f"session:{session_id}",
    )
    
    return {"success": True}


@sio.event
async def teacher_upload_document(sid, data):
    """Teacher uploads a document - notify all students in session"""
    user = connected_users.get(sid)
    if not user or user["type"] != "teacher":
        return {"error": "Teacher access required"}
    
    session_id = data.get("session_id")
    document_id = data.get("document_id")
    filename = data.get("filename")
    
    await sio.emit(
        "document_uploaded",
        {
            "document_id": document_id,
            "filename": filename,
        },
        room=f"session:{session_id}",
    )
    
    # Also send as chat message
    await sio.emit(
        "chat_message",
        {
            "room_type": "PUBLIC",
            "session_id": session_id,
            "message": {
                "sender_type": "TEACHER",
                "sender_id": user["id"],
                "sender_name": "Docente",
                "sender_accent": teacher_accents.get(user["id"]),
                "text": f"📄 Nuovo documento caricato: {filename}",
                "created_at": datetime.utcnow().isoformat(),
                "is_notification": True,
                "notification_type": "document",
                "notification_data": {"document_id": document_id, "filename": filename},
            },
        },
        room=f"session:{session_id}",
    )
    
    return {"success": True}


@sio.event
async def teacher_broadcast_message(sid, data):
    """Teacher sends a broadcast message to all students"""
    user = connected_users.get(sid)
    if not user or user["type"] != "teacher":
        return {"error": "Teacher access required"}
    
    session_id = data.get("session_id")
    text = data.get("text", "")
    
    message = {
        "sender_type": "TEACHER",
        "sender_id": user["id"],
        "sender_name": "Docente",
        "sender_accent": teacher_accents.get(user["id"]),
        "text": text,
        "created_at": datetime.utcnow().isoformat(),
    }
    
    await sio.emit(
        "chat_message",
        {
            "room_type": "PUBLIC",
            "session_id": session_id,
            "message": message,
        },
        room=f"session:{session_id}",
    )
    
    return {"success": True}


@sio.event
async def canvas_item_lock(sid, data):
    user = connected_users.get(sid)
    if not user:
        return {"error": "Not authenticated"}

    session_id = data.get("session_id")
    item_id = data.get("item_id")
    if not session_id or not item_id:
        return {"error": "session_id and item_id required"}

    if not await can_user_access_session(user, session_id):
        return {"error": "Forbidden"}

    await sio.emit(
        "canvas_item_lock",
        {
            "session_id": session_id,
            "item_id": item_id,
            "user_id": user.get("id"),
            "user_type": user.get("type"),
        },
        room=f"session:{session_id}",
    )
    return {"success": True}


@sio.event
async def canvas_item_unlock(sid, data):
    user = connected_users.get(sid)
    if not user:
        return {"error": "Not authenticated"}

    session_id = data.get("session_id")
    item_id = data.get("item_id")
    if not session_id or not item_id:
        return {"error": "session_id and item_id required"}

    if not await can_user_access_session(user, session_id):
        return {"error": "Forbidden"}

    await sio.emit(
        "canvas_item_unlock",
        {
            "session_id": session_id,
            "item_id": item_id,
            "user_id": user.get("id"),
            "user_type": user.get("type"),
        },
        room=f"session:{session_id}",
    )
    return {"success": True}


# Helper function to broadcast from API endpoints
async def broadcast_to_session(session_id: str, event: str, data: dict):
    """Broadcast an event to all users in a session"""
    await sio.emit(event, data, room=f"session:{session_id}")


async def notify_teacher_content_alert(
    session_id: str,
    alert_id: str,
    student_id: str,
    nickname: str,
    alert_type: str,
    risk_score: float,
    preview: str,
):
    """Emit a content_alert notification to the teacher of the given session."""
    _ALERT_LABELS = {
        "vulgar": "contenuto volgare",
        "sexual": "contenuto sessuale",
        "offensive": "contenuto offensivo",
        "threatening": "contenuto minaccioso",
        "pii_detected": "dati personali rilevati",
    }
    label = _ALERT_LABELS.get(alert_type, alert_type)
    await notify_session_teacher(
        session_id,
        {
            "type": "content_alert",
            "alert_id": alert_id,
            "session_id": session_id,
            "student_id": student_id,
            "nickname": nickname,
            "alert_type": alert_type,
            "risk_score": risk_score,
            "message": f"⚠️ Allarme sicurezza: {nickname} — {label}",
            "preview": preview[:120] + ("..." if len(preview) > 120 else ""),
            "timestamp": datetime.utcnow().isoformat(),
        },
    )
