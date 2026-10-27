# 09 — Tool architecture

## Status: no tool abstraction exists

**No tool is defined, registered, described to a model, or invoked.** There is no
tool registry, no schema, no dispatcher, no result envelope, no permission check
on a tool call. Searched:

| Searched for | Occurrences |
| --- | --- |
| `tool_use`, `tool_result`, `toolChoice`, `tools: [{ name, input_schema` | 0 |
| A tool base class, interface, or decorator | 0 |
| A registry / map from tool name to function | 0 |
| MCP server or client | 0 |
| Function-calling JSON schemas | 0 |

The word "tool" appears in two places, and neither is executable.

---

## What exists: `tools` as display labels

`lib/mock/agents.ts` — every roster row carries `tools: string[]`. These are
captions rendered under the agent's name on `/admin/agents`. Nothing parses,
resolves or calls them.

| Agent | `tools` (strings) |
| --- | --- |
| Supervisor | Agent registry · Business configuration · Approval policy engine |
| Support Agent | Knowledge base · WhatsApp Business · Customer records |
| Booking Agent | Booking calendar · Google Calendar · Staff roster |
| Payment Agent | Invoice ledger · Razorpay · UPI collections |
| Customer Agent | Customer records · Interaction history · Segmentation |
| Communication Agent | WhatsApp Business · Twilio SMS · Resend email · Tone profile |
| Inventory Agent | Stock ledger · Supplier directory |
| Reporting Agent | Business data warehouse · Chart renderer |
| Document Agent | Invoice ledger · Tax profile · Document storage |
| Reminder Agent | Scheduler · WhatsApp Business · Twilio SMS |
| Voice Agent | Telephony bridge |

