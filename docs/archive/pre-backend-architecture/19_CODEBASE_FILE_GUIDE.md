# 19 — Codebase file guide

Every tracked file, what it does, and whether it is used. 181 tracked files
(`git ls-files | wc -l`), of which 152 are `.ts`/`.tsx`.
Line counts are exact (`grep -c ''`).

Status vocabulary, as required:
**USED** · **UNUSED** (exists, no importer) · **PARTIAL** (some exports unused) ·
**CONFIG-ONLY** (declared, read for display only) · **GENERATED**

---

## Root

| File | Lines | Purpose | Status |
| --- | --- | --- | --- |
| `middleware.ts` | 68 | **The only server-side code.** Route guard, role split | USED |
| `next.config.mjs` | 52 | Build config + the build-time auth guard that throws | USED |
| `package.json` | 73 | 31 deps, 13 devDeps, 17 scripts | USED |
| `package-lock.json` | 10250 | Lockfile | GENERATED |
| `tsconfig.json` | 24 | `strict: true`, path alias `@/*` | USED |
| `tailwind.config.ts` | 164 | Maps Tailwind names onto CSS variables | USED |
| `postcss.config.mjs` | 9 | Tailwind + autoprefixer | USED |
| `eslint.config.mjs` | 50 | Flat config, `eslint-config-next` | USED |
| `vitest.config.ts` | 17 | Test runner | USED |
| `.env.example` | 70 | Every variable, all values blank | USED (as docs) |
| `.gitignore` | 20 | Excludes `.next`, `node_modules`, `.env*.local` | USED |
| `.gitattributes` | 15 | Line-ending normalisation — matters on Windows | USED |
| `README.md` | 316 | Project readme. **Quotes the old 53-endpoint undercount** | PARTIAL |

---

## `app/` — 33 pages, 5 special files, 4 metadata routes

### Root-level

| File | Lines | Purpose |
| --- | --- | --- |
| `layout.tsx` | 58 | Root layout: fonts, `metadata`, `AppProviders`, `suppressHydrationWarning` |
| `page.tsx` | 111 | Landing page. Server component |
| `globals.css` | 268 | **All design tokens.** Light at `:root`, dark under `.dark` |
| `error.tsx` | 62 | Segment error boundary |
| `global-error.tsx` | 122 | Root error boundary — renders its own `<html>` |
| `not-found.tsx` | 65 | 404 |
| `robots.ts` | 20 | Disallows `/app/`, `/admin/`, `/onboarding`, both password routes |
| `sitemap.ts` | 14 | Public routes only |
| `opengraph-image.tsx` | 98 | Generated OG image |
| `icon.svg` | 10 | Favicon |

### `(auth)/` — route group, 4 pages

| File | Lines | Notes |
| --- | --- | --- |
| `layout.tsx` | 99 | Centred card, brand mark |
| `login/page.tsx` | 193 | **Validates `?next=` with `startsWith("/")`** — the open-redirect guard |
| `register/page.tsx` | 190 | `signUp` with `full_name` in metadata; redirects to onboarding |
| `forgot-password/page.tsx` | 116 | `resetPasswordForEmail` |
| `reset-password/page.tsx` | 194 | `updateUser` |

### `onboarding/`

| File | Lines | Notes |
| --- | --- | --- |
| `page.tsx` | 267 | The 4-step wizard. One route, `useState` step. **Writes 4 tables.** Wrapped in `Suspense` for `useSearchParams` |

### `app/` — business workspace, 15 routes

| File | Lines | Notes |
| --- | --- | --- |
| `layout.tsx` | 138 | `AppShell` + `CommandPaletteProvider scope="business"`; navigation derived from `enabledCapabilities` |
| `page.tsx` | 5 | `redirect("/app/overview")` |
| `overview/page.tsx` | 189 | KPIs, charts, attention list |
| `command/page.tsx` | 349 | **The AI Command Center.** `Suspense` + `useCommandRun` |
| `approvals/page.tsx` | 257 | Queue + drawer |
| `customers/page.tsx` | 330 | Table + detail drawer |
| `appointments/page.tsx` | 361 | Day/week schedule |
| `payments/page.tsx` | 346 | Invoices, overdue |
| `inventory/page.tsx` | 281 | Stock |
| `documents/page.tsx` | 260 | Invoices, quotes, receipts |
| `reports/page.tsx` | 254 | Charts |
| `activity/page.tsx` | 229 | Audit trail |
| `automations/page.tsx` | 329 | **8 automations, switches that only toast** |
| `workforce/page.tsx` | 176 | Capability catalogue. **Real toggle write** |
| `workforce/[key]/page.tsx` | 329 | One capability. Error-state ordering was fixed here |
| `settings/page.tsx` | 772 | **Largest file in the app.** Profile, hours, capabilities. Real writes |

