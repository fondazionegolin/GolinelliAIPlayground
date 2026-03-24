from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from minio.error import S3Error

from app.services.storage_service import storage_service

router = APIRouter()

_CONTENT_TYPES = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'gif': 'image/gif',
}


@router.get("/avatar/{key:path}")
async def get_avatar(key: str):
    """Serve avatar images stored in MinIO. Public endpoint (no auth required)."""
    try:
        data = storage_service.download_file(key)
    except S3Error:
        raise HTTPException(status_code=404, detail="Avatar not found")
    ext = key.rsplit('.', 1)[-1].lower()
    content_type = _CONTENT_TYPES.get(ext, 'image/jpeg')
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
