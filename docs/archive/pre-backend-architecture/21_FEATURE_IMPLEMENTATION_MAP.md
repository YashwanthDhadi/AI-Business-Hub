# 21 — Feature implementation map

For each user-visible feature: the exact files, the entry point, and how real it
is. Use this to find the code for anything you can see on screen.

Reality column: **REAL** (durable state) · **SIMULATED** (screen only) ·
**STATIC** (fixed content)

---

## 1. Sign up / sign in / sign out — REAL

| Layer | File |
| --- | --- |
| UI | `app/(auth)/login/page.tsx`, `register/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`, `(auth)/layout.tsx` |
| Service | `lib/services/auth-service.ts` — 6 paths |
| Client | `lib/supabase/client.ts` → `createBrowserClient` |
| Session load | `lib/supabase/session.ts` — `loadSession()`, `roleFromUser()`, `touchLastActive()` |
| State | `components/providers/session-provider.tsx` |
| Guard | `middleware.ts` → `lib/supabase/middleware.ts` |
| Tables | `auth.users`, `profiles` (via the `on_auth_user_created` trigger) |
| Tests | `tests/unit/auth-guard.test.ts` — 10 |

Entry point: the form's `onSubmit` → `signIn()` from `useSession()`.

The one thing to know: `?next=` is validated with `startsWith("/")` at
`login/page.tsx:50`.

## 2. Route guarding — REAL

| Layer | File |
| --- | --- |
| Guard | `middleware.ts` (68 lines) |
| Helpers | `lib/supabase/middleware.ts` — `updateSession()`, `redirectWithSession()` |
| Predicates | `lib/supabase/config.ts` — `GUARDED_PREFIXES`, `isGuardedPath()`, `isSupabaseConfigured()` |
| Build guard | `next.config.mjs` |

Nothing imports `middleware.ts`; Next invokes it. It is the security boundary.

## 3. Onboarding — REAL

| Layer | File |
| --- | --- |
| Wizard | `app/onboarding/page.tsx` (267 lines) |
| Steps | `components/onboarding/{step-indicator,business-profile-step,capability-step,activation-step,success-step}.tsx` |
| Service | `lib/services/business-service.ts` → `create()` |
| Write | `lib/supabase/businesses.ts:153` → `createBusinessForUser()` |
| Tables | `businesses`, `business_users`, `business_hours`, `business_capabilities` |

Entry point: `activate()` at `page.tsx:~110`. Four inserts, no transaction.

## 4. Tenant switching — REAL (list) / SIMULATED (data)

| Layer | File |
| --- | --- |
| UI | `components/layout/business-switcher.tsx` |
| State | `session-provider.tsx` → `setActiveBusiness()` |
| Cookie | `ACTIVE_BUSINESS_COOKIE = "aibh-active-business"` |
| Read | `lib/supabase/businesses.ts:104` → `fetchBusinesses()` |
| Bridge | `lib/mock/demo-bridge.ts` → `datasetKeyFor()`, used at `business-data.ts:569` |

The list of workspaces is real; the records inside are mock, joined by the bridge.

## 5. AI Command Center — SIMULATED

| Layer | File |
| --- | --- |
| Page | `app/app/command/page.tsx` (349) |
| Input | `components/command/command-composer.tsx` |
| Suggestions | `components/command/suggested-commands.tsx` |
| Run panel | `components/command/workflow-panel.tsx` (290) |
| Step card | `components/command/workflow-step-card.tsx` (193) |
| Hook | `lib/hooks/use-command-run.ts` (167) |
| Service | `lib/services/workflow-service.ts:34` `plan()`, `:51` `start()`, `:64` `complete()` |
| **Logic** | `lib/mock/workflows.ts` — `classify():80`, `PLAN_BY_INTENT`, `planCommand():164`, `buildSteps():202`, `buildRun():778` |
| Tests | `tests/unit/intent.test.ts` — 24 |

Entry point: `run.submit(command)`. Full trace in doc 06.

## 6. Approvals — SIMULATED

