# Guide 3, Part 0 — Overview and the database (STEP 34 → STEP 35)

The third capability. Until now a "customer" was a side effect: a row that
appeared when the chat captured a phone number, with nothing behind the
`/dashboard/customers` screen except mock data.

After this guide:

- the owner has a **real client directory**, with status, spend, last visit and
  bookings calculated from the real `appointments` table
- the owner can **add and edit** customers from the dashboard
- the chat agent can **remember** what a customer tells it ("I prefer mornings",
  "I'm interested in the yoga trial") so the owner sees it next time
- a customer can say **"stop sending me offers"** in chat, and that is recorded
  in a way the future Communication agent cannot ignore

**Prerequisite:** the Booking Agent works. `python scripts\check_bookings.py`
and `python scripts\check_approval.py` both pass. See
[RUN-AND-TEST.md](../RUN-AND-TEST.md).

---

## What you do NOT have to do

| | |
| --- | --- |
| New accounts or keys | **None.** Same Supabase, same OpenRouter key. |
| New model | **None.** Same `LLM_MODEL`. |
| New chat UI | **None.** Same `/chat/<slug>`. |
| A new agent | **None.** Same agent loop — one more capability. |

What you build: one migration, two repositories, one toolset with two tools, one
prompt block, four dashboard routes, and the wiring for a screen that already
exists.

---

## The one genuinely new problem: who is this?

Every earlier capability could trust its inputs. A booking needs a phone number,
and the booking is **for** whoever typed it — if you type someone else's number,
you have booked yourself a slot under their name, and cancelling needs that same
number.

A customer record is different. It holds things about a **person**, and the chat
is public. Anyone can open `/chat/pulse-fitness` and type
*"my number is 98765 00011"*. The chat has no way to know it is really Ravi.

So the design follows one rule:

> **The chat can add to a customer record. It can never read one back, and it
> can never overwrite one.**

What that means in practice:

| The chat agent can | The chat agent can NOT |
| --- | --- |
| Create a new customer when someone gives a number | Look up a customer by number |
| Fill in a **blank** name or email | Change a name, phone or email that is already set |
| Add a note: "prefers mornings" | Read notes back ("what do you know about me?") |
| Record **opt-out** from offers | Record **opt-in** to offers |

The last row is the interesting one. If a stranger types your number and says
"stop sending me offers", the worst case is you miss a discount. If a stranger
could type your number and say "yes, send me offers", they could sign you up for
messages you never agreed to. Opt-out is safe from chat; opt-in is not. So only
the owner, in the dashboard, can opt someone in — and **the database enforces
it**, not the prompt.

---

## Do we need the supervisor yet?

No. We agreed to revisit it at 4–5 capabilities. After this guide:

| Capability | Tools |
| --- | --- |
| `customer_support` | 5 |
| `booking` | 4 |
| `customers` | 2 |

Three capabilities, eleven tools. The model is choosing between eleven tool
descriptions, which it does comfortably. The next agent (Payments) makes four,
and that is where [booking-agent/03-troubleshooting.md](../booking-agent/03-troubleshooting.md)
says to stop and decide.

---

## Architecture after this guide

```
  Customer's chat  (unchanged)
        │
        ▼
  assistant.run()          ONE agent loop, tools composed per subscription
        │
        ├── customer_support   5 tools
        ├── booking            4 tools
        └── customers          remember_about_customer
                               set_marketing_preference
        │
        ▼
  Supabase
        ├── customers          + status_override, membership_plan,
        │                        preferred_channel, source, marketing_consent
        ├── customer_notes     append-only, written by the agent
        └── customer_overview  a VIEW: status, spend, last visit, bookings
                               calculated from appointments on every read
        │
        ▼
  Owner dashboard  /dashboard/customers
        list · detail · add · edit notes · opt in (owner only)
```

---

## STEP 34 — The customers migration

### Goal

Add the fields the Customers screen needs, a table for the agent's notes, and a
view that calculates each customer's status and spend from their bookings.

### Why?

The mock screen shows things the database does not have yet: a status (active /
lead / inactive), total spend, last visit, a membership plan, a preferred contact
channel. There are two ways to get them:

1. **Store them** on `customers` and update them whenever something happens.
2. **Calculate them** from `appointments` every time they are read.

Storing them means every code path that touches a booking must remember to
update the customer too: approve, reject, cancel from chat, mark completed. Miss
one and the numbers drift, silently, forever. Calculating them means there is
nothing to forget. At a few hundred customers the calculation is instant.

