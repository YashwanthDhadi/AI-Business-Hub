# 23 — Testing architecture

## What exists

| Kind | Framework | Count | Location |
| --- | --- | --- | --- |
| Unit | Vitest ^2.1.9 | **220 tests, 7 files, all passing** | `tests/unit/` |
| Database / isolation | pgTAP | 1 suite | `supabase/tests/rls.test.sql` (236 lines) |
| Browser / E2E | **None** | — | Removed at the user's request |
| Component / render | **None** | — | No Testing Library, no jsdom |
| Visual regression | **None** | — | |
| Load / performance | **None** | — | |
| Contract / API | **None** | — | No API to test |

Verified by running the suite:

```
✓ tests/unit/migrations.test.ts  (98 tests)
✓ tests/unit/auth-guard.test.ts  (10 tests)
✓ tests/unit/domain.test.ts      (25 tests)
✓ tests/unit/paginate.test.ts    (11 tests)
✓ tests/unit/utils.test.ts       (23 tests)
✓ tests/unit/intent.test.ts      (24 tests)
✓ tests/unit/dataset.test.ts     (29 tests)

Test Files  7 passed (7)
     Tests  220 passed (220)
  Duration  1.92s
```

**No browser test framework.** Playwright was removed on request — `tests/e2e/`,
`playwright.config.ts`, the `@playwright/test` dependency, the e2e CI job and the
`test:e2e` scripts are all gone. `tests/unit/auth-guard.test.ts` was added as
replacement coverage for the guard logic that an E2E test would have exercised.

---

## Configuration

`vitest.config.ts`:

```ts
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    // The suite covers the data and domain layers, which are pure TypeScript.
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "./test-results/unit.xml" },
  },
});
```

Three choices worth understanding:

- **`environment: "node"`**, not `jsdom`. The suite tests pure TypeScript, so
  there is no DOM to simulate and startup is fast (1.9 s for 220 tests). It also
  means **no component can be tested** without changing this.
- **The `@` alias is duplicated here** from `tsconfig.json`. Vitest does not read
  `tsconfig` paths, so both must be kept in step.
- **JUnit output only in CI** — `test-results/unit.xml`, uploaded as an artifact.

---

## What each file covers

### `migrations.test.ts` — 98 tests

The largest suite. Reads the nine `.sql` files **as text** and asserts structural
invariants. Its own `describe` blocks name the concerns:

| Block | Asserts |
| --- | --- |
| *migration inventory* | The tables the domain model needs are created; a meaningful number of them are tenant-scoped |
| *tenant isolation is structural* | RLS is enabled on the shared tables too, not only the obvious ones |
| *what the platform team may read* | The platform team can read tenant metadata **and** that customer records are kept away from them |
| *the audit trail is append-only* | `activities` has no update or delete policy; update and delete are revoked **including from `service_role`**; a trigger blocks mutation as well as the grants; an approval decision is protected once made |
| *helper functions* | The membership helpers are `security definer`; they are not exposed to anonymous callers |
| *storage* | A **private** documents bucket exists; object access is scoped to the tenant in the path |

It cannot catch a semantic error — it does not run SQL. It catches the class of
mistake that actually happens: **a new table added without a policy.** That is a
tenant leak, and this suite makes it a red CI run instead of a production
incident. For a text-based test that is a very good return.

### `dataset.test.ts` — 29 tests

Invariants of the generated data, in five groups:

| Block | Asserts |
| --- | --- |
| *tenant isolation* | Every record stays inside its own business; an unknown tenant returns an **empty workspace rather than leaking one**; each demo tenant has a distinct customer set |
| *payment reconciliation* | The salon has exactly the 17 overdue accounts the workflow reports; per-tenant overdue quotas hold; overdue accounts are ordered by lateness; every overdue row has a positive days-overdue and a past due date; a paid invoice never looks unsettled |
| *approvals match the underlying records* | One reminder item per overdue invoice; **every messaging batch item has a draft message containing the customer's first name**; batch impact sums from its own items; decided approvals stay out of the pending queue; **approvals are only ever proposed for capabilities the tenant enabled** |
| *schedule and stock* | Today's bookings come back in time order; the window covers days either side of today; **nothing is booked on a closed day**; **every booking finishes before closing time**; every booking is dated to the day requested; only genuinely short stock is flagged low |
| *follow-up segmentation* | Only at-risk and dormant customers are selected; every one gets a proposed next action; anyone carrying a balance is tagged |

