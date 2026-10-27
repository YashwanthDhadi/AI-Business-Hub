"""
The knowledge base — what the agent is allowed to say.

`search` is the single most important query in this project: it is what stops
the agent inventing a refund policy.
"""

import logging

from app.db import db, rows

logger = logging.getLogger("aibh.knowledge")


def search(business_id: str, query: str, limit: int = 4) -> list[dict]:
    """
    Full-text search over this business's knowledge base.

    Falls back to a plain substring match when full-text search finds nothing,
    which happens for very short or stopword-only queries ("what about that?").
    """
    text = (query or "").strip()
    if not text:
        return []

    try:
        response = db.rpc(
            "search_knowledge",
            {"p_business_id": business_id, "p_query": text, "p_limit": limit},
        ).execute()
        found = rows(response)
        if found:
            return found
    except Exception:  # noqa: BLE001
        logger.exception("search_knowledge RPC failed; falling back to ilike")

    # Fallback: cheap substring match on the title.
    return rows(
        db.table("knowledge_articles")
        .select("id, title, body")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .ilike("title", f"%{text[:60]}%")
        .limit(limit)
        .execute()
    )


def list_articles(business_id: str, limit: int = 200) -> list[dict]:
    return rows(
        db.table("knowledge_articles")
        .select("id, title, body, tags, is_active, updated_at")
        .eq("business_id", business_id)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )


def create_article(business_id: str, title: str, body: str, tags: list[str] | None = None) -> dict | None:
    from app.db import one

    return one(
        db.table("knowledge_articles")
        .insert(
            {
                "business_id": business_id,
                "title": title.strip(),
                "body": body.strip(),
                "tags": tags or [],
            }
        )
        .execute()
    )


def update_article(business_id: str, article_id: str, patch: dict) -> None:
    allowed = {k: v for k, v in patch.items() if k in {"title", "body", "tags", "is_active"}}
    if not allowed:
        return
    db.table("knowledge_articles").update(allowed).eq("business_id", business_id).eq(
        "id", article_id
    ).execute()


def delete_article(business_id: str, article_id: str) -> None:
    db.table("knowledge_articles").delete().eq("business_id", business_id).eq(
        "id", article_id
    ).execute()