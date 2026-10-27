"""
Anonymous chat sessions.

One row per browser tab that opened a chat link. The raw token exists only in
the visitor's browser; we store its SHA-256 hash.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import db, one


def new_token() -> str:
    """A 43-character URL-safe random string. Never stored in this form."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def hash_ip(ip: str | None) -> str | None:
    """
    Salted hash of the visitor's IP.

    Enough to count requests per address; not enough to identify a person.
    The salt means the stored value cannot be reversed by hashing all four
    billion IPv4 addresses.
    """
    if not ip:
        return None
    return hashlib.sha256(f"{settings.ip_hash_salt}:{ip}".encode("utf-8")).hexdigest()


def create(
    *,
    business_id: str,
    conversation_id: str,
    token: str,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    expires = datetime.now(timezone.utc) + timedelta(days=settings.chat_session_ttl_days)
    created = one(
        db.table("chat_sessions")
        .insert(
            {
                "business_id": business_id,
                "conversation_id": conversation_id,
                "token_hash": hash_token(token),
                "ip_hash": hash_ip(ip),
                "user_agent": (user_agent or "")[:400],
                "expires_at": expires.isoformat(),
            }
        )
        .execute()
    )
    if not created:
        raise RuntimeError("Could not create chat session")
    return created


def resolve(token: str) -> dict | None:
    """Find a live session by its raw token. Expired sessions return None."""
    if not token:
        return None

    row = one(
        db.table("chat_sessions")
        .select("*")
        .eq("token_hash", hash_token(token))
        .limit(1)
        .execute()
    )
    if row is None:
        return None

    try:
        expires = datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00"))
    except ValueError:
        return None

    if expires < datetime.now(timezone.utc):
        return None

    return row


def touch(session_id: str, message_count: int) -> None:
    db.table("chat_sessions").update(
        {
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
            "message_count": message_count,
        }
    ).eq("id", session_id).execute()