| Layer | File |
| --- | --- |
| Page | `app/app/approvals/page.tsx` (257) |
| Card | `components/approvals/approval-card.tsx` (158) |
| Drawer | `components/approvals/approval-drawer.tsx` (435) |
| Service | `lib/services/approval-service.ts` — 8 paths |
| Data | `lib/mock/approvals.ts` (426) — batches + 5 message templates |
| Admin queue | `app/admin/approvals/page.tsx` |
| Tables | `approvals`, `approval_items` — **exist, unused** |

Entry point: `approvalService.approve(id, actorName)`. Mutates `APPROVALS` in
place; writes 2 activity rows; nothing then executes.

## 7. Customers — SIMULATED

`app/app/customers/page.tsx` (330) · `components/customers/customer-drawer.tsx`
(331) · `lib/services/customer-service.ts` (4 paths) ·
`lib/mock/business-data.ts` → `customerById`, `paymentsForCustomer`,
`appointmentsForCustomer`, `interactionsFor:363`, `customersNeedingFollowUp:597`

Search is `String.includes` inside `paginate()`. The Postgres GIN index for the
real version already exists and is unused.

## 8. Appointments — SIMULATED

`app/app/appointments/page.tsx` (361) ·
`components/appointments/schedule-views.tsx` (316) ·
`lib/services/operations-service.ts` · `business-data.ts:393` `buildAppointments`,
`:586` `appointmentsOn`

`buildAppointments` reads the tenant's opening hours, skips closed days and stops
before close — the fix for 23 past-midnight bookings that violated
`appointments_time_order`. Two invariants in `dataset.test.ts` guard it.

## 9. Payments — SIMULATED

`app/app/payments/page.tsx` (346) · `operations-service.ts` ·
`business-data.ts:201` `buildPayments`, `:574` `overduePayments`, `:580`
`outstandingTotal`, `:618` `collectedToday`

`overduePayments()` is the most-used data function in the codebase — it feeds the
Command Center, the approvals, the overview KPIs and the attention list, which is
why "17 overdue" is the same 17 everywhere.

## 10. Inventory — SIMULATED

`app/app/inventory/page.tsx` (281) · `business-data.ts:464` `buildInventory`,
`:593` `lowStockItems`

Stock status is derived from `in_stock` vs `reorder_level` in TypeScript, and
independently by the `sync_stock_status()` trigger in Postgres.

## 11. Documents — SIMULATED

`app/app/documents/page.tsx` (260) · `business-data.ts:498` `buildDocuments`

Generated from the tenant's payments, so an invoice document matches an invoice
row. Supabase Storage has a bucket and 4 policies; nothing uploads.

## 12. Reports and charts — SIMULATED

`app/app/reports/page.tsx` (254) · `app/app/overview/page.tsx` (189) ·
`components/charts/chart-kit.tsx` (403) · `components/dashboard/kpi-card.tsx` ·
`lib/services/insight-service.ts` (6 paths) · `lib/mock/metrics.ts` (438)

All chart configuration is in one file. `SERIES_COLORS` resolves through
`--chart-1`…`--chart-5`.

## 13. Activity / audit trail — SIMULATED

`app/app/activity/page.tsx` (229) ·
`components/activity/activity-timeline.tsx` (194) ·
`components/dashboard/ai-activity-panel.tsx` · `lib/mock/activity.ts` (417) ·
`app/admin/activity/page.tsx`

`recordActivity()` unshifts onto an in-memory array. The `activities` table is
append-only and unused.

## 14. Notifications — SIMULATED, and the one bypass

`components/layout/notifications.tsx:12` imports `attentionItems` from
`lib/mock/metrics` and calls it inside a hand-rolled `useAsync` with
`await sleep(180)` — **no `serve()` path**. It appears in none of the 66 declared
endpoints and will not follow the app to a real backend.

## 15. Capabilities / AI Workforce — REAL toggle

| Layer | File |
| --- | --- |
| Pages | `app/app/workforce/page.tsx` (176), `workforce/[key]/page.tsx` (329) |
| Card | `components/workforce/capability-card.tsx` (175) |
| Rail | `components/layout/workforce-rail.tsx` |
| Catalogue | `lib/mock/capabilities.ts` (415) — 9 capabilities, `capabilityMeta()` |
| Write | `lib/supabase/businesses.ts:228` → `setCapabilityEnabled()` |
| Table | `business_capabilities` |
| Admin | `app/admin/capabilities/page.tsx` (316) |

