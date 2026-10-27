"""Agent execution logs — the audit trail, and future training data."""

import logging

from app.db import db, rows

logger = logging.getLogger("aibh.logs")


def record(
    *,
    business_id: str,
    agent_key: str,
    model: str,
    input_text: str,
    output_text: str,
    tool_calls: list | None = None,
    latency_ms: int = 0,
    conversation_id: str | None = None,
    status: str = "ok",
    error: str | None = None,
) -> None:
    """
    Fire-and-forget. Logging must never break the customer's reply, so any
    failure here is swallowed and reported to the server log instead.
    """
    try:
        db.table("agent_logs").insert(
            {
                "business_id": business_id,
                "conversation_id": conversation_id,
                "agent_key": agent_key,
                "model": model,
                "input_text": input_text[:4000],
                "output_text": output_text[:4000],
                "tool_calls": tool_calls or [],
                "latency_ms": latency_ms,
                "status": status,
                "error": error,
            }
        ).execute()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to write agent log (continuing anyway)")


def recent(business_id: str, limit: int = 50) -> list[dict]:
    return rows(
        db.table("agent_logs")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )