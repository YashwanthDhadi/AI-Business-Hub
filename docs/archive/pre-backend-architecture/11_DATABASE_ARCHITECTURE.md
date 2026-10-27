# 11 — Database architecture

## Status: designed and complete, barely used

The schema is the most finished part of this project after the UI. It is also
the least exercised: **application code touches 5 of the 24 tables.** Both facts
belong in the same sentence, and both are true.

| Fact | Value |
| --- | --- |
| Engine | PostgreSQL (Supabase-managed) |
| Migrations | 9 files, `supabase/migrations/` |
| Tables | 24, all in schema `public` |
| Enum types | 37 |
| RLS policies | 50 (46 on tables, 4 on `storage.objects`) |
| Tables with RLS enabled | **24 of 24** |
| Indexes | 39 |
| Triggers | 13 |
| PL/pgSQL & SQL functions | 10 |
| Extensions | `pgcrypto` only (plus `pgtap` in tests) |
| ORM | **None.** No Prisma, Drizzle, TypeORM, SQLAlchemy. Raw SQL migrations + the `supabase-js` query builder |
| Migration tool | Supabase CLI (`supabase` ^2.117.0, a devDependency) |
| **Has it ever run?** | **Not on this machine.** No Docker, no local `psql`. CI applies it; the remote project has not been pushed to. See doc 24 |

---

## The migration files, in order

Order matters — the CLI applies them by timestamp prefix, and each depends on the
last.

| File | Lines | Contents |
| --- | --- | --- |
| `20260910120000_enums.sql` | 154 | `create extension pgcrypto`, then all 37 enum types |
| `20260910120100_core.sql` | 199 | `profiles`, `platform_admins`, `businesses`, `business_hours`, `business_users`, `staff`, `capabilities`, `capability_actions`, `business_capabilities` + `handle_new_user()`, `touch_updated_at()` |
| `20260910120200_records.sql` | 215 | `customers`, `customer_interactions`, `appointments`, `payments`, `documents`, `inventory_items` + `sync_stock_status()`, `refresh_customer_outstanding()` |
| `20260910120300_ai.sql` | 176 | `agents`, `workflow_runs`, `workflow_steps`, `approvals`, `approval_items`, `tasks`, `activities` |
| `20260910120400_platform.sql` | 59 | `integrations`, `business_integrations` |
| `20260910120500_indexes.sql` | 146 | 37 of the 39 indexes |
| `20260910120600_rls.sql` | 341 | The 3 security-definer helpers + 46 policies + `enable row level security` on all 24 tables |
| `20260910120700_audit_append_only.sql` | 78 | `reject_audit_mutation()`, `protect_approval_decision()` and the revokes that make `activities` append-only |
| `20260910120800_storage.sql` | 78 | A storage bucket, `storage_business_id()`, 4 policies on `storage.objects` |

---

## The 24 tables

Grouped by what they hold. **`business_id` is the tenant key**; every table that
has one is scoped by RLS through `business_users`.

### Identity and tenancy (5)

| Table | Key | `business_id`? | Notes |
| --- | --- | --- | --- |
| `profiles` | `id` → `auth.users(id)` | — | Application fields for a user. Credentials stay in `auth.users` |
| `platform_admins` | `user_id` | — | **Membership of this table is what `PLATFORM_ADMIN` means** |
| `businesses` | `id` uuid | it *is* the tenant | `slug` unique; `seats > 0` |
| `business_hours` | (`business_id`, `day`) | yes | `day between 0 and 6`, 0 = Sunday |
| `business_users` | (`business_id`, `user_id`) | yes | **The access-control table. Every RLS policy resolves through it.** Index on `user_id` |

### Catalogue — global, not tenant-scoped (5)

| Table | Notes |
| --- | --- |
| `capabilities` | 9 rows. Keyed by the `capability_key` enum |
| `capability_actions` | What each capability may do |
| `agents` | The 11-row roster. `id` is `text` (`agt_supervisor`), not a uuid |
| `integrations` | The third-party catalogue |
| `business_capabilities` | The join: which tenant enabled which capability. **Tenant-scoped** |

`agents` carries the constraint worth remembering:

```sql
constraint agents_capability_required check (
  kind = 'supervisor' or capability_key is not null
)
```

