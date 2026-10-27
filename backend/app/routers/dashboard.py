"""
Routes for the business owner's dashboard.

Responses deliberately match the frontend's ConversationSession / ChatMessage
types, so the React side needs no new shapes.

Every route depends on require_dashboard_key (authentication) and
business_scope (which tenant), so tenant filtering can never be forgotten.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from app.repositories import appointments as booking_repo
from app.repositories import businesses as business_repo
from app.repositories import conversations as conversation_repo
from app.repositories import knowledge as knowledge_repo
from app.repositories import support as support_repo
from app.schemas import (
    ArticleInput,
    BookingDecision,
    BookingStatusChange,
    ChatSettingsInput,
    OwnerReply,
    ResolveConversation,
)
from app.security import business_scope, require_dashboard_key
from app.services.formatting import spoken_date as _spoken_date

logger = logging.getLogger("aibh.router.dashboard")

router = APIRouter(
    prefix="/api/v1/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(require_dashboard_key)],
)

# Backend author -> the frontend's SenderRole union.
SENDER = {"customer": "customer", "agent": "assistant", "owner": "staff", "system": "system"}


def _tz(business: dict | None) -> ZoneInfo:
    try:
        return ZoneInfo((business or {}).get("timezone") or "Asia/Kolkata")
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def _clock(iso: str | None, tz: ZoneInfo) -> str:
    """
    A short local time label, e.g. '2:04 PM' — what ChatMessage.timestamp wants.

    Note we use %I and strip the leading zero by hand. The tidier %-I is a GNU
    extension: it works on Linux and raises ValueError on Windows, which is
    where you are developing.
    """
    if not iso:
        return ""
    try:
        moment = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return ""
    return moment.astimezone(tz).strftime("%I:%M %p").lstrip("0")


def _status(row: dict) -> str:
    """conversations -> the frontend's 'active' | 'resolved' | 'escalated'."""
    if row.get("human_takeover"):
        return "escalated"
    if row.get("status") == "closed":
        return "resolved"
    return "active"


def _message(row: dict, tz: ZoneInfo) -> dict:
    meta = row.get("meta") or {}
    routing = meta.get("routing") or {}
    shaped = {
        "id": row["id"],
        "sender": SENDER.get(row["author"], "assistant"),
        "text": row["body"],
        "timestamp": _clock(row.get("created_at"), tz),
        # ChatMessage.metadata declares {actionType?, data?}, so extras go in `data`.
        "metadata": {"data": {"fromVoice": meta.get("source") == "voice"}},
    }
    # Owner-facing only. This endpoint needs the dashboard key; the public chat
    # API has no equivalent field, so a customer never sees the routing.
    if routing.get("lead"):
        shaped["routing"] = {
            "capabilities": routing.get("capabilities") or [],
            "lead": routing["lead"],
            "source": routing.get("source") or "model",
            "latencyMs": routing.get("latency_ms"),
            "reason": routing.get("reason") or "",
        }
    return shaped


def _session(row: dict, business: dict, messages: list[dict] | None = None) -> dict:
    tz = _tz(business)
    customer = row.get("customers") or {}
    return {
        "id": row["id"],
        "businessId": business["id"],
        "businessSlug": business["chat_slug"],
        "customerName": customer.get("name") or row.get("visitor_label") or "Visitor",
        "customerPhone": customer.get("phone"),
        "status": _status(row),
        "startedAt": row.get("created_at"),
        "lastMessageAt": row.get("last_message_at"),
        "messages": [_message(m, tz) for m in (messages or [])],
        "topic": (row.get("last_message_preview") or "")[:60],
        "summary": row.get("last_message_preview") or "",
        "source": "link",
    }


# ------------------------------------------------------------------ overview


@router.get("/stats")
def stats(business_id: str = Depends(business_scope)) -> dict:
    """The four StatCard numbers. Matches the frontend's ChatStats type."""
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    tz = _tz(business)
    threads = conversation_repo.list_conversations(business_id, limit=500)
    today = datetime.now(tz).date()

    def _is_today(iso: str | None) -> bool:
        """
        Timestamps are stored in UTC; "today" is the BUSINESS's day. Comparing
        the UTC string against a local date silently reports 0 for several
        hours every night, whenever the two dates differ.
        """
        if not iso:
            return False
        try:
            moment = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        except ValueError:
            return False
        return moment.astimezone(tz).date() == today

    return {
        "totalConversations": len(threads),
        "todayConversations": sum(1 for t in threads if _is_today(t.get("last_message_at"))),
        "bookingsFromChat": sum(
            1
            for b in booking_repo.list_all(business_id, limit=500)
            if b.get("source") == "customer_chat"
            and b.get("status") in {"pending", "confirmed", "completed"}
        ),
        "pendingBookings": booking_repo.pending_count(business_id),
        "questionsAnswered": sum(1 for t in threads if not t.get("human_takeover")),
        "openRequests": support_repo.open_count(business_id),
        "business": {
            "id": business["id"],
            "name": business["name"],
            "chatSlug": business["chat_slug"],
            "chatEnabled": bool(business.get("chat_enabled")),
        },
    }


