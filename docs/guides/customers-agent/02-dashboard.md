# Guide 3, Part 2 — The owner's client directory (STEP 39 → STEP 41)

The chat can now add to customer records. This part gives the owner the other
side: a live `/dashboard/customers` where they can see everyone, open a profile
with real bookings and the assistant's notes, add a walk-in, write their own
notes, and record consent.

The screen already exists on mock data. We keep its layout and swap what feeds
it.

---

## STEP 39 — The customers dashboard API

### Goal

Four routes under the dashboard key:

| Route | Does |
| --- | --- |
| `GET /api/v1/dashboard/customers` | Every customer, with status, spend and booking counts |
| `GET /api/v1/dashboard/customers/{id}` | One customer, plus their bookings and the assistant's notes |
| `POST /api/v1/dashboard/customers` | Add a customer |
| `PATCH /api/v1/dashboard/customers/{id}` | Edit one, including opting them in to offers |

### Why?

The frontend never talks to Supabase directly. It calls FastAPI through the
Next.js proxy, which attaches the dashboard key on the server. That keeps the
key out of the browser, and keeps the `business_id` filter in one place.

The routes also turn the database's refusals into answers a person can act on:
*"Another customer already has this phone number"* is a 409, not a 500.

### Architecture

```
  Browser  ──►  /api/hub/dashboard/customers   (Next.js proxy, adds X-Dashboard-Key)
                        │
                        ▼
                FastAPI  routers/customers.py
                        │  require_dashboard_key   who may call
                        │  business_scope          which tenant
                        ▼
                repositories/customers.py  ──►  customer_overview (view)
                repositories/customer_notes.py
                repositories/appointments.py
```

**Why a separate router file?** `routers/dashboard.py` is already ~470 lines.
The customer routes use the same prefix and the same guards; they simply live in
their own file so each file stays readable. The URL the browser sees is the same
either way.

**Why is the opt-in in `PATCH`, not in the chat tools?** It is the owner gate
from Guide 2, applied to consent. The agent has no tool that can opt someone in,
and the database refuses a chat opt-in. The only path to `opted_in` is this
route, called from the owner's screen, which stamps `consent_source =
'dashboard'`.

### Files involved

```
backend/app/
├── main.py                 ← edit (one import, one include_router)
├── schemas.py              ← edit (add two classes)
└── routers/
    └── customers.py        ← new
backend/scripts/
└── check_customers_api.py  ← new
```

### Code

**`backend/app/schemas.py`** — add these two classes at the end of the file:

```python
class CustomerInput(BaseModel):
    """A customer the owner adds from the dashboard."""

    name: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=200)
    status: str = Field(default="auto", description="auto | lead | active | inactive")
    membership_plan: str = Field(default="", max_length=120)
    preferred_channel: str = Field(default="", description="'' | sms | whatsapp | email")
    notes: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list)


class CustomerPatch(BaseModel):
    """
    A partial edit. A field left out (None) is not touched; an empty string
    clears it.
    """

    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=200)
    status: str | None = Field(default=None, description="auto | lead | active | inactive")
    membership_plan: str | None = Field(default=None, max_length=120)
    preferred_channel: str | None = None
    notes: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = None
    marketing_consent: str | None = Field(
        default=None,
        description="unknown | opted_in | opted_out. Only the owner can set opted_in.",
    )
```

**`backend/app/main.py`** — two edits. Change the router import line to:

```python
from app.routers import chat, customers, dashboard, health
```

and add one line after `app.include_router(dashboard.router)`:

```python
app.include_router(customers.router)
```

**`backend/app/routers/customers.py`** — complete file:

```python
"""
The owner's client directory: /api/v1/dashboard/customers.

Separate from dashboard.py only to keep files readable. Same prefix, same
dashboard-key guard, same business_scope. Every repository call passes the
business_id, because the service_role key bypasses row level security.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.repositories import appointments as booking_repo
from app.repositories import businesses as business_repo
from app.repositories import customer_notes as notes_repo
from app.repositories import customers as customer_repo
from app.routers.dashboard import _booking
from app.schemas import CustomerInput, CustomerPatch
from app.security import business_scope, require_dashboard_key

logger = logging.getLogger("aibh.router.customers")

router = APIRouter(
    prefix="/api/v1/dashboard/customers",
    tags=["customers"],
    dependencies=[Depends(require_dashboard_key)],
)

# The database's rule names -> what to tell the owner.
FRIENDLY = {
    "customers_phone_format": "That does not look like a phone number.",
    "customers_email_format": "That does not look like an email address.",
    "customers_identifiable": "Give the customer a name, a phone number or an email.",
    "customers_status_override_values": "Status must be automatic, lead, active or inactive.",
    "customers_channel_values": "Preferred contact must be SMS, WhatsApp or email.",
    "customers_opt_in_needs_owner": "Only the owner can opt a customer in to offers.",
}


def _problem(error: Exception) -> str:
    text = str(error)
    for rule, message in FRIENDLY.items():
        if rule in text:
            return message
    return text[:200]


def _is_uuid(value: str) -> bool:
    """A junk id would make Postgres raise a 500; treat it as 'not found'."""
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def _customer(row: dict) -> dict:
    """customer_overview row -> the frontend's Customer type, plus two counts."""
    return {
        "id": row["id"],
        "businessId": row["business_id"],
        "name": row.get("name") or row.get("phone") or row.get("email") or "Unnamed",
        "email": row.get("email") or "",
        "phone": row.get("phone") or "",
        "status": row.get("status") or "lead",
        "statusIsAutomatic": bool(row.get("status_is_automatic", True)),
        "tags": row.get("tags") or [],
        # Completed bookings at their snapshot price. Not money received -
        # payments do not exist yet, and the screen says so.
        "totalSpend": float(row.get("completed_spend") or 0),
        "lastVisit": row.get("last_visit_date"),
        "notes": row.get("notes") or "",
        "membershipPlan": row.get("membership_plan"),
        "preferredChannel": row.get("preferred_channel"),
        "marketingConsent": row.get("marketing_consent") or "unknown",
        "consentSource": row.get("consent_source"),
        "source": row.get("source") or "chat",
        "createdAt": row.get("created_at"),
        "lastSeenAt": row.get("last_seen_at"),
        "bookingsCount": int(row.get("bookings_count") or 0),
        "upcomingCount": int(row.get("upcoming_count") or 0),
    }


def _note(row: dict) -> dict:
    return {
        "id": row["id"],
        "kind": row.get("kind") or "note",
        "body": row.get("body") or "",
        "author": row.get("author") or "agent",
        "createdAt": row.get("created_at"),
        "conversationId": row.get("conversation_id"),
    }


@router.get("")
def list_customers(business_id: str = Depends(business_scope)) -> dict:
    """The directory. Status, spend and counts are calculated by the view."""
    return {"customers": [_customer(r) for r in customer_repo.list_overview(business_id)]}


