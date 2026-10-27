# Guide 2, Part 0 — Overview and the database (STEP 26 → STEP 27)

The second agent. A customer opens the **same chat link**, types *"can I book a
personal training session on Friday evening?"*, and gets real free slots from
your database — then the owner approves it.

**Prerequisite:** the Customer Support Agent works end to end. If
`/chat/pulse-fitness` is not answering with real prices yet, finish
[Guide 1](../customer-support-agent/) first.

---

## What you do NOT have to do

This is the payoff for building the first agent properly.

| | |
| --- | --- |
| New accounts | **None.** Same Supabase, same OpenRouter key. |
| New model | **None.** Same `LLM_MODEL`, same fallbacks. |
| New chat UI | **None.** The same `/chat/<slug>` page, untouched. |
| Voice | **Already works.** Speech goes to the same agent, so "book me Friday at six" spoken aloud works the moment booking does. |
| Sessions, rate limits, handoff | **Already work.** Unchanged. |
| Owner inbox | **Already works.** Booking conversations show up there like any other. |

What you actually build: one table, one repository, one toolset, and a change to
how the agent's tools are assembled. Plus wiring the bookings screen that is
already designed and sitting on mock data.

---

## The one genuinely new problem: who answers?

There is **one chat box**. A customer might type a support question or a booking
request, and often both in the same conversation:

> *"What does personal training cost? … ok, can I book one on Friday?"*

So something has to decide which agent handles which message. There are two ways
to do it, and the choice matters.

### Option A — a supervisor that routes

```
customer message
      │
      ▼
  SUPERVISOR  ──  an LLM call: "is this support or booking?"
      │
      ├──► Support Agent   (another LLM call, + tools)
      └──► Booking Agent   (another LLM call, + tools)
```

This is what your original blueprint describes, and it is the right shape
eventually.

**But price it honestly at your current scale.** You measured replies at 3–15
seconds on the free tier. A supervisor adds a whole extra round trip to *every*
message, before any work happens. Doubling the latency of a live chat window to
choose between two options is a bad trade — and it adds a second place where the
free-tier rate limit can bite.

It also handles that mixed example badly: the customer asks a price *and* a
booking in one breath, and a router has to pick one.

### Option B — one agent, composable capabilities (what we build)

```
customer message
      │
      ▼
  ONE agent loop
      │  tools = support tools + booking tools (if the business pays for booking)
      │  prompt = support rules + booking rules
      ▼
  the model picks the right tool itself — that IS the routing
```

The model already chooses between `search_knowledge` and `list_services` every
message. Adding `check_availability` and `request_booking` to the same list is
the same decision with more options, and it costs **zero extra latency**.

Mixed messages work naturally: the model can call `list_services` and then
`check_availability` inside one run.

### So when does the supervisor earn its cost?

When the tool list gets long enough to confuse the model — roughly **past four
or five capabilities**, or 15+ tools. At that point the router pays for itself by
showing each specialist a short, focused tool list.

You are at two capabilities and nine tools. Build the supervisor when Inventory
and Invoice land, not now. The guide's last page says exactly what that refactor
looks like, and today's design is built to make it easy.

---

## Architecture after this guide

```
  Customer's chat  (unchanged)
        │
        ▼
  FastAPI  /api/v1/chat/message
        │
        ▼
  assistant.run()
        │  capabilities assembled per business subscription
        │
        ├── customer_support   search_knowledge, get_business_info,
        │                      list_services, save_contact_details,
        │                      escalate_to_human
        │
        └── booking            check_availability, request_booking,
                               get_my_bookings, cancel_booking
        │
        ▼
  Supabase: appointments (status = pending until the owner approves)
        │
        ▼
  Owner dashboard  /dashboard/bookings  →  Approve / Reject
        │
        ▼
  The confirmation appears in the customer's chat thread
```

---

## STEP 26 — The appointments table

### Goal