So: **calculated values live in a view; only things a human decides are stored.**

### Architecture

```
  customers ─────────────┐
  (what a human decided)  │
                          ├──►  customer_overview  (VIEW)
  appointments ───────────┘      status        = override, else from bookings
  (what actually happened)       total spend   = sum of COMPLETED bookings
                                 last visit    = latest COMPLETED booking
                                 bookings      = count
                                 upcoming      = pending/confirmed, in future

  customer_notes  ──► (customer_id, business_id) ──► customers
  (the agent's notes)   composite foreign key: a note can never point at
                        another business's customer
```

**Status rules**, in order:

| Status | When |
| --- | --- |
| whatever the owner set | `status_override` is not null |
| `active` | a confirmed or completed booking in the last 60 days, or upcoming |
| `inactive` | has had a confirmed or completed booking, but not recently |
| `lead` | has never had one — they only chatted, or only have pending/cancelled |

### Files involved

```
database/
└── migrations/
    └── 003_customers_agent.sql     ← new
```

### Code

**`database/migrations/003_customers_agent.sql`** — complete file:

```sql
-- ============================================================================
-- 003_customers_agent.sql
-- The Customers Agent: a real client directory behind /dashboard/customers.
-- Run once, in the Supabase SQL Editor. Safe to re-run: every statement is
-- "if not exists" or ignores "already exists".
-- ============================================================================

-- ------------------------------------------------ 1. new fields on customers
-- Only things a HUMAN decides are stored. Status, spend and last visit are
-- calculated from appointments in the view at the bottom of this file.
alter table public.customers
  add column if not exists status_override    text,
  add column if not exists membership_plan    text,
  add column if not exists preferred_channel  text,
  add column if not exists source             text not null default 'chat',
  add column if not exists marketing_consent  text not null default 'unknown',
  add column if not exists consent_source     text,
  add column if not exists consent_updated_at timestamptz;

-- ------------------------------------------- 2. rules the database enforces
-- Each rule is in its own block, so re-running the file skips the ones that
-- already exist instead of failing.

-- Phones are stored one way only: +<country code><number>, 10-15 digits.
-- The unique index on (business_id, phone) only works if '98765 43210' and
-- '+919876543210' cannot both be stored.
do $$ begin
  alter table public.customers add constraint customers_phone_format
    check (phone is null or phone ~ '^\+[0-9]{10,15}$');
exception when duplicate_object then null; end $$;

-- Emails are stored lowercase for the same reason.
do $$ begin
  alter table public.customers add constraint customers_email_format
    check (email is null or (
      email = lower(btrim(email))
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ));
exception when duplicate_object then null; end $$;

-- A record has to identify somebody.
do $$ begin
  alter table public.customers add constraint customers_identifiable
    check (coalesce(btrim(name), '') <> '' or phone is not null or email is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.customers add constraint customers_status_override_values
    check (status_override is null or status_override in ('lead', 'active', 'inactive'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.customers add constraint customers_channel_values
    check (preferred_channel is null or preferred_channel in ('sms', 'whatsapp', 'email'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.customers add constraint customers_source_values
    check (source in ('chat', 'dashboard', 'import'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.customers add constraint customers_consent_values
    check (
      marketing_consent in ('unknown', 'opted_in', 'opted_out')
      and (consent_source is null or consent_source in ('chat', 'dashboard'))
    );
exception when duplicate_object then null; end $$;

-- THE consent rule. Anyone can type anyone's number into a public chat, so a
-- chat may record an opt-OUT but never an opt-IN. Only the owner can opt a
-- customer in, from the dashboard, after asking them in person.
do $$ begin
  alter table public.customers add constraint customers_opt_in_needs_owner
    check (marketing_consent <> 'opted_in' or consent_source = 'dashboard');
exception when duplicate_object then null; end $$;

-- Lets other tables reference (id, business_id) as a pair. See customer_notes.
do $$ begin
  alter table public.customers add constraint customers_id_business_key
    unique (id, business_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- ----------------------------------------------------- 3. the agent's notes
-- Append-only. The owner's own notes stay in customers.notes, so nothing the
-- agent writes can ever overwrite what the owner typed.
create table if not exists public.customer_notes (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  customer_id     uuid not null,
  conversation_id uuid references public.conversations (id) on delete set null,

  kind   text not null default 'note'
           check (kind in ('preference', 'interest', 'note')),
  body   text not null
           check (char_length(btrim(body)) between 3 and 300),
  author text not null default 'agent'
           check (author in ('agent', 'owner')),

  created_at timestamptz not null default now(),

  -- The PAIR must exist in customers. A note can never be attached to a
  -- customer of a different business, even if Python passes the wrong id.
  foreign key (customer_id, business_id)
    references public.customers (id, business_id) on delete cascade
);

create index if not exists customer_notes_customer_idx
  on public.customer_notes (business_id, customer_id, created_at desc);

-- Models repeat themselves. The same note twice on one customer is refused,
-- whatever the capitalisation or surrounding spaces.
create unique index if not exists customer_notes_no_repeats
  on public.customer_notes (customer_id, kind, lower(btrim(body)));

alter table public.customer_notes enable row level security;

drop policy if exists customer_notes_member_access on public.customer_notes;
create policy customer_notes_member_access on public.customer_notes
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------------------------ 4. the directory view
-- Calculated on every read, so nothing has to remember to keep it up to date.
--
-- security_invoker = true makes the view obey the row level security of the
-- tables underneath it. Without it, a view runs with its OWNER's rights and
-- would show every business's customers to anyone allowed to read the view.
drop view if exists public.customer_overview;

create view public.customer_overview
with (security_invoker = true) as
select
  c.*,
  coalesce(s.bookings_count, 0)  as bookings_count,
  coalesce(s.upcoming_count, 0)  as upcoming_count,
  coalesce(s.completed_spend, 0) as completed_spend,
  s.last_visit_date,
  coalesce(
    c.status_override,
    case
      when coalesce(s.recent_count, 0) > 0 then 'active'
      when coalesce(s.ever_count, 0) > 0   then 'inactive'
      else 'lead'
    end
  ) as status,
  c.status_override is null as status_is_automatic
from public.customers c
join public.businesses b on b.id = c.business_id
left join lateral (
  select
    count(*) as bookings_count,
    count(*) filter (
      where a.status in ('pending', 'confirmed') and a.starts_at >= now()
    ) as upcoming_count,
    sum(a.price) filter (where a.status = 'completed') as completed_spend,
    -- The business's local date, not the UTC one: a 7 AM IST visit is
    -- 01:30 UTC and must not show as the day before.
    max((a.starts_at at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date)
      filter (where a.status = 'completed') as last_visit_date,
    count(*) filter (
      where a.status in ('confirmed', 'completed')
        and a.starts_at >= now() - interval '60 days'
    ) as recent_count,
    count(*) filter (where a.status in ('confirmed', 'completed')) as ever_count
  from public.appointments a
  where a.customer_id = c.id
    and a.business_id = c.business_id
) s on true;

-- ------------------------------------------------ 5. switch it on for the gym
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
select id, 'customers', true, '{}'::jsonb
  from public.businesses
 where chat_slug = 'pulse-fitness'
on conflict (business_id, agent_key) do update set is_active = true;

-- Tell the API layer about the new table and view straight away.
notify pgrst, 'reload schema';

-- Confirm
select
  (select count(*) from public.customer_overview) as customers_in_view,
  (select count(*) from public.customer_notes)    as notes,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'customers')                 as customers_active;
```

