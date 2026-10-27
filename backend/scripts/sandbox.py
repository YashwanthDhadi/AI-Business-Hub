"""
A throwaway business for tests that must not touch real data.

A real business's invoice numbers must never have gaps: Indian GST rules ask
for one unbroken series per financial year. So the payment tests never issue
invoices for Pulse Fitness. They create a sandbox business, work inside it,
and delete it - which removes its customers, bookings, invoices and counters
with it.

    from sandbox import create_sandbox, destroy_sandbox
"""

from __future__ import annotations

import uuid

from app.db import db, one


def create_sandbox(label: str, *, upi_id: str | None = "sandbox@okaxis") -> dict:
    """A new, inactive business with the chat and payment capabilities on."""
    tag = uuid.uuid4().hex[:8]
    business = one(
        db.table("businesses")
        .insert(
            {
                "name": f"Sandbox {label} {tag}",
                "slug": f"sandbox-{tag}",
                "chat_slug": f"sandbox-{tag}",
                # Never reachable from a public chat link.
                "is_active": False,
                "chat_enabled": False,
            }
        )
        .execute()
    )
    try:
        # Every row lists every column. In a bulk insert the API fills a key
        # missing from one row with null - which "settings not null" refuses.
        db.table("agent_subscriptions").insert(
            [
                {"business_id": business["id"], "agent_key": key, "is_active": True, "settings": {}}
                for key in ("customer_support", "booking", "customers", "inventory",
                            "documents", "communication", "reports")
            ]
            + [
                {
                    "business_id": business["id"],
                    "agent_key": "payment",
                    "is_active": True,
                    "settings": {"upi_id": upi_id, "payee_name": None, "invoice_prefix": "INV", "due_days": 7},
                },
            ]
        ).execute()
    except Exception:
        destroy_sandbox(business)  # never leave a half-made sandbox behind
        raise
    return business


def destroy_sandbox(business: dict | None) -> None:
    """Delete the business. Everything that belongs to it goes with it."""
    if business:
        db.table("businesses").delete().eq("id", business["id"]).execute()