One table that stores every booking, with the shape the frontend's `Booking`
type already expects.

### Why?

Booking is the first capability that **writes something a business will act on**.
Support agent writes were low-stakes: a conversation, a callback request. If it
got one wrong, someone reads a slightly odd note.

A booking is different. Get it wrong and a trainer waits for a customer who is
not coming, or two people arrive for the same slot. That changes three things:

1. **Price is snapshotted.** The service price today is not the price next month,
   and a booking must remember what was quoted.
2. **Nothing is confirmed by the AI.** Bookings land as `pending` and a human
   approves them — the blueprint's confirmation gate, applied where it matters.
3. **Double-booking must be impossible.** Two customers asking for 6 PM at the
   same moment is not hypothetical on a public chat link.

### Architecture

```
          businesses
              │
   ┌──────────┼───────────────┬──────────────┐
   ▼          ▼               ▼              ▼
customers  business_services  conversations  agent_subscriptions
   │          │               │              (agent_key='booking')
   └────┬─────┴───────┬───────┘
        ▼             ▼
            appointments
     status: pending → confirmed
                     ↘ cancelled
```

### Files involved

```
database/
└── migrations/
    └── 002_booking_agent.sql     ← create
```

### Code

Create `database/migrations/002_booking_agent.sql`:

```sql
-- ============================================================================
-- 002_booking_agent.sql
-- Appointments for the Booking Agent.
-- Run once, in the Supabase SQL Editor. Never edit after it has been applied.
-- ============================================================================

-- ---------------------------------------------------------------- enum types
do $$ begin
  create type booking_state  as enum ('pending', 'confirmed', 'cancelled', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_source as enum ('customer_chat', 'dashboard', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_state  as enum ('unpaid', 'paid', 'refunded');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------- appointments
create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses        (id) on delete cascade,
  customer_id     uuid not null references public.customers         (id) on delete cascade,
  service_id      uuid references public.business_services          (id) on delete set null,
  -- The chat this came from, so the confirmation can be posted back into it.
  conversation_id uuid references public.conversations             (id) on delete set null,

  -- Always UTC. The customer says "6 PM"; the database stores 12:30Z.
  starts_at        timestamptz not null,
  duration_minutes int  not null default 30,

  -- Snapshot, NOT a join. The service price may change after the booking is
  -- made, and the customer was quoted today's number.
  price            numeric(12,2) not null default 0,
  service_name     text not null default '',

  status          booking_state  not null default 'pending',
  payment_status  payment_state  not null default 'unpaid',
  source          booking_source not null default 'customer_chat',

  staff_assigned  text,
  notes           text not null default '',

  -- Filled when a human approves or rejects.
  decided_at      timestamptz,
  decided_by      text,
  decision_note   text not null default '',

  created_at      timestamptz not null default now()
);

create index if not exists appointments_business_time_idx
  on public.appointments (business_id, starts_at);
create index if not exists appointments_business_status_idx
  on public.appointments (business_id, status, starts_at);
create index if not exists appointments_customer_idx
  on public.appointments (customer_id, starts_at desc);

-- ------------------------------------------------------- no double booking
-- A partial unique index: one LIVE booking per business per start time.
-- Cancelled rows are excluded, so a freed slot can be rebooked.
--
-- This is the real guard. Checking availability in Python and then inserting
-- has a gap between the two, and two customers can both pass the check. Only
-- the database can make that impossible.
create unique index if not exists appointments_no_double_booking
  on public.appointments (business_id, starts_at)
  where status in ('pending', 'confirmed');

-- ---------------------------------------------------------------------- RLS
alter table public.appointments enable row level security;

drop policy if exists appointments_member_access on public.appointments;
create policy appointments_member_access on public.appointments
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------------------- activate for the demo gym
update public.agent_subscriptions
   set is_active = true,
       settings  = '{"require_approval": true, "slot_minutes": 30, "max_days_ahead": 30}'::jsonb
 where agent_key = 'booking';

-- Confirm
select
  (select count(*) from public.appointments) as appointments,
  (select is_active from public.agent_subscriptions where agent_key = 'booking') as booking_active;
```

