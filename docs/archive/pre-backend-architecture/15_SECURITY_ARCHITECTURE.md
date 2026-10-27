# 15 — Security architecture

Nothing in this document exploits anything. It describes the mechanisms that
exist, names the gaps honestly, and says which gaps matter now versus which
matter once a backend exists.

**No secret value appears anywhere in these docs.** Where a credential is
relevant, only the variable name and its kind are given.

---

## Summary

| Layer | State |
| --- | --- |
| Authentication | **Real** — Supabase Auth (GoTrue), cookie sessions via `@supabase/ssr` |
| Server-side route guard | **Real** — `middleware.ts`, runs before any HTML |
| Role separation | **Real** — `app_metadata.role`, server-writable only |
| Tenant isolation | **Real and database-enforced** — 50 RLS policies |
| Audit trail | **Real and append-only** — enforced by trigger, even against `service_role` |
| Storage isolation | **Real** — 4 policies deriving the tenant from the object path |
| Input validation | **Minimal** — hand-written per form; no schema validation anywhere |
| Rate limiting | **None** |
| CSRF protection | Not applicable yet — no state-changing server endpoint exists |
| Secrets management | Environment variables; no secret is read by any code today |
| Dependency scanning | **None** configured |
| Logging / alerting | **None** |

---

## Authentication

`lib/services/auth-service.ts` wraps Supabase Auth. Six paths:
`signIn`, `register`, `signOut`, `currentSession`, `requestPasswordReset`,
`updatePassword`.

| Property | Implementation |
| --- | --- |
| Password storage | Supabase (bcrypt). Not this codebase's concern |
| Session transport | HTTP-only cookies set by `@supabase/ssr` |
| Session refresh | `updateSession()` on every non-static request |
| Token validation | `supabase.auth.getUser()` — validates against the auth server |
| Password reset | `resetPasswordForEmail` → email link → `updateUser` |
| MFA | Not enabled |
| OAuth / social login | Not implemented |
| Email verification | Supabase project setting, not controlled here |
| Rate limiting on sign-in | Whatever the Supabase project enforces; none added |

### `getUser()` vs `getSession()` — the one that matters

`lib/supabase/middleware.ts` states it in a comment:

> `getUser()` must be called, not `getSession()`. getSession trusts the cookie;
> getUser validates it against the auth server, which is the difference between a
> guard and a suggestion.

`getSession()` decodes the cookie locally and returns whatever it says. A forged
or expired cookie passes. `getUser()` makes a network call and validates the JWT.
Every guard in this application depends on that call. **If you refactor
`middleware.ts` for performance, do not replace it.**

---

## Authorization

Three levels, each enforced somewhere different.

### 1. Platform role — who gets which workspace

`lib/supabase/session.ts:18`:

```ts
function roleFromUser(user: User): UserRole {
  return user.app_metadata?.role === "PLATFORM_ADMIN" ? "PLATFORM_ADMIN" : "BUSINESS_USER";
}
```

Read from **`app_metadata`**, never `user_metadata`.

| Field | Who can write it |
| --- | --- |
| `user_metadata` | **The user themselves**, via `supabase.auth.updateUser()` |
| `app_metadata` | Service role only — never the client |

Had this read `user_metadata`, any signed-in user could call `updateUser({ data:
{ role: "PLATFORM_ADMIN" } })` and gain the admin workspace. It reads
`app_metadata`, and the default is `BUSINESS_USER` — fail closed. This is the
single most important line in the auth layer.

There is also a `platform_admins` table in Postgres whose comment says
*"Membership of this table is what UserRole = 'PLATFORM_ADMIN' means"*, and
`is_platform_admin()` uses it for RLS. **The two sources are not synchronised by
any code.** A user could have `app_metadata.role = "PLATFORM_ADMIN"` (so they
reach `/admin`) without a `platform_admins` row (so RLS denies them the data), or
the reverse. Both fail safely — the UI shows an empty admin workspace, or a
normal user with no admin route — but they should be one source of truth.
Recorded in doc 32.

### 2. Route guard — where you may go

`middleware.ts`. Documented in full in `14_BACKEND_ARCHITECTURE.md`. The
properties:

- Runs on the Edge, **before any HTML is generated**
- Guards `/app`, `/admin`, `/onboarding` (`GUARDED_PREFIXES`)
- No session on a guarded path → `307 /login?next=<encoded path>`
- `BUSINESS_USER` on `/admin` → redirected to `/app/overview`
- `PLATFORM_ADMIN` on `/app` → redirected to `/admin/overview`
- Signed-in user on `/login`, `/register`, `/forgot-password` → their workspace

Tested by `tests/unit/auth-guard.test.ts` (10 assertions) covering
`isGuardedPath` and the redirect decisions.

**Its one weakness is not a code bug but a build property.** See the next
section.

### 3. Tenant isolation — what you may read

The strongest part of the system, and the part that does not depend on
application code being correct.

Every tenant-scoped table has `business_id uuid not null references businesses
(id) on delete cascade` and an RLS policy resolving through `business_users`:

