import socketio
from datetime import datetime
from typing import Optional
import json

from app.core.security import decode_token
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.session import SessionStudent
from sqlalchemy import select

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.CORS_ORIGINS,
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
        
        # Store nickname for later use
        student_nicknames[student_id] = nickname
        
        # Fetch and store avatar URL from database
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SessionStudent).where(SessionStudent.id == student_id)
                )
                student_obj = result.scalar_one_or_none()
                if student_obj and student_obj.avatar_url:
                    student_avatars[student_id] = student_obj.avatar_url
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
                "status": "online",
                "last_seen_at": datetime.utcnow().isoformat(),
            },
            room=f"session:{session_id}",
            skip_sid=sid,
        )
        
        # Send teacher notification for student join
        await sio.emit(
            "teacher_notification",
            {
                "type": "student_joined",
                "session_id": session_id,
                "student_id": student_id,
                "nickname": nickname,
                "message": f"{nickname} è entrato nella sessione",
                "timestamp": datetime.utcnow().isoformat(),
            },
            room=f"session:{session_id}",
        )
    
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
        await sio.emit(
            "teacher_notification",
            {
                "type": "student_left",
                "session_id": session_id,
                "student_id": user["id"],
                "nickname": nickname,
                "message": f"{nickname} ha lasciato la sessione",
                "timestamp": datetime.utcnow().isoformat(),
            },
            room=f"session:{session_id}",
        )


@sio.event
async def join_session(sid, data):
    user = connected_users.get(sid)
    if not user:
        print(f"[Gateway] join_session failed: sid {sid} not authenticated")
        return {"error": "Not authenticated"}

    session_id = data.get("session_id") or user.get("session_id")
    if not session_id:
        print(f"[Gateway] join_session failed: no session_id for user {user.get('id')}")
        return {"error": "Session ID required"}

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
    
    await sio.emit(
        "presence_update",
        {
            "student_id": user["id"],
            "nickname": nickname,
            "avatar_url": avatar,
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
    
    # Get sender name and avatar
    if user["type"] == "student":
        sender_name = student_nicknames.get(user["id"], "Studente")
        sender_avatar_url = student_avatars.get(user["id"])
    else:
        sender_name = "Docente"
        sender_avatar_url = None  # TODO: Add teacher avatar support
    
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
        "text": text,
        "attachments": attachments,
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
async def chat_private_message(sid, data):
    user = connected_users.get(sid)
    if not user:
        return {"error": "Not authenticated"}
    
    target_id = data.get("target_id") or data.get("room_id")
    text = data.get("text", "")
    attachments = data.get("attachments", [])
    
    # Get sender name and avatar
    if user["type"] == "student":
        sender_name = student_nicknames.get(user["id"], "Studente")
        sender_avatar_url = student_avatars.get(user["id"])
    else:
        sender_name = "Docente"
        sender_avatar_url = None  # TODO: Add teacher avatar support
    
    message = {
        "id": f"dm-{datetime.utcnow().timestamp()}",
        "sender_type": user["type"].upper(),
        "sender_id": user["id"],
        "sender_name": sender_name,
        "sender_avatar_url": sender_avatar_url,
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
        session_id = user.get("session_id")
        await sio.emit(
            "teacher_notification",
            {
                "type": "private_message",
                "session_id": session_id,
                "student_id": user["id"],
                "nickname": sender_name,
                "message": f"{sender_name} ti ha inviato un messaggio privato",
                "preview": text[:50] + ("..." if len(text) > 50 else ""),
                "timestamp": datetime.utcnow().isoformat(),
            },
            room=f"session:{session_id}",
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


# Helper function to broadcast from API endpoints
async def broadcast_to_session(session_id: str, event: str, data: dict):
    """Broadcast an event to all users in a session"""
    await sio.emit(event, data, room=f"session:{session_id}")
