"""
STEP 30 fix: the agent is never handed more than three free slots.

Found while running STEP 30 against the live model: asked for "tomorrow
evening", it read out all eleven free times even though the tool result said
"offer at most three". This checks the fix without calling the LLM:

  1. check_availability returns at most three slots
  2. preferred_time picks the three nearest the time the customer asked for
  3. a time that was NOT among the three can still be booked, because
     request_booking validates against the full list

Run from backend/:  python scripts\\check_slot_offer.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta

from app.agents.tools import booking_tools
from app.agents.tools.support_tools import AgentContext
from app.config import settings
from app.repositories import appointments as booking_repo
from app.repositories import businesses, conversations

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]
conversation = conversations.create(bid, channel="web")
ctx = AgentContext(business_id=bid, conversation_id=conversation["id"], business=business)
tools = {t.name: t for t in booking_tools.build_tools(ctx)}

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<44} {detail}")


# Find an open day with plenty of free slots, three to four weeks out so we
# do not collide with anything a person booked by hand.
start = datetime.now(ctx.tz).date() + timedelta(days=22)
day, full = None, []
for offset in range(7):
    candidate = (start + timedelta(days=offset)).isoformat()
    raw = booking_tools._check_availability(ctx, candidate, "Personal Training")
    if len(raw.get("free_slots") or []) > 6:
        day, full = candidate, raw["free_slots"]
        break

if day is None:
    print("No open day with more than six free slots in the next month - cannot test.")
    sys.exit(1)

print(f"\nday {day}: {len(full)} free slots in the database, {full[0]} to {full[-1]}\n")

# ---- 1. no preferred time: the first three, and a count of the rest --------
plain = tools["check_availability"].invoke({"date": day, "service_name": "Personal Training"})
check("no preference: at most three", len(plain["free_slots"]) <= 3, plain["free_slots"])
check("no preference: says how many more", plain.get("more_free_slots") == len(full) - 3,
      f"more_free_slots={plain.get('more_free_slots')}")

# ---- 2. preferred_time: the three nearest ----------------------------------
late = full[-1]
near = tools["check_availability"].invoke(
    {"date": day, "service_name": "Personal Training", "preferred_time": late}
)
check("preferred last slot: at most three", len(near["free_slots"]) <= 3, near["free_slots"])
check("preferred last slot: it is included", late in near["free_slots"])
check("preferred last slot: none are from the start", full[0] not in near["free_slots"])

junk = tools["check_availability"].invoke(
    {"date": day, "service_name": "Personal Training", "preferred_time": "evening"}
)
check("preferred_time='evening' does not crash", "error" not in junk, junk["free_slots"])

# ---- 3. a slot outside the offered three is still bookable -----------------
outside = next(slot for slot in full if slot not in plain["free_slots"])
made = tools["request_booking"].invoke(
    {
        "service_name": "Personal Training",
        "starts_at": f"{day}T{outside}",
        "customer_name": "Slot Offer Test",
        "customer_phone": "9000000003",
    }
)
check(f"book {outside} (not in the three offered)", bool(made.get("booked")),
      made.get("status") or made.get("error"))

# ---- clean up ---------------------------------------------------------------
if made.get("booked"):
    row = booking_repo.find_by_reference(bid, made["reference"])
    booking_repo.set_status(business_id=bid, appointment_id=row["id"], status="cancelled")
    print("\ncleaned up")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
