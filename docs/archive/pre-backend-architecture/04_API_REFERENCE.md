# 04 — API reference

## Read this before the tables

**There are no HTTP endpoints in this repository.** A search for `route.ts` and
`route.tsx` under `app/` returns nothing. There is no FastAPI service, no Express
app, no Python file anywhere. Nothing in this project listens on a port except
the Next.js dev/production server, which serves pages and one middleware.

What exists instead is a **declared contract**: 66 paths, each named as the REST
resource it will become, passed as the first argument to `serve()`. They are
strings today. When a backend exists, they become URLs and no caller changes.

```ts
// lib/services/api-client.ts:78
export async function serve<T>(
  path: string,                        // ← the contract
  resolver: () => T | Promise<T>,      // ← what runs today
  options: ServeOptions = {},
): Promise<T> {
  if (DATA_MODE === "api" && config.api.baseUrl) {
    return fetchFromApi<T>(path, options);   // never executed
  }
  await sleep(options.latencyMs ?? randomLatency());
  try {
    return await resolver();
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "Mock resolver failed", 500, path);
  }
}
```

`fetchFromApi` (`api-client.ts:53`) is fully written — it builds
`${config.api.baseUrl}${config.api.prefix}${path}`, appends query params, sets a
20-second `AbortController` timeout, and maps non-2xx to `ApiError`. It has never
run: `DATA_MODE` defaults to `"mock"` (`lib/config.ts:22`) and
`config.api.baseUrl` is `""`.

So read the tables below as **the specification for the backend that phase 03
will build**, and as an accurate index of where each screen's data comes from
today.

> Two corrections to earlier project notes: the count is **66**, not the 53 or 54
> quoted in commit `8dcc3c8` and in the root `README.md`. Both undercounts came
> from a regex that broke on nested generics such as `serve<Paginated<Customer>>(`.

---

## Verb summary

| Verb | Count | Notes |
| --- | --- | --- |
| GET | 47 | Default when no `method` option is passed |
| POST | 12 | Creates and actions |
| PATCH | 7 | Partial updates |
| PUT / DELETE | 0 | Never used |

`ServeOptions.method` (`api-client.ts:30`) is metadata only today — the mock
branch ignores it entirely. It exists so the HTTP branch has the verb when it is
switched on.

---

## Authentication and authorisation, as applied to these paths

| Concern | Reality |
| --- | --- |
| Authentication | **Not enforced per path.** Enforcement is at the route level in `middleware.ts`, not per service call |
| Authorisation | **Not enforced per path.** The service layer never checks a role |
| Tenant scoping | Passed as an argument (`businessId`), not derived from the session |
| Validation | Only in `auth-service` (email shape, password length). No schema validation anywhere — no Zod, no Yup |

This is the single largest gap between the declared contract and a safe backend.
Every path below that takes `:id` for a business trusts the caller to pass a
business it is entitled to. Today that is safe because the caller is the same
browser that owns the mock data. **It will not be safe the moment these become
HTTP endpoints** — see `15_SECURITY_ARCHITECTURE.md`, finding S-2.

---

## Complete contract

### Auth — `lib/services/auth-service.ts`

| Verb | Path | Function | Real backend today? |
| --- | --- | --- | --- |
| POST | `/auth/login` | `login` | **Yes** — `supabase.auth.signInWithPassword` |
| POST | `/auth/register` | `register` | **Yes** — `supabase.auth.signUp` |
| POST | `/auth/logout` | `logout` | **Yes** — `supabase.auth.signOut` |
| POST | `/auth/forgot-password` | `forgotPassword` | **Yes** — `resetPasswordForEmail` |
| POST | `/auth/reset-password` | `resetPassword` | **Yes** — `auth.updateUser` |
| GET | `/auth/session` | `currentSession` | **Yes** — `auth.getUser` + `loadSession` |

These six are the only paths whose resolver talks to a real service. They call
Supabase from inside the resolver, which is why real auth coexists with mock
data.

### Businesses and capabilities — `lib/services/business-service.ts`