The toggle is real. The effect is real too: navigation (`lib/navigation.ts`) and
suggested commands both derive from `enabledCapabilities`.

## 16. Automations — SIMULATED

`app/app/automations/page.tsx` (329) · `lib/mock/agents.ts:222`
`WORKFLOW_DEFINITIONS` (8) · `app/admin/workflows/page.tsx` (319)

Switch → `setDisabled(Set)` + toast. **No scheduler exists.** Doc 16.

## 17. Agent roster — SIMULATED

`app/admin/agents/page.tsx` (334) · `lib/mock/agents.ts` — `AGENTS` (11) ·
`workflow-service.ts:119,123`

The only page that reads `config.llm`. Docs 05 and 07.

## 18. Settings — REAL

`app/app/settings/page.tsx` (772 — the largest file) ·
`business-service.ts` → `update()` · `lib/supabase/businesses.ts:251`
`updateBusinessRow()` · `app/admin/settings/page.tsx` (558, read-only)

## 19. Command palette — STATIC content, real interaction

`components/layout/command-palette.tsx` (179) · `components/ui/command.tsx` ·
`cmdk`. `Cmd/Ctrl+K`. Mounted by both workspace layouts with a `scope` prop.
Navigates and pre-fills commands via `?prompt=`.

## 20. Theme switching — REAL

`components/providers/theme-provider.tsx` · `components/layout/theme-toggle.tsx`
· `next-themes` · tokens in `app/globals.css`

No component reads the current theme to pick a colour; everything goes through
tokens.

## 21. Landing page — STATIC

`app/page.tsx` (111) · `components/landing/{sections,product-preview,landing-nav,landing-footer}.tsx`

`product-preview.tsx` (202) is a hand-built static replica of a Command Center
run — it does not use `use-command-run`.

## 22. Admin fleet views — SIMULATED

`app/admin/overview` (364) · `businesses` (284) · `businesses/[id]` (396) ·
`health` (285) · `integrations` (217) · `lib/services/admin-service.ts` (10
paths) · `lib/mock/platform.ts` (439)

`INTEGRATIONS` shows `status: "connected"` for Anthropic. It is a string in a
mock object; no Anthropic call has ever been made.

## 23. Tables, search, sort, pagination — REAL mechanism

`components/tables/data-table.tsx` (283) · `lib/hooks/use-table-state.ts` (92) ·
`lib/services/api-client.ts` → `paginate()` · `components/ui/pagination.tsx`

`useTableState`'s shape matches `ListParams`, so it passes straight through to
`serve()`. Tested by `paginate.test.ts` — 11 tests.

## 24. Multi-industry vocabulary — REAL, and the twelfth product rule

`lib/domain.ts` (434) — `BUSINESS_TYPES` with per-type `vocabulary`:

| Type | customer / booking |
| --- | --- |
| salon | Customer / Appointment |
| gym | Member / Class |
| coaching | Student / Session |
| garage | Customer / Service job |
| retail | Customer / Order |

Consumed by `planCommand()`, every page header, and `useWorkspace().vocabulary`.
Tested by `domain.test.ts` — 25 tests. **This is the mechanism that keeps the
product from being salon-specific. Any new copy must go through it.**

---

## Feature → reality summary

| Feature | Reality |
| --- | --- |
| Auth, route guard, onboarding, capability toggle, settings, tenant list, theme | **REAL** |
| Command Center, approvals, customers, appointments, payments, inventory, documents, reports, activity, notifications, automations, agents, admin views | **SIMULATED** |
| Landing page, admin platform settings | **STATIC** |

Nine features write durable state. Thirteen are convincing demonstrations. That
ratio is the accurate one-line summary of this project.

---

## Related documents

- `03_USER_WORKFLOWS.md` — the same features as user journeys
- `19_CODEBASE_FILE_GUIDE.md` — every file
- `29_CODE_READING_ORDER.md` — where to start
- `31_MODIFICATION_GUIDE.md` — how to extend each of these
