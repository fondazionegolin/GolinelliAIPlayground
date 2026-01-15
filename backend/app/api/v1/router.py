from fastapi import APIRouter

from app.api.v1.endpoints import auth, admin, teacher, student, chat, llm, rag, ml, assessment, files

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(teacher.router, prefix="/teacher", tags=["teacher"])
api_router.include_router(student.router, prefix="/student", tags=["student"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(llm.router, prefix="/llm", tags=["llm"])
api_router.include_router(rag.router, prefix="/rag", tags=["rag"])
api_router.include_router(ml.router, prefix="/ml", tags=["ml"])
api_router.include_router(assessment.router, prefix="/self", tags=["self-assessment"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
