"""
Payments glue shared by the chat tools, the dashboard and the public pay page.

Settings, the UPI link, the pay-page link, the status a person sees, and the
sentences posted into a customer's chat. No money RULES live here - those are
in the database (migration 004).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

from app.config import settings
from app.repositories import businesses as business_repo
from app.repositories import conversations as conversation_repo
from app.services.formatting import rupees, spoken_date

DEFAULTS = {"upi_id": None, "payee_name": None, "invoice_prefix": "INV", "due_days": 7}

# name@bank, e.g. pulsefitness@okaxis, 9876543210@ybl, pulse.fitness@oksbi
UPI_ID_SHAPE = re.compile(r"^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$")
# Up to 3 characters, so INV/2026-27/0001 stays within GST's 16.
PREFIX_SHAPE = re.compile(r"^[A-Z0-9]{1,3}$")

METHOD_LABELS = {"upi": "UPI", "cash": "cash", "card": "card", "bank_transfer": "bank transfer"}


def payment_settings(business_id: str) -> dict:
    """This business's payment settings, with defaults for anything unset."""
    return {**DEFAULTS, **business_repo.agent_settings(business_id, "payment")}


def business_tz(business: dict) -> ZoneInfo:
    try:
        return ZoneInfo(business.get("timezone") or "Asia/Kolkata")
    except Exception:  # noqa: BLE001
        return ZoneInfo("Asia/Kolkata")


def business_today(business: dict) -> date:
    """Today in the business's timezone - the date an Indian customer sees."""
    return datetime.now(business_tz(business)).date()


def display_status(invoice: dict, today: date) -> str:
    """
    'overdue' is not stored. It is 'pending' plus a due date in the past, so it
    can never be out of date - at midnight IST it simply becomes true.
    """
    if invoice["status"] == "pending" and date.fromisoformat(str(invoice["due_date"])) < today:
        return "overdue"
    return invoice["status"]


def pay_url(invoice: dict) -> str:
    """The public pay page. The random token in it is the only permission."""
    return f"{settings.public_site_url.rstrip('/')}/pay/{invoice['public_token']}"


def upi_link(invoice: dict, cfg: dict, business: dict) -> str | None:
    """
    NPCI's standard upi://pay link, understood by every UPI app in India.

    None when the owner has not set a UPI ID, or the invoice is not payable:
    a paid invoice must never offer a way to pay it again.
    """
    if not cfg.get("upi_id") or invoice["status"] != "pending":
        return None
    params = {
        "pa": cfg["upi_id"],
        "pn": cfg.get("payee_name") or business.get("name") or "",
        "am": f"{float(invoice['amount']):.2f}",
        "cu": "INR",
        "tn": f"Invoice {invoice['invoice_number']}",
    }
    return "upi://pay?" + "&".join(f"{key}={quote(str(value), safe='')}" for key, value in params.items())


def local_date(iso: str | None, business: dict) -> str | None:
    """A UTC timestamp -> the business's local date, 'YYYY-MM-DD'."""
    if not iso:
        return None
    moment = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return moment.astimezone(business_tz(business)).date().isoformat()


def summary(invoice: dict) -> str:
    """'Personal Training', or 'Personal Training and 2 more'."""
    items = invoice.get("items") or []
    if not items:
        return "your invoice"
    first = items[0].get("description") or "your invoice"
    return first if len(items) == 1 else f"{first} and {len(items) - 1} more"


# --------------------------------------------------- what goes into chat


def invoice_message(invoice: dict, business: dict, cfg: dict) -> str:
    text = (
        f"Invoice {invoice['invoice_number']} for {rupees(invoice['amount'])} "
        f"({summary(invoice)}) is due by {spoken_date(str(invoice['due_date']))}."
    )
    if upi_link(invoice, cfg, business):
        return f"{text}\n\nPay by UPI here: {pay_url(invoice)}"
    return f"{text}\n\nYou can pay at the front desk. The invoice is here: {pay_url(invoice)}"


def reminder_message(invoice: dict, business: dict, cfg: dict, today: date) -> str:
    when = spoken_date(str(invoice["due_date"]))
    lead = (
        f"A reminder that invoice {invoice['invoice_number']} for {rupees(invoice['amount'])} was due on {when}."
        if display_status(invoice, today) == "overdue"
        else f"A reminder that invoice {invoice['invoice_number']} for {rupees(invoice['amount'])} is due by {when}."
    )
    how = "Pay by UPI here" if upi_link(invoice, cfg, business) else "The invoice is here"
    return (
        f"{lead}\n\n{how}: {pay_url(invoice)}\n\n"
        "If you have already paid, reply with the UPI reference and we'll check."
    )


