# Guide 9 — The Reports Agent (STEP 73 → STEP 76)

What actually happened: money in, money owed, bookings, new customers, what
sells.

---

## The decision that shapes this guide

> **SQL does the arithmetic. The model only describes the result.**

A language model that adds up revenue will eventually add it up wrong, and it
will sound completely confident while doing it. So every figure on this screen
comes from Postgres, and the model is handed the finished numbers with one
instruction: *"They are already correct — do NOT recalculate anything, and do
not mention any figure that is not in this list."*

This is the whole design:

```
  database  ->  SQL views and functions  ->  numbers  ->  screen
                                                 |
                                                 +->  model  ->  one paragraph
                                                      (optional, on request)
```

## Two more decisions

**No new tables.** A report is a question about data that already exists.
Storing daily totals would mean a nightly job, a scheduler, and numbers that go
stale the moment a booking is cancelled after the job ran. Postgres adds up a
few thousand rows in milliseconds, so it does it on demand.

**Owner-only.** `reports` is not in `OPTIONAL_CAPABILITIES`, so the chat agent
has no reporting tool and the supervisor can never route to one. A customer on
a public chat link must never be able to ask what the business earned.

---

## STEP 73 — The reports migration

### Architecture

```
  report_daily        a VIEW: one row per day per business, last 90 days
        |             conversations, bookings, invoices, collected, new customers
        |
        +-- report_summary()      totals for a window of N days
        +-- report_top_services() what sells most
```

**Dates are the business's local dates.** A 7 AM class in Hyderabad is 01:30
UTC. Counted in UTC it would land on the previous day, and the owner's Monday
would be missing a class.

**Money is counted on the day it was marked paid**, not the day the invoice was
written. That is the day the owner actually saw it arrive.

### Files involved

```
database/migrations/
└── 008_reports_agent.sql     ← new
```

### Code

**`database/migrations/008_reports_agent.sql`** — complete file:

