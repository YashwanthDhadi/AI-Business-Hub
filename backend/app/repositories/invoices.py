"""
Invoices.

The rules that matter are in the database (migration 004), not here:

  * numbers come from create_invoice(), ONE Postgres function that bumps a
    counter and inserts the invoice in one transaction - two owners clicking
    at once get 0007 and 0008, never two 0007s, and never a gap
  * an issued invoice cannot be edited (a trigger refuses it)
  * status only moves pending -> paid | cancelled, and paid -> refunded
  * a booking has at most one live invoice
  * the amount is added up by the database from the items

This module calls those rules and turns a refusal into InvoiceRefused(rule).
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone

from app.db import db, one, rows

logger = logging.getLogger("aibh.invoices")

# Every invoice read comes with who it is for and which booking it bills.
SELECT = "*, customers(id, name, phone, email), appointments(id, starts_at, service_name)"

METHODS = {"upi", "cash", "card", "bank_transfer"}

# Every rule the database can refuse with -> what to tell a person.
RULES = {
    "invoices_one_live_per_booking": "This booking already has an invoice that is unpaid or paid.",
    "invoices_immutable": "An issued invoice cannot be edited. Cancel it and issue a new one.",
    "invoices_bad_transition": "That change is not allowed for an invoice in this state.",
    "invoices_no_items": "An invoice needs at least one item.",
    "invoices_bad_item": "Every item needs a description, a quantity of at least 1 and a price of ₹0 or more.",
    "invoices_due_in_past": "The due date cannot be in the past.",
    "invoices_paid_needs_method": "Record how the invoice was paid.",
    "invoices_paid_method_values": "Payment method must be UPI, cash, card or bank transfer.",
    "invoices_number_length": "Invoice numbers can be at most 16 characters - use a prefix of 3 letters or fewer.",
    "invoices_customer_same_business": "That customer does not belong to this business.",
    "invoices_booking_same_business": "That booking does not belong to this business.",
    "invoices_unknown_business": "That business does not exist.",
}

TOKEN_SHAPE = re.compile(r"^[0-9a-f]{32}$")


class InvoiceRefused(Exception):
    """The database refused because of a rule. `rule` is its name."""

    def __init__(self, rule: str, message: str) -> None:
        self.rule = rule
        super().__init__(message)


class NotPending(Exception):
    """The invoice was no longer in the expected state - probably decided in another tab."""


def _explain(exc: Exception) -> Exception:
    text = str(exc)
    for rule, message in RULES.items():
        if rule in text:
            return InvoiceRefused(rule, message)
    return exc


def _run(query):
    """Execute, translating a rule refusal. Anything else is re-raised unchanged."""
    try:
        return query.execute()
    except Exception as exc:  # noqa: BLE001
        explained = _explain(exc)
        if explained is exc:
            raise
        raise explained from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise_number(raw: str | None) -> str:
    """' inv/2026-27/0007 ' -> 'INV/2026-27/0007'. Customers type it every way."""
    return (raw or "").strip().upper().replace("\\", "/").replace(" ", "")


# ---------------------------------------------------------------------- issue


def create(
    *,
    business_id: str,
    customer_id: str,
    items: list[dict],
    due_date: date,
    appointment_id: str | None = None,
    conversation_id: str | None = None,
    notes: str = "",
    prefix: str = "INV",
) -> dict:
    """
    Issue an invoice through the database's create_invoice().

    items: [{"description": str, "quantity": int, "unit_price": number}].
    Any "total" you include is ignored - the database does the arithmetic.
    Raises InvoiceRefused if a rule says no.
    """
    created = one(
        _run(
            db.rpc(
                "create_invoice",
                {
                    "p_business_id": business_id,
                    "p_customer_id": customer_id,
                    "p_items": items,
                    "p_due_date": due_date.isoformat(),
                    "p_appointment_id": appointment_id,
                    "p_conversation_id": conversation_id,
                    "p_notes": notes,
                    "p_prefix": prefix,
                },
            )
        )
    )
    if created is None:
        raise RuntimeError("create_invoice returned nothing")
    logger.info("Invoice %s issued for business %s", created["invoice_number"], business_id)
    return get(business_id, created["id"]) or created


# ----------------------------------------------------------------------- read


def get(business_id: str, invoice_id: str) -> dict | None:
    return one(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .eq("id", invoice_id)
        .limit(1)
        .execute()
    )


def get_by_number(business_id: str, invoice_number: str) -> dict | None:
    number = normalise_number(invoice_number)
    if not number:
        return None
    return one(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .eq("invoice_number", number)
        .limit(1)
        .execute()
    )


def get_by_token(token: str) -> dict | None:
    """
    The ONE read in the codebase that does not filter on business_id.

    The public pay page has no login. The 32-character random token in its URL
    is the permission - like a password in the link - and it only ever unlocks
    this one invoice. Anything not token-shaped is refused before it reaches
    the database.
    """
    if not TOKEN_SHAPE.match(token or ""):
        return None
    return one(
        db.table("invoices")
        .select(SELECT)
        .eq("public_token", token)
        .limit(1)
        .execute()
    )


def list_all(business_id: str, limit: int = 500) -> list[dict]:
    return rows(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )


def list_for_customer(business_id: str, customer_id: str) -> list[dict]:
    return rows(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .execute()
    )


def live_for_booking(business_id: str, appointment_id: str) -> dict | None:
    """The booking's pending or paid invoice, if it has one."""
    return one(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .eq("appointment_id", appointment_id)
        .in_("status", ["pending", "paid"])
        .limit(1)
        .execute()
    )


