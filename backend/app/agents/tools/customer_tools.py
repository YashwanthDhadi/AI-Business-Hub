"""
Tools for the Customers capability.

Two tools, and what is missing matters more than what is here:

  * remember_about_customer  - add a note to the customer this chat is about
  * set_marketing_preference - record "please stop sending me offers"

There is NO tool that reads a customer record, their notes or their history.
The chat is public and nobody logs in: anyone can type anyone's phone number.
A tool that answered "what do you know about me?" would hand a stranger
someone else's details. The agent can add to a record; it never reads one.
"""

from __future__ import annotations

import logging
from typing import Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.agents.tools.support_tools import AgentContext
from app.repositories import conversations as conversation_repo
from app.repositories import customer_notes as notes_repo
from app.repositories import customers as customer_repo

logger = logging.getLogger("aibh.tools.customers")


# ------------------------------------------------------------------ arg schemas


class IdentityArgs(BaseModel):
    name: str = Field(default="", description="Their name, only if they gave it in this chat.")
    phone: str = Field(
        default="",
        description="Their phone number, only if they gave it in this chat. "
        "Never invent one, and never ask for one just to take a note.",
    )
    email: str = Field(default="", description="Their email, only if they gave it in this chat.")


class RememberArgs(IdentityArgs):
    note: str = Field(
        description="One short fact for the team, written about the customer in "
        "the third person. Examples: 'Prefers morning sessions before 9 AM', "
        "'Interested in the yoga trial', 'Training for a half marathon in March'. "
        "Never anything about health, injuries, medication or money."
    )
    kind: Literal["preference", "interest"] = Field(
        default="preference",
        description="'interest' for a service or plan they want; 'preference' "
        "for how they like things done.",
    )


class MarketingArgs(IdentityArgs):
    wants_offers: bool = Field(
        description="false if they asked to STOP getting offers or promotional "
        "messages. true if they asked to START getting them."
    )


# ----------------------------------------------------------------- tool bodies


def _customer_for_chat(
    ctx: AgentContext, name: str = "", phone: str = "", email: str = ""
) -> dict | None:
    """
    The customer this conversation is about, or None if we do not know yet.

    If the conversation is already linked - save_contact_details and
    request_booking both link it - use that customer. Otherwise, if they have
    just given a phone or email, link it now the same way those tools do.
    Never looks anyone up by name: names are not unique and prove nothing.
    """
    conversation = conversation_repo.get(ctx.business_id, ctx.conversation_id)
    linked = (conversation or {}).get("customer_id")
    if linked:
        return customer_repo.get(ctx.business_id, linked)

    customer = customer_repo.upsert_from_chat(
        business_id=ctx.business_id, name=name, phone=phone, email=email
    )
    if customer:
        conversation_repo.attach_customer(ctx.business_id, ctx.conversation_id, customer["id"])
    return customer


def _remember(
    ctx: AgentContext,
    note: str,
    kind: str = "preference",
    name: str = "",
    phone: str = "",
    email: str = "",
) -> dict:
    customer = _customer_for_chat(ctx, name, phone, email)
    if customer is None:
        return {
            "saved": False,
            "instruction": "You do not know who this is yet, so there is nowhere to "
            "keep this. Carry on helping. Do NOT ask for their phone number just "
            "to take a note.",
        }

    try:
        notes_repo.add(
            business_id=ctx.business_id,
            customer_id=customer["id"],
            body=note,
            kind=kind,
            author="agent",
            conversation_id=ctx.conversation_id,
        )
    except notes_repo.AlreadyNoted:
        return {
            "saved": True,
            "already_known": True,
            "instruction": "The team already knows this. No need to mention it.",
        }
    except notes_repo.InvalidNote:
        return {
            "saved": False,
            "instruction": "That note was too short or too long. Use one sentence "
            "between 3 and 300 characters.",
        }

    logger.info("Agent added a '%s' note for customer %s", kind, customer["id"])
    return {
        "saved": True,
        "instruction": "If it fits naturally, say you'll let the team know. Never "
        "mention notes, records or a profile.",
    }


def _marketing(
    ctx: AgentContext,
    wants_offers: bool,
    name: str = "",
    phone: str = "",
    email: str = "",
) -> dict:
    customer = _customer_for_chat(ctx, name, phone, email)
    if customer is None:
        return {
            "saved": False,
            "instruction": "Ask which phone number or email they want this for, "
            "then call this tool again with it.",
        }

    if not wants_offers:
        customer_repo.set_marketing_consent(
            business_id=ctx.business_id,
            customer_id=customer["id"],
            consent="opted_out",
            source="chat",
        )
        logger.info("Customer %s opted out of offers in chat", customer["id"])
        return {
            "opted_out": True,
            "message_to_customer": "Done - we won't send you offers or promotions. "
            "You'll still get replies about your own bookings here.",
        }

    # Opting IN from chat is refused by the database (customers_opt_in_needs_owner).
    # We do not even try: we leave the owner a note to confirm it with them.
    try:
        notes_repo.add(
            business_id=ctx.business_id,
            customer_id=customer["id"],
            body="Asked in chat to receive offers - confirm with them, then opt them in",
            kind="interest",
            author="agent",
            conversation_id=ctx.conversation_id,
        )
    except notes_repo.AlreadyNoted:
        pass
    return {
        "opted_in": False,
        "instruction": "You cannot sign anyone up yourself. Tell them the team will "
        "confirm with them before sending anything.",
    }


# --------------------------------------------------------------------- assembly


def build_tools(ctx: AgentContext) -> list[StructuredTool]:
    """Customer tools, bound to this business and conversation."""

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
            _remember,
            "remember_about_customer",
            "Pass on something the team should know about this customer next time: "
            "a preferred time, a goal, a trainer they like, or a service they are "
            "interested in. One fact per call. This only ADDS a note for the team - "
            "you can never read notes back.",
            RememberArgs,
        ),
        wrap(
            _marketing,
            "set_marketing_preference",
            "Record whether this customer wants offers and promotional messages. "
            "wants_offers=false when they ask to stop. wants_offers=true when they "
            "ask to get them - the team confirms those with them first.",
            MarketingArgs,
        ),
    ]
