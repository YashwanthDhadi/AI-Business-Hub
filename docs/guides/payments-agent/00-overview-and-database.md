# Guide 4, Part 0 — Overview and the database (STEP 42 → STEP 43)

The fourth capability. The owner bills a customer, usually for a booking. The
invoice lands in the customer's own chat with a payment link. The customer pays
by **UPI** from any app they already have (GPay, PhonePe, Paytm, BHIM), and the
owner marks it paid.

No payment gateway, no merchant account, no fee per transaction. UPI's standard
`upi://pay` link and a QR code do all of it, and both are free.

**Prerequisite:** Guides 2 and 3 work. `python scripts\check_approval.py` and
`python scripts\check_customers_api.py` both pass.

---

## What you do NOT have to do

| | |
| --- | --- |
| A payment gateway (Razorpay, Stripe, PayU) | **None.** They charge 2% and need KYC. UPI directly is free. |
| New AI model or key | **None.** Same OpenRouter model. |
| New chat UI | **None.** Invoices and reminders arrive in the chat the customer already has open. |
| A new agent | **None.** Same agent loop, one more capability. |

What you will need eventually: the business's **UPI ID** (for example
`pulsefitness@okaxis`), entered once on the Payments screen. You do **not** need it
to build or test anything in this guide. Until you add it, invoices still work,
but the pay page offers "pay at the front desk" instead of a UPI QR code. Where to
find it and exactly where to paste it:
[Adding your UPI ID later](02-dashboard-and-pay-page.md#adding-your-upi-id-later).

One new library, **`qrcode`** (free, MIT licence, runs in the browser), because
the QR code already in the project was a drawing that no phone could scan.

---

## The honest limit of free UPI

A payment gateway tells you, automatically, that money arrived. Plain UPI does
not: the money goes straight into the business's bank account, and nothing calls
our server. So:

1. The customer pays in their UPI app.
2. They tell the chat *"I've paid, reference 412345678901"*, or press **I've paid**
   on the pay page. That is recorded as **the customer says they paid**. It is
   **not** proof.
3. The owner checks their UPI app or bank, sees the money, and presses **Mark as
   paid**. That is the only path to `paid`.

That is the same owner gate as bookings, and for the same reason. Anything to do
with money is decided by a person, and the agent has **no tool** that can do it.

---

## The supervisor checkpoint

We agreed to revisit a supervisor router at the fourth capability. This is the
fourth. The decision, made before this guide: **build Payments in the single
loop first, and the supervisor straight after.** The reasons:

- The tools module this guide writes plugs into a supervisor unchanged, so the
  order creates no rework.
- A supervisor is best designed against the real set of capabilities it routes
  between.
- Payments adds only two chat tools, taking the list to thirteen.

After this guide:

| Capability | Tools |
| --- | --- |
| `customer_support` | 5 |
| `booking` | 4 |
| `customers` | 2 |
| `payment` | 2 |

---

## Architecture after this guide

```
  Owner: /dashboard/payments  ──  New Invoice (from a booking, or a service)
        │
        ▼
  FastAPI  ──►  create_invoice()  (ONE Postgres function, ONE transaction)
                    │  bump the counter for this financial year
                    │  add up the items
                    └─ insert  INV/2026-27/0007
        │
        ├──►  a message in the customer's chat:
        │       "Invoice INV/2026-27/0007 for ₹9,000 ... Pay by UPI here: <link>"
        ▼
  Customer:  /pay/<token>   (public, no login; the random token IS the permission)
        │   real QR code  +  "Open in UPI app"   (upi://pay?pa=...&am=9000.00)
        │   "I've paid"  ──► customer_reported_at   (NOT paid)
        ▼
  Owner checks the bank  ──►  Mark as paid  ──►  status = paid
                                               ├── booking.payment_status = paid  (trigger)
                                               └── a receipt in the customer's chat
```

---

## STEP 42 — The payments migration

### Goal

A table of invoices, a counter per business per financial year, and the database
rules that keep the money right no matter what the Python does.

### Why?

Money has rules that must hold **every** time, including when two requests
arrive at once, when a script skips the API, or when the Python has a bug:

| Rule | Why it matters |
| --- | --- |
| Invoice numbers never repeat and never skip | Indian GST rules ask for one unbroken series per financial year. A gap looks like a hidden invoice to an auditor. |
| An issued invoice never changes | The customer was sent ₹9,000. If the row could later say ₹8,000, the records lie. You cancel and reissue instead. |
| Status only moves forward | A paid invoice cannot go back to pending. A cancelled one cannot be paid. |
| One live invoice per booking | Billing Ravi twice for the same session is the most common small-business billing mistake. |
| Paid means we know how | Every paid invoice records a method (UPI, cash, card, bank transfer) and a time. |
| The total is the sum of the items | Python never sends an amount. The database multiplies and adds. |

### Architecture

**Why a Postgres function for numbering?** The obvious Python version:

```
n = select max(sequence_number) + 1     ← two requests both read 6
insert invoice number n                 ← both insert 7
```

loses a race, exactly like double booking did. `create_invoice()` does both
steps inside one transaction:

```
insert into invoice_counters ... on conflict do update set last_number = last_number + 1
    ↑ takes a ROW LOCK: the second request waits here until the first commits
insert into invoices (... that number ...)
    ↑ if THIS fails, the counter bump is rolled back too - no gap
```

**Why the financial year in the number?** India's financial year runs from 1 April
to 31 March, and invoice series restart each year. `INV/2026-27/0001` is the
first invoice of FY 2026-27, the year from 1 April 2026 to 31 March 2027. It is
16 characters, the GST maximum.

**Why is the token not a uuid?** It is, with the dashes removed: 32 hex
characters, 122 random bits. A pay-page URL containing it is as hard to guess as
a password, which is what lets the page need no login.

### Files involved

```
database/
└── migrations/
    └── 004_payments_agent.sql     ← new
```

### Code

**`database/migrations/004_payments_agent.sql`** — complete file:

```sql
-- ============================================================================
-- 004_payments_agent.sql
-- Invoices and UPI payments for the Payments Agent.
-- Run once, in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

-- ------------------------------------------------ 1. bookings, as a pair
-- Lets an invoice point at (booking id, business id) together, so it can never
-- reference another business's booking. Same idea as customers in 003.
do $$ begin
  alter table public.appointments add constraint appointments_id_business_key
    unique (id, business_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- ------------------------------------------ 2. one counter per financial year
create table if not exists public.invoice_counters (
  business_id    uuid not null references public.businesses (id) on delete cascade,
  financial_year text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  last_number    int  not null default 0 check (last_number >= 0),
  primary key (business_id, financial_year)
);

alter table public.invoice_counters enable row level security;

drop policy if exists invoice_counters_member_access on public.invoice_counters;
create policy invoice_counters_member_access on public.invoice_counters
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------------------------------- 3. invoices
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  customer_id     uuid not null,
  appointment_id  uuid,
  -- The chat to post the invoice, reminders and the receipt into.
  conversation_id uuid references public.conversations (id) on delete set null,

  invoice_number  text not null,
  financial_year  text not null,
  sequence_number int  not null check (sequence_number > 0),

  -- A SNAPSHOT of what was billed: [{description, quantity, unit_price, total}].
  -- Changing a service's price later does not change an issued invoice.
  items    jsonb not null
             check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  amount   numeric(12,2) not null check (amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),

  status   text not null default 'pending'
             check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  due_date date not null,
  notes    text not null default '',

  -- The pay page's address. 32 random hex characters: the URL is the permission.
  public_token text not null default replace(gen_random_uuid()::text, '-', ''),

  -- The CUSTOMER says they paid (chat or pay page). A claim, not proof.
  customer_reported_at timestamptz,
  customer_reference   text check (customer_reference is null or char_length(customer_reference) <= 60),

  -- The OWNER saw the money arrive.
  paid_at        timestamptz,
  paid_method    text,
  paid_reference text not null default '',

  cancelled_at  timestamptz,
  cancel_reason text not null default '',
  refunded_at   timestamptz,
  refund_note   text not null default '',

  last_reminded_at timestamptz,
  created_at       timestamptz not null default now(),

  constraint invoices_number_unique   unique (business_id, invoice_number),
  constraint invoices_sequence_unique unique (business_id, financial_year, sequence_number),
  constraint invoices_token_unique    unique (public_token),

  -- GST allows at most 16 characters: INV/2026-27/0001 is exactly 16.
  constraint invoices_number_length check (char_length(invoice_number) <= 16),

  constraint invoices_paid_method_values
    check (paid_method is null or paid_method in ('upi', 'cash', 'card', 'bank_transfer')),

  -- "Paid" (and later "refunded") always says when and how.
  constraint invoices_paid_needs_method
    check ((status in ('paid', 'refunded')) = (paid_at is not null and paid_method is not null)),
  constraint invoices_cancel_stamped check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint invoices_refund_stamped check ((status = 'refunded') = (refunded_at is not null)),

  -- The customer and the booking must belong to the SAME business as the invoice.
  constraint invoices_customer_same_business
    foreign key (customer_id, business_id) references public.customers (id, business_id),
  constraint invoices_booking_same_business
    foreign key (appointment_id, business_id) references public.appointments (id, business_id)
);

create index if not exists invoices_business_created_idx
  on public.invoices (business_id, created_at desc);
create index if not exists invoices_customer_idx
  on public.invoices (business_id, customer_id);

-- One LIVE invoice per booking. A cancelled one does not count, so you can
-- cancel a wrong invoice and issue the right one.
create unique index if not exists invoices_one_live_per_booking
  on public.invoices (appointment_id)
  where appointment_id is not null and status in ('pending', 'paid');

alter table public.invoices enable row level security;

drop policy if exists invoices_member_access on public.invoices;
create policy invoices_member_access on public.invoices
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------ 4. issued invoices never change
create or replace function public.invoices_guard()
returns trigger
language plpgsql
as $$
begin
  if new.business_id     <> old.business_id
  or new.customer_id     <> old.customer_id
  or new.appointment_id  is distinct from old.appointment_id
  or new.invoice_number  <> old.invoice_number
  or new.financial_year  <> old.financial_year
  or new.sequence_number <> old.sequence_number
  or new.items           <> old.items
  or new.amount          <> old.amount
  or new.due_date        <> old.due_date
  or new.public_token    <> old.public_token
  or new.created_at      <> old.created_at then
    raise exception 'invoices_immutable: invoice % is issued and cannot be edited. Cancel it and issue a new one.',
      old.invoice_number;
  end if;

  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('paid', 'cancelled'))
    or (old.status = 'paid'    and new.status = 'refunded')
  ) then
    raise exception 'invoices_bad_transition: invoice % cannot go from % to %.',
      old.invoice_number, old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard
  before update on public.invoices
  for each row execute function public.invoices_guard();

-- ------------------------------- 5. the booking's payment status follows
-- appointments.payment_status (from 002) is now DERIVED from its invoice, by
-- the database, so no code path can forget to update it.
create or replace function public.invoices_sync_booking()
returns trigger
language plpgsql
as $$
begin
  if new.appointment_id is not null then
    update public.appointments
       set payment_status = case new.status
                              when 'paid'     then 'paid'::payment_state
                              when 'refunded' then 'refunded'::payment_state
                              else 'unpaid'::payment_state
                            end
     where id = new.appointment_id
       and business_id = new.business_id;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_sync_booking on public.invoices;
create trigger invoices_sync_booking
  after insert or update of status on public.invoices
  for each row execute function public.invoices_sync_booking();

-- ------------------------------------ 6. the ONLY way an invoice is issued
create or replace function public.create_invoice(
  p_business_id     uuid,
  p_customer_id     uuid,
  p_items           jsonb,
  p_due_date        date,
  p_appointment_id  uuid default null,
  p_conversation_id uuid default null,
  p_notes           text default '',
  p_prefix          text default 'INV'
)
returns public.invoices
language plpgsql
as $$
declare
  v_today  date;
  v_start  int;
  v_fy     text;
  v_seq    int;
  v_item   jsonb;
  v_desc   text;
  v_qty    int;
  v_price  numeric(12,2);
  v_items  jsonb := '[]'::jsonb;
  v_amount numeric(12,2) := 0;
  v_row    public.invoices;
begin
  -- "Today" in the business's own timezone, not UTC.
  select (now() at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date
    into v_today
    from public.businesses b
   where b.id = p_business_id;

  if v_today is null then
    raise exception 'invoices_unknown_business: no business %', p_business_id;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invoices_no_items: an invoice needs at least one item.';
  end if;

  -- Re-build every item and add them up HERE. Any total the caller sent is ignored.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_desc  := btrim(coalesce(v_item ->> 'description', ''));
    v_qty   := coalesce((v_item ->> 'quantity')::int, 1);
    v_price := coalesce((v_item ->> 'unit_price')::numeric, -1);
    if v_desc = '' or v_qty < 1 or v_price < 0 then
      raise exception 'invoices_bad_item: every item needs a description, a quantity of at least 1 and a price of 0 or more.';
    end if;
    v_items := v_items || jsonb_build_object(
      'description', v_desc, 'quantity', v_qty, 'unit_price', v_price, 'total', v_qty * v_price
    );
    v_amount := v_amount + v_qty * v_price;
  end loop;

  if p_due_date is null or p_due_date < v_today then
    raise exception 'invoices_due_in_past: the due date cannot be before today (%).', v_today;
  end if;

  -- India's financial year runs 1 April - 31 March. 26 Sep 2026 is FY 2026-27.
  v_start := extract(year from v_today)::int - case when extract(month from v_today) < 4 then 1 else 0 end;
  v_fy    := v_start::text || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');

  -- The row lock taken here makes a second, simultaneous call WAIT, then get
  -- the next number. If anything below fails, this bump is rolled back too.
  insert into public.invoice_counters as c (business_id, financial_year, last_number)
  values (p_business_id, v_fy, 1)
  on conflict (business_id, financial_year)
  do update set last_number = c.last_number + 1
  returning c.last_number into v_seq;

  insert into public.invoices (
    business_id, customer_id, appointment_id, conversation_id,
    invoice_number, financial_year, sequence_number,
    items, amount, due_date, notes
  )
  values (
    p_business_id, p_customer_id, p_appointment_id, p_conversation_id,
    upper(coalesce(nullif(btrim(p_prefix), ''), 'INV')) || '/' || v_fy || '/' || lpad(v_seq::text, 4, '0'),
    v_fy, v_seq,
    v_items, v_amount, p_due_date, coalesce(p_notes, '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Supabase exposes public functions to the API. Only the backend (service
-- role) may issue invoices; the public anon key must not even try.
revoke execute on function public.create_invoice(uuid, uuid, jsonb, date, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, uuid, jsonb, date, uuid, uuid, text, text)
  to service_role;

-- ------------------------------------------------ 7. switch it on for the gym
-- upi_id stays empty until the owner enters theirs on the Payments screen.
update public.agent_subscriptions
   set is_active = true,
       settings  = '{"upi_id": null, "payee_name": null, "invoice_prefix": "INV", "due_days": 7}'::jsonb
                   || coalesce(settings, '{}'::jsonb)
 where agent_key = 'payment';

notify pgrst, 'reload schema';

-- Confirm
select
  (select count(*) from public.invoices)                    as invoices,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'payment')                             as payment_active,
  (select settings from public.agent_subscriptions
    where agent_key = 'payment' limit 1)                     as payment_settings;
```

### Explain the code

```sql
insert into public.invoice_counters as c (business_id, financial_year, last_number)
values (p_business_id, v_fy, 1)
on conflict (business_id, financial_year)
do update set last_number = c.last_number + 1
returning c.last_number into v_seq;
```
The heart of the file. The first invoice of a year inserts the counter row with
`1`. Every later one hits the conflict and adds one. The update takes a **row
lock**, so a second, simultaneous call waits for the first to commit and then
gets the next number. STEP 43 proves this by issuing eight invoices at the same
moment.

```sql
returning * into v_row;
```
All of this runs as one function call, which Postgres treats as one transaction.
If the invoice insert fails (a booking that already has an invoice, a bad
customer id), the counter bump is undone with it. The series stays unbroken.

```sql
v_items := v_items || jsonb_build_object(... 'total', v_qty * v_price);
v_amount := v_amount + v_qty * v_price;
```
The caller sends descriptions, quantities and unit prices. The database does the
arithmetic. If a bug in Python ever sent `total: 1` for a ₹9,000 item, it would
simply be ignored.

```sql
or new.amount <> old.amount
...
raise exception 'invoices_immutable: ...'
```
A trigger runs before **every** update, whoever makes it: our API, the SQL
Editor, a future script. The only columns that may change are the ones that
record what **happened** to the invoice: status, paid, cancelled, refunded,
reminded, the customer's claim, and the owner's notes.

```sql
raise exception 'invoices_immutable: invoice % ...'
```
Every error starts with the rule's name (`invoices_immutable:`,
`invoices_bad_item:`). The repository in STEP 43 matches on that name to explain
the refusal. It is the same trick as the constraint names in 003.

