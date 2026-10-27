"""
The bookings repository, proven against the real database. No LLM.

This script used to PRINT its results and always exit 0 - including the line
"double : NOT BLOCKED <-- the unique index is missing". The unique index could
have been dropped and the script would still have reported success. It now
asserts every result, so a missing constraint fails the run.

Run from backend/:  python scripts\\check_bookings.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

from app.config import settings
from app.repositories import appointments as booking_repo
from app.repositories import businesses, customers

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<50} {detail}")


business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]
person = customers.upsert_from_chat(business_id=bid, name="Test Customer", phone="9000000001")

slot = (datetime.now(timezone.utc) + timedelta(days=3)).replace(minute=0, second=0, microsecond=0)
made: list[dict] = []

try:
    print("\ncreating")
    created = booking_repo.create(
        business_id=bid, customer_id=person["id"], starts_at_utc=slot,
        duration_minutes=60, service_name="Personal Training", price=750.0,
    )
    made.append(created)
    check("a booking is created", bool(created.get("id")), created["id"][:8].upper())
    check("it starts as pending", created["status"] == "pending", created["status"])
    check("the service name is kept", created["service_name"] == "Personal Training")
    check("the price is snapshotted", float(created["price"]) == 750.0, created["price"])

    print("\nthe double-booking guard")
    # The same slot again must be refused by the DATABASE, not by Python - so
    # that a second server, or a direct SQL insert, is refused too.
    blocked = False
    try:
        clash = booking_repo.create(
            business_id=bid, customer_id=person["id"], starts_at_utc=slot,
            duration_minutes=60, service_name="Clashing Booking", price=100.0,
        )
        made.append(clash)
    except booking_repo.SlotTaken:
        blocked = True
    check("the same slot twice is refused by the database", blocked,
          "SlotTaken" if blocked else "NOT BLOCKED - the unique index is missing")

    print("\nreading it back")
    found = booking_repo.find_by_reference(bid, created["id"][:8].upper())
    check("found by its 8-character reference", (found or {}).get("id") == created["id"],
          (found or {}).get("service_name"))
    check("a wrong reference finds nothing",
          booking_repo.find_by_reference(bid, "ZZZZZZZZ") is None)

    busy = booking_repo.booked_between(bid, slot - timedelta(hours=1), slot + timedelta(hours=1))
    check("it occupies its hour", any(b["id"] == created["id"] for b in busy), f"{len(busy)} in window")

    far = booking_repo.booked_between(bid, slot + timedelta(days=200), slot + timedelta(days=201))
    check("an empty window is empty", far == [], len(far))

    check("it counts as pending", booking_repo.pending_count(bid) >= 1, booking_repo.pending_count(bid))

    print("\ncancelling frees the slot")
    booking_repo.set_status(business_id=bid, appointment_id=created["id"], status="cancelled")
    check("status is cancelled", booking_repo.get(bid, created["id"])["status"] == "cancelled")

    again = booking_repo.create(
        business_id=bid, customer_id=person["id"], starts_at_utc=slot,
        duration_minutes=60, service_name="Rebooked After Cancel", price=750.0,
    )
    made.append(again)
    check("the freed slot can be booked again", again["status"] == "pending", again["id"][:8].upper())

    print("\nanother business cannot see it")
    other = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
    fake_bid = "00000000-0000-4000-8000-000000000000"
    check("get() under another business_id returns nothing",
          booking_repo.get(fake_bid, again["id"]) is None)
    check("find_by_reference under another business_id returns nothing",
          booking_repo.find_by_reference(fake_bid, again["id"][:8].upper()) is None)

finally:
    for row in made:
        try:
            booking_repo.set_status(business_id=bid, appointment_id=row["id"], status="cancelled")
        except Exception:  # noqa: BLE001
            pass
    print("\ncleaned up")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
