"""
Appointments.

The only module that writes bookings. Two things here are not obvious:

  * `create` catches the double-booking unique violation and reports it as a
    normal outcome, because two customers CAN race for the same slot.
  * Times are stored in UTC and compared in UTC. Callers deal in local time
    and convert at the boundary.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.db import db, one, rows

logger = logging.getLogger("aibh.appointments")

# Postgres error code for a unique-constraint violation.
UNIQUE_VIOLATION = "23505"


class SlotTaken(Exception):
    """Someone booked that time between our availability check and our insert."""


def create(
    *,
    business_id: str,
    customer_id: str,
    starts_at_utc: datetime,
    duration_minutes: int,
    service_name: str,
    price: float,
    service_id: str | None = None,
    conversation_id: str | None = None,
    notes: str = "",
    status: str = "pending",
    source: str = "customer_chat",
) -> dict:
    """
    Insert one booking.

    Raises SlotTaken when the database refuses because that slot is already
    live. Callers turn that into a polite "that just went, here are other
    times" rather than an error.
    """
    try:
        created = one(
            db.table("appointments")
            .insert(
                {
                    "business_id": business_id,
                    "customer_id": customer_id,
                    "service_id": service_id,
                    "conversation_id": conversation_id,
                    "starts_at": starts_at_utc.isoformat(),
                    "duration_minutes": duration_minutes,
                    "price": price,
                    "service_name": service_name,
                    "notes": notes,
                    "status": status,
                    "source": source,
                }
            )
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        text = str(exc)
        if UNIQUE_VIOLATION in text or "appointments_no_double_booking" in text:
            logger.info("Slot %s already taken for business %s", starts_at_utc, business_id)
            raise SlotTaken(str(starts_at_utc)) from exc
        raise

    if not created:
        raise RuntimeError("Could not create the booking")
    return created


def booked_between(business_id: str, start_utc: datetime, end_utc: datetime) -> list[dict]:
    """Live bookings that occupy time in a window. Cancelled ones do not count."""
    return rows(
        db.table("appointments")
        .select("id, starts_at, duration_minutes, status")
        .eq("business_id", business_id)
        .in_("status", ["pending", "confirmed"])
        .gte("starts_at", start_utc.isoformat())
        .lt("starts_at", end_utc.isoformat())
        .order("starts_at")
        .execute()
    )


def get(business_id: str, appointment_id: str) -> dict | None:
    return one(
        db.table("appointments")
        .select("*, customers(id, name, phone, email), business_services(id, name)")
        .eq("business_id", business_id)
        .eq("id", appointment_id)
        .limit(1)
        .execute()
    )


def find_by_reference(business_id: str, reference: str) -> dict | None:
    """
    Look a booking up by the short code we show customers.

    We show the first 8 characters of the uuid, uppercased. PostgREST cannot
    filter on a prefix of a uuid column, so we scan this business's recent
    bookings — fine at this scale, and it keeps the customer-facing reference
    short enough to say out loud.
    """
    wanted = (reference or "").strip().upper().lstrip("#")
    if len(wanted) < 6:
        return None
    for row in list_upcoming(business_id, days=365, limit=500):
        if row["id"][:8].upper() == wanted[:8]:
            return row
    return None


def list_for_customer(business_id: str, customer_id: str, limit: int = 20) -> list[dict]:
    return rows(
        db.table("appointments")
        .select("*, customers(id, name, phone)")
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("starts_at", desc=True)
        .limit(limit)
        .execute()
    )


def list_upcoming(business_id: str, days: int = 30, limit: int = 200) -> list[dict]:
    now = datetime.now(timezone.utc)
    return rows(
        db.table("appointments")
        .select("*, customers(id, name, phone, email)")
        .eq("business_id", business_id)
        .gte("starts_at", (now - timedelta(days=1)).isoformat())
        .lt("starts_at", (now + timedelta(days=days)).isoformat())
        .order("starts_at")
        .limit(limit)
        .execute()
    )


def list_all(business_id: str, limit: int = 200) -> list[dict]:
    """Everything, newest first. What the dashboard table shows."""
    return rows(
        db.table("appointments")
        .select("*, customers(id, name, phone, email)")
        .eq("business_id", business_id)
        .order("starts_at", desc=True)
        .limit(limit)
        .execute()
    )


def set_status(
    *,
    business_id: str,
    appointment_id: str,
    status: str,
    decided_by: str = "owner",
    note: str = "",
) -> dict | None:
    if status not in {"pending", "confirmed", "cancelled", "completed"}:
        raise ValueError(f"Invalid booking status: {status}")

    patch: dict = {"status": status, "decision_note": note}
    if status in {"confirmed", "cancelled", "completed"}:
        patch["decided_at"] = datetime.now(timezone.utc).isoformat()
        patch["decided_by"] = decided_by

    db.table("appointments").update(patch).eq("business_id", business_id).eq(
        "id", appointment_id
    ).execute()

    return get(business_id, appointment_id)


def pending_count(business_id: str) -> int:
    return len(
        rows(
            db.table("appointments")
            .select("id")
            .eq("business_id", business_id)
            .eq("status", "pending")
            .execute()
        )
    )
