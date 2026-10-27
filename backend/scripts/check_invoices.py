"""
STEP 43: the invoice rules, proven against the real database, no LLM.

Everything runs inside a throwaway sandbox business (scripts/sandbox.py), so
Pulse Fitness's invoice numbering is never touched. Run from backend/:

    python scripts\\check_invoices.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.db import db, one
from app.repositories import appointments as booking_repo
from app.repositories import customers as customer_repo
from app.repositories import invoices as invoice_repo
from app.services.formatting import rupees, spoken_date
from sandbox import create_sandbox, destroy_sandbox

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<50} {detail}")


def refused_with(rule: str, fn) -> bool:
    """True only if fn raised because of THIS rule - not any error at all."""
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        return rule in str(exc) or getattr(exc, "rule", "") == rule
    return False


def raw_update(invoice_id: str, patch: dict):
    """Straight to the table, skipping the repository's own checks."""
    return lambda: db.table("invoices").update(patch).eq("id", invoice_id).execute()


today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
start = today.year - (1 if today.month < 4 else 0)
fy = f"{start}-{(start + 1) % 100:02d}"
due = today + timedelta(days=7)

sandbox = create_sandbox("invoices")
other = create_sandbox("invoices-other")
bid = sandbox["id"]

try:
    customer = customer_repo.upsert_from_chat(business_id=bid, name="Invoice Check", phone="9000000501")
    stranger = customer_repo.upsert_from_chat(business_id=other["id"], name="Other Business", phone="9000000502")

    def issue(**extra):
        args = {
            "business_id": bid,
            "customer_id": customer["id"],
            "items": [{"description": "Personal Training", "quantity": 1, "unit_price": 9000}],
            "due_date": due,
        }
        args.update(extra)
        return invoice_repo.create(**args)

    print("\nnumbering")
    first = issue(items=[{"description": "Personal Training", "quantity": 1, "unit_price": 9000, "total": 1}])
    check("first number of the financial year", first["invoice_number"] == f"INV/{fy}/0001", first["invoice_number"])
    check("16 characters, the GST limit", len(first["invoice_number"]) == 16)
    check("the DATABASE did the sum (our 'total: 1' ignored)", float(first["amount"]) == 9000.0, first["amount"])
    check("token is 32 random hex characters", bool(re.fullmatch(r"[0-9a-f]{32}", first["public_token"])))

    with ThreadPoolExecutor(max_workers=8) as pool:
        burst = list(pool.map(lambda _: issue()["sequence_number"], range(8)))
    check("8 at the same moment -> 8 different numbers", len(set(burst)) == 8, sorted(burst))
    check("  ...and no gaps", sorted(burst) == list(range(2, 10)))

    print("\nrefusals")
    check("no items", refused_with("invoices_no_items", lambda: issue(items=[])))
    check("quantity 0", refused_with(
        "invoices_bad_item", lambda: issue(items=[{"description": "x", "quantity": 0, "unit_price": 10}])))
    check("due yesterday", refused_with("invoices_due_in_past", lambda: issue(due_date=today - timedelta(days=1))))
    check("prefix too long for 16 characters", refused_with("invoices_number_length", lambda: issue(prefix="PULSE")))
    check("customer of ANOTHER business", refused_with(
        "invoices_customer_same_business", lambda: issue(customer_id=stranger["id"])))
    after = issue()
    check("refusals left no gap in the series", after["sequence_number"] == 10, after["invoice_number"])

    print("\nissued invoices never change")
    check("edit the amount -> refused", refused_with("invoices_immutable", raw_update(first["id"], {"amount": 1})))
    check("edit the items -> refused", refused_with("invoices_immutable", raw_update(first["id"], {"items": []})))
    check("pending -> refunded -> refused", refused_with(
        "invoices_bad_transition", raw_update(first["id"], {"status": "refunded"})))
    check("paid without how/when -> refused", refused_with(
        "invoices_paid_needs_method", raw_update(first["id"], {"status": "paid"})))
    check("notes CAN change", bool(raw_update(first["id"], {"notes": "Thank you!"})().data))

    print("\npaying")
    claimed = invoice_repo.record_customer_report(business_id=bid, invoice_id=first["id"], reference="412345678901")
    check("customer says paid -> still pending", claimed["status"] == "pending", claimed["customer_reference"])
    paid = invoice_repo.mark_paid(business_id=bid, invoice_id=first["id"], method="upi", reference="412345678901")
    check("owner marks paid", paid["status"] == "paid" and paid["paid_method"] == "upi")
    try:
        invoice_repo.mark_paid(business_id=bid, invoice_id=first["id"], method="cash")
        second_payment = "recorded (WRONG)"
    except invoice_repo.NotPending:
        second_payment = "NotPending"
    check("mark paid twice -> the second is not recorded", second_payment == "NotPending", second_payment)
    check("  ...the first payment stands",
          invoice_repo.get(bid, first["id"])["paid_method"] == "upi")
    refunded = invoice_repo.refund(business_id=bid, invoice_id=first["id"], note="Session cancelled")
    check("paid -> refunded", refunded["status"] == "refunded")

    print("\nbookings")
    slot = (datetime.now(timezone.utc) + timedelta(days=3)).replace(minute=0, second=0, microsecond=0)
    booking = booking_repo.create(
        business_id=bid, customer_id=customer["id"], starts_at_utc=slot, duration_minutes=60,
        service_name="Personal Training", price=9000.0, status="confirmed",
    )
    billed = issue(appointment_id=booking["id"])
    check("second invoice for the same booking -> refused", refused_with(
        "invoices_one_live_per_booking", lambda: issue(appointment_id=booking["id"])))
    invoice_repo.mark_paid(business_id=bid, invoice_id=billed["id"], method="cash")
    check("booking shows paid (trigger)", booking_repo.get(bid, booking["id"])["payment_status"] == "paid")

    other_slot = slot + timedelta(hours=2)
    rebill = booking_repo.create(
        business_id=bid, customer_id=customer["id"], starts_at_utc=other_slot, duration_minutes=60,
        service_name="Personal Training", price=9000.0, status="confirmed",
    )
    wrong = issue(appointment_id=rebill["id"], items=[{"description": "Wrong amount", "quantity": 1, "unit_price": 1}])
    invoice_repo.cancel(business_id=bid, invoice_id=wrong["id"], reason="Wrong amount")
    right = issue(appointment_id=rebill["id"])
    check("cancel a wrong invoice, then reissue", right["status"] == "pending", right["invoice_number"])

    print("\nlookups and reminders")
    check("find by pay-page token", (invoice_repo.get_by_token(right["public_token"]) or {}).get("id") == right["id"])
    check("junk token -> nothing, no query", invoice_repo.get_by_token("'; drop table invoices;--") is None)
    check("find by number, typed carelessly", (invoice_repo.get_by_number(
        bid, " " + right["invoice_number"].lower() + " ") or {}).get("id") == right["id"])
    check("another business cannot find it by number",
          invoice_repo.get_by_number(other["id"], right["invoice_number"]) is None)
    check("first reminder allowed", invoice_repo.claim_reminder_slot(business_id=bid, invoice_id=right["id"]))
    check("second within 24 hours -> refused",
          not invoice_repo.claim_reminder_slot(business_id=bid, invoice_id=right["id"]))

    print("\nIndian formatting")
    check("rupees", rupees(120000) == "₹1,20,000", rupees(120000))
    check("rupees with paise", rupees(9000.5) == "₹9,000.50", rupees(9000.5))
    check("spoken date", spoken_date("2026-10-03") == "Sat, 3 Oct 2026", spoken_date("2026-10-03"))

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(other)
    gone = one(db.table("businesses").select("id").eq("id", bid).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