@router.get("/{customer_id}")
def get_customer(customer_id: str, business_id: str = Depends(business_scope)) -> dict:
    """One profile: the customer, their bookings, and what the assistant noted."""
    if not _is_uuid(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")

    # Look the customer up WITH the business filter first. Asking for another
    # business's customer is indistinguishable from asking for one that does
    # not exist - which is exactly what we want.
    row = customer_repo.get_overview(business_id, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = business_repo.get_business(business_id)
    return {
        "customer": _customer(row),
        "bookings": [
            _booking(b, business)
            for b in booking_repo.list_for_customer(business_id, customer_id, limit=50)
        ],
        "notes": [_note(n) for n in notes_repo.list_for_customer(business_id, customer_id)],
        # The Payments agent is not built. An empty list plus a flag lets the
        # screen say so, instead of showing "no invoices" as if that were true.
        "invoices": [],
        "invoicesAvailable": False,
    }


@router.post("", status_code=201)
def create_customer(payload: CustomerInput, business_id: str = Depends(business_scope)) -> dict:
    fields = payload.model_dump()
    fields["status_override"] = fields.pop("status")
    try:
        created = customer_repo.create(business_id, fields)
    except customer_repo.DuplicateCustomer as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except customer_repo.InvalidCustomer as error:
        raise HTTPException(status_code=400, detail=_problem(error)) from error

    return {"customer": _customer(customer_repo.get_overview(business_id, created["id"]))}


@router.patch("/{customer_id}")
def update_customer(
    customer_id: str, payload: CustomerPatch, business_id: str = Depends(business_scope)
) -> dict:
    if not _is_uuid(customer_id) or customer_repo.get(business_id, customer_id) is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    fields = payload.model_dump(exclude_none=True)
    consent = fields.pop("marketing_consent", None)
    if "status" in fields:
        fields["status_override"] = fields.pop("status")

    try:
        customer_repo.update(business_id, customer_id, fields)
        if consent is not None:
            # The ONLY place consent_source becomes 'dashboard' - so the only
            # place an opt-in can come from.
            customer_repo.set_marketing_consent(
                business_id=business_id,
                customer_id=customer_id,
                consent=consent,
                source="dashboard",
            )
    except customer_repo.DuplicateCustomer as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except customer_repo.InvalidCustomer as error:
        raise HTTPException(status_code=400, detail=_problem(error)) from error

    logger.info("Customer %s updated: %s", customer_id, sorted(fields) + (["consent"] if consent else []))
    return {"customer": _customer(customer_repo.get_overview(business_id, customer_id))}
```

### Explain the code

```python
from app.routers.dashboard import _booking
```
The profile's Bookings tab needs the same `Booking` shape the bookings screen
uses. Reusing the existing function means a booking looks the same everywhere.
Writing a second copy would drift the first time someone changed one.

```python
row = customer_repo.get_overview(business_id, customer_id)
if row is None:
    raise HTTPException(status_code=404, detail="Customer not found")
```
Tenant isolation, as the owner experiences it. Business A asking for business B's
customer gets exactly the same answer as asking for a customer that does not
exist. It never learns that the id is real.

```python
"invoices": [],
"invoicesAvailable": False,
```
Honesty in the API, not only the UI. An empty `invoices` list on its own would
mean "this customer has no invoices", which is not true. It means "invoices do
not exist yet". The flag lets the screen say which.

```python
fields = payload.model_dump(exclude_none=True)
```
`PATCH` means "change only what I sent". Pydantic fills every missing field with
`None`, and `exclude_none` drops them, so saving a note does not blank the phone
number.

```python
    if not _is_uuid(customer_id) or customer_repo.get(business_id, customer_id) is None:
```
Check existence first. A Supabase `update` that matches no rows is not an
error; it quietly does nothing. Without this check, a `PATCH` to another
business's customer would return 200 and a confusing empty body.

```python
FRIENDLY = {
    "customers_phone_format": "That does not look like a phone number.",
```
The repository already catches most bad values before the database sees them.
This table covers the rest: anything only the database noticed still reaches the
owner as a sentence, not a constraint name.

### Commands

Add the two schema classes, make the two `main.py` edits, and create
`routers/customers.py`. uvicorn reloads.

Check the routes are mounted:

```powershell
curl.exe -s http://127.0.0.1:8000/openapi.json | Select-String -Pattern "/api/v1/dashboard/customers" -AllMatches | ForEach-Object { $_.Matches.Count }
```

Then create the test script below and run it, with the backend running:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
python scripts\check_customers_api.py
```

### How to test

**`backend/scripts/check_customers_api.py`** — complete file:

```python
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
```

### Expected result

```
list
  PASS  GET /customers -> 200                        6 customers
  PASS  rows have the Customer shape                 all fields present

create
  PASS  POST -> 201                                  201
  PASS    phone normalised                           +919000000404
  PASS    email lowercased                           api.check@example.com
  PASS    new customer is a lead, automatically      lead
  PASS    source is dashboard                        dashboard
  PASS  same phone -> 409                            Another customer already has this phone number.
  PASS  bad phone -> 400                             That does not look like a phone number.
  PASS  nothing identifying -> 400                   Give the customer a name, a phone number or a
  PASS  status 'vip' -> 400                          Unknown status 'vip'.

edit
  PASS  PATCH notes -> saved
  PASS    ...phone untouched
  PASS  PATCH status active -> set by owner
  PASS  PATCH status auto -> calculated again
  PASS  owner opt-in -> allowed                      opted_in via dashboard

profile
  PASS  GET /customers/{id} -> 200
  PASS    bookings listed                            0 bookings
  PASS    the assistant's note is there
  PASS    invoices tab follows the payment subscription switched off

guards
  PASS  another business reads it -> 404             Customer not found
  PASS  another business edits it -> 404             Customer not found
  PASS    ...and nothing changed                     'Wants a locker near the door'
  PASS  junk id -> 404, not 500                      404
  PASS  no dashboard key -> 401                      Missing or invalid X-Dashboard-Key header

cleaned up

ALL PASS
```

The customer count on the first line depends on your data.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `GET /customers -> 200` FAILs with 404 | Router not mounted, or another app is on port 8000 | Check the `main.py` edits; `curl.exe -s http://127.0.0.1:8000/openapi.json` must say `AI Business Hub`. |
| 500 with `customer_overview does not exist` | Migration 003 not applied | Run it in the SQL Editor. |
| `ImportError: cannot import name 'CustomerInput'` | Schema classes not added | Add both to the end of `schemas.py`. |
| `same phone -> 409` FAILs with 500 | The unique-violation text did not match | Print `str(exc)` in `_explain`; it must contain `23505`. |
| `another business edits it` returns 200 | The existence check was removed | `update_customer` must 404 before it updates. |
| `httpx.ConnectError` on the first line | Backend not running | Start uvicorn in another terminal. |

---

## STEP 40 — Indian formats, frontend types and the API client

### Goal

Three things:

1. Make the whole app **Indian**: rupees, lakh/crore digit grouping,
   day-month-year dates, IST times, and `+91 98765 00011` phone numbers.
2. Teach the frontend the new customer fields.
3. Add the four customer routes to the API client.

### Why?

**The money bug.** `formatCurrency` defaulted to **US dollars**. Every live price
on the bookings screen had been showing `$9,000.00` for a ₹9,000 package. The mock
data was in dollars, so nobody noticed.

**The date bug.** `formatDate` formats full timestamps in **UTC**. That is right
for the mock data, which stores local times with a `Z` on the end. It is wrong
for real timestamps from the API, which are true UTC: anything that happened
between midnight and 5:30 AM IST shows as the day before. So real timestamps get
their own helper, `formatInstant`, which converts to IST first.

**The rest** was `en-US` throughout: `Sep 23, 2026`, `1,234,567`, `$` icons,
`+1 (555)` phone numbers in the mock data.

The frontend's `Customer` type was written for mock data. Live data has a few
more facts (consent, whether the status was set by hand, where the customer came
from) and a few fields that can genuinely be empty (a chat lead has no email, a
new customer has no last visit).

### Architecture

```
  lib/constants.ts     LOCALE = "en-IN", TIME_ZONE = "Asia/Kolkata"   ← the only two places
        │
        ▼
  lib/utils.ts         formatCurrency  ₹1,20,000
                       formatNumber    12,34,567
                       formatDate      23 Sept 2026       (mock data: local-time strings)
                       formatInstant   27 Sept 2026, IST  (API data: real UTC timestamps)
                       formatTime      6:00 PM
                       formatPhone     +91 98765 00011
        │
        ▼
  every screen
```

Phones stay stored as `+919876500011`: that single form is what makes the unique
index work (STEP 34). `formatPhone` only changes how a number is **shown**.

Times stay 12-hour (`6:00 PM`), which is what people in India normally read and
what the chat agent already says.

### Files involved

```
frontend/
├── scripts/
│   └── check_formats.mjs                        ← new
└── src/
    ├── types/
    │   └── customer.ts                          ← edit (the complete new version is below)
    ├── lib/
    │   ├── constants.ts                         ← edit (add two constants)
    │   ├── utils.ts                             ← edit (the complete new version is below)
    │   └── api/
    │       └── dashboard.ts                     ← edit (the complete new version is below)
    ├── features/customer-chat/components/
    │   └── CustomerChatApp.tsx                  ← edit (message times in IST)
    ├── (12 more files)                          ← edit (one-line swaps, table below)
    └── data/*.ts, app/page.tsx, 2 dashboard     ← edit (mock data: ₹, INR, +91 phones)
        components
backend/app/routers/
└── dashboard.py                                 ← edit (the date in booking confirmations)
```

### Code

**`frontend/src/lib/constants.ts`** — add at the top of the file, under the
opening comment:

```ts
/**
 * Every business on this platform is in India. Money, numbers, dates and times
 * are all formatted from these two, so changing country is a two-line edit.
 *
 * en-IN gives ₹, lakh/crore grouping (₹1,20,000) and day-month-year order
 * (26 Sept 2026). Asia/Kolkata is IST, UTC+05:30, with no daylight saving.
 */
export const LOCALE = "en-IN";
export const TIME_ZONE = "Asia/Kolkata";
```

**`frontend/src/lib/utils.ts`** — complete file:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { LOCALE, TIME_ZONE } from "./constants";

/**
 * Combines Tailwind class names cleanly, resolving conflicts with tailwind-merge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats an amount of money, Indian style: 120000 -> "₹1,20,000".
 */
export function formatCurrency(amount: number, currency: string = "INR"): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    // Rupee prices here are whole numbers; "₹9,000.00" is just noise.
    maximumFractionDigits: currency === "INR" ? 0 : 2,
  }).format(amount);
}