```sql
(status in ('paid', 'refunded')) = (paid_at is not null and paid_method is not null)
```
Read it as *"paid if and only if we know when and how"*. It also works the other
way: a pending invoice cannot carry a `paid_at` by accident.

```sql
create unique index ... on public.invoices (appointment_id)
  where appointment_id is not null and status in ('pending', 'paid');
```
The same partial-index idea as double booking. Cancelled invoices drop out of
the index, so a wrong invoice can be cancelled and replaced.

```sql
after insert or update of status on public.invoices
```
`appointments.payment_status` has existed since migration 002, with nothing
updating it. Now the database keeps it in step with the invoice, so the Bookings
screen shows **Paid** the moment the owner marks the invoice paid, without the
bookings code knowing invoices exist.

```sql
revoke execute on function public.create_invoice(...) from public, anon, authenticated;
```
Supabase publishes every function in `public` as an API endpoint. The function
runs with the caller's rights and row level security would stop an anonymous
caller at the insert, but we do not rely on that alone. The public key cannot
call it at all. The `grant ... to service_role` line after it makes sure our
backend, which uses the service role key, still can. Without it, revoking from
`public` could remove the backend's permission too, if that was where it came
from.

```sql
'{"upi_id": null, ...}'::jsonb || coalesce(settings, '{}'::jsonb)
```
`||` merges two JSON objects, and the right-hand side wins. So re-running the
migration keeps any UPI ID you have already saved.