### Explain the code

```sql
add column if not exists status_override text,
```
Called `status_override`, not `status`, on purpose. Status is normally
**calculated** from bookings. This column only holds the owner's decision when
they want to overrule that, for example marking a walk-in member `active` before
they have booked anything. `null` means "work it out".

```sql
check (phone is null or phone ~ '^\+[0-9]{10,15}$');
```
The unique index from migration 001 stops two customers having the same phone.
But `+919876543210` and `98765 43210` are different strings, so without this
check the same person could be stored twice. Python already normalises every
number; this check makes sure nothing that skips Python can break the rule.

```sql
check (marketing_consent <> 'opted_in' or consent_source = 'dashboard');
```
Read it as: *"if this customer is opted in, the owner must have done it."* The
chat tool will never try to opt anyone in — but the tool is Python, and Python
can change. The constraint cannot be forgotten. STEP 35's test proves it by
trying to opt someone in from chat and watching the database refuse.

```sql
foreign key (customer_id, business_id)
  references public.customers (id, business_id) on delete cascade
```
A normal foreign key would only check that the customer **exists**. This one
checks that the customer exists **and belongs to the same business as the note**.
Our backend uses the `service_role` key, which bypasses row level security, so
tenant isolation depends on every query passing the right `business_id`. This
turns one class of mistake into an error instead of a leak. It needs the
`unique (id, business_id)` constraint above it, because a foreign key can only
point at columns that are unique together.