# ------------------------------------------------------------- conversations


@router.get("/conversations")
def list_conversations(business_id: str = Depends(business_scope)) -> dict:
    """
    The inbox. Each row carries its full transcript, because the list is small
    and the frontend's ConversationSession type expects `messages` to be there.
    """
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    threads = conversation_repo.list_conversations(business_id, limit=50)
    # One query for all the transcripts, not one per thread. Fetching them in
    # the loop made this endpoint take about five seconds.
    transcripts = conversation_repo.messages_for_many(
        business_id, [row["id"] for row in threads]
    )
    out = [_session(row, business, transcripts.get(row["id"], [])) for row in threads]
    return {"conversations": out}


@router.post("/conversations/{conversation_id}/reply")
def owner_reply(
    conversation_id: str,
    payload: OwnerReply,
    business_id: str = Depends(business_scope),
) -> dict:
    """
    The owner types a message themselves.

    It lands in the same thread, so the customer's open chat window picks it up
    on its next poll. There is nothing to send — the transcript IS the channel.
    Replying also takes the thread over, so the agent stops talking across them.
    """
    business = business_repo.get_business(business_id)
    thread = conversation_repo.get(business_id, conversation_id)
    if business is None or thread is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    conversation_repo.add_message(
        business_id=business_id,
        conversation_id=conversation_id,
        direction="outbound",
        author="owner",
        body=payload.body,
        meta={"sent_by": "owner"},
    )
    conversation_repo.set_human_takeover(business_id, conversation_id, True)

    logger.info("Owner replied on conversation %s", conversation_id)
    updated = conversation_repo.get(business_id, conversation_id)
    messages = conversation_repo.messages_for(business_id, conversation_id)
    return {"conversation": _session(updated or thread, business, messages)}


