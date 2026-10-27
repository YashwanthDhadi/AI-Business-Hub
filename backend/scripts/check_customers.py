"""
STEP 35: the customers database rules, proven without the LLM.

Every check here is a rule the DATABASE enforces. The script tries to break
each one and expects to be refused. Run from backend/:

    python scripts\\check_customers.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import db, one
from app.repositories import appointments as booking_repo
from app.repositories import businesses
from app.repositories import customer_notes as notes_repo
from app.repositories import customers as customer_repo

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]

failures = 0
made: list[str] = []


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<48} {detail}")


def refused(fn) -> str:
    """Run fn; return the name of the exception it raised, or '' if it did not."""
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        return type(exc).__name__
    return ""


print("\ncustomers")

# ---- 1. dashboard create, with normalisation -------------------------------
first = customer_repo.create(
    bid, {"name": "  Check Customer  ", "phone": "90000 00101", "email": " Check.Customer@Example.COM "}
)
made.append(first["id"])
check("create normalises the phone", first["phone"] == "+919000000101", first["phone"])
check("create normalises the email", first["email"] == "check.customer@example.com", first["email"])
check("create trims the name", first["name"] == "Check Customer", repr(first["name"]))
check("create marks the source", first["source"] == "dashboard", first["source"])

# ---- 2. one record per phone, per email ------------------------------------
check(
    "same phone, different format -> refused",
    refused(lambda: customer_repo.create(bid, {"name": "Dup", "phone": "+91 9000000101"}))
    == "DuplicateCustomer",
)
check(
    "same email, different case -> refused",
    refused(lambda: customer_repo.create(bid, {"name": "Dup", "email": "CHECK.customer@example.com"}))
    == "DuplicateCustomer",
)

# ---- 3. rules the database holds even if Python is skipped -----------------
def refused_by(row: dict, rule: str) -> bool:
    """
    Insert straight into the table, skipping every line of our Python. True
    only if the database refused it with THIS rule - any other error (a typo,
    a dead connection) must not count as a pass.
    """
    try:
        db.table("customers").insert({"business_id": bid, **row}).execute()
    except Exception as exc:  # noqa: BLE001
        return rule in str(exc)
    return False


check("raw insert, phone '98765 43210' -> refused",
      refused_by({"name": "x", "phone": "98765 43210"}, "customers_phone_format"))
check("raw insert, email 'Mixed@Case.com' -> refused",
      refused_by({"name": "x", "email": "Mixed@Case.com"}, "customers_email_format"))
check("raw insert, nothing identifying -> refused",
      refused_by({"name": "  "}, "customers_identifiable"))
check("raw insert, status 'vip' -> refused",
      refused_by({"name": "x", "status_override": "vip"}, "customers_status_override_values"))

# ---- 4. consent: chat can opt out, only the dashboard can opt in -----------
out = customer_repo.set_marketing_consent(
    business_id=bid, customer_id=first["id"], consent="opted_out", source="chat"
)
check("chat opt-out -> recorded", out["marketing_consent"] == "opted_out")
check(
    "chat opt-in -> refused BY THE DATABASE",
    refused(
        lambda: customer_repo.set_marketing_consent(
            business_id=bid, customer_id=first["id"], consent="opted_in", source="chat"
        )
    )
    == "InvalidCustomer",
)
owner = customer_repo.set_marketing_consent(
    business_id=bid, customer_id=first["id"], consent="opted_in", source="dashboard"
)
check("dashboard opt-in -> recorded", owner["marketing_consent"] == "opted_in")

# ---- 5. chat fills blanks, never overwrites --------------------------------
chat = customer_repo.upsert_from_chat(business_id=bid, name="Someone Else", phone="9000000101")
check("chat with a known phone -> same record", chat["id"] == first["id"])
check("chat did NOT rename them", customer_repo.get(bid, first["id"])["name"] == "Check Customer")

# ---- 6. calculated status, spend and last visit ----------------------------
view = customer_repo.get_overview(bid, first["id"])
check("no bookings -> lead", view["status"] == "lead", view["status"])

past = (datetime.now(timezone.utc) - timedelta(days=3)).replace(minute=0, second=0, microsecond=0)
visit = booking_repo.create(
    business_id=bid, customer_id=first["id"], starts_at_utc=past,
    duration_minutes=60, service_name="Check Visit", price=1500.0, status="confirmed",
)
booking_repo.set_status(business_id=bid, appointment_id=visit["id"], status="completed")
view = customer_repo.get_overview(bid, first["id"])
check("completed visit 3 days ago -> active", view["status"] == "active", view["status"])
check("spend = the booking's snapshot price", float(view["completed_spend"]) == 1500.0, view["completed_spend"])
check("last visit is set", bool(view["last_visit_date"]), view["last_visit_date"])

customer_repo.update(bid, first["id"], {"status_override": "inactive"})
check("owner override wins", customer_repo.get_overview(bid, first["id"])["status"] == "inactive")
customer_repo.update(bid, first["id"], {"status_override": "auto"})
check("'auto' goes back to calculated", customer_repo.get_overview(bid, first["id"])["status"] == "active")

print("\ncustomer_notes")

# ---- 7. notes: append, no repeats, no cross-tenant -------------------------
note = notes_repo.add(business_id=bid, customer_id=first["id"], body="Prefers morning sessions", kind="preference")
check("note added", note["author"] == "agent", note["body"])
check(
    "same note, different case/spaces -> AlreadyNoted",
    refused(
        lambda: notes_repo.add(
            business_id=bid, customer_id=first["id"], body="  prefers   MORNING sessions ", kind="preference"
        )
    )
    == "AlreadyNoted",
)
check(
    "two-letter note -> InvalidNote",
    refused(lambda: notes_repo.add(business_id=bid, customer_id=first["id"], body="ok")) == "InvalidNote",
)
other_business = "00000000-0000-4000-8000-000000000000"
try:
    db.table("customer_notes").insert(
        {"business_id": other_business, "customer_id": first["id"], "body": "Cross tenant"}
    ).execute()
    cross_tenant = ""
except Exception as exc:  # noqa: BLE001
    cross_tenant = str(exc)
# 23503 is Postgres's foreign-key violation code.
check("note for this customer under ANOTHER business -> refused", "23503" in cross_tenant)
check("list_for_customer finds it", len(notes_repo.list_for_customer(bid, first["id"])) == 1)

# ---- clean up ---------------------------------------------------------------
# Deleting the customer cascades to their bookings and notes.
for customer_id in made:
    db.table("customers").delete().eq("business_id", bid).eq("id", customer_id).execute()
left = one(db.table("customers").select("id").eq("id", first["id"]).execute())
check("cleaned up (customer, booking and note gone)", left is None)

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