```sql
create unique index ... on public.customer_notes (customer_id, kind, lower(btrim(body)));
```
The same idea as the double-booking index, for a smaller problem. If the model
calls `remember_about_customer("Prefers mornings")` twice in a conversation, or
in two conversations, the second insert fails and the repository reports
"already noted". `lower(btrim(...))` means `"Prefers mornings "` and
`"prefers mornings"` count as the same note.

```sql
with (security_invoker = true)
```
The most important line in the view, and it is easy to leave out. A Postgres
view normally runs with the permissions of whoever **created** it — in the SQL
Editor, that is a superuser. Supabase exposes every view in `public` to the API,
so a plain view would let anyone with the public anon key read every business's
customers, whatever the table policies say. `security_invoker` makes the view
check permissions as the person **reading** it, so the `customers` row level
security still applies.

```sql
sum(a.price) filter (where a.status = 'completed') as completed_spend,
```
Uses the price **snapshotted on the booking** (Guide 2, STEP 26), not today's
service price. It counts only completed bookings, because a confirmed booking
might still be cancelled. This is honest but limited. It is not money
**received** — payments do not exist yet. The screen labels it that way.

```sql
max((a.starts_at at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date)
```
The UTC-versus-local-date trap from the environment notes. A 7 AM class in
Hyderabad is 01:30 UTC; taking the date in UTC would report the visit as the
previous day. We convert to the business's own timezone first.

```sql
on conflict (business_id, agent_key) do update set is_active = true;
```
Unlike `payment`, there was no `customers` row in the seed, so we insert one.
`on conflict` makes re-running the file harmless.

```sql
notify pgrst, 'reload schema';
```
Supabase's API layer (PostgREST) caches the list of tables and views. It usually
notices new ones by itself; this line makes it notice immediately, so the backend
does not say *"relation customer_notes does not exist"* for the next minute.

### Commands

Open the Supabase dashboard → your project → **SQL Editor** → **New query**.
Paste the whole file and press **Run**.

### How to test

Still in the SQL Editor:

```sql
-- 1. the view works, and every existing customer is in it
select name, phone, status, status_is_automatic, bookings_count, completed_spend
  from public.customer_overview
 order by created_at;

-- 2. the phone format rule
insert into public.customers (business_id, name, phone)
select id, 'Bad Phone', '98765 43210' from public.businesses where chat_slug = 'pulse-fitness';

-- 3. the consent rule: an opt-in that did not come from the dashboard
update public.customers
   set marketing_consent = 'opted_in', consent_source = 'chat'
 where phone = '+919876500011';
```

### Expected result

Query 1 lists your existing customers. People who only chatted show `lead`. If
you ran the Booking Agent tests, Ravi Kumar shows `lead` too, because his only
booking was cancelled.

```
name            | phone          | status | status_is_automatic | bookings_count | completed_spend
----------------+----------------+--------+---------------------+----------------+----------------
Akshaya         | +919876543210  | lead   | true                | ...            | 0
...
```

Query 2 **fails**:

```
ERROR: new row for relation "customers" violates check constraint "customers_phone_format"
```

Query 3 **fails**:

```
ERROR: new row for relation "customers" violates check constraint "customers_opt_in_needs_owner"
```

Both failures are the point. Those two rules now hold whatever the Python does.

The confirm query at the end of the migration shows
`customers_active = true`.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `check constraint "customers_phone_format" is violated by some row` | An existing phone is not in `+<digits>` form | `select id, phone from customers where phone !~ '^\+[0-9]{10,15}$';` then fix or null those rows and re-run. |
| `check constraint "customers_email_format" is violated by some row` | An existing email has capitals or no `@` | `update customers set email = lower(btrim(email));` then re-run. |
| `relation "public.appointments" does not exist` | Migration 002 not applied | Run `002_booking_agent.sql` first. |
| `function public.is_business_member does not exist` | Migration 001 not applied | Run 001 first. |
| `syntax error at or near "security_invoker"` | Postgres older than 15 | Every new Supabase project is 15+. Check under Project Settings → Infrastructure. |
| Query 2 **succeeds** | The check was not added | Re-run just that `do $$ ... $$` block and read the error. |
| `customers_active` is null | No business has `chat_slug = 'pulse-fitness'` | Change the slug in section 5 to yours. |

---

## STEP 35 — The customer repositories

### Goal

The Python that reads and writes customers and notes, filtered by
`business_id` everywhere, and turning the database's refusals into errors a
person can understand.

