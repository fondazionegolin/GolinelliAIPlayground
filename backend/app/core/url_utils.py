from app.core.config import settings


def resolve_frontend_url(origin: str | None = None) -> str:
    candidate = (origin or "").strip()
    if candidate.startswith("http://") or candidate.startswith("https://"):
        return candidate.rstrip("/")
    return settings.FRONTEND_URL.rstrip("/")
