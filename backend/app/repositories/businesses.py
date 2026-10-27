
from app.db import db, one, rows


def get_business(business_id: str) -> dict | None:
    return one(
        db.table("businesses").select("*").eq("id", business_id).limit(1).execute()
    )


def get_business_by_chat_slug(chat_slug: str) -> dict | None:
    """
    Resolves the public chat URL to a tenant.

    This is the entry point for every anonymous visitor, so it also checks the
    business is active and has the chat channel switched on.
    """
    return one(
        db.table("businesses")
        .select("*")
        .eq("chat_slug", (chat_slug or "").strip().lower())
        .eq("is_active", True)
        .eq("chat_enabled", True)
        .limit(1)
        .execute()
    )


def list_services(business_id: str) -> list[dict]:
    return rows(
        db.table("business_services")
        .select("id, name, description, duration_minutes, price, price_note")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .order("sort_order")
        .execute()
    )


def is_agent_active(business_id: str, agent_key: str) -> bool:
    """
    The subscription gate. If a business has not activated an agent, the
    platform must not run it — this is how you charge per agent.
    """
    row = one(
        db.table("agent_subscriptions")
        .select("is_active")
        .eq("business_id", business_id)
        .eq("agent_key", agent_key)
        .limit(1)
        .execute()
    )
    return bool(row and row.get("is_active"))


def agent_settings(business_id: str, agent_key: str) -> dict:
    row = one(
        db.table("agent_subscriptions")
        .select("settings")
        .eq("business_id", business_id)
        .eq("agent_key", agent_key)
        .limit(1)
        .execute()
    )
    return (row or {}).get("settings") or {}


def update_agent_settings(business_id: str, agent_key: str, patch: dict) -> dict:
    """Merge `patch` into one subscription's settings and return the result."""
    merged = {**agent_settings(business_id, agent_key), **patch}
    db.table("agent_subscriptions").update({"settings": merged}).eq(
        "business_id", business_id
    ).eq("agent_key", agent_key).execute()
    return merged