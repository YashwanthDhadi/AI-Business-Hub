"""
The one rule the whole product rests on: business A can never reach business
B's data.

Two sandbox businesses are built with DELIBERATELY DISTINCTIVE data, then
every read path is driven as A while asking for B's rows. The test is not
"did it return 404" - a 500, a crash or an empty list would also look like a
pass. Every check asserts on the DATA THAT CAME BACK: A's own rows are there,
and B's marker strings appear nowhere in the response.

This matters more here than in most systems, because the service_role key
BYPASSES row-level security. Isolation is enforced by application code
filtering business_id on every query, so it is exactly the kind of guarantee
that one forgotten .eq() silently removes.

Needs the server running.  Run from backend/:
    python scripts\\check_tenant_isolation.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

import httpx

from app.config import settings
from app.repositories import appointments as booking_repo
from app.repositories import conversations
from app.repositories import customers as customer_repo
from app.repositories import documents as document_repo
from app.repositories import inventory as inventory_repo
from app.repositories import invoices as invoice_repo
from sandbox import create_sandbox, destroy_sandbox

API = "http://127.0.0.1:8000/api/v1/dashboard"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<56} {detail}")


# Marker strings that could only have come from the other business.
A_MARK = "AAA-ALPHA-ONLY"
B_MARK = "ZZZ-BRAVO-SECRET"

alpha = create_sandbox("iso-alpha")
bravo = create_sandbox("iso-bravo")
a_id, b_id = alpha["id"], bravo["id"]

a_client = httpx.Client(timeout=30, headers={"X-Dashboard-Key": settings.dashboard_api_key},
                        params={"business_id": a_id})


def seed(business_id: str, mark: str) -> dict:
    """One row of every kind, all carrying the marker."""
    person = customer_repo.upsert_from_chat(
        business_id=business_id, name=f"{mark} Customer",
        phone="9000000001" if mark == A_MARK else "9000000002",
    )
    slot = (datetime.now(timezone.utc) + timedelta(days=5)).replace(minute=0, second=0, microsecond=0)
    booking = booking_repo.create(
        business_id=business_id, customer_id=person["id"], starts_at_utc=slot,
        duration_minutes=60, service_name=f"{mark} Service", price=1234.0,
    )
    item = inventory_repo.create(business_id, {"name": f"{mark} Item", "unit": "pcs"}, quantity=7)
    document = document_repo.create(
        business_id,
        {"title": f"{mark} Policy", "content": f"The secret policy text {mark}.",
         "is_public": True},
    )
    invoice = invoice_repo.create(
        business_id=business_id, customer_id=person["id"],
        items=[{"description": f"{mark} Line", "quantity": 1, "unit_price": 1234.0}],
        due_date=(datetime.now(timezone.utc) + timedelta(days=7)).date(),
    )
    conversation = conversations.create(business_id, channel="web")
    conversations.add_message(
        business_id=business_id, conversation_id=conversation["id"],
        author="customer", body=f"my secret message {mark}", direction="inbound",
    )
    return {"customer": person, "booking": booking, "item": item,
            "document": document, "invoice": invoice, "conversation": conversation}


try:
    print("\nseeding two businesses")
    a = seed(a_id, A_MARK)
    b = seed(b_id, B_MARK)
    check("both businesses have data", bool(a["invoice"] and b["invoice"]),
          f"A={a_id[:8]} B={b_id[:8]}")

    # ---------------------------------------------------- list endpoints
    # A list endpoint leaking is the worst case: it hands over everything at
    # once. So each one is checked for A's marker present and B's absent.
    print("\nlist endpoints, called as A")
    LISTS = [
        ("customers", "/customers"),
        ("bookings", "/bookings"),
        ("inventory", "/inventory"),
        ("documents", "/documents"),
        ("invoices", "/payments/invoices"),
        ("conversations", "/conversations"),
    ]
    for name, path in LISTS:
        response = a_client.get(f"{API}{path}")
        body = response.text
        check(f"GET {path:<22} returns 200", response.status_code == 200, response.status_code)
        check(f"GET {path:<22} contains A's own row", A_MARK in body,
              "" if A_MARK in body else "A cannot see its OWN data")
        check(f"GET {path:<22} contains NOTHING of B's", B_MARK not in body,
              "LEAK" if B_MARK in body else "")

    # ------------------------------------------------ fetch B's row by id
    # The direct attack: a valid key, a real row id, the wrong business.
    print("\nfetching B's rows by id, as A")
    BY_ID = [
        ("customer", f"/customers/{b['customer']['id']}"),
        ("inventory item", f"/inventory/{b['item']['id']}"),
        ("document", f"/documents/{b['document']['id']}"),
        ("invoice", f"/payments/invoices/{b['invoice']['id']}"),
        ("conversation", f"/conversations/{b['conversation']['id']}"),
    ]
    for name, path in BY_ID:
        response = a_client.get(f"{API}{path}")
        check(f"GET B's {name:<16} is refused", response.status_code in {404, 403},
              response.status_code)
        check(f"GET B's {name:<16} body has no B data", B_MARK not in response.text,
              "LEAK" if B_MARK in response.text else "")

    # ----------------------------------------------- writing to B's rows
    print("\nwriting to B's rows, as A")
    edit = a_client.patch(f"{API}/inventory/{b['item']['id']}", json={"name": "HIJACKED"})
    check("PATCH B's inventory item is refused", edit.status_code in {404, 403}, edit.status_code)
    after = inventory_repo.get(b_id, b["item"]["id"])
    check("B's item is genuinely unchanged in the database",
          after and after["name"] == f"{B_MARK} Item", (after or {}).get("name"))

    adjust = a_client.post(f"{API}/inventory/{b['item']['id']}/adjust",
                           json={"delta": -5, "reason": "correction"})
    # A 422 here would mean the payload was malformed and validation refused it
    # BEFORE the tenant check - which proves nothing about isolation.
    check("adjusting B's stock is refused by the tenant check, not validation",
          adjust.status_code in {404, 403}, adjust.status_code)
    after = inventory_repo.get(b_id, b["item"]["id"])
    check("B's quantity is genuinely unchanged", after and int(after["quantity"]) == 7,
          (after or {}).get("quantity"))

    decide = a_client.post(f"{API}/bookings/{b['booking']['id']}/decision",
                           json={"decision": "approve"})
    check("approving B's booking is refused", decide.status_code in {404, 403}, decide.status_code)
    still = booking_repo.get(b_id, b["booking"]["id"])
    check("B's booking is still pending", still and still["status"] == "pending",
          (still or {}).get("status"))

    paid = a_client.post(f"{API}/payments/invoices/{b['invoice']['id']}/mark-paid",
                         json={"method": "cash"})
    check("marking B's invoice paid is refused", paid.status_code in {404, 403}, paid.status_code)
    unpaid = invoice_repo.get(b_id, b["invoice"]["id"])
    check("B's invoice is still pending", unpaid and unpaid["status"] == "pending",
          (unpaid or {}).get("status"))

    # ------------------------------------------------- search and reports
    print("\nsearch and reports")
    # Full-text search is a classic leak: the filter is easy to forget when
    # the query is doing something clever.
    hits = document_repo.search(a_id, "secret policy")
    check("document search returns only A's documents",
          all(B_MARK not in str(row) for row in hits), f"{len(hits)} hits")

    found = a_client.get(f"{API}/documents", params={"business_id": a_id, "q": "secret"})
    check("document search over HTTP leaks nothing", B_MARK not in found.text,
          "LEAK" if B_MARK in found.text else "")

    report = a_client.get(f"{API}/reports", params={"business_id": a_id, "days": 30})
    check("A's report is only A's money", report.status_code == 200 and B_MARK not in report.text,
          report.status_code)

    # A's report must not count B's invoice. Both businesses issued exactly
    # one invoice of 1234, so a leak would show 2.
    issued = report.json().get("summary", {}).get("invoicesIssued")
    check("A's report counts ONE invoice, not two", int(issued or 0) == 1, issued)

    # ------------------------------------------------ repository level
    # Below HTTP, so a future route calling these directly is covered too.
    print("\nrepository level")
    check("customers.get across tenants is None",
          customer_repo.get(a_id, b["customer"]["id"]) is None)
    check("invoices.get across tenants is None",
          invoice_repo.get(a_id, b["invoice"]["id"]) is None)
    check("inventory.get across tenants is None",
          inventory_repo.get(a_id, b["item"]["id"]) is None)
    check("documents.get across tenants is None",
          document_repo.get(a_id, b["document"]["id"]) is None)
    check("bookings.get across tenants is None",
          booking_repo.get(a_id, b["booking"]["id"]) is None)
    check("a booking reference from B does not resolve for A",
          booking_repo.find_by_reference(a_id, b["booking"]["id"][:8].upper()) is None)

    # The phone number is the same shape in both businesses. Looking up B's
    # customer by phone as A must create or find A's own, never B's row.
    print("\nidentity lookups do not cross")
    mine = customer_repo.upsert_from_chat(business_id=a_id, name="Someone", phone="9000000002")
    check("the same phone in two businesses is two separate customers",
          mine["id"] != b["customer"]["id"], f"{mine['id'][:8]} vs {b['customer']['id'][:8]}")
    check("and it belongs to A", mine["business_id"] == a_id)

finally:
    a_client.close()
    destroy_sandbox(alpha)
    destroy_sandbox(bravo)
    print("\nboth sandboxes removed")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