| Verb | Path | Function | Backing |
| --- | --- | --- | --- |
| GET | `/businesses` | `list` | **Supabase** `fetchBusinesses` |
| POST | `/businesses` | `create` | **Supabase** `createBusinessForUser` — 4 inserts |
| GET | `/businesses/:id` | `get` | **Supabase** `fetchBusiness` |
| PATCH | `/businesses/:id` | `update` | **Supabase** `updateBusinessRow` |
| GET | `/businesses/:id/overview` | `overview` | Supabase for the tenant, **mock** for metrics |
| GET | `/businesses/:id/staff` | `staff` | Mock `staffFor` |
| GET | `/businesses/:id/capabilities` | `capabilities` | Mock `businessCapabilities` |
| GET | `/businesses/:id/capabilities/:id` | `capability` | Mock |
| PATCH | `/businesses/:id/capabilities/:id` | `toggleCapability` | **Supabase** `setCapabilityEnabled` |
| GET | `/capabilities` | `capabilityCatalogue` | Mock constant |
| GET | `/capabilities/recommended` | `recommendedCapabilities` | `lib/domain` constant |

`overview` is the clearest illustration of the hybrid: it awaits a real row from
Postgres, then decorates it with mock KPIs and charts.

### Customers — `lib/services/customer-service.ts`

| Verb | Path | Function | Backing |
| --- | --- | --- | --- |
| GET | `/businesses/:id/customers` | `list` | Mock + `paginate` |
| GET | `/businesses/:id/customers/stats` | `stats` | Mock aggregate |
| GET | `/businesses/:id/customers/:id` | `detail` | Mock + generated AI suggestions |
| PATCH | `/businesses/:id/customers/:id` | `update` | Mock, mutates the array in place |

### Operations — `lib/services/operations-service.ts`

| Verb | Path | Function | Backing |
| --- | --- | --- | --- |
| GET | `/businesses/:id/appointments` | `list` | Mock + `paginate` |
| GET | `/businesses/:id/appointments/day` | `day` | Mock + day stats |
| GET | `/businesses/:id/appointments/week` | `week` | Mock, 7 days |
| PATCH | `/businesses/:id/appointments/:id` | `updateStatus` | Mock mutation |
| GET | `/businesses/:id/payments` | `list` | Mock + `paginate` |
| GET | `/businesses/:id/payments/summary` | `summary` | Mock buckets |
| POST | `/businesses/:id/payments/:id/mark-paid` | `markPaid` | Mock mutation |
| GET | `/businesses/:id/inventory` | `list` | Mock + `paginate` |
| GET | `/businesses/:id/inventory/low-stock` | `lowStock` | Mock filter |
| GET | `/businesses/:id/documents` | `list` | Mock + `paginate` |
| GET | `/businesses/:id/documents/stats` | `stats` | Mock aggregate |

### Approvals — `lib/services/approval-service.ts`

| Verb | Path | Function | Backing |
| --- | --- | --- | --- |
| GET | `/businesses/:id/approvals` | `list` | Mock, optional status filter |
| GET | `/businesses/:id/approvals/counts` | `counts` | Mock aggregate |
| GET | `/approvals/:id` | `get` | Mock lookup |
| POST | `/approvals/:id/approve` | `approve` | Mock mutation + **2 activity rows** |
| POST | `/approvals/:id/reject` | `reject` | Mock mutation + 1 activity row |
| PATCH | `/approvals/:id/items/:id` | `setItemIncluded` | Mock mutation |
| PATCH | `/approvals/:id/items/:id/message` | `editItemMessage` | Mock mutation |
| GET | `/approvals` | `platformQueue` | Mock, cross-tenant |

`approve` (`approval-service.ts:85`) is the most consequential mock mutation:
it sets `status`, `decidedAt`, `decidedBy`, then calls `recordActivity` twice —
once for the human decision, once for the agent execution. That pair is what
makes the activity trail look causal.

### Workflows and the command centre — `lib/services/workflow-service.ts`