### `admin/` — platform workspace, 12 routes

| File | Lines | Notes |
| --- | --- | --- |
| `layout.tsx` | 93 | `AppShell` admin mode + palette `scope="admin"` |
| `page.tsx` | 5 | `redirect("/admin/overview")` |
| `overview/page.tsx` | 364 | Fleet KPIs |
| `businesses/page.tsx` | 284 | All tenants |
| `businesses/[id]/page.tsx` | 396 | One tenant. Error-state ordering fixed here |
| `capabilities/page.tsx` | 316 | Catalogue across tenants |
| `agents/page.tsx` | 334 | **The only page that reads `config.llm`** |
| `workflows/page.tsx` | 319 | The 8 `WORKFLOW_DEFINITIONS` |
| `approvals/page.tsx` | 160 | Cross-tenant queue |
| `activity/page.tsx` | 192 | Cross-tenant feed |
| `health/page.tsx` | 285 | 6 literal health components |
| `integrations/page.tsx` | 217 | The 11 integration cards |
| `settings/page.tsx` | 558 | Platform config, read-only |

---

## `components/` — 62 files

### `ui/` — 21 design-system primitives

| File | Lines | File | Lines |
| --- | --- | --- | --- |
| `primitives.tsx` | 184 | `input.tsx` | 126 |
| `dropdown-menu.tsx` | 169 | `dialog.tsx` | 122 |
| `status.tsx` | 143 | `select.tsx` | 122 |
| `sheet.tsx` | 137 | `table.tsx` | 122 |
| `command.tsx` | 135 | `pagination.tsx` | 102 |
| `icon.tsx` | 100 | `toggle-controls.tsx` | 91 |
| `states.tsx` | 93 | `card.tsx` | 79 |
| `button.tsx` | 73 | `tabs.tsx` | 68 |
| `skeleton.tsx` | 53 | `tooltip.tsx` | 50 |
| `badge.tsx` | 37 | `toaster.tsx` | 35 |
| `popover.tsx` | 32 | | |

All USED. `states.tsx` holds the shared empty/error/loading components — the
reason those states are consistent across 33 pages.

### `layout/` — 11 files

| File | Lines | Notes |
| --- | --- | --- |
| `app-shell.tsx` | 144 | The frame: sidebar + topbar + rail + `PageContainer` |
| `command-palette.tsx` | 179 | `cmdk`, `Cmd/Ctrl+K`. Provider + `useCommandPalette()` |
| `sidebar.tsx` | 167 | Capability-derived nav; collapsed state in `localStorage` |
| `business-switcher.tsx` | 120 | **Reads real Supabase tenants** |
| `user-menu.tsx` | 120 | Sign out, theme |
| `page-header.tsx` | 106 | Title, description, actions |
| `notifications.tsx` | 103 | **The one service-layer bypass** — `attentionItems()` direct from `lib/mock` |
| `mobile-nav.tsx` | 97 | Sheet-based nav |
| `workforce-rail.tsx` | 89 | Capability rail |
| `topbar.tsx` | 82 | Search trigger, notifications, user menu |
| `theme-toggle.tsx` | 50 | `next-themes` |

### `command/` — 5 files, the Command Center

| File | Lines | Notes |
| --- | --- | --- |
| `workflow-panel.tsx` | 290 | Renders the run: steps, gate, result, failure |
| `workflow-step-card.tsx` | 193 | One step. **Has icons for `tool` and `execution` kinds that are never produced** |
| `command-composer.tsx` | 120 | The input |
| `suggested-commands.tsx` | 99 | Capability-filtered suggestions |
| `quick-command-bar.tsx` | 93 | Compact composer for the overview page |

### Feature components