### Explain the code

```sql
price numeric(12,2) not null default 0,
service_name text not null default '',
```
Denormalised on purpose. `service_id` still points at the live service, but the
**price and name are copied in at booking time**. If the gym raises personal
training from ₹750 to ₹900 next month, a booking made today must still show
₹750 — that is what the customer agreed to. Joining to `business_services` for
the price would silently rewrite history.

```sql
create unique index ... on public.appointments (business_id, starts_at)
  where status in ('pending', 'confirmed');
```
The most important line in the file, and the one people leave out.

Your Python will check availability before inserting. But between "the slot is
free" and "insert the row" there is a gap, and on a public chat link two
customers genuinely can land in that gap. This is a **race condition**, and no
amount of careful Python fixes it — the check and the write are two separate
trips to the database.

A unique index makes the second insert *fail*, at the database, atomically.
STEP 28 catches that failure and tells the second customer the slot just went.

The `where` clause matters too: a **partial** index only covers live bookings, so
cancelling frees the slot for someone else. Without it, a cancelled 6 PM booking
would block that time forever.

```sql
status booking_state not null default 'pending',
```
Default `pending`, deliberately. The agent has no way to create a confirmed
booking — not because we asked it nicely in a prompt, but because the only code
path that writes `confirmed` is the owner's approve button.

```sql
'{"require_approval": true, "slot_minutes": 30, "max_days_ahead": 30}'::jsonb
```
Per-business settings on the subscription row. A salon may want every booking
approved; a gym with 30 free slots a day may not. `slot_minutes` sets the
granularity of offered times, and `max_days_ahead` stops someone booking a
haircut in 2029.

### Commands

Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**.

### How to test

```sql
-- the table and its indexes
select indexname from pg_indexes where tablename = 'appointments';

-- prove the double-booking guard works
insert into public.appointments (business_id, customer_id, starts_at, service_name, price)
select b.id, c.id, now() + interval '2 days', 'Test Slot', 100
from public.businesses b, public.customers c
where b.chat_slug = 'pulse-fitness' and c.business_id = b.id limit 1;

-- the same slot again — this MUST fail
insert into public.appointments (business_id, customer_id, starts_at, service_name, price)
select b.id, c.id, now() + interval '2 days', 'Clash', 100
from public.businesses b, public.customers c
where b.chat_slug = 'pulse-fitness' and c.business_id = b.id limit 1;
```

Then clean up:

```sql
delete from public.appointments where service_name in ('Test Slot', 'Clash');
```

### Expected result

The index list includes `appointments_no_double_booking`.

The first insert succeeds. **The second fails** with:

```
ERROR: duplicate key value violates unique constraint "appointments_no_double_booking"
```

That error is the point of the whole step. Seeing it means two customers can
never take the same slot, no matter how the Python is written.

The confirm query shows `booking_active = true`.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `relation "public.customers" does not exist` | Migration 001 not applied | Run `001_customer_support_agent.sql` first. |
| `function public.is_business_member does not exist` | Same — 001 creates it | Run 001. |
| Second insert **succeeds** | The partial index did not get created | Re-run the `create unique index` block on its own and check for an error. |
| `booking_active` is null | No subscription row for booking | `insert into agent_subscriptions (business_id, agent_key, is_active) select id, 'booking', true from businesses;` |
| `type "booking_state" already exists` | Re-ran the file | Harmless — the `do $$` block swallows it. |

---

## STEP 27 — The bookings repository

### Goal

The functions that read and write `appointments`, with tenant filtering baked
in and the race condition handled.

### Why?

Same reason as every other repository: one place owns the queries, so "did we
filter by `business_id`?" is answerable by reading one short file.

