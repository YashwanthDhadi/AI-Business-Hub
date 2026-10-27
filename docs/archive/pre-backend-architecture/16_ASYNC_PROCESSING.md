# 16 — Asynchronous processing

## Status: none exists

**There is no asynchronous processing in this repository.** No queue, no worker,
no scheduler, no cron, no retry policy, no dead-letter handling, no job store.

| Checked for | Found |
| --- | --- |
| Celery, RQ, Dramatiq, Sidekiq, BullMQ, Bee-Queue, Agenda | **None** |
| Redis, RabbitMQ, SQS, Kafka, NATS, Pub/Sub | **None** |
| `node-cron`, `cron`, `croner`, `setInterval` for scheduling | **None** |
| Vercel Cron (`vercel.json` `crons`) | **None** — no `vercel.json` exists |
| GitHub Actions `schedule:` trigger | **None** — CI runs on push and PR only |
| Supabase `pg_cron` / `pg_net` extensions | **None** — only `pgcrypto` |
| Postgres `LISTEN`/`NOTIFY` | **None** |
| Supabase Edge Functions (`supabase/functions/`) | **None** |
| Supabase Realtime subscriptions | **None** — available, unused |
| Webhook receivers | **None** — no route handler exists to receive one |

Everything asynchronous in the UI is `await sleep(ms)` or a `useEffect`.

---

## What looks asynchronous and is not

### 1. The Automations page

`/app/automations` is the page most likely to be mistaken for working
infrastructure. It lists eight automations with descriptions, schedules,
run counts and success rates, each with a switch.

Source: `WORKFLOW_DEFINITIONS` in `lib/mock/agents.ts:222` — eight literal
objects of type `WorkflowDefinition` (`lib/types.ts:253`):

```ts
{
  id: "wf_payment_followup",
  name: "Overdue payment follow-up",
  description: "Finds overdue invoices, drafts a personalised reminder per
                customer and holds the batch for owner approval before sending.",
  capability: "payment_followup",
  trigger: "natural_language",
  steps: [
    { actor: "Supervisor",           action: "Plan the collection run" },
    { actor: "Payment Agent",        action: "Identify overdue invoices" },
    { actor: "Customer Agent",       action: "Enrich with customer context" },
    { actor: "Communication Agent",  action: "Draft reminders" },
    { actor: "Approval Gate",        action: "Owner approves the send" },
    { actor: "Communication Agent",  action: "Deliver and log" },
  ],
  requiresApproval: true,
  businessesUsing: 214,        // fabricated
  runsThisWeek: 1_842,         // fabricated
  successRate: 96.1,           // fabricated
  avgDurationSec: 42,          // fabricated
  status: "published",
  updatedAt: minutesAgo(4_320),
}
```

The eight, by trigger type:

| Trigger | Count | Definitions |
| --- | --- | --- |
| `event` | 4 | Low stock reorder, Inbound enquiry triage, Invoice generation, Missed call intake |
| `schedule` | 3 | Next-day booking confirmation, Daily business summary, Lapsed customer win-back |
| `natural_language` | 1 | Overdue payment follow-up |

`trigger` is declared as `"natural_language" | "schedule" | "event" | "webhook"`.
**`"webhook"` is never used**, and none of the other three is wired to anything:

- **`natural_language`** is the only one that actually happens, and only because
  a human types into the Command Center.
- **`schedule`** — nothing schedules. There is no cron.
- **`event`** — nothing emits or listens for events.
- **`webhook`** — there is no endpoint to receive one.

The `steps` array here is a **third, separate** list of actor strings, distinct
from the roster in `lib/mock/agents.ts` and from the step graph in
`lib/mock/workflows.ts`. Note that `wf_payment_followup`'s step 6 —
`Communication Agent · Deliver and log` — has **no counterpart** in the actual
`buildSteps()` graph, which stops at the approval gate. The catalogue describes
the intended post-approval send; the simulation does not include it.

Toggling a switch:

```ts
// app/app/automations/page.tsx:50, :70
const [disabled, setDisabled] = React.useState<Set<string>>(new Set());
…
toast.success(next ? `${name} resumed` : `${name} paused`, { … });
```

Local React state and a toast. Not persisted, not scheduled, reset on refresh.

### 2. The run animation

`use-command-run.ts` — `await sleep(Math.max(420, step.durationMs * 0.42))` per
step, in a `for` loop in the browser. It is a timed reveal of a pre-computed
array, not concurrent work. Fully traced in doc 06.

### 3. `useAsync`