| File | Lines | Notes |
| --- | --- | --- |
| `approvals/approval-drawer.tsx` | 435 | Per-item include/exclude and message editing |
| `charts/chart-kit.tsx` | 403 | **All chart config.** `SERIES_COLORS`, axes, tooltips |
| `customers/customer-drawer.tsx` | 331 | Customer detail |
| `appointments/schedule-views.tsx` | 316 | Day and week views |
| `tables/data-table.tsx` | 283 | The shared table |
| `providers/session-provider.tsx` | 275 | **The centre of the app.** Session + active tenant |
| `onboarding/capability-step.tsx` | 270 | Step 2 |
| `onboarding/business-profile-step.tsx` | 231 | Step 1 |
| `landing/sections.tsx` | 427 | Marketing sections |
| `landing/product-preview.tsx` | 202 | A static mock of the Command Center |
| `activity/activity-timeline.tsx` | 194 | Audit timeline |
| `workforce/capability-card.tsx` | 175 | Capability card + toggle |
| `approvals/approval-card.tsx` | 158 | Queue row |
| `onboarding/activation-step.tsx` | 156 | Step 3, the animation half of the race |
| `dashboard/ai-activity-panel.tsx` | 130 | Recent AI actions |
| `dashboard/attention-list.tsx` | 130 | Needs-attention list |
| `landing/landing-nav.tsx` · `landing-footer.tsx` | 97 · 77 | Marketing chrome |
| `onboarding/success-step.tsx` | 97 | Step 4 |
| `onboarding/step-indicator.tsx` | 90 | `ONBOARDING_STEPS` + progress |
| `dashboard/kpi-card.tsx` | 87 | KPI tile |
| `admin/health-strip.tsx` | 72 | Sparkline strip |
| `brand/logo.tsx` | 71 | Wordmark |
| `providers/app-providers.tsx` | 20 | The 4-provider stack |
| `providers/theme-provider.tsx` | 17 | `next-themes` wrapper |

---

## `lib/` — the whole domain and data layer

### Core

| File | Lines | Purpose | Importers |
| --- | --- | --- | --- |
| `types.ts` | 685 | **Every entity type.** The contract the schema was written from | 59 |
| `domain.ts` | 434 | `BUSINESS_TYPES`, per-industry `vocabulary()`, every status→tone map | 40 |
| `utils.ts` | 186 | `cn`, `formatCurrency`, `formatClock`, `relativeTime`, `initials`, `sleep` | **92 — the hottest module** |
| `config.ts` | 126 | `BRAND`, `DATA_MODE`, `config.*`, `siteUrl()` | 13 |
| `navigation.ts` | 153 | Nav trees for both workspaces, filtered by capability | 6 |

### `lib/services/` — 10 files, 66 paths

| File | Lines | Paths | Status |
| --- | --- | --- | --- |
| `auth-service.ts` | 277 | 6 | USED — **real Supabase calls** |
| `business-service.ts` | 229 | 11 | USED — partly real |
| `operations-service.ts` | 181 | 11 | USED — mock |
| `approval-service.ts` | 176 | 8 | USED — mock, mutates in place |
| `admin-service.ts` | 168 | 10 | USED — mock |
| `api-client.ts` | 151 | — | USED — **`serve()` and `paginate()`, the seam** |
| `workflow-service.ts` | 130 | 10 | USED — mock |
| `customer-service.ts` | 112 | 4 | USED — mock |
| `insight-service.ts` | 88 | 6 | USED — mock |
| `index.ts` | 29 | — | Barrel re-export |

### `lib/mock/` — 11 files, the simulated world

| File | Lines | Purpose | Status |
| --- | --- | --- | --- |
| `workflows.ts` | 847 | **`classify()`, `PLAN_BY_INTENT`, `buildSteps()`, `buildRun()`, `recentRuns()`** — the simulated AI | USED |
| `business-data.ts` | 625 | The tenant generator + 8 query functions | USED |
| `platform.ts` | 439 | `INTEGRATIONS` (11), `HEALTH_COMPONENTS` (6), fleet metrics | USED |
| `metrics.ts` | 438 | KPIs, chart series, `attentionItems()` | USED |
| `approvals.ts` | 426 | Approval batches + the 5 message templates | USED |
| `businesses.ts` | 418 | 3 demo tenants, `BUSINESS_INDEX` | USED |
| `activity.ts` | 417 | The audit array + `recordActivity()` | USED |
| `capabilities.ts` | 415 | The 9-capability catalogue, `capabilityMeta()`, `SUGGESTED_COMMANDS` | USED — **misfiled; this is domain metadata, not mock data** |
| `agents.ts` | 392 | `AGENTS` (11), `WORKFLOW_DEFINITIONS` (8) | CONFIG-ONLY as agents |
| `seed.ts` | 130 | `rngFor`, `pick`, `between`, `chance`, the time helpers | USED |
| `demo-bridge.ts` | 37 | Maps a real tenant UUID to a demo dataset | PARTIAL — `clearDemoAliases()` has no importer |

### `lib/supabase/` — 6 files

