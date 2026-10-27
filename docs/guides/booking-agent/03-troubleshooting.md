# Guide 2 — Booking troubleshooting

Booking bugs split cleanly into three kinds. Work out which one you have before
changing anything.

```
1. The agent said something wrong          -> prompt or tool description
2. The agent called the right tool but got
   the wrong data back                     -> the tool's logic, or the database
3. The agent did the right thing and the
   screen disagrees                        -> the API mapping or the React page
```

The `[tool]` lines in `scripts/chat.py` tell you which one in about two seconds.

---

## Diagnose in the right order

```
1. Is booking switched on?
   select agent_key, is_active, settings from agent_subscriptions;
   is_active false?  -> the agent has no booking tools at all, by design.

2. Did it call the tool?
   Terminal 1: "step 1 -> check_availability({...})"
   No tool call?  -> prompt problem. The model answered from imagination.

3. What did the tool return?
   The result is in agent_logs.tool_calls. Read it:
     select tool_calls from agent_logs order by created_at desc limit 1;
   free_slots empty?  -> hours, or everything is booked, or it is all in the past.

4. Did the row land?
   select reference, service_name, starts_at, status from
     (select id, left(id::text,8) as reference, service_name, starts_at, status
      from appointments order by created_at desc limit 5) t;

5. Does the screen show it?
   DevTools -> Network -> /api/hub/dashboard/bookings
```

---

## Symptom → cause

### The agent will not book

| Symptom | Cause | Fix |
| --- | --- | --- |
| "I can't make bookings" | The booking subscription is off | `update agent_subscriptions set is_active = true where agent_key='booking';` then start a **new** chat |
| Offers to book but never calls the tool | Tools not appended in `run` | Log `len(tools)` — should be 9, not 5 |
| Switched it on but it still refuses | Old conversation, old context in history | Start a new chat |
| "No service called X" | The model invented a service name | The error lists the valid ones; it should retry. If not, sharpen the `list_services` description |

### Wrong times

| Symptom | Cause | Fix |
| --- | --- | --- |
| Offers slots when closed | Day index off by one | `hours` JSON is **Sunday=0**; Python's `weekday()` is **Monday=0** |
| Offers a date in the past | The prompt does not state today | `TODAY IS {today}` must be in `SYSTEM_TEMPLATE` |
| "Friday" resolves to the wrong week | Same cause | Same fix |
| Offers a slot that overlaps a booking | A long service only checked its start time | The `blocks` loop must check every slot the duration covers |
| A 60-minute slot offered 30 minutes before closing | Loop condition | `while cursor + duration <= end`, not `cursor < end` |
| Times look shifted by 5.5 hours | Stored local instead of UTC | `request_booking` must call `.astimezone(UTC)` before insert |
| `free_slots` empty on an open day | Everything booked, or all past | Check `booked_between` output for that day |

### Booking writes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Two customers got the same slot | The partial unique index is missing | `select indexname from pg_indexes where tablename='appointments';` — you need `appointments_no_double_booking` |
| `SlotTaken` on a slot that is free | Cancelled rows still blocking | The index must be `where status in ('pending','confirmed')` |
| Bookings created `confirmed` | `require_approval` not set | It defaults to `true`; check the settings JSON |
| Price is 0 | Service had no price, or the snapshot was skipped | `price` is passed in by `request_booking`, not joined |
| `null value in column "customer_id"` | `upsert_from_chat` returned None | It refuses a name with no phone — the tool must ask for a number |
| Cancelling does not free the slot | Partial index missing the `where` clause | Recreate it |

### Approval and the dashboard

| Symptom | Cause | Fix |
| --- | --- | --- |
| `409 already 'confirmed'` | Already decided | Expected. Make a new booking to test again |
| `customer_notified: false` | The booking has no `conversation_id` | Only chat bookings have one; dashboard bookings do not |
| Confirmation never appears in the chat | Their tab is closed | It is stored; they see it next visit |
| The pending strip never appears | Auto-confirm is on | `require_approval` must be `true` |
| Calendar is empty | `date` is blank for a row | A malformed `starts_at`; `_booking` blanks it rather than crashing |
| `Property 'reference' does not exist` | Type not extended | Add the optional `reference` to `Booking` |

### The usual suspects from Guide 1

Still apply here, and still cause most confusion:

| Symptom | Fix |
| --- | --- |
| "I'm getting a lot of messages right now" | OpenRouter free tier: ~20 calls/min, and booking uses 2–3 per message. Wait 20 s. **Not a bug.** |
| Replies take 5–15 seconds | Free endpoints queue behind paid traffic |
| `No endpoints found for <model>` | `python scripts\check_models.py`, copy a live id into `LLM_MODEL` |
| `ModuleNotFoundError: No module named 'app'` | Run scripts from `backend/`, keep the `sys.path` lines |
| `ZoneInfoNotFoundError` | `python -m pip install tzdata` |

---

## Techniques

**Test tools without the LLM.** Booking has real logic — slot maths, timezones,
the race. Test it directly:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
python scripts\check_bookings.py
```

**Watch what the tool actually returned:**

```sql
select created_at, input_text, jsonb_pretty(tool_calls) as tools
from agent_logs
where tool_calls::text like '%check_availability%'
order by created_at desc limit 3;
```

This one query settles "is the agent lying, or is the data wrong?" faster than
anything else.

**Reset the calendar** when test bookings clutter things up:

```sql
delete from appointments
where business_id = 'a1b2c3d4-0000-4000-8000-000000000001'
  and source = 'customer_chat';
```

**See the slot maths by hand:**

```sql
select left(id::text, 8) as ref, service_name, starts_at, duration_minutes, status
from appointments
where business_id = 'a1b2c3d4-0000-4000-8000-000000000001'
  and starts_at::date = '2026-09-26'
order by starts_at;
```

---

## Known limits

Honest list. None of these block the next agent.

| Limit | Impact | When to fix |
| --- | --- | --- |
| One booking per start time, business-wide | A gym with three trainers can only take one 6 PM booking | Add a `resource_id` (staff/room) and make the unique index `(business_id, resource_id, starts_at)` |
| No buffer between bookings | Back-to-back with no cleanup time | Add `buffer_minutes` to the subscription settings and subtract it in the slot loop |
| No recurring bookings | "Every Tuesday" needs seven separate requests | A `recurrence` column and an expansion job |
| No reminders | Nobody is nudged the day before | A scheduled job plus the customer's chat thread |
| Cancellation needs only a phone number | Someone who knows both could cancel another's slot | Proportionate for now; a one-time code would be stronger |
| No cancellation window | A customer can cancel one minute before | Read a `min_cancel_hours` setting in `_cancel_booking` |
| Bookings made in the dashboard have no chat | The customer is not told automatically | Expected; the owner rings them |

---

## What you have built

Two capabilities, one agent, one chat box:

```
              /chat/pulse-fitness
                      │
              one agent, nine tools
         ┌────────────┴────────────┐
         ▼                         ▼
  customer_support             booking
  search_knowledge             check_availability
  get_business_info            request_booking
  list_services                get_my_bookings
  save_contact_details         cancel_booking
  escalate_to_human
         │                         │
         └────────────┬────────────┘
                      ▼
                  Supabase
                      │
              owner dashboard
        conversations  ·  bookings (approve)
```

No router. No second LLM call. No new chat UI, no new model, no new accounts —
which was the whole point of building the first agent carefully.

---

## The next agent, and when to add the supervisor

**Inventory or Payments** follow the same five moves:

1. A migration for the new table.
2. `app/repositories/<thing>.py`.
3. `app/agents/tools/<thing>_tools.py` with its own `build_tools(ctx)`.
4. Three lines in `support_agent.py` — a capability check, a tool append, and a
   rules block.
5. Wire the dashboard screen that already exists on mock data.

**Then stop and add the supervisor.** At four or five capabilities the flat tool
list gets long — 15 to 20 tools in every request — and two things start to go
wrong:

- the model picks the wrong tool more often, because similar tools blur together
- every request carries every tool schema, which costs tokens and latency on
  *all* messages, including "what time do you close?"

That is when a router earns its extra call: it reads the message once, decides
the capability, and hands the specialist a short focused list. The refactor is
smaller than it sounds, because `active_capabilities()` and the per-capability
`build_tools(ctx)` modules are already the seams it needs.

Build it when the tool list hurts — not before.

---

Back to [the guide index](../README.md) ·
[Run and test](../RUN-AND-TEST.md)