### Why?

The database now refuses bad data. That is the safety net, but a raw Postgres
error is no use to an owner who typed a phone number that already exists. The
repository catches the refusal and raises `DuplicateCustomer("phone number")`,
which the dashboard turns into *"Another customer already has this phone
number."*

Same pattern as `SlotTaken` in Guide 2: the database guarantees the rule, Python
explains it.

### Files involved

```
backend/
├── app/repositories/
│   ├── customers.py         ← edit (the complete new version is below)
│   └── customer_notes.py    ← new
└── scripts/
    └── check_customers.py   ← new
```

### Code

**`backend/app/repositories/customers.py`** — complete file:

```python
"""
Customer records.

A customer appears in one of two ways:

  * From chat - upsert_from_chat(), when the agent captures a phone number or
    an email. It only ever FILLS BLANKS and never overwrites. Anyone can type
    anyone's number into a public chat, so chat must never be able to rewrite
    a record that already exists.
  * From the dashboard - create() and update(), by the owner.

The rules both paths share live in the database (migration 003): one record
per phone, one per email, phones as +<digits>, emails in lowercase, and chat
can never opt anyone in to marketing. This module turns the database's
refusals into two exceptions the callers can explain to a person.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from app.db import db, one, rows

logger = logging.getLogger("aibh.customers")

# Postgres error codes, as supabase-py passes them through.
UNIQUE_VIOLATION = "23505"
CHECK_VIOLATION = "23514"

STATUSES = {"lead", "active", "inactive"}
CHANNELS = {"sms", "whatsapp", "email"}
CONSENTS = {"unknown", "opted_in", "opted_out"}

# What the owner may edit from the dashboard. Everything else - id,
# business_id, source, created_at, the consent columns - is set by the system.
EDITABLE = {
    "name",
    "phone",
    "email",
    "notes",
    "tags",
    "status_override",
    "membership_plan",
    "preferred_channel",
}

EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DuplicateCustomer(Exception):
    """Another customer of this business already has that phone or email."""

    def __init__(self, field: str) -> None:
        self.field = field
        super().__init__(f"Another customer already has this {field}.")


class InvalidCustomer(Exception):
    """A value the database (or we) refused, e.g. a phone that is not +<digits>."""


def normalise_phone(raw: str | None) -> str | None:
    """
    '+91 98765 43210' -> '+919876543210'
    '9876543210'      -> '+919876543210'   (assumes India when no country code)

    Returns None for anything that is not plausibly a phone number, so we never
    store junk the agent extracted from a sentence. 10 to 15 digits is the
    international range, and the database checks exactly the same thing.
    """
    if not raw:
        return None
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    if len(digits) < 10 or len(digits) > 15:
        return None
    if len(digits) == 10:
        digits = f"91{digits}"
    return f"+{digits}"


def normalise_email(raw: str | None) -> str | None:
    """' Ravi@Gmail.com ' -> 'ravi@gmail.com'. None if it is not email-shaped."""
    clean = (raw or "").strip().lower()
    return clean if EMAIL_SHAPE.match(clean) else None


def _explain(exc: Exception) -> Exception:
    """
    Turn a database refusal into DuplicateCustomer or InvalidCustomer.

    Anything else comes back unchanged and the caller re-raises it. A dead
    connection must never be reported to the owner as "duplicate phone".
    """
    text = str(exc)
    if UNIQUE_VIOLATION in text:
        if "phone" in text:
            return DuplicateCustomer("phone number")
        if "email" in text:
            return DuplicateCustomer("email address")
        return DuplicateCustomer("details")
    if CHECK_VIOLATION in text:
        return InvalidCustomer(text)
    return exc


def _run(query):
    """Execute a write, translating refusals. Returns the supabase response."""
    try:
        return query.execute()
    except Exception as exc:  # noqa: BLE001
        explained = _explain(exc)
        if explained is exc:
            raise
        raise explained from exc


# ---------------------------------------------------------------------- reads


def get(business_id: str, customer_id: str) -> dict | None:
    return one(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )


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


def get_by_email(business_id: str, email: str | None) -> dict | None:
    address = normalise_email(email)
    if not address:
        return None
    return one(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .eq("email", address)
        .limit(1)
        .execute()
    )


def list_customers(business_id: str, limit: int = 100) -> list[dict]:
    return rows(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .order("last_seen_at", desc=True)
        .limit(limit)
        .execute()
    )


def list_overview(business_id: str, limit: int = 500) -> list[dict]:
    """Every customer plus their calculated status, spend and booking counts."""
    return rows(
        db.table("customer_overview")
        .select("*")
        .eq("business_id", business_id)
        .order("last_seen_at", desc=True)
        .limit(limit)
        .execute()
    )


def get_overview(business_id: str, customer_id: str) -> dict | None:
    return one(
        db.table("customer_overview")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )


# ------------------------------------------------------------ writes: chat


def upsert_from_chat(
    *,
    business_id: str,
    name: str | None = None,
    phone: str | None = None,
    email: str | None = None,
) -> dict | None:
    """
    Create or update a customer from details captured in a conversation.

    Matches on phone first, then email. Only FILLS BLANKS on an existing
    record: whoever is typing may not be the person that number belongs to.
    Returns None when there is nothing identifying - a name alone is not
    enough to make a customer from chat.
    """
    clean_phone = normalise_phone(phone)
    clean_email = normalise_email(email)
    clean_name = (name or "").strip() or None

    if not clean_phone and not clean_email:
        return None

    existing = get_by_phone(business_id, clean_phone) if clean_phone else None
    if existing is None and clean_email:
        existing = get_by_email(business_id, clean_email)

    if existing is None:
        try:
            created = one(
                _run(
                    db.table("customers").insert(
                        {
                            "business_id": business_id,
                            "name": clean_name,
                            "phone": clean_phone,
                            "email": clean_email,
                            "source": "chat",
                        }
                    )
                )
            )
            if created:
                return created
        except DuplicateCustomer:
            # Two chats gave the same number at the same moment and the other
            # one won. The unique index refused ours, so use theirs.
            pass
        existing = get_by_phone(business_id, clean_phone) or get_by_email(
            business_id, clean_email
        )
        if existing is None:
            return None

    patch: dict = {"last_seen_at": datetime.now(timezone.utc).isoformat()}
    if clean_name and not existing.get("name"):
        patch["name"] = clean_name
    if clean_phone and not existing.get("phone"):
        patch["phone"] = clean_phone
    if clean_email and not existing.get("email"):
        patch["email"] = clean_email

    try:
        _run(
            db.table("customers")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", existing["id"])
        )
    except DuplicateCustomer:
        # The email we tried to fill in belongs to someone else. Keep the
        # record as it was rather than fail the customer's chat.
        patch = {"last_seen_at": patch["last_seen_at"]}
        db.table("customers").update(patch).eq("business_id", business_id).eq(
            "id", existing["id"]
        ).execute()
    return {**existing, **patch}


# ------------------------------------------------------- writes: dashboard


def _clean(fields: dict) -> dict:
    """
    Normalise what the owner typed. An empty string means "clear this field".

    Raises InvalidCustomer for a value we can already tell is wrong, so the
    owner gets "That does not look like a phone number" rather than the raw
    constraint name.
    """
    out: dict = {}
    for key, value in fields.items():
        if key not in EDITABLE:
            continue
        if key == "phone":
            if not value:
                out["phone"] = None
            else:
                phone = normalise_phone(value)
                if phone is None:
                    raise InvalidCustomer("That does not look like a phone number.")
                out["phone"] = phone
        elif key == "email":
            if not value:
                out["email"] = None
            else:
                email = normalise_email(value)
                if email is None:
                    raise InvalidCustomer("That does not look like an email address.")
                out["email"] = email
        elif key == "status_override":
            if value in (None, "", "auto"):
                out[key] = None
            elif value in STATUSES:
                out[key] = value
            else:
                raise InvalidCustomer(f"Unknown status '{value}'.")
        elif key == "preferred_channel":
            if not value:
                out[key] = None
            elif value in CHANNELS:
                out[key] = value
            else:
                raise InvalidCustomer(f"Unknown contact channel '{value}'.")
        elif key == "tags":
            out["tags"] = sorted({str(t).strip() for t in (value or []) if str(t).strip()})
        elif key == "notes":
            out["notes"] = (value or "").strip()
        else:  # name, membership_plan
            out[key] = (value or "").strip() or None
    return out


def create(business_id: str, fields: dict) -> dict:
    """Add a customer from the dashboard. Raises DuplicateCustomer / InvalidCustomer."""
    row = _clean(fields)
    row["business_id"] = business_id
    row["source"] = "dashboard"
    created = one(_run(db.table("customers").insert(row)))
    if created is None:
        raise RuntimeError("Could not create the customer")
    logger.info("Customer %s created from the dashboard", created["id"])
    return created


def update(business_id: str, customer_id: str, fields: dict) -> dict | None:
    """Edit a customer from the dashboard. Returns None if it does not exist."""
    patch = _clean(fields)
    if patch:
        _run(
            db.table("customers")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", customer_id)
        )
    return get(business_id, customer_id)


def set_marketing_consent(
    *, business_id: str, customer_id: str, consent: str, source: str
) -> dict | None:
    """
    Record whether a customer wants offers.

    There is deliberately NO Python check that chat cannot opt someone in.
    The database refuses it (customers_opt_in_needs_owner), and
    check_customers.py proves that by trying.
    """
    if consent not in CONSENTS:
        raise InvalidCustomer(f"Unknown consent value '{consent}'.")
    _run(
        db.table("customers")
        .update(
            {
                "marketing_consent": consent,
                "consent_source": source,
                "consent_updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("business_id", business_id)
        .eq("id", customer_id)
    )
    return get(business_id, customer_id)
```

