"""Answer keys that travel with the board without being readable by the learner.

A key written by the assistant (`check.expected`) is stored in the board and in the conversation, both of which the client downloads.
Sealing makes it opaque to the client; only the server (when it validates an answer) can open it. Stdlib only: a keyed
stream (HMAC-SHA256 in counter mode) with an authentication tag. It hides the key from casual inspection of the page and the
network; it is not meant to resist someone who controls the server."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

from app.core.config import settings

PREFIX = "sealed:"


def _key() -> bytes:
    return hashlib.sha256(("canvas-seal:" + settings.SECRET_KEY).encode()).digest()


def _stream(nonce: bytes, n: int) -> bytes:
    out, counter = b"", 0
    while len(out) < n:
        out += hmac.new(_key(), nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    return out[:n]


def seal(text: str) -> str:
    if text.startswith(PREFIX):
        return text
    data = text.encode()
    nonce = os.urandom(12)
    body = bytes(a ^ b for a, b in zip(data, _stream(nonce, len(data))))
    tag = hmac.new(_key(), nonce + body, hashlib.sha256).digest()[:16]
    return PREFIX + base64.urlsafe_b64encode(nonce + body + tag).decode().rstrip("=")


def unseal(token: str) -> str:
    """Plain text of a sealed key; a key that was never sealed (older boards) is returned as is."""
    if not token.startswith(PREFIX):
        return token
    raw = base64.urlsafe_b64decode(token[len(PREFIX):] + "=" * (-len(token[len(PREFIX):]) % 4))
    nonce, body, tag = raw[:12], raw[12:-16], raw[-16:]
    if not hmac.compare_digest(tag, hmac.new(_key(), nonce + body, hashlib.sha256).digest()[:16]):
        raise ValueError("chiave non valida")
    return bytes(a ^ b for a, b in zip(body, _stream(nonce, len(body)))).decode()
