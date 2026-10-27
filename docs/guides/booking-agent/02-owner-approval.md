# Guide 2, Part 2 — Owner approval (STEP 31 → STEP 33)

The agent takes bookings but cannot confirm them. This part builds the other
half: the owner sees pending requests, approves or rejects them, and the customer
finds out in the chat they are still sitting in.

---

## STEP 31 — The bookings API

### Goal

Dashboard routes for listing bookings and deciding on them, returning the shape
the frontend's `Booking` type already declares.

### Why?

This is the **confirmation gate** from your blueprint, made real. The agent
writes `pending`; only this endpoint writes `confirmed`. That separation is
enforced by which code paths exist, not by a prompt.

The approval also has to close the loop back to the customer. They asked in the
chat and are waiting there, so the confirmation belongs in the same thread — the
same trick the owner reply used in Guide 1.

### Architecture

```
Owner taps Approve
      │
      ▼
POST /dashboard/bookings/{id}/decision   {"decision": "approve"}
      │
      ├─ appointments.set_status(... 'confirmed')
      │
      ├─ compose a message from the STORED row, not from the request body
      │
      └─ post it into the customer's conversation as a system message
              │
              ▼
      their open chat polls /history and sees it
```

### Files involved

```
backend/app/
├── schemas.py                 ← add two models
└── routers/dashboard.py       ← add the bookings section
```

### Code

**`backend/app/schemas.py`** — add at the bottom:

```python
class BookingDecision(BaseModel):
    decision: str = Field(description="'approve' or 'reject'")
    note: str = Field(default="", max_length=1000, description="Shown to the customer.")
    decided_by: str = Field(default="owner", max_length=120)


class BookingStatusChange(BaseModel):
    status: str = Field(description="pending | confirmed | cancelled | completed")
    note: str = Field(default="", max_length=1000)
```

**`backend/app/routers/dashboard.py`** — add the import at the top:

```python
from app.repositories import appointments as booking_repo
from app.schemas import BookingDecision, BookingStatusChange
```

(add the names to the existing `from app.schemas import ...` line)

and this whole section at the bottom of the file:

```python
# ---------------------------------------------------------------- bookings


def _booking(row: dict, business: dict) -> dict:
    """appointments row -> the frontend's Booking type."""
    tz = _tz(business)
    customer = row.get("customers") or {}

    try:
        moment = datetime.fromisoformat(str(row["starts_at"]).replace("Z", "+00:00")).astimezone(tz)
        date = moment.date().isoformat()
        clock = moment.strftime("%I:%M %p").lstrip("0")
    except (ValueError, KeyError):
        date, clock = "", ""

    return {
        "id": row["id"],
        "businessId": business["id"],
        "customerId": row.get("customer_id") or "",
        "customerName": customer.get("name") or "Visitor",
        "customerEmail": customer.get("email") or "",
        "customerPhone": customer.get("phone") or "",
        "serviceId": row.get("service_id") or "",
        "serviceName": row.get("service_name") or "",
        "date": date,
        "time": clock,
        "durationMinutes": row.get("duration_minutes") or 0,
        "price": float(row.get("price") or 0),
        "status": row["status"],
        "paymentStatus": row.get("payment_status") or "unpaid",
        "staffAssigned": row.get("staff_assigned"),
        "notes": row.get("notes") or "",
        "bookedVia": row.get("source") or "customer_chat",
        "createdAt": row.get("created_at"),
        # Ours, not in the frontend's Booking type — handy in the UI.
        "reference": row["id"][:8].upper(),
    }


@router.get("/bookings")
def list_bookings(business_id: str = Depends(business_scope)) -> dict:
    """Every booking, newest first. What the bookings table shows."""
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    return {
        "bookings": [_booking(row, business) for row in booking_repo.list_all(business_id)],
        "pending": booking_repo.pending_count(business_id),
    }


@router.post("/bookings/{booking_id}/decision")
def decide_booking(
    booking_id: str,
    payload: BookingDecision,
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Approve or reject a pending booking.

    This is the ONLY path that can write 'confirmed'. The agent has no tool for
    it, by design — that is the confirmation gate.
    """
    if payload.decision not in {"approve", "reject"}:
        raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'")

    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    existing = booking_repo.get(business_id, booking_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    if existing["status"] != "pending":
        # Two tabs, or a double tap. Telling the customer twice is worse than
        # refusing the second press.
        raise HTTPException(
            status_code=409,
            detail=f"This booking is already '{existing['status']}' and cannot be decided again.",
        )

    new_status = "confirmed" if payload.decision == "approve" else "cancelled"
    updated = booking_repo.set_status(
        business_id=business_id,
        appointment_id=booking_id,
        status=new_status,
        decided_by=payload.decided_by,
        note=payload.note,
    )
    if updated is None:
        raise HTTPException(status_code=500, detail="Could not update the booking")

    shaped = _booking(updated, business)

    # Tell the customer, in the chat they are already sitting in.
    conversation_id = updated.get("conversation_id")
    if conversation_id:
        if new_status == "confirmed":
            text = (
                f"Your {shaped['serviceName']} on {shaped['date']} at {shaped['time']} "
                f"is confirmed. Reference {shaped['reference']}."
            )
        else:
            text = (
                f"Sorry — we can't take your {shaped['serviceName']} booking for "
                f"{shaped['date']} at {shaped['time']}."
            )
        if payload.note:
            text = f"{text}\n\n{payload.note}"
        if new_status == "cancelled":
            text = f"{text}\n\nReply here and we'll find another time."

        conversation_repo.add_message(
            business_id=business_id,
            conversation_id=conversation_id,
            direction="outbound",
            author="system",
            body=text,
            meta={"kind": "booking_decision", "booking_id": booking_id, "decision": new_status},
        )

    logger.info("Booking %s %s by %s", shaped["reference"], new_status, payload.decided_by)
    return {"booking": shaped, "customer_notified": bool(conversation_id)}


@router.post("/bookings/{booking_id}/status")
def change_booking_status(
    booking_id: str,
    payload: BookingStatusChange,
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Move a booking to any status. Used for 'completed' after the visit, and for
    cancelling something the owner already confirmed.
    """
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    try:
        updated = booking_repo.set_status(
            business_id=business_id,
            appointment_id=booking_id,
            status=payload.status,
            decided_by="owner",
            note=payload.note,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if updated is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"booking": _booking(updated, business)}
```

