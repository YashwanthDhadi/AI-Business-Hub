# 06 — Agent execution traces

There are no agent executions to trace. What follows is a complete trace of the
**simulation** that stands in for one, because that is what the code does and
because the real implementation must slot into exactly these seams.

Read `05_AGENT_ARCHITECTURE.md` first if you have not.

---

## Trace 1 — "Find overdue customer payments and prepare reminders"

The flagship path. Every line below is a real call in the current code.

### Stage A — the user submits

```
components/command/command-composer.tsx
  form onSubmit → props.onSubmit(value)
app/app/command/page.tsx:submit(command)
  setDraft(command)
  void run.submit(command)          // run = useCommandRun(businessId, actorName)
```

`businessId` and `actorName` come from `useWorkspace()`
(`components/providers/session-provider.tsx`). `actorName` is the signed-in
person's display name — it becomes `triggeredBy` on the run and `actor` on the
audit row.

### Stage B — planning

`lib/hooks/use-command-run.ts:62`

```ts
cancelled.current = false;   skipRef.current = false;
setError(undefined); setPlan(undefined); setRun(undefined);
setActiveStep(-1);
setPhase("planning");                                  // ① UI shows "Interpreting…"

const nextPlan = await workflowService.plan(businessId, trimmed);
```

`workflow-service.ts:34` → `serve("/businesses/:id/commands/plan", …, {latencyMs: 260})`
→ `api-client.ts:78` takes the mock branch → `await sleep(260)` → resolver:

```ts
const business = BUSINESS_INDEX.get(businessId);
if (!business) throw new Error("Business not found");
return planCommand(command, business);
```

`planCommand` (`lib/mock/workflows.ts:164`):

1. `classify(command)` — scores the text against nine keyword lists.
   `"overdue"`, `"payment"`, `"reminders"` all hit `payment_followup`; score
   ≈ 3 + (7+7+9)/40 ≈ 3.58. Nothing else scores above 1. → `payment_followup`.
2. `PLAN_BY_INTENT.payment_followup` gives the base plan.
3. `vocabulary(business.type)` rewrites `scope` for three intents.
   `payment_followup` is not one of them, so `base.scope` survives.

Result:

```ts
{ intent: "Payment follow-up",
  scope: "Customers with overdue invoices",
  action: "Prepare reminder messages",
  capability: "payment_followup",
  requiresApproval: true }
```

Back in the hook: `if (cancelled.current) return; setPlan(nextPlan);`

### Stage C — building the run

```ts
const started = await workflowService.start(businessId, trimmed, triggeredBy);
```

`workflow-service.ts:51` → `serve(..., {latencyMs: 420})` → `buildRun()`
(`workflows.ts:778`), which classifies **again** (the classifier runs twice per
submit — once for the plan, once for the run; it is pure, so this is only waste,
not a bug), plans again, then calls `buildSteps(intent, business, plan)`.

Inside the `payment_followup` branch (`workflows.ts:215-299`) three real reads
happen:

| Call | Module | What it returns |
| --- | --- | --- |
| `overduePayments(business.id)` | `lib/mock/business-data.ts` | Every invoice with `status: "overdue"` for this tenant |
| `.reduce(...)` | — | The true sum of those invoices |
| `approvalsFor(business.id).find(actionType === "send_payment_reminders" && status === "pending")` | `lib/mock/approvals.ts:406` | The pre-existing pending approval batch, or `undefined` |

Six steps come back, all `status: "pending"`, ids `step_1…step_6` from the
module-level `stepSeq` counter (`workflows.ts:185` — a global that keeps counting
for the life of the page, so ids are unique but not stable across reloads).

The run:

```ts
{ id: `run_${Date.now().toString(36)}`,
  businessId, request: command,
  intent: "Payment follow-up", scope, action,
  capability: "payment_followup",
  status: "queued",
  steps: [6],
  startedAt: new Date().toISOString(),
  triggeredBy: actorName,
  channel: "command_center",
  approvalId: gate?.approvalId }
```

### Stage D — the animation loop

`use-command-run.ts:83-99`

```ts
setRun({ ...started, status: "running" });
setPhase("running");

for (let index = 0; index < started.steps.length; index += 1) {
  if (cancelled.current) return;
  const step = started.steps[index];

  setActiveStep(index);
  patchStep(index, "running");

  if (!skipRef.current) {
    await sleep(Math.max(MIN_STEP_MS, step.durationMs * SPEED));
  }
  if (cancelled.current) return;

  patchStep(index, step.kind === "approval_gate" ? "awaiting_approval" : "completed");
}
```