This one has an extra job — turning the database's unique-violation error into
something the agent can act on.

### Files involved

```
backend/app/repositories/
├── customers.py         ← edit (add one function)
└── appointments.py      ← create
```

### Code

**`backend/app/repositories/customers.py`** — add this function. The booking
tools look customers up by the phone number they booked under, and the support
agent never needed that:

```python
def get_by_phone(business_id: str, phone: str | None) -> dict | None:
    """
    Find a customer by phone number within one business.

    Normalises first, so '9876543210', '+91 98765 43210' and '+919876543210'
    all find the same person. Returns None for anything unusable rather than
    querying with a junk value.
    """
    number = normalise_phone(phone)
    if not number:
        return None
    return one(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .eq("phone", number)
        .limit(1)
        .execute()
    )
```

**`backend/app/repositories/appointments.py`**:

```python
"""
Appointments.

The only module that writes bookings. Two things here are not obvious:

  * `create` catches the double-booking unique violation and reports it as a
    normal outcome, because two customers CAN race for the same slot.
  * Times are stored in UTC and compared in UTC. Callers deal in local time
    and convert at the boundary.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.db import db, one, rows

logger = logging.getLogger("aibh.appointments")

# Postgres error code for a unique-constraint violation.
UNIQUE_VIOLATION = "23505"


class SlotTaken(Exception):
    """Someone booked that time between our availability check and our insert."""


def create(
    *,
    business_id: str,
    customer_id: str,
    starts_at_utc: datetime,
    duration_minutes: int,
    service_name: str,
    price: float,
    service_id: str | None = None,
    conversation_id: str | None = None,
    notes: str = "",
    status: str = "pending",
    source: str = "customer_chat",
) -> dict:
    """
    Insert one booking.

    Raises SlotTaken when the database refuses because that slot is already
    live. Callers turn that into a polite "that just went, here are other
    times" rather than an error.
    """
    try:
        created = one(
            db.table("appointments")
            .insert(
                {
                    "business_id": business_id,
                    "customer_id": customer_id,
                    "service_id": service_id,
                    "conversation_id": conversation_id,
                    "starts_at": starts_at_utc.isoformat(),
                    "duration_minutes": duration_minutes,
                    "price": price,
                    "service_name": service_name,
                    "notes": notes,
                    "status": status,
                    "source": source,
                }
            )
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        text = str(exc)
        if UNIQUE_VIOLATION in text or "appointments_no_double_booking" in text:
            logger.info("Slot %s already taken for business %s", starts_at_utc, business_id)
            raise SlotTaken(str(starts_at_utc)) from exc
        raise

    if not created:
        raise RuntimeError("Could not create the booking")
    return created


def booked_between(business_id: str, start_utc: datetime, end_utc: datetime) -> list[dict]:
    """Live bookings that occupy time in a window. Cancelled ones do not count."""
    return rows(
        db.table("appointments")
        .select("id, starts_at, duration_minutes, status")
        .eq("business_id", business_id)
        .in_("status", ["pending", "confirmed"])
        .gte("starts_at", start_utc.isoformat())
        .lt("starts_at", end_utc.isoformat())
        .order("starts_at")
        .execute()
    )


def get(business_id: str, appointment_id: str) -> dict | None:
    return one(
        db.table("appointments")
        .select("*, customers(id, name, phone, email), business_services(id, name)")
        .eq("business_id", business_id)
        .eq("id", appointment_id)
        .limit(1)
        .execute()
    )


def find_by_reference(business_id: str, reference: str) -> dict | None:
    """
    Look a booking up by the short code we show customers.

    We show the first 8 characters of the uuid, uppercased. PostgREST cannot
    filter on a prefix of a uuid column, so we scan this business's recent
    bookings — fine at this scale, and it keeps the customer-facing reference
    short enough to say out loud.
    """
    wanted = (reference or "").strip().upper().lstrip("#")
    if len(wanted) < 6:
        return None
    for row in list_upcoming(business_id, days=365, limit=500):
        if row["id"][:8].upper() == wanted[:8]:
            return row
    return None


def list_for_customer(business_id: str, customer_id: str, limit: int = 20) -> list[dict]:
    return rows(
        db.table("appointments")
        .select("*, customers(id, name, phone)")
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("starts_at", desc=True)
        .limit(limit)
        .execute()
    )


def list_upcoming(business_id: str, days: int = 30, limit: int = 200) -> list[dict]:
    now = datetime.now(timezone.utc)
    return rows(
        db.table("appointments")
        .select("*, customers(id, name, phone, email)")
        .eq("business_id", business_id)
        .gte("starts_at", (now - timedelta(days=1)).isoformat())
        .lt("starts_at", (now + timedelta(days=days)).isoformat())
        .order("starts_at")
        .limit(limit)
        .execute()
    )


def list_all(business_id: str, limit: int = 200) -> list[dict]:
    """Everything, newest first. What the dashboard table shows."""
    return rows(
        db.table("appointments")
        .select("*, customers(id, name, phone, email)")
        .eq("business_id", business_id)
        .order("starts_at", desc=True)
        .limit(limit)
        .execute()
    )


def set_status(
    *,
    business_id: str,
    appointment_id: str,
    status: str,
    decided_by: str = "owner",
    note: str = "",
) -> dict | None:
    if status not in {"pending", "confirmed", "cancelled", "completed"}:
        raise ValueError(f"Invalid booking status: {status}")

    patch: dict = {"status": status, "decision_note": note}
    if status in {"confirmed", "cancelled", "completed"}:
        patch["decided_at"] = datetime.now(timezone.utc).isoformat()
        patch["decided_by"] = decided_by

    db.table("appointments").update(patch).eq("business_id", business_id).eq(
        "id", appointment_id
    ).execute()

    return get(business_id, appointment_id)


def pending_count(business_id: str) -> int:
    return len(
        rows(
            db.table("appointments")
            .select("id")
            .eq("business_id", business_id)
            .eq("status", "pending")
            .execute()
        )
    )
```