Finally, make the stats route report real booking numbers. Replace the
`bookingsFromChat` line in `/stats`:

```python
        "bookingsFromChat": sum(
            1
            for b in booking_repo.list_all(business_id, limit=500)
            if b.get("source") == "customer_chat" and b.get("status") in {"pending", "confirmed", "completed"}
        ),
        "pendingBookings": booking_repo.pending_count(business_id),
```

> **Updated later.** Guide 3, [STEP 40](../customers-agent/02-dashboard.md),
> changes how the date is written in these two messages: `2026-10-17` becomes
> `Sat, 17 Oct 2026`, via a small `_spoken_date()` helper. If you are building
> from the start, use the code above now and apply STEP 40 when you get there.

### Explain the code

```python
text = f"Your {shaped['serviceName']} on {shaped['date']} at {shaped['time']} is confirmed."
```
Built from the **stored row after the update**, never from the request body. If
the UI were trusted to say which service and time, a bug or a tampered request
could confirm something that was never booked. The database is the source of
truth for what the customer gets told.

```python
if existing["status"] != "pending":
    raise HTTPException(status_code=409, ...)
```
Guards against double approval. Two browser tabs, or an impatient double tap, and
without this the customer gets two confirmation messages for one booking. `409
Conflict` is the correct status: the request was valid, the resource was not in a
state that allows it.

```python
author="system",
```
The confirmation is posted as a system message, so it renders as a centred notice
rather than as the assistant talking. The customer can see it is an update about
their booking, not the AI making another claim.

```python
"reference": row["id"][:8].upper(),
```
An extra field beyond the frontend's `Booking` type. TypeScript will not know
about it unless you extend the interface — which STEP 32 does — but it costs
nothing to send and the owner needs the same code the customer was given.

```python
    except (ValueError, KeyError):
        date, clock = "", ""
```
A booking with a malformed timestamp should render as blank fields, not crash
the whole list. One bad row must not take down the screen.

```python
"bookingsFromChat": sum(... if b.get("source") == "customer_chat" ...)
```
The honest zero from Guide 1 becomes an honest number. Note it counts `pending`,
`confirmed` **and** `completed` but not `cancelled` — a booking the customer
cancelled did still come from the chat, but counting it as a win would flatter
the number.

### Commands

Make the edits. uvicorn reloads.

