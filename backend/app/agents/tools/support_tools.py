"""
Tools for the Customer Support Agent.

Every tool is created inside `build_tools()`, which closes over the business and
conversation. The model therefore cannot pass a business_id — it has no way to
reach another tenant's data. Tools return JSON-serialisable dicts and NEVER
raise: an exception would kill the customer's reply, so failures come back as
{"error": "..."} which the model can read and explain.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, time
from zoneinfo import ZoneInfo

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.repositories import businesses as business_repo
from app.repositories import conversations as conversation_repo
from app.repositories import customers as customer_repo
from app.repositories import knowledge as knowledge_repo
from app.repositories import support as support_repo
from app.services.formatting import rupees

logger = logging.getLogger("aibh.tools")

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


@dataclass
class AgentContext:
    """Everything a tool needs that the model is not allowed to choose."""

    business_id: str
    conversation_id: str
    business: dict = field(default_factory=dict)

    @property
    def timezone(self) -> str:
        return self.business.get("timezone") or "Asia/Kolkata"

    @property
    def tz(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.timezone)
        except Exception:  # noqa: BLE001
            return ZoneInfo("UTC")

    def now(self) -> datetime:
        return datetime.now(self.tz)


# ------------------------------------------------------------------ arg schemas
# These classes tell the model exactly what each tool expects. The docstrings
# and Field descriptions are sent to the model verbatim, so they are prompts.


class NoArgs(BaseModel):
    pass


class KnowledgeArgs(BaseModel):
    query: str = Field(
        description="Keywords describing what the customer wants to know. "
        "Use the customer's own words plus obvious synonyms, e.g. "
        "'freeze pause hold membership'. Not a full sentence."
    )


class ContactArgs(BaseModel):
    name: str = Field(default="", description="The customer's name, if they gave one.")
    phone: str = Field(default="", description="Phone number exactly as they typed it.")
    email: str = Field(default="", description="Email address, if they gave one.")
    reason: str = Field(
        description="Why the team should contact them, in one short sentence."
    )


class EscalateArgs(BaseModel):
    reason: str = Field(description="One short sentence on why a human is needed.")
    summary: str = Field(
        default="",
        description="Two or three sentences summarising the conversation so far, "
        "so the owner does not have to read the whole thread.",
    )


# ----------------------------------------------------------------- tool bodies


def _search_knowledge(ctx: AgentContext, query: str) -> dict:
    articles = knowledge_repo.search(ctx.business_id, query, limit=4)
    if not articles:
        return {
            "found": 0,
            "articles": [],
            "instruction": "Nothing in the knowledge base covers this. Do NOT guess. "
            "Say you will check with the team and offer to take their number, "
            "or call escalate_to_human.",
        }
    return {
        "found": len(articles),
        "articles": [{"question": a["title"], "answer": a["body"]} for a in articles],
        "instruction": "Answer using ONLY these. Do not add conditions they do not mention.",
    }


def _business_info(ctx: AgentContext) -> dict:
    business = ctx.business
    now = ctx.now()
    today_index = (now.weekday() + 1) % 7  # Python Mon=0 -> our Sun=0

    schedule = []
    open_now = False
    todays_hours = None

    for entry in business.get("hours") or []:
        index = int(entry.get("day", 0)) % 7
        closed = bool(entry.get("closed"))
        opens = entry.get("open", "")
        closes = entry.get("close", "")
        schedule.append(
            {"day": DAY_NAMES[index], "closed": closed, "opens": opens, "closes": closes}
        )
        if index == today_index:
            todays_hours = {"closed": closed, "opens": opens, "closes": closes}
            if not closed and opens and closes:
                try:
                    open_now = time.fromisoformat(opens) <= now.time() <= time.fromisoformat(closes)
                except ValueError:
                    open_now = False

    return {
        "name": business.get("name"),
        "about": business.get("description"),
        "location": business.get("location"),
        "today": now.strftime("%A, %d %B %Y"),
        "local_time": now.strftime("%I:%M %p"),
        "open_right_now": open_now,
        "todays_hours": todays_hours,
        "weekly_hours": schedule,
    }


def _list_services(ctx: AgentContext) -> dict:
    services = business_repo.list_services(ctx.business_id)
    currency = ctx.business.get("currency") or "INR"
    return {
        "currency": currency,
        "services": [
            {
                "name": s["name"],
                # Both forms. `price` stays a number for any comparison the
                # model needs; `price_text` is the one to copy into a reply.
                # Asked to format 1500 itself, the model wrote "₹1500" - so it
                # is given the correctly grouped string rather than trusted to
                # produce one.
                "price": float(s["price"]),
                "price_text": rupees(s["price"]),
                "price_note": s.get("price_note") or "",
                "description": s.get("description") or "",
                "duration_minutes": s.get("duration_minutes") or 0,
            }
            for s in services
        ],
        "instruction": "These are the only real prices. Never quote a number that is "
        "not in this list, and never offer a discount. When you write a price, copy "
        "price_text exactly - it is already in Indian format.",
    }


def _save_contact(
    ctx: AgentContext, reason: str, name: str = "", phone: str = "", email: str = ""
) -> dict:
    customer = customer_repo.upsert_from_chat(
        business_id=ctx.business_id, name=name, phone=phone, email=email
    )
    if customer is None:
        return {
            "saved": False,
            "error": "No usable phone number or email address.",
            "instruction": "Ask politely for a phone number or an email address "
            "before calling this tool again.",
        }

    conversation_repo.attach_customer(ctx.business_id, ctx.conversation_id, customer["id"])

    support_repo.create_request(
        business_id=ctx.business_id,
        conversation_id=ctx.conversation_id,
        customer_id=customer["id"],
        kind="callback",
        reason=reason,
        contact_name=customer.get("name"),
        contact_phone=customer.get("phone"),
        contact_email=customer.get("email"),
    )

    logger.info("Callback request captured for conversation %s", ctx.conversation_id)
    return {
        "saved": True,
        "name": customer.get("name"),
        "phone": customer.get("phone"),
        "email": customer.get("email"),
        "message_to_customer": "Someone from the team will get in touch shortly.",
    }


def _escalate(ctx: AgentContext, reason: str, summary: str = "") -> dict:
    conversation_repo.set_human_takeover(ctx.business_id, ctx.conversation_id, True)

    support_repo.create_request(
        business_id=ctx.business_id,
        conversation_id=ctx.conversation_id,
        kind="escalation",
        reason=reason,
        summary=summary,
    )

    conversation_repo.add_message(
        business_id=ctx.business_id,
        conversation_id=ctx.conversation_id,
        direction="outbound",
        author="system",
        body=f"Escalated to the team: {reason}",
        meta={"kind": "escalation", "reason": reason},
    )

    logger.warning("Conversation %s escalated: %s", ctx.conversation_id, reason)
    return {
        "escalated": True,
        "message_to_customer": "I've passed this to the team — someone will reply here shortly.",
    }


# ------------------------------------------------------------------- assembly


def build_tools(ctx: AgentContext) -> list[StructuredTool]:
    """
    Bind every tool to this business and conversation.

    Called fresh for each incoming message. `business_id` is captured in the
    closure, so it can never come from the model.
    """

    def wrap(fn, name: str, description: str, args_schema: type[BaseModel]) -> StructuredTool:
        def safe(**kwargs) -> dict:
            try:
                return fn(ctx, **kwargs)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Tool %s failed", name)
                return {"error": f"{name} failed: {exc}"}

        return StructuredTool.from_function(
            func=safe, name=name, description=description, args_schema=args_schema
        )

    return [
        wrap(
            _search_knowledge,
            "search_knowledge",
            "Search this business's knowledge base for policies, rules and answers to "
            "common questions. Call this FIRST for any question about how the business "
            "works: trials, freezing, refunds, timings, classes, rules, what to bring. "
            "Never answer a policy question without calling this.",
            KnowledgeArgs,
        ),
        wrap(
            lambda c: _business_info(c),
            "get_business_info",
            "Opening hours for every day, today's date and local time, whether the "
            "business is open right now, and its location. Call this whenever the "
            "customer mentions a day, a time, or asks if you are open.",
            NoArgs,
        ),
        wrap(
            lambda c: _list_services(c),
            "list_services",
            "Every service or plan this business sells, with its real price. Call this "
            "before mentioning ANY price. Never guess or estimate a price.",
            NoArgs,
        ),
        wrap(
            _save_contact,
            "save_contact_details",
            "Save the customer's name and phone or email so the team can contact them. "
            "Use when they ask to be called back, or when you could not answer and they "
            "agree to be contacted. Only call this after they have actually given you a "
            "phone number or an email address.",
            ContactArgs,
        ),
        wrap(
            _escalate,
            "escalate_to_human",
            "Hand the conversation to a human and stop replying. Use for complaints, "
            "refund requests, anything involving medical or injury advice, disputes "
            "about money, or when the customer explicitly asks for a person.",
            EscalateArgs,
        ),
    ]