### Commands

Supabase dashboard → **SQL Editor** → **New query** → paste the whole file →
**Run**.

### How to test

In the SQL Editor:

```sql
-- 1. the tables and the function exist
select to_regclass('public.invoices') as invoices,
       to_regclass('public.invoice_counters') as counters,
       to_regprocedure('public.create_invoice(uuid, uuid, jsonb, date, uuid, uuid, text, text)') as fn;

-- 2. the rules are in place
select conname from pg_constraint
 where conrelid = 'public.invoices'::regclass
 order by conname;
```

The real proof, with invoices actually issued, is the STEP 43 script. It runs in
a throwaway business so your real numbering is never touched.

### Expected result

The confirm query at the end of the migration:

```
invoices | payment_active | payment_settings
---------+----------------+------------------------------------------------------------------------------
0        | true           | {"upi_id": null, "due_days": 7, "payee_name": null, "invoice_prefix": "INV"}
```

Query 1 shows all three names, not nulls. Query 2 lists, among others,
`invoices_booking_same_business`, `invoices_customer_same_business`,
`invoices_number_length`, `invoices_paid_needs_method` and
`invoices_number_unique`.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `there is no unique constraint matching given keys for referenced table "customers"` | Migration 003 not applied | Run 003 first; it adds `customers_id_business_key`. |
| `type "payment_state" does not exist` | Migration 002 not applied | Run 002 first. |
| `function public.is_business_member does not exist` | Migration 001 not applied | Run 001 first. |
| `payment_active` is null | No `payment` row in `agent_subscriptions` | `insert into agent_subscriptions (business_id, agent_key, is_active) select id, 'payment', true from businesses where chat_slug = 'pulse-fitness';` then re-run section 7. |
| `cannot change return type of existing function` | An older `create_invoice` exists | `drop function public.create_invoice(uuid, uuid, jsonb, date, uuid, uuid, text, text);` then re-run. |