```sql
create policy "members access customers"
  on public.customers for all to authenticated
  using (public.is_member_of(business_id))
  with check (public.is_member_of(business_id));
```

`is_member_of` is `security definer` with `set search_path = public` — see doc 11
for why both matter. 50 policies; RLS enabled on **24 of 24 tables**.

Consequence: a bug in the API, a wrong `businessId` in a fetch, or a malicious
crafted request cannot return another tenant's rows. The database refuses.
`supabase/tests/rls.test.sql` (pgTAP) proves it by creating two tenants and
asserting zero cross-tenant rows.

`using` **and** `with check` both present matters: `using` filters reads,
`with check` validates writes. A policy with only `using` would let a member
insert a row stamped with someone else's `business_id`.

---

## The build-time guard erasure

The most non-obvious security property in the repository, so it is stated twice
in the docs deliberately.

`NEXT_PUBLIC_*` variables are **inlined by Next at build time**, including inside
middleware. `isSupabaseConfigured()` reads two of them. Build with them unset and
the middleware's first line compiles to `if (true) return NextResponse.next()` —
**the guard is gone from the artifact**, and setting the variables at runtime
cannot restore it. The deployment would serve `/app` and `/admin` to any
unauthenticated caller, falling back to a browser-side redirect that a
non-browser client simply ignores.

`next.config.mjs` fails the production build unless Supabase is configured or
`NEXT_PUBLIC_DEMO_MODE=1` is explicitly set, with the reason in the error text.
That check is a security control, not a convenience. Do not remove it, and do not
set `NEXT_PUBLIC_DEMO_MODE=1` on anything that will hold real data.

---

## The audit trail

`activities` is append-only, enforced twice.

**RLS:** a `select` policy, an `insert` policy, and no `update` or `delete`
policy. Under RLS a missing policy is a denial.

**Triggers:** `20260910120700_audit_append_only.sql` adds
`activities_block_update` and `activities_block_delete`, both calling
`reject_audit_mutation()`. Triggers fire regardless of RLS, so this holds **even
for `service_role`**, which bypasses policies entirely. A compromised service key
or a buggy backend still cannot rewrite history.

`protect_approval_decision()` does the same for approvals: once decided, the
decision is immutable.

Today the audit rows are written to an in-memory array by `recordActivity()` and
vanish on refresh. The table is ready; nothing writes to it.

---

## Storage isolation

`20260910120800_storage.sql`. A private `documents` bucket — `public: false`, 20 MB
limit, mime types restricted to PDF, PNG, JPEG and CSV.

The path convention is `{business_id}/{document_id}.{ext}`, and
`storage_business_id()` reads the tenant back out of the first path segment:

```sql
declare first_segment text := split_part(object_name, '/', 1);
begin
  return first_segment::uuid;
exception
  when invalid_text_representation then
    return null;
end;
```

**A malformed path returns `null`, and `is_member_of(null)` is false — so every
policy fails closed.** That exception handler is the security-relevant line; a
version that raised, or that returned a default, would behave very differently.

Four policies: members read, members upload, members replace, and **only owners
and managers delete** — the comment gives the reason: *"issued paperwork should
not disappear because a staff account was compromised."*

The platform team gets **no storage policy at all**, consistent with the rule
that the admin workspace never shows customer data.

Nothing in the application uploads or reads a file yet.

---

## Input validation

The weakest area, and the one that will matter most when a backend arrives.

| Surface | Validation |
| --- | --- |
| Onboarding profile | Hand-written: name ≥ 2 chars, type required, location ≥ 2 chars |
| Auth forms | HTML `type="email"`, `required`; Supabase validates server-side |
| Command box | **None.** Free text, straight into `classify()` |
| Approval message edit | **None.** Any string is accepted |
| Table search / filters | Passed to `paginate()`, used in `String.includes` |
| Query parameters (`?prompt=`, `?next=`) | `?next=` is `encodeURIComponent`-ed on write and checked with `next.startsWith("/")` on read (`login/page.tsx:50`). `?prompt=` is unvalidated free text |

**No schema validation library is installed.** No Zod, no Yup, no Valibot, no
`io-ts`. Every boundary is validated by hand or not at all.

Why it is survivable today: the only real writes are five typed Supabase calls
whose columns are constrained by Postgres (`check (seats > 0)`,
`check (amount >= 0)`, enum types, `not null`), and there is no server endpoint to
send unvalidated data to. **The database is currently doing the validation.**

Why it stops being survivable: the moment a route handler exists, its body is
attacker-controlled. Validate at that boundary before anything else.

### The `?next=` parameter — handled correctly

`middleware.ts` builds `?next=${encodeURIComponent(next)}` from
`request.nextUrl.pathname`, a same-origin path. The login page reads it back and
**validates it before use** (`app/(auth)/login/page.tsx:36,50`):

```ts
const next = searchParams.get("next");
…
: next && next.startsWith("/")
    ? next
    : <role-based default>
```