**`backend/app/repositories/customer_notes.py`** — complete file:

```python
"""
Notes the agent takes about a customer during a chat.

Append-only: nothing in the code edits or deletes a note. The owner's own
free-text notes live in customers.notes, a separate column, so nothing the
agent writes can overwrite what the owner typed.
"""

from __future__ import annotations

import logging

from app.db import db, one, rows

logger = logging.getLogger("aibh.customer_notes")

UNIQUE_VIOLATION = "23505"
CHECK_VIOLATION = "23514"

KINDS = {"preference", "interest", "note"}


class AlreadyNoted(Exception):
    """This customer already has the same note. Not an error for the caller."""


class InvalidNote(Exception):
    """Too short, too long, or an unknown kind - refused by the database."""


def add(
    *,
    business_id: str,
    customer_id: str,
    body: str,
    kind: str = "note",
    author: str = "agent",
    conversation_id: str | None = None,
) -> dict:
    """
    Append one note. Raises AlreadyNoted if the same note is already there.

    Whitespace is collapsed first, so "Prefers   mornings" and "Prefers
    mornings" are the same note to the unique index.
    """
    text = " ".join((body or "").split())
    try:
        created = one(
            db.table("customer_notes")
            .insert(
                {
                    "business_id": business_id,
                    "customer_id": customer_id,
                    "conversation_id": conversation_id,
                    "kind": kind,
                    "body": text,
                    "author": author,
                }
            )
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if UNIQUE_VIOLATION in message:
            raise AlreadyNoted(text) from exc
        if CHECK_VIOLATION in message:
            raise InvalidNote(message) from exc
        raise

    if created is None:
        raise RuntimeError("Could not save the note")
    logger.info("Note added to customer %s by %s", customer_id, author)
    return created


def list_for_customer(business_id: str, customer_id: str, limit: int = 50) -> list[dict]:
    return rows(
        db.table("customer_notes")
        .select("*")
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
```

