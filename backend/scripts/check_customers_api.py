"""
STEP 39: the customers dashboard API over HTTP, with no LLM.

Drives the routes the way the browser does and checks every refusal. Run from
backend/ with the server already running:

    python scripts\\check_customers_api.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.config import settings
from app.db import db
from app.repositories import businesses
from app.repositories import customer_notes as notes_repo

API = "http://127.0.0.1:8000/api/v1/dashboard/customers"
OTHER_BUSINESS = "00000000-0000-4000-8000-000000000000"

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]
client = httpx.Client(
    timeout=30,
    headers={"X-Dashboard-Key": settings.dashboard_api_key},
    params={"business_id": bid},
)

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<44} {detail}")


def detail_of(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", ""))[:60]
    except ValueError:
        return response.text[:60]


# ---- 1. the list ---------------------------------------------------------------
print("\nlist")
listed = client.get(API)
rows = listed.json().get("customers", []) if listed.status_code == 200 else []
check("GET /customers -> 200", listed.status_code == 200, f"{len(rows)} customers")
wanted = {"id", "name", "phone", "email", "status", "statusIsAutomatic", "totalSpend",
          "lastVisit", "bookingsCount", "upcomingCount", "marketingConsent", "source"}
missing = sorted(wanted - set(rows[0])) if rows else sorted(wanted)
check("rows have the Customer shape", not missing, missing or "all fields present")

# ---- 2. create, and the refusals ----------------------------------------------
print("\ncreate")
made = client.post(
    API,
    json={"name": "Api Check", "phone": "90000 00404", "email": "Api.Check@Example.com",
          "preferred_channel": "whatsapp"},
)
created = made.json().get("customer", {}) if made.status_code == 201 else {}
cid = created.get("id", "")
check("POST -> 201", made.status_code == 201, made.status_code)
check("  phone normalised", created.get("phone") == "+919000000404", created.get("phone"))
check("  email lowercased", created.get("email") == "api.check@example.com", created.get("email"))
check("  new customer is a lead, automatically",
      created.get("status") == "lead" and created.get("statusIsAutomatic") is True, created.get("status"))
check("  source is dashboard", created.get("source") == "dashboard", created.get("source"))

dup = client.post(API, json={"name": "Dup", "phone": "+91 9000000404"})
check("same phone -> 409", dup.status_code == 409, detail_of(dup))
bad = client.post(API, json={"name": "Bad", "phone": "12345"})
check("bad phone -> 400", bad.status_code == 400, detail_of(bad))
empty = client.post(API, json={"name": "   "})
check("nothing identifying -> 400", empty.status_code == 400, detail_of(empty))
vip = client.post(API, json={"name": "Vip", "status": "vip"})
check("status 'vip' -> 400", vip.status_code == 400, detail_of(vip))

# ---- 3. edits -------------------------------------------------------------------
print("\nedit")
noted = client.patch(f"{API}/{cid}", json={"notes": "Wants a locker near the door"})
check("PATCH notes -> saved", noted.json().get("customer", {}).get("notes") == "Wants a locker near the door")
check("  ...phone untouched", noted.json().get("customer", {}).get("phone") == "+919000000404")

forced = client.patch(f"{API}/{cid}", json={"status": "active"}).json().get("customer", {})
check("PATCH status active -> set by owner",
      forced.get("status") == "active" and forced.get("statusIsAutomatic") is False)
auto = client.patch(f"{API}/{cid}", json={"status": "auto"}).json().get("customer", {})
check("PATCH status auto -> calculated again",
      auto.get("status") == "lead" and auto.get("statusIsAutomatic") is True)

opted = client.patch(f"{API}/{cid}", json={"marketing_consent": "opted_in"}).json().get("customer", {})
check("owner opt-in -> allowed",
      opted.get("marketingConsent") == "opted_in" and opted.get("consentSource") == "dashboard",
      f"{opted.get('marketingConsent')} via {opted.get('consentSource')}")

# ---- 4. the profile -------------------------------------------------------------
print("\nprofile")
notes_repo.add(business_id=bid, customer_id=cid, body="Prefers evening sessions", kind="preference")
profile = client.get(f"{API}/{cid}")
body = profile.json() if profile.status_code == 200 else {}
check("GET /customers/{id} -> 200", profile.status_code == 200)
check("  bookings listed", body.get("bookings") == [], f"{len(body.get('bookings', []))} bookings")
check("  the assistant's note is there",
      [n["body"] for n in body.get("notes", [])] == ["Prefers evening sessions"])
# Follows the `payment` subscription (Guide 4): switched on, the tab is real and
# this new customer simply has no invoices; switched off, it says "not available".
payments_on = businesses.is_agent_active(bid, "payment")
check("  invoices tab follows the payment subscription",
      body.get("invoices") == [] and body.get("invoicesAvailable") is payments_on,
      "available, none yet" if payments_on else "switched off")

# ---- 5. the guards --------------------------------------------------------------
print("\nguards")
foreign = client.get(f"{API}/{cid}", params={"business_id": OTHER_BUSINESS})
check("another business reads it -> 404", foreign.status_code == 404, detail_of(foreign))
hijack = client.patch(f"{API}/{cid}", params={"business_id": OTHER_BUSINESS}, json={"notes": "hijacked"})
still = client.get(f"{API}/{cid}").json().get("customer", {}).get("notes")
check("another business edits it -> 404", hijack.status_code == 404, detail_of(hijack))
check("  ...and nothing changed", still == "Wants a locker near the door", repr(still))
junk = client.get(f"{API}/not-a-uuid")
check("junk id -> 404, not 500", junk.status_code == 404, junk.status_code)
naked = httpx.get(API, params={"business_id": bid}, timeout=30)
check("no dashboard key -> 401", naked.status_code == 401, detail_of(naked))

# ---- clean up -------------------------------------------------------------------
if cid:
    db.table("customers").delete().eq("business_id", bid).eq("id", cid).execute()
print("\ncleaned up")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
