"""
Notes the agent takes about a customer during a chat.

Append-only: nothing in the code edits or deletes a note. The owner's own
free-text notes live in customers.notes, a separate column, so nothing the
agent writes can overwrite what the owner typed.
"""

from __future__ import annotations

import logging

from app.db import db, one, rows

logger = logging.getLogger("aibh.customer_notes")

UNIQUE_VIOLATION = "23505"
CHECK_VIOLATION = "23514"

KINDS = {"preference", "interest", "note"}


class AlreadyNoted(Exception):
    """This customer already has the same note. Not an error for the caller."""


class InvalidNote(Exception):
    """Too short, too long, or an unknown kind - refused by the database."""


def add(
    *,
    business_id: str,
    customer_id: str,
    body: str,
    kind: str = "note",
    author: str = "agent",
    conversation_id: str | None = None,
) -> dict:
    """
    Append one note. Raises AlreadyNoted if the same note is already there.

    Whitespace is collapsed first, so "Prefers   mornings" and "Prefers
    mornings" are the same note to the unique index.
    """
    text = " ".join((body or "").split())
    try:
        created = one(
            db.table("customer_notes")
            .insert(
                {
                    "business_id": business_id,
                    "customer_id": customer_id,
                    "conversation_id": conversation_id,
                    "kind": kind,
                    "body": text,
                    "author": author,
                }
            )
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if UNIQUE_VIOLATION in message:
            raise AlreadyNoted(text) from exc
        if CHECK_VIOLATION in message:
            raise InvalidNote(message) from exc
        raise

    if created is None:
        raise RuntimeError("Could not save the note")
    logger.info("Note added to customer %s by %s", customer_id, author)
    return created


def list_for_customer(business_id: str, customer_id: str, limit: int = 50) -> list[dict]:
    return rows(
        db.table("customer_notes")
        .select("*")
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