### Explain the code

```python
def _run(query):
    try:
        return query.execute()
    except Exception as exc:
        explained = _explain(exc)
        if explained is exc:
            raise
        raise explained from exc
```
Every write goes through here. If the database refused because of a unique
index or a check constraint, the caller gets a named exception it can handle.
Anything else is re-raised **unchanged**. Swallowing a genuine failure and
reporting it as "duplicate phone" would be a lie.

```python
if "phone" in text:
    return DuplicateCustomer("phone number")
```
We know which rule was broken from the index name in the error:
`customers_business_phone_uidx` or `customers_business_email_uidx`. That is why
the index names in the migrations are descriptive.

```python
    except DuplicateCustomer:
        # Two chats gave the same number at the same moment and the other
        # one won.
```
The same race as double booking, on a smaller scale. Two browser tabs submit the
same number within a few milliseconds; both look it up, both find nothing, both
insert. The unique index lets exactly one through, and the loser simply uses the
winner's row. Nobody sees an error.

```python
if clean_name and not existing.get("name"):
    patch["name"] = clean_name
```
The **fill-blanks** rule. If Ravi's record already has a name, a chat saying
*"I'm Suresh, my number is 98765 00011"* does not rename him. It could be a
typo, or a stranger. The owner can change a name from the dashboard; the chat
cannot.

```python
elif key == "status_override":
    if value in (None, "", "auto"):
        out[key] = None
```
The dashboard sends `"auto"` for "work it out from bookings", which is stored as
`null`. This keeps the rule "null means calculated" in one place.

