"""
Tools for the Booking Agent.

Built the same way as the support tools: bound to one business and one
conversation through a closure, so the model can never reach another tenant's
calendar. Every tool returns a dict and never raises.

The agent CANNOT confirm a booking. There is no tool that writes 'confirmed' —
only the owner's approve button does that.
"""

from __future__ import annotations

import logging
from datetime import date as date_cls
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.agents.tools.support_tools import AgentContext
from app.repositories import appointments as booking_repo
from app.repositories import businesses as business_repo
from app.repositories import conversations as conversation_repo
from app.repositories import customers as customer_repo

logger = logging.getLogger("aibh.tools.booking")

UTC = ZoneInfo("UTC")


def _settings(ctx: AgentContext) -> dict:
    return business_repo.agent_settings(ctx.business_id, "booking")


# ------------------------------------------------------------------ arg schemas


class AvailabilityArgs(BaseModel):
    date: str = Field(
        description="The day to check as YYYY-MM-DD. Work out real dates from "
        "words like 'tomorrow' or 'Friday' yourself, using today's date."
    )
    service_name: str = Field(
        default="",
        description="Exact service name from list_services, if the customer "
        "named one. Leave empty to use the default slot length.",
    )
    preferred_time: str = Field(
        default="",
        description="The time the customer asked for, as HH:MM 24-hour, e.g. "
        "18:00 for 'evening' or 'around 6'. You get the free slots nearest it. "
        "Leave empty if they gave no time.",
    )


class BookingArgs(BaseModel):
    service_name: str = Field(description="Exact service name from list_services.")
    starts_at: str = Field(
        description="Local start time as YYYY-MM-DDTHH:MM, 24-hour clock. "
        "Example: 2026-09-26T18:00. Must be one of the free slots you were given."
    )
    customer_name: str = Field(description="The customer's name. Ask for it if you do not have it.")
    customer_phone: str = Field(
        description="The customer's phone number. Ask for it if you do not have it. "
        "A booking cannot be made without one."
    )
    notes: str = Field(default="", description="Anything else they asked for.")


class LookupArgs(BaseModel):
    customer_phone: str = Field(
        description="The phone number the booking was made under. Ask for it."
    )


class CancelArgs(BaseModel):
    reference: str = Field(description="The booking reference, e.g. 7F3A9C2E.")
    customer_phone: str = Field(
        description="The phone number on the booking. Required — it proves the "
        "person cancelling is the person who booked."
    )


# --------------------------------------------------------------------- helpers


def _parse_day(value: str, ctx: AgentContext) -> date_cls | None:
    text = (value or "").strip().lower()
    today = ctx.now().date()
    if text in {"", "today"}:
        return today
    if text == "tomorrow":
        return today + timedelta(days=1)
    try:
        return date_cls.fromisoformat(text[:10])
    except ValueError:
        return None


def _hours_for(ctx: AgentContext, day: date_cls) -> tuple[time, time] | None:
    """Opening and closing time for a weekday, or None when closed."""
    # Python: Monday=0..Sunday=6.  Our hours JSON: Sunday=0..Saturday=6.
    json_day = (day.weekday() + 1) % 7
    for entry in ctx.business.get("hours") or []:
        if int(entry.get("day", -1)) == json_day:
            if entry.get("closed"):
                return None
            try:
                return (
                    time.fromisoformat(entry.get("open") or "09:00"),
                    time.fromisoformat(entry.get("close") or "18:00"),
                )
            except ValueError:
                return time(9, 0), time(18, 0)
    return time(9, 0), time(18, 0)


def _find_service(ctx: AgentContext, name: str) -> dict | None:
    services = business_repo.list_services(ctx.business_id)
    wanted = (name or "").strip().lower()
    if not wanted:
        return None
    exact = next((s for s in services if s["name"].strip().lower() == wanted), None)
    if exact:
        return exact
    return next((s for s in services if wanted in s["name"].strip().lower()), None)


def _label(moment: datetime) -> str:
    return moment.strftime("%A %d %B at %I:%M %p").replace(" 0", " ")


# ------------------------------------------------------------------ tool bodies


