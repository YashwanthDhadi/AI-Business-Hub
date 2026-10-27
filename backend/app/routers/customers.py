"""
The owner's client directory: /api/v1/dashboard/customers.

Separate from dashboard.py only to keep files readable. Same prefix, same
dashboard-key guard, same business_scope. Every repository call passes the
business_id, because the service_role key bypasses row level security.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.repositories import appointments as booking_repo
from app.repositories import businesses as business_repo
from app.repositories import customer_notes as notes_repo
from app.repositories import customers as customer_repo
from app.repositories import invoices as invoice_repo
from app.routers.dashboard import _booking
from app.services import payments as payments_service
from app.schemas import CustomerInput, CustomerPatch
from app.security import business_scope, require_dashboard_key

logger = logging.getLogger("aibh.router.customers")

router = APIRouter(
    prefix="/api/v1/dashboard/customers",
    tags=["customers"],
    dependencies=[Depends(require_dashboard_key)],
)

# The database's rule names -> what to tell the owner.
FRIENDLY = {
    "customers_phone_format": "That does not look like a phone number.",
    "customers_email_format": "That does not look like an email address.",
    "customers_identifiable": "Give the customer a name, a phone number or an email.",
    "customers_status_override_values": "Status must be automatic, lead, active or inactive.",
    "customers_channel_values": "Preferred contact must be SMS, WhatsApp or email.",
    "customers_opt_in_needs_owner": "Only the owner can opt a customer in to offers.",
}


def _problem(error: Exception) -> str:
    text = str(error)
    for rule, message in FRIENDLY.items():
        if rule in text:
            return message
    return text[:200]


def _is_uuid(value: str) -> bool:
    """A junk id would make Postgres raise a 500; treat it as 'not found'."""
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def _customer(row: dict) -> dict:
    """customer_overview row -> the frontend's Customer type, plus two counts."""
    return {
        "id": row["id"],
        "businessId": row["business_id"],
        "name": row.get("name") or row.get("phone") or row.get("email") or "Unnamed",
        "email": row.get("email") or "",
        "phone": row.get("phone") or "",
        "status": row.get("status") or "lead",
        "statusIsAutomatic": bool(row.get("status_is_automatic", True)),
        "tags": row.get("tags") or [],
        # Completed bookings at their snapshot price. Not money received -
        # payments do not exist yet, and the screen says so.
        "totalSpend": float(row.get("completed_spend") or 0),
        "lastVisit": row.get("last_visit_date"),
        "notes": row.get("notes") or "",
        "membershipPlan": row.get("membership_plan"),
        "preferredChannel": row.get("preferred_channel"),
        "marketingConsent": row.get("marketing_consent") or "unknown",
        "consentSource": row.get("consent_source"),
        "source": row.get("source") or "chat",
        "createdAt": row.get("created_at"),
        "lastSeenAt": row.get("last_seen_at"),
        "bookingsCount": int(row.get("bookings_count") or 0),
        "upcomingCount": int(row.get("upcoming_count") or 0),
    }


def _note(row: dict) -> dict:
    return {
        "id": row["id"],
        "kind": row.get("kind") or "note",
        "body": row.get("body") or "",
        "author": row.get("author") or "agent",
        "createdAt": row.get("created_at"),
        "conversationId": row.get("conversation_id"),
    }


@router.get("")
def list_customers(business_id: str = Depends(business_scope)) -> dict:
    """The directory. Status, spend and counts are calculated by the view."""
    return {"customers": [_customer(r) for r in customer_repo.list_overview(business_id)]}


@router.get("/{customer_id}")
def get_customer(customer_id: str, business_id: str = Depends(business_scope)) -> dict:
    """One profile: the customer, their bookings, and what the assistant noted."""
    if not _is_uuid(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")

    # Look the customer up WITH the business filter first. Asking for another
    # business's customer is indistinguishable from asking for one that does
    # not exist - which is exactly what we want.
    row = customer_repo.get_overview(business_id, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = business_repo.get_business(business_id)

    # Invoices exist only for businesses with the payment capability. Without
    # it, an empty list plus the flag lets the screen say "not switched on"
    # instead of "no invoices", which would not be true.
    payments_on = business_repo.is_agent_active(business_id, "payment")
    invoices = []
    if payments_on:
        cfg = payments_service.payment_settings(business_id)
        today = payments_service.business_today(business)
        invoices = [
            payments_service.shape(i, business, cfg, today)
            for i in invoice_repo.list_for_customer(business_id, customer_id)
        ]

    return {
        "customer": _customer(row),
        "bookings": [
            _booking(b, business)
            for b in booking_repo.list_for_customer(business_id, customer_id, limit=50)
        ],
        "notes": [_note(n) for n in notes_repo.list_for_customer(business_id, customer_id)],
        "invoices": invoices,
        "invoicesAvailable": payments_on,
    }


@router.post("", status_code=201)
def create_customer(payload: CustomerInput, business_id: str = Depends(business_scope)) -> dict:
    fields = payload.model_dump()
    fields["status_override"] = fields.pop("status")
    try:
        created = customer_repo.create(business_id, fields)
    except customer_repo.DuplicateCustomer as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except customer_repo.InvalidCustomer as error:
        raise HTTPException(status_code=400, detail=_problem(error)) from error

    return {"customer": _customer(customer_repo.get_overview(business_id, created["id"]))}


@router.patch("/{customer_id}")
def update_customer(
    customer_id: str, payload: CustomerPatch, business_id: str = Depends(business_scope)
) -> dict:
    if not _is_uuid(customer_id) or customer_repo.get(business_id, customer_id) is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    fields = payload.model_dump(exclude_none=True)
    consent = fields.pop("marketing_consent", None)
    if "status" in fields:
        fields["status_override"] = fields.pop("status")

    try:
        customer_repo.update(business_id, customer_id, fields)
        if consent is not None:
            # The ONLY place consent_source becomes 'dashboard' - so the only
            # place an opt-in can come from.
            customer_repo.set_marketing_consent(
                business_id=business_id,
                customer_id=customer_id,
                consent=consent,
                source="dashboard",
            )
    except customer_repo.DuplicateCustomer as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except customer_repo.InvalidCustomer as error:
        raise HTTPException(status_code=400, detail=_problem(error)) from error

    logger.info("Customer %s updated: %s", customer_id, sorted(fields) + (["consent"] if consent else []))
    return {"customer": _customer(customer_repo.get_overview(business_id, customer_id))}