### How to test

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
```

First make a booking through the terminal chat (STEP 30), then:

```powershell
$env:PYTHONIOENCODING = "utf-8"
python - <<'PY'
import re, pathlib, httpx
KEY = re.search(r"^DASHBOARD_API_KEY=(.*)$", pathlib.Path(".env").read_text(encoding="utf-8"), re.M).group(1).strip()
BIZ = "a1b2c3d4-0000-4000-8000-000000000001"
D = "http://127.0.0.1:8000/api/v1/dashboard"
c = httpx.Client(timeout=60, params={"business_id": BIZ})
H = {"X-Dashboard-Key": KEY}

data = c.get(f"{D}/bookings", headers=H).json()
print("bookings:", len(data["bookings"]), "| pending:", data["pending"])

pending = [b for b in data["bookings"] if b["status"] == "pending"]
if not pending:
    raise SystemExit("Make a booking in scripts/chat.py first.")

b = pending[0]
print("approving:", b["reference"], b["serviceName"], b["date"], b["time"])

r = c.post(f"{D}/bookings/{b['id']}/decision", headers=H,
           json={"decision": "approve", "note": "See you then!", "decided_by": "Rahul"})
print("->", r.status_code, r.json()["booking"]["status"],
      "| customer notified:", r.json()["customer_notified"])

# Approving twice must be refused.
r2 = c.post(f"{D}/bookings/{b['id']}/decision", headers=H, json={"decision": "approve"})
print("second attempt:", r2.status_code, r2.json()["detail"])
PY
```

### Expected result

```
bookings: 1 | pending: 1
approving: 7F3A9C2E Personal Training 2026-09-26 6:00 PM
-> 200 confirmed | customer notified: True
second attempt: 409 This booking is already 'confirmed' and cannot be decided again.
```

Then check the customer's side — the confirmation is in their thread:

```sql
select author, body from messages
order by created_at desc limit 3;
```

You should see a `system` message reading *"Your Personal Training on 2026-09-26
at 6:00 PM is confirmed. Reference 7F3A9C2E. See you then!"* (After Guide 3's
STEP 40 the date reads *"Sat, 26 Sep 2026"*.)

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `404 Booking not found` | Wrong id, or wrong business | Copy the id from `/bookings`, same `business_id`. |
| `409 already 'confirmed'` | Already decided | Expected. Make a new booking to test again. |
| `customer_notified: false` | The booking has no `conversation_id` | Only bookings made in chat have one. Dashboard-created ones will not. |
| Confirmation never appears in the chat | The customer's tab is closed | It is stored either way; they see it next visit. |
| `KeyError: 'starts_at'` | A row from a partial insert | `_booking` guards with try/except; check you copied it. |

---

## STEP 32 — Wire the bookings screen

### Goal

Make `/dashboard/bookings` show real bookings and let the owner approve them.

### Why?

The screen is already built — stats, calendar, filters, a table and a detail
modal — running on `mockBookings`. Same job as Guide 1: swap the data source,
keep the layout.

### Files involved

```
frontend/src/
├── types/booking.ts                              ← add one optional field
├── lib/constants.ts                              ← add todayISO()
├── lib/api/dashboard.ts                          ← add the bookings calls
├── features/bookings/components/
│   ├── PendingApprovals.tsx                      ← NEW
│   └── BookingCalendar.tsx                       ← edit (real date, not MOCK_TODAY)
└── app/dashboard/bookings/page.tsx               ← edit (data source + handlers)
```

### Code

**`frontend/src/types/booking.ts`** — add two optional fields to `Booking`:

```ts
export interface Booking {
  id: string;
  businessId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  serviceId: string;
  serviceName: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM (e.g. "10:00 AM")
  durationMinutes: number;
  price: number;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  staffAssigned?: string;
  notes?: string;
  bookedVia: "customer_chat" | "dashboard" | "manual";
  createdAt: string;
  /** Short code shown to the customer in chat, e.g. "7F3A9C2E". */
  reference?: string;
}
```

**`frontend/src/lib/api/dashboard.ts`** — add `Booking` to the type import and
these calls to the `dashboardApi` object:

```ts
  bookings: () =>
    call<{ bookings: Booking[]; pending: number }>("/bookings"),

  decideBooking: (bookingId: string, decision: "approve" | "reject", note = "") =>
    call<{ booking: Booking; customer_notified: boolean }>(
      `/bookings/${bookingId}/decision`,
      { method: "POST", body: { decision, note, decided_by: "owner" } },
    ),

  setBookingStatus: (bookingId: string, status: Booking["status"], note = "") =>
    call<{ booking: Booking }>(`/bookings/${bookingId}/status`, {
      method: "POST",
      body: { status, note },
    }),
