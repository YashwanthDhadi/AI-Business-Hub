"""
Public chat orchestration.

Sits between the HTTP routes and everything else: resolves the business, owns
the session lifecycle, runs the agent, and persists both sides of the exchange.
Routes stay thin; this file holds the rules.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.agents import support_agent
from app.config import settings
from app.repositories import businesses as business_repo
from app.repositories import conversations as conversation_repo
from app.repositories import sessions as session_repo
from app.services.rate_limit import SlidingWindowLimiter

logger = logging.getLogger("aibh.chat")

# The frontend uses a colour name; the chat header needs a real hex value.
ACCENT_HEX = {
    "indigo": "#6366f1",
    "emerald": "#10b981",
    "rose": "#f43f5e",
    "amber": "#f59e0b",
    "sky": "#0ea5e9",
    "violet": "#8b5cf6",
}

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

# One limiter per dimension. Module-level, so they persist across requests.
session_limiter = SlidingWindowLimiter(
    settings.chat_rate_limit_per_session, settings.chat_rate_window_seconds, "session"
)
ip_limiter = SlidingWindowLimiter(
    settings.chat_rate_limit_per_ip, settings.chat_rate_window_seconds, "ip"
)
voice_limiter = SlidingWindowLimiter(
    settings.voice_rate_limit_per_session, settings.chat_rate_window_seconds, "voice"
)


def check_limits(resolved: "ResolvedSession", ip: str | None, *, voice: bool = False) -> None:
    """Raise ChatError(429) when the visitor is going too fast."""
    from app.repositories import sessions as session_repo

    session_key = resolved.session["id"]
    ip_key = session_repo.hash_ip(ip) or f"session:{session_key}"

    if voice:
        verdict = voice_limiter.hit(session_key)
        if not verdict.allowed:
            raise ChatError(
                "That's a lot of voice messages. Please wait a moment and try again.",
                status_code=429,
                retry_after=verdict.retry_after,
            )

    verdict = session_limiter.hit(session_key)
    if not verdict.allowed:
        raise ChatError(
            "You're sending messages very quickly. Please wait a moment.",
            status_code=429,
            retry_after=verdict.retry_after,
        )

    verdict = ip_limiter.hit(ip_key)
    if not verdict.allowed:
        raise ChatError(
            "Too many messages from your network. Please wait a moment.",
            status_code=429,
            retry_after=verdict.retry_after,
        )

    session_limiter.sweep()
    ip_limiter.sweep()


def validate_message(text: str) -> str:
    """Reject empty and oversized messages before anything expensive happens."""
    clean = (text or "").strip()
    if not clean:
        raise ChatError("Please type a message.", status_code=400)
    if len(clean) > settings.chat_max_message_chars:
        raise ChatError(
            f"That message is too long. Please keep it under "
            f"{settings.chat_max_message_chars} characters.",
            status_code=413,
        )
    return clean

AGENT_KEY = support_agent.AGENT_KEY


class ChatError(Exception):
    """Something the visitor should be told about, with an HTTP status."""

    def __init__(self, message: str, status_code: int = 400, retry_after: int = 0):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        # Seconds the client should wait. Only set on 429.
        self.retry_after = retry_after


@dataclass
class ResolvedSession:
    session: dict
    business: dict
    conversation: dict


def start_session(
    *, chat_slug: str, ip: str | None = None, user_agent: str | None = None
) -> dict:
    """Open a new anonymous conversation for a business's public chat link."""
    business = business_repo.get_business_by_chat_slug(chat_slug)
    if business is None:
        raise ChatError("This chat link is not available.", status_code=404)

    if not business_repo.is_agent_active(business["id"], AGENT_KEY):
        raise ChatError("This business is not accepting chats right now.", status_code=403)

    conversation = conversation_repo.create(business["id"], channel="web")
    token = session_repo.new_token()
    session_repo.create(
        business_id=business["id"],
        conversation_id=conversation["id"],
        token=token,
        ip=ip,
        user_agent=user_agent,
    )

    greeting = business.get("chat_greeting") or "Hi! How can I help you today?"

    # Persist the greeting so the transcript the owner reads starts where the
    # customer's screen started.
    conversation_repo.add_message(
        business_id=business["id"],
        conversation_id=conversation["id"],
        direction="outbound",
        author="agent",
        body=greeting,
        meta={"kind": "greeting"},
    )

    logger.info("Chat session opened for %s (%s)", business["name"], conversation["id"])

    return {
        "session_token": token,
        "conversation_id": conversation["id"],
        "business": {
            "name": business["name"],
            "chat_slug": business["chat_slug"],
            "accent": business.get("chat_accent") or "indigo",
            "location": business.get("location") or "",
        },
        "greeting": greeting,
    }


def resolve_session(token: str) -> ResolvedSession:
    """Turn the X-Chat-Session header into a business and a conversation."""
    session = session_repo.resolve(token)
    if session is None:
        raise ChatError("Your chat session has expired. Please refresh the page.", 401)

    business = business_repo.get_business(session["business_id"])
    if business is None or not business.get("chat_enabled"):
        raise ChatError("This chat is no longer available.", status_code=403)

    conversation = conversation_repo.get(business["id"], session["conversation_id"])
    if conversation is None:
        raise ChatError("This conversation no longer exists.", status_code=404)

    return ResolvedSession(session=session, business=business, conversation=conversation)


