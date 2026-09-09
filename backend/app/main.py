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
    yield
    # Shutdown


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

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
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": settings.VERSION}


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