/**
 * Formats a count with Indian digit grouping: 1234567 -> "12,34,567".
 */
export function formatNumber(value: number): string {
  return value.toLocaleString(LOCALE);
}

/**
 * "6:00 pm" -> "6:00 PM".
 *
 * en-IN writes am/pm in lower case. The backend and every booking label use
 * upper case, so we normalise here and the whole app reads the same way.
 */
function upperMeridiem(text: string): string {
  return text.replace(/\b(am|pm)\b/g, (m) => m.toUpperCase());
}

/**
 * Formats a MOCK date string (e.g. "23 Sept 2026").
 *
 * Mock data stores business-local times with a "Z" suffix, so full timestamps
 * are formatted in UTC here to show the time the mock intended. Real
 * timestamps from the API are true UTC - use formatInstant for those.
 * Plain "YYYY-MM-DD" dates are parsed as local dates.
 */
export function formatDate(
  dateString: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
): string {
  const isPlainDate = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  return upperMeridiem(
    new Intl.DateTimeFormat(LOCALE, isPlainDate ? options : { timeZone: "UTC", ...options }).format(
      parseDate(dateString)
    )
  );
}

/**
 * Formats a REAL moment from the API (a UTC timestamp) in Indian time.
 *
 * "2026-09-26T19:00:00Z" is 12:30 AM on the 27th in India. Formatting it in
 * UTC would show the 26th - wrong for five and a half hours every night.
 */
export function formatInstant(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
): string {
  if (!iso) return "";
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";
  return upperMeridiem(new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...options }).format(moment));
}

/**
 * Formats a stored phone number for reading: "+919876500011" -> "+91 98765 00011".
 *
 * The database keeps one form (+<digits>) so the unique index works; this is
 * only for display. Anything that is not an Indian mobile is shown unchanged.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}

/**
 * Parses "YYYY-MM-DD" as a LOCAL date (plain `new Date("2026-09-23")` is UTC and
 * shows the previous day in US timezones). Full ISO timestamps are passed through.
 */
export function parseDate(dateString: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(dateString);
}

/** Converts a Date to a local "YYYY-MM-DD" key. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Converts "hh:mm AM" to minutes after midnight, for sorting. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!match) return 0;
  let hours = Number(match[1]) % 12;
  if (match[3]?.toUpperCase() === "PM") hours += 12;
  if (!match[3]) hours = Number(match[1]);
  return hours * 60 + Number(match[2]);
}

/** Formats a byte count as KB / MB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Initials for avatar bubbles, e.g. "Marcus Vance" -> "MV". */
export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/**
 * Formats a clock time in 12-hour Indian style (e.g. "9:30 AM").
 */
export function formatTime(timeString: string): string {
  // If already formatted like '10:00 AM'
  if (timeString.includes("AM") || timeString.includes("PM")) {
    return timeString.replace(/^0/, "");
  }
  const [hours, minutes] = timeString.split(":");
  const date = new Date();
  date.setHours(parseInt(hours, 10));
  date.setMinutes(parseInt(minutes, 10));
  return upperMeridiem(
    new Intl.DateTimeFormat(LOCALE, {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }).format(date)
  );
}

/**
 * Current local wall-clock time as an ISO string with a "Z" suffix.
 * Mock data stores business-local times this way, and `formatDate` renders
 * timestamps in UTC, so new records display the time the user actually saw.
 */
export function localNowIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString();
}
```

**`frontend/src/features/customer-chat/components/CustomerChatApp.tsx`** — two
edits. Add `formatInstant` to the utils import:

```tsx
import { cn, formatInstant, getInitials } from "@/lib/utils";
```

and replace the two time helpers, `nowLabel` and `timeLabel`, with:

```tsx
/** Message times are the business's time (IST), whatever timezone the visitor's device is in. */
function timeLabel(iso: string) {
  return formatInstant(iso, { hour: "numeric", minute: "2-digit" });
}