---

## STEP 43 — The invoices repository

### Goal

The Python that issues and reads invoices, and records what happens to them,
turning each database refusal into an error a person can read.

### Why?

The database now holds every rule. The repository's jobs are small:

1. Call `create_invoice()`.
2. Read invoices with their customer and booking attached.
3. Record status changes **only while the invoice is still in the state the
   owner saw**, so two browser tabs cannot both mark it paid.
4. Say which rule refused, in words.

Plus a small formatting module, because messages the customer reads need
`₹1,20,000` and `Sat, 3 Oct 2026`, not `120000.0` and `2026-10-03`.

### Files involved

```
backend/
├── app/
│   ├── config.py                     ← edit (one setting)
│   ├── repositories/
│   │   ├── businesses.py             ← edit (one function)
│   │   ├── conversations.py          ← edit (one function)
│   │   └── invoices.py               ← new
│   ├── services/
│   │   └── formatting.py             ← new
│   └── routers/
│       └── dashboard.py              ← edit (use the shared spoken_date)
└── scripts/
    ├── sandbox.py                    ← new (a throwaway business for tests)
    └── check_invoices.py             ← new
```

### Code

**`backend/app/config.py`** — add this line inside `class Settings`, next to
`openrouter_site_url`:

```python
    # Where the frontend lives. Payment links sent to customers point here.
    public_site_url: str = "http://localhost:3000"
```