The "empty workspace rather than leaking one" test is the sharpest of these: a
lookup miss must return nothing, never fall back to another tenant's data.

Three of these were written **in response to real bugs**:

| Bug | Test now enforcing it |
| --- | --- |
| Salon raised a `documents` approval without that capability enabled | The approval/capability invariant |
| MetroMart raised a `customer_followup` approval without that capability | Same |
| 23 appointments generated past midnight (salon 23:20 vs a 20:00 close) | The two opening-hours invariants |

A fourth test was **rewritten** rather than added: it originally pinned specific
day offsets (−3, +5), which broke whenever the generator's window shifted. It is
now window-based — asserting the property, not the coincidence. That distinction
is the difference between a test that protects you and one that just needs
updating.

### `domain.test.ts` — 25 tests

- Every `BUSINESS_TYPES` entry has a complete `vocabulary`
- Every `recommendedCapabilities` entry is a valid `CapabilityKey`
- Exactly one agent has `kind: "supervisor"`
- **Every specialist has a real `capability`** — the same rule as the
  `agents_capability_required` CHECK, so it is enforced in both TypeScript and
  Postgres
- Every status→tone map covers every enum value

That last one prevents a status rendering with no colour — a silent UI bug that
no type checker catches, because the maps are `Record<K, Tone>` with keys that
can drift.

### `intent.test.ts` — 24 tests

Every one of the nine intents plus the fallback, and the vocabulary rewriting.

It exists because of a **real classifier bug**: a bare `"tomorrow"` keyword in
`booking_confirm` hijacked any request mentioning the day. Fixed by removing the
keyword and adding weighted multi-word phrases; these tests pin the behaviour so
it cannot regress.

### `utils.test.ts` — 23 tests

Formatters, and the file with the highest per-line value because 92 modules
import what it tests.

Includes the case that caught **my own wrong assumption**: `formatCurrency(1_840_000,
"INR", { compact: true })` is `"₹18.4L"` — the Indian lakh scale, not `"₹1.8L"`.
Getting that wrong on an invoice screen would be a serious error, and the test
now documents the correct behaviour.

### `paginate.test.ts` — 11 tests

Search across `searchFields`, filter (skipping `"all"` and empty), numeric vs
string sort, both directions, page slicing, the `total` count before slicing, and
out-of-range pages.

`paginate()` backs every table in the app, so these 11 tests cover nine screens.

### `auth-guard.test.ts` — 10 tests

`isGuardedPath()` for `/app`, `/admin`, `/onboarding`, their subpaths, the exact
prefixes, and unguarded paths; plus the role-based redirect decisions. Written to
replace the removed E2E coverage.

---

## Database testing — pgTAP

`supabase/tests/rls.test.sql`, 236 lines. Run with `npx supabase test db`.

What it does, which is the thing that matters most in this whole test suite:
creates **two** businesses and **two** users, signs in as user A, and asserts
**zero rows** returned from every tenant-scoped table belonging to business B.

Cross-tenant isolation is proven **in the database**, under real RLS, with real
`auth.uid()`. Not asserted in a README, not mocked. If a policy is wrong, this
suite fails.

Also covered: the platform-admin asymmetry (can read `approvals`, cannot read
`approval_items`), and that `update`/`delete` on `activities` is rejected.

---

## CI

`.github/workflows/ci.yml`, 84 lines. Two jobs, both on `push` to `main` and on
PRs, with `concurrency: cancel-in-progress` so a newer push supersedes the run in
flight.

### Job 1 — `verify`

```
actions/checkout@v4
actions/setup-node@v4   node 22, cache: npm
npm ci
npm run typecheck        → tsc --noEmit
npm run lint             → eslint .
npm run test             → vitest run
npm run build            → next build
upload-artifact          → test-results/  (if: always())
```