def _check_availability(ctx: AgentContext, date: str, service_name: str = "") -> dict:
    cfg = _settings(ctx)
    slot_minutes = int(cfg.get("slot_minutes") or 30)
    max_days = int(cfg.get("max_days_ahead") or 30)

    day = _parse_day(date, ctx)
    if day is None:
        return {"error": f"Could not understand the date '{date}'. Use YYYY-MM-DD."}

    today = ctx.now().date()
    if day < today:
        return {"error": "That date has already passed.", "today": today.isoformat()}
    if day > today + timedelta(days=max_days):
        return {
            "error": f"We only take bookings up to {max_days} days ahead.",
            "latest_date": (today + timedelta(days=max_days)).isoformat(),
        }

    window = _hours_for(ctx, day)
    if window is None:
        return {
            "date": day.isoformat(),
            "day_name": day.strftime("%A"),
            "closed": True,
            "free_slots": [],
            "instruction": "The business is closed that day. Offer another day.",
        }

    service = _find_service(ctx, service_name) if service_name else None
    duration = int((service or {}).get("duration_minutes") or slot_minutes) or slot_minutes

    opens, closes = window
    start = datetime.combine(day, opens, tzinfo=ctx.tz)
    end = datetime.combine(day, closes, tzinfo=ctx.tz)

    # Busy slots. A 60-minute booking blocks two 30-minute slots.
    busy: set[str] = set()
    for row in booking_repo.booked_between(
        ctx.business_id, start.astimezone(UTC) - timedelta(hours=4), end.astimezone(UTC)
    ):
        begins = datetime.fromisoformat(str(row["starts_at"]).replace("Z", "+00:00")).astimezone(ctx.tz)
        blocks = max(1, int(row.get("duration_minutes") or slot_minutes) // slot_minutes)
        for i in range(blocks):
            busy.add((begins + timedelta(minutes=slot_minutes * i)).strftime("%H:%M"))

    now = ctx.now()
    free: list[str] = []
    cursor = start
    while cursor + timedelta(minutes=duration) <= end:
        label = cursor.strftime("%H:%M")
        # Every slot the service would occupy must be free.
        blocks = max(1, duration // slot_minutes)
        occupied = any(
            (cursor + timedelta(minutes=slot_minutes * i)).strftime("%H:%M") in busy
            for i in range(blocks)
        )
        if not occupied and cursor > now:
            free.append(label)
        cursor += timedelta(minutes=slot_minutes)

    return {
        "date": day.isoformat(),
        "day_name": day.strftime("%A"),
        "closed": False,
        "opens": opens.strftime("%H:%M"),
        "closes": closes.strftime("%H:%M"),
        "service": (service or {}).get("name"),
        "duration_minutes": duration,
        "free_slots": free,
        "instruction": "Offer at most three of these, in 12-hour time. Never "
        "offer a time that is not in this list.",
    }


MAX_OFFERED = 3


def _minutes(clock: str) -> int | None:
    """'18:30' -> 1110. None for anything that is not HH:MM."""
    try:
        hours, minutes = clock.strip().split(":")[:2]
        return int(hours) * 60 + int(minutes)
    except (ValueError, AttributeError):
        return None


def _offer(check: dict, preferred_time: str = "") -> dict:
    """
    Cut an availability result down to the few slots worth saying out loud.

    The prompt asks for "at most three", and in testing the model read out all
    eleven anyway. So the model is never handed more than three: it cannot list
    what it does not have. The full list stays inside _check_availability,
    where request_booking needs it to validate any time the customer picks.
    """
    free = check.get("free_slots") or []
    if len(free) <= MAX_OFFERED:
        return check

    target = _minutes(preferred_time)
    if target is None:
        chosen = free[:MAX_OFFERED]
    else:
        nearest = sorted(free, key=lambda slot: abs(_minutes(slot) - target))[:MAX_OFFERED]
        chosen = sorted(nearest)

    return {
        **check,
        "free_slots": chosen,
        "more_free_slots": len(free) - len(chosen),
        "instruction": "Offer these times, in 12-hour format. Other times are "
        "free too - if none of these suit, ask what time they would like and "
        "call check_availability again with preferred_time.",
    }


def _check_availability_tool(
    ctx: AgentContext, date: str, service_name: str = "", preferred_time: str = ""
) -> dict:
    return _offer(_check_availability(ctx, date, service_name), preferred_time)


def _request_booking(
    ctx: AgentContext,
    service_name: str,
    starts_at: str,
    customer_name: str,
    customer_phone: str,
    notes: str = "",
) -> dict:
    cfg = _settings(ctx)

    service = _find_service(ctx, service_name)
    if service is None:
        return {
            "error": f"No service called '{service_name}'.",
            "available": [s["name"] for s in business_repo.list_services(ctx.business_id)],
        }

    try:
        naive = datetime.fromisoformat(starts_at.replace("Z", "").strip())
    except ValueError:
        return {"error": f"Could not read the time '{starts_at}'. Use YYYY-MM-DDTHH:MM."}

    local = naive if naive.tzinfo else naive.replace(tzinfo=ctx.tz)
    if local <= ctx.now():
        return {"error": "That time has already passed. Offer a later slot."}

    # Re-check availability. Cheap, and it catches the common case of the model
    # inventing a time it was never offered.
    check = _check_availability(ctx, local.date().isoformat(), service["name"])
    if check.get("error"):
        return check
    if local.strftime("%H:%M") not in (check.get("free_slots") or []):
        return {
            "error": "That time is not free.",
            "free_slots": check.get("free_slots"),
            "instruction": "Offer one of these instead. Do not book anything else.",
        }

    customer = customer_repo.upsert_from_chat(
        business_id=ctx.business_id, name=customer_name, phone=customer_phone
    )
    if customer is None:
        return {
            "error": "A usable phone number is required.",
            "instruction": "Ask for their phone number before trying again.",
        }

    conversation_repo.attach_customer(ctx.business_id, ctx.conversation_id, customer["id"])

    requires_approval = bool(cfg.get("require_approval", True))

    try:
        created = booking_repo.create(
            business_id=ctx.business_id,
            customer_id=customer["id"],
            conversation_id=ctx.conversation_id,
            service_id=service["id"],
            starts_at_utc=local.astimezone(UTC),
            duration_minutes=int(service.get("duration_minutes") or 30),
            service_name=service["name"],
            price=float(service.get("price") or 0),
            notes=notes,
            status="pending" if requires_approval else "confirmed",
        )
    except booking_repo.SlotTaken:
        # Someone took it between the check above and this insert.
        fresh = _offer(
            _check_availability(ctx, local.date().isoformat(), service["name"]),
            local.strftime("%H:%M"),
        )
        return {
            "error": "That slot was taken a moment ago.",
            "free_slots": fresh.get("free_slots"),
            "instruction": "Apologise briefly and offer one of these instead.",
        }

    reference = created["id"][:8].upper()
    logger.info("Booking %s created for business %s", reference, ctx.business_id)

    return {
        "booked": True,
        "status": created["status"],
        "reference": reference,
        "service": service["name"],
        "price": float(service.get("price") or 0),
        "when": _label(local),
        "message_to_customer": (
            f"Your booking is requested for {_label(local)}, reference {reference}. "
            "The team will confirm it shortly and you will see the confirmation here."
            if requires_approval
            else f"You're booked for {_label(local)}, reference {reference}."
        ),
    }


def _my_bookings(ctx: AgentContext, customer_phone: str) -> dict:
    customer = customer_repo.get_by_phone(ctx.business_id, customer_phone)
    if customer is None:
        return {
            "found": 0,
            "bookings": [],
            "instruction": "No bookings under that number. Check the number with them.",
        }

    out = []
    for row in booking_repo.list_for_customer(ctx.business_id, customer["id"]):
        moment = datetime.fromisoformat(str(row["starts_at"]).replace("Z", "+00:00")).astimezone(ctx.tz)
        out.append(
            {
                "reference": row["id"][:8].upper(),
                "service": row["service_name"],
                "when": _label(moment),
                "status": row["status"],
                "upcoming": moment > ctx.now(),
            }
        )
    return {"found": len(out), "bookings": out}


def _cancel_booking(ctx: AgentContext, reference: str, customer_phone: str) -> dict:
    booking = booking_repo.find_by_reference(ctx.business_id, reference)
    if booking is None:
        return {"error": f"No booking with reference {reference}."}

    # The reference alone is guessable, so the phone number must match.
    customer = booking.get("customers") or {}
    given = customer_repo.normalise_phone(customer_phone)
    if not given or given != customer.get("phone"):
        return {
            "error": "That phone number does not match the booking.",
            "instruction": "Do not cancel. Ask them to check the number, or "
            "call escalate_to_human.",
        }

    if booking["status"] == "cancelled":
        return {"already_cancelled": True, "reference": reference}

    booking_repo.set_status(
        business_id=ctx.business_id,
        appointment_id=booking["id"],
        status="cancelled",
        decided_by="customer",
        note="Cancelled by the customer in chat",
    )
    logger.info("Booking %s cancelled by the customer", reference)
    return {
        "cancelled": True,
        "reference": reference,
        "message_to_customer": "That booking is cancelled. The slot is free for someone else.",
    }


# --------------------------------------------------------------------- assembly


def build_tools(ctx: AgentContext) -> list[StructuredTool]:
    """Booking tools, bound to this business and conversation."""

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
            _check_availability_tool,
            "check_availability",
            "Free appointment slots on a given date. ALWAYS call this before "
            "offering any time to a customer. Never suggest a time you did not "
            "get from this tool.",
            AvailabilityArgs,
        ),
        wrap(
            _request_booking,
            "request_booking",
            "Create a booking. Requires the customer's name AND phone number — "
            "ask for them first. This does NOT confirm the booking; the team "
            "approves it. Tell the customer it is requested, not confirmed.",
            BookingArgs,
        ),
        wrap(
            _my_bookings,
            "get_my_bookings",
            "Look up a customer's existing bookings by their phone number.",
            LookupArgs,
        ),
        wrap(
            _cancel_booking,
            "cancel_booking",
            "Cancel a booking. Needs the reference AND the phone number it was "
            "booked under, which proves it is really their booking.",
            CancelArgs,
        ),
    ]