| Verb | Path | Function | Backing |
| --- | --- | --- | --- |
| GET | `/businesses/:id/commands/suggestions` | `suggestions` | Mock, filtered by enabled capabilities |
| POST | `/businesses/:id/commands/plan` | `plan` | `planCommand` — keyword classifier |
| POST | `/businesses/:id/commands` | `start` | `buildRun` — step graph, all steps pending |
| POST | `/runs/:id/complete` | `complete` | Appends one activity row |
| GET | `/businesses/:id/runs` | `history` | `recentRuns` — 7 synthetic runs |
| GET | `/businesses/:id/runs/:id` | `run` | Lookup within `recentRuns` |
| GET | `/workflows` | `definitions` | Mock constant, 8 rows |
| GET | `/workflows/:id` | `definition` | Mock lookup |
| GET | `/agents` | `agents` | Mock constant, 11 rows |
| GET | `/agents/:id` | `agent` | Mock lookup |

**`POST /businesses/:id/commands` is the path a real supervisor would own.** It
is where the LLM loop attaches. See `05_AGENT_ARCHITECTURE.md`.

### Insight — `lib/services/insight-service.ts`

| Verb | Path | Function | Backing |
| --- | --- | --- | --- |
| GET | `/businesses/:id/activity` | `list` | Mock + `paginate` |
| GET | `/businesses/:id/activity/recent` | `recent` | Mock slice |
| GET | `/businesses/:id/activity/counts` | `counts` | Mock aggregate |
| GET | `/businesses/:id/activity/capability/:id` | `forCapability` | Mock filter |
| GET | `/businesses/:id/reports` | `bundle` | Mock — summary + 6 chart series |
| GET | `/businesses/:id/reports/daily` | `dailySummary` | Mock narrative |

### Admin — `lib/services/admin-service.ts`

| Verb | Path | Function | Backing |
| --- | --- | --- | --- |
| GET | `/admin/overview` | `overview` | Mock roll-up across all tenants |
| GET | `/admin/businesses` | `businesses` | Mock + `paginate` |
| GET | `/admin/businesses/:id` | `businessDetail` | Mock |
| PATCH | `/admin/businesses/:id/status` | `updateBusinessStatus` | Mock mutation |
| GET | `/admin/capabilities` | `capabilities` | Mock constant |
| GET | `/admin/capabilities/:id` | `capability` | Mock + tenant list |
| GET | `/admin/integrations` | `integrations` | Mock constant, 11 rows |
| GET | `/admin/health` | `health` | Mock components, errors, failed runs |
| GET | `/admin/activity` | `activity` | Mock, cross-tenant |
| GET | `/admin/users` | `users` | Mock constant, 6 rows |

---

## Traced example 1 — the command centre

The template asked for a full internal trace per endpoint. Here it is for the
most important path.

**`POST /businesses/:id/commands`**

```
Frontend
  file:      app/app/command/page.tsx
  function:  submit(command) → run.submit(command)
  trigger:   SuggestedCommands button, composer Enter, or ?prompt= deep link
        ↓
Hook
  file:      lib/hooks/use-command-run.ts:36
  function:  useCommandRun().submit
  state:     phase "idle" → "planning"
        ↓
Service (1 of 2)
  file:      lib/services/workflow-service.ts:34
  function:  workflowService.plan(businessId, command)
  path:      POST /businesses/:id/commands/plan
  latency:   260 ms simulated
        ↓
Resolver
  file:      lib/mock/workflows.ts:164
  function:  planCommand(command, business)
  logic:     classify() scores 9 keyword lists; highest wins; else "fallback"
  returns:   CommandPlan {intent, scope, action, capability, requiresApproval}
             scope is rewritten with the tenant's vocabulary from lib/domain
        ↓
Service (2 of 2)
  file:      lib/services/workflow-service.ts:51
  function:  workflowService.start(businessId, command, triggeredBy)
  path:      POST /businesses/:id/commands
  latency:   420 ms simulated
        ↓
Resolver
  file:      lib/mock/workflows.ts:778
  function:  buildRun → buildSteps(intent, business, plan)   [lines 202–777]
  reads:     overduePayments() · appointmentsOn() · lowStockItems()
             customersNeedingFollowUp() · datasetFor() · approvalsFor()
  returns:   WorkflowRun with 3–6 WorkflowSteps, every status "pending"
  note:      counts in step titles are REAL counts from the mock dataset
        ↓
Animation (no network)
  file:      lib/hooks/use-command-run.ts
  logic:     for each step → status "running" → await sleep(durationMs × 0.42,
             floor 420 ms) → status "completed"; an approval_gate step becomes
             "awaiting_approval" and the loop ends
        ↓
Service (3)
  file:      lib/services/workflow-service.ts:64
  function:  workflowService.complete(run)
  path:      POST /runs/:id/complete
  effect:    recordActivity() unshifts one row onto the in-memory activity array
        ↓
Render
  file:      components/command/workflow-panel.tsx
             components/command/workflow-step-card.tsx
  effect:    steps render with facts grid and record previews; the gate renders
             "Review actions" and "Approve"

Database:  none
LLM:       none
Tools:     none
External:  none
```

