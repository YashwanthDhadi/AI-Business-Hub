"""
The owner's payments API: /api/v1/dashboard/payments.

Every movement of money goes through here and nowhere else: issuing an
invoice, marking it paid, cancelling it, recording a refund. The chat agent
has no route and no tool that reaches any of these - that is the owner gate.

The rules themselves (numbering, immutability, allowed status changes, one
invoice per booking) are in the database. This file checks the obvious things
early so the owner gets a clear message, and posts to the customer's chat.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException

from app.repositories import appointments as booking_repo
from app.repositories import businesses as business_repo
from app.repositories import conversations as conversation_repo
from app.repositories import customers as customer_repo
from app.repositories import invoices as invoice_repo
from app.schemas import InvoiceCancel, InvoiceCreate, InvoicePaid, InvoiceRefund, PaymentSettingsPatch
from app.security import business_scope, require_dashboard_key
from app.services import payments as payments_service
from app.services.formatting import spoken_date

logger = logging.getLogger("aibh.router.payments")

router = APIRouter(
    prefix="/api/v1/dashboard/payments",
    tags=["payments"],
    dependencies=[Depends(require_dashboard_key)],
)

# Refusals that mean "the invoice is not in a state for that" -> 409 Conflict.
# Everything else a rule refuses is a bad request -> 400.
CONFLICTS = {"invoices_one_live_per_booking", "invoices_bad_transition", "invoices_immutable"}


def _is_uuid(value: str | None) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def _context(business_id: str) -> tuple[dict, dict, date]:
    """The business, its payment settings, and today in its timezone."""
    business = business_repo.get_business(business_id) if _is_uuid(business_id) else None
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    return business, payments_service.payment_settings(business_id), payments_service.business_today(business)


def _refused(error: invoice_repo.InvoiceRefused) -> HTTPException:
    return HTTPException(status_code=409 if error.rule in CONFLICTS else 400, detail=str(error))


def _load(business_id: str, invoice_id: str) -> dict:
    invoice = invoice_repo.get(business_id, invoice_id) if _is_uuid(invoice_id) else None
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


def _settings_view(cfg: dict) -> dict:
    return {
        "upiId": cfg.get("upi_id") or "",
        "payeeName": cfg.get("payee_name") or "",
        "invoicePrefix": cfg.get("invoice_prefix") or "INV",
        "dueDays": int(cfg.get("due_days") if cfg.get("due_days") is not None else 7),
        "upiReady": bool(cfg.get("upi_id")),
    }


NOT_PENDING = "This invoice is not waiting for payment any more. Reload to see what changed."


# ---------------------------------------------------------------------- read


@router.get("/invoices")
def list_invoices(business_id: str = Depends(business_scope)) -> dict:
    business, cfg, today = _context(business_id)
    return {
        "invoices": [payments_service.shape(i, business, cfg, today) for i in invoice_repo.list_all(business_id)],
        "settings": _settings_view(cfg),
        "business": {"name": business.get("name") or "", "today": today.isoformat()},
    }


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: str, business_id: str = Depends(business_scope)) -> dict:
    business, cfg, today = _context(business_id)
    return {"invoice": payments_service.shape(_load(business_id, invoice_id), business, cfg, today)}


@router.get("/catalog")
def catalog(business_id: str = Depends(business_scope)) -> dict:
    """The services an invoice can be written for, with today's prices."""
    _context(business_id)
    return {
        "services": [
            {
                "id": s["id"],
                "name": s["name"],
                "price": float(s.get("price") or 0),
                "durationMinutes": s.get("duration_minutes") or 0,
            }
            for s in business_repo.list_services(business_id)
        ]
    }


# ---------------------------------------------------------------------- issue


@router.post("/invoices", status_code=201)
def create_invoice(payload: InvoiceCreate, business_id: str = Depends(business_scope)) -> dict:
    business, cfg, today = _context(business_id)

    if not _is_uuid(payload.customer_id) or customer_repo.get(business_id, payload.customer_id) is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    items = [item.model_dump() for item in payload.items]
    booking = None
    if payload.appointment_id:
        booking = booking_repo.get(business_id, payload.appointment_id) if _is_uuid(payload.appointment_id) else None
        if booking is None:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking["customer_id"] != payload.customer_id:
            raise HTTPException(status_code=400, detail="That booking belongs to a different customer.")
        if booking["status"] == "cancelled":
            raise HTTPException(status_code=400, detail="That booking was cancelled, so there is nothing to bill.")
        if not items:
            # The booking's OWN snapshot - the price the customer was quoted -
            # never today's price from business_services.
            when = spoken_date(payments_service.local_date(booking["starts_at"], business) or "")
            items = [
                {
                    "description": f"{booking['service_name']} on {when}",
                    "quantity": 1,
                    "unit_price": float(booking.get("price") or 0),
                }
            ]

    if not items:
        raise HTTPException(status_code=400, detail="Add at least one item, or bill a booking.")

    due = payload.due_date or today + timedelta(days=int(cfg.get("due_days") or 7))

    # Where to send it: the chat the booking came from, else their latest chat.
    conversation_id = (booking or {}).get("conversation_id") or (
        conversation_repo.latest_for_customer(business_id, payload.customer_id) or {}
    ).get("id")

    try:
        invoice = invoice_repo.create(
            business_id=business_id,
            customer_id=payload.customer_id,
            items=items,
            due_date=due,
            appointment_id=payload.appointment_id or None,
            conversation_id=conversation_id,
            notes=payload.notes,
            prefix=cfg.get("invoice_prefix") or "INV",
        )
    except invoice_repo.InvoiceRefused as error:
        raise _refused(error) from error

    notified = payload.send_to_chat and payments_service.post_to_chat(
        business_id, invoice, payments_service.invoice_message(invoice, business, cfg), "invoice"
    )
    return {"invoice": payments_service.shape(invoice, business, cfg, today), "customer_notified": bool(notified)}