```python
There is deliberately NO Python check that chat cannot opt someone in.
```
It would be easy to add `if source == "chat" and consent == "opted_in": raise`.
We leave it out so the **test can prove the database is the guard**. If someone
later "simplifies" the migration and drops the constraint, `check_customers.py`
fails loudly instead of the rule silently disappearing.

```python
text = " ".join((body or "").split())
```
Collapses runs of spaces and newlines. The unique index lowercases and trims,
but it cannot collapse inner whitespace, so we do it before inserting.

### Commands

Replace `customers.py` with the complete version above and create
`customer_notes.py`. The rest of the backend keeps working: `get_by_phone`,
`upsert_from_chat` and `list_customers` still have the same names and
arguments.

Then create the test script below and run it:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
.\.venv\Scripts\Activate.ps1
cd backend
python scripts\check_customers.py
```

### How to test

**`backend/scripts/check_customers.py`** — complete file:

```python
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
```

### Expected result

```
customers
  PASS  create normalises the phone                      +919000000101
  PASS  create normalises the email                      check.customer@example.com
  PASS  create trims the name                            'Check Customer'
  PASS  create marks the source                          dashboard
  PASS  same phone, different format -> refused
  PASS  same email, different case -> refused
  PASS  raw insert, phone '98765 43210' -> refused
  PASS  raw insert, email 'Mixed@Case.com' -> refused
  PASS  raw insert, nothing identifying -> refused
  PASS  raw insert, status 'vip' -> refused
  PASS  chat opt-out -> recorded
  PASS  chat opt-in -> refused BY THE DATABASE
  PASS  dashboard opt-in -> recorded
  PASS  chat with a known phone -> same record
  PASS  chat did NOT rename them
  PASS  no bookings -> lead                              lead
  PASS  completed visit 3 days ago -> active             active
  PASS  spend = the booking's snapshot price             1500.0
  PASS  last visit is set                                2026-09-23
  PASS  owner override wins
  PASS  'auto' goes back to calculated

customer_notes
  PASS  note added                                       Prefers morning sessions
  PASS  same note, different case/spaces -> AlreadyNoted
  PASS  two-letter note -> InvalidNote
  PASS  note for this customer under ANOTHER business -> refused
  PASS  list_for_customer finds it
  PASS  cleaned up (customer, booking and note gone)

ALL PASS
```

The lines that matter most:

- **`raw insert ... -> refused`** (four lines). These skip Python and talk to the
  table directly. They still fail, so the rules hold for any code that ever
  writes a customer, not just this module. `refused_by` passes only if the error
  names **that** rule (for example `customers_phone_format`). The first draft of
  this script passed on any error at all, which means a typo in the test would
  have looked like a working constraint.
- **`chat opt-in -> refused BY THE DATABASE`**. There is no Python check for
  this. It is the constraint alone.
- **`note for this customer under ANOTHER business -> refused`**. The composite
  foreign key catches a wrong `business_id`.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `relation "public.customer_overview" does not exist` | Migration 003 not run, or the API has not reloaded | Run 003. If you just ran it, wait a minute or run `notify pgrst, 'reload schema';` |
| `column customers.source does not exist` | Same | Run 003. |
| `FAIL chat opt-in -> refused BY THE DATABASE` | The `customers_opt_in_needs_owner` constraint is missing | Re-run that block of 003 and read the error. |
| `FAIL raw insert ... -> refused` | One of the check constraints is missing | `select conname from pg_constraint where conrelid = 'public.customers'::regclass;` |
| `DuplicateCustomer` on the very first create | Left over from a run that crashed | `delete from customers where phone = '+919000000101';` |
| `FAIL completed visit 3 days ago -> active` | Timezone or status mismatch in the view | Re-run section 4 of 003. |
| `httpx.ConnectError: [SSL: UNEXPECTED_EOF_WHILE_READING]` | Your network is intercepting `*.supabase.co` | Not a code bug. See [RUN-AND-TEST.md](../RUN-AND-TEST.md). |

---

## End of Part 0 — checklist

- [ ] `003_customers_agent.sql` applied; confirm query shows `customers_active = true`
- [ ] Inserting `'98765 43210'` as a phone fails in the SQL Editor
- [ ] An opt-in from `chat` fails in the SQL Editor
- [ ] `customers.py` replaced, `customer_notes.py` created
- [ ] `python scripts\check_customers.py` prints `ALL PASS`

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add backend database docs
git commit -m "Add the customers migration and repositories"
```

Next: [01-tools-and-agent.md](01-tools-and-agent.md) — teach the agent to take
notes without ever reading them back.