```sql
-- ============================================================================
-- 008_reports_agent.sql
-- Reporting for the Reports Agent.
-- Run once, in the Supabase SQL Editor. Safe to re-run.
--
-- NO NEW TABLES. A report is a question about data that already exists, so
-- this file is views and one function. Storing daily totals would mean a
-- nightly job, a scheduler, and numbers that go stale when a booking is
-- cancelled after the job ran. Postgres can add up a few thousand rows in
-- milliseconds, so it does it on demand.
--
-- The LLM is NOT used to calculate anything here. SQL produces the numbers;
-- the agent may summarise them in a sentence afterwards. A model that does
-- arithmetic is a model that will eventually get arithmetic wrong.
-- ============================================================================

-- --------------------------------------------------- one row per day, per business
-- Dates are the BUSINESS's local dates, not UTC. A 7 AM IST class is 01:30 UTC
-- and belongs to the day the owner thinks it does.
drop view if exists public.report_daily;
create view public.report_daily
with (security_invoker = true) as
with days as (
  select b.id as business_id,
         coalesce(b.timezone, 'Asia/Kolkata') as tz,
         generate_series(
           (now() at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date - interval '89 days',
           (now() at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date,
           interval '1 day'
         )::date as day
  from public.businesses b
)
select
  d.business_id,
  d.day,
  coalesce(c.conversations, 0)    as conversations,
  coalesce(bk.bookings, 0)        as bookings,
  coalesce(bk.completed, 0)       as completed_bookings,
  coalesce(bk.cancelled, 0)       as cancelled_bookings,
  coalesce(inv.invoices, 0)       as invoices_issued,
  coalesce(inv.collected, 0)      as collected,
  coalesce(cust.new_customers, 0) as new_customers
from days d
left join lateral (
  select count(*) as conversations
  from public.conversations x
  where x.business_id = d.business_id
    and (x.created_at at time zone d.tz)::date = d.day
) c on true
left join lateral (
  select
    count(*)                                        as bookings,
    count(*) filter (where a.status = 'completed')  as completed,
    count(*) filter (where a.status = 'cancelled')  as cancelled
  from public.appointments a
  where a.business_id = d.business_id
    and (a.starts_at at time zone d.tz)::date = d.day
) bk on true
left join lateral (
  select
    count(*) filter (where (i.created_at at time zone d.tz)::date = d.day) as invoices,
    -- Money is counted on the day it was MARKED PAID, which is the day the
    -- owner saw it arrive - not the day the invoice was written.
    coalesce(sum(i.amount) filter (
      where i.status = 'paid' and (i.paid_at at time zone d.tz)::date = d.day
    ), 0) as collected
  from public.invoices i
  where i.business_id = d.business_id
) inv on true
left join lateral (
  select count(*) as new_customers
  from public.customers cu
  where cu.business_id = d.business_id
    and (cu.created_at at time zone d.tz)::date = d.day
) cust on true;

-- ------------------------------------------------------- headline numbers
-- Everything the dashboard's summary cards need, for a window of N days.
create or replace function public.report_summary(
  p_business_id uuid,
  p_days        int default 30
)
returns table (
  days                int,
  conversations       bigint,
  bookings            bigint,
  completed_bookings  bigint,
  cancelled_bookings  bigint,
  invoices_issued     bigint,
  collected           numeric,
  outstanding         numeric,
  new_customers       bigint,
  active_customers    bigint,
  low_stock_items     bigint
)
language sql
stable
as $$
  with window_days as (
    select greatest(1, least(coalesce(p_days, 30), 90)) as n
  ),
  span as (
    select d.* from public.report_daily d, window_days w
    where d.business_id = p_business_id
      and d.day > (current_date - w.n)
  )
  select
    (select n from window_days)::int,
    coalesce(sum(s.conversations), 0)::bigint,
    coalesce(sum(s.bookings), 0)::bigint,
    coalesce(sum(s.completed_bookings), 0)::bigint,
    coalesce(sum(s.cancelled_bookings), 0)::bigint,
    coalesce(sum(s.invoices_issued), 0)::bigint,
    coalesce(sum(s.collected), 0)::numeric,
    -- Outstanding is a CURRENT figure, not a windowed one: what is owed right
    -- now, whenever it was invoiced.
    (select coalesce(sum(i.amount), 0) from public.invoices i
      where i.business_id = p_business_id and i.status = 'pending')::numeric,
    coalesce(sum(s.new_customers), 0)::bigint,
    (select count(*) from public.customer_overview c
      where c.business_id = p_business_id and c.status = 'active')::bigint,
    (select count(*) from public.inventory_overview v
      where v.business_id = p_business_id and v.stock_status <> 'in_stock' and v.is_active)::bigint
  from span s;
$$;

revoke execute on function public.report_summary(uuid, int) from public, anon, authenticated;
grant execute on function public.report_summary(uuid, int) to service_role;

-- --------------------------------------------------------- what sells most
create or replace function public.report_top_services(
  p_business_id uuid,
  p_days        int default 30,
  p_limit       int default 5
)
returns table (service_name text, bookings bigint, revenue numeric)
language sql
stable
as $$
  select
    a.service_name,
    count(*)::bigint as bookings,
    -- The price stored ON the booking, so an old booking keeps its old price.
    coalesce(sum(a.price) filter (where a.status in ('confirmed', 'completed')), 0)::numeric
      as revenue
  from public.appointments a
  where a.business_id = p_business_id
    and a.starts_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
    and a.status <> 'cancelled'
  group by a.service_name
  -- Ordered by POSITION, not by name. In a "returns table" function the output
  -- column names (service_name, bookings, revenue) are not in scope in ORDER BY,
  -- so "order by revenue desc" fails with: column "revenue" does not exist.
  order by 2 desc, 3 desc
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

revoke execute on function public.report_top_services(uuid, int, int) from public, anon, authenticated;
grant execute on function public.report_top_services(uuid, int, int) to service_role;

-- --------------------------------------------- switch it on for the demo gym
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
select id, 'reports', true, '{"default_days": 30}'::jsonb
  from public.businesses
on conflict (business_id, agent_key) do update set is_active = true;

notify pgrst, 'reload schema';

select
  (select count(*) from public.report_daily) as daily_rows,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'reports') as reports_active;
```

### Explain the code

```sql
generate_series(
  (now() at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date - interval '89 days',
  ...
```
Generates a row for **every** day, including days with nothing at all. Without
this, a chart would silently skip quiet days and make a flat week look busy.