# ------------------------------------------------------- what happens to it


@router.post("/invoices/{invoice_id}/paid")
def mark_paid(invoice_id: str, payload: InvoicePaid, business_id: str = Depends(business_scope)) -> dict:
    """
    The owner saw the money arrive. The ONLY path in the system to 'paid'.
    """
    business, cfg, today = _context(business_id)
    _load(business_id, invoice_id)
    try:
        invoice = invoice_repo.mark_paid(
            business_id=business_id, invoice_id=invoice_id, method=payload.method, reference=payload.reference
        )
    except invoice_repo.NotPending as error:
        raise HTTPException(status_code=409, detail=NOT_PENDING) from error
    except invoice_repo.InvoiceRefused as error:
        raise _refused(error) from error

    notified = payload.send_receipt and payments_service.post_to_chat(
        business_id, invoice, payments_service.receipt_message(invoice), "receipt"
    )
    logger.info("Invoice %s marked paid by %s", invoice["invoice_number"], payload.method)
    return {"invoice": payments_service.shape(invoice, business, cfg, today), "customer_notified": bool(notified)}


@router.post("/invoices/{invoice_id}/cancel")
def cancel_invoice(invoice_id: str, payload: InvoiceCancel, business_id: str = Depends(business_scope)) -> dict:
    business, cfg, today = _context(business_id)
    _load(business_id, invoice_id)
    try:
        invoice = invoice_repo.cancel(business_id=business_id, invoice_id=invoice_id, reason=payload.reason)
    except invoice_repo.NotPending as error:
        raise HTTPException(status_code=409, detail="Only an unpaid invoice can be cancelled.") from error

    notified = payload.notify and payments_service.post_to_chat(
        business_id,
        invoice,
        f"Invoice {invoice['invoice_number']} has been cancelled - you don't need to pay it.",
        "invoice_cancelled",
    )
    return {"invoice": payments_service.shape(invoice, business, cfg, today), "customer_notified": bool(notified)}


@router.post("/invoices/{invoice_id}/refund")
def refund_invoice(invoice_id: str, payload: InvoiceRefund, business_id: str = Depends(business_scope)) -> dict:
    """Record a refund the owner has ALREADY paid back, outside this system."""
    business, cfg, today = _context(business_id)
    _load(business_id, invoice_id)
    try:
        invoice = invoice_repo.refund(business_id=business_id, invoice_id=invoice_id, note=payload.note)
    except invoice_repo.NotPending as error:
        raise HTTPException(status_code=409, detail="Only a paid invoice can be refunded.") from error
    return {"invoice": payments_service.shape(invoice, business, cfg, today)}


@router.post("/invoices/{invoice_id}/remind")
def remind(invoice_id: str, business_id: str = Depends(business_scope)) -> dict:
    """Post a reminder into the customer's own chat. Free - no SMS, no WhatsApp."""
    business, cfg, today = _context(business_id)
    invoice = _load(business_id, invoice_id)

    if invoice["status"] != "pending":
        raise HTTPException(status_code=409, detail="Only an unpaid invoice needs a reminder.")
    if not invoice.get("conversation_id"):
        phone = (invoice.get("customers") or {}).get("phone") or "their number"
        raise HTTPException(
            status_code=422,
            detail=f"This customer has never chatted with us, so there is nowhere to send it. Call them on {phone}.",
        )
    if not invoice_repo.claim_reminder_slot(business_id=business_id, invoice_id=invoice_id):
        raise HTTPException(status_code=429, detail="A reminder was already sent in the last 24 hours.")

    payments_service.post_to_chat(
        business_id, invoice, payments_service.reminder_message(invoice, business, cfg, today), "reminder"
    )
    fresh = invoice_repo.get(business_id, invoice_id) or invoice
    return {"invoice": payments_service.shape(fresh, business, cfg, today), "customer_notified": True}


# ------------------------------------------------------------------ settings


@router.get("/settings")
def get_settings(business_id: str = Depends(business_scope)) -> dict:
    _, cfg, _ = _context(business_id)
    return {"settings": _settings_view(cfg)}


@router.patch("/settings")
def update_settings(payload: PaymentSettingsPatch, business_id: str = Depends(business_scope)) -> dict:
    _context(business_id)
    patch: dict = {}

    if payload.upi_id is not None:
        upi_id = payload.upi_id.strip()
        if upi_id and not payments_service.UPI_ID_SHAPE.match(upi_id):
            raise HTTPException(status_code=400, detail="That does not look like a UPI ID. It looks like yourname@okaxis.")
        patch["upi_id"] = upi_id or None
    if payload.payee_name is not None:
        patch["payee_name"] = payload.payee_name.strip() or None
    if payload.invoice_prefix is not None:
        prefix = payload.invoice_prefix.strip().upper()
        if not payments_service.PREFIX_SHAPE.match(prefix):
            raise HTTPException(
                status_code=400,
                detail="The invoice prefix must be 1 to 3 letters or digits, so numbers stay within 16 characters.",
            )
        patch["invoice_prefix"] = prefix
    if payload.due_days is not None:
        patch["due_days"] = payload.due_days

    merged = business_repo.update_agent_settings(business_id, "payment", patch) if patch else payments_service.payment_settings(business_id)
    return {"settings": _settings_view({**payments_service.DEFAULTS, **merged})}