### Explain the code

```python
class SlotTaken(Exception):
```
A named exception for a **normal** outcome, not a crash. Two customers racing
for 6 PM is expected behaviour on a public link, and the caller should respond
with "sorry, that just went — 6:30 is free" rather than an apology for a server
error.

```python
if UNIQUE_VIOLATION in text or "appointments_no_double_booking" in text:
```
We check both the SQL error code and the index name. supabase-py wraps Postgres
errors and the shape varies between versions; matching on either makes this
robust without parsing a specific structure.

```python
    else:
        raise
```
Note the bare `raise` for anything else. A genuine failure — a missing column, a
dead connection — must not be silently converted into "slot taken", which would
tell the customer a lie.

```python
.in_("status", ["pending", "confirmed"])
```
Matches the partial index exactly. If these two lists ever disagree — say Python
counts `completed` as busy but the index does not — you get availability that
contradicts the constraint, which is maddening to debug. Keep them in sync.

```python
price: float, service_name: str,
```
Passed in by the caller rather than looked up here, because the caller is the
one that resolved the service and must quote the price it showed the customer.

```python
def find_by_reference(business_id: str, reference: str) -> dict | None:
```
A UUID is unusable in a chat — nobody types
`3f2a1b9c-4d5e-...`. We show the first 8 characters (`#3F2A1B9C`), which is
short enough to read aloud and unique enough for one business's bookings.

The comment is honest that this scans rather than indexes. At a few hundred
bookings that is one query and a loop. If a business ever has 50,000, add a
generated `reference` column with its own index — but do not add it now.

```python
patch["decided_at"] = ... if status in {"confirmed", "cancelled", "completed"}
```
Only stamps the decision when one was actually made. Setting a booking back to
`pending` should not record a phantom approval.

