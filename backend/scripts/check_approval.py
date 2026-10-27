"""
STEP 31: the owner approval flow, over HTTP, with no LLM involved.

This is the OWNER GATE, so it is the most security-relevant script here: it
proves a booking made from a chat stays pending until a human decides, and
that it cannot be decided twice. It used to print those results without
asserting them and always exit 0; every result is now enforced.

Seeds a booking through the booking tool directly (which needs no model), then
drives the dashboard endpoints the way the browser does. Run from backend/ with
the server already running.
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta

import httpx

from app.agents.tools import booking_tools
from app.agents.tools.support_tools import AgentContext
from app.config import settings
from app.repositories import appointments as booking_repo
from app.repositories import businesses, conversations

API = "http://127.0.0.1:8000/api/v1/dashboard"

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]
client = httpx.Client(
    timeout=30,
    headers={"X-Dashboard-Key": settings.dashboard_api_key},
    params={"business_id": bid},
)


failures = 0


def line(label: str, value: object) -> None:
    print(f"{label:<26}: {value}")


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<48} {detail}")


# ---- seed: a real conversation, then a booking made through the tool --------
conversation = conversations.create(bid, channel="web")
ctx = AgentContext(business_id=bid, conversation_id=conversation["id"], business=business)
tools = {t.name: t for t in booking_tools.build_tools(ctx)}

# Three weeks out, so we never clash with data left by an earlier run.
day = (datetime.now(ctx.tz) + timedelta(days=21)).date().isoformat()


def seed(clock: str) -> dict:
    made = tools["request_booking"].invoke(
        {
            "service_name": "Personal Training",
            "starts_at": f"{day}T{clock}",
            "customer_name": "Approval Test",
            "customer_phone": "9000000002",
        }
    )
    if not made.get("booked"):
        print("could not seed a booking:", made)
        sys.exit(1)
    return booking_repo.find_by_reference(bid, made["reference"])


first = seed("11:00")
booking_id = first["id"]
line("seeded", f"{first['id'][:8].upper()} {first['status']} {day} 11:00")
check("a booking made from a chat starts PENDING", first["status"] == "pending", first["status"])

# ---- 1. the list the bookings screen reads ---------------------------------
print("\nthe bookings screen")
listed = client.get(f"{API}/bookings").json()
mine = next((b for b in listed["bookings"] if b["id"] == booking_id), None)
check("the seeded booking appears in GET /bookings", mine is not None,
      f"{len(listed['bookings'])} rows, {listed['pending']} pending")
if mine is None:
    print("\n1 FAILED - nothing further can be checked")
    sys.exit(1)

check("the row is shaped for the screen",
      all(mine.get(k) for k in ("reference", "serviceName", "date", "time")),
      f"{mine['reference']} {mine['serviceName']} {mine['date']} {mine['time']}")
check("the customer is attached", bool(mine.get("customerName")),
      f"{mine['customerName']} / {mine['customerPhone']} / Rs {mine['price']}")
check("the pending count includes it", listed["pending"] >= 1, listed["pending"])
# The column is `source` (booking_source, not null default 'customer_chat').
# The screen reads it as bookedVia, which is where it is worth checking - the
# repository's select does not return it.
check("it is recorded as coming from a chat",
      mine.get("bookedVia") in {"customer_chat", "chat"}, mine.get("bookedVia"))

# ---- 2. approve it, and check the customer was told -------------------------
print("\napproving")
approved = client.post(
    f"{API}/bookings/{booking_id}/decision",
    json={"decision": "approve", "note": "See you then!", "decided_by": "owner"},
)
body = approved.json()
check("approve returns 200", approved.status_code == 200, approved.status_code)
check("the booking is now confirmed", body["booking"]["status"] == "confirmed",
      body["booking"]["status"])
check("the customer was notified", body["customer_notified"] is True)

messages = conversations.messages_for(bid, conversation["id"])
last = messages[-1] if messages else {}
check("a message was posted into the conversation", bool(last.get("body")),
      repr(last.get("body", "")[:80]))
check("the note the owner typed reaches the customer", "See you then!" in last.get("body", ""))
check("it is an outbound system message",
      last.get("author") == "system" and last.get("direction") == "outbound",
      f"{last.get('author')} / {last.get('direction')}")

# ---- 3. the gate: a booking can only be decided once ------------------------
print("\nthe gate")
again = client.post(f"{API}/bookings/{booking_id}/decision", json={"decision": "reject"})
check("deciding twice is refused", again.status_code == 409,
      f"{again.status_code} {again.json().get('detail', '')[:60]}")
check("the second decision did not change the status",
      client.get(f"{API}/bookings").json() and
      next(b for b in client.get(f"{API}/bookings").json()["bookings"]
           if b["id"] == booking_id)["status"] == "confirmed")

bad = client.post(f"{API}/bookings/{booking_id}/decision", json={"decision": "maybe"})
check("an invented decision is refused", bad.status_code in {400, 422},
      f"{bad.status_code} {str(bad.json().get('detail', ''))[:60]}")

# ---- 4. the other status moves ----------------------------------------------
print("\nstatus moves")
done = client.post(f"{API}/bookings/{booking_id}/status", json={"status": "completed"})
check("confirmed -> completed", done.status_code == 200 and
      done.json()["booking"]["status"] == "completed", done.status_code)

nonsense = client.post(f"{API}/bookings/{booking_id}/status", json={"status": "teleported"})
check("an invented status is refused", nonsense.status_code in {400, 422},
      f"{nonsense.status_code} {str(nonsense.json().get('detail', ''))[:50]}")

# ---- 5. the reject path, on a second booking --------------------------------
print("\nrejecting")
second = seed("12:00")
rejected = client.post(
    f"{API}/bookings/{second['id']}/decision",
    json={"decision": "reject", "note": "Our trainer is off that day."},
)
check("reject returns 200", rejected.status_code == 200, rejected.status_code)
check("the booking is cancelled", rejected.json()["booking"]["status"] == "cancelled",
      rejected.json()["booking"]["status"])
rejection = conversations.messages_for(bid, conversation["id"])[-1]["body"]
check("the reason reaches the customer", "trainer is off" in rejection, repr(rejection[:80]))

# ---- 6. the guards ----------------------------------------------------------
print("\nthe guards")
missing = client.post(
    f"{API}/bookings/00000000-0000-0000-0000-000000000000/decision",
    json={"decision": "approve"},
)
check("an unknown booking is 404", missing.status_code == 404,
      f"{missing.status_code} {missing.json().get('detail', '')[:40]}")

naked = httpx.get(f"{API}/bookings", params={"business_id": bid}, timeout=30)
check("no dashboard key is 401", naked.status_code == 401,
      f"{naked.status_code} {naked.json().get('detail', '')[:45]}")

# The tenant check that matters: a real key, but someone else's business id.
other_bid = "00000000-0000-4000-8000-000000000000"
crossed = httpx.post(
    f"{API}/bookings/{booking_id}/decision",
    params={"business_id": other_bid},
    headers={"X-Dashboard-Key": settings.dashboard_api_key},
    json={"decision": "approve"},
    timeout=30,
)
check("deciding another business's booking is refused", crossed.status_code == 404,
      crossed.status_code)

# ---- 7. the numbers on the dashboard ----------------------------------------
print("\nthe dashboard numbers")
stats = client.get(f"{API}/stats").json()
check("bookingsFromChat is counted", int(stats.get("bookingsFromChat") or 0) >= 1,
      stats.get("bookingsFromChat"))
check("pendingBookings is a number", stats.get("pendingBookings") is not None,
      stats.get("pendingBookings"))

# ---- clean up ---------------------------------------------------------------
for row_id in (booking_id, second["id"]):
    booking_repo.set_status(business_id=bid, appointment_id=row_id, status="cancelled")
print("\ncleaned up")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
