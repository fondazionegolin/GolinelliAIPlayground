from fastapi import APIRouter

from app.api.v1.endpoints import auth, admin, admin_backend, teacher, student, chat, llm, rag, ml, assessment, files, teacherbots, admin_credits, alerts, stt, uda, media, feedback, notebooks, desktop, calendar, meshy, voice, coding, hardware, boards, collaboration, system_health
from app.api.v1.endpoints.live_interaction import teacher_router as live_teacher_router, student_router as live_student_router
from app.api.v1.endpoints import toy_lm

api_router = APIRouter()

api_router.include_router(system_health.router, prefix="/system", tags=["system"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_backend.router, tags=["admin-backend"])
api_router.include_router(teacher.router, prefix="/teacher", tags=["teacher"])
api_router.include_router(student.router, prefix="/student", tags=["student"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(llm.router, prefix="/llm", tags=["llm"])
api_router.include_router(rag.router, prefix="/rag", tags=["rag"])
api_router.include_router(ml.router, prefix="/ml", tags=["ml"])
api_router.include_router(assessment.router, prefix="/self", tags=["self-assessment"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
api_router.include_router(teacherbots.router, tags=["teacherbots"])
api_router.include_router(admin_credits.router, prefix="/credits", tags=["credits"])
api_router.include_router(alerts.router, prefix="/alerts", tags=["alerts"])
api_router.include_router(stt.router, prefix="/stt", tags=["stt"])
api_router.include_router(uda.router, tags=["uda"])
api_router.include_router(media.router, prefix="/media", tags=["media"])
api_router.include_router(feedback.router, prefix="/feedback", tags=["feedback"])
api_router.include_router(boards.router, prefix="/boards", tags=["boards"])
api_router.include_router(notebooks.router, tags=["notebooks"])
api_router.include_router(desktop.router, tags=["desktop"])
api_router.include_router(calendar.router, tags=["calendar"])
api_router.include_router(meshy.router, prefix="/meshy", tags=["meshy"])
api_router.include_router(voice.router, prefix="/voice", tags=["voice"])
api_router.include_router(live_teacher_router, prefix="/teacher", tags=["live-interaction"])
api_router.include_router(live_student_router, prefix="/student", tags=["live-interaction"])
api_router.include_router(toy_lm.router, prefix="/toy-lm", tags=["toy-lm"])
api_router.include_router(coding.router, prefix="/coding", tags=["coding"])
api_router.include_router(hardware.router, prefix="/hardware", tags=["hardware"])
api_router.include_router(collaboration.router, tags=["collaboration"])
