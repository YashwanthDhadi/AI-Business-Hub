# Guide 4, Part 2 — The owner's screen and the customer's pay page (STEP 47 → STEP 50)

The owner issues invoices, marks them paid, cancels and refunds, all from
`/dashboard/payments`. The customer gets a link in their chat to a public pay
page with a real UPI QR code.

---

## STEP 47 — The payments API and the public pay API

### Goal

Two routers:

| Router | Who calls it | Guard |
| --- | --- | --- |
| `/api/v1/dashboard/payments/...` | The owner's screen, through the Next.js proxy | The dashboard key, plus `business_id` |
| `/api/v1/pay/{token}` | Anyone with a pay link | The 32-character token itself |

### Why?

Every movement of money needs **one** place it can happen, and that place must
be one the chat agent cannot reach. The dashboard router is it: issuing, marking
paid, cancelling and refunding exist nowhere else.

The pay router is the opposite kind of API: public, with no key and no login. It
can do exactly two things with one invoice: show it, and record *"I've paid"*.

### Architecture

| Route | Does | Refuses with |
| --- | --- | --- |
| `GET /dashboard/payments/invoices` | Every invoice, the settings, the business's "today" | — |
| `POST /dashboard/payments/invoices` | Issue: from a booking (its snapshot price) or from items | 404 customer or booking not found; 400 no items; 409 booking already billed |
| `POST .../{id}/paid` | **The only path to `paid`**, and posts a receipt in their chat | 409 not pending; 400 unknown method |
| `POST .../{id}/cancel` | Cancel an unpaid invoice, and tell them | 409 not pending |
| `POST .../{id}/refund` | Record a refund already made | 409 not paid |
| `POST .../{id}/remind` | Post a reminder in their chat | 409 not pending; 422 no chat; 429 already today |
| `GET/PATCH .../settings` | UPI ID, payee name, prefix, due days | 400 bad UPI ID or prefix |
| `GET /pay/{token}` | The public view: no phone, email or ids | 404 invalid link |
| `POST /pay/{token}/claim` | "I've paid"; posts in their chat the first time only | 409 not pending |

**Where does the invoice get posted?** Into the chat the booking came from, or
else the customer's most recent chat. A walk-in who never chatted has none, and
the screen says so and suggests a phone call. Nothing is sent by SMS or WhatsApp,
which would cost money.

### Files involved

```
backend/
├── app/
│   ├── main.py                 ← edit (one import line, two include_router lines)
│   ├── schemas.py              ← edit (seven classes)
│   └── routers/
│       ├── payments.py         ← new
│       ├── pay.py              ← new
│       └── customers.py        ← edit (the Invoices tab is real now)
└── scripts/
    └── check_payments_api.py   ← new
```

### Code

**`backend/app/schemas.py`** — add `from datetime import date` to the imports at
the top, and these classes at the end:

```python
class InvoiceItemInput(BaseModel):
    """One line on an invoice. The database multiplies and adds - never send a total."""

    description: str = Field(min_length=1, max_length=200)
    quantity: int = Field(default=1, ge=1, le=1000)
    unit_price: float = Field(ge=0, le=10_000_000)


class InvoiceCreate(BaseModel):
    customer_id: str
    # Bill a booking: leave items empty and its own snapshot price is used.
    appointment_id: str | None = None
    items: list[InvoiceItemInput] = Field(default_factory=list, max_length=50)
    # Empty means "today + the business's due_days setting".
    due_date: date | None = None
    notes: str = Field(default="", max_length=1000)
    send_to_chat: bool = True


class InvoicePaid(BaseModel):
    method: str = Field(description="upi | cash | card | bank_transfer")
    reference: str = Field(default="", max_length=60, description="UPI reference, cheque number...")
    send_receipt: bool = True


class InvoiceCancel(BaseModel):
    reason: str = Field(default="", max_length=300)
    notify: bool = True


class InvoiceRefund(BaseModel):
    note: str = Field(default="", max_length=300)


class PaymentSettingsPatch(BaseModel):
    upi_id: str | None = Field(default=None, max_length=320)
    payee_name: str | None = Field(default=None, max_length=120)
    invoice_prefix: str | None = Field(default=None, max_length=10)
    due_days: int | None = Field(default=None, ge=0, le=90)


class PaymentClaim(BaseModel):
    """The customer, on the public pay page: 'I have paid'."""

    reference: str = Field(default="", max_length=60)
```

**`backend/app/main.py`** — change the router import to:

```python
from app.routers import chat, customers, dashboard, health, pay, payments
```

and after `app.include_router(customers.router)` add:

```python
app.include_router(payments.router)
app.include_router(pay.router)
```

**`backend/app/routers/payments.py`** — complete file:

```python
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
```

**`backend/app/routers/pay.py`** — complete file:

```python
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
```

**`backend/app/routers/customers.py`** — the profile's Invoices tab is now real.
Add two imports:

```python
from app.repositories import invoices as invoice_repo
from app.services import payments as payments_service
```

and in `get_customer`, replace everything from `business = business_repo.get_business(business_id)`
to the end of the function with:

```python
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
```

### Explain the code

```python
        if not items:
            # The booking's OWN snapshot - the price the customer was quoted -
            # never today's price from business_services.
```
Billing a booking sends **no** items from the browser. The server writes the one
line itself, from the price saved on the booking when it was made (Guide 2,
STEP 26). If the gym raised prices last week, a booking made at the old price
is still billed at the old price.

```python
    except invoice_repo.NotPending as error:
        raise HTTPException(status_code=409, detail=NOT_PENDING) from error
```
409 Conflict means *"the thing changed under you"*. The owner has two tabs open,
and the other one already marked it paid. The screen shows the message and
reloads.

```python
    if not invoice_repo.claim_reminder_slot(business_id=business_id, invoice_id=invoice_id):
        raise HTTPException(status_code=429, detail="A reminder was already sent in the last 24 hours.")
```
One reminder per invoice per day. A customer who gets three reminders in an hour
because the owner clicked impatiently stops reading the chat. 429 is the
standard "too many requests".

```python
    first_claim = not invoice.get("customer_reported_at")
    ...
    if first_claim:
        payments_service.post_to_chat(...)
```
The pay link can be forwarded. Anyone holding it could press **I've paid**
repeatedly. Only the first press posts into the customer's chat, so a shared
link cannot flood their thread.

```python
        raise HTTPException(status_code=404, detail=INVALID)
```
The same answer for a junk token, a real token for a deleted business, or a
typo. Someone probing tokens learns nothing.

```python
    payments_on = business_repo.is_agent_active(business_id, "payment")
```
Guide 3's profile always said invoices were "not built". Now it asks the
subscription. A business without payments sees *"switched off"*, and one with
payments sees its real invoices.

### Commands