Only the supervisor may have no capability. `tests/unit/domain.test.ts` asserts
the same invariant against the TypeScript roster, so the rule is enforced twice.

### Business records (6)

| Table | `business_id` | Notable constraints |
| --- | --- | --- |
| `customers` | not null, cascade | GIN full-text index on name/email/phone (unused — see doc 10) |
| `customer_interactions` | not null, cascade | `customer_id` cascade |
| `appointments` | not null, cascade | `duration_min > 0`; **`constraint appointments_time_order check (ends_at > starts_at)`** |
| `payments` | not null, cascade | `amount >= 0`; `reminders_sent >= 0`; `unique (business_id, invoice_number)`; `payments_paid_consistency` check |
| `documents` | not null, cascade | `customer_id` on delete set null |
| `inventory_items` | not null, cascade | `in_stock >= 0`; `reorder_level >= 0`; `unique (business_id, sku)` |

`appointments_time_order` is not theoretical — it caught a real data bug. The
mock generator was producing 23 appointments that ran past midnight (a salon
booking at 23:20 against a 20:00 close). The CHECK constraint is what surfaced
it; `buildAppointments` now stops before closing time and skips closed days.
That is the schema doing its job before a single row was inserted.

`unique (business_id, invoice_number)` is the right shape: invoice numbers must
be unique **per tenant**, not globally. A global unique would leak the existence
of other tenants' invoices through constraint violations.

### AI and audit (7)

| Table | Purpose | Written by app code? |
| --- | --- | --- |
| `workflow_runs` | One row per command run | **No** |
| `workflow_steps` | `unique (run_id, position)`; `facts` and `records` as `jsonb` | **No** |
| `approvals` | An approval batch | **No** |
| `approval_items` | The individual records in a batch | **No** |
| `tasks` | Work items | **No** |
| `activities` | The audit trail. Append-only | **No** |
| `agents` | (above) | **No** |

`workflow_steps.facts` and `.records` are `jsonb not null default '[]'` — the same
shape as `WorkflowStep.facts` and `.records` in `lib/types.ts`. The schema was
written from the TypeScript types, which is why the future backend has almost no
mapping work to do.

### Integrations (1)

`business_integrations` — per-tenant connection state. Not written by app code,
and not even seeded.

---

## What application code actually touches

Exhaustive, from `lib/supabase/`:

| Table | Operations | Where |
| --- | --- | --- |
| `profiles` | select; insert via the `on_auth_user_created` trigger | `lib/supabase/session.ts:41` (`loadSession`), `:91` (`touchLastActive` updates `last_active_at`) |
| `business_users` | select, insert | `session.ts:41`, `businesses.ts:153` |
| `businesses` | select, insert, update | `businesses.ts:104,115,153,251` |
| `business_hours` | insert | `businesses.ts:153` |
| `business_capabilities` | insert, update | `businesses.ts:153,228` |
| `platform_admins` | **never queried** | Role comes from `app_metadata.role` instead |

Five tables. The other 19 are reachable only through the Supabase dashboard or
`seed.sql`.

`createBusinessForUser()` (`businesses.ts:153`) performs **four separate
inserts** — `businesses`, `business_users`, `business_hours`,
`business_capabilities` — and they are **not in a transaction.** `supabase-js`
cannot open one from the client. A failure after insert two leaves a business
with an owner and no hours. The fix is a `security definer` PL/pgSQL function
called via `rpc()`; it is not written. Recorded in doc 32.

---

## Tenant isolation — how it actually works

Three security-definer helpers, then 46 policies that all call one of them.

```sql
create or replace function public.is_member_of(target_business uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_users bu
     where bu.business_id = target_business
       and bu.user_id = (select auth.uid())
  );
$$;
```

Three things in that definition are deliberate and each prevents a specific
failure:

1. **`security definer`** — the lookup itself bypasses RLS on `business_users`.
   Without it, a policy *on* `business_users` that references `business_users`
   recurses infinitely. The comment at `rls.sql:18` says exactly this.
2. **`set search_path = public`** — a `security definer` function without a pinned
   `search_path` can be hijacked by a caller who creates a same-named object in a
   schema earlier on their path. This is the standard Postgres privilege-escalation
   vector and it is closed here.