def receipt_message(invoice: dict) -> str:
    method = METHOD_LABELS.get(invoice.get("paid_method") or "", "payment")
    return (
        f"Payment received: {rupees(invoice['amount'])} for invoice {invoice['invoice_number']}, "
        f"by {method}. Thank you!"
    )


def post_to_chat(business_id: str, invoice: dict, text: str, kind: str) -> bool:
    """Post into the customer's chat, if the invoice has one. True if it did."""
    conversation_id = invoice.get("conversation_id")
    if not conversation_id:
        return False
    conversation_repo.add_message(
        business_id=business_id,
        conversation_id=conversation_id,
        direction="outbound",
        author="system",
        body=text,
        meta={"kind": kind, "invoice_id": invoice["id"]},
    )
    return True


# ------------------------------------------------------------ the shapes


def shape(invoice: dict, business: dict, cfg: dict, today: date) -> dict:
    """invoices row -> the frontend's PaymentInvoice type (plus a few live-only fields)."""
    customer = invoice.get("customers") or {}
    return {
        "id": invoice["id"],
        "businessId": invoice["business_id"],
        "invoiceNumber": invoice["invoice_number"],
        "customerId": invoice["customer_id"],
        "customerName": customer.get("name") or customer.get("phone") or "Customer",
        "customerEmail": customer.get("email") or "",
        "customerPhone": customer.get("phone") or "",
        "amount": float(invoice["amount"]),
        "currency": invoice.get("currency") or "INR",
        "status": display_status(invoice, today),
        "dueDate": str(invoice["due_date"]),
        "paidDate": local_date(invoice.get("paid_at"), business),
        "items": [
            {
                "id": f"{invoice['id']}-{index}",
                "description": item.get("description") or "",
                "quantity": int(item.get("quantity") or 1),
                "unitPrice": float(item.get("unit_price") or 0),
                "total": float(item.get("total") or 0),
            }
            for index, item in enumerate(invoice.get("items") or [])
        ],
        "paymentMethod": invoice.get("paid_method"),
        "createdAt": invoice.get("created_at"),
        # ---- live-only fields ----
        "bookingId": invoice.get("appointment_id"),
        "bookingReference": (invoice.get("appointment_id") or "")[:8].upper() or None,
        "payUrl": pay_url(invoice),
        "upiReady": upi_link(invoice, cfg, business) is not None,
        "hasChat": bool(invoice.get("conversation_id")),
        "customerReportedAt": invoice.get("customer_reported_at"),
        "customerReference": invoice.get("customer_reference"),
        "paidReference": invoice.get("paid_reference") or "",
        "cancelReason": invoice.get("cancel_reason") or "",
        "refundNote": invoice.get("refund_note") or "",
        "lastRemindedAt": invoice.get("last_reminded_at"),
        "notes": invoice.get("notes") or "",
    }


def public_view(invoice: dict, business: dict, cfg: dict, today: date) -> dict:
    """
    What the PUBLIC pay page may show. Deliberately small: no phone, no email,
    no customer id, and only the customer's first name.
    """
    first_name = ((invoice.get("customers") or {}).get("name") or "").split(" ")[0]
    link = upi_link(invoice, cfg, business)
    return {
        "businessName": business.get("name") or "",
        "invoiceNumber": invoice["invoice_number"],
        "customerFirstName": first_name,
        "items": [
            {
                "description": item.get("description") or "",
                "quantity": int(item.get("quantity") or 1),
                "unitPrice": float(item.get("unit_price") or 0),
                "total": float(item.get("total") or 0),
            }
            for item in invoice.get("items") or []
        ],
        "amount": float(invoice["amount"]),
        "currency": "INR",
        "status": display_status(invoice, today),
        "dueDate": str(invoice["due_date"]),
        "paidDate": local_date(invoice.get("paid_at"), business),
        "upiLink": link,
        "upiId": cfg.get("upi_id") if link else None,
        "payeeName": (cfg.get("payee_name") or business.get("name")) if link else None,
        "customerReported": bool(invoice.get("customer_reported_at")),
    }
