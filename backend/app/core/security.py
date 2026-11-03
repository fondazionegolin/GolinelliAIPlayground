from datetime import datetime, timedelta
from typing import Optional, Any
import bcrypt
import jwt
from starlette.concurrency import run_in_threadpool
from app.core.config import settings
import secrets
import hashlib

# bcrypt only reads the first 72 bytes; truncate explicitly (as passlib did)
# so newer bcrypt releases, which raise on longer input, behave the same.
_BCRYPT_MAX_BYTES = 72


def _password_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(_password_bytes(plain_password), hashed_password.encode("utf-8"))
    except (ValueError, TypeError, AttributeError):
        return False


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt()).decode("utf-8")


# bcrypt costs ~200ms of CPU per call: run it off the event loop so a class
# logging in at once doesn't stall every other request on the worker.
async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    return await run_in_threadpool(verify_password, plain_password, hashed_password)


async def hash_password_async(password: str) -> str:
    return await run_in_threadpool(get_password_hash, password)


def create_access_token(
    subject: str,
    token_type: str = "access",
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[dict[str, Any]] = None,
) -> str:
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {
        "sub": subject,
        "type": token_type,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    if extra_claims:
        to_encode.update(extra_claims)
    
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict[str, Any]]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


def create_student_join_token(
    session_id: str,
    student_id: str,
    nickname: str = None,
    extra_claims: Optional[dict[str, Any]] = None,
    expires_delta: Optional[timedelta] = None,
) -> str:
    expires = expires_delta or timedelta(hours=settings.STUDENT_TOKEN_EXPIRE_HOURS)
    token_claims: dict[str, Any] = {"session_id": session_id}
    if nickname:
        token_claims["nickname"] = nickname
    if extra_claims:
        token_claims.update(extra_claims)
    return create_access_token(
        subject=student_id,
        token_type="student",
        expires_delta=expires,
        extra_claims=token_claims,
    )


def generate_join_code(length: int = 5) -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(chars) for _ in range(length))


def compute_file_checksum(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