23 distinct labels across 11 agents. **Not one corresponds to a function in this
codebase.** Some name real third-party products (WhatsApp Business, Twilio,
Razorpay, Google Calendar) which appear in `config.integrations` with
`enabled: false` and blank base URLs — see `17_EXTERNAL_INTEGRATIONS.md`. Others
name internal concepts ("Invoice ledger", "Tone profile", "Business data
warehouse") that do not exist as modules.

## What exists: `kind: "tool"` as an unused type variant

`lib/types.ts:182-189` declares seven step kinds:

```ts
export type WorkflowStepKind =
  | "understanding" | "supervisor" | "agent"
  | "tool" | "approval_gate" | "execution" | "result";
```

Counted across every branch of `buildSteps()`:

| Kind | Steps that use it |
| --- | --- |
| `agent` | 18 |
| `supervisor` | 9 |
| `approval_gate` | 6 |
| `result` | 3 |
| `understanding` | 1 (the shared step reused by every branch) |
| **`tool`** | **0 — declared, never produced** |
| **`execution`** | **0 — declared, never produced** |

`components/command/workflow-step-card.tsx` has icon and label handling for both,
so if a step of either kind ever appeared it would render. They are reserved for
the real implementation: `tool` for an individual tool call, `execution` for the
post-approval send. Recorded in `32_UNKNOWN_BROKEN_INCOMPLETE.md`.

---

## What actually reads data during a run

This is the honest answer to "how are tools executed": the step builder calls
plain synchronous functions from `lib/mock/` directly. No indirection, no
dispatch, no model involved.

Call counts inside `lib/mock/workflows.ts`:

| Function | Module | Calls | What it returns |
| --- | --- | --- | --- |
| `overduePayments(businessId)` | `business-data.ts:574` | 5 | Invoices with `status: "overdue"`, sorted |
| `approvalsFor(businessId)` | `approvals.ts:406` | 6 | This tenant's approval batches |
| `appointmentsOn(businessId, offset)` | `business-data.ts:586` | 5 | Bookings on a day relative to today |
| `datasetFor(businessId)` | `business-data.ts:566` | 5 | The whole tenant dataset (memoised) |
| `lowStockItems(businessId)` | `business-data.ts:593` | 2 | Items at or below reorder level |
| `customersNeedingFollowUp(businessId)` | `business-data.ts:597` | 2 | Customers gone quiet |
| `outstandingTotal(businessId)` | `business-data.ts:580` | 2 | Sum of unpaid invoices |
| `collectedToday(businessId)` | `business-data.ts:618` | 2 | Today's takings |

**Every one is a read. There is no write.** No function in the run path creates,
updates or deletes a record. The only mutations in the whole application are:

| Mutation | Where | Target |
| --- | --- | --- |
| `recordActivity()` | `lib/mock/activity.ts` | Unshifts onto the in-memory `ACTIVITY` array |
| `approval.status = "approved" \| "rejected"` | `approval-service.ts` | Mutates the shared `APPROVALS` array in place |
| `item.included = …` | `approval-service.ts:~60` | Same |
| `item.proposedMessage = …` | `approval-service.ts:~78` | Same |
| Supabase inserts/updates | `lib/supabase/businesses.ts` | Real Postgres — businesses, hours, members, capabilities only |

So the system can read everything and change almost nothing. That is consistent
with its stage, and it is why the "Executing approved action" activity row never
progresses.

---

## The tool surface a real implementation should expose

These eight functions are the natural tool set, because the UI already displays
their output correctly and the numbers on screen already come from them. Mapping
each to a tool definition:

| Tool name | Backing function | Args | Returns | Read/write |
| --- | --- | --- | --- | --- |
| `list_overdue_invoices` | `overduePayments` | `businessId` | `Payment[]` | read |
| `get_outstanding_total` | `outstandingTotal` | `businessId` | number | read |
| `list_appointments` | `appointmentsOn` | `businessId`, `dayOffset` | `Appointment[]` | read |
| `list_low_stock` | `lowStockItems` | `businessId` | `InventoryItem[]` | read |
| `list_quiet_customers` | `customersNeedingFollowUp` | `businessId` | `Customer[]` | read |
| `get_customer` | `customerById` | `businessId`, `customerId` | `Customer` | read |
| `get_customer_payments` | `paymentsForCustomer` | `businessId`, `customerId` | `Payment[]` | read |
| `get_collected_today` | `collectedToday` | `businessId` | number | read |

Every signature takes `businessId` first. That is not decoration — it is the
tenant boundary. Any real tool implementation must scope on it and must be
executed under the caller's Supabase session so RLS applies, not under the
service role. See `15_SECURITY_ARCHITECTURE.md`.

The write-side tools that do **not** exist and would be needed:

| Would-be tool | What it must do | Why it is missing |
| --- | --- | --- |
| `create_approval` | Insert an `approvals` row plus `approval_items` | Approvals are pre-generated mock data today |
| `send_whatsapp_message` | Call the WhatsApp Cloud API | `config.integrations.whatsapp.enabled === false`, blank base URL |
| `send_sms` | Twilio | Same |
| `send_email` | Resend | Same |
| `create_payment_link` | Razorpay / Stripe | Same |
| `book_appointment` | Insert an `appointments` row | No write path exists |
| `create_invoice` | Insert a `documents` row | No write path exists |
| `log_activity` | Insert an `activities` row | `recordActivity()` writes to memory, not Postgres |

**Tables for all of these already exist** in `supabase/migrations/` —
`approvals`, `approval_items`, `appointments`, `documents`, `activities`,
`customer_interactions`, `integrations`, `business_integrations`.
`supabase/seed.sql` inserts demo rows into most of them, but **no application
code reads or writes any of them.** The only tables application code touches are
`profiles`, `businesses`, `business_hours`, `business_users` and
`business_capabilities`. See `11_DATABASE_ARCHITECTURE.md`.

---

## Tool error handling, permissions, timeouts

| Concern | State |
| --- | --- |
| Tool errors | Not applicable — the backing functions are pure and synchronous and cannot fail except by a missing tenant, which throws and surfaces as `phase: "failed"` |
| Retry | None |
| Timeout | None per call |
| Permission check before a call | **Partially present at a different layer.** `workflowService.suggestions()` filters commands by `business.enabledCapabilities`, so a tenant is not *offered* a command it has not enabled — but `planCommand()` does **not** check `enabledCapabilities`, so typing the command directly still produces the workflow. See doc 15 |
| Rate limit per tool | None |
| Audit of tool calls | None per call. One activity row is written per run, at the end |
| Tool call cap | `config.llm.orchestration.maxToolCallsPerStep = 6` — rendered on two admin pages, enforced nowhere |

---

## Related documents

- `05_AGENT_ARCHITECTURE.md` — who would call these tools
- `07_LLM_ARCHITECTURE.md` — the model that would choose them
- `11_DATABASE_ARCHITECTURE.md` — the tables the write tools need
- `17_EXTERNAL_INTEGRATIONS.md` — the third-party services behind the labels