3. **`(select auth.uid())`** — the subselect form lets the planner evaluate it
   once per query instead of once per row. A performance detail with a real
   effect on large scans.

The other two helpers:

- `has_business_role(target_business, roles business_role[])` — same shape, plus
  `and bu.role = any (roles)`. Used by the owner/manager-only write policies.
- `is_platform_admin()` — `exists (select 1 from platform_admins where user_id = auth.uid())`.

### The two deliberate asymmetries

Documented in the migration header and worth stating because they are product
decisions, not oversights:

**1. The platform team reads metadata, never customer data.**

| Platform admin can read | Platform admin cannot read |
| --- | --- |
| `businesses`, `business_users`, `profiles` | `customers` |
| `business_capabilities`, `business_hours` | `customer_interactions` |
| `workflow_runs` | `workflow_steps` |
| `approvals` (metadata) | **`approval_items`** |
| `activities` | `appointments`, `payments`, `documents`, `inventory_items` |
| `business_integrations` | `staff`, `tasks` |

`approvals` yes / `approval_items` no is the sharpest line in the schema: the
admin queue can show "17 payment reminders pending for Sri Lakshmi Salon" without
exposing a single customer's name, phone number or draft message. The admin UI
promises exactly that, and the database is what makes the promise true.

**2. The audit trail is append-only for everyone.**

`activities` has a `select` policy, an `insert` policy, and **no update or delete
policy** — under RLS, a missing policy is a denial. `20260910120700` then adds
belt and braces:

```sql
create trigger activities_block_update before update on public.activities
  for each row execute function public.reject_audit_mutation();
create trigger activities_block_delete before delete on public.activities
  for each row execute function public.reject_audit_mutation();
```

Triggers fire regardless of RLS, so this holds **even for `service_role`**, which
bypasses policies entirely. That is the point: a backend bug or a compromised
service key still cannot rewrite history.

`protect_approval_decision()` does the analogous job for `approvals` — a decided
approval cannot have its decision altered.

---

## Triggers

| Trigger | Table | Function | Effect |
| --- | --- | --- | --- |
| `on_auth_user_created` | `auth.users` | `handle_new_user()` | Inserts a `profiles` row for every signup; `full_name` from `raw_user_meta_data` or the email local-part; `on conflict do nothing` |
| `*_touch_updated_at` (7 triggers) | `businesses`, `profiles`, `customers`, `appointments`, `payments`, `documents`, `inventory_items` | `touch_updated_at()` | Maintains `updated_at` |
| `inventory_items_sync_status` | `inventory_items` | `sync_stock_status()` | Derives `status` from `in_stock` vs `reorder_level` — so stock status cannot drift from stock level |
| `payments_refresh_outstanding` | `payments` | `refresh_customer_outstanding()` | Recomputes the customer's outstanding balance |
| `activities_block_update` / `_block_delete` | `activities` | `reject_audit_mutation()` | Append-only |
| `approvals_protect_decision` | `approvals` | `protect_approval_decision()` | A decision, once made, is immutable |

`sync_stock_status` and `refresh_customer_outstanding` are derived-state triggers:
they keep a denormalised column honest instead of trusting the writer. The
equivalent logic exists independently in the TypeScript mock generator, which is
duplication to be aware of — the database version is authoritative once real
writes begin.

---

## Indexes

39 total, 37 in the dedicated migration. The pattern is consistent and worth
copying for any table you add:

```sql
create index payments_business_status_idx
  on public.payments (business_id, status);
```

**`business_id` first, always.** Every query in this system is
`where business_id = $1 and …`, so a composite index led by the tenant key serves
every one of them. A single-column index on `status` would be nearly useless here.
The two exceptions are the two reverse lookups — `business_users_user_idx
(user_id)` and `payments_customer_idx (customer_id)` — where the tenant is the
answer, not the filter.

Five are **partial** indexes, which is the detail most people miss on a first
read. They index only the rows the product actually asks for:

