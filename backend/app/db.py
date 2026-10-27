"""
Supabase access.

This module owns the one and only Supabase client. It is created with the
service_role key, which BYPASSES row level security — so every query made
through it must filter by business_id explicitly. That discipline lives in
app/repositories/.
"""

import logging
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from app.config import settings

logger = logging.getLogger("aibh.db")


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Build the Supabase client once and reuse it."""
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env"
        )
    logger.info("Connecting to Supabase at %s", settings.supabase_url)
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


# Imported everywhere as:  from app.db import db
db: Client = get_client()


def rows(response: Any) -> list[dict]:
    """
    Normalise a supabase-py response to a plain list of dicts.

    The SDK returns an object with a .data attribute. Unwrapping it here means
    the rest of the codebase deals in ordinary Python lists.
    """
    data = getattr(response, "data", None)
    if data is None:
        return []
    if isinstance(data, dict):
        return [data]
    return list(data)


def one(response: Any) -> dict | None:
    """First row of a response, or None when nothing matched."""
    found = rows(response)
    return found[0] if found else None


def ping() -> dict:
    """
    Prove the connection works by reading one row from a table we know exists.
    Used by the /health/db route.
    """
    try:
        response = db.table("businesses").select("id, name, chat_slug").limit(1).execute()
        found = rows(response)
        return {
            "connected": True,
            "businesses_visible": len(found),
            "sample": found[0]["name"] if found else None,
            "chat_slug": found[0]["chat_slug"] if found else None,
        }
    except Exception as exc:  # noqa: BLE001 - health checks report, never raise
        logger.exception("Supabase ping failed")
        return {"connected": False, "error": str(exc)}