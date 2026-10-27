# 03 — User workflows

Every route in the application, who can reach it, and what actually happens when
they do. "Real" means it changes durable state; "simulated" means it changes only
what is on screen.

---

## Route inventory

33 pages. Nine of them are real, in the sense that they write to Postgres.

### Public (2)

| Route | File | Real? |
| --- | --- | --- |
| `/` | `app/page.tsx` | Marketing page. Static |
| `/onboarding` | `app/onboarding/page.tsx` | **Real** — writes 4 tables. Guarded |

### Auth (4) — route group `(auth)`, shared layout

| Route | File | Real? |
| --- | --- | --- |
| `/login` | `app/(auth)/login/page.tsx` | **Real** — `signInWithPassword` |
| `/register` | `app/(auth)/register/page.tsx` | **Real** — `signUp` |
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx` | **Real** — `resetPasswordForEmail` |
| `/reset-password` | `app/(auth)/reset-password/page.tsx` | **Real** — `updateUser` |

### Business workspace (15) — `/app/*`, guarded

| Route | Purpose | Real? |
| --- | --- | --- |
| `/app` | Redirects to `/app/overview` | — |
| `/app/overview` | KPIs, charts, attention list | Mock data |
| `/app/command` | The AI Command Center | Simulated run |
| `/app/approvals` | Approval queue and drawer | Mock data, in-memory decisions |
| `/app/customers` | Customer table, detail sheet | Mock data |
| `/app/appointments` | Day/week schedule | Mock data |
| `/app/payments` | Invoices, overdue view | Mock data |
| `/app/inventory` | Stock levels | Mock data |
| `/app/documents` | Invoices, quotes, receipts | Mock data |
| `/app/reports` | Charts and trends | Mock data |
| `/app/activity` | The audit trail | Mock data, appended in memory |
| `/app/automations` | Eight always-on automations, with switches | **Switches do nothing durable** |
| `/app/workforce` | Capability catalogue with toggles | **Real** — writes `business_capabilities` |
| `/app/workforce/[key]` | One capability in detail | Mock data + real toggle |
| `/app/settings` | Business profile, hours, capabilities | **Real** — writes `businesses`, `business_capabilities` |

### Admin workspace (12) — `/admin/*`, guarded, role-checked

| Route | Purpose | Real? |
| --- | --- | --- |
| `/admin` | Redirects to `/admin/overview` | — |
| `/admin/overview` | Fleet KPIs | Mock data |
| `/admin/businesses` | All tenants | Mock data |
| `/admin/businesses/[id]` | One tenant | Mock data |
| `/admin/capabilities` | Catalogue across tenants | Mock data |
| `/admin/agents` | The 11-agent roster, LLM config | Mock data + `config.llm` |
| `/admin/workflows` | Workflow definitions | Mock data |
| `/admin/approvals` | Cross-tenant approval queue | Mock data |
| `/admin/activity` | Cross-tenant audit feed | Mock data |
| `/admin/health` | Platform health | Mock data |
| `/admin/integrations` | Integration catalogue | Mock data |
| `/admin/settings` | Platform config, read-only | `config.*` |

---

## Workflow 1 — Register, onboard, first command

The full first-run path, and the only one that is real end to end.

### Step 1 · Register

```
/register  →  authService.register({ name, email, password })
  → supabase.auth.signUp({ email, password,
                           options: { data: { full_name: name } } })
  → Postgres trigger on_auth_user_created fires
      → insert into public.profiles (id, email, full_name)
        full_name from raw_user_meta_data->>'full_name'
  → redirect to /onboarding?name=<business name>
```

The profile row is created **by the database**, not by application code. That
means it cannot be forgotten by a client bug.

### Step 2 · Onboarding, four steps in one page

`app/onboarding/page.tsx` holds `const [step, setStep] = React.useState(1)`. It is
one route, not four — no URL changes, so a refresh restarts the wizard.

**Step 1 — business profile.** `BusinessProfileStep`. Fields: name, type,
description, location, currency, opening hours (`DEFAULT_HOURS`). Validation at
`page.tsx:~90`:

```ts
if (profile.name.trim().length < 2) next.name = "Tell us what your business is called";
if (!profile.type)                  next.type = "Choose the closest match";
if (profile.location.trim().length < 2) next.location = "Where do you operate?";
```

Three required fields. `?name=` from the register redirect pre-fills the first.

**Step 2 — capabilities.** `CapabilityStep`. When a business type is chosen, the
recommended set is preselected **once**:

```ts
React.useEffect(() => {
  if (!profile.type || touchedCapabilities) return;
  setSelected(businessTypeMeta(profile.type).recommendedCapabilities);
}, [profile.type, touchedCapabilities]);
```

The `touchedCapabilities` flag is the detail worth noticing: once the user has
toggled anything, changing the business type will no longer overwrite their
choices. Advancing requires at least one capability, enforced with a toast rather
than a blocked button.

**Step 3 — activation.** Two things race, and the code waits for both:

```ts
const activate = async () => {
  const business = await businessService.create(profile, selected, user ? {...} : undefined);
  setCreated(business);
};

React.useEffect(() => {
  if (!animationDone || !created || step !== 3) return;
  attachBusiness(created);
  setStep(4);
}, [animationDone, created, step, attachBusiness]);
```

The comment in the source says it plainly: *"Advance only when both the activation
animation and the create call are done, whichever finishes last."* A slow database
never truncates the animation; a slow animation never hides a failed insert.

Underneath, `createBusinessForUser()` (`lib/supabase/businesses.ts:153`) performs
**four inserts** — `businesses`, `business_users` (role `owner`), `business_hours`
(7 rows), `business_capabilities`. Not a transaction. See doc 11.

**Step 4 — success.** `SuccessStep`. Offers a first command, linking to
`/app/command?prompt=<text>`.

### Step 3 · First command

Covered step by step in `06_AGENT_EXECUTION_TRACES.md`. In outline: type a
request, watch six steps animate over ~4 seconds against real record counts, hit
the approval gate, approve, get a toast and two audit rows.

---

## Workflow 2 — Sign in and land in the right workspace

```
/login → authService.signIn(email, password)
  → supabase.auth.signInWithPassword()
  → cookies set by @supabase/ssr
  → router.push(next ?? role-based default)

Next request to any /app or /admin path:
  middleware.ts:20
    isGuardedPath(pathname)?                 (/app, /admin, /onboarding)
    updateSession() → supabase.auth.getUser()
    no user      → 307 /login?next=<path>
    role mismatch → 307 to the caller's own workspace
    otherwise    → pass through
```

Two details that matter:

- The middleware calls **`getUser()`**, not `getSession()`. `getSession()` only
  decodes the cookie — a forged one would pass. `getUser()` validates against
  Supabase. Using the wrong one here would defeat the entire guard.
- The role comes from **`app_metadata.role`** (`lib/supabase/session.ts:18`
  `roleFromUser`), never `user_metadata`. `user_metadata` is writable by the user
  themselves; `app_metadata` is server-only. Reading the wrong one would let any
  user promote themselves to platform admin.

---

## Workflow 3 — Approve an action

The product's central promise: nothing customer-facing happens without a human.

```
/app/approvals  or  the Command Center's gate
  → approvalService.list(businessId, status)
  → click a row → ApprovalDrawer opens
      shows every ApprovalItemRecord: customer, amount, due date,
      and the proposedMessage draft
  → per item: toggle included (PATCH), or edit the message (PATCH)
  → Approve  → approvalService.approve(id, actorName)   [700 ms]
       approval.status = "approved"
       2 activity rows: one human ("Approved: …"), one agent ("Executing…")
  → Reject   → approvalService.reject(id, actorName, reason)  [500 ms]
       approval.status = "rejected"
       1 activity row, outcome "Nothing was sent."
```

Which actions require approval is a per-intent constant in `PLAN_BY_INTENT`
(`lib/mock/workflows.ts`), not a computed policy:

| Requires approval | Does not |
| --- | --- |
| `payment_followup` (sends messages) | `schedule_view` (reads) |
| `booking_confirm` (sends messages) | `report` (reads) |
| `customer_followup` (sends messages) | `inventory` (reads, in some branches) |
| `documents` (creates invoices) | `fallback` |

The dividing line is *does this reach a customer or create a financial record*.
It holds, but it holds because someone typed it correctly nine times — there is
no rule enforcing it. See doc 15.

**Where it stops being real.** The approval decision mutates an in-memory object.
The "Executing approved action" activity row is written and nothing executes.
Refresh the page and the approval is pending again.

---

## Workflow 4 — Switch tenant

```
Sidebar switcher → session-provider setActiveBusiness(id)
  → writes cookie aibh-active-business
  → useWorkspace() returns the new business
  → every useAsync hook keyed on businessId refetches
```

The list of switchable businesses is real: `fetchBusinesses()`
(`lib/supabase/businesses.ts:104`) reads `business_users` joined to `businesses`,
so a user sees only workspaces they are a member of, and RLS enforces that
independently.

The **data** inside the workspace is mock, keyed by the business id. For a real
workspace created through onboarding, `lib/mock/demo-bridge.ts` maps its UUID
onto one of the three demo datasets so the screens have something to show. If
that mapping is absent, `BUSINESS_INDEX.get()` misses and pages fail with
"Business not found" — the single most likely runtime error. See doc 30.

---

## Workflow 5 — Toggle a capability

One of the few real writes outside onboarding.

```
/app/workforce  or  /app/settings
  → switch → businessService.setCapability(businessId, key, enabled)
  → setCapabilityEnabled() (lib/supabase/businesses.ts:228)
       update public.business_capabilities
         set enabled = $3
       where business_id = $1 and capability_key = $2
  → RLS policy "members access their capability config" must pass
  → sidebar navigation re-derives; suggested commands change
```

The effect is visible immediately: navigation items and the Command Center's
suggested commands are both derived from `enabledCapabilities`.

The gap: `workflowService.suggestions()` filters by enabled capability, but
`planCommand()` does not check it. Typing a command for a disabled capability
still produces a workflow. Recorded in doc 32.

---

## Workflow 6 — Automations page (fully simulated)

`/app/automations` lists eight always-on automations with switches and schedules.

```
toggle → setDisabled(Set<string>)  (page.tsx:50)
       → toast.success(`${name} resumed` | `${name} paused`)   (page.tsx:70)
```

Nothing else. No scheduler, no cron, no persisted preference. The switch resets
on refresh. This is the page most likely to be mistaken for working
functionality, so it is worth being explicit: **there is no scheduler anywhere in
this repository.** See doc 16.

---

## Error and empty states

| State | Implementation |
| --- | --- |
| Route error | `app/error.tsx` (segment boundary), `app/global-error.tsx` (root) |
| 404 | `app/not-found.tsx` |
| Loading | Per-page `Skeleton` components while `useAsync` is pending |
| Empty list | Every table and list has an explicit empty state |
| Failed fetch | `useAsync` exposes `error`; pages render a retry affordance |
| Failed run | `phase: "failed"` → `workflow-panel` failure card with Retry |

An ordering bug once made two error states unreachable — `app/app/workforce/[key]`
and `app/admin/businesses/[id]` checked `loading || !data` before checking
`error`, so an error rendered as a permanent skeleton. Both are fixed; the
pattern is worth watching for in any new page.

---

## Related documents

- `06_AGENT_EXECUTION_TRACES.md` — the command run, step by step
- `12_DATA_FLOW.md` — where each screen's data comes from
- `13_FRONTEND_ARCHITECTURE.md` — layouts, providers, hooks
- `22_ERROR_HANDLING.md` — the full error surface