When you deploy, set `PUBLIC_SITE_URL=https://your-domain` in `backend/.env`.

**`backend/app/repositories/businesses.py`** — add at the end:

```python
def update_agent_settings(business_id: str, agent_key: str, patch: dict) -> dict:
    """Merge `patch` into one subscription's settings and return the result."""
    merged = {**agent_settings(business_id, agent_key), **patch}
    db.table("agent_subscriptions").update({"settings": merged}).eq(
        "business_id", business_id
    ).eq("agent_key", agent_key).execute()
    return merged
```

**`backend/app/repositories/conversations.py`** — add at the end:

```python
def latest_for_customer(business_id: str, customer_id: str) -> dict | None:
    """The customer's most recent chat - where an invoice or reminder is posted."""
    return one(
        db.table("conversations")
        .select("*")
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("last_message_at", desc=True)
        .limit(1)
        .execute()
    )
```

If `one` is not already imported at the top of `conversations.py`, change its
import line to `from app.db import db, one, rows`.

**`backend/app/services/formatting.py`** — complete file:

```python
"""
Text a PERSON reads, the Indian way.

Dates are day-month-year ("Sat, 3 Oct 2026") and money uses lakh grouping
("₹1,20,000"). Data sent to the dashboard stays machine-readable - ISO dates,
plain numbers - and the frontend formats it. These are only for sentences that
go straight into a customer's chat.
"""

from __future__ import annotations

from datetime import date, datetime


def spoken_date(value: date | str) -> str:
    """
    '2026-10-17' -> 'Sat, 17 Oct 2026'.

    Built by hand rather than with %-d, which is a GNU extension and raises
    ValueError on Windows.
    """
    if isinstance(value, str):
        try:
            value = datetime.strptime(value[:10], "%Y-%m-%d").date()
        except ValueError:
            return value
    return f"{value:%a}, {value.day} {value:%b %Y}"


def rupees(amount: float | int | str) -> str:
    """
    120000 -> '₹1,20,000'.   9000.5 -> '₹9,000.50'.

    Indian grouping: the last three digits, then pairs. Python's own "{:,}"
    groups in threes (120,000), which reads wrong to an Indian customer.
    """
    value = round(float(amount), 2)
    whole = int(abs(value))
    paise = round((abs(value) - whole) * 100)

    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        pairs = []
        while len(head) > 2:
            pairs.insert(0, head[-2:])
            head = head[:-2]
        if head:
            pairs.insert(0, head)
        digits = ",".join(pairs) + "," + tail

    text = f"₹{digits}" + (f".{paise:02d}" if paise else "")
    return f"-{text}" if value < 0 else text
```

**`backend/app/routers/dashboard.py`** — the `_spoken_date` helper added in Guide
3 now lives in `formatting.py`, so both modules share one copy. Delete the
`def _spoken_date(...)` function from `dashboard.py` and add this import next to
the other `app.` imports:

```python
from app.services.formatting import spoken_date as _spoken_date
```

`decide_booking` keeps calling `_spoken_date(...)` exactly as before.

**`backend/app/repositories/invoices.py`** — complete file:

```python
"""
Invoices.

The rules that matter are in the database (migration 004), not here:

  * numbers come from create_invoice(), ONE Postgres function that bumps a
    counter and inserts the invoice in one transaction - two owners clicking
    at once get 0007 and 0008, never two 0007s, and never a gap
  * an issued invoice cannot be edited (a trigger refuses it)
  * status only moves pending -> paid | cancelled, and paid -> refunded
  * a booking has at most one live invoice
  * the amount is added up by the database from the items

This module calls those rules and turns a refusal into InvoiceRefused(rule).
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone

from app.db import db, one, rows

logger = logging.getLogger("aibh.invoices")

# Every invoice read comes with who it is for and which booking it bills.
SELECT = "*, customers(id, name, phone, email), appointments(id, starts_at, service_name)"

METHODS = {"upi", "cash", "card", "bank_transfer"}

# Every rule the database can refuse with -> what to tell a person.
RULES = {
    "invoices_one_live_per_booking": "This booking already has an invoice that is unpaid or paid.",
    "invoices_immutable": "An issued invoice cannot be edited. Cancel it and issue a new one.",
    "invoices_bad_transition": "That change is not allowed for an invoice in this state.",
    "invoices_no_items": "An invoice needs at least one item.",
    "invoices_bad_item": "Every item needs a description, a quantity of at least 1 and a price of ₹0 or more.",
    "invoices_due_in_past": "The due date cannot be in the past.",
    "invoices_paid_needs_method": "Record how the invoice was paid.",
    "invoices_paid_method_values": "Payment method must be UPI, cash, card or bank transfer.",
    "invoices_number_length": "Invoice numbers can be at most 16 characters - use a prefix of 3 letters or fewer.",
    "invoices_customer_same_business": "That customer does not belong to this business.",
    "invoices_booking_same_business": "That booking does not belong to this business.",
    "invoices_unknown_business": "That business does not exist.",
}

TOKEN_SHAPE = re.compile(r"^[0-9a-f]{32}$")


class InvoiceRefused(Exception):
    """The database refused because of a rule. `rule` is its name."""

    def __init__(self, rule: str, message: str) -> None:
        self.rule = rule
        super().__init__(message)


class NotPending(Exception):
    """The invoice was no longer in the expected state - probably decided in another tab."""


def _explain(exc: Exception) -> Exception:
    text = str(exc)
    for rule, message in RULES.items():
        if rule in text:
            return InvoiceRefused(rule, message)
    return exc


def _run(query):
    """Execute, translating a rule refusal. Anything else is re-raised unchanged."""
    try:
        return query.execute()
    except Exception as exc:  # noqa: BLE001
        explained = _explain(exc)
        if explained is exc:
            raise
        raise explained from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise_number(raw: str | None) -> str:
    """' inv/2026-27/0007 ' -> 'INV/2026-27/0007'. Customers type it every way."""
    return (raw or "").strip().upper().replace("\\", "/").replace(" ", "")


# ---------------------------------------------------------------------- issue


def create(
    *,
    business_id: str,
    customer_id: str,
    items: list[dict],
    due_date: date,
    appointment_id: str | None = None,
    conversation_id: str | None = None,
    notes: str = "",
    prefix: str = "INV",
) -> dict:
    """
    Issue an invoice through the database's create_invoice().

    items: [{"description": str, "quantity": int, "unit_price": number}].
    Any "total" you include is ignored - the database does the arithmetic.
    Raises InvoiceRefused if a rule says no.
    """
    created = one(
        _run(
            db.rpc(
                "create_invoice",
                {
                    "p_business_id": business_id,
                    "p_customer_id": customer_id,
                    "p_items": items,
                    "p_due_date": due_date.isoformat(),
                    "p_appointment_id": appointment_id,
                    "p_conversation_id": conversation_id,
                    "p_notes": notes,
                    "p_prefix": prefix,
                },
            )
        )
    )
    if created is None:
        raise RuntimeError("create_invoice returned nothing")
    logger.info("Invoice %s issued for business %s", created["invoice_number"], business_id)
    return get(business_id, created["id"]) or created


# ----------------------------------------------------------------------- read


def get(business_id: str, invoice_id: str) -> dict | None:
    return one(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .eq("id", invoice_id)
        .limit(1)
        .execute()
    )


def get_by_number(business_id: str, invoice_number: str) -> dict | None:
    number = normalise_number(invoice_number)
    if not number:
        return None
    return one(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .eq("invoice_number", number)
        .limit(1)
        .execute()
    )


def get_by_token(token: str) -> dict | None:
    """
    The ONE read in the codebase that does not filter on business_id.

    The public pay page has no login. The 32-character random token in its URL
    is the permission - like a password in the link - and it only ever unlocks
    this one invoice. Anything not token-shaped is refused before it reaches
    the database.
    """
    if not TOKEN_SHAPE.match(token or ""):
        return None
    return one(
        db.table("invoices")
        .select(SELECT)
        .eq("public_token", token)
        .limit(1)
        .execute()
    )


def list_all(business_id: str, limit: int = 500) -> list[dict]:
    return rows(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )


def list_for_customer(business_id: str, customer_id: str) -> list[dict]:
    return rows(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .execute()
    )


def live_for_booking(business_id: str, appointment_id: str) -> dict | None:
    """The booking's pending or paid invoice, if it has one."""
    return one(
        db.table("invoices")
        .select(SELECT)
        .eq("business_id", business_id)
        .eq("appointment_id", appointment_id)
        .in_("status", ["pending", "paid"])
        .limit(1)
        .execute()
    )


# ------------------------------------------------------ what happens to it


def _update_if(business_id: str, invoice_id: str, patch: dict, *, only_status: str) -> dict:
    """
    Apply `patch` only while the invoice is still `only_status`.

    The status filter is part of the UPDATE itself, so if another tab marked it
    paid a moment ago, this updates nothing and we raise NotPending - instead
    of recording a second payment. The trigger would refuse a bad transition
    anyway; this turns that into a clear message before it gets there.
    """
    changed = rows(
        _run(
            db.table("invoices")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", invoice_id)
            .eq("status", only_status)
        )
    )
    if not changed:
        raise NotPending(f"This invoice is no longer {only_status}.")
    return get(business_id, invoice_id) or changed[0]


def mark_paid(*, business_id: str, invoice_id: str, method: str, reference: str = "") -> dict:
    """The owner saw the money arrive. The ONLY way an invoice becomes paid."""
    if method not in METHODS:
        raise InvoiceRefused("invoices_paid_method_values", RULES["invoices_paid_method_values"])
    return _update_if(
        business_id,
        invoice_id,
        {
            "status": "paid",
            "paid_at": _now(),
            "paid_method": method,
            "paid_reference": (reference or "").strip()[:60],
        },
        only_status="pending",
    )


def cancel(*, business_id: str, invoice_id: str, reason: str = "") -> dict:
    return _update_if(
        business_id,
        invoice_id,
        {"status": "cancelled", "cancelled_at": _now(), "cancel_reason": (reason or "").strip()[:300]},
        only_status="pending",
    )


def refund(*, business_id: str, invoice_id: str, note: str = "") -> dict:
    """Record a refund the owner has ALREADY made, outside this system."""
    return _update_if(
        business_id,
        invoice_id,
        {"status": "refunded", "refunded_at": _now(), "refund_note": (note or "").strip()[:300]},
        only_status="paid",
    )


def record_customer_report(*, business_id: str, invoice_id: str, reference: str = "") -> dict:
    """
    The customer SAYS they paid. Stored as a claim for the owner to check.

    The status stays pending: a message in a chat is not money in a bank.
    """
    return _update_if(
        business_id,
        invoice_id,
        {"customer_reported_at": _now(), "customer_reference": (reference or "").strip()[:60] or None},
        only_status="pending",
    )


def claim_reminder_slot(*, business_id: str, invoice_id: str, hours: int = 24) -> bool:
    """
    True if a reminder may be sent now, and records that it was.

    Check and write in ONE update: "set last_reminded_at = now, but only if
    it is empty or older than 24 hours". Two quick clicks cannot both win.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    changed = rows(
        db.table("invoices")
        .update({"last_reminded_at": _now()})
        .eq("business_id", business_id)
        .eq("id", invoice_id)
        .eq("status", "pending")
        .or_(f"last_reminded_at.is.null,last_reminded_at.lt.{cutoff}")
        .execute()
    )
    return bool(changed)
```