```

and extend `DashboardStats`:

```ts
export interface DashboardStats extends ChatStats {
  openRequests: number;
  pendingBookings: number;
  business: { id: string; name: string; chatSlug: string; chatEnabled: boolean };
}
```

**`frontend/src/app/dashboard/bookings/page.tsx`** — four changes.

**1.** Replace the mock import:

```tsx
import { mockBookings } from "@/data/mock-bookings";
```

with:

```tsx
import { dashboardApi, HubError, LIVE_BUSINESS_ID } from "@/lib/api/dashboard";
```

and add `useCallback`, `useEffect` to the React import.

**2.** Replace the bookings state line:

```tsx
  const [bookings, setBookings] = useState<Booking[]>(mockBookings);
```

with:

```tsx
  // LIVE_BUSINESS_ID is a build-time constant, so "not configured" is known at
  // construction — no effect, no cascading render.
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured
      ? null
      : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const refresh = useCallback(async () => {
    try {
      const data = await dashboardApi.bookings();
      setBookings(data.bookings);
      setPending(data.pending);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof HubError ? error.message : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before touching state, so nothing is set synchronously
    // here — the lint rule cannot see past the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [configured, refresh]);
```

**3.** Add the approve/reject handlers next to the existing ones:

```tsx
  const handleDecide = async (id: string, decision: "approve" | "reject") => {
    try {
      const result = await dashboardApi.decideBooking(id, decision);
      setBookings((prev) => prev.map((b) => (b.id === id ? result.booking : b)));
      setPending((n) => Math.max(0, n - 1));
      showToast(
        result.customer_notified
          ? `Booking ${decision === "approve" ? "confirmed" : "declined"} — the customer has been told in their chat.`
          : `Booking ${decision === "approve" ? "confirmed" : "declined"}.`,
      );
    } catch (error) {
      showToast(error instanceof HubError ? error.message : "Could not update the booking.", "error");
    }
  };
```

> If this page has no `useToast` yet, add
> `const { toast, showToast, dismissToast } = useToast();` and render
> `<Toast toast={toast} onDismiss={dismissToast} />` at the end, the same way
> `customer-chat/page.tsx` does.

**4.** Create the pending-approvals strip. It goes above everything else, so
the thing that needs a human is the first thing on screen.

**`frontend/src/features/bookings/components/PendingApprovals.tsx`** — new file.
The full source is in the repo; the shape of it is:

```tsx
interface PendingApprovalsProps {
  bookings: Booking[];
  /** Resolves when the decision has been saved. Rejects to show an error. */
  onDecide: (id: string, decision: "approve" | "reject", note: string) => Promise<void>;
}

export function PendingApprovals({ bookings, onDecide }: PendingApprovalsProps) {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  if (bookings.length === 0) return null;   // no empty "0 pending" panel

  // ... one <li> per booking: service + reference, date/time, customer,
  //     then [Note] [Decline] [Approve], and a textarea when Note is open.
}
```

Three things in there are deliberate:

- **`if (bookings.length === 0) return null;`** — a permanent empty
  "0 pending approvals" panel trains people to ignore that part of the screen.
- **The Note box** — the backend already forwards `note` into the customer's
  chat alongside the decision. Building that and never exposing it would waste
  it, and "please arrive 10 minutes early" is exactly the kind of thing an owner
  wants to attach to an approval.
- **`busyId`** — the buttons disable while the request is in flight, so a
  double-click cannot fire two decisions and collect a 409 for the second.

**5.** Render it in the page, above the stats:

```tsx
      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          {loadError}
        </div>
      )}

      <PendingApprovals bookings={pendingBookings} onDecide={handleDecide} />
```

with

```tsx
  const pendingBookings = useMemo(
    () => bookings.filter((b) => b.status === "pending"),
    [bookings],
  );
```

**6.** Route the table and modal buttons through the API. A `pending` booking
goes to the *decision* endpoint (which also messages the customer); anything
else goes to the plain status endpoint:

```tsx
  const handleUpdateStatus = useCallback(
    async (id: string, status: BookingStatus) => {
      const current = bookings.find((b) => b.id === id);
      if (current?.status === "pending" && (status === "confirmed" || status === "cancelled")) {
        await handleDecide(id, status === "confirmed" ? "approve" : "reject");
        return;
      }
      try {
        const updated = await dashboardApi.setBookingStatus(id, status);
        setBookings((prev) => prev.map((b) => (b.id === id ? updated : b)));
        showToast(`Booking marked ${status}.`);
      } catch (error) {
        showToast(error instanceof HubError ? error.message : "Could not update the booking.", "error");
        void refresh();
      }
    },
    [bookings, handleDecide, refresh, showToast],
  );
```

**7.** Two honesty fixes while you are in here.

The payment control in the detail modal has no endpoint behind it, so it says
so rather than changing a number that snaps back on the next poll:

```tsx
  const handleUpdatePayment = useCallback(() => {
    showToast("Payment tracking is not connected yet — this is the Payments Agent's job.", "info");
  }, [showToast]);
```

And the screen must stop using the mock date. Add to
**`frontend/src/lib/constants.ts`**:

```ts
export function todayISO(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
```

then swap `MOCK_TODAY` for it in `bookings/page.tsx` and in
`features/bookings/components/BookingCalendar.tsx`, reading it once per mount:

```tsx
  const [today] = useState(todayISO);
```

Leave `MOCK_TODAY` alone everywhere else — the other screens are still mock and
still want a fixed date.

Also drop the **New Appointment** button and `NewBookingModal` from this page.
There is no `POST /bookings` endpoint, so the button could only ever add a row
to local state that vanishes on the next poll. The modal file stays on disk for
whenever that endpoint gets written.

### Explain the code

```tsx
const timer = setInterval(() => void refresh(), 10000);
```
Ten seconds rather than the chat page's six. Bookings arrive far less often than
chat messages, and each poll pulls the whole list.

```tsx
setPending((n) => Math.max(0, n - 1));
```
Decrement locally so the strip disappears immediately, rather than waiting up to
ten seconds for the next poll. The `Math.max` guards against going negative if
two tabs both approve.

```tsx
result.customer_notified ? "...the customer has been told in their chat." : "..."
```
Reports what actually happened. A booking made from the dashboard has no
conversation, so nobody is told — and the owner should know that, because it
means they still have to ring the customer.

```tsx
if (bookings.length === 0) return null;
```
The strip only exists when there is something to do. A permanent empty "0
pending approvals" panel trains people to ignore that part of the screen.

```tsx
const serviceOptions = useMemo(() => { ...from the bookings themselves... });
```
The mock screen read a fixed service list. Live, a business adds and retires
services, and offering a filter for one nobody has ever booked is useless — so
the dropdown is built from whatever actually appears in the data.

```tsx
if (current?.status === "pending" && ...) { await handleDecide(...); return; }
```
Same button to the owner, two very different things underneath. Confirming a
*pending* booking is a decision the customer must be told about; marking an
already-confirmed one `completed` is just bookkeeping. Routing on the current
status means the table's Confirm button cannot accidentally skip the message.

```tsx
void refresh();   // inside the catch
```
A failed write usually means our copy is stale — the likeliest cause is a second
tab that already decided this booking. Refetching turns a confusing error into a
screen that now shows the truth.

```ts
export function todayISO(): string {  // built from local parts
```
Not `toISOString().slice(0, 10)`. That converts to UTC first, so for everyone
east of Greenwich it reports *yesterday* for part of every evening — which would
quietly empty the "Today's Bookings" card from 5:30 AM IST backwards.

```ts
  /** Short code shown to the customer in chat, e.g. "7F3A9C2E". */
  reference?: string;
```
Optional, so every existing mock row still type-checks. Making it required would
break `mock-bookings.ts`, which other screens still use.

### How to test

Two windows again:

- **Left:** <http://localhost:3000/chat/pulse-fitness>
- **Right:** <http://localhost:3000/dashboard/bookings>

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Customer: book a session (5 turns) | Agent says **requested**, gives a reference |
| 2 | Owner: watch the bookings page | Within 10 s a **"1 booking waiting for you"** strip appears |
| 3 | Owner: click **Approve** | Toast says the customer has been told |
| 4 | Customer: watch the chat | The confirmation appears — the thread updates |
| 5 | Owner: reload | Status is `confirmed`, the strip is gone |
| 6 | Customer: book the same slot again | It is refused; other times are offered |
| 7 | Customer: "cancel my booking" + phone | Cancelled, and the slot frees up |

### Expected result

Step 4 is the one that matters. The customer asked an AI for a booking, a human
approved it, and the confirmation landed in the same chat window — with no
email, no SMS and no provider in between.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| "Set NEXT_PUBLIC_LIVE_BUSINESS_ID…" | Env var missing | Add it and **restart** `npm run dev`. |
| `Property 'reference' does not exist` | Type not extended | Add the optional field to `Booking`. |
| Approve does nothing | Already decided elsewhere | The API returns 409; the toast shows it. |
| Confirmation never reaches the chat | Customer tab closed, or no `conversation_id` | Stored regardless; they see it on their next visit. |
| The strip never appears | Bookings are being auto-confirmed | `require_approval` in the subscription settings must be `true`. |
| Calendar shows nothing | It reads `date`, which is blank for a bad row | Check `starts_at` is a valid timestamp. |

---

## STEP 33 — Switch it on for real

### Goal

Confirm the whole thing works from the customer's point of view, and know how to
turn booking on or off per business.

### Why?

Booking is a **paid capability**. The whole point of `agent_subscriptions` is
that a business gets what it pays for — so it needs to be genuinely switchable,
and switching it off must degrade gracefully rather than break.

### Commands

Turn booking **on** for a business:

```sql
update public.agent_subscriptions
   set is_active = true,
       settings = '{"require_approval": true, "slot_minutes": 30, "max_days_ahead": 30}'::jsonb
 where agent_key = 'booking'
   and business_id = 'a1b2c3d4-0000-4000-8000-000000000001';
```

Turn it **off**:

```sql
update public.agent_subscriptions set is_active = false
 where agent_key = 'booking'
   and business_id = 'a1b2c3d4-0000-4000-8000-000000000001';
```

Let the agent confirm bookings itself, with no approval step:

```sql
update public.agent_subscriptions
   set settings = settings || '{"require_approval": false}'::jsonb
 where agent_key = 'booking';
```

### How to test

First, without a browser and without spending an LLM call. `scripts/check_capability.py`
flips the subscription off, rebuilds exactly what `run()` would build, flips it
back on and rebuilds again:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
python scripts\check_capability.py
```

Expected:

```
booking OFF
  capabilities : ['customer_support']
  tools (5)   : search_knowledge, get_business_info, list_services, save_contact_details, escalate_to_human
  prompt       : 2393 chars

booking ON
  capabilities : ['customer_support', 'booking']
  tools (9)   : search_knowledge, get_business_info, list_services, save_contact_details, escalate_to_human, check_availability, request_booking, get_my_bookings, cancel_booking
  prompt       : 3076 chars

  PASS  off: capability absent
  PASS  off: no booking tools
  PASS  off: prompt refuses booking
  ...
```

> **After Guide 3** the numbers are 7 and 11, not 5 and 9, because the Customers
> capability adds two tools of its own. The script now builds its list with
> `compose_tools()`, the function `run()` uses, so it always matches a real
> chat. The current output is in [RUN-AND-TEST.md](../RUN-AND-TEST.md).

Five tools versus nine, and ~700 characters of prompt, is the whole capability
system visible in one screen. The script switches booking back **on** in a
`finally` block, so it leaves the demo business usable however it exits.

Then the real thing. **With booking off**, open a fresh chat and ask to book:

> *"Can I book a personal training session on Friday?"*

Expect: it says it cannot make bookings, and offers to take your number. It must
**not** promise a time — that is `NO_BOOKING_RULES` doing its job.

Turn it back on, start a **new** chat (the old one has the old prompt in its
history), and ask again. Now it offers slots.

### Expected result

The same customer, the same chat link, the same sentence — two different
behaviours, driven entirely by one boolean in the database.

That is the platform working as designed: one codebase, capabilities sold
separately.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Still books after switching off | Old conversation, old system prompt in history | Start a new chat. The prompt is built per run, but history carries context. |
| Still refuses after switching on | Subscription row missing for that business | `select * from agent_subscriptions where agent_key='booking';` |
| `require_approval: false` ignored | Settings JSON overwritten rather than merged | Use `settings || '{...}'::jsonb` to merge. |

---

## End of Part 2 — checklist

- [ ] `/dashboard/bookings` returns real rows in the frontend's `Booking` shape
- [ ] Approving writes `confirmed` and posts into the customer's chat
- [ ] Approving twice returns `409`
- [ ] The bookings screen shows a pending strip with Approve / Decline
- [ ] The customer sees the confirmation in their open chat
- [ ] `bookingsFromChat` is now a real number
- [ ] Switching the subscription off makes the agent decline politely

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
npm run lint
cd ..
git add backend frontend docs
git commit -m "Add booking approval and wire the bookings screen"
```

Next: [03-troubleshooting.md](03-troubleshooting.md).