`SPEED = 0.42`, `MIN_STEP_MS = 420`. Actual wall clock for this run:

| # | Step | actor | `durationMs` | × 0.42, floored at 420 |
| --- | --- | --- | --- | --- |
| 1 | Understanding your request | Supervisor | 900 | 420 ms (min applies) |
| 2 | Planning workflow | Supervisor | 1100 | 462 ms |
| 3 | *N* overdue customers found | Payment Agent | 1600 | 672 ms |
| 4 | Customer information retrieved | Customer Agent | 1300 | 546 ms |
| 5 | *N* reminder messages prepared | Communication Agent | 1800 | 756 ms |
| 6 | Sending messages requires your approval | Approval Gate | 700 | 420 ms (min applies) |

Total 3276 ms of animation, plus 260 + 420 ms of simulated request latency
≈ **3.96 s** from submit to the approval prompt.

Note the loop **does not stop** at the gate — it marks the gate
`awaiting_approval` and keeps iterating. It happens to be the last step in every
branch that has one, so the effect is the same. If a future branch put a step
after a gate, that step would animate to `completed` while the human had not yet
decided. Recorded in `32_UNKNOWN_BROKEN_INCOMPLETE.md`.

### Stage E — settling and the audit row

`use-command-run.ts:101-116`

```ts
setActiveStep(-1);
const gate = started.steps.find((step) => step.kind === "approval_gate");
const finalPhase = gate ? "awaiting_approval" : "completed";
setRun(current => ({...current, status: gate ? "awaiting_approval" : "completed",
                    completedAt: new Date().toISOString()}));
setPhase(finalPhase);

void workflowService.complete(started);       // fire and forget — errors are swallowed
```

`workflowService.complete` (`workflow-service.ts:64`) is where the audit
requirement is honoured — one `recordActivity()` call:

```ts
recordActivity({
  businessId: run.businessId,
  workflow: capabilityMeta(run.capability).name,   // "Payment follow-up"
  capability: run.capability,
  actor: "Supervisor",
  actorType: "supervisor",
  action: run.request,                             // the raw text the owner typed
  result: "Prepared and held for approval",
  status: "awaiting_approval",
  severity: "warning",
  workflowRunId: run.id,
  approvalId: gate?.approvalId,
});
```

That row is unshifted onto the in-memory `ACTIVITY` array and is immediately
visible on `/app/activity`. It disappears on refresh.

`void` on line 116 means a thrown `complete()` never reaches the `catch`. In the
mock path it cannot throw; against a real API it silently loses the audit row.
Also recorded in doc 32.

### Stage F — the human decides

`app/app/command/page.tsx:approveDirect(approvalId)`

```
approvalService.approve(approvalId, actorName)     // sleep 700 ms
  → APPROVALS.find(id)
  → approval.status = "approved"                   // mutates the shared array
  → approval.decidedAt / decidedBy set
  → recordActivity(#1)  actorType "human"  "Approved: …"    status "approved"
  → recordActivity(#2)  actorType "agent"  "Executing approved action"  status "in_progress"
  → returns { approval, outcome: "17 records queued — Communication Agent is executing now." }
run.resolveApproval("approved")
  → gate step status → "completed"; run.status → "completed"; phase → "completed"
toast.success("Approved", { description: result.outcome })
history.refetch()
```

**The second activity row is the honest edge of the whole product.** It says
"Executing approved action / 17 records in progress" and then nothing executes.
There is no sender, no queue, no worker. The status stays `in_progress` forever
because nothing exists to move it on. See `16_ASYNC_PROCESSING.md`.

Rejection is the mirror image: `status = "rejected"`, one human activity row,
outcome `"Nothing was sent. The workflow has been cancelled."`, and
`resolveApproval("rejected")` marks the gate `skipped` and the run `cancelled`.

---

## Trace 2 — "Show today's appointments" (no gate)

Same machinery, different branch, and it demonstrates the no-approval path.

```
classify("Show today's appointments")
  → "schedule_view"   ("today's" and "appointments" both hit)
planCommand → scope rewritten by vocabulary():
  salon  → "Today's appointments"
  gym    → "Today's classes"
  garage → "Today's service jobs"
buildSteps("schedule_view", …)
  reads appointmentsOn(business.id, today) — real rows
  returns steps with NO approval_gate
loop completes every step
gate === undefined → phase "completed"
workflowService.complete() → activity row
   status "completed", severity "success",
   result = last step's title
```