`next build` in CI is doing more work than it appears to: `next.config.mjs` has
`typescript.ignoreBuildErrors: false` and `eslint.ignoreDuringBuilds: false`, and
the build-time Supabase guard throws unless the environment is configured or
`NEXT_PUBLIC_DEMO_MODE=1`. **The build step is also a configuration test.**

### Job 2 — `database`

```
npx supabase start                      boots Postgres + Auth + Storage in Docker
npx supabase db reset                   applies all 9 migrations + seed.sql from scratch
npx supabase test db                    the pgTAP isolation suite
npx supabase db lint --level warning    schema lint
npx supabase stop --no-backup           (if: always())
```

The comments in the file name the intent of each step, including: *"The isolation
gate: a salon owner querying FitZone gets zero rows."*

**This job is the only place the migrations have ever run.** This machine has no
Docker and no local `psql`, so `db:start` / `db:reset` / `db:test` have never
executed locally. Every statement about the schema in these docs is derived from
reading the SQL, with CI as the only execution evidence. That is stated plainly
because it is a real limitation.

---

## Coverage — honestly

No coverage tool is configured (no `@vitest/coverage-v8`, no thresholds), so
there is no percentage to quote. By layer:

| Layer | Coverage |
| --- | --- |
| `lib/utils.ts` | **Good** — 23 tests over the formatters |
| `lib/domain.ts` | **Good** — 25 tests over vocabulary and maps |
| `lib/mock/business-data.ts` | **Good** — 29 invariant tests |
| `lib/mock/workflows.ts` `classify()` | **Good** — 24 tests |
| `lib/services/api-client.ts` `paginate()` | **Good** — 11 tests |
| `lib/supabase/config.ts` | **Partial** — `isGuardedPath` only |
| The migrations | **Structural** — 98 text assertions + pgTAP |
| `lib/mock/workflows.ts` `buildSteps()` | **None** |
| `lib/hooks/*` | **None** — no hook is tested |
| `lib/services/*` resolvers | **None** |
| `lib/supabase/businesses.ts`, `session.ts` | **None** — no Supabase mock exists |
| Every component and page | **None** |
| `middleware.ts` | **None** directly — only its helpers |

The pattern is clear and defensible: **pure functions and data invariants are
well covered; everything that touches React or the network is not covered at
all.** That maps exactly to `environment: "node"`.

### The two gaps that matter

1. **`middleware.ts` itself is untested.** `isGuardedPath` is tested, the redirect
   logic is not. It is the security boundary, and a refactor that replaced
   `getUser()` with `getSession()` would pass all 220 tests. That would be a
   complete authentication bypass with a green CI run.
2. **No test proves the real Supabase round trip works.** Sign-in against the
   actual project has never succeeded, because the schema has never been pushed
   to it.

---

## How to run

```bash
npm run test          # vitest run — 220 tests, ~2 s
npm run test:watch    # watch mode
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run verify        # all three — exactly what CI runs

npm run db:start      # requires Docker
npm run db:reset      # migrations + seed
npm run db:test       # pgTAP
npm run db:lint       # schema lint
```

`npm run verify` before every commit. The `db:*` scripts need Docker.

---

## What to add next, in order

1. **A middleware test.** Mock `updateSession`, assert the redirect for each of:
   no user on a guarded path, `BUSINESS_USER` on `/admin`, `PLATFORM_ADMIN` on
   `/app`, signed-in user on `/login`. Highest value per line in the whole
   codebase.
2. **A `serve()` test.** Assert the mock branch calls the resolver, the api
   branch calls `fetch` when `DATA_MODE=api` and a base URL is set, and that a
   resolver throw becomes an `ApiError` with the right `path`. This is the seam;
   it deserves tests before it is switched over.
3. **`buildSteps()` tests.** For each of the nine intents: the step count, that
   step 1 is `understanding`, that a gate exists exactly when
   `requiresApproval` is true, and that a gate is always last.
4. **Component tests** — needs `jsdom` and Testing Library. Start with
   `workflow-panel` (six phases) and `approval-drawer` (include/exclude, edit).
5. **A coverage threshold in CI**, once 1–3 exist, so coverage cannot silently
   regress.