@router.post("/conversations/{conversation_id}/resolve")
def resolve_conversation(
    conversation_id: str,
    payload: ResolveConversation,
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Mark a thread done: close it, hand control back to the agent, and clear any
    open handoffs attached to it.
    """
    from app.db import db

    business = business_repo.get_business(business_id)
    thread = conversation_repo.get(business_id, conversation_id)
    if business is None or thread is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.table("conversations").update(
        {"status": "closed" if payload.resolved else "open", "human_takeover": False}
    ).eq("business_id", business_id).eq("id", conversation_id).execute()

    db.table("support_requests").update(
        {
            "status": "resolved",
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "resolved_by": "owner",
        }
    ).eq("business_id", business_id).eq("conversation_id", conversation_id).eq(
        "status", "open"
    ).execute()

    updated = conversation_repo.get(business_id, conversation_id)
    messages = conversation_repo.messages_for(business_id, conversation_id)
    return {"conversation": _session(updated or thread, business, messages)}


# ------------------------------------------------------------- knowledge base


@router.get("/knowledge")
def list_knowledge(business_id: str = Depends(business_scope)) -> dict:
    """Everything the agent is allowed to say, as the frontend's FaqItem shape."""
    return {
        "faqs": [
            {"id": a["id"], "question": a["title"], "answer": a["body"], "tags": a.get("tags") or []}
            for a in knowledge_repo.list_articles(business_id)
            if a.get("is_active", True)
        ]
    }


@router.post("/knowledge")
def create_knowledge(
    payload: ArticleInput, business_id: str = Depends(business_scope)
) -> dict:
    created = knowledge_repo.create_article(
        business_id, payload.title, payload.body, payload.tags
    )
    if created is None:
        raise HTTPException(status_code=500, detail="Could not create the article")
    return {"faq": {"id": created["id"], "question": created["title"], "answer": created["body"]}}


@router.patch("/knowledge/{article_id}")
def update_knowledge(
    article_id: str, payload: ArticleInput, business_id: str = Depends(business_scope)
) -> dict:
    knowledge_repo.update_article(
        business_id,
        article_id,
        {
            "title": payload.title,
            "body": payload.body,
            "tags": payload.tags,
            "is_active": payload.is_active,
        },
    )
    return {"id": article_id, "updated": True}


@router.delete("/knowledge/{article_id}")
def delete_knowledge(article_id: str, business_id: str = Depends(business_scope)) -> dict:
    knowledge_repo.delete_article(business_id, article_id)
    return {"id": article_id, "deleted": True}


# ---------------------------------------------------------------- chat setup


@router.patch("/chat-settings")
def update_chat_settings(
    payload: ChatSettingsInput, business_id: str = Depends(business_scope)
) -> dict:
    """Greeting, on/off switch, and the owner's instructions to the agent."""
    from app.db import db

    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if patch:
        db.table("businesses").update(patch).eq("id", business_id).execute()
    return {"updated": list(patch)}


# ---------------------------------------------------------------- bookings


def _booking(row: dict, business: dict) -> dict:
    """appointments row -> the frontend's Booking type."""
    tz = _tz(business)
    customer = row.get("customers") or {}

    try:
        moment = datetime.fromisoformat(str(row["starts_at"]).replace("Z", "+00:00")).astimezone(tz)
        date = moment.date().isoformat()
        clock = moment.strftime("%I:%M %p").lstrip("0")
    except (ValueError, KeyError):
        date, clock = "", ""

    return {
        "id": row["id"],
        "businessId": business["id"],
        "customerId": row.get("customer_id") or "",
        "customerName": customer.get("name") or "Visitor",
        "customerEmail": customer.get("email") or "",
        "customerPhone": customer.get("phone") or "",
        "serviceId": row.get("service_id") or "",
        "serviceName": row.get("service_name") or "",
        "date": date,
        "time": clock,
        "durationMinutes": row.get("duration_minutes") or 0,
        "price": float(row.get("price") or 0),
        "status": row["status"],
        "paymentStatus": row.get("payment_status") or "unpaid",
        "staffAssigned": row.get("staff_assigned"),
        "notes": row.get("notes") or "",
        "bookedVia": row.get("source") or "customer_chat",
        "createdAt": row.get("created_at"),
        # Ours, not in the frontend's Booking type - handy in the UI.
        "reference": row["id"][:8].upper(),
    }


@router.get("/bookings")
def list_bookings(business_id: str = Depends(business_scope)) -> dict:
    """Every booking, newest first. What the bookings table shows."""
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    return {
        "bookings": [_booking(row, business) for row in booking_repo.list_all(business_id)],
        "pending": booking_repo.pending_count(business_id),
    }


@router.post("/bookings/{booking_id}/decision")
def decide_booking(
    booking_id: str,
    payload: BookingDecision,
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Approve or reject a pending booking.

    This is the ONLY path that can write 'confirmed'. The agent has no tool for
    it, by design - that is the confirmation gate.
    """
    if payload.decision not in {"approve", "reject"}:
        raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'")

    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    existing = booking_repo.get(business_id, booking_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    if existing["status"] != "pending":
        # Two tabs, or a double tap. Telling the customer twice is worse than
        # refusing the second press.
        raise HTTPException(
            status_code=409,
            detail=f"This booking is already '{existing['status']}' and cannot be decided again.",
        )

    new_status = "confirmed" if payload.decision == "approve" else "cancelled"
    updated = booking_repo.set_status(
        business_id=business_id,
        appointment_id=booking_id,
        status=new_status,
        decided_by=payload.decided_by,
        note=payload.note,
    )
    if updated is None:
        raise HTTPException(status_code=500, detail="Could not update the booking")

    shaped = _booking(updated, business)

    # Tell the customer, in the chat they are already sitting in.
    conversation_id = updated.get("conversation_id")
    if conversation_id:
        when = f"{_spoken_date(shaped['date'])} at {shaped['time']}"
        if new_status == "confirmed":
            text = (
                f"Your {shaped['serviceName']} on {when} "
                f"is confirmed. Reference {shaped['reference']}."
            )
        else:
            text = (
                f"Sorry - we can't take your {shaped['serviceName']} booking for "
                f"{when}."
            )
        if payload.note:
            text = f"{text}\n\n{payload.note}"
        if new_status == "cancelled":
            text = f"{text}\n\nReply here and we'll find another time."

        conversation_repo.add_message(
            business_id=business_id,
            conversation_id=conversation_id,
            direction="outbound",
            author="system",
            body=text,
            meta={"kind": "booking_decision", "booking_id": booking_id, "decision": new_status},
        )

    logger.info("Booking %s %s by %s", shaped["reference"], new_status, payload.decided_by)
    return {"booking": shaped, "customer_notified": bool(conversation_id)}


@router.post("/bookings/{booking_id}/status")
def change_booking_status(
    booking_id: str,
    payload: BookingStatusChange,
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Move a booking to any status. Used for 'completed' after the visit, and for
    cancelling something the owner already confirmed.
    """
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    try:
        updated = booking_repo.set_status(
            business_id=business_id,
            appointment_id=booking_id,
            status=payload.status,
            decided_by="owner",
            note=payload.note,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if updated is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"booking": _booking(updated, business)}