Because `requiresApproval` is false in `PLAN_BY_INTENT.schedule_view`, no
approval is created and the panel renders a result card instead of the
Approve / Review buttons. Reading a schedule is not customer-facing; sending a
message is. That distinction is a per-intent constant, not a computed policy —
see `15_SECURITY_ARCHITECTURE.md`.

---

## Trace 3 — a command with no match

```
submit("what is the weather")
classify → every list scores 0 → best.intent stays "fallback"
PLAN_BY_INTENT.fallback:
  { intent: "General business request",
    scope: "Your business data",
    action: "Interpret and route",
    capability: "customer_support",
    requiresApproval: false }
buildSteps("fallback", …) → the default branch (workflows.ts, tail)
  final step detail: "I can go deeper on any of these. Try asking about
  overdue payments, today's schedule, stock levels or a business summary."
```

No error, no failure state. An unrecognised request is answered with a menu.
This is the only fallback behaviour in the system — there is no clarifying
question, no retry, no escalation.

---

## Trace 4 — the failure path

`phase: "failed"` is reachable, but only from a throw inside `plan()` or
`start()`. In practice one condition triggers it:

```ts
const business = BUSINESS_INDEX.get(businessId);
if (!business) throw new Error("Business not found");
```

Then `serve()` wraps it: `api-client.ts` catches any resolver throw and rethrows
`new ApiError(message, 500, path)`. The hook's `catch` sets
`error = "Business not found"` and `phase = "failed"`, and `workflow-panel.tsx`
renders the failure card with a Retry button.

**When can `BUSINESS_INDEX` miss?** When the active business is a real Supabase
tenant with no mock dataset behind it — i.e. a workspace the user created through
onboarding rather than one of the three demo tenants. `lib/mock/demo-bridge.ts`
exists to prevent exactly that, mapping a real UUID onto a demo dataset key
(`business-data.ts:569`). If the bridge has not been registered for that id, the
Command Center fails with "Business not found". This is the most likely runtime
error a new user hits. See `30_DEBUGGING_GUIDE.md`.

---

## What the "history" traces are

`/app/automations` and the Command Center's history list show seven past runs.
They are not stored runs. `recentRuns(businessId)` (`workflows.ts:804`) builds
them **on every call** from a fixed array of seven seed commands, re-running
`buildRun()` for each and then overwriting `id`, `status`, `startedAt` and every
step status to look finished.

Consequences worth knowing before you debug something here:

- The same seven runs appear for every tenant, with tenant-appropriate numbers.
- Ids are `run_hist_<businessId>_<index>` — deterministic, which is why
  `workflowService.run(businessId, runId)` can look one up by regenerating the
  list.
- A run you just executed is **not** in the history. `history.refetch()` after an
  approval re-renders the same seven seeds.
- The `steps.map` status ternary at `workflows.ts:~830` has a redundant final
  branch (`completed || index < length-1 ? "completed" : "completed"`) — both
  arms are the same value. Harmless, noted in `26_CODE_QUALITY_AUDIT.md`.

---

## Timing summary

| Phase | Source of the delay | Duration |
| --- | --- | --- |
| `plan()` | `serve()` `latencyMs: 260` | 260 ms |
| `start()` | `serve()` `latencyMs: 420` | 420 ms |
| Each step | `max(420, durationMs × 0.42)` | 420–672 ms |
| `complete()` | `serve()` `latencyMs: 200`, fire-and-forget | not blocking |
| `approve()` | `serve()` `latencyMs: 700` | 700 ms |
| Every other read | `randomLatency()` in `api-client.ts` | randomised |

`fastForward()` sets `skipRef.current = true`, which skips the `sleep` but still
walks every step and still patches every status — so the whole run resolves
within one tick. The button appears while `phase === "running"`.

---

## Where a real trace would differ

| Simulated today | Real implementation |
| --- | --- |
| `classify()` keyword scoring | An LLM call producing a structured plan |
| `buildSteps()` returns the whole graph up front | Steps arrive as the supervisor decides them |
| `sleep()` per step | Actual tool latency |
| `durationMs` a constant | Measured |
| Client-side `for` loop | Server-side loop, streamed to the client |
| `run` lives in React state | A `workflow_runs` row plus `workflow_steps` |
| Audit row written once, at the end | One row per step, as it happens |
| Approval batch pre-exists in mock data | Created by the run that needs it |

The `workflow_runs`, `workflow_steps` and `activities` tables to hold all of that
**already exist** in `supabase/migrations/` and are not written to by any code.
See `11_DATABASE_ARCHITECTURE.md`.