```sql
coalesce(sum(i.amount) filter (
  where i.status = 'paid' and (i.paid_at at time zone d.tz)::date = d.day
), 0) as collected
```
`filter` lets one pass over the table produce several different totals. And
`paid_at`, not `created_at` — see above.

```sql
    (select coalesce(sum(i.amount), 0) from public.invoices i
      where i.business_id = p_business_id and i.status = 'pending')::numeric,
```
Outstanding is deliberately **not** windowed. "What am I owed?" means right
now, whatever month it was invoiced in.

```sql
  where d.business_id = p_business_id
```
Every query is filtered by business. There is no code path that totals across
businesses — `check_reports.py` proves it by building data in one sandbox and
asserting the other still reads zero.

### Expected result

```
daily_rows | reports_active
-----------+----------------
90         | true
```

### The bug this migration hit

```
ERROR: 42703: column "revenue" does not exist
LINE 150:   order by bookings desc, revenue desc
```

The third selected column had **no alias**:

```sql
returns table (service_name text, bookings bigint, revenue numeric)
...
  count(*)::bigint as bookings,                      -- has an alias
  coalesce(sum(a.price) filter (...), 0)::numeric    -- has NONE
  order by bookings desc, revenue desc               -- so "revenue" is nothing
```

The names in `RETURNS TABLE` are **not** in scope in `ORDER BY`. `bookings`
worked only because it happened to have a matching alias.

**Fix:** give it an alias *and* order by position — `order by 2 desc, 3 desc` —
which cannot be ambiguous whatever the output parameters are called.

**What was not broken:** `report_summary`, defined earlier in the same file, was
fine. Postgres validates a SQL function's body when it is created, and it
reached line 150 before failing, which proves everything above resolved. The
whole script runs in one transaction, so 008 rolled back as a unit and
migrations 005–007 were untouched.

**Lesson:** a failed migration is usually all-or-nothing. Check what actually
exists before re-running; do not assume a partial apply.

---

## STEP 74 — The repository and the API

### Files involved

```
backend/app/
├── repositories/reports.py    ← new (thin: it calls the SQL)
├── routers/reports.py         ← new
└── main.py                    ← edit
```

### Code

**`backend/app/repositories/reports.py`** — complete file:

```python
"""
Reporting.

There are no tables here. A report is a question about data that already
exists, so migration 008 is views and functions, and this module just calls
them.

The arithmetic is done by Postgres, never by a model. A language model that
adds up revenue will eventually add it up wrong, and it will be confident
about it. The model's only job in reporting is to say what the numbers mean,
after SQL has produced them - see routers/reports.py.
"""

from __future__ import annotations

import logging

from app.db import db, one, rows

logger = logging.getLogger("aibh.reports")


def summary(business_id: str, days: int = 30) -> dict:
    """Headline totals for a window of days, worked out in one query."""
    found = one(
        db.rpc("report_summary", {"p_business_id": business_id, "p_days": days}).execute()
    )
    return found or {}


def daily(business_id: str, days: int = 30) -> list[dict]:
    """
    One row per day, oldest first - what the charts draw.

    The view holds 90 days per business; this trims to what was asked for.
    Dates are the BUSINESS's local dates, so a 7 AM class counts on the day
    the owner thinks it does rather than the UTC day.
    """
    window = max(1, min(days, 90))
    found = rows(
        db.table("report_daily")
        .select("*")
        .eq("business_id", business_id)
        .order("day", desc=True)
        .limit(window)
        .execute()
    )
    return list(reversed(found))


def top_services(business_id: str, days: int = 30, limit: int = 5) -> list[dict]:
    return rows(
        db.rpc(
            "report_top_services",
            {"p_business_id": business_id, "p_days": days, "p_limit": limit},
        ).execute()
    )
```

**`backend/app/routers/reports.py`** — complete file:

```python
"""
The owner's reports screen: /api/v1/dashboard/reports.

OWNER-ONLY. There is no chat tool for reporting, and that is not an oversight:
the public chat is for customers, and a customer must never be able to ask how
much the business earned this week.

WHERE THE NUMBERS COME FROM. Every figure on this screen is produced by SQL
(migration 008). The model is given the finished numbers and asked to write
two or three sentences about them. It never calculates, and it is told in the
prompt to use only the numbers it was handed.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.agents.llm import describe_error, get_model
from app.repositories import businesses as business_repo
from app.repositories import reports as report_repo
from app.services.formatting import rupees
from app.security import business_scope, require_dashboard_key

logger = logging.getLogger("aibh.router.reports")

router = APIRouter(
    prefix="/api/v1/dashboard/reports",
    tags=["reports"],
    dependencies=[Depends(require_dashboard_key)],
)

SUMMARY_PROMPT = """You are writing a short note for the owner of {business_name} about the last {days} days.

Here are the numbers. They are already correct - do NOT recalculate anything,
and do not mention any figure that is not in this list.

{numbers}

Write 2 to 3 plain sentences: what stands out, and one thing worth doing next.
No headings, no bullet points, no markdown, no emoji. If the numbers are all
zero, say plainly that there is not enough activity yet to draw a conclusion."""


def _summary(row: dict) -> dict:
    return {
        "days": int(row.get("days") or 0),
        "conversations": int(row.get("conversations") or 0),
        "bookings": int(row.get("bookings") or 0),
        "completedBookings": int(row.get("completed_bookings") or 0),
        "cancelledBookings": int(row.get("cancelled_bookings") or 0),
        "invoicesIssued": int(row.get("invoices_issued") or 0),
        "collected": float(row.get("collected") or 0),
        "outstanding": float(row.get("outstanding") or 0),
        "newCustomers": int(row.get("new_customers") or 0),
        "activeCustomers": int(row.get("active_customers") or 0),
        "lowStockItems": int(row.get("low_stock_items") or 0),
    }


def _day(row: dict) -> dict:
    return {
        "day": str(row.get("day") or ""),
        "conversations": int(row.get("conversations") or 0),
        "bookings": int(row.get("bookings") or 0),
        "completedBookings": int(row.get("completed_bookings") or 0),
        "cancelledBookings": int(row.get("cancelled_bookings") or 0),
        "invoicesIssued": int(row.get("invoices_issued") or 0),
        "collected": float(row.get("collected") or 0),
        "newCustomers": int(row.get("new_customers") or 0),
    }


@router.get("")
def get_report(
    days: int = Query(default=30, ge=1, le=90),
    business_id: str = Depends(business_scope),
) -> dict:
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    return {
        "summary": _summary(report_repo.summary(business_id, days)),
        "daily": [_day(d) for d in report_repo.daily(business_id, days)],
        "topServices": [
            {
                "serviceName": s.get("service_name") or "",
                "bookings": int(s.get("bookings") or 0),
                "revenue": float(s.get("revenue") or 0),
            }
            for s in report_repo.top_services(business_id, days)
        ],
        "business": {"name": business.get("name") or ""},
    }


@router.post("/summarise")
def summarise(
    days: int = Query(default=30, ge=1, le=90),
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Ask the model to describe the numbers SQL produced.

    On purpose, this is a separate request the owner chooses to make. Loading
    the screen must not spend model quota, and the numbers are useful without
    a sentence about them.
    """
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    figures = _summary(report_repo.summary(business_id, days))
    top = report_repo.top_services(business_id, days, limit=3)

    # The model is handed finished, formatted numbers. It has no tools and no
    # database access, so it cannot look anything up or work anything out.
    lines = [
        f"- conversations: {figures['conversations']}",
        f"- bookings: {figures['bookings']} ({figures['completedBookings']} completed, "
        f"{figures['cancelledBookings']} cancelled)",
        f"- invoices issued: {figures['invoicesIssued']}",
        f"- money collected: {rupees(figures['collected'])}",
        f"- still owed: {rupees(figures['outstanding'])}",
        f"- new customers: {figures['newCustomers']}",
        f"- active customers: {figures['activeCustomers']}",
        f"- products low or out of stock: {figures['lowStockItems']}",
    ]
    for service in top:
        lines.append(
            f"- {service.get('service_name')}: {int(service.get('bookings') or 0)} bookings, "
            f"{rupees(service.get('revenue') or 0)}"
        )

    prompt = SUMMARY_PROMPT.format(
        business_name=business.get("name") or "the business",
        days=figures["days"],
        numbers="\n".join(lines),
    )

    try:
        reply = get_model("reports", temperature=0.3, timeout=30).invoke(prompt)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Report summary failed: %s", exc)
        raise HTTPException(status_code=503, detail=describe_error(exc)) from exc

    text = str(reply.content or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="The model returned nothing. Try again.")
    return {"summary": text[:1200], "basedOn": figures}
```