# ------------------------------------------------------ what happens to it


def _update_if(business_id: str, invoice_id: str, patch: dict, *, only_status: str) -> dict:
    """
    Apply `patch` only while the invoice is still `only_status`.

    The status filter is part of the UPDATE itself, so if another tab marked it
    paid a moment ago, this updates nothing and we raise NotPending - instead
    of recording a second payment. The trigger would refuse a bad transition
    anyway; this turns that into a clear message before it gets there.
    """
    changed = rows(
        _run(
            db.table("invoices")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", invoice_id)
            .eq("status", only_status)
        )
    )
    if not changed:
        raise NotPending(f"This invoice is no longer {only_status}.")
    return get(business_id, invoice_id) or changed[0]


def mark_paid(*, business_id: str, invoice_id: str, method: str, reference: str = "") -> dict:
    """The owner saw the money arrive. The ONLY way an invoice becomes paid."""
    if method not in METHODS:
        raise InvoiceRefused("invoices_paid_method_values", RULES["invoices_paid_method_values"])
    return _update_if(
        business_id,
        invoice_id,
        {
            "status": "paid",
            "paid_at": _now(),
            "paid_method": method,
            "paid_reference": (reference or "").strip()[:60],
        },
        only_status="pending",
    )


def cancel(*, business_id: str, invoice_id: str, reason: str = "") -> dict:
    return _update_if(
        business_id,
        invoice_id,
        {"status": "cancelled", "cancelled_at": _now(), "cancel_reason": (reason or "").strip()[:300]},
        only_status="pending",
    )


def refund(*, business_id: str, invoice_id: str, note: str = "") -> dict:
    """Record a refund the owner has ALREADY made, outside this system."""
    return _update_if(
        business_id,
        invoice_id,
        {"status": "refunded", "refunded_at": _now(), "refund_note": (note or "").strip()[:300]},
        only_status="paid",
    )


def record_customer_report(*, business_id: str, invoice_id: str, reference: str = "") -> dict:
    """
    The customer SAYS they paid. Stored as a claim for the owner to check.

    The status stays pending: a message in a chat is not money in a bank.
    """
    return _update_if(
        business_id,
        invoice_id,
        {"customer_reported_at": _now(), "customer_reference": (reference or "").strip()[:60] or None},
        only_status="pending",
    )


def claim_reminder_slot(*, business_id: str, invoice_id: str, hours: int = 24) -> bool:
    """
    True if a reminder may be sent now, and records that it was.

    Check and write in ONE update: "set last_reminded_at = now, but only if
    it is empty or older than 24 hours". Two quick clicks cannot both win.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    changed = rows(
        db.table("invoices")
        .update({"last_reminded_at": _now()})
        .eq("business_id", business_id)
        .eq("id", invoice_id)
        .eq("status", "pending")
        .or_(f"last_reminded_at.is.null,last_reminded_at.lt.{cutoff}")
        .execute()
    )
    return bool(changed)
