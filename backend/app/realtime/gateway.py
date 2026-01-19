import socketio
from datetime import datetime
from typing import Optional
import json

from app.core.security import decode_token
from app.core.config import settings

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
        return False
    
    user = get_user_from_token(token)
    if not user:
        return False
    
    connected_users[sid] = user
    
    if user["type"] == "student":
        session_id = user["session_id"]
        student_id = user["id"]
        nickname = user.get("nickname", "Studente")
        
        # Store nickname for later use
        student_nicknames[student_id] = nickname
        
        if session_id not in session_presence:
            session_presence[session_id] = set()
        session_presence[session_id].add(sid)
        
        await sio.enter_room(sid, f"session:{session_id}")
        # Also join personal room for private messages
        await sio.enter_room(sid, f"student:{student_id}")
        
        # Notify others in session
        await sio.emit(
            "presence_update",
            {
                "student_id": student_id,
                "nickname": nickname,
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
        return
    
    if user["type"] == "student":
        session_id = user["session_id"]
        if session_id in session_presence:
            session_presence[session_id].discard(sid)
        
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
        return {"error": "Not authenticated"}
    
    session_id = data.get("session_id") or user.get("session_id")
    if not session_id:
        return {"error": "Session ID required"}
    
    await sio.enter_room(sid, f"session:{session_id}")
    
    # Get current online users
    online_students = []
    if session_id in session_presence:
        for s in session_presence[session_id]:
            u = connected_users.get(s)
            if u and u["type"] == "student":
                online_students.append({
                    "student_id": u["id"],
                    "nickname": student_nicknames.get(u["id"], u.get("nickname", "Studente")),
                    "activity": user_activities.get(u["id"], {}),
                })
    
    # Also emit presence updates for all online students to the joining user
    for student in online_students:
        await sio.emit(
            "presence_update",
            {
                "student_id": student["student_id"],
                "nickname": student["nickname"],
                "status": "online",
            },
            to=sid,
        )
    
    return {
        "session_id": session_id,
        "online_students": online_students,
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
    
    # Get sender name
    if user["type"] == "student":
        sender_name = student_nicknames.get(user["id"], "Studente")
    else:
        sender_name = "Docente"
    
    message = {
        "sender_type": user["type"].upper(),
        "sender_id": user["id"],
        "sender_name": sender_name,
        "text": text,
        "attachments": attachments,
        "created_at": datetime.utcnow().isoformat(),
    }
    
    # TODO: Persist to database
    
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
    
    # Get sender name
    if user["type"] == "student":
        sender_name = student_nicknames.get(user["id"], "Studente")
    else:
        sender_name = "Docente"
    
    message = {
        "id": f"dm-{datetime.utcnow().timestamp()}",
        "sender_type": user["type"].upper(),
        "sender_id": user["id"],
        "sender_name": sender_name,
        "text": text,
        "attachments": attachments,
        "created_at": datetime.utcnow().isoformat(),
        "is_private": True,
    }
    
    # Send to target user's personal room
    if target_id == "teacher":
        # Student messaging teacher - send to all teacher sids in session
        session_id = user.get("session_id")
        for s, u in connected_users.items():
            if u["type"] == "teacher":
                await sio.emit(
                    "chat_message",
                    {
                        "room_type": "DM",
                        "target_id": target_id,
                        "message": message,
                    },
                    room=s,
                )
        # Also send back to sender
        await sio.emit(
            "chat_message",
            {
                "room_type": "DM",
                "target_id": target_id,
                "message": message,
            },
            room=sid,
        )
        
        # Send teacher notification for private message from student
        if user["type"] == "student":
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
    else:
        # Teacher or student messaging a student
        await sio.emit(
            "chat_message",
            {
                "room_type": "DM",
                "target_id": target_id,
                "message": message,
            },
            room=f"student:{target_id}",
        )
        # Also send back to sender if different
        await sio.emit(
            "chat_message",
            {
                "room_type": "DM",
                "target_id": target_id,
                "message": message,
            },
            room=sid,
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