### Commands

Create the one file. uvicorn reloads.

### How to test

Create `backend/scripts/check_bookings.py`:

```python
"""Exercise the bookings repository. Run from backend/."""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

from app.config import settings
from app.repositories import appointments as booking_repo
from app.repositories import businesses, customers

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]
person = customers.upsert_from_chat(business_id=bid, name="Test Customer", phone="9000000001")

slot = (datetime.now(timezone.utc) + timedelta(days=3)).replace(minute=0, second=0, microsecond=0)

created = booking_repo.create(
    business_id=bid, customer_id=person["id"], starts_at_utc=slot,
    duration_minutes=60, service_name="Personal Training", price=750.0,
)
print("created   :", created["id"][:8].upper(), created["status"], created["service_name"])

# The same slot again must be refused by the DATABASE, not by Python.
try:
    booking_repo.create(
        business_id=bid, customer_id=person["id"], starts_at_utc=slot,
        duration_minutes=60, service_name="Clashing Booking", price=100.0,
    )
    print("double    : NOT BLOCKED  <-- the unique index is missing")
except booking_repo.SlotTaken:
    print("double    : blocked by the database (correct)")

print("by ref    :", (booking_repo.find_by_reference(bid, created["id"][:8].upper()) or {}).get("service_name"))
print("busy      :", len(booking_repo.booked_between(bid, slot - timedelta(hours=1), slot + timedelta(hours=1))))
print("pending   :", booking_repo.pending_count(bid))

booking_repo.set_status(business_id=bid, appointment_id=created["id"], status="cancelled")
print("cancelled :", booking_repo.get(bid, created["id"])["status"])

# Cancelling frees the slot — the same time can now be booked again.
again = booking_repo.create(
    business_id=bid, customer_id=person["id"], starts_at_utc=slot,
    duration_minutes=60, service_name="Rebooked After Cancel", price=750.0,
)
print("rebooked  :", again["status"], "(cancelling really frees the slot)")

for row in (created, again):
    booking_repo.set_status(business_id=bid, appointment_id=row["id"], status="cancelled")
print("cleaned up")
```

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
python scripts\check_bookings.py
```

### Expected result

```
created   : 7F3A9C2E pending Personal Training
double    : blocked by the database (correct)
by ref    : Personal Training
busy      : 1
pending   : 1
cancelled : cancelled
rebooked  : pending (cancelling really frees the slot)
cleaned up
```

Three things this proves:

1. Bookings are created **`pending`** — the agent cannot confirm anything.
2. The **database** blocks a double booking, not hopeful Python.
3. Cancelling **frees** the slot, because the unique index is partial.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `double: NOT BLOCKED` | The partial unique index is missing | Re-run that block from migration 002 and watch for an error. |
| `ModuleNotFoundError: No module named 'app'` | Wrong folder | Run from `backend/`, and keep the `sys.path` lines at the top. |
| `null value in column "customer_id"` | `upsert_from_chat` returned None | It refuses a name with no phone or email — pass a phone. |
| `SlotTaken` on the FIRST insert | Left-over rows from an earlier run | `delete from appointments where service_name like '%Test%';` |
| `invalid input value for enum booking_state` | Typo in a status string | Only `pending`, `confirmed`, `cancelled`, `completed`. |

---

## End of Part 0 — checklist

- [ ] `database/migrations/002_booking_agent.sql` applied
- [ ] `appointments_no_double_booking` appears in `pg_indexes`
- [ ] Inserting the same slot twice fails at the database
- [ ] `booking` subscription is active
- [ ] `customers.get_by_phone` added
- [ ] `python scripts\check_bookings.py` prints the expected block
- [ ] Cancelling frees the slot

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add backend database docs
git commit -m "Add appointments table and bookings repository"
```

Next: [01-tools-and-agent.md](01-tools-and-agent.md) — teach the agent to book.
