"""
The reporting numbers, proven against the real database. No LLM.

The point of this script: SQL produces every figure, so the figures can be
checked exactly. Build a known situation - one customer, one completed booking
at a known price, one paid invoice - then assert the totals.

It also checks the thing a report must never do: show one business another
business's money.

Run from backend/:  python scripts\\check_reports.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

from app.db import db, one
from app.repositories import appointments as booking_repo
from app.repositories import conversations
from app.repositories import customers as customer_repo
from app.repositories import inventory as inventory_repo
from app.repositories import invoices as invoice_repo
from app.repositories import reports as report_repo
from app.services import payments as payments_service
from sandbox import create_sandbox, destroy_sandbox

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<54} {detail}")


sandbox = create_sandbox("reports")
other = create_sandbox("reports-other")
bid = sandbox["id"]

try:
    print("\nan empty business")
    empty = report_repo.summary(other["id"], days=30)
    check("every total is zero", all(
        int(empty.get(k) or 0) == 0
        for k in ("conversations", "bookings", "invoices_issued", "new_customers")
    ), {k: empty.get(k) for k in ("conversations", "bookings", "invoices_issued")})
    # NOT `empty.get("collected") or -1`: zero is falsy in Python, so that
    # sentinel trick turns the correct answer (0) into -1 and fails.
    collected = empty.get("collected")
    check("collected is zero, not null",
          collected is not None and float(collected) == 0.0, repr(collected))
    check("90 days of rows exist to chart", len(report_repo.daily(other["id"], days=90)) == 90,
          len(report_repo.daily(other["id"], days=90)))

    print("\na known situation")
    customer = customer_repo.upsert_from_chat(business_id=bid, name="Report Test", phone="9000000901")
    chat = conversations.create(bid, channel="web")
    conversations.attach_customer(bid, chat["id"], customer["id"])

    # A booking two days ago, completed, at a known price.
    when = (datetime.now(timezone.utc) - timedelta(days=2)).replace(minute=0, second=0, microsecond=0)
    booking = booking_repo.create(
        business_id=bid, customer_id=customer["id"], starts_at_utc=when, duration_minutes=60,
        service_name="Personal Training", price=9000.0, status="confirmed",
        conversation_id=chat["id"],
    )
    booking_repo.set_status(business_id=bid, appointment_id=booking["id"], status="completed")

    # One invoice, paid; one invoice, still owed.
    today = payments_service.business_today(sandbox)
    paid = invoice_repo.create(
        business_id=bid, customer_id=customer["id"], due_date=today + timedelta(days=7),
        items=[{"description": "Personal Training", "quantity": 1, "unit_price": 9000}],
    )
    invoice_repo.mark_paid(business_id=bid, invoice_id=paid["id"], method="upi")
    invoice_repo.create(
        business_id=bid, customer_id=customer["id"], due_date=today + timedelta(days=7),
        items=[{"description": "Yoga add-on", "quantity": 1, "unit_price": 600}],
    )

    # One product below its reorder level.
    inventory_repo.create(bid, {"name": "Protein Bar", "reorder_level": 5}, quantity=2)

    figures = report_repo.summary(bid, days=30)
    check("1 conversation", int(figures.get("conversations") or 0) == 1, figures.get("conversations"))
    check("1 booking, and it is counted as completed",
          int(figures.get("bookings") or 0) == 1 and int(figures.get("completed_bookings") or 0) == 1,
          f"{figures.get('bookings')} / {figures.get('completed_bookings')}")
    check("2 invoices issued", int(figures.get("invoices_issued") or 0) == 2, figures.get("invoices_issued"))
    check("collected is the PAID one only", float(figures.get("collected") or 0) == 9000.0,
          figures.get("collected"))
    check("outstanding is the unpaid one only", float(figures.get("outstanding") or 0) == 600.0,
          figures.get("outstanding"))
    check("1 new customer", int(figures.get("new_customers") or 0) == 1, figures.get("new_customers"))
    check("1 product low or out of stock", int(figures.get("low_stock_items") or 0) == 1,
          figures.get("low_stock_items"))

    print("\nday by day")
    days = report_repo.daily(bid, days=30)
    check("30 days, oldest first", len(days) == 30 and days[0]["day"] < days[-1]["day"],
          f"{days[0]['day']} .. {days[-1]['day']}")
    check("the booking lands on ITS day, not today",
          sum(int(d["bookings"] or 0) for d in days) == 1)
    check("the money lands on the day it was marked paid",
          sum(float(d["collected"] or 0) for d in days) == 9000.0)

    print("\nwhat sells most")
    top = report_repo.top_services(bid, days=30)
    check("the service is listed", top and top[0]["service_name"] == "Personal Training",
          [t["service_name"] for t in top])
    check("  ...with its booking count", int(top[0]["bookings"]) == 1 if top else False)
    check("  ...and the price stored ON the booking",
          float(top[0]["revenue"]) == 9000.0 if top else False, top[0]["revenue"] if top else None)

    print("\none business never sees another's money")
    theirs = report_repo.summary(other["id"], days=30)
    check("the other business still shows zero collected",
          float(theirs.get("collected") or 0) == 0.0, theirs.get("collected"))
    check("  ...zero bookings", int(theirs.get("bookings") or 0) == 0)
    check("  ...and no top services", report_repo.top_services(other["id"], days=30) == [])
    check("their daily rows are all empty",
          all(int(d["bookings"] or 0) == 0 for d in report_repo.daily(other["id"], days=30)))

    print("\nthe window is bounded")
    check("asking for 500 days is capped at 90", int(report_repo.summary(bid, days=500)["days"]) == 90,
          report_repo.summary(bid, days=500)["days"])
    check("asking for 0 days is raised to 1", int(report_repo.summary(bid, days=0)["days"]) == 1)

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(other)
    gone = one(db.table("businesses").select("id").eq("id", bid).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