| File | Lines | Purpose | Status |
| --- | --- | --- | --- |
| `businesses.ts` | 284 | The 6 tenant read/write functions | USED |
| `session.ts` | 96 | `roleFromUser()`, `loadSession()`, `touchLastActive()` | USED |
| `middleware.ts` | 65 | `updateSession()`, `redirectWithSession()` | USED |
| **`server.ts`** | 50 | Server client for RSC / route handlers | **UNUSED — zero importers** |
| `config.ts` | 42 | `isSupabaseConfigured()`, `GUARDED_PREFIXES`, `isGuardedPath()` | USED |
| `client.ts` | 36 | Memoised browser client, `null` when unconfigured | USED |

### `lib/hooks/` — 4 files

| File | Lines | Purpose |
| --- | --- | --- |
| `use-command-run.ts` | 167 | The run animator, 6 phases |
| `use-table-state.ts` | 92 | Table state shaped like `ListParams` |
| `use-async.ts` | 70 | `{data, loading, error, refetch, mutate}` |
| `use-media-query.ts` | 23 | `matchMedia` subscription |

---

## `supabase/` — schema

| File | Lines | Purpose | Ever run? |
| --- | --- | --- | --- |
| `migrations/…_rls.sql` | 341 | 3 helpers + 46 policies + RLS on 24 tables | **No — CI only** |
| `migrations/…_records.sql` | 215 | 6 record tables | No |
| `migrations/…_core.sql` | 199 | 9 identity/tenancy/catalogue tables | No |
| `migrations/…_ai.sql` | 176 | 7 AI/audit tables | No |
| `migrations/…_enums.sql` | 154 | `pgcrypto` + 37 enums | No |
| `migrations/…_indexes.sql` | 146 | 37 indexes, 5 of them partial | No |
| `migrations/…_audit_append_only.sql` | 78 | Append-only triggers + revokes | No |
| `migrations/…_storage.sql` | 78 | Bucket + 4 object policies | No |
| `migrations/…_platform.sql` | 59 | 2 integration tables | No |
| `tests/rls.test.sql` | 236 | pgTAP cross-tenant isolation | CI only |
| `reset-remote.sql` | 78 | **Destructive schema wipe.** Run by hand only | Not yet |
| `README.md` | 145 | Schema notes | — |
| `config.toml` | 72 | Supabase CLI settings | — |
| `seed.sql` | ~1.2 MB | 22 tables of demo rows | GENERATED — do not hand-edit |

---

## `tests/unit/` — 7 files, 220 assertions

| File | Lines | Covers |
| --- | --- | --- |
| `domain.test.ts` | 265 | 25 — `BUSINESS_TYPES`, vocabulary, agent roster invariants |
| `dataset.test.ts` | 249 | 27+ — generator invariants, opening hours, the approval/capability rule |
| `migrations.test.ts` | 230 | 98 — every tenant table has `business_id`, RLS, policies |
| `utils.test.ts` | 148 | 23 — formatters, including the `₹18.4L` lakh scale |
| `intent.test.ts` | 132 | 24 — the classifier, all 9 intents + fallback |
| `auth-guard.test.ts` | 118 | 10 — `isGuardedPath` and redirect decisions |
| `paginate.test.ts` | 83 | 11 — search, filter, sort, slice |

**No browser test framework.** Playwright was removed at the user's request; the
`tests/e2e/` directory, `playwright.config.ts` and the e2e CI job are all gone.

---

## `scripts/` and CI

| File | Lines | Purpose |
| --- | --- | --- |
| `scripts/generate-seed.ts` | 712 | Imports the mock modules, converts string ids to UUIDv5, emits `seed.sql`. Run with `tsx` |
| `scripts/clean-next-diagnostics.mjs` | 29 | Deletes `.next/diagnostics` before `dev`. Works around a Windows + OneDrive `EINVAL` |
| `.github/workflows/ci.yml` | 84 | Two jobs: `verify` (typecheck + lint + test) and `database` (migrations + pgTAP) |

---

## `docs/`

`docs/connect-supabase.md` (175 lines) predates this documentation set — the
manual steps for attaching a Supabase project. Everything numbered `00`–`34` is
this reverse-engineering set.

---

## The ten files that matter most

If you read nothing else, read these in this order:

1. `lib/types.ts` — the domain
2. `lib/services/api-client.ts` — the seam
3. `lib/mock/workflows.ts` — the simulated AI
4. `lib/hooks/use-command-run.ts` — the animation
5. `components/providers/session-provider.tsx` — tenancy
6. `middleware.ts` — the guard
7. `supabase/migrations/20260910120600_rls.sql` — isolation
8. `lib/domain.ts` — why it is not salon-specific
9. `lib/config.ts` — where the future attaches
10. `app/app/command/page.tsx` — where it all meets

`29_CODE_READING_ORDER.md` expands this into a full reading plan.
