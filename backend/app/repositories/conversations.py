"""Chat threads and the messages inside them."""

import random
from datetime import datetime, timezone

from app.db import db, one, rows


def create(business_id: str, channel: str = "web") -> dict:
    """
    A new anonymous thread. No customer yet — one appears only if the visitor
    chooses to leave their details.
    """
    label = f"Visitor {random.randint(1000, 9999)}"
    created = one(
        db.table("conversations")
        .insert({"business_id": business_id, "channel": channel, "visitor_label": label})
        .execute()
    )
    if not created:
        raise RuntimeError("Could not create conversation")
    return created


def get(business_id: str, conversation_id: str) -> dict | None:
    return one(
        db.table("conversations")
        .select("*, customers(id, name, phone, email)")
        .eq("business_id", business_id)
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )


def add_message(
    *,
    business_id: str,
    conversation_id: str,
    direction: str,
    author: str,
    body: str,
    meta: dict | None = None,
) -> dict:
    """
    Append one chat turn, and keep the conversation summary in sync.

    Two writes on purpose: the messages row is the permanent record, the
    conversation row is a denormalised summary so the owner's inbox can be
    rendered without reading every message.
    """
    created = one(
        db.table("messages")
        .insert(
            {
                "business_id": business_id,
                "conversation_id": conversation_id,
                "direction": direction,
                "author": author,
                "body": body,
                "meta": meta or {},
            }
        )
        .execute()
    )

    current = one(
        db.table("conversations")
        .select("message_count")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )
    db.table("conversations").update(
        {
            "last_message_at": datetime.now(timezone.utc).isoformat(),
            "last_message_preview": (body or "")[:140],
            "message_count": ((current or {}).get("message_count") or 0) + 1,
        }
    ).eq("id", conversation_id).execute()

    if not created:
        raise RuntimeError("Could not store message")
    return created


def history(conversation_id: str, limit: int = 12) -> list[dict]:
    """
    The last `limit` messages, oldest first.

    Fetched newest-first so the limit keeps the RECENT ones, then reversed,
    because an LLM needs them in chronological order.
    """
    found = rows(
        db.table("messages")
        .select("author, body, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(found))


def messages_for(business_id: str, conversation_id: str, limit: int = 200) -> list[dict]:
    return rows(
        db.table("messages")
        .select("*")
        .eq("business_id", business_id)
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .limit(limit)
        .execute()
    )


def messages_for_many(
    business_id: str, conversation_ids: list[str], limit: int = 2000
) -> dict[str, list[dict]]:
    """
    Every message for a set of conversations, in ONE query, grouped by thread.

    The inbox used to call messages_for() inside a loop: fifty conversations
    meant fifty-one round trips to Supabase and about five seconds. Each query
    was fast; there were simply far too many of them. This is the same data in
    two queries.

    `limit` is a ceiling across all threads together, so one very long
    conversation cannot starve the others of rows - the newest are kept.
    """
    if not conversation_ids:
        return {}

    found = rows(
        db.table("messages")
        .select("*")
        .eq("business_id", business_id)
        .in_("conversation_id", conversation_ids)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    grouped: dict[str, list[dict]] = {cid: [] for cid in conversation_ids}
    for message in found:
        grouped.setdefault(message["conversation_id"], []).append(message)
    # Fetched newest-first for the limit; the screen reads oldest-first.
    for thread in grouped.values():
        thread.reverse()
    return grouped


def list_conversations(business_id: str, limit: int = 50) -> list[dict]:
    """Owner inbox: threads newest-activity first, with the customer if known."""
    return rows(
        db.table("conversations")
        .select("*, customers(id, name, phone, email)")
        .eq("business_id", business_id)
        .order("last_message_at", desc=True)
        .limit(limit)
        .execute()
    )


def attach_customer(business_id: str, conversation_id: str, customer_id: str) -> None:
    """Called once the visitor gives us a name or a number."""
    db.table("conversations").update({"customer_id": customer_id}).eq(
        "business_id", business_id
    ).eq("id", conversation_id).execute()


def set_human_takeover(business_id: str, conversation_id: str, enabled: bool) -> None:
    db.table("conversations").update({"human_takeover": enabled}).eq(
        "business_id", business_id
    ).eq("id", conversation_id).execute()


def last_lead(conversation_id: str) -> str | None:
    """
    Which capability answered the previous turn, if we recorded one.

    This is the supervisor's "previous turn" mechanism, and it is deliberately
    narrow: one capability name, read from the newest agent reply, re-read on
    every message. It is a HINT in the prompt, never an authorisation - the
    routing is still intersected with what the business has enabled.
    """
    found = rows(
        db.table("messages")
        .select("meta")
        .eq("conversation_id", conversation_id)
        .eq("author", "agent")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not found:
        return None
    routing = (found[0].get("meta") or {}).get("routing") or {}
    lead = routing.get("lead")
    return lead if isinstance(lead, str) and lead else None


def latest_for_customer(business_id: str, customer_id: str) -> dict | None:
    """The customer's most recent chat - where an invoice or reminder is posted."""
    return one(
        db.table("conversations")
        .select("*")
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("last_message_at", desc=True)
        .limit(1)
        .execute()
    )