"""Handoffs to a human: escalations and callback requests."""

from datetime import datetime, timezone

from app.db import db, one, rows


def create_request(
    *,
    business_id: str,
    conversation_id: str | None,
    kind: str,
    reason: str,
    summary: str = "",
    customer_id: str | None = None,
    contact_name: str | None = None,
    contact_phone: str | None = None,
    contact_email: str | None = None,
) -> dict:
    if kind not in {"escalation", "callback"}:
        raise ValueError(f"Invalid support request kind: {kind}")

    created = one(
        db.table("support_requests")
        .insert(
            {
                "business_id": business_id,
                "conversation_id": conversation_id,
                "customer_id": customer_id,
                "kind": kind,
                "reason": reason[:2000],
                "summary": summary[:2000],
                "contact_name": contact_name,
                "contact_phone": contact_phone,
                "contact_email": contact_email,
            }
        )
        .execute()
    )
    if not created:
        raise RuntimeError("Could not create support request")
    return created


def list_requests(business_id: str, status: str | None = None, limit: int = 100) -> list[dict]:
    query = (
        db.table("support_requests")
        .select("*, conversations(id, visitor_label), customers(id, name, phone, email)")
        .eq("business_id", business_id)
    )
    if status:
        query = query.eq("status", status)
    return rows(query.order("created_at", desc=True).limit(limit).execute())


def open_count(business_id: str) -> int:
    return len(
        rows(
            db.table("support_requests")
            .select("id")
            .eq("business_id", business_id)
            .eq("status", "open")
            .execute()
        )
    )


def resolve(
    *, business_id: str, request_id: str, status: str, resolved_by: str, note: str = ""
) -> dict | None:
    if status not in {"open", "in_progress", "resolved", "dismissed"}:
        raise ValueError(f"Invalid support request status: {status}")

    patch: dict = {"status": status, "resolution_note": note}
    if status in {"resolved", "dismissed"}:
        patch["resolved_at"] = datetime.now(timezone.utc).isoformat()
        patch["resolved_by"] = resolved_by

    db.table("support_requests").update(patch).eq("business_id", business_id).eq(
        "id", request_id
    ).execute()

    return one(
        db.table("support_requests")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", request_id)
        .limit(1)
        .execute()
    )