**What a real backend changes:** only the two resolvers. The frontend, the hook's
public shape, and both components stay as they are.

---

## Traced example 2 — approving a batch

**`POST /approvals/:id/approve`**

```
Frontend
  file:      app/app/approvals/page.tsx  (also app/app/command/page.tsx)
  function:  approve(row) → approvalService.approve(row.id, actorName)
        ↓
Service
  file:      lib/services/approval-service.ts:85
  latency:   700 ms simulated
        ↓
Resolver — four effects, in order
  1. find(approvalId)                        approval-service.ts:14 — throws if absent
  2. approval.status = "approved"             mutates the object in APPROVALS
     approval.decidedAt = now
     approval.decidedBy = decidedBy
  3. recordActivity({actorType: "human", status: "approved", …})
     recordActivity({actorType: "agent",  status: "in_progress", …})
                                             lib/mock/activity.ts
  4. returns {approval, outcome: "17 records queued — …"}
        ↓
Frontend
  toast.success(outcome)
  run.resolveApproval("approved")   → the gate step turns green
  list.refetch() + counts.refetch() → the queue and the badge update

Database:  none — the approvals table exists but is never written
Validation: none. Any id the caller knows can be approved
Authorisation: none in the service layer
```

Note the asymmetry worth remembering: `approve` writes **two** activity rows,
`reject` writes **one**. That is deliberate — an approval causes an execution, a
rejection causes nothing.

---

## What the backend must add that this contract does not describe

| Missing | Why it matters |
| --- | --- |
| Request validation schemas | No path validates its body. `paginate` trusts `page`, `pageSize`, `sortBy` |
| Authorisation checks | No path verifies the caller may touch `:businessId` |
| Idempotency | `POST /approvals/:id/approve` has no key. A double-click would double-send |
| Pagination limits | `pageSize` is unbounded; a caller could request everything |
| Rate limiting | None anywhere |
| Error codes | `ApiError` carries `status` but every consumer reads only `.message` |

---

## Frontend callers

Which page consumes which service:

| Page | Services |
| --- | --- |
| `app/app/overview` | `businessService.overview`, `activityService.recent` |
| `app/app/command` | `workflowService` ×4, `businessService.capabilities`, `approvalService` ×4 |
| `app/app/approvals` | `approvalService` ×6 |
| `app/app/customers` | `customerService` ×3 |
| `app/app/appointments` | `appointmentService` ×3 |
| `app/app/payments` | `paymentService` ×3 |
| `app/app/inventory` | `inventoryService` ×2 |
| `app/app/documents` | `documentService` ×2 |
| `app/app/activity` | `activityService` ×2 |
| `app/app/reports` | `reportService.bundle` |
| `app/app/automations` | `workflowService` ×2 |
| `app/app/workforce`, `/[key]` | `businessService` ×3, `activityService.forCapability` |
| `app/app/settings` | `businessService` ×4, `adminService.users`, `adminService.integrations` |
| `app/onboarding` | `businessService.capabilityCatalogue`, `businessService.create` |
| all `app/admin/*` | `adminService` ×10, `approvalService.platformQueue`, `workflowService` ×4 |
| `components/providers/session-provider` | `authService` ×4, `businessService.list` |

`app/app/settings` calling `adminService.users()` is a layering smell — a business
screen reaching into the admin service. Noted in `26_CODE_QUALITY_AUDIT.md`.
