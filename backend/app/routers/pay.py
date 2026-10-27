"""
The public pay page's API: /api/v1/pay/{token}.

NO AUTHENTICATION. The 32-character random token in the URL is the
permission, and it unlocks exactly one invoice. Responses are deliberately
small - see payments.public_view - because links get forwarded.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.repositories import businesses as business_repo
from app.repositories import invoices as invoice_repo
from app.schemas import PaymentClaim
from app.services import payments as payments_service

logger = logging.getLogger("aibh.router.pay")

router = APIRouter(prefix="/api/v1/pay", tags=["pay"])

INVALID = "This payment link is not valid. Please ask the business for a new one."


def _load(token: str) -> tuple[dict, dict, dict]:
    invoice = invoice_repo.get_by_token(token)
    business = business_repo.get_business(invoice["business_id"]) if invoice else None
    if invoice is None or business is None:
        # The same answer for a junk token and a deleted business.
        raise HTTPException(status_code=404, detail=INVALID)
    return invoice, business, payments_service.payment_settings(business["id"])


@router.get("/{token}")
def view(token: str) -> dict:
    invoice, business, cfg = _load(token)
    today = payments_service.business_today(business)
    return {"invoice": payments_service.public_view(invoice, business, cfg, today)}


@router.post("/{token}/claim")
def claim(token: str, payload: PaymentClaim) -> dict:
    """
    The customer says "I have paid". Recorded as a claim; the invoice stays
    pending until the owner checks their account.

    Only the FIRST claim posts into the chat, so a link that has been shared
    cannot be used to flood the customer's thread.
    """
    invoice, business, cfg = _load(token)
    if invoice["status"] != "pending":
        raise HTTPException(status_code=409, detail="This invoice is not waiting for payment.")

    first_claim = not invoice.get("customer_reported_at")
    try:
        invoice = invoice_repo.record_customer_report(
            business_id=business["id"], invoice_id=invoice["id"], reference=payload.reference
        )
    except invoice_repo.NotPending as error:
        raise HTTPException(status_code=409, detail="This invoice is not waiting for payment.") from error

    if first_claim:
        reference = f" (reference {payload.reference.strip()})" if payload.reference.strip() else ""
        payments_service.post_to_chat(
            business["id"],
            invoice,
            f"Thanks - we've noted that you paid invoice {invoice['invoice_number']}{reference}. "
            "We'll confirm here once we've checked it has arrived.",
            "payment_claim",
        )
    logger.info("Customer claimed payment of %s from the pay page", invoice["invoice_number"])

    today = payments_service.business_today(business)
    return {"invoice": payments_service.public_view(invoice, business, cfg, today)}