A promise wrapper with `loading`/`error` state and a cancellation flag. It makes
a single call and awaits it. No queueing, no batching, no retry.

### 4. Simulated latency

`serve()` calls `await sleep(options.latencyMs ?? randomLatency())` where
`randomLatency()` returns 220–620 ms. This exists so loading states get built and
exercised during development — a deliberate design aid, not processing.

### 5. `void workflowService.complete(started)`

`use-command-run.ts:116`. The only fire-and-forget call in the codebase. The
`void` discards the promise, so a rejection never reaches the `catch` block eight
lines above. In the mock path it cannot reject. Against a real API this silently
loses the audit row for a completed run — the one record the product promises
always exists. Recorded in doc 32.

### 6. `platform.ts` health rows

`lib/mock/platform.ts` has a `"Task queue"` health row alongside `"Platform
API"`, `"AI orchestration"`, `"Database"`, `"Messaging delivery"` and
`"Accounting sync"`. All six are literal objects rendered on `/admin/health`.
There is no task queue for that row to describe.

---

## The consequence: the honest gap

`approvalService.approve()` writes two activity rows. The second says:

```
actor:  approval.agentName          // e.g. "Communication Agent"
action: "Executing approved action"
result: "17 records in progress"
status: "in_progress"
```

**Nothing then executes.** There is no sender, no worker, no retry. The row stays
`in_progress` forever because nothing exists to move it to `completed`.

This is the single clearest statement of where the project stands: the human
decision is captured correctly, the intent to act is recorded correctly, and the
acting does not happen.

---

## What has to be built

Seven pieces, in dependency order. None exists today.

| # | Piece | Why it is needed | Depends on |
| --- | --- | --- | --- |
| 1 | A job store | An approved batch must survive a page close | `approvals` + a `jobs` table (not in the schema) |
| 2 | A worker process | Something has to send the 17 messages | 1 |
| 3 | A scheduler | `schedule`-triggered automations: "every evening, confirm tomorrow's bookings" | 2 |
| 4 | An event bus | `event`-triggered automations: stock crossing a reorder level | 2 |
| 5 | Webhook receivers | Inbound WhatsApp replies, payment confirmations, missed calls | Route handlers (none exist) |
| 6 | Retry with backoff | A failed send must not be lost or duplicated | 1, 2 |
| 7 | Per-step audit rows | Today one row per run, written at the end | `activities` (exists) |

### The one non-obvious requirement

**Idempotency.** Every one of the eight automations either sends a customer
message or creates a financial record. A retry without an idempotency key sends
the reminder twice, and a customer receiving the same payment chase twice is worse
than not receiving it. `payments` has `unique (business_id, invoice_number)` and
`approval_items` has a stable id per record — those are the natural keys. Nothing
uses them for this purpose yet, because nothing sends.

### What the schema already supports

| Need | Table | Ready? |
| --- | --- | --- |
| Run history | `workflow_runs` | Yes — status enum includes `queued`, `running`, `awaiting_approval`, `completed`, `failed`, `cancelled` |
| Step history | `workflow_steps` | Yes — `unique (run_id, position)`, `started_at`, `completed_at` |
| Work items | `tasks` | Yes — `task_status` enum. **Not even seeded** |
| Audit | `activities` | Yes — append-only |
| Approval linkage | `approvals.run_id` | Yes |
| **A job queue** | — | **No such table** |

`workflow_runs.status = 'queued'` and the `tasks` table are the two places a
queue would attach. `tasks` is the only table in the schema that `seed.sql` does
not populate — it was designed for work that does not exist yet.

### Where the platform choice is already implied

Deployment is Vercel-shaped (`siteUrl()` reads `NEXT_PUBLIC_VERCEL_URL`), which
means the realistic options are:

1. **Vercel Cron + route handlers** — simplest; add `crons` to a `vercel.json`
   that does not exist yet, plus a route handler per schedule. Adequate for
   nightly booking confirmations.
2. **Supabase `pg_cron` + `pg_net`** — keeps scheduling next to the data; both
   extensions would need enabling.
3. **A separate FastAPI worker** — what `config.api.baseUrl` anticipates, and the
   only option that comfortably hosts a long-running agent loop.

Option 3 is the one the codebase was written for.

---

## Related documents

- `06_AGENT_EXECUTION_TRACES.md` — the "Executing approved action" dead end
- `11_DATABASE_ARCHITECTURE.md` — `tasks`, `workflow_runs`, `activities`
- `14_BACKEND_ARCHITECTURE.md` — where a worker would live
- `17_EXTERNAL_INTEGRATIONS.md` — what a worker would call