**`backend/scripts/sandbox.py`** — complete file:

```python
"""
A throwaway business for tests that must not touch real data.

A real business's invoice numbers must never have gaps: Indian GST rules ask
for one unbroken series per financial year. So the payment tests never issue
invoices for Pulse Fitness. They create a sandbox business, work inside it,
and delete it - which removes its customers, bookings, invoices and counters
with it.

    from sandbox import create_sandbox, destroy_sandbox
"""

from __future__ import annotations

import uuid

from app.db import db, one


def create_sandbox(label: str, *, upi_id: str | None = "sandbox@okaxis") -> dict:
    """A new, inactive business with the chat and payment capabilities on."""
    tag = uuid.uuid4().hex[:8]
    business = one(
        db.table("businesses")
        .insert(
            {
                "name": f"Sandbox {label} {tag}",
                "slug": f"sandbox-{tag}",
                "chat_slug": f"sandbox-{tag}",
                # Never reachable from a public chat link.
                "is_active": False,
                "chat_enabled": False,
            }
        )
        .execute()
    )
    try:
        # Every row lists every column. In a bulk insert the API fills a key
        # missing from one row with null - which "settings not null" refuses.
        db.table("agent_subscriptions").insert(
            [
                {"business_id": business["id"], "agent_key": "customer_support", "is_active": True, "settings": {}},
                {
                    "business_id": business["id"],
                    "agent_key": "payment",
                    "is_active": True,
                    "settings": {"upi_id": upi_id, "payee_name": None, "invoice_prefix": "INV", "due_days": 7},
                },
            ]
        ).execute()
    except Exception:
        destroy_sandbox(business)  # never leave a half-made sandbox behind
        raise
    return business


def destroy_sandbox(business: dict | None) -> None:
    """Delete the business. Everything that belongs to it goes with it."""
    if business:
        db.table("businesses").delete().eq("id", business["id"]).execute()
```

### Explain the code

```python
def _update_if(business_id, invoice_id, patch, *, only_status):
    changed = rows(... .eq("status", only_status))
    if not changed:
        raise NotPending(...)
```
The owner opens an invoice in two tabs and presses **Mark as paid** in both.
Both updates say *"set paid where status = pending"*. The first matches the row;
by the time the second runs, the status is `paid`, so it matches nothing. We
raise `NotPending`, which the API turns into a 409, and nobody records the
payment twice.

```python
def get_by_token(token: str) -> dict | None:
    if not TOKEN_SHAPE.match(token or ""):
        return None
```
This is the one place that breaks the "every repository filters on `business_id`"
rule, so it is stated loudly in the docstring. The pay page has no login and
cannot know a business id. The unguessable token takes its place, and it only
ever unlocks one invoice. The shape check means junk from the URL is rejected
without a database round trip.

```python
def record_customer_report(...):
    ... {"customer_reported_at": _now(), "customer_reference": ...}
```
Two separate sets of columns: what the **customer claims** and what the **owner
confirmed**. They are never merged. The dashboard shows the claim as a prompt
("Customer says they paid on …, reference …; check your UPI app"), and only
`mark_paid` writes `paid`.

