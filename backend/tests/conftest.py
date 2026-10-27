"""
Shared test setup.

IMPORTANT: importing `app.db` opens a Supabase client at import time, which
needs the real keys. Unit tests must not depend on that, so anything that
reaches the database is imported INSIDE a test or a fixture, never at the top
of a unit test module.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make "app" importable the same way the scripts do.
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


@pytest.fixture
def business() -> dict:
    """A plain business dict, the shape repositories return."""
    return {
        "id": "a1b2c3d4-0000-4000-8000-000000000001",
        "name": "Pulse Fitness Studio",
        "business_type": "gym",
        "location": "Hyderabad",
        "description": "A neighbourhood gym.",
        "timezone": "Asia/Kolkata",
        "currency": "INR",
        "chat_slug": "pulse-fitness",
        "agent_persona": "Be warm and brief.",
    }


@pytest.fixture
def invoice() -> dict:
    """An unpaid invoice row, as the invoices table returns it."""
    return {
        "id": "11111111-2222-4333-8444-555555555555",
        "business_id": "a1b2c3d4-0000-4000-8000-000000000001",
        "customer_id": "99999999-8888-4777-8666-555555555555",
        "invoice_number": "INV/2026-27/0007",
        "amount": 9000,
        "currency": "INR",
        "status": "pending",
        "due_date": "2026-10-03",
        "public_token": "0123456789abcdef0123456789abcdef",
        "items": [{"description": "Personal Training", "quantity": 1, "unit_price": 9000, "total": 9000}],
        "customers": {"id": "99999999-8888-4777-8666-555555555555", "name": "Ravi Kumar",
                      "phone": "+919876500011", "email": "ravi@example.com"},
        "created_at": "2026-09-26T10:00:00+00:00",
        "conversation_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }


@pytest.fixture
def payment_settings() -> dict:
    return {"upi_id": "pulsefitness@okaxis", "payee_name": "Pulse Fitness Studio",
            "invoice_prefix": "INV", "due_days": 7}
