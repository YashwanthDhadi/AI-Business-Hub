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