### Explain the code

```python
SUMMARY_PROMPT = """...
Here are the numbers. They are already correct - do NOT recalculate anything,
and do not mention any figure that is not in this list.
"""
```
Two instructions doing two jobs: do not do arithmetic, and do not invent a
figure that was not supplied. Without the second, a model asked about revenue
will cheerfully add a growth percentage nobody calculated.

```python
        lines.append(f"- money collected: {rupees(figures['collected'])}")
```
The model is handed **formatted** numbers (`₹9,000`), so it copies them rather
than reformatting and getting the grouping wrong.

```python
@router.post("/summarise")
```
A separate request the owner chooses to make. Loading the screen must not spend
model quota, and the numbers are useful on their own.

```python
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
```
Before any work. A report for a business that does not exist should be a 404,
not an empty chart.

---

## STEP 75 — Test it

### Goal

Build a **known** situation and assert the totals exactly. This is why SQL
doing the arithmetic matters: the answer is checkable.

### Code

**`backend/scripts/check_reports.py`** — complete file:

```python
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
```

### Expected result

```
a known situation
  PASS  1 conversation                          1
  PASS  1 booking, and it is counted as completed   1 / 1
  PASS  2 invoices issued                       2
  PASS  collected is the PAID one only          9000.0
  PASS  outstanding is the unpaid one only      600.0
  PASS  1 product low or out of stock           1

one business never sees another's money
  PASS  the other business still shows zero collected   0
...
ALL PASS
```

### The bug this test hit

```
FAIL  collected is zero, not null     0
```

The value printed was `0`, which is correct — and the check still failed:

```python
float(empty.get("collected") or -1) == 0.0
```

**Zero is falsy in Python.** `0 or -1` is `-1`, so the sentinel trick turned the
right answer into a wrong one. The bug was in the test.

**Fix:**

```python
collected = empty.get("collected")
check(..., collected is not None and float(collected) == 0.0)
```

**Lesson:** `x or default` is only safe when `0`, `""` and `[]` should be
treated as missing. For "is this absent?", compare with `None`.

---

## STEP 76 — Wire the screen

### Files involved

```
frontend/src/
├── types/report.ts                       ← edit (ReportDay, ReportSummary, BusinessReport)
├── lib/api/dashboard.ts                  ← edit (report, summariseReport, query support)
└── app/dashboard/reports/page.tsx        ← edit
```

### Explain the code

```ts
async function call<T>(path, options: { ...; query?: Record<string, string | number> } = {}) {
  // Extra query parameters go through here rather than being glued onto
  // `path`, which would land on the wrong side of the "?" this function adds.
```
The first version wrote `` `/reports&days=${days}` `` and produced
`/reports&days=30?business_id=...` — the parameter on the wrong side of the
question mark. `call()` now merges query parameters properly.

```tsx
type Window = "7" | "30" | "90";
```
`SegmentedTabs` is typed for string values. Keeping the window a number meant
casting in three places; converting once, where it is used, is less code and
less to get wrong.

```tsx
    void load(days);
    setSummary(null);
```
The written summary describes a particular window, so changing the window
clears it rather than leaving a paragraph about the last 7 days sitting above
90 days of numbers.

### How to test

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Open `/dashboard/reports` | Real numbers; no model call yet |
| 2 | Switch 7 / 30 / 90 days | Numbers and charts change |
| 3 | Mark an invoice paid on Payments, come back | Collected goes up on today |
| 4 | Complete a booking, come back | Bookings and "what sells" update |
| 5 | **Explain these numbers** | Two or three sentences about those figures |
| 6 | Change the window | The paragraph clears — it described the old window |

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| All zeros on a busy business | Everything is older than the window | Try 90 days. |
| "Explain" gives 503 | Model rate-limited | The numbers are unaffected; try later. |
| Collected looks low | It counts invoices **marked paid**, not bookings | That is the point: it is money you confirmed. |

---

## Checklist

- [ ] `008_reports_agent.sql` applied; `daily_rows = 90`
- [ ] `python scripts\check_reports.py` → `ALL PASS` (24 checks)
- [ ] One business's report shows zero while another has data
- [ ] The summary button works, and the screen is useful without it