Make the edits, create the two routers and the script, restart uvicorn (see the
note about `--reload` in RUN-AND-TEST.md), then:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
python scripts\check_payments_api.py
```

### How to test

**`backend/scripts/check_payments_api.py`** — complete file:

```python
"""
STEP 47: the payments dashboard API and the public pay API, over HTTP, no LLM.

Drives every route the way the browser does, inside a sandbox business (so no
real invoice number is used), and checks every refusal. Run from backend/ with
the server already running:

    python scripts\\check_payments_api.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

import httpx

from app.config import settings
from app.db import db, one
from app.repositories import appointments as booking_repo
from app.repositories import conversations
from app.repositories import customers as customer_repo
from sandbox import create_sandbox, destroy_sandbox

BASE = "http://127.0.0.1:8000/api/v1"
API = f"{BASE}/dashboard/payments"
PHONE = "9000000701"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<48} {detail}")


def detail_of(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", ""))[:70]
    except ValueError:
        return response.text[:70]


def last_chat_message(bid: str, conversation_id: str) -> str:
    found = conversations.messages_for(bid, conversation_id)
    return found[-1]["body"] if found else ""


sandbox = create_sandbox("payments-api")
other = create_sandbox("payments-api-other")
bid = sandbox["id"]
client = httpx.Client(timeout=30, headers={"X-Dashboard-Key": settings.dashboard_api_key}, params={"business_id": bid})

try:
    customer = customer_repo.upsert_from_chat(business_id=bid, name="Api Payer", phone=PHONE)
    stranger = customer_repo.upsert_from_chat(business_id=other["id"], name="Elsewhere", phone=PHONE)
    chat = conversations.create(bid, channel="web")
    conversations.attach_customer(bid, chat["id"], customer["id"])
    slot = (datetime.now(timezone.utc) + timedelta(days=2)).replace(minute=0, second=0, microsecond=0)
    booking = booking_repo.create(
        business_id=bid, customer_id=customer["id"], starts_at_utc=slot, duration_minutes=60,
        service_name="Personal Training", price=9000.0, status="confirmed", conversation_id=chat["id"],
    )

    # ---- 1. empty list, settings --------------------------------------------------
    print("\nlist and settings")
    listed = client.get(f"{API}/invoices")
    check("GET /invoices -> 200, empty", listed.status_code == 200 and listed.json()["invoices"] == [])
    check("  settings say UPI is ready", listed.json()["settings"]["upiReady"] is True, listed.json()["settings"]["upiId"])
    catalog = client.get(f"{API}/catalog")
    check("GET /catalog -> 200", catalog.status_code == 200, f"{len(catalog.json()['services'])} services")

    # ---- 2. issue from a booking ------------------------------------------------------
    print("\nissue")
    made = client.post(f"{API}/invoices", json={"customer_id": customer["id"], "appointment_id": booking["id"]})
    invoice = made.json().get("invoice", {}) if made.status_code == 201 else {}
    check("bill a booking -> 201", made.status_code == 201, invoice.get("invoiceNumber"))
    check("  amount is the booking's snapshot price", invoice.get("amount") == 9000.0, invoice.get("amount"))
    check("  item names the service and date", "Personal Training on " in (invoice.get("items") or [{}])[0].get("description", ""),
          (invoice.get("items") or [{}])[0].get("description"))
    check("  sent into the customer's chat", made.json().get("customer_notified") is True)
    message = last_chat_message(bid, chat["id"])
    check("  ...with rupees and the pay link", "₹9,000" in message and invoice.get("payUrl", "?") in message,
          message.splitlines()[0][:70] if message else "")

    again = client.post(f"{API}/invoices", json={"customer_id": customer["id"], "appointment_id": booking["id"]})
    check("same booking again -> 409", again.status_code == 409, detail_of(again))
    foreign = client.post(f"{API}/invoices", json={"customer_id": stranger["id"], "items": [
        {"description": "x", "quantity": 1, "unit_price": 10}]})
    check("another business's customer -> 404", foreign.status_code == 404, detail_of(foreign))
    empty = client.post(f"{API}/invoices", json={"customer_id": customer["id"]})
    check("no items and no booking -> 400", empty.status_code == 400, detail_of(empty))
    negative = client.post(f"{API}/invoices", json={"customer_id": customer["id"], "items": [
        {"description": "x", "quantity": 1, "unit_price": -5}]})
    check("negative price -> 422", negative.status_code == 422)
    manual = client.post(f"{API}/invoices", json={"customer_id": customer["id"], "send_to_chat": False, "items": [
        {"description": "Protein shake", "quantity": 2, "unit_price": 150},
        {"description": "Locker (monthly)", "quantity": 1, "unit_price": 300}]})
    extra = manual.json().get("invoice", {}) if manual.status_code == 201 else {}
    check("manual items -> 201, database adds up", extra.get("amount") == 600.0, extra.get("amount"))
    check("  send_to_chat false -> not posted", manual.json().get("customer_notified") is False)

    # ---- 3. read ------------------------------------------------------------------------
    print("\nread")
    one_invoice = client.get(f"{API}/invoices/{invoice.get('id')}")
    check("GET /invoices/{id} -> 200", one_invoice.status_code == 200)
    check("junk id -> 404", client.get(f"{API}/invoices/not-a-uuid").status_code == 404)
    check("another business reads it -> 404",
          client.get(f"{API}/invoices/{invoice.get('id')}", params={"business_id": other["id"]}).status_code == 404)

    # ---- 4. reminders ---------------------------------------------------------------------
    print("\nreminders")
    reminded = client.post(f"{API}/invoices/{invoice.get('id')}/remind")
    check("remind -> posted in their chat", reminded.status_code == 200, last_chat_message(bid, chat["id"])[:60])
    twice = client.post(f"{API}/invoices/{invoice.get('id')}/remind")
    check("remind again today -> 429", twice.status_code == 429, detail_of(twice))

    # ---- 5. the public pay page -------------------------------------------------------------
    print("\npublic pay page")
    token = invoice.get("payUrl", "").rsplit("/", 1)[-1]
    public = httpx.get(f"{BASE}/pay/{token}", timeout=30)
    view = public.json().get("invoice", {}) if public.status_code == 200 else {}
    check("GET /pay/{token} -> 200, no key needed", public.status_code == 200)
    check("  a real upi:// link", str(view.get("upiLink", "")).startswith("upi://pay?pa=sandbox%40okaxis"))
    leaks = sorted({"customerPhone", "customerEmail", "customerId", "businessId", "id"} & set(view))
    check("  no phone, email or ids exposed", not leaks, leaks or "clean")
    check("junk token -> 404", httpx.get(f"{BASE}/pay/0123", timeout=30).status_code == 404)

    claimed = httpx.post(f"{BASE}/pay/{token}/claim", json={"reference": "412345678901"}, timeout=30)
    check("'I have paid' -> recorded", claimed.status_code == 200 and claimed.json()["invoice"]["customerReported"])
    owner_view = client.get(f"{API}/invoices/{invoice.get('id')}").json()["invoice"]
    check("  ...owner sees the claim, still pending",
          owner_view["status"] == "pending" and owner_view["customerReference"] == "412345678901",
          owner_view["status"])
    before = len(conversations.messages_for(bid, chat["id"]))
    httpx.post(f"{BASE}/pay/{token}/claim", json={"reference": "again"}, timeout=30)
    check("  a second claim does not post again", len(conversations.messages_for(bid, chat["id"])) == before)

    # ---- 6. paid, refunded, cancelled -----------------------------------------------------------
    print("\nthe owner gate")
    paid = client.post(f"{API}/invoices/{invoice.get('id')}/paid", json={"method": "upi", "reference": "412345678901"})
    check("mark paid -> 200", paid.status_code == 200 and paid.json()["invoice"]["status"] == "paid")
    check("  receipt in their chat", last_chat_message(bid, chat["id"]).startswith("Payment received: ₹9,000"),
          last_chat_message(bid, chat["id"])[:60])
    check("  the booking shows paid", booking_repo.get(bid, booking["id"])["payment_status"] == "paid")
    check("mark paid twice -> 409",
          client.post(f"{API}/invoices/{invoice.get('id')}/paid", json={"method": "cash"}).status_code == 409)
    bad_method = client.post(f"{API}/invoices/{extra.get('id')}/paid", json={"method": "bitcoin"})
    check("method 'bitcoin' -> 400", bad_method.status_code == 400, detail_of(bad_method))
    check("pay page after paying: no UPI link",
          httpx.get(f"{BASE}/pay/{token}", timeout=30).json()["invoice"]["upiLink"] is None)
    refunded = client.post(f"{API}/invoices/{invoice.get('id')}/refund", json={"note": "Session cancelled"})
    check("refund a paid invoice -> 200", refunded.status_code == 200 and refunded.json()["invoice"]["status"] == "refunded")
    cancelled = client.post(f"{API}/invoices/{extra.get('id')}/cancel", json={"reason": "Wrong items"})
    check("cancel an unpaid invoice -> 200", cancelled.status_code == 200 and cancelled.json()["invoice"]["status"] == "cancelled")
    check("cancel it again -> 409",
          client.post(f"{API}/invoices/{extra.get('id')}/cancel", json={}).status_code == 409)

    # ---- 7. settings and guards --------------------------------------------------------------------
    print("\nsettings and guards")
    bad_upi = client.patch(f"{API}/settings", json={"upi_id": "not a upi id"})
    check("bad UPI ID -> 400", bad_upi.status_code == 400, detail_of(bad_upi))
    long_prefix = client.patch(f"{API}/settings", json={"invoice_prefix": "PULSE"})
    check("prefix too long -> 400", long_prefix.status_code == 400, detail_of(long_prefix))
    good = client.patch(f"{API}/settings", json={"upi_id": "pulse.fitness@oksbi", "invoice_prefix": "pf", "due_days": 5})
    saved = good.json().get("settings", {})
    check("good settings -> saved", saved.get("upiId") == "pulse.fitness@oksbi" and saved.get("invoicePrefix") == "PF",
          f"{saved.get('upiId')} {saved.get('invoicePrefix')} {saved.get('dueDays')}d")
    check("no dashboard key -> 401", httpx.get(f"{API}/invoices", params={"business_id": bid}, timeout=30).status_code == 401)

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(other)
    gone = one(db.table("businesses").select("id").eq("id", bid).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
```

### Expected result

```
list and settings
  PASS  GET /invoices -> 200, empty
  PASS    settings say UPI is ready                      sandbox@okaxis
  PASS  GET /catalog -> 200                              0 services

issue
  PASS  bill a booking -> 201                            INV/2026-27/0001
  PASS    amount is the booking's snapshot price         9000.0
  PASS    item names the service and date                Personal Training on Mon, 28 Sep 2026
  PASS    sent into the customer's chat
  PASS    ...with rupees and the pay link                Invoice INV/2026-27/0001 for ₹9,000 (Personal Training on Mon, 28 Sep
  PASS  same booking again -> 409                        This booking already has an invoice that is unpaid or paid.
  PASS  another business's customer -> 404               Customer not found
  PASS  no items and no booking -> 400                   Add at least one item, or bill a booking.
  PASS  negative price -> 422
  PASS  manual items -> 201, database adds up            600.0
  PASS    send_to_chat false -> not posted

read
  PASS  GET /invoices/{id} -> 200
  PASS  junk id -> 404
  PASS  another business reads it -> 404

reminders
  PASS  remind -> posted in their chat                   A reminder that invoice INV/2026-27/0001 for ₹9,000 is due b
  PASS  remind again today -> 429                        A reminder was already sent in the last 24 hours.

public pay page
  PASS  GET /pay/{token} -> 200, no key needed
  PASS    a real upi:// link
  PASS    no phone, email or ids exposed                 clean
  PASS  junk token -> 404
  PASS  'I have paid' -> recorded
  PASS    ...owner sees the claim, still pending         pending
  PASS    a second claim does not post again

the owner gate
  PASS  mark paid -> 200
  PASS    receipt in their chat                          Payment received: ₹9,000 for invoice INV/2026-27/0001, by UP
  PASS    the booking shows paid
  PASS  mark paid twice -> 409
  PASS  method 'bitcoin' -> 400                          Payment method must be UPI, cash, card or bank transfer.
  PASS  pay page after paying: no UPI link
  PASS  refund a paid invoice -> 200
  PASS  cancel an unpaid invoice -> 200
  PASS  cancel it again -> 409

settings and guards
  PASS  bad UPI ID -> 400                                That does not look like a UPI ID. It looks like yourname@okaxis.
  PASS  prefix too long -> 400                           The invoice prefix must be 1 to 3 letters or digits, so numbers stay w
  PASS  good settings -> saved                           pulse.fitness@oksbi PF 5d
  PASS  no dashboard key -> 401

sandbox removed: True

ALL PASS
```

That is the real output from 26 Sep 2026. All 39 checks passed on the first run.
The invoice number, the booking date and the sandbox's name will differ for you.
`0 services` is expected: a sandbox business has no services.

**One older test had to change.** `check_customers_api.py` (Guide 3, STEP 39)
asserted that the customer profile's Invoices tab says *"not available"*. That
was true before this guide. Now it follows the `payment` subscription:

```python
payments_on = businesses.is_agent_active(bid, "payment")
check("  invoices tab follows the payment subscription",
      body.get("invoices") == [] and body.get("invoicesAvailable") is payments_on,
      "available, none yet" if payments_on else "switched off")
```

**Restart uvicorn after pulling these changes.** A server started before them
has no `/dashboard/payments` routes, and every call returns 404. During this run
an older server on port 8000 was still answering. `openapi.json` showed the right
title but no payment routes, which gave it away.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Every route 404 | Routers not mounted, or another app on port 8000 | The `main.py` edits; `curl.exe -s http://127.0.0.1:8000/openapi.json` must say `AI Business Hub`. |
| `bill a booking -> 201` FAILs with 500 `create_invoice` | Migration 004 not applied | Run it. |
| `same booking again` gives 500 not 409 | The rule name did not reach `_explain` | Print `str(exc)`; it must contain `invoices_one_live_per_booking`. |
| `another business reads it` gives 200 | A repository call without `business_id` | Every call in `payments.py` passes it; only `get_by_token` does not. |
| `a real upi:// link` FAILs | The sandbox has no UPI ID, or the invoice is not pending | `create_sandbox(...)` sets `sandbox@okaxis`. |
| `sandbox removed: False` | The script crashed before cleanup | `delete from businesses where slug like 'sandbox-%';` |

---

## STEP 48 — Frontend types, API clients, a real QR code and tappable links

### Goal

Teach the frontend the invoice shape and the new routes. Replace the fake QR
drawing with a real one, and make the pay link in chat tappable.

### Why?

- **QR:** the prototype's `QrCodeGraphic` drew a random pattern. It looked like a
  QR code and no phone could scan it. A UPI payment QR must be real, and so should
  the "Scan to Chat" code on the settings screen, which shared the component.
- **Links:** the chat printed every message as plain text. The invoice message
  ends with a link, and on a phone it has to be something you can tap.

### Files involved

```
frontend/
├── package.json                                   ← edit (npm adds qrcode)
└── src/
    ├── types/payment.ts                           ← edit (the complete new version is below)
    ├── features/payments/constants.ts             ← edit (the complete new version is below)
    ├── lib/
    │   ├── status.ts                              ← edit (one line)
    │   ├── utils.ts                               ← edit (one function)
    │   └── api/
    │       ├── dashboard.ts                       ← edit (types + eight functions)
    │       └── pay.ts                             ← new
    ├── components/ui/QrCodeGraphic.tsx            ← edit (the complete new version is below)
    ├── features/customer-chat/components/
    │   └── ChatMessageBubble.tsx                  ← edit (links become tappable)
    └── data/mock-payments.ts                      ← edit ("stripe" -> "upi")
```

### Code

**Install the QR library** (free, MIT licence, runs in the browser, no network):

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npm install qrcode@1.5.4
npm install -D @types/qrcode
```

**`frontend/src/types/payment.ts`** — complete file:

```ts
/** "overdue" is never stored: it is an unpaid invoice past its due date (in IST). */
export type PaymentStatus = "paid" | "pending" | "overdue" | "refunded" | "cancelled";

/** How the owner recorded the money arriving. UPI first: it is how India pays. */
export type PaymentMethod = "upi" | "cash" | "card" | "bank_transfer";

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PaymentInvoice {
  id: string;
  businessId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  dueDate: string;
  paidDate?: string | null;
  items: InvoiceItem[];
  paymentMethod?: PaymentMethod | null;
  createdAt: string;

  // ---- live data only (the mock invoices leave these out) ----
  customerPhone?: string;
  bookingId?: string | null;
  bookingReference?: string | null;
  /** The public pay page. Anyone with this link can see and pay this one invoice. */
  payUrl?: string;
  /** False until the owner sets a UPI ID - then the pay page offers "pay at the desk". */
  upiReady?: boolean;
  /** Whether there is a chat thread to post the invoice, reminders and receipt into. */
  hasChat?: boolean;
  /** The CUSTOMER says they paid. A claim to check, not proof. */
  customerReportedAt?: string | null;
  customerReference?: string | null;
  paidReference?: string;
  cancelReason?: string;
  refundNote?: string;
  lastRemindedAt?: string | null;
  notes?: string;
}

/** The owner's payment settings, from /dashboard/payments/settings. */
export interface PaymentSettings {
  upiId: string;
  payeeName: string;
  invoicePrefix: string;
  dueDays: number;
  upiReady: boolean;
}

/** What the PUBLIC pay page is allowed to know. No phone, email or ids. */
export interface PublicInvoice {
  businessName: string;
  invoiceNumber: string;
  customerFirstName: string;
  items: Omit<InvoiceItem, "id">[];
  amount: number;
  currency: string;
  status: PaymentStatus;
  dueDate: string;
  paidDate: string | null;
  upiLink: string | null;
  upiId: string | null;
  payeeName: string | null;
  customerReported: boolean;
}
```

**`frontend/src/features/payments/constants.ts`** — complete file:

```ts
import type { PaymentMethod } from "@/types";

export type { PaymentMethod };

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  upi: "UPI",
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank Transfer",
};
```

**`frontend/src/lib/status.ts`** — in `invoiceStatusMeta`, add after the `refunded` line:

```ts
  cancelled: { label: "Cancelled", variant: "neutral", dot: "bg-gray-600" },
```

**`frontend/src/lib/utils.ts`** — add above `formatPhone`:

```ts
/**
 * Today's date in India as "YYYY-MM-DD", optionally moved by some days.
 *
 * For date inputs and due dates. The viewer's own clock would be wrong for an
 * owner travelling abroad, and toISOString() is UTC - yesterday, in India,
 * until 5:30 every morning. en-CA is used only because it writes YYYY-MM-DD.
 */
export function isoDateInIndia(offsetDays = 0): string {
  const moment = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(moment);
}
```

**`frontend/src/lib/api/dashboard.ts`** — three edits. Add `PaymentMethod` and
`PaymentSettings` to the `@/types` import. Add these types above `class HubError`:

```ts
/** What New Invoice sends. Bill a booking by leaving items empty. */
export interface NewInvoice {
  customer_id: string;
  appointment_id?: string | null;
  items?: { description: string; quantity: number; unit_price: number }[];
  /** YYYY-MM-DD. Empty means today + the business's due days. */
  due_date?: string | null;
  notes?: string;
  send_to_chat?: boolean;
}

export interface CatalogService {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
}

/** Most payment actions return the invoice and whether the customer's chat got a message. */
export interface InvoiceResult {
  invoice: PaymentInvoice;
  customer_notified?: boolean;
}
```

And add these entries inside `dashboardApi`, just above `knowledge:`:

```ts
  /** Every invoice, plus the payment settings the screen needs to explain itself. */
  invoices: () =>
    call<{
      invoices: PaymentInvoice[];
      settings: PaymentSettings;
      /** `today` is the business's own date (IST), so "this month" matches theirs. */
      business: { name: string; today: string };
    }>("/payments/invoices"),

  /** Issue an invoice. The number comes from the database; you cannot choose it. */
  createInvoice: (input: NewInvoice) =>
    call<InvoiceResult>("/payments/invoices", { method: "POST", body: input }),

  /**
   * The ONLY way anything becomes "paid". The chat assistant has no tool for it;
   * a customer saying "I've paid" is only recorded as a claim.
   */
  markInvoicePaid: (invoiceId: string, method: PaymentMethod, reference = "") =>
    call<InvoiceResult>(`/payments/invoices/${invoiceId}/paid`, {
      method: "POST",
      body: { method, reference, send_receipt: true },
    }),

  cancelInvoice: (invoiceId: string, reason = "") =>
    call<InvoiceResult>(`/payments/invoices/${invoiceId}/cancel`, {
      method: "POST",
      body: { reason, notify: true },
    }),

  /** Record a refund you have ALREADY paid back, outside this system. */
  refundInvoice: (invoiceId: string, note = "") =>
    call<InvoiceResult>(`/payments/invoices/${invoiceId}/refund`, { method: "POST", body: { note } }),

  /** Posts into the customer's own chat. 422 if they have none, 429 if reminded today. */
  remindInvoice: (invoiceId: string) =>
    call<InvoiceResult>(`/payments/invoices/${invoiceId}/remind`, { method: "POST", body: {} }),

  paymentCatalog: () =>
    call<{ services: CatalogService[] }>("/payments/catalog").then((r) => r.services),

  updatePaymentSettings: (patch: {
    upi_id?: string;
    payee_name?: string;
    invoice_prefix?: string;
    due_days?: number;
  }) =>
    call<{ settings: PaymentSettings }>("/payments/settings", { method: "PATCH", body: patch }).then(
      (r) => r.settings,
    ),
```

**`frontend/src/lib/api/pay.ts`** — complete file:

```ts
/**
 * Client for the PUBLIC pay page API.
 *
 * Like the public chat, it calls FastAPI directly: there is no secret to hide.
 * The 32-character token in the page's URL is the only permission, and it
 * unlocks one invoice.
 */

import type { PublicInvoice } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://127.0.0.1:8000";

export class PayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PayApiError";
  }
}

async function call(path: string, init?: RequestInit): Promise<PublicInvoice> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/pay${path}`, {
      ...init,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new PayApiError("Could not reach the server. Check your connection and try again.", 0);
  }

  const body = (await response.json().catch(() => null)) as
    | { invoice?: PublicInvoice; detail?: string }
    | null;

  if (!response.ok || !body?.invoice) {
    throw new PayApiError(body?.detail ?? "Something went wrong. Please try again.", response.status);
  }
  return body.invoice;
}

export const payApi = {
  get: (token: string) => call(`/${encodeURIComponent(token)}`),

  /** "I have paid." Recorded for the business to check - it does not mark the invoice paid. */
  claim: (token: string, reference: string) =>
    call(`/${encodeURIComponent(token)}/claim`, { method: "POST", body: JSON.stringify({ reference }) }),
};
```

**`frontend/src/components/ui/QrCodeGraphic.tsx`** — complete file:

```tsx
import React, { useMemo } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/**
 * A REAL, scannable QR code for any text: a chat link, or a upi://pay link.
 *
 * The prototype drew a random pattern that looked like a QR code and could not
 * be scanned. This encodes the value with the `qrcode` library (MIT, runs in
 * the browser, no network) and draws the result as SVG squares, so it stays
 * sharp at any size and needs no image file.
 */
export function QrCodeGraphic({
  value,
  className,
  svgClassName = "w-24 h-24",
  label = "Scan to Chat",
}: {
  value: string;
  className?: string;
  svgClassName?: string;
  label?: string;
}) {
  const modules = useMemo(() => {
    try {
      // "M" error correction survives a smudged screen or a slightly bad angle.
      return QRCode.create(value, { errorCorrectionLevel: "M" }).modules;
    } catch {
      return null;
    }
  }, [value]);

  if (!modules) {
    return (
      <div className={cn("inline-flex items-center justify-center bg-white p-3 rounded-xl text-[10px] text-gray-700", className)}>
        Could not draw a QR code
      </div>
    );
  }

  const size = modules.size;
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules.get(y, x)) {
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
      }
    }
  }

  return (
    <div className={cn("inline-flex flex-col items-center bg-white p-3 rounded-xl shadow-md", className)}>
      {/* A quiet zone of 2 modules around the code: scanners need the margin. */}
      <svg
        viewBox={`-2 -2 ${size + 4} ${size + 4}`}
        className={svgClassName}
        fill="black"
        role="img"
        aria-label={`QR code for ${value}`}
        shapeRendering="crispEdges"
      >
        {cells}
      </svg>
      {label && <span className="text-[9px] font-bold text-gray-800 tracking-wider uppercase mt-1">{label}</span>}
    </div>
  );
}
```

**`frontend/src/features/customer-chat/components/ChatMessageBubble.tsx`** — add
this above `interface ChatMessageBubbleProps`:

```tsx
// http(s) only - a message can never become a javascript: link. Trailing
// punctuation stays outside, so "…/pay/abc." links to "…/pay/abc".
const LINK = /(https?:\/\/[^\s]*[^\s.,;:!?)])/g;

/** Message text with its web links made tappable - the pay-page link has to be. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(LINK).map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">
            {part}
          </a>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
```

then replace both `{message.text}` in the file with `<Linkified text={message.text} />`.

**`frontend/src/data/mock-payments.ts`** — replace the three
`paymentMethod: "stripe"` with `paymentMethod: "upi"`. There is no Stripe here.

### Explain the code

```ts
export type PaymentStatus = "paid" | "pending" | "overdue" | "refunded" | "cancelled";
```
`cancelled` is new. `overdue` stays in the type because the screen shows it, but
the database never stores it; the backend works it out from the due date.

```tsx
      return QRCode.create(value, { errorCorrectionLevel: "M" }).modules;
```
`QRCode.create` returns the grid itself: which squares are black. We draw them as
SVG `<rect>`s, the same way the old fake did, so every place that used the
component looks the same, and now a phone can read it. `"M"` error correction
survives a smudge or a slightly bad angle.

```tsx
      <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`}
```
A two-square white margin around the code. Scanners need that quiet zone to find
the edges.

```tsx
const LINK = /(https?:\/\/[^\s]*[^\s.,;:!?)])/g;
```
Only `http://` and `https://` become links. A message containing
`javascript:alert(1)` stays plain text, so a customer typing something nasty can
never make the owner's inbox run code. The last character class keeps a
full stop at the end of a sentence out of the link.

```ts
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, ... }).format(moment);
```
A date input needs `YYYY-MM-DD`. `en-CA` is the locale that writes dates that
way, and the timezone makes it **India's** today. It is only used for input
values; everything a person reads still goes through `en-IN`.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
```

### How to test

`tsc` will report the old payments page, which still counts only five statuses.
That is expected until STEP 49.

### Expected result

After STEP 49, `tsc` prints nothing.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `Cannot find module 'qrcode'` | Not installed | `npm install qrcode@1.5.4` and `npm install -D @types/qrcode` in `frontend/`. |
| `Property 'cancelled' is missing in type` | A `Record<PaymentStatus, ...>` somewhere lists only five | Add `cancelled`. |
| `Type '"stripe"' is not assignable` | Mock data still says stripe | Change it to `"upi"`. |

---

## STEP 49 — Wire the payments screen

### Goal

`/dashboard/payments` shows real invoices. The owner can issue one (for a booking
or a service), mark it paid, cancel it, record a refund, copy its link, send a
reminder into the customer's chat, and set their UPI ID. Bookings get a **Create
Invoice** button.

### Why?

This is the owner gate made visible. Every control that moves money is on this
screen, and only here.

### Architecture

```
  PaymentsPage
     │  on mount + every 30 s ──► dashboardApi.invoices()   (invoices, settings, today)
     │
     ├── amber strip   "No UPI ID yet"                  (until settings.upiReady)
     ├── amber strip   "2 customers say they have paid"  (claims to check)
     ├── StatCards     collected / pending / overdue / collection rate
     ├── Money In      paid invoices by month, in IST
     ├── Needs Follow-up + Remind
     ├── InvoiceTable
     ├── PaymentSettingsCard   UPI ID, payee name, prefix, due days
     │
     ├── InvoiceDetailModal   Mark as Paid (method + reference) · Cancel · Refund
     │                         Copy link · Open pay page · Remind · "PDF not built yet"
     └── NewInvoiceModal      customer → a booking (snapshot price) or a service
```

**What is honestly not built**, and says so:

| Control | On screen |
| --- | --- |
| Download PDF | Disabled: *"PDF not built yet"* |
| GST | Not calculated; the settings card says so |
| Reminders by SMS or WhatsApp | Not offered. Reminders go into the customer's chat, and a walk-in with no chat gets *"call them instead"* |

### Files involved

```
frontend/src/
├── app/dashboard/
│   ├── payments/page.tsx                          ← edit (the complete new version is below)
│   └── bookings/page.tsx                          ← edit (Create Invoice)
└── features/
    ├── payments/components/
    │   ├── InvoiceTable.tsx                       ← edit (the complete new version is below)
    │   ├── InvoiceDetailModal.tsx                 ← edit (the complete new version is below)
    │   ├── NewInvoiceModal.tsx                    ← edit (the complete new version is below)
    │   └── PaymentSettingsCard.tsx                ← new
    ├── bookings/components/
    │   └── BookingDetailModal.tsx                 ← edit (Mark as Paid → Create Invoice)
    └── customers/components/
        └── CustomerDetailModal.tsx                ← edit (one sentence)
```

### Code

**`frontend/src/app/dashboard/payments/page.tsx`** — complete file:

```tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Wallet, Clock, AlertTriangle, CheckCircle2, Send, BadgeInfo } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  PageHeader,
  StatCard,
  SearchInput,
  Select,
  SegmentedTabs,
  Toast,
} from "@/components/ui";
import { BarChart, CHART_COLORS } from "@/components/charts";
import { InvoiceTable } from "@/features/payments/components/InvoiceTable";
import { InvoiceDetailModal } from "@/features/payments/components/InvoiceDetailModal";
import { NewInvoiceModal } from "@/features/payments/components/NewInvoiceModal";
import { PaymentSettingsCard } from "@/features/payments/components/PaymentSettingsCard";
import { paymentMethodLabels, PaymentMethod } from "@/features/payments/constants";
import type { CustomerSummary, PaymentInvoice, PaymentSettings, PaymentStatus } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID, type CatalogService, type InvoiceResult, type NewInvoice } from "@/lib/api/dashboard";

type StatusFilter = PaymentStatus | "all";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Axis labels the Indian way: ₹90k, ₹1.2L (lakh), ₹1.5Cr (crore). */
const compactRupees = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `₹${Math.round(v / 1e3)}k` : `₹${v}`;

function message(error: unknown, fallback: string): string {
  return error instanceof HubError ? error.message : fallback;
}

export default function PaymentsPage() {
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [invoices, setInvoices] = useState<PaymentInvoice[]>([]);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [business, setBusiness] = useState({ name: "", today: "" });
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured ? null : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const { toast, showToast, dismissToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await dashboardApi.invoices();
      setInvoices(data.invoices);
      setSettings(data.settings);
      setBusiness(data.business);
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error, "Could not load invoices."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before it sets state, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [configured, refresh]);

  const replace = useCallback((updated: PaymentInvoice) => {
    setInvoices((prev) => {
      const exists = prev.some((i) => i.id === updated.id);
      return exists ? prev.map((i) => (i.id === updated.id ? updated : i)) : [updated, ...prev];
    });
  }, []);

  /** Run a payment action, update the list, toast, and re-throw so the modal keeps its state. */
  const run = useCallback(
    async (action: () => Promise<InvoiceResult>, done: (r: InvoiceResult) => string) => {
      try {
        const result = await action();
        replace(result.invoice);
        showToast(done(result));
      } catch (error) {
        showToast(message(error, "That did not work."), "error");
        void refresh();
        throw error;
      }
    },
    [refresh, replace, showToast],
  );

  const told = (r: InvoiceResult, yes: string, no: string) => (r.customer_notified ? yes : no);

  const handleMarkPaid = (id: string, method: PaymentMethod, reference: string) =>
    run(
      () => dashboardApi.markInvoicePaid(id, method, reference),
      (r) => told(r, `${r.invoice.invoiceNumber} marked paid. A receipt is in their chat.`, `${r.invoice.invoiceNumber} marked paid.`),
    );

  const handleCancel = (id: string, reason: string) =>
    run(
      () => dashboardApi.cancelInvoice(id, reason),
      (r) => told(r, `${r.invoice.invoiceNumber} cancelled. They have been told in their chat.`, `${r.invoice.invoiceNumber} cancelled.`),
    );

  const handleRefund = (id: string, note: string) =>
    run(() => dashboardApi.refundInvoice(id, note), (r) => `Refund recorded on ${r.invoice.invoiceNumber}.`);

  const handleRemind = (inv: PaymentInvoice) =>
    run(() => dashboardApi.remindInvoice(inv.id), () => `Reminder posted in ${inv.customerName}'s chat.`);

  const handleCopyLink = (inv: PaymentInvoice) => {
    if (!inv.payUrl) return;
    navigator.clipboard
      .writeText(inv.payUrl)
      .then(() => showToast("Payment link copied. Anyone with it can see and pay this one invoice.", "info"))
      .catch(() => showToast(inv.payUrl ?? "", "info"));
  };

  /** Loaded when the owner opens the form, in the click - not on every page visit. */
  const openNewInvoice = async () => {
    setIsNewOpen(true);
    try {
      const [people, catalog] = await Promise.all([dashboardApi.customers(), dashboardApi.paymentCatalog()]);
      setCustomers(people);
      setServices(catalog);
    } catch (error) {
      showToast(message(error, "Could not load customers and services."), "error");
    }
  };

  const handleCreate = async (input: NewInvoice) => {
    // Errors (409 already billed, 400 due date...) go back to the form, which shows them.
    const result = await dashboardApi.createInvoice(input);
    replace(result.invoice);
    showToast(
      told(
        result,
        `${result.invoice.invoiceNumber} created and sent to ${result.invoice.customerName}'s chat.`,
        `${result.invoice.invoiceNumber} created. Share its payment link yourself.`,
      ),
    );
  };

  const handleSaveSettings = async (patch: { upi_id: string; payee_name: string; invoice_prefix: string; due_days: number }) => {
    try {
      const saved = await dashboardApi.updatePaymentSettings(patch);
      setSettings(saved);
      showToast(saved.upiReady ? "Saved. New pay pages show your UPI QR code." : "Saved. Add a UPI ID to take UPI payments.");
      void refresh();
    } catch (error) {
      throw new Error(message(error, "Could not save the settings."));
    }
  };

  // ---- numbers ---------------------------------------------------------------
  const sumBy = (status: PaymentStatus) => invoices.filter((i) => i.status === status).reduce((a, i) => a + i.amount, 0);
  const collected = sumBy("paid");
  const pending = sumBy("pending");
  const overdue = sumBy("overdue");
  const paidCount = invoices.filter((i) => i.status === "paid").length;
  const billable = invoices.filter((i) => i.status !== "cancelled").length || 1;

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: invoices.length, paid: 0, pending: 0, overdue: 0, refunded: 0, cancelled: 0 };
    for (const i of invoices) c[i.status] += 1;
    return c;
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices
      .filter((i) => {
        const matchesSearch =
          !q ||
          i.customerName.toLowerCase().includes(q) ||
          i.invoiceNumber.toLowerCase().includes(q) ||
          i.items.some((it) => it.description.toLowerCase().includes(q));
        const matchesStatus = statusFilter === "all" || i.status === statusFilter;
        const matchesMethod = methodFilter === "all" || (methodFilter === "none" ? !i.paymentMethod : i.paymentMethod === methodFilter);
        return matchesSearch && matchesStatus && matchesMethod;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [invoices, search, statusFilter, methodFilter]);

  const outstanding = invoices
    .filter((i) => i.status === "pending" || i.status === "overdue")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const claims = outstanding.filter((i) => i.customerReportedAt);

  const methodTotals = (Object.keys(paymentMethodLabels) as PaymentMethod[])
    .map((m) => ({
      method: m,
      total: invoices.filter((i) => i.status === "paid" && i.paymentMethod === m).reduce((a, i) => a + i.amount, 0),
    }))
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);

  /** The last six months, by the month the money was marked paid (in IST). */
  const revenueData = useMemo(() => {
    if (!business.today) return [];
    const [year, month] = business.today.split("-").map(Number);
    return Array.from({ length: 6 }, (_, index) => {
      const offset = 5 - index;
      const m = (month - 1 - offset + 12 * 2) % 12;
      const y = year - (month - 1 - offset < 0 ? 1 : 0);
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      const revenue = invoices
        .filter((i) => i.status === "paid" && (i.paidDate ?? "").startsWith(key))
        .reduce((a, i) => a + i.amount, 0);
      return { label: MONTHS[m], values: { revenue } };
    });
  }, [invoices, business.today]);

  const selected = invoices.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CreditCard}
        title="Payments"
        description="Bill customers, collect by UPI with no fees, and see what has come in."
        actions={
          <Button size="sm" className="text-xs shadow-md shadow-indigo-600/20" onClick={() => void openNewInvoice()} disabled={!configured}>
            <Plus className="w-3.5 h-3.5" /> New Invoice
          </Button>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      )}

      {settings && !settings.upiReady && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          No UPI ID yet. Invoices still work, but their pay page can only say &ldquo;pay at the front desk&rdquo;. Add your UPI ID in Payment Settings below.
        </div>
      )}

      {claims.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <BadgeInfo className="w-4 h-4" /> {claims.length} {claims.length === 1 ? "customer says they have" : "customers say they have"} paid
          </div>
          <p className="text-xs text-amber-200/80">Check your UPI app or bank statement, then open each one and mark it paid. Nothing is paid until you do.</p>
          <div className="flex flex-wrap gap-2">
            {claims.map((inv) => (
              <Button key={inv.id} variant="outline" size="sm" onClick={() => setSelectedId(inv.id)}>
                {inv.customerName} • {formatCurrency(inv.amount)}
                {inv.customerReference ? ` • ${inv.customerReference}` : ""}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Collected" value={formatCurrency(collected)} icon={Wallet} tone="emerald" hint={`${paidCount} paid invoices`} onClick={() => setStatusFilter("paid")} active={statusFilter === "paid"} />
        <StatCard label="Pending" value={formatCurrency(pending)} icon={Clock} tone="amber" hint={`${counts.pending} awaiting payment`} onClick={() => setStatusFilter("pending")} active={statusFilter === "pending"} />
        <StatCard label="Overdue" value={formatCurrency(overdue)} icon={AlertTriangle} tone="rose" hint={`${counts.overdue} past due date`} onClick={() => setStatusFilter("overdue")} active={statusFilter === "overdue"} />
        <StatCard label="Collection Rate" value={`${Math.round((paidCount / billable) * 100)}%`} icon={CheckCircle2} tone="indigo" hint="Paid vs. billed (not cancelled)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>Money In</CardTitle>
            <CardDescription>Invoices marked paid, by month, over the last six months.</CardDescription>
          </CardHeader>
          <BarChart
            title="Money marked paid each month"
            data={revenueData}
            series={[{ key: "revenue", label: "Collected", color: CHART_COLORS.blue }]}
            format={(v) => formatCurrency(v)}
            axisFormat={compactRupees}
            heightClass="h-52"
          />
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle>Needs Follow-up</CardTitle>
            <CardDescription>{formatCurrency(pending + overdue)} still to collect</CardDescription>
          </CardHeader>
          <ul className="space-y-2 flex-1">
            {outstanding.length === 0 && <li className="text-xs text-gray-500 py-4 text-center">Everyone is paid up.</li>}
            {outstanding.slice(0, 5).map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                <button type="button" onClick={() => setSelectedId(inv.id)} className="min-w-0 text-left cursor-pointer">
                  <div className="text-xs font-semibold text-white truncate hover:text-indigo-300">{inv.customerName}</div>
                  <div className={inv.status === "overdue" ? "text-[11px] text-rose-300" : "text-[11px] text-gray-400"}>
                    {formatCurrency(inv.amount)} • {inv.status === "overdue" ? "Overdue since" : "Due"} {formatDate(inv.dueDate, { month: "short", day: "numeric" })}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={inv.hasChat === false}
                  title={inv.hasChat === false ? "They have never chatted with you - call them instead" : "Post a reminder in their chat"}
                  onClick={() => void handleRemind(inv).catch(() => undefined)}
                  aria-label={`Send reminder to ${inv.customerName}`}
                >
                  <Send className="w-3.5 h-3.5 text-indigo-400" />
                </Button>
              </li>
            ))}
          </ul>
          {methodTotals.length > 0 && (
            <div className="pt-3 mt-3 border-t border-gray-800/80 space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Collected by method</span>
              {methodTotals.map((m) => (
                <div key={m.method} className="space-y-1">
                  <div className="flex justify-between text-[11px] text-gray-300">
                    <span>{paymentMethodLabels[m.method]}</span>
                    <span className="font-mono text-white">{formatCurrency(m.total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(m.total / (collected || 1)) * 100}%`, backgroundColor: CHART_COLORS.blue }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <section className="space-y-3" aria-label="Invoices">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <SegmentedTabs<StatusFilter>
            tabs={[
              { label: "All", value: "all", count: counts.all },
              { label: "Paid", value: "paid", count: counts.paid },
              { label: "Pending", value: "pending", count: counts.pending },
              { label: "Overdue", value: "overdue", count: counts.overdue },
              { label: "Refunded", value: "refunded", count: counts.refunded },
              { label: "Cancelled", value: "cancelled", count: counts.cancelled },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            className="self-start"
          />
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search customer or invoice #..." className="w-full sm:w-64" />
            <Select
              aria-label="Filter by payment method"
              value={methodFilter}
              onChange={setMethodFilter}
              options={[
                { label: "All methods", value: "all" },
                ...(Object.keys(paymentMethodLabels) as PaymentMethod[]).map((m) => ({ label: paymentMethodLabels[m], value: m })),
                { label: "Not paid yet", value: "none" },
              ]}
              wrapperClassName="w-full sm:w-44"
            />
          </div>
        </div>
        {loading ? (
          <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading invoices…</p>
        ) : (
          <InvoiceTable invoices={filtered} onSelect={(i) => setSelectedId(i.id)} onRemind={(i) => void handleRemind(i).catch(() => undefined)} />
        )}
      </section>

      {settings && <PaymentSettingsCard key={`${settings.upiId}-${settings.invoicePrefix}-${settings.dueDays}`} settings={settings} onSave={handleSaveSettings} />}

      <InvoiceDetailModal
        invoice={selected}
        businessName={business.name}
        onClose={() => setSelectedId(null)}
        onMarkPaid={handleMarkPaid}
        onCancel={handleCancel}
        onRefund={handleRefund}
        onRemind={handleRemind}
        onCopyLink={handleCopyLink}
      />
      <NewInvoiceModal
        key={isNewOpen ? "open" : "closed"}
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        onCreate={handleCreate}
        customers={customers}
        services={services}
        dueDays={settings?.dueDays ?? 7}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
```

**`frontend/src/features/payments/components/InvoiceTable.tsx`** — complete file:

```tsx
import React from "react";
import { Receipt, ChevronRight, Send, BadgeInfo } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { PaymentInvoice } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { invoiceStatusMeta } from "@/lib/status";
import { paymentMethodLabels } from "../constants";

interface InvoiceTableProps {
  invoices: PaymentInvoice[];
  onSelect: (invoice: PaymentInvoice) => void;
  onRemind: (invoice: PaymentInvoice) => void;
}

const isOpen = (inv: PaymentInvoice) => inv.status === "pending" || inv.status === "overdue";

/** A reminder goes into the customer's chat, so it needs one. */
const canRemind = (inv: PaymentInvoice) => isOpen(inv) && inv.hasChat !== false;

function DueCell({ invoice }: { invoice: PaymentInvoice }) {
  if (invoice.status === "paid" && invoice.paidDate) {
    return <span className="text-gray-400">Paid {formatDate(invoice.paidDate, { month: "short", day: "numeric" })}</span>;
  }
  if (invoice.status === "cancelled") {
    return <span className="text-gray-500">Cancelled</span>;
  }
  return (
    <span className={invoice.status === "overdue" ? "text-rose-300" : "text-gray-300"}>
      {formatDate(invoice.dueDate, { month: "short", day: "numeric" })}
    </span>
  );
}

/** The customer says they paid. Shown until the owner checks and marks it paid. */
function ClaimBadge({ invoice }: { invoice: PaymentInvoice }) {
  if (!invoice.customerReportedAt || !isOpen(invoice)) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-300" title="The customer says they have paid. Check your UPI app or bank, then mark it paid.">
      <BadgeInfo className="w-3 h-3" /> Says paid
    </span>
  );
}

export function InvoiceTable({ invoices, onSelect, onRemind }: InvoiceTableProps) {
  if (invoices.length === 0) {
    return <EmptyState icon={Receipt} title="No Invoices Found" description="No invoices match your search or filters." />;
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg">
      <ul className="md:hidden divide-y divide-gray-800/80">
        {invoices.map((inv) => (
          <li key={inv.id}>
            <button type="button" onClick={() => onSelect(inv)} className="w-full text-left p-4 space-y-1.5 hover:bg-gray-800/40 cursor-pointer">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white truncate">{inv.customerName}</span>
                <span className="text-sm font-bold text-white">{formatCurrency(inv.amount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
                <span className="font-mono">{inv.invoiceNumber}</span>
                <span className="flex items-center gap-2">
                  <ClaimBadge invoice={inv} />
                  <Badge variant={invoiceStatusMeta[inv.status].variant}>{invoiceStatusMeta[inv.status].label}</Badge>
                </span>
              </div>
              <div className="text-[11px] text-gray-400 truncate">
                {inv.items[0]?.description} • Due <DueCell invoice={inv} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Invoice</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4 hidden lg:table-cell">Description</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Due / Paid</th>
              <th className="py-3 px-4 hidden xl:table-cell">Method</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80 text-gray-200">
            {invoices.map((inv) => (
              <tr key={inv.id} onClick={() => onSelect(inv)} className="hover:bg-gray-800/40 transition-colors cursor-pointer group">
                <td className="py-3.5 px-4 font-mono text-gray-300 whitespace-nowrap">{inv.invoiceNumber}</td>
                <td className="py-3.5 px-4">
                  <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">{inv.customerName}</div>
                  <div className="text-[11px] text-gray-500">{inv.customerEmail}</div>
                </td>
                <td className="py-3.5 px-4 hidden lg:table-cell max-w-[14rem] truncate text-gray-300">{inv.items[0]?.description}</td>
                <td className="py-3.5 px-4 text-right font-semibold text-white">{formatCurrency(inv.amount)}</td>
                <td className="py-3.5 px-4">
                  <div className="flex flex-col items-start gap-1">
                    <Badge variant={invoiceStatusMeta[inv.status].variant}>{invoiceStatusMeta[inv.status].label}</Badge>
                    <ClaimBadge invoice={inv} />
                  </div>
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap">
                  <DueCell invoice={inv} />
                </td>
                <td className="py-3.5 px-4 hidden xl:table-cell text-gray-400">
                  {inv.paymentMethod ? paymentMethodLabels[inv.paymentMethod] : "—"}
                </td>
                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {isOpen(inv) && (
                      <button
                        type="button"
                        onClick={() => onRemind(inv)}
                        disabled={!canRemind(inv)}
                        title={canRemind(inv) ? "Post a reminder in their chat" : "They have never chatted with you - call them instead"}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-indigo-300 hover:text-white hover:bg-indigo-500/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        <Send className="w-3 h-3" /> Remind
                      </button>
                    )}
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-300" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**`frontend/src/features/payments/components/InvoiceDetailModal.tsx`** — complete file:

```tsx
"use client";

import React, { useState } from "react";
import { Send, CheckCircle2, Download, Link2, ExternalLink, XCircle, Undo2, BadgeInfo } from "lucide-react";
import { Modal, Badge, Button, DetailList, Input, Select } from "@/components/ui";
import { PaymentInvoice } from "@/types";
import { formatCurrency, formatDate, formatInstant, formatPhone } from "@/lib/utils";
import { invoiceStatusMeta } from "@/lib/status";
import { paymentMethodLabels, PaymentMethod } from "../constants";

interface InvoiceDetailModalProps {
  invoice: PaymentInvoice | null;
  businessName: string;
  onClose: () => void;
  /** Each action rejects on failure; the page shows the toast. */
  onMarkPaid: (id: string, method: PaymentMethod, reference: string) => Promise<void>;
  onCancel: (id: string, reason: string) => Promise<void>;
  onRefund: (id: string, note: string) => Promise<void>;
  onRemind: (invoice: PaymentInvoice) => Promise<void>;
  onCopyLink: (invoice: PaymentInvoice) => void;
}

export function InvoiceDetailModal({
  invoice,
  businessName,
  onClose,
  onMarkPaid,
  onCancel,
  onRefund,
  onRemind,
  onCopyLink,
}: InvoiceDetailModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  if (!invoice) return null;

  const status = invoiceStatusMeta[invoice.status];
  const isOpen = invoice.status === "pending" || invoice.status === "overdue";

  /** Run one action with the buttons disabled; the page reports success or failure. */
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setReference("");
    } catch {
      // The page has shown the error. Leave the form as it was.
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    const reason = window.prompt("Why cancel this invoice? The customer is told it no longer needs paying.", "");
    if (reason !== null) void act(() => onCancel(invoice.id, reason));
  };

  const handleRefund = () => {
    const note = window.prompt(
      "Record a refund you have ALREADY paid back (by UPI, cash...). What should the note say?",
      "",
    );
    if (note !== null) void act(() => onRefund(invoice.id, note));
  };

  return (
    <Modal isOpen onClose={onClose} title={`Invoice ${invoice.invoiceNumber}`} description={`Issued ${formatInstant(invoice.createdAt)}`} maxWidth="lg">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Billed to</span>
            <div className="text-base font-semibold text-white">{invoice.customerName}</div>
            <div className="text-xs text-gray-400">{formatPhone(invoice.customerPhone) || invoice.customerEmail}</div>
          </div>
          <div className="sm:text-right">
            <Badge variant={status.variant}>{status.label}</Badge>
            <div className="text-2xl font-bold text-white mt-1">{formatCurrency(invoice.amount, invoice.currency)}</div>
          </div>
        </div>

        {invoice.customerReportedAt && isOpen && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200 flex gap-2">
            <BadgeInfo className="w-4 h-4 flex-shrink-0 text-amber-400" />
            <span>
              The customer says they paid on {formatInstant(invoice.customerReportedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              {invoice.customerReference ? <>, UPI reference <span className="font-mono text-white">{invoice.customerReference}</span></> : null}.
              Check your UPI app or bank statement first. Only mark it paid once you can see the money.
            </span>
          </div>
        )}

        {/* Line items */}
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-950/80 text-gray-400 uppercase tracking-wider">
              <tr>
                <th className="text-left py-2 px-3">Item</th>
                <th className="text-right py-2 px-3">Qty</th>
                <th className="text-right py-2 px-3 hidden sm:table-cell">Price</th>
                <th className="text-right py-2 px-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-gray-200">
              {invoice.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-2 px-3">{item.description}</td>
                  <td className="py-2 px-3 text-right">{item.quantity}</td>
                  <td className="py-2 px-3 text-right hidden sm:table-cell">{formatCurrency(item.unitPrice)}</td>
                  <td className="py-2 px-3 text-right font-medium">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-800 bg-gray-950/60">
              <tr>
                <td colSpan={2} className="py-2 px-3 font-semibold text-white sm:hidden">Total</td>
                <td colSpan={3} className="py-2 px-3 font-semibold text-white hidden sm:table-cell">Total</td>
                <td className="py-2 px-3 text-right font-bold text-white">{formatCurrency(invoice.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <DetailList
          items={[
            { label: "Due date", value: formatDate(invoice.dueDate) },
            { label: "Paid on", value: invoice.paidDate ? formatDate(invoice.paidDate) : "Not paid yet" },
            {
              label: "Method",
              value: invoice.paymentMethod
                ? `${paymentMethodLabels[invoice.paymentMethod]}${invoice.paidReference ? ` • ${invoice.paidReference}` : ""}`
                : "—",
            },
            { label: "Booking", value: invoice.bookingReference ?? "Not for a booking" },
            { label: "Business", value: businessName },
            ...(invoice.cancelReason ? [{ label: "Cancelled because", value: invoice.cancelReason }] : []),
            ...(invoice.refundNote ? [{ label: "Refund note", value: invoice.refundNote }] : []),
          ]}
        />

        {isOpen && (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] sm:items-end gap-2">
            <Select
              label="Payment received by"
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
              options={(Object.keys(paymentMethodLabels) as PaymentMethod[]).map((m) => ({ label: paymentMethodLabels[m], value: m }))}
            />
            <Input
              label="Reference (optional)"
              placeholder={method === "upi" ? "12-digit UPI reference" : "Receipt or cheque no."}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Button size="md" disabled={busy} onClick={() => void act(() => onMarkPaid(invoice.id, method, reference.trim()))} className="text-xs">
              <CheckCircle2 className="w-3.5 h-3.5" /> Mark as Paid
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button variant="ghost" size="sm" disabled title="PDF invoices are not built yet.">
            <Download className="w-3.5 h-3.5" /> PDF not built yet
          </Button>
          {invoice.payUrl && (
            <>
              <Button variant="outline" size="sm" onClick={() => onCopyLink(invoice)}>
                <Link2 className="w-3.5 h-3.5" /> Copy Payment Link
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open(invoice.payUrl, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="w-3.5 h-3.5" /> Open Pay Page
              </Button>
            </>
          )}
          {isOpen && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || invoice.hasChat === false}
                title={invoice.hasChat === false ? "They have never chatted with you - call them instead." : undefined}
                onClick={() => void act(() => onRemind(invoice))}
              >
                <Send className="w-3.5 h-3.5 text-indigo-400" /> Send Reminder
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={handleCancel} className="hover:text-rose-300">
                <XCircle className="w-3.5 h-3.5 text-rose-400" /> Cancel Invoice
              </Button>
            </>
          )}
          {invoice.status === "paid" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={handleRefund}>
              <Undo2 className="w-3.5 h-3.5 text-amber-400" /> Record Refund
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

**`frontend/src/features/payments/components/NewInvoiceModal.tsx`** — complete file:

```tsx
"use client";

import React, { useState } from "react";
import { Modal, Button, Input, Select, SegmentedTabs, Toggle } from "@/components/ui";
import type { Booking, CustomerSummary } from "@/types";
import { dashboardApi, type CatalogService, type NewInvoice } from "@/lib/api/dashboard";
import { formatCurrency, formatDate, formatPhone, isoDateInIndia } from "@/lib/utils";

interface NewInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Rejects with the backend's message, shown inside the form. */
  onCreate: (invoice: NewInvoice) => Promise<void>;
  customers: CustomerSummary[];
  services: CatalogService[];
  dueDays: number;
}

type Mode = "booking" | "service";

export function NewInvoiceModal({ isOpen, onClose, onCreate, customers, services, dueDays }: NewInvoiceModalProps) {
  const [customerId, setCustomerId] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [mode, setMode] = useState<Mode>("booking");
  const [bookingId, setBookingId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [dueDate, setDueDate] = useState(() => isoDateInIndia(dueDays));
  const [sendToChat, setSendToChat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const service = services.find((s) => s.id === serviceId);
  const booking = bookings.find((b) => b.id === bookingId);
  const total = mode === "booking" ? (booking?.price ?? 0) : (service?.price ?? 0) * quantity;

  const reset = () => {
    setCustomerId("");
    setBookings([]);
    setMode("booking");
    setBookingId("");
    setServiceId("");
    setQuantity(1);
    setDueDate(isoDateInIndia(dueDays));
    setSendToChat(true);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  /** Load this customer's billable bookings when they are picked - in the event, not an effect. */
  const chooseCustomer = async (id: string) => {
    setCustomerId(id);
    setBookingId("");
    setBookings([]);
    setError(null);
    if (!id) return;
    setLoadingBookings(true);
    try {
      const detail = await dashboardApi.customer(id);
      const billable = detail.bookings.filter(
        (b) => (b.status === "confirmed" || b.status === "completed") && b.paymentStatus === "unpaid",
      );
      setBookings(billable);
      setMode(billable.length > 0 ? "booking" : "service");
    } catch {
      setMode("service");
    } finally {
      setLoadingBookings(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) return setError("Choose a customer.");
    if (mode === "booking" && !bookingId) return setError("Choose the booking to bill.");
    if (mode === "service" && !service) return setError("Choose a service.");

    setSaving(true);
    setError(null);
    try {
      await onCreate({
        customer_id: customerId,
        // Billing a booking sends NO items: the backend uses the booking's own snapshot price.
        appointment_id: mode === "booking" ? bookingId : null,
        items:
          mode === "service" && service
            ? [{ description: service.name, quantity, unit_price: service.price }]
            : [],
        due_date: dueDate,
        send_to_chat: sendToChat,
      });
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the invoice.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Invoice" description="Bill a customer for a booking or a service." maxWidth="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-1">
        <Select
          label="Customer"
          value={customerId}
          onChange={(v) => void chooseCustomer(v)}
          options={[
            { label: "Choose a customer…", value: "" },
            ...customers.map((c) => ({ label: `${c.name}${c.phone ? ` (${formatPhone(c.phone)})` : ""}`, value: c.id })),
          ]}
        />

        {customerId && (
          <SegmentedTabs<Mode>
            tabs={[
              { label: "A booking", value: "booking", count: bookings.length },
              { label: "A service", value: "service" },
            ]}
            value={mode}
            onChange={setMode}
            className="w-fit"
          />
        )}

        {customerId && mode === "booking" && (
          loadingBookings ? (
            <p className="text-xs text-gray-500">Loading their bookings…</p>
          ) : bookings.length === 0 ? (
            <p className="text-xs text-gray-500">No confirmed, unpaid bookings for this customer. Bill a service instead.</p>
          ) : (
            <Select
              label="Booking (billed at the price they were quoted)"
              value={bookingId}
              onChange={setBookingId}
              options={[
                { label: "Choose a booking…", value: "" },
                ...bookings.map((b) => ({
                  label: `${b.serviceName} • ${formatDate(b.date, { day: "numeric", month: "short" })} ${b.time} • ${formatCurrency(b.price)}`,
                  value: b.id,
                })),
              ]}
            />
          )
        )}

        {customerId && mode === "service" && (
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Select
              label="Service"
              value={serviceId}
              onChange={setServiceId}
              options={[
                { label: "Choose a service…", value: "" },
                ...services.map((s) => ({ label: `${s.name} — ${formatCurrency(s.price)}`, value: s.id })),
              ]}
            />
            <Input
              label="Quantity"
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        )}

        <Input label="Due Date" type="date" value={dueDate} min={isoDateInIndia()} onChange={(e) => setDueDate(e.target.value)} required />

        <Toggle
          checked={sendToChat}
          onChange={setSendToChat}
          label="Send it to their chat"
          description="Posts the invoice and its UPI payment link in the customer's chat thread, if they have one."
        />

        <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2.5">
          <span className="text-xs text-gray-400">Invoice total</span>
          <span className="text-lg font-bold text-white">{formatCurrency(total)}</span>
        </div>
        <p className="text-[11px] text-gray-500">The invoice number is given by the database when you create it, in one unbroken series for the financial year.</p>

        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Creating…" : "Create Invoice"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
```

**`frontend/src/features/payments/components/PaymentSettingsCard.tsx`** — complete file:

```tsx
"use client";

import React, { useState } from "react";
import { Save } from "lucide-react";
import { Button, Card, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import type { PaymentSettings } from "@/types";

interface PaymentSettingsCardProps {
  settings: PaymentSettings;
  /** Rejects with the backend's message, shown under the form. */
  onSave: (patch: { upi_id: string; payee_name: string; invoice_prefix: string; due_days: number }) => Promise<void>;
}

/**
 * Where the business's UPI ID lives. Without it, invoices still work but the
 * pay page can only say "pay at the front desk" - we will never invent a payee.
 */
export function PaymentSettingsCard({ settings, onSave }: PaymentSettingsCardProps) {
  const [upiId, setUpiId] = useState(settings.upiId);
  const [payeeName, setPayeeName] = useState(settings.payeeName);
  const [prefix, setPrefix] = useState(settings.invoicePrefix);
  const [dueDays, setDueDays] = useState(settings.dueDays);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ upi_id: upiId.trim(), payee_name: payeeName.trim(), invoice_prefix: prefix.trim(), due_days: dueDays });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Payment Settings</CardTitle>
        <CardDescription>
          Customers pay you directly by UPI: no gateway, no fees. The money goes straight to this UPI ID, so check it carefully.
        </CardDescription>
      </CardHeader>
      <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_1fr_auto] gap-3 items-end">
        <Input label="Your UPI ID" placeholder="yourname@okaxis" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
        <Input label="Name shown in the UPI app" placeholder="Pulse Fitness Studio" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
        <Input label="Invoice prefix" placeholder="INV" maxLength={3} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
        <Input label="Due in (days)" type="number" min={0} max={90} value={dueDays} onChange={(e) => setDueDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} />
        <Button type="submit" size="md" disabled={saving} className="text-xs">
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-rose-400 mt-2">
          {error}
        </p>
      )}
      <p className="text-[11px] text-gray-500 mt-2">
        Invoice numbers look like {prefix || "INV"}/2026-27/0001: one unbroken series per financial year (1 April to 31 March). GST is not calculated.
      </p>
    </Card>
  );
}
```

**`frontend/src/features/bookings/components/BookingDetailModal.tsx`** — three
edits. Remove `BookingPaymentStatus` from the `@/types` import. Replace the
`onUpdatePayment` prop with:

```tsx
  /**
   * Bill this booking. Payment status is no longer set by hand: it follows the
   * booking's invoice (a database trigger), so "paid" means an invoice was paid.
   */
  onCreateInvoice: (booking: Booking) => void;
```

(and `onUpdatePayment` → `onCreateInvoice` in the function's argument list), and
replace the **Mark as Paid** button with:

```tsx
            {booking.paymentStatus === "unpaid" && (booking.status === "confirmed" || booking.status === "completed") && (
              <Button variant="outline" size="sm" onClick={() => onCreateInvoice(booking)}>
                <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                Create Invoice
              </Button>
            )}
```

**`frontend/src/app/dashboard/bookings/page.tsx`** — replace `handleUpdatePayment`
with:

```tsx
  /**
   * Bill a booking. The invoice uses the booking's OWN snapshot price, lands
   * in the customer's chat, and - once it is paid - a database trigger flips
   * this booking's payment status. Nothing here sets "paid" by hand.
   */
  const handleCreateInvoice = useCallback(
    async (booking: Booking) => {
      try {
        const result = await dashboardApi.createInvoice({
          customer_id: booking.customerId,
          appointment_id: booking.id,
        });
        showToast(
          result.customer_notified
            ? `${result.invoice.invoiceNumber} created and sent to ${booking.customerName}'s chat.`
            : `${result.invoice.invoiceNumber} created. They have no chat thread - share the link from Payments.`,
        );
      } catch (error) {
        showToast(error instanceof HubError ? error.message : "Could not create the invoice.", "error");
      }
    },
    [showToast],
  );
```

and pass it to the modal as `onCreateInvoice={(b) => void handleCreateInvoice(b)}`
instead of `onUpdatePayment={handleUpdatePayment}`.

**`frontend/src/features/customers/components/CustomerDetailModal.tsx`** — the
Invoices tab's "not built yet" sentence becomes:

```tsx
                Payments are switched off for this business, so there are no invoices.
```

### Explain the code

```tsx
  const run = useCallback(
    async (action: () => Promise<InvoiceResult>, done: (r: InvoiceResult) => string) => {
      try { ... } catch (error) {
        showToast(message(error, "That did not work."), "error");
        void refresh();
        throw error;
      }
```
Every money action goes through one helper. On failure it shows why, **reloads**
(a 409 means our copy is stale), and re-throws so the modal keeps its form as
it was.

```tsx
      {claims.length > 0 && (
        ... "customers say they have paid" ...
          Check your UPI app or bank statement, then open each one and mark it paid.
```
Plain UPI has no automatic "money arrived" signal. This strip is the workflow
instead: the customer's claim, with their reference, next to a reminder that
nothing is paid until the owner has seen it.

```tsx
      const m = (month - 1 - offset + 12 * 2) % 12;
      const y = year - (month - 1 - offset < 0 ? 1 : 0);
```
Six months back from **the business's today**, which the API sends. Using the
browser's date would put the owner's end-of-month into the wrong bar whenever
they are in another timezone. The `+ 24` keeps the modulo positive, because
JavaScript's `%` of a negative number is negative.

```tsx
          <Button variant="ghost" size="sm" disabled title="PDF invoices are not built yet.">
            <Download className="w-3.5 h-3.5" /> PDF not built yet
```
The mock button toasted *"prepared for download (demo)"*. A disabled button that
says what is missing is honest; a fake download is not.

```tsx
        // Billing a booking sends NO items: the backend uses the booking's own snapshot price.
        appointment_id: mode === "booking" ? bookingId : null,
```
The browser never sends a price for a booking. If it did, a tampered request
could bill ₹1 for a ₹9,000 session.

```tsx
        key={isNewOpen ? "open" : "closed"}
```
A new `key` makes React throw the form away and build a fresh one, so every New
Invoice starts empty. That includes a due date recalculated from today, rather
than the date from whenever the page first loaded.

```tsx
      {settings && <PaymentSettingsCard key={`${settings.upiId}-${settings.invoicePrefix}-${settings.dueDays}`} ... />}
```
The same trick for the settings form. When the saved settings change, the form
starts again from them instead of holding stale values.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
npm run lint
npm run dev
```

### How to test

See STEP 50. The pay page completes the loop, and the browser table there
covers both screens.

### Expected result

`tsc` prints nothing; `npm run lint` shows no errors.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Lint: `react-hooks/set-state-in-effect` in NewInvoiceModal | Loading bookings from an effect | Keep it in `chooseCustomer`, the select's change handler. |
| Amber strip: *Could not load invoices* with 404 | The payments router is not mounted | STEP 47's `main.py` edit. |
| New Invoice shows no customers | `dashboardApi.customers()` failed | A red toast says why; check uvicorn. |
| Create Invoice on a booking says *already has an invoice* | It has one, pending or paid | Open it on Payments. Cancel it first if it is wrong. |

---

## STEP 50 — The public pay page

### Goal

`/pay/<token>`: what the customer sees after tapping the link in their chat. The
amount, the items, a **real UPI QR code**, a **Pay with a UPI app** button, and
**I've paid**.

### Why?

This is where the customer actually pays, from whatever device they are on:

| Device | How they pay |
| --- | --- |
| Phone | Tap **Pay ₹9,000 with a UPI app**. The `upi://` link opens GPay, PhonePe, Paytm or BHIM with the amount filled in. |
| Laptop | Scan the QR code with their phone's UPI app. |

There is no gateway, no fee, and no card form. This page never sees bank
details, because the money moves inside the customer's own UPI app.

### Architecture

```
  /pay/<token>   (server page: reads the token, marks the page no-index)
       │
       ▼
  <PayPage token>   (client)
       │  payApi.get(token)          ── GET  /api/v1/pay/<token>
       │  every 20 s while unpaid    ── so "Paid" appears when the owner confirms
       │  "I've paid" + reference    ── POST /api/v1/pay/<token>/claim
       ▼
  paid        →  "Paid on 27 Sept 2026. Thank you!"
  pending     →  QR + "Pay with a UPI app" + "Already paid?"
  no UPI ID   →  "Please pay at the front desk"
  cancelled   →  "You do not need to pay it"
```

### Files involved

```
frontend/src/
├── app/pay/[token]/
│   └── page.tsx                                 ← new
└── features/payments/components/
    └── PayPage.tsx                              ← new
```

### Code

**`frontend/src/app/pay/[token]/page.tsx`** — complete file:

```tsx
import type { Metadata, Viewport } from "next";
import { PayPage } from "@/features/payments/components/PayPage";

interface PayPageProps {
  params: Promise<{ token: string }>;
}

/** Every link is a different invoice, created at runtime. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay your invoice",
  // A payment link is private. It must never appear in search results.
  robots: { index: false, follow: false },
  // Do not leak the token to other sites through the Referer header.
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#030712",
};

/** Public, login-free: the random token in the URL is the only permission. */
export default async function PublicPayPage({ params }: PayPageProps) {
  const { token } = await params;
  return <PayPage token={token} />;
}
```

**`frontend/src/features/payments/components/PayPage.tsx`** — complete file:

```tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Smartphone, ShieldCheck, Clock } from "lucide-react";
import { Badge, Button, Input, QrCodeGraphic } from "@/components/ui";
import type { PublicInvoice } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { invoiceStatusMeta } from "@/lib/status";
import { payApi, PayApiError } from "@/lib/api/pay";

/**
 * The page a customer opens from the link in their chat.
 *
 * It shows a real UPI QR code (scan from a laptop) and a "Pay with a UPI app"
 * button (tap on a phone). The money goes straight to the business. Pressing
 * "I've paid" only TELLS the business; the invoice stays unpaid until they
 * check their account and mark it paid.
 */
export function PayPage({ token }: { token: string }) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInvoice(await payApi.get(token));
      setError(null);
    } catch (cause) {
      setError(cause instanceof PayApiError ? cause.message : "This payment link could not be opened.");
    }
  }, [token]);

  const payable = invoice?.status === "pending" || invoice?.status === "overdue";

  useEffect(() => {
    // `load` awaits before it sets state, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // While it is unpaid, check every 20 seconds, so "Paid" appears here as soon
    // as the business confirms - without the customer reloading.
    if (!payable) return;
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, [payable, load]);

  const claim = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaiming(true);
    setClaimError(null);
    try {
      setInvoice(await payApi.claim(token, reference.trim()));
    } catch (cause) {
      setClaimError(cause instanceof PayApiError ? cause.message : "Could not send that. Please try again.");
    } finally {
      setClaiming(false);
    }
  };

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-gray-300 text-center py-10">{error}</p>
      </Shell>
    );
  }
  if (!invoice) {
    return (
      <Shell>
        <p className="text-sm text-gray-500 text-center py-10">Loading your invoice…</p>
      </Shell>
    );
  }

  const status = invoiceStatusMeta[invoice.status];

  return (
    <Shell>
      <div className="space-y-5">
        <div className="text-center space-y-1">
          <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{invoice.businessName}</div>
          <div className="text-sm text-gray-300">
            {invoice.customerFirstName ? `${invoice.customerFirstName}, here is` : "Here is"} invoice{" "}
            <span className="font-mono text-white">{invoice.invoiceNumber}</span>
          </div>
          <div className="text-4xl font-bold text-white pt-2">{formatCurrency(invoice.amount)}</div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Badge variant={status.variant}>{status.label}</Badge>
            {payable && (
              <span className={invoice.status === "overdue" ? "text-xs text-rose-300" : "text-xs text-gray-400"}>
                {invoice.status === "overdue" ? "was due" : "due by"} {formatDate(invoice.dueDate)}
              </span>
            )}
          </div>
        </div>

        <ul className="rounded-xl border border-gray-800 divide-y divide-gray-800 text-sm">
          {invoice.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3 px-3 py-2">
              <span className="text-gray-200">
                {item.quantity > 1 && <span className="text-gray-500">{item.quantity} × </span>}
                {item.description}
              </span>
              <span className="font-medium text-white whitespace-nowrap">{formatCurrency(item.total)}</span>
            </li>
          ))}
        </ul>

        {invoice.status === "paid" && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center space-y-1">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <div className="text-sm font-semibold text-emerald-300">Paid{invoice.paidDate ? ` on ${formatDate(invoice.paidDate)}` : ""}. Thank you!</div>
          </div>
        )}

        {invoice.status === "cancelled" && (
          <p className="rounded-xl border border-gray-800 p-4 text-sm text-gray-300 text-center">
            This invoice was cancelled. You do not need to pay it.
          </p>
        )}

        {invoice.status === "refunded" && (
          <p className="rounded-xl border border-gray-800 p-4 text-sm text-gray-300 text-center">
            This invoice was paid and then refunded.
          </p>
        )}

        {payable && invoice.upiLink && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2">
              <QrCodeGraphic value={invoice.upiLink} svgClassName="w-52 h-52" label="Scan with any UPI app" />
              <p className="text-[11px] text-gray-400 text-center">
                Paying <span className="text-white font-medium">{invoice.payeeName}</span>
                {invoice.upiId && <> (<span className="font-mono">{invoice.upiId}</span>)</>}. Check the name in your app before you pay.
              </p>
            </div>
            {/* On a phone this opens GPay, PhonePe, Paytm or BHIM with the amount filled in. */}
            <a
              href={invoice.upiLink}
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-3 transition-colors"
            >
              <Smartphone className="w-4 h-4" /> Pay {formatCurrency(invoice.amount)} with a UPI app
            </a>
          </div>
        )}

        {payable && !invoice.upiLink && (
          <p className="rounded-xl border border-gray-800 p-4 text-sm text-gray-300 text-center">
            Online payment is not set up for {invoice.businessName} yet. Please pay at the front desk.
          </p>
        )}

        {payable && invoice.customerReported && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200 flex gap-2">
            <Clock className="w-4 h-4 flex-shrink-0 text-amber-400" />
            <span>
              Thanks, {invoice.businessName} has been told you paid. It will show as paid here once they have checked it arrived.
            </span>
          </div>
        )}

        {payable && !invoice.customerReported && invoice.upiLink && (
          <form onSubmit={(e) => void claim(e)} className="rounded-xl border border-gray-800 p-3 space-y-2">
            <div className="text-xs font-semibold text-white">Already paid?</div>
            <Input
              label="UPI reference (optional)"
              placeholder="The 12-digit number your UPI app shows"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={60}
            />
            <Button type="submit" size="sm" variant="outline" disabled={claiming} className="w-full">
              {claiming ? "Sending…" : "I've paid"}
            </Button>
            <p className="text-[11px] text-gray-500">
              This tells {invoice.businessName} to check their account. It stays unpaid until they confirm.
            </p>
            {claimError && (
              <p role="alert" className="text-xs text-rose-400">
                {claimError}
              </p>
            )}
          </form>
        )}

        <p className="flex items-start gap-1.5 text-[11px] text-gray-500 justify-center text-center">
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          Your payment goes directly to {invoice.businessName} by UPI. This page never sees your bank details.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-start sm:items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900/70 p-5 shadow-xl">{children}</div>
    </main>
  );
}
```

### Explain the code

```tsx
  robots: { index: false, follow: false },
  referrer: "no-referrer",
```
A pay link is private. It must never be indexed by a search engine. If the
customer clicks something on the page that leads elsewhere, the browser must not
tell that site the URL they came from, because the URL **is** the permission.

```tsx
            <a href={invoice.upiLink} ...>
              <Smartphone className="w-4 h-4" /> Pay {formatCurrency(invoice.amount)} with a UPI app
```
A plain link. On a phone, the operating system hands `upi://` links to the
installed UPI apps. On a laptop nothing happens, which is why the QR code sits
right above it.

```tsx
                Paying <span ...>{invoice.payeeName}</span> ... Check the name in your app before you pay.
```
Every UPI app shows the receiver's registered name before you confirm. Telling
the customer to check it is the protection against a wrong or mistyped UPI ID in
the settings.

```tsx
    if (!payable) return;
    const timer = setInterval(() => void load(), 20000);
```
While the invoice is unpaid, the page checks every 20 seconds. When the owner
marks it paid, the customer sees **Paid** without reloading. Once it is paid, the
polling stops.

```tsx
            <p className="text-[11px] text-gray-500">
              This tells {invoice.businessName} to check their account. It stays unpaid until they confirm.
```
The same honesty as the chat tool. "I've paid" is a message, not a payment
record, and the page says so before the customer presses it.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
npm run lint
npm run dev
```

### How to test

With the backend and frontend running:

| # | Do this | Expect |
| --- | --- | --- |
| 1 | `/dashboard/payments` → Payment Settings → your real UPI ID → **Save**. **No UPI ID yet?** Skip this row: rows 2–12 still work, and row 4 shows *"pay at the front desk"* instead of a QR code. See [Adding your UPI ID later](#adding-your-upi-id-later). | Toast *"Saved. New pay pages show your UPI QR code."*; the amber "No UPI ID" strip goes |
| 2 | **New Invoice** → a customer → **A booking** → pick one → **Create** | Toast *"INV/2026-27/0001 created and sent to …'s chat"* |
| 3 | Open that customer's chat (`/chat/pulse-fitness`, same browser) | The invoice message, with a tappable link |
| 4 | Tap the link | The pay page: amount, items, QR code, *Pay with a UPI app* |
| 5 | *(needs a UPI ID)* Scan the QR with your phone's UPI app | The app opens with ₹ amount and your name filled in. **Do not pay yourself unless you mean to.** |
| 6 | *(needs a UPI ID)* Press **I've paid** with reference `123412341234`. Without one, ask about it in the chat instead: *"I've paid invoice INV/2026-27/0001, my number is …, reference 123412341234"* | *"Thanks, … has been told you paid"* |
| 7 | Back on Payments | Amber strip: *"1 customer says they have paid"*; the row shows **Says paid** |
| 8 | Open it → **Mark as Paid** (UPI, the reference) | Toast *"… marked paid. A receipt is in their chat."* |
| 9 | Pay page (wait up to 20 s) | *"Paid on … Thank you!"*, and no QR any more |
| 10 | `/dashboard/bookings` → that booking | Payment badge **Paid** (the trigger) |
| 11 | A confirmed, unbilled booking → **Create Invoice** | Toast with the next number, `…/0002` |
| 12 | Open an invoice → **PDF not built yet** | Disabled, and says so |

Invoices made here are **real** invoices in your series. If you are only trying
it out, cancel them afterwards. Cancelled invoices keep their numbers, which is
correct: a series may contain cancelled invoices, but never gaps.

### Expected result

Rows 1–12 as described. `tsc` and `lint` clean.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Pay page: *Could not reach the server* | The backend is not running, or CORS | Start uvicorn; `CORS_ORIGINS` must include `http://localhost:3000`. |
| Pay page: *This payment link is not valid* | Wrong token, or the invoice's business was deleted | Copy the link again from Payments. |
| QR scans but the UPI app says *invalid UPI ID* | A typo in the UPI ID | Fix it in Payment Settings; new pay pages use it immediately. |
| **Pay with a UPI app** does nothing | You are on a laptop | Scan the QR with your phone instead. |
| The link in chat is not tappable | `ChatMessageBubble` not updated | STEP 48's `Linkified` edit. |
| The link points at `localhost` on your phone | `PUBLIC_SITE_URL` is the default | Set `PUBLIC_SITE_URL` in `backend/.env` to an address your phone can reach, once deployed. |

---

## Adding your UPI ID later

You do **not** need a UPI ID to build or test any of this. Every test script uses
a made-up one inside a throwaway sandbox business. Until you add yours, real
invoices still work. Their pay page simply says *"Please pay at the front desk"*
instead of showing a QR code, and the Payments screen shows an amber strip:
*"No UPI ID yet."*

### 1. Find your UPI ID

It looks like `name@bank`, for example `pulsefitness@okaxis`, `9876543210@ybl`
or `pulse.fitness@oksbi`. In most apps it is on your profile screen. The exact
place moves between app versions, so look for the words **UPI ID**:

| App | Usually |
| --- | --- |
| Google Pay | Tap your profile photo (top right). Your UPI ID is under your name. |
| PhonePe | Tap your profile photo (top left) → **UPI ID** or **My QR**. |
| Paytm | Tap your profile (top left) → **UPI ID**. |
| BHIM | Home screen → your profile. |

For a business, a **business** UPI account is better (Google Pay for Business,
PhonePe Business, Paytm for Business). It has higher limits and a registered
business name. A personal UPI ID works too, and many small shops use one.

### 2. Paste it here, and only here

1. Start the backend and frontend as usual.
2. Open <http://localhost:3000/dashboard/payments>.
3. Scroll to the **bottom** of the page, to the card called **Payment Settings**.
4. **Your UPI ID**: paste it, for example `pulsefitness@okaxis`.
5. **Name shown in the UPI app** (optional): for example `Pulse Fitness Studio`.
   If you leave it empty, the business name is used.
6. Press **Save**.

You should see the toast *"Saved. New pay pages show your UPI QR code."*, and the
amber *"No UPI ID yet"* strip disappears.

**It does NOT go in `backend/.env`, `frontend/.env.local` or any code file.** It is
not a secret or an API key. It is stored in the database, in the `payment` row of
`agent_subscriptions`, under `settings.upi_id`. It is the same kind of value you
would print on a signboard.

If the Payments screen is not working for some reason, the same thing in the
Supabase SQL Editor:

```sql
update public.agent_subscriptions
   set settings = settings || '{"upi_id": "yourname@okaxis", "payee_name": "Pulse Fitness Studio"}'::jsonb
 where agent_key = 'payment'
   and business_id = 'a1b2c3d4-0000-4000-8000-000000000001';
```

### 3. Check it

1. Open any **unpaid** invoice on the Payments screen → **Open Pay Page**.
2. The page now shows a QR code and a **Pay with a UPI app** button.
3. Scan the QR with your phone's UPI app. It should open with the amount filled in
   and **your name** as the receiver. Back out without paying. You cannot pay
   yourself from the same account anyway.

Scanning works even though everything is running on `localhost`. The QR code
holds the `upi://pay` link itself, not a web address, so your phone never needs
to reach your laptop.

### Things to know

- **Old unpaid invoices pick it up automatically.** The UPI link is built when a
  pay page is opened, not when the invoice is issued. Invoices issued before you
  added your UPI ID start showing the QR code straight away.
- **Changing it later changes where unpaid invoices are paid to.** Paid invoices
  are unaffected.
- **The link inside chat points at `localhost:3000`** while you develop, so it only
  opens on the same computer. Once the app is deployed, set
  `PUBLIC_SITE_URL=https://your-domain` in `backend/.env` and restart uvicorn;
  new invoice messages then carry a link that works on the customer's phone.

---

## End of Part 2 — checklist

- [ ] `python scripts\check_payments_api.py` prints `ALL PASS`
- [ ] `npx tsc --noEmit` and `npm run lint` clean
- [ ] UPI ID saved; the pay page shows a QR your phone can read
- [ ] "I've paid" shows as a claim; only **Mark as Paid** makes it paid
- [ ] The booking shows Paid after its invoice is paid

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add backend frontend docs
git commit -m "Wire payments: owner screen, public UPI pay page, real QR codes"
```

That is the Payments Agent. Running and testing it day to day is in
[RUN-AND-TEST.md](../RUN-AND-TEST.md).