def handle_message(resolved: ResolvedSession, text: str, *, from_voice: bool = False) -> dict:
    """
    One full exchange: store the question, run the agent, store the answer.

    Returns what the browser needs to render, and nothing more — never the
    business id, never internal ids the visitor has no use for.
    """
    business = resolved.business
    conversation = resolved.conversation
    business_id = business["id"]
    conversation_id = conversation["id"]

    conversation_repo.add_message(
        business_id=business_id,
        conversation_id=conversation_id,
        direction="inbound",
        author="customer",
        body=text,
        meta={"source": "voice" if from_voice else "text"},
    )

    session_repo.touch(resolved.session["id"], (resolved.session.get("message_count") or 0) + 1)

    # A human has taken over: store what they said, stay silent.
    if conversation.get("human_takeover"):
        logger.info("Conversation %s is under human control — agent silent", conversation_id)
        return {
            "reply": None,
            "handed_over": True,
            "notice": "Someone from the team is looking at this and will reply here shortly.",
        }

    reply = support_agent.run(
        business=business,
        conversation_id=conversation_id,
        message=text,
    )

    conversation_repo.add_message(
        business_id=business_id,
        conversation_id=conversation_id,
        direction="outbound",
        author="agent",
        body=reply.text,
        meta={
            "tool_calls": reply.tool_calls,
            "latency_ms": reply.latency_ms,
            "steps": reply.steps,
            "escalated": reply.escalated,
            # Which capabilities answered. The owner's inbox shows this, and
            # the supervisor reads it back as the "previous turn" hint.
            "routing": reply.routing,
        },
    )

    return {
        "reply": reply.text,
        "handed_over": reply.escalated,
        "notice": (
            "Someone from the team will reply here shortly."
            if reply.escalated
            else None
        ),
        "latency_ms": reply.latency_ms,
    }


def transcript(resolved: ResolvedSession, limit: int = 100) -> list[dict]:
    """The visitor's own conversation, for restoring the page after a reload."""
    rows = conversation_repo.messages_for(
        resolved.business["id"], resolved.conversation["id"], limit=limit
    )
    return [
        {
            "id": row["id"],
            "role": "customer" if row["author"] == "customer" else "agent",
            "author": row["author"],
            "body": row["body"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def public_business(chat_slug: str) -> dict:
    """
    Everything the public chat page may know about a business.

    Read-only, unauthenticated, and deliberately narrow: no owner contact
    details beyond what a customer would see on a shopfront, and NO knowledge
    base. The agent reads that server-side; publishing it would let anyone
    scrape every policy the owner has written.
    """
    business = business_repo.get_business_by_chat_slug(chat_slug)
    if business is None:
        raise ChatError("This chat link is not available.", status_code=404)

    hours = []
    for entry in business.get("hours") or []:
        index = int(entry.get("day", 0)) % 7
        hours.append(
            {
                "day": DAY_NAMES[index],
                "isOpen": not entry.get("closed"),
                "openTime": entry.get("open") or "09:00",
                "closeTime": entry.get("close") or "18:00",
            }
        )

    services = [
        {
            "id": s["id"],
            "name": s["name"],
            "description": s.get("description") or "",
            "durationMinutes": s.get("duration_minutes") or 0,
            "price": float(s.get("price") or 0),
        }
        for s in business_repo.list_services(business["id"])
    ]

    location = business.get("location") or ""
    accent = business.get("chat_accent") or "indigo"

    return {
        "profile": {
            "id": business["id"],
            "name": business["name"],
            "slug": business["chat_slug"],
            "type": (business.get("business_type") or "business").title(),
            "tagline": "Ask us anything, any time.",
            "description": business.get("description") or "",
            "email": business.get("owner_email") or "",
            "phone": business.get("owner_phone") or "",
            "address": location,
            "city": location.split(",")[-1].strip() if location else "",
            "currency": business.get("currency") or "INR",
            "workingHours": hours,
            "services": services,
            "enabledCapabilities": [],
        },
        "assistant": {
            "assistantName": "Assistant",
            "greeting": business.get("chat_greeting") or "Hi! How can I help you today?",
            "tone": "friendly",
            "businessDescription": business.get("description") or "",
            # Never published. The agent uses the knowledge base server-side.
            "faqs": [],
            "allowBookings": business_repo.is_agent_active(business["id"], "booking"),     # the Booking Agent turns this on later
            "requireBookingApproval": True,
            "handoffToStaff": True,
            "voiceInputEnabled": True,
            "chatEnabled": bool(business.get("chat_enabled")),
            "brandColor": ACCENT_HEX.get(accent, ACCENT_HEX["indigo"]),
        },
    }


def handle_voice(
    resolved: ResolvedSession,
    audio: bytes,
    content_type: str | None,
) -> dict:
    """
    Transcribe a recording, then treat it exactly like a typed message.

    Returns the transcript as well as the reply, so the chat window can show
    the customer what was heard.
    """
    from app.channels.speech import transcribe

    result = transcribe(audio, content_type)
    if not result.ok:
        raise ChatError(result.error or "Could not understand that recording.", 400)

    text = validate_message(result.text)
    outcome = handle_message(resolved, text, from_voice=True)
    return {"transcript": text, **outcome}
