from datetime import datetime, timedelta
from typing import Optional, Any
from jose import jwt, JWTError
from passlib.context import CryptContext
from app.core.config import settings
import secrets
import hashlib

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


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
    except JWTError:
        return None


def create_student_join_token(session_id: str, student_id: str, nickname: str = None) -> str:
    expires = timedelta(hours=settings.STUDENT_TOKEN_EXPIRE_HOURS)
    extra_claims = {"session_id": session_id}
    if nickname:
        extra_claims["nickname"] = nickname
    return create_access_token(
        subject=student_id,
        token_type="student",
        expires_delta=expires,
        extra_claims=extra_claims,
    )


def generate_join_code(length: int = 5) -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(chars) for _ in range(length))


def compute_file_checksum(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
