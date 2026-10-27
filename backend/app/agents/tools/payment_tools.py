"""
Tools for the Payments capability.

Two tools, and the list of what is MISSING is the design:

  * get_invoice     - one invoice, given its number AND the phone it was issued to
  * report_payment  - record that the customer SAYS they paid

There is no tool that creates an invoice, marks one paid, refunds, or changes an
amount. Money moves only when the owner presses a button in the dashboard. Not
because the prompt asks nicely - because the agent has no way to do it.
"""

from __future__ import annotations

import logging

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.agents.tools.support_tools import AgentContext
from app.repositories import customers as customer_repo
from app.repositories import invoices as invoice_repo
from app.services import payments as payments_service
from app.services.formatting import rupees, spoken_date

logger = logging.getLogger("aibh.tools.payments")

# The SAME answer for "no such invoice" and "wrong phone", so a stranger cannot
# use the chat to find out which invoice numbers exist.
NO_MATCH = {
    "found": False,
    "instruction": "No invoice matches that number AND phone number. Do not guess or share "
    "anything. Ask them to check both - the invoice number looks like INV/2026-27/0007 and "
    "is in the message we sent them - or call escalate_to_human.",
}


class InvoiceArgs(BaseModel):
    invoice_number: str = Field(
        description="The invoice number exactly as the customer gives it, e.g. INV/2026-27/0007. "
        "Never guess or invent one."
    )
    customer_phone: str = Field(
        description="The phone number the invoice was issued to. Ask for it if you do not have "
        "it. Required - an invoice number alone is not enough."
    )


class ReportArgs(InvoiceArgs):
    upi_reference: str = Field(
        default="",
        description="The UPI transaction reference (UTR, usually 12 digits) if they have it. "
        "Leave empty if they do not.",
    )


def _verified(ctx: AgentContext, invoice_number: str, customer_phone: str) -> dict | None:
    """The invoice, only if the number AND the phone both match. Otherwise None."""
    invoice = invoice_repo.get_by_number(ctx.business_id, invoice_number)
    if invoice is None:
        return None
    given = customer_repo.normalise_phone(customer_phone)
    owner_phone = (invoice.get("customers") or {}).get("phone")
    if not given or given != owner_phone:
        return None
    return invoice


def _get_invoice(ctx: AgentContext, invoice_number: str, customer_phone: str) -> dict:
    invoice = _verified(ctx, invoice_number, customer_phone)
    if invoice is None:
        return NO_MATCH

    today = payments_service.business_today(ctx.business)
    status = payments_service.display_status(invoice, today)
    result = {
        "found": True,
        "invoice_number": invoice["invoice_number"],
        "for": payments_service.summary(invoice),
        "amount": rupees(invoice["amount"]),
        "status": status,
        "due": spoken_date(str(invoice["due_date"])),
    }

    if status in ("pending", "overdue"):
        result["pay_link"] = payments_service.pay_url(invoice)
        result["instruction"] = (
            "Tell them the amount and due date, and give them pay_link exactly as it is. "
            "It opens a page where they can pay by UPI. Never make up a link or a UPI ID."
        )
        if invoice.get("customer_reported_at"):
            result["instruction"] += (
                " They have already told us they paid; the team is checking. Say so."
            )
    elif status == "paid":
        result["paid_on"] = spoken_date(
            payments_service.local_date(invoice.get("paid_at"), ctx.business) or ""
        )
        result["instruction"] = "It is paid. Thank them. Do not share a payment link."
    else:
        result["instruction"] = (
            f"This invoice is {status}; it does not need paying. If they are unsure why, "
            "call escalate_to_human."
        )
    return result


def _report_payment(
    ctx: AgentContext, invoice_number: str, customer_phone: str, upi_reference: str = ""
) -> dict:
    invoice = _verified(ctx, invoice_number, customer_phone)
    if invoice is None:
        return NO_MATCH

    if invoice["status"] == "paid":
        return {
            "recorded": False,
            "already_paid": True,
            "instruction": "Our records already show this invoice as paid. Thank them.",
        }
    if invoice["status"] != "pending":
        return {
            "recorded": False,
            "instruction": f"This invoice is {invoice['status']}, so there is nothing to pay. "
            "If they paid anyway, call escalate_to_human.",
        }

    invoice_repo.record_customer_report(
        business_id=ctx.business_id, invoice_id=invoice["id"], reference=upi_reference
    )
    logger.info("Customer reported paying %s", invoice["invoice_number"])
    return {
        "recorded": True,
        "still_unpaid_until_checked": True,
        "message_to_customer": (
            "Thank you! I've let the team know. They'll check it has arrived and confirm here - "
            "until then it will still show as unpaid."
        ),
    }


def build_tools(ctx: AgentContext) -> list[StructuredTool]:
    """Payment tools, bound to this business and conversation."""

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
            _get_invoice,
            "get_invoice",
            "Look up ONE invoice: its amount, due date, status and payment link. Needs the "
            "invoice number AND the phone number it was issued to - ask for both.",
            InvoiceArgs,
        ),
        wrap(
            _report_payment,
            "report_payment",
            "Record that the customer SAYS they have paid an invoice, with their UPI "
            "reference if they have one. This does NOT mark it paid - the team checks "
            "their account first.",
            ReportArgs,
        ),
    ]
