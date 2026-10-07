import asyncio
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from pathlib import Path

from app.core.config import settings
from app.api.v1.router import api_router
from app.api.v1.endpoints.coding import public_router as coding_public_router
from app.realtime.gateway import socket_app
from app.services.storage_service import storage_service

# Prometheus metrics
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)
REQUEST_DURATION = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'endpoint']
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await storage_service.ensure_bucket()
    from app.services.toy_lm_trainer import toy_lm_service
    toy_lm_service.start_queue_processor()
    from app.services.background_jobs import mark_interrupted_jobs
    await mark_interrupted_jobs()
    from app.services import model_catalog
    await model_catalog.load_runtime_prices()
    from app.services import model_roles
    try:
        await model_roles.load_overrides()
    except Exception:
        pass  # table may not exist yet before the first migration
    scan_task = asyncio.create_task(model_catalog.scan_loop())
    roles_task = asyncio.create_task(model_roles.refresh_loop())
    yield
    scan_task.cancel()
    roles_task.cancel()
    # Shutdown


from app.services.ui_language import normalize_response_length, response_length_var

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

class ResponseLengthMiddleware:
    """Expose the X-Response-Length header (concise | extended | in_depth) to prompt builders via a ContextVar."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        raw = next((value for key, value in scope.get("headers", []) if key == b"x-response-length"), b"").decode("latin-1")
        token = response_length_var.set(normalize_response_length(raw))
        try:
            await self.app(scope, receive, send)
        finally:
            response_length_var.reset(token)


app.add_middleware(ResponseLengthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.all_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)
app.include_router(coding_public_router)

# Mount Socket.IO
app.mount("/socket.io", socket_app)

# Mount static files for chat uploads
uploads_dir = Path("uploads")
uploads_dir.mkdir(exist_ok=True)


class PublicUploads(StaticFiles):
    """Chat uploads are public by URL; drive blobs share the volume but are served only via /api/v1/drive."""

    async def get_response(self, path, scope):
        normalized = path.replace("\\", "/").lstrip("/")
        if normalized == "drive" or normalized.startswith("drive/"):
            from starlette.exceptions import HTTPException as StarletteHTTPException
            raise StarletteHTTPException(status_code=404)
        return await super().get_response(path, scope)


app.mount("/uploads", PublicUploads(directory="uploads"), name="uploads")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": settings.VERSION}


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