```python
.or_(f"last_reminded_at.is.null,last_reminded_at.lt.{cutoff}")
```
The reminder limit is a check and a write in one statement, for the same reason
as everything else here: two requests cannot both pass. The cutoff is written with
a `Z` rather than `+00:00`, because a `+` in a URL can be read as a space.

```python
def rupees(amount):
```
Python's `f"{120000:,}"` gives `120,000`. Indians write `1,20,000`: three digits,
then pairs. The frontend gets this from `Intl` with `en-IN` (Guide 3, STEP 40).
The backend needs its own copy for the sentences it writes into chat.

### Commands

Make the four small edits, create the new files, then run the test. It needs no
server and no model:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
.\.venv\Scripts\Activate.ps1
cd backend
python scripts\check_invoices.py
```

### How to test

**`backend/scripts/check_invoices.py`** — complete file:

```python
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
```

### Expected result

The financial year will match today's date:

```
numbering
  PASS  first number of the financial year                 INV/2026-27/0001
  PASS  16 characters, the GST limit
  PASS  the DATABASE did the sum (our 'total: 1' ignored)  9000.0
  PASS  token is 32 random hex characters
  PASS  8 at the same moment -> 8 different numbers        [2, 3, 4, 5, 6, 7, 8, 9]
  PASS    ...and no gaps

refusals
  PASS  no items
  PASS  quantity 0
  PASS  due yesterday
  PASS  prefix too long for 16 characters
  PASS  customer of ANOTHER business
  PASS  refusals left no gap in the series                 INV/2026-27/0010

issued invoices never change
  PASS  edit the amount -> refused
  PASS  edit the items -> refused
  PASS  pending -> refunded -> refused
  PASS  paid without how/when -> refused
  PASS  notes CAN change

paying
  PASS  customer says paid -> still pending                412345678901
  PASS  owner marks paid
  PASS  mark paid twice -> the second is not recorded      NotPending
  PASS    ...the first payment stands
  PASS  paid -> refunded

bookings
  PASS  second invoice for the same booking -> refused
  PASS  booking shows paid (trigger)
  PASS  cancel a wrong invoice, then reissue               INV/2026-27/0013

lookups and reminders
  PASS  find by pay-page token
  PASS  junk token -> nothing, no query
  PASS  find by number, typed carelessly
  PASS  another business cannot find it by number
  PASS  first reminder allowed
  PASS  second within 24 hours -> refused

Indian formatting
  PASS  rupees                                             ₹1,20,000
  PASS  rupees with paise                                  ₹9,000.50
  PASS  spoken date                                        Sat, 3 Oct 2026

sandbox removed: True

ALL PASS
```

Two results matter most:

- **`8 at the same moment -> 8 different numbers ... and no gaps`**. Eight
  threads call `create_invoice()` at once. Without the row lock, several would
  get the same number and the unique constraint would reject them.
- **`refusals left no gap in the series`**. Five invoices were refused, and the
  next good one is still `0010`, straight after `0009`. Each refused call rolled
  its counter bump back.

### What happened when this was actually run (26 Sep 2026)

The first run failed before it tested anything, inside `sandbox.py`:

```
null value in column "settings" of relation "agent_subscriptions" violates not-null constraint
```

When you insert **several rows in one call**, Supabase's API sends every column
that appears in **any** row, and fills the gaps with `null`. The `payment` row had
`settings` and the `customer_support` row did not, so the second row went in as
`settings = null`, which the column refuses. The fix, already in the code above,
gives every row every column (`"settings": {}`). The same failure also left a
half-made sandbox business behind, so `create_sandbox` now deletes its own
business if anything after the first insert fails.

After that fix, all 34 checks passed on the first run, including the eight
simultaneous invoices.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `Could not find the function public.create_invoice` | Migration 004 not run, or the API has not reloaded | Run it; if you just did, `notify pgrst, 'reload schema';` |
| `permission denied for function create_invoice` | `backend/.env` has the anon key, not the service role key | `SUPABASE_SERVICE_ROLE_KEY` must be the **service_role** secret. |
| `Could not embed because more than one relationship was found` | An extra foreign key between invoices and customers | Check `pg_constraint` for invoices; there should be one to customers. |
| `FAIL 8 at the same moment` with a duplicate | The counter update is not using `on conflict ... do update` | Re-run section 6 of 004. |
| `ModuleNotFoundError: No module named 'sandbox'` | Script run from the wrong folder | Run from `backend/`, as `python scripts\check_invoices.py`. |
| `sandbox removed: False` | The script crashed before cleanup | `delete from businesses where slug like 'sandbox-%';` |

---

## End of Part 0 — checklist

- [ ] `004_payments_agent.sql` applied; `payment_active = true`
- [ ] `invoices.py`, `formatting.py`, `sandbox.py` created; the four small edits made
- [ ] `python scripts\check_invoices.py` prints `ALL PASS`

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add backend database docs
git commit -m "Add invoices: gapless numbering, immutability and the owner gate in Postgres"
```

Next: [01-tools-and-agent.md](01-tools-and-agent.md) — what the chat may do with
an invoice, which is very little.