| Partial index | Predicate | Serves |
| --- | --- | --- |
| `payments_business_due_idx (business_id, due_date)` | `where status <> 'paid'` | The overdue list. Paid invoices are the majority and never queried this way |
| `inventory_business_low_idx (business_id)` | `where status <> 'in_stock'` | The low-stock list |
| `approvals_pending_idx (requested_at)` | `where status = 'pending'` | The cross-tenant admin queue, sorted oldest-first |
| `activities_approval_idx (approval_id)` | `where approval_id is not null` | Tracing an approval through the audit trail |
| `business_capabilities_key_idx (capability_key)` | `where enabled` | "Which tenants have `payment_followup` on" — the admin capability page |

`approvals_pending_idx` is the only index in the schema **not** led by
`business_id`, and deliberately so: the platform admin queue is the one query
that legitimately spans tenants.

Other notable ones:

| Index | Serves |
| --- | --- |
| `business_users_user_idx (user_id)` | "Which businesses does this user belong to" — the sidebar switcher and `is_member_of` |
| `customers_business_last_interaction_idx (business_id, last_interaction_at desc)` | The quiet-customer list |
| `customers_search_idx` GIN `to_tsvector` | The search box — **unused today**, see doc 10 |
| `appointments_business_day_idx (business_id, scheduled_on, starts_at)` | Today's schedule, in order |
| `workflow_steps_run_idx (run_id, position)` | Replaying a run's steps in sequence |

---

## Seed data

`supabase/seed.sql` — 1.2 MB, generated, **do not hand-edit.** Produced by
`scripts/generate-seed.ts` (run with `tsx`), which imports the same mock modules
the UI uses and converts every string id to a deterministic UUIDv5. Same input,
same uuids, every time — so the seed is reproducible and re-runnable.

Populates 22 of the 24 tables:

| Populated | Not populated |
| --- | --- |
| `profiles`, `platform_admins`, `businesses`, `business_hours`, `business_users`, `staff`, `capabilities`, `capability_actions`, `business_capabilities`, `customers`, `customer_interactions`, `appointments`, `payments`, `documents`, `inventory_items`, `agents`, `workflow_runs`, `workflow_steps`, `approvals`, `approval_items`, `activities`, `integrations` | **`tasks`**, **`business_integrations`** |

`supabase/reset-remote.sql` is a separate, destructive script that drops the
schema. It exists because the target Supabase project contained unrelated tables
from an earlier project. **It is run by hand, never by CI**, and it deletes
everything in `public`.

---

## Testing

`supabase/tests/rls.test.sql` — pgTAP. It does the thing that matters: creates
two tenants and two users, then asserts that user A's queries return **zero**
rows from tenant B, across the tenant-scoped tables. Cross-tenant isolation
tested in the database rather than asserted in a README.

`tests/unit/migrations.test.ts` — 98 Vitest assertions that read the migration
files as text and check structural invariants: every tenant table has
`business_id not null`, every one has RLS enabled, every policy names a helper,
`activities` has no update or delete policy. It cannot catch a semantic error,
but it catches the class of mistake that actually happens — a new table added
without a policy.

CI runs both. See `23_TESTING_ARCHITECTURE.md`.

---

## Connection and query patterns

| Aspect | Implementation |
| --- | --- |
| Client | `@supabase/supabase-js` ^2.116, via `@supabase/ssr` ^0.12.7 |
| Browser client | `lib/supabase/client.ts` — memoised `createBrowserClient`; returns `null` when unconfigured |
| Server client | `lib/supabase/server.ts` — `getServerSupabase()`. **No importer. Entirely unused** |
| Middleware client | `lib/supabase/middleware.ts:18` `updateSession()` — the only server-side Supabase use that runs |
| Pooling | Handled by Supabase (PgBouncer). Nothing configured here |
| Transactions | **None.** See the four-insert problem above |
| Prepared statements | Whatever `supabase-js` does; not controlled here |
| Raw SQL from app code | None. All queries go through the query builder |
| N+1 risk | Low today — `fetchBusinesses()` is one query with a join |

---

## Related documents

- `12_DATA_FLOW.md` — which reads come from Postgres and which from memory
- `15_SECURITY_ARCHITECTURE.md` — the isolation model as a security property
- `23_TESTING_ARCHITECTURE.md` — pgTAP and the migration tests
- `24_DEPLOYMENT_ARCHITECTURE.md` — how migrations get applied
- `32_UNKNOWN_BROKEN_INCOMPLETE.md` — the 19 unused tables, the missing transaction