function nowLabel() {
  return timeLabel(new Date().toISOString());
}
```

**The one-line swaps.** Each is the same small change; the file list is so you
can find them:

| Change | Files |
| --- | --- |
| `.toLocaleString("en-US")` → `.toLocaleString(LOCALE)`, and add `import { LOCALE } from "@/lib/constants";` | `app/admin/(console)/ai-system/page.tsx`, `app/admin/(console)/analytics/page.tsx`, `app/admin/(console)/businesses/page.tsx`, `app/dashboard/customer-chat/page.tsx`, `components/charts/BarChart.tsx`, `components/charts/LineChart.tsx`, `features/admin/components/AgentStatusTable.tsx` |
| `new Intl.DateTimeFormat("en-US"` → `new Intl.DateTimeFormat(LOCALE`, same import | `features/bookings/components/BookingCalendar.tsx` |
| The `DollarSign` icon → `IndianRupee` (import and use) | `app/admin/(console)/page.tsx`, `app/dashboard/inventory/page.tsx`, `app/dashboard/reports/page.tsx`, `app/dashboard/customers/page.tsx` |
| `{x.customerPhone}` → `{formatPhone(x.customerPhone)}`, and add `formatPhone` to the `@/lib/utils` import | `features/bookings/components/BookingTable.tsx`, `BookingDetailModal.tsx`, `PendingApprovals.tsx`, `features/customer-chat/components/ConversationViewer.tsx` |
| Currency list: move `{ label: "Indian Rupee (₹ INR)", value: "INR" }` to the top | `features/settings/components/ProfileAndHoursSettings.tsx` |
| Phone placeholders `+1 (555) …` → `98765 43210`; remove the fake `"+1 (555) 000-0000"` default | `features/bookings/components/NewBookingModal.tsx`, `features/onboarding/components/StepBusinessProfile.tsx` |
| Mock data: `currency: "USD"` → `"INR"`, `$75` → `₹75`, `+1 (555) 982-1144` → `+91 98982 11440` | `data/*.ts`, `app/page.tsx`, `features/dashboard/components/RecentActivity.tsx`, `features/dashboard/components/NeedsAttention.tsx` |

The mock **amounts** were not converted, only their symbol. `₹75` for a
training session is a placeholder, like the rest of the mock data. Each screen
gets real numbers when its agent is built.

**`backend/app/routers/dashboard.py`** — the confirmation posted into a
customer's chat said *"on 2026-10-17"*. Add this helper above `_status`:

```python
def _spoken_date(iso_date: str) -> str:
    """
    '2026-10-17' -> 'Sat, 17 Oct 2026'. Day before month, the Indian way.

    Built by hand rather than with %-d, which is a GNU extension and raises
    ValueError on Windows.
    """
    try:
        day = datetime.strptime(iso_date, "%Y-%m-%d")
    except ValueError:
        return iso_date
    return f"{day:%a}, {day.day} {day:%b %Y}"
```

and in `decide_booking`, build the message from it:

```python
    if conversation_id:
        when = f"{_spoken_date(shaped['date'])} at {shaped['time']}"
        if new_status == "confirmed":
            text = (
                f"Your {shaped['serviceName']} on {when} "
                f"is confirmed. Reference {shaped['reference']}."
            )
        else:
            text = (
                f"Sorry - we can't take your {shaped['serviceName']} booking for "
                f"{when}."
            )
```

The booking's `date` field in the API stays `2026-10-17`. That is data for the
screen to sort and filter; only the sentence a person reads changes.

**`frontend/src/types/customer.ts`** — complete file:

```ts
export type ContactChannel = "sms" | "whatsapp" | "email";

/** Whether a customer wants offers. Only the owner can record "opted_in". */
export type MarketingConsent = "unknown" | "opted_in" | "opted_out";

export interface Customer {
  id: string;
  businessId: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  status: "active" | "inactive" | "lead";
  tags: string[];
  totalSpend: number;
  lastVisit?: string | null;
  notes?: string;
  membershipPlan?: string | null;
  preferredChannel?: ContactChannel | null;
  createdAt: string;

  // ---- live data only (the mock customers leave these out) ----
  /** False when the owner set the status by hand instead of letting bookings decide. */
  statusIsAutomatic?: boolean;
  marketingConsent?: MarketingConsent;
  /** Who recorded the consent. An opt-out can come from chat; an opt-in never does. */
  consentSource?: "chat" | "dashboard" | null;
  source?: "chat" | "dashboard" | "import";
  lastSeenAt?: string;
}

/** A customer plus the two booking counts the directory shows. What the API returns. */
export interface CustomerSummary extends Customer {
  bookingsCount: number;
  upcomingCount: number;
}

/** Something the chat assistant passed on. Append-only; the owner's own notes are Customer.notes. */
export interface CustomerNote {
  id: string;
  kind: "preference" | "interest" | "note";
  body: string;
  author: "agent" | "owner";
  createdAt: string;
  conversationId: string | null;
}
```


**`frontend/src/lib/api/dashboard.ts`** — complete file:

```ts
/**
 * Client for the owner's dashboard API.
 *
 * Always goes through /api/hub, which is a Next.js route handler that attaches
 * the dashboard key server-side. Nothing secret reaches the browser.
 */

import type {
  Booking,
  BookingStatus,
  ChatStats,
  ContactChannel,
  ConversationSession,
  Customer,
  CustomerNote,
  CustomerSummary,
  FaqItem,
  MarketingConsent,
  PaymentInvoice,
} from "@/types";

export const LIVE_BUSINESS_ID = process.env.NEXT_PUBLIC_LIVE_BUSINESS_ID ?? "";

export interface DashboardStats extends ChatStats {
  openRequests: number;
  pendingBookings: number;
  business: { id: string; name: string; chatSlug: string; chatEnabled: boolean };
}

/** What the Add Customer form sends. Empty strings mean "not given". */
export interface NewCustomer {
  name: string;
  phone?: string;
  email?: string;
  /** "auto" lets bookings decide; anything else is the owner overruling that. */
  status?: "auto" | Customer["status"];
  preferred_channel?: ContactChannel | "";
  membership_plan?: string;
  notes?: string;
  tags?: string[];
}

/** A partial edit. Only the owner can send marketing_consent: "opted_in". */
export type CustomerPatch = Partial<NewCustomer> & { marketing_consent?: MarketingConsent };

export interface CustomerDetail {
  customer: CustomerSummary;
  bookings: Booking[];
  notes: CustomerNote[];
  invoices: PaymentInvoice[];
  /** False until the Payments agent exists. */
  invoicesAvailable: boolean;
}

export class HubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HubError";
  }
}

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const params = new URLSearchParams({ business_id: LIVE_BUSINESS_ID });

  const response = await fetch(`/api/hub/dashboard${path}?${params.toString()}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new HubError(text.slice(0, 200) || "Unreadable response", response.status);
  }

  if (!response.ok) {
    const detail =
      (body as { detail?: string } | null)?.detail ?? `Request failed (${response.status})`;
    throw new HubError(detail, response.status);
  }

  return body as T;
}

export const dashboardApi = {
  stats: () => call<DashboardStats>("/stats"),

  conversations: () =>
    call<{ conversations: ConversationSession[] }>("/conversations").then((r) => r.conversations),

  reply: (conversationId: string, body: string) =>
    call<{ conversation: ConversationSession }>(`/conversations/${conversationId}/reply`, {
      method: "POST",
      body: { body },
    }).then((r) => r.conversation),

  resolve: (conversationId: string) =>
    call<{ conversation: ConversationSession }>(`/conversations/${conversationId}/resolve`, {
      method: "POST",
      body: { resolved: true },
    }).then((r) => r.conversation),

  bookings: () => call<{ bookings: Booking[]; pending: number }>("/bookings"),

  /**
   * Approve or reject a booking the agent took.
   *
   * This is the only way a booking becomes "confirmed" — the agent has no tool
   * that can write it. Approving also posts a line into the customer's chat.
   */
  decideBooking: (bookingId: string, decision: "approve" | "reject", note = "") =>
    call<{ booking: Booking; customer_notified: boolean }>(
      `/bookings/${bookingId}/decision`,
      { method: "POST", body: { decision, note, decided_by: "owner" } },
    ),

  /** Move an already-decided booking, e.g. confirmed -> completed. */
  setBookingStatus: (bookingId: string, status: BookingStatus, note = "") =>
    call<{ booking: Booking }>(`/bookings/${bookingId}/status`, {
      method: "POST",
      body: { status, note },
    }).then((r) => r.booking),

  /** The client directory: status, spend and counts are calculated by the database. */
  customers: () =>
    call<{ customers: CustomerSummary[] }>("/customers").then((r) => r.customers),

  /** One profile, with bookings and what the chat assistant passed on. */
  customer: (customerId: string) => call<CustomerDetail>(`/customers/${customerId}`),

  /** Throws HubError 409 if the phone or email already belongs to someone. */
  createCustomer: (input: NewCustomer) =>
    call<{ customer: CustomerSummary }>("/customers", { method: "POST", body: input }).then(
      (r) => r.customer,
    ),

  /**
   * Edit a customer. Sending marketing_consent here is the ONLY way anyone
   * becomes "opted_in" - the chat assistant cannot, and the database refuses
   * it from anywhere but the dashboard.
   */
  updateCustomer: (customerId: string, patch: CustomerPatch) =>
    call<{ customer: CustomerSummary }>(`/customers/${customerId}`, {
      method: "PATCH",
      body: patch,
    }).then((r) => r.customer),

  knowledge: () => call<{ faqs: FaqItem[] }>("/knowledge").then((r) => r.faqs),

  createArticle: (question: string, answer: string, tags: string[] = []) =>
    call<{ faq: FaqItem }>("/knowledge", {
      method: "POST",
      body: { title: question, body: answer, tags, is_active: true },
    }).then((r) => r.faq),

  updateArticle: (id: string, question: string, answer: string, tags: string[] = []) =>
    call<{ updated: boolean }>(`/knowledge/${id}`, {
      method: "PATCH",
      body: { title: question, body: answer, tags, is_active: true },
    }),

  deleteArticle: (id: string) =>
    call<{ deleted: boolean }>(`/knowledge/${id}`, { method: "DELETE" }),

  updateChatSettings: (patch: {
    chat_greeting?: string;
    chat_enabled?: boolean;
    agent_persona?: string;
  }) => call<{ updated: string[] }>("/chat-settings", { method: "PATCH", body: patch }),
};
```

### Explain the code

```ts
lastVisit?: string | null;
```
The mock type said `string | undefined`. The API sends `null` for "never
visited", because that is what JSON has. Saying so in the type makes TypeScript
check every place that uses it.

```ts
export interface CustomerSummary extends Customer {
  bookingsCount: number;
  upcomingCount: number;
}
```
The table component already had this shape under the name `CustomerRow`, but it
lived inside a component file. The API client should not import from a
component, so the shape moves to `types/`, and `CustomerRow` becomes an alias
for it (STEP 41).

```ts
maximumFractionDigits: currency === "INR" ? 0 : 2,
```
Rupee prices here are whole numbers, so `₹9,000.00` is just noise. `en-IN` also
gives Indian grouping: `₹1,20,000`, not `₹120,000`.

```ts
export function formatInstant(
```
Two date helpers because there are two kinds of date in the app. **Mock** data
writes an Indian local time with a `Z` on the end, and `formatDate` reads it back
in UTC, which gives the time the mock meant. **API** data is real UTC:
`2026-09-26T19:00:00Z` is 12:30 AM on the **27th** in India. `formatInstant`
converts to `Asia/Kolkata` first. Changing `formatDate` itself would have shifted
every mock screen by five and a half hours.

```ts
function upperMeridiem(text: string): string {
```
`en-IN` writes `6:00 pm` in lower case. The backend, the booking slots and the
agent all say `6:00 PM`. Without this, one screen could show both.

```ts
const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
```
Indian mobiles are read in two groups of five: `98765 00011`. Anything else, such
as a foreign number, is shown exactly as stored rather than guessed at.

```tsx
  return formatInstant(iso, { hour: "numeric", minute: "2-digit" });
```
The chat used the **visitor's** device clock. A customer messaging from Dubai saw
the gym's reply stamped in Dubai time. It is the business's chat, so it shows the
business's time.

```ts
updateCustomer: (customerId: string, patch: CustomerPatch) =>
```
One function for every edit: notes, status, consent. The backend's `PATCH` only
touches what was sent, so the screen can send `{ notes }` alone without clearing
anything else.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
node scripts\check_formats.mjs
```

### How to test

**`frontend/scripts/check_formats.mjs`** — complete file:

```js
/**
 * STEP 40: prove every formatter speaks Indian, with no browser and no test runner.
 *
 * Loads the REAL src/lib/utils.ts (TypeScript's own transpiler turns it into
 * plain JavaScript in memory) and checks what each helper produces.
 *
 *   cd frontend
 *   node scripts\check_formats.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// utils.ts imports clsx and tailwind-merge; this resolves them from node_modules.
const resolvePackage = createRequire(path.join(ROOT, "package.json"));

function load(file, deps) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)((name) => deps[name] || resolvePackage(name), mod, mod.exports);
  return mod.exports;
}

const constants = load("src/lib/constants.ts", {});
const u = load("src/lib/utils.ts", { "./constants": constants });

let failures = 0;
function check(label, actual, expected) {
  // Intl may use a narrow no-break space before AM/PM; compare as plain spaces.
  const plain = String(actual).replace(/[  ]/g, " ");
  const ok = expected instanceof RegExp ? expected.test(plain) : plain === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(44)} ${plain}`);
}

console.log("\nIndian formats");
check("rupees, lakh grouping", u.formatCurrency(120000), "₹1,20,000");
check("rupees, no paise noise", u.formatCurrency(9000), "₹9,000");
check("counts, lakh grouping", u.formatNumber(1234567), "12,34,567");
check("API timestamp -> IST date (rolls over)", u.formatInstant("2026-09-26T19:00:00Z"), /^27 Sept? 2026$/);
check("API timestamp -> IST time", u.formatInstant("2026-09-26T12:30:00Z", { hour: "numeric", minute: "2-digit" }), "6:00 PM");
check("mock plain date, day first", u.formatDate("2026-09-23"), /^23 Sept? 2026$/);
check("clock time, 12-hour, upper case", u.formatTime("18:00"), "6:00 PM");
check("  ...and it still sorts", u.timeToMinutes(u.formatTime("18:00")), "1080");
check("Indian mobile, readable", u.formatPhone("+919876500011"), "+91 98765 00011");
check("foreign number left alone", u.formatPhone("+14155550100"), "+14155550100");
check("no phone -> empty", u.formatPhone(null), "");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
```

There is no test runner, so this script loads the real `utils.ts` through the
TypeScript compiler, which is already installed, and checks each helper.

Then, with the backend running:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
python scripts\check_approval.py
```

### Expected result

`tsc` prints nothing. `check_formats.mjs` prints:

```
Indian formats
  PASS  rupees, lakh grouping                        ₹1,20,000
  PASS  rupees, no paise noise                       ₹9,000
  PASS  counts, lakh grouping                        12,34,567
  PASS  API timestamp -> IST date (rolls over)       27 Sept 2026
  PASS  API timestamp -> IST time                    6:00 PM
  PASS  mock plain date, day first                   23 Sept 2026
  PASS  clock time, 12-hour, upper case              6:00 PM
  PASS    ...and it still sorts                      1080
  PASS  Indian mobile, readable                      +91 98765 00011
  PASS  foreign number left alone                    +14155550100
  PASS  no phone -> empty

ALL PASS
```

`check_approval.py`'s confirmation now reads like a date a person says:

```
  message posted          : 'Your Personal Training on Sat, 17 Oct 2026 at 11:00 AM is confirmed. ...'
```

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `Module '"@/types"' has no exported member 'CustomerSummary'` | `customer.ts` not replaced | `types/index.ts` already does `export * from "./customer"`. |
| `Type 'null' is not assignable to type 'string'` | A mock screen passes `lastVisit` somewhere that wants a string | Guard it: `c.lastVisit ?? undefined`. |
| Prices still show `$` | Old `formatCurrency` still in place, or a call passes `"USD"` | Search for `formatCurrency(` with a second argument. |
| `Sep` in one place, `Sept` in another | Browsers ship different versions of the date data | Harmless; the check accepts both. |
| `Cannot find module 'typescript'` | `check_formats.mjs` run from the wrong folder | Run it from `frontend/`. |
| Booking confirmation still says `2026-10-17` | uvicorn did not reload | Stop it and start it again. `--reload` can stall under OneDrive. |

---

## STEP 41 — Wire the customers screen

### Goal

`/dashboard/customers` shows real customers. Opening one shows their real
bookings and what the assistant noted. The owner can add a customer, edit notes,
and record consent. Anything not built yet says so on screen.

### Why?

This is where the owner actually uses the capability. A note the assistant took
is only worth something if the owner sees it the next time Meera walks in.

### Architecture

```
  CustomersPage
     │  on mount + every 30 s ──► dashboardApi.customers()
     │
     ├── StatCards        counts from the live list
     ├── CustomerTable    unchanged layout
     │
     ├── click a row ──► dashboardApi.customer(id)      (bookings + notes)
     │                   CustomerDetailModal
     │                     ├── Notes tab: owner notes ──► updateCustomer({notes})
     │                     │              assistant notes (read-only)
     │                     ├── Offers select ──► updateCustomer({marketing_consent})
     │                     └── Invoices tab: "not built yet"
     │
     └── Add Customer ──► dashboardApi.createCustomer()   409 shown in the form
```

**Where the detail loads.** In the click handler, not in a `useEffect` watching
the selected id. An effect that sets state straight away is what the
`react-hooks/set-state-in-effect` lint rule forbids, and the click is the moment
we know we need the data anyway.

**What is honestly not wired**, and what the screen says:

| Control | On screen |
| --- | --- |
| Send Message | Disabled: *"Messaging is not built yet"* |
| Invoices tab | *"Invoices arrive with the Payments agent — not built yet."* |
| Total spend | Labelled *"from completed bookings"*, because it is not money received |

### Files involved

```
frontend/src/
├── app/dashboard/customers/
│   └── page.tsx                       ← edit (the complete new version is below)
└── features/customers/components/
    ├── CustomerTable.tsx              ← edit (the complete new version is below)
    ├── CustomerDetailModal.tsx        ← edit (the complete new version is below)
    └── AddCustomerModal.tsx           ← edit (the complete new version is below)
```

### Code

**`frontend/src/features/customers/components/CustomerTable.tsx`** — complete file:

```tsx
import React from "react";
import { Users, Mail, Phone, ChevronRight } from "lucide-react";
import { Avatar, Badge, EmptyState } from "@/components/ui";
import type { CustomerSummary } from "@/types";
import { formatCurrency, formatDate, formatPhone } from "@/lib/utils";
import { customerStatusMeta } from "@/lib/status";

/** A customer plus the booking counts the table shows - exactly what the API returns. */
export type CustomerRow = CustomerSummary;

interface CustomerTableProps {
  customers: CustomerRow[];
  onSelect: (customer: CustomerRow) => void;
}

export function CustomerTable({ customers, onSelect }: CustomerTableProps) {
  if (customers.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No Customers Found"
        description="No customers matched your search or filters. Try a different name, or add a new customer."
      />
    );
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg">
      {/* Mobile cards */}
      <ul className="md:hidden divide-y divide-gray-800/80">
        {customers.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className="w-full text-left p-4 flex items-start gap-3 hover:bg-gray-800/40 transition-colors cursor-pointer"
            >
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white truncate">{c.name}</span>
                  <Badge variant={customerStatusMeta[c.status].variant}>{customerStatusMeta[c.status].label}</Badge>
                </div>
                <div className="text-[11px] text-gray-400 truncate">{formatPhone(c.phone) || c.email || "No contact details"}</div>
                <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-400">
                  <span>
                    Spend <span className="text-white font-medium">{formatCurrency(c.totalSpend)}</span>
                  </span>
                  <span>{c.bookingsCount} bookings</span>
                  <span>Last visit {c.lastVisit ? formatDate(c.lastVisit, { month: "short", day: "numeric" }) : "—"}</span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Contact</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Total Spend</th>
              <th className="py-3 px-4 text-right">Bookings</th>
              <th className="py-3 px-4">Last Visit</th>
              <th className="py-3 px-4 hidden xl:table-cell">Tags</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80 text-gray-200">
            {customers.map((c) => (
              <tr key={c.id} onClick={() => onSelect(c)} className="hover:bg-gray-800/40 transition-colors cursor-pointer group">
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={c.name} size="sm" />
                    <div className="min-w-0">
                      <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">{c.name}</div>
                      {c.membershipPlan && <div className="text-[11px] text-gray-500">{c.membershipPlan}</div>}
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-1.5 text-gray-300">
                    <Phone className="w-3 h-3 text-gray-500" /> {formatPhone(c.phone) || "—"}
                  </div>
                  {c.email && (
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-0.5">
                      <Mail className="w-3 h-3 text-gray-500" /> {c.email}
                    </div>
                  )}
                </td>
                <td className="py-3.5 px-4">
                  <Badge variant={customerStatusMeta[c.status].variant}>{customerStatusMeta[c.status].label}</Badge>
                </td>
                <td className="py-3.5 px-4 text-right font-semibold text-white">{formatCurrency(c.totalSpend)}</td>
                <td className="py-3.5 px-4 text-right">
                  {c.bookingsCount}
                  {c.upcomingCount > 0 && <span className="block text-[10px] text-indigo-300">{c.upcomingCount} upcoming</span>}
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap text-gray-300">
                  {c.lastVisit ? formatDate(c.lastVisit, { month: "short", day: "numeric", year: "numeric" }) : "No visits yet"}
                </td>
                <td className="py-3.5 px-4 hidden xl:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.slice(0, 2).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 whitespace-nowrap">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3.5 px-4 text-right">
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-300 inline" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**`frontend/src/features/customers/components/CustomerDetailModal.tsx`** — complete file:

```tsx
"use client";

import React, { useState } from "react";
import { Phone, Mail, Calendar, CreditCard, StickyNote, Send, Check, Pencil, MessageSquare } from "lucide-react";
import { Modal, Avatar, Badge, Button, Textarea, SegmentedTabs, Select } from "@/components/ui";
import type { Booking, CustomerNote, MarketingConsent, PaymentInvoice } from "@/types";
import { formatCurrency, formatDate, formatPhone, formatInstant } from "@/lib/utils";
import { customerStatusMeta, bookingStatusMeta, invoiceStatusMeta } from "@/lib/status";
import type { CustomerRow } from "./CustomerTable";

interface CustomerDetailModalProps {
  customer: CustomerRow | null;
  bookings: Booking[];
  invoices: PaymentInvoice[];
  /** False until the Payments agent exists - the Invoices tab says so instead of looking empty. */
  invoicesAvailable: boolean;
  /** What the chat assistant passed on. Read-only here. */
  notes: CustomerNote[];
  /** True while this customer's bookings and notes are still loading. */
  loading: boolean;
  onClose: () => void;
  /** Rejects if the save failed, so the draft is kept. */
  onSaveNotes: (id: string, notes: string) => Promise<void>;
  onSetConsent: (id: string, consent: MarketingConsent) => Promise<void>;
}

type Tab = "bookings" | "invoices" | "notes";

const channelLabels = { sms: "SMS", whatsapp: "WhatsApp", email: "Email" } as const;

const consentOptions = [
  { label: "Offers: not asked yet", value: "unknown" },
  { label: "Offers: yes, they told you", value: "opted_in" },
  { label: "Offers: no", value: "opted_out" },
];

const noteKindLabels: Record<CustomerNote["kind"], string> = {
  preference: "Preference",
  interest: "Interest",
  note: "Note",
};

export function CustomerDetailModal({
  customer,
  bookings,
  invoices,
  invoicesAvailable,
  notes,
  loading,
  onClose,
  onSaveNotes,
  onSetConsent,
}: CustomerDetailModalProps) {
  const [tab, setTab] = useState<Tab>("bookings");
  const [editingNotes, setEditingNotes] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  if (!customer) return null;

  const status = customerStatusMeta[customer.status];
  const outstanding = invoices.filter((i) => i.status === "pending" || i.status === "overdue").reduce((a, i) => a + i.amount, 0);

  const startEditing = () => {
    setDraft(customer.notes ?? "");
    setEditingNotes(true);
  };

  const handleClose = () => {
    setEditingNotes(false);
    setTab("bookings");
    onClose();
  };

  const saveNotes = async () => {
    setSaving(true);
    try {
      await onSaveNotes(customer.id, draft.trim());
      setEditingNotes(false);
    } catch {
      // The page has already shown a toast. Keep the draft so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={handleClose} title="Customer Profile" maxWidth="lg">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={customer.name} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-white truncate">{customer.name}</span>
                <Badge variant={status.variant}>{status.label}</Badge>
                {customer.statusIsAutomatic === false && <span className="text-[10px] text-gray-500">set by you</span>}
              </div>
              <div className="text-xs text-gray-400">
                Customer since {formatInstant(customer.createdAt, { month: "short", year: "numeric" })}
                {customer.source === "chat" && <> • found through chat</>}
                {customer.membershipPlan && <> • {customer.membershipPlan}</>}
              </div>
            </div>
          </div>
          {/* The Communication agent is not built. A button that looked live would lie. */}
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled
            title="Sending messages is the Communication agent's job, and it is not built yet."
          >
            <Send className="w-3.5 h-3.5 text-indigo-400" />
            Messaging is not built yet
          </Button>
        </div>

        {/* Contact + key numbers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-1.5 text-sm">
            {customer.phone ? (
              <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-gray-200 hover:text-white">
                <Phone className="w-3.5 h-3.5 text-gray-500" /> {formatPhone(customer.phone)}
              </a>
            ) : (
              <div className="flex items-center gap-2 text-gray-500">
                <Phone className="w-3.5 h-3.5" /> No phone number
              </div>
            )}
            {customer.email ? (
              <a href={`mailto:${customer.email}`} className="flex items-center gap-2 text-gray-200 hover:text-white break-all">
                <Mail className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" /> {customer.email}
              </a>
            ) : (
              <div className="flex items-center gap-2 text-gray-500">
                <Mail className="w-3.5 h-3.5" /> No email
              </div>
            )}
            {customer.preferredChannel && (
              <div className="text-[11px] text-gray-500">Prefers {channelLabels[customer.preferredChannel]}</div>
            )}
            <Select
              aria-label="Does this customer want offers?"
              value={customer.marketingConsent ?? "unknown"}
              onChange={(v) => void onSetConsent(customer.id, v as MarketingConsent)}
              options={consentOptions}
              wrapperClassName="pt-1"
            />
            {customer.marketingConsent === "opted_out" && customer.consentSource === "chat" && (
              <div className="text-[11px] text-gray-500">They asked the chat assistant to stop offers.</div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Spend", value: formatCurrency(customer.totalSpend), hint: "completed bookings" },
              { label: "Bookings", value: customer.bookingsCount, hint: `${customer.upcomingCount} upcoming` },
              {
                label: "Last Visit",
                value: customer.lastVisit ? formatDate(customer.lastVisit, { month: "short", day: "numeric" }) : "—",
                hint: "completed",
              },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-950/60 p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{s.label}</div>
                <div className="text-sm font-bold text-white mt-1">{s.value}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{s.hint}</div>
              </div>
            ))}
          </div>
        </div>

        {outstanding > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            {formatCurrency(outstanding)} outstanding across unpaid invoices.
          </div>
        )}

        {customer.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customer.tags.map((t) => (
              <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                {t}
              </span>
            ))}
          </div>
        )}

        <SegmentedTabs<Tab>
          tabs={[
            { label: "Bookings", value: "bookings", count: bookings.length },
            { label: "Invoices", value: "invoices", count: invoicesAvailable ? invoices.length : undefined },
            { label: "Notes", value: "notes", count: notes.length || undefined },
          ]}
          value={tab}
          onChange={setTab}
          className="self-start w-fit"
        />

        {tab === "bookings" && (
          <ul className="space-y-2">
            {loading && <li className="text-xs text-gray-500 py-4 text-center">Loading bookings…</li>}
            {!loading && bookings.length === 0 && <li className="text-xs text-gray-500 py-4 text-center">No bookings yet.</li>}
            {bookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Calendar className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white truncate">{b.serviceName}</div>
                    <div className="text-[11px] text-gray-400">
                      {formatDate(b.date, { month: "short", day: "numeric" })} • {b.time}
                    </div>
                  </div>
                </div>
                <Badge variant={bookingStatusMeta[b.status].variant}>{bookingStatusMeta[b.status].label}</Badge>
              </li>
            ))}
          </ul>
        )}

        {tab === "invoices" && (
          <ul className="space-y-2">
            {!invoicesAvailable && (
              <li className="text-xs text-gray-500 py-4 text-center">
                Invoices arrive with the Payments agent — not built yet.
              </li>
            )}
            {invoicesAvailable && invoices.length === 0 && <li className="text-xs text-gray-500 py-4 text-center">No invoices yet.</li>}
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CreditCard className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white truncate">{inv.invoiceNumber}</div>
                    <div className="text-[11px] text-gray-400 truncate">{inv.items[0]?.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">{formatCurrency(inv.amount)}</span>
                  <Badge variant={invoiceStatusMeta[inv.status].variant}>{invoiceStatusMeta[inv.status].label}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}

        {tab === "notes" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Your notes</div>
              {editingNotes ? (
                <>
                  <Textarea
                    aria-label="Customer notes"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Preferences, goals, anything to remember..."
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingNotes(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveNotes()} disabled={saving}>
                      <Check className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save Notes"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-2">
                      <StickyNote className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-gray-200 whitespace-pre-line">{customer.notes || "No notes yet."}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={startEditing} aria-label="Edit notes">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                Passed on by the chat assistant
              </div>
              {loading && <div className="text-xs text-gray-500 py-2">Loading…</div>}
              {!loading && notes.length === 0 && (
                <div className="text-xs text-gray-500 py-2">Nothing passed on from chat yet.</div>
              )}
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-200">{n.body}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {noteKindLabels[n.kind]} • {formatInstant(n.createdAt, { day: "numeric", month: "short" })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
```

**`frontend/src/features/customers/components/AddCustomerModal.tsx`** — complete file:

```tsx
"use client";

import React, { useState } from "react";
import { Modal, Button, Input, Select, Textarea } from "@/components/ui";
import type { ContactChannel, Customer } from "@/types";
import type { NewCustomer } from "@/lib/api/dashboard";

interface AddCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Rejects with the backend's message (e.g. a duplicate phone), shown in the form. */
  onAdd: (customer: NewCustomer) => Promise<void>;
}

type StatusChoice = "auto" | Customer["status"];

export function AddCustomerModal({ isOpen, onClose, onAdd }: AddCustomerModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<StatusChoice>("auto");
  const [channel, setChannel] = useState<ContactChannel | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setStatus("auto");
    setChannel("");
    setNotes("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        status,
        preferred_channel: channel,
        notes: notes.trim(),
      });
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the customer.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Customer" description="Create a new customer profile." maxWidth="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-1">
        <Input label="Full Name" placeholder="e.g. Rahul Sharma" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Phone" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Email" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as StatusChoice)}
            options={[
              { label: "Automatic (from bookings)", value: "auto" },
              { label: "Active member", value: "active" },
              { label: "Lead (not yet a member)", value: "lead" },
              { label: "Inactive", value: "inactive" },
            ]}
          />
          <Select
            label="Preferred Contact"
            value={channel}
            onChange={(v) => setChannel(v as ContactChannel | "")}
            options={[
              { label: "No preference", value: "" },
              { label: "WhatsApp", value: "whatsapp" },
              { label: "SMS", value: "sms" },
              { label: "Email", value: "email" },
            ]}
          />
        </div>
        <Textarea label="Notes" rows={3} placeholder="Goals, preferences, anything to remember..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save Customer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
```

**`frontend/src/app/dashboard/customers/page.tsx`** — complete file:

```tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Users, UserPlus, UserCheck, Sparkles, IndianRupee } from "lucide-react";
import { Button, PageHeader, StatCard, SearchInput, Select, SegmentedTabs, Toast } from "@/components/ui";
import { CustomerTable } from "@/features/customers/components/CustomerTable";
import { CustomerDetailModal } from "@/features/customers/components/CustomerDetailModal";
import { AddCustomerModal } from "@/features/customers/components/AddCustomerModal";
import type { Booking, CustomerNote, CustomerSummary, MarketingConsent, PaymentInvoice } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID, type CustomerPatch, type NewCustomer } from "@/lib/api/dashboard";

type StatusFilter = CustomerSummary["status"] | "all";
type SortKey = "name" | "spend" | "recent" | "bookings";

interface Profile {
  customerId: string;
  bookings: Booking[];
  notes: CustomerNote[];
  invoices: PaymentInvoice[];
  invoicesAvailable: boolean;
}

function message(error: unknown, fallback: string): string {
  return error instanceof HubError ? error.message : fallback;
}

export default function CustomersPage() {
  // LIVE_BUSINESS_ID is a build-time constant, so "not configured" is known up front.
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured ? null : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      setCustomers(await dashboardApi.customers());
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error, "Could not load customers."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before it sets state, so nothing is set synchronously
    // here. Thirty seconds: customers change far less often than bookings.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [configured, refresh]);

  /** Replace one customer in the list with a fresher copy from the API. */
  const replace = useCallback((updated: CustomerSummary) => {
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  /** Open a profile. Loads here, in the click, rather than in an effect. */
  const openCustomer = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setProfile(null);
      try {
        const detail = await dashboardApi.customer(id);
        replace(detail.customer);
        setProfile({
          customerId: id,
          bookings: detail.bookings,
          notes: detail.notes,
          invoices: detail.invoices,
          invoicesAvailable: detail.invoicesAvailable,
        });
      } catch (error) {
        showToast(message(error, "Could not load this customer."), "error");
      }
    },
    [replace, showToast],
  );

  const update = useCallback(
    async (id: string, patch: CustomerPatch, done: string) => {
      try {
        replace(await dashboardApi.updateCustomer(id, patch));
        showToast(done);
      } catch (error) {
        showToast(message(error, "Could not save that change."), "error");
        throw error;
      }
    },
    [replace, showToast],
  );

  const handleSaveNotes = useCallback(
    (id: string, notes: string) => update(id, { notes }, "Notes saved."),
    [update],
  );

  const handleSetConsent = useCallback(
    (id: string, consent: MarketingConsent) =>
      update(
        id,
        { marketing_consent: consent },
        consent === "opted_in" ? "Recorded: they want offers." : "Consent updated.",
      ).catch(() => undefined),
    [update],
  );

  const handleAdd = useCallback(
    async (input: NewCustomer) => {
      // Errors (e.g. 409 duplicate phone) propagate to the form, which shows them.
      const created = await dashboardApi.createCustomer(input);
      setCustomers((prev) => [created, ...prev]);
      showToast(`${created.name} added.`);
    },
    [showToast],
  );

  const allTags = useMemo(() => Array.from(new Set(customers.flatMap((c) => c.tags))).sort(), [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.filter((c) => {
      const matchesSearch =
        !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q);
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      const matchesTag = tagFilter === "all" || c.tags.includes(tagFilter);
      return matchesSearch && matchesStatus && matchesTag;
    });
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name);
        case "spend":
          return b.totalSpend - a.totalSpend;
        case "bookings":
          return b.bookingsCount - a.bookingsCount;
        default:
          // Most recent visit first; people who never visited sort by when we last heard from them.
          return (b.lastVisit ?? b.lastSeenAt ?? "").localeCompare(a.lastVisit ?? a.lastSeenAt ?? "");
      }
    });
  }, [customers, search, statusFilter, tagFilter, sortKey]);

  const counts = {
    all: customers.length,
    active: customers.filter((c) => c.status === "active").length,
    lead: customers.filter((c) => c.status === "lead").length,
    inactive: customers.filter((c) => c.status === "inactive").length,
  };
  const leadsFromChat = customers.filter((c) => c.status === "lead" && c.source === "chat").length;
  const totalSpend = customers.reduce((a, c) => a + c.totalSpend, 0);
  const payingCustomers = customers.filter((c) => c.totalSpend > 0).length || 1;

  const selected = customers.find((c) => c.id === selectedId) ?? null;
  const current = profile && profile.customerId === selectedId ? profile : null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Customers"
        description="Your client directory: contact details, visits, and what the chat assistant passed on."
        actions={
          <Button size="sm" className="text-xs shadow-md shadow-indigo-600/20" onClick={() => setIsAddOpen(true)} disabled={!configured}>
            <UserPlus className="w-3.5 h-3.5" />
            Add Customer
          </Button>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total Customers" value={counts.all} icon={Users} tone="indigo" hint="All profiles" />
        <StatCard label="Active Members" value={counts.active} icon={UserCheck} tone="emerald" hint="Visited or booked in 60 days" />
        <StatCard label="New Leads" value={counts.lead} icon={Sparkles} tone="purple" hint={`${leadsFromChat} came from customer chat`} />
        <StatCard
          label="Avg. Spend"
          value={formatCurrency(Math.round(totalSpend / payingCustomers))}
          icon={IndianRupee}
          tone="amber"
          hint={`${formatCurrency(totalSpend)} from completed bookings`}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <SegmentedTabs<StatusFilter>
            tabs={[
              { label: "All", value: "all", count: counts.all },
              { label: "Active", value: "active", count: counts.active },
              { label: "Leads", value: "lead", count: counts.lead },
              { label: "Inactive", value: "inactive", count: counts.inactive },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            className="self-start"
          />
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or phone..." className="w-full sm:w-64" />
            <Select
              aria-label="Filter by tag"
              value={tagFilter}
              onChange={setTagFilter}
              options={[{ label: "All tags", value: "all" }, ...allTags.map((t) => ({ label: t, value: t }))]}
              wrapperClassName="w-[calc(50%-4px)] sm:w-40"
            />
            <Select
              aria-label="Sort customers"
              value={sortKey}
              onChange={(v) => setSortKey(v as SortKey)}
              options={[
                { label: "Recent visit", value: "recent" },
                { label: "Highest spend", value: "spend" },
                { label: "Most bookings", value: "bookings" },
                { label: "Name A–Z", value: "name" },
              ]}
              wrapperClassName="w-[calc(50%-4px)] sm:w-40"
            />
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading customers…</p>
        ) : (
          <CustomerTable customers={filtered} onSelect={(c) => void openCustomer(c.id)} />
        )}
      </div>

      <CustomerDetailModal
        customer={selected}
        bookings={current?.bookings ?? []}
        invoices={current?.invoices ?? []}
        invoicesAvailable={current?.invoicesAvailable ?? false}
        notes={current?.notes ?? []}
        loading={selected !== null && current === null}
        onClose={() => setSelectedId(null)}
        onSaveNotes={handleSaveNotes}
        onSetConsent={handleSetConsent}
      />

      <AddCustomerModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onAdd={handleAdd} />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
```

### Explain the code

```tsx
const current = profile && profile.customerId === selectedId ? profile : null;
```
The owner clicks Ravi, then Meera, quickly. Ravi's profile can arrive **after**
Meera's modal opens. Tagging the profile with the id it belongs to means a late
answer for Ravi is never shown on Meera's screen.

```tsx
loading={selected !== null && current === null}
```
The modal opens straight away with the customer's row (which we already have)
and shows *"Loading bookings…"* until the profile arrives. Nothing on screen
pretends the customer has no bookings while we are still asking.

```tsx
    } catch (error) {
      showToast(message(error, "Could not save that change."), "error");
      throw error;
    }
```
`update` both reports **and** re-throws. The toast tells the owner; the re-throw
tells the notes editor the save failed, so it keeps the draft open instead of
closing and losing what they typed.

```tsx
    const created = await dashboardApi.createCustomer(input);
```
No `try` here on purpose. A 409 *"Another customer already has this phone
number"* should appear **inside the form**, next to the field they need to fix,
not in a toast that vanishes. `AddCustomerModal` catches it and shows it.

```tsx
          <Button ... disabled title="Sending messages is the Communication agent's job, and it is not built yet.">
            Messaging is not built yet
```
The mock button linked to the Communication page, which is still mock data. A
live-looking button that opens a screen that sends nothing would be a lie.

```tsx
{ label: "Spend", value: formatCurrency(customer.totalSpend), hint: "completed bookings" },
```
This is booking value, not money received. The small hint under the number says
so, and the stat card on the page says *"from completed bookings"*.

```tsx
onChange={(v) => void onSetConsent(customer.id, v as MarketingConsent)}
```
The owner is the consent gate. When Meera says at the front desk *"yes, send me
offers"*, this select is how that gets recorded. It is the only path in the whole
system that can produce `opted_in`.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
npm run lint
npm run dev
```

### How to test

With the backend running, open <http://localhost:3000/dashboard/customers>.

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Load the page | Your real customers. People who only chatted are **Leads** |
| 2 | Look at a price | `₹`, not `$` |
| 3 | Click **Add Customer**, name *Walk In*, phone `98765 11111`, status *Automatic* | Toast *"Walk In added."*, they appear as a **Lead** |
| 4 | Add another with the **same** phone `+91 98765 11111` | The form says *"Another customer already has this phone number."* and stays open |
| 5 | Open *Walk In* → **Notes** → Edit → type → Save | Toast *"Notes saved."* Reload the page: the note is still there |
| 6 | Change the **Offers** select to *"yes, they told you"* | Toast *"Recorded: they want offers."* |
| 7 | Open the **Invoices** tab | *"Invoices arrive with the Payments agent — not built yet."* |
| 8 | Look at **Send Message** | Disabled, *"Messaging is not built yet"* |
| 9 | Open the customer from STEP 38 (Meera) | Bookings tab, and **Notes** shows what the assistant passed on |
| 10 | Approve one of their bookings on `/dashboard/bookings`, mark it **completed**, come back | Status **Active**, spend and last visit filled in |

Clean up in the SQL Editor:

```sql
delete from customers where phone = '+919876511111';
```

### Expected result

Rows 1–10 as described. `npx tsc --noEmit` prints nothing. `npm run lint` ends
without errors.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Amber strip: *Set NEXT_PUBLIC_LIVE_BUSINESS_ID* | Missing from `frontend/.env.local` | Add it (your business uuid) and restart `npm run dev`. |
| Amber strip: *HUB_DASHBOARD_KEY is not set* | Proxy has no key | Set it in `frontend/.env.local`; it must equal the backend's `DASHBOARD_API_KEY`. |
| Amber strip: *Could not reach the backend* | uvicorn not running | Start it. |
| Every call `{"detail":"Not Found"}` | Another app on port 8000 | See the port check in [RUN-AND-TEST.md](../RUN-AND-TEST.md). |
| Profile modal says *Loading bookings…* forever | `GET /customers/{id}` failed | A red toast says why; check the uvicorn terminal. |
| `EINVAL` from `next dev` | OneDrive + a previous build | `Remove-Item -Recurse -Force .next` |
| Lint: `react-hooks/set-state-in-effect` | Detail loading moved into an effect | Keep it in `openCustomer`, the click handler. |

---

## End of Part 2 — checklist

- [ ] `python scripts\check_customers_api.py` prints `ALL PASS`
- [ ] `npx tsc --noEmit` and `npm run lint` are clean
- [ ] Prices on the bookings and customers screens show `₹`
- [ ] Adding a duplicate phone shows the error in the form
- [ ] The assistant's notes appear in the profile
- [ ] Invoices and Send Message say they are not built

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add backend frontend docs
git commit -m "Wire the customers screen to the live directory"
```

That is the Customers Agent. Day-to-day running and testing is in
[RUN-AND-TEST.md](../RUN-AND-TEST.md).