The `startsWith("/")` check is what closes the open-redirect hole: a crafted
`/login?next=https://elsewhere.example` fails it and falls through to the
role-based default. Keep that check if you touch this code — it is the only thing
standing between a redirect parameter and a phishing vector.

---

## The approval gate as a security control

The product's central promise — nothing customer-facing happens without a human —
is implemented as a **per-intent constant**, not a policy engine.

`PLAN_BY_INTENT` in `lib/mock/workflows.ts` has `requiresApproval: true` on four
of nine intents. The line drawn is *does this reach a customer or create a
financial record*:

| Requires approval | Does not |
| --- | --- |
| `payment_followup`, `booking_confirm`, `customer_followup` (send messages) | `schedule_view`, `report`, `inventory`, `support_triage`, `fallback` (read only) |
| `documents` (creates invoices) | |

It is correct in all nine cases. It is correct **because nine literals were typed
correctly**, with nothing enforcing it. A tenth intent added without
`requiresApproval: true` would silently bypass the gate — and once real sending
exists, that means messages leaving without review.

The schema anticipates a better mechanism.
`create type public.approval_policy as enum ('always', 'conditional', 'never')`
(`enums.sql:44`), and the column appears **twice**:

| Column | Default | Meaning |
| --- | --- | --- |
| `capabilities.approval_policy` (`core.sql:145`) | `'conditional'` | The platform's default for this capability |
| `business_capabilities.approval_policy` (`core.sql:169`) | `'always'` | This tenant's override |

The tenant override defaults to `'always'` — fail safe, ask the human unless told
otherwise. That is the right default and it is already in the schema. **No code
reads either column.** The right fix is to derive `requiresApproval` from
`business_capabilities.approval_policy` rather than from a literal in
`PLAN_BY_INTENT`.

---

## Secrets

**No code in this repository reads any secret.** Not one `process.env` access for
an API key exists outside `lib/config.ts`, and `config` stores only variable
*names*:

```ts
anthropic: { apiKeyEnvVar: "ANTHROPIC_API_KEY", … }
supabase:  { serviceRoleKeyEnvVar: "SUPABASE_SERVICE_ROLE_KEY", … }
```

The admin UI renders those names so an operator knows what to set. No value
reaches the browser by this route. **Preserve this pattern.**

Reserved variables, by kind — names only:

| Variable | Kind | Client-exposed? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public URL | Yes, by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public key (RLS-constrained) | Yes, by design |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret — bypasses all RLS** | No |
| `SUPABASE_DB_URL` | secret connection string | No |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` | secret / API key | No |
| `WHATSAPP_API_KEY`, `TWILIO_AUTH_TOKEN`, `RESEND_API_KEY` | secret / API key | No |
| `RAZORPAY_KEY_SECRET`, `STRIPE_SECRET_KEY`, `*_WEBHOOK_SECRET` | secret | No |
| `GOOGLE_CLIENT_SECRET`, `TELEPHONY_API_KEY`, `ACCOUNTING_API_KEY` | secret | No |

`.env.example` documents all of them with empty values and is committed.
`.env.local` is gitignored. `git ls-files` confirms no `.env.local` is tracked.

Two operational notes:

1. **The anon key is public and that is correct.** It is designed to be shipped to
   browsers; RLS is what makes it safe. Its safety is entirely contingent on the
   50 policies being right — which is why they are tested.
2. **The service role key bypasses RLS completely.** It belongs only in a server
   environment, never in `NEXT_PUBLIC_*`, never in a client bundle, never in a
   chat message or a log. If one is ever pasted anywhere it does not belong,
   treat it as compromised and rotate it in the Supabase dashboard immediately —
   rotation is the only remedy, since a leaked key cannot be un-leaked.

---

## What is not protected

Stated plainly, without exploitation detail.

| Gap | Severity now | Severity with a backend |
| --- | --- | --- |
| No rate limiting anywhere | Low — no expensive endpoint | **High** — LLM calls cost money and sign-in is brute-forceable |
| No schema validation | Low — nothing accepts server input | **High** — first route handler is the boundary |
| No prompt-injection defence | None needed — no model is called | **High** — the command box and every customer-supplied field become model input |
| `app_metadata.role` and `platform_admins` unsynchronised | Low — both fail closed | Medium |
| `createBusinessForUser` not transactional | Medium — partial workspace on failure | Same |
| No dependency scanning (`npm audit` not in CI) | Medium | Medium |
| No logging or alerting | Low | **High** — no way to see an attack or an error |
| `requiresApproval` is a literal, not a policy | Low — nothing sends | **Critical** — a missed literal means unreviewed messages sent |
| No CSP or security headers configured | Low | Medium |

The two to fix before anything is sent to a real customer are the last-row item
and rate limiting.

---

## Related documents

- `11_DATABASE_ARCHITECTURE.md` — the RLS model in detail
- `14_BACKEND_ARCHITECTURE.md` — the middleware and the build guard
- `18_CONFIGURATION.md` — every environment variable
- `26_CODE_QUALITY_AUDIT.md` — code-level findings
- `32_UNKNOWN_BROKEN_INCOMPLETE.md` — the open items above
