"""Liveness and configuration checks."""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import settings
from app.db import ping
from app.agents.llm import describe_error, ping_llm

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    """Cheap liveness probe. Touches nothing external."""
    return {
        "status": "ok",
        "env": settings.app_env,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health/config")
def health_config() -> dict:
    """Shows which credentials are loaded. Values are masked, never raw."""
    return {"status": "ok", "config": settings.masked()}


@router.get("/health/db")
def health_db() -> dict:
    """Round-trips a real query to Supabase."""
    result = ping()
    return {"status": "ok" if result.get("connected") else "error", "database": result}

@router.get("/health/llm")
def health_llm() -> dict:
    """Round-trips one tiny prompt to OpenRouter. Costs a handful of tokens."""
    try:
        return {
            "status": "ok",
            "model": settings.llm_model,
            "base_url": settings.llm_base_url,
            "reply": ping_llm(),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "model": settings.llm_model,
            "base_url": settings.llm_base_url,
            "error": describe_error(exc),
        }