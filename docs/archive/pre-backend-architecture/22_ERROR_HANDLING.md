# 22 — Error handling

---

## The error surface, in layers

```
Postgres CHECK / RLS / trigger        → PostgrestError
        ▼
lib/supabase/*                        → thrown Error with a readable message
        ▼
lib/services/* resolver               → thrown
        ▼
serve()  api-client.ts:88             → wrapped as ApiError(message, 500, path)
        ▼
useAsync .catch                       → error: string
   or use-command-run .catch          → phase: "failed"
        ▼
page renders an error state · or app/error.tsx catches a render throw
        ▼
app/global-error.tsx  (last resort)
```

Five layers, each with one job. The pattern is consistent, which is why error
states behave the same everywhere.

---

## `ApiError` — the one error type

`lib/services/api-client.ts:13`:

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly path?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
```

Thrown from three places:

| Where | Status | When |
| --- | --- | --- |
| `serve()`'s catch (`:88`) | `500` | Any mock resolver throw |
| `fetchFromApi` on `!response.ok` | the real HTTP status | Never today |
| `fetchFromApi`'s catch | `0` | Network failure / abort. Never today |

`status: 0` for a network failure is a deliberate convention — it distinguishes
"the server said no" from "there was no server". Nothing branches on it yet.

Carrying `path` means an error message can name the endpoint that failed, which
will matter for debugging once real requests exist.

---

## `useAsync` error handling

`lib/hooks/use-async.ts`:

```ts
fetcherRef.current()
  .then((result) => { if (!cancelled) setData(result); })
  .catch((cause: unknown) => {
    if (!cancelled) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    }
  })
  .finally(() => { if (!cancelled) setLoading(false); });
```

Three properties:

1. **`cause instanceof Error`** — handles a non-Error throw without producing
   `"[object Object]"` on screen.
2. **The `cancelled` flag guards all three callbacks**, so an unmounted component
   never sets state and React never warns.
3. **`finally` always clears `loading`** — an error can never leave a permanent
   skeleton.

The error is a **string**, not the error object. Simple, and it means status
codes are unavailable to the UI. Fine while every failure is a 500; a limitation
once real statuses arrive (a 401 should re-authenticate, a 403 should say
"forbidden", a 404 should say "not found" — all three would look identical today).

### The state-ordering trap

Pages must check `error` **before** `loading || !data`:

```tsx
if (error) return <ErrorState … />;      // ← must come first
if (loading || !data) return <Skeleton />;
```

Two pages got this backwards — `app/app/workforce/[key]/page.tsx` and
`app/admin/businesses/[id]/page.tsx`. When `useAsync` errors, `data` stays
`undefined`, so the `loading || !data` branch matched first and the error state
was **unreachable**: the user saw a skeleton forever. Both are fixed. Check this
ordering in any new page.

---

## Error boundaries

### `app/error.tsx` — route level

Its comment states the intent: *"Keeps the shell around it intact, so an owner
who hits a broken screen can retry or navigate away rather than losing the whole
workspace."*

What it renders:

- A warning icon and the heading "This screen could not be loaded"
- **"Nothing was changed and no action was taken."** — the right message for this
  product. An owner whose AI is chasing customers needs to know a broken screen
  did not send anything.
- `error.digest` as a `Reference:` line when present — Next's server-error
  correlation id, the only thing linking a user report to a server log
- Two actions: `reset()` and a link back to `/app/overview`

```ts
React.useEffect(() => {
  // Replace with the error reporter once Sentry is wired up.
  console.error("Route error:", error);
}, [error]);
```

That comment is honest and marks the gap: **there is no error reporter.**

### `app/global-error.tsx` — last resort

Catches a throw in the root layout itself. Its comment: *"This replaces the root
layout, so it cannot rely on the providers, fonts or design tokens — everything
here is inline and standalone."*

Correct, and the reason every style in the file is an inline `style={{}}` object
with literal hex colours (`#f7f8fb`, `#14161f`) and a system font stack. It
renders its own `<html>` and `<body>`. If you edit it, do not import a component
or use a Tailwind class — at that point the design system may be the thing that
broke.

### `app/not-found.tsx`

404 for an unmatched route and for explicit `notFound()` calls.

---

## Command-run failures

`lib/hooks/use-command-run.ts:117`:

```ts
} catch (cause) {
  if (cancelled.current) return;
  setError(cause instanceof Error ? cause.message : "The workflow could not be started");
  setPhase("failed");
}
```

`workflow-panel.tsx` then renders the failure card with a Retry button.

**What can actually reach it:** a throw from `plan()` or `start()`. In practice
one condition:

```ts
const business = BUSINESS_INDEX.get(businessId);
if (!business) throw new Error("Business not found");
```

which happens when the active tenant is a real Supabase workspace with no demo
dataset alias registered. See doc 30.

**What cannot reach it:** anything after the loop starts. `complete()` is called
as `void workflowService.complete(started)` — the `void` discards the promise, so
a rejection is unhandled and never reaches this `catch`. Today that is harmless;
against a real API it silently loses the audit row. Doc 32.

---

## Empty, loading and error states

`components/ui/states.tsx` (93 lines, 21 importers) holds the shared components,
which is why these are consistent across 33 pages.

| State | Treatment |
| --- | --- |
| Loading | `Skeleton` matching the real layout's shape, so nothing shifts on load |
| Empty (no data yet) | An icon, a sentence, and usually an action |
| Empty (filtered to nothing) | A distinct message — "no results for that search", not "you have no customers" |
| Error | Message + retry |
| Partial | Not modelled — a page is loading, loaded, or errored |

The empty/filtered distinction is small and matters: telling an owner they have
no customers when they have 40 and mistyped a search is a bad bug that never
throws.

---

## Toasts

`sonner`, via `components/ui/toaster.tsx`. Four levels used: `success`, `error`,
`warning`, `info`. Convention across the codebase:

```ts
toast.error("Approval failed", {
  description: error instanceof Error ? error.message : undefined,
});
```

Title states what failed; description carries the message when there is one.
`undefined` rather than a fallback string — no empty description line.

Toasts are for **action outcomes**. Load failures use an inline error state, not
a toast, because a toast disappears and a failed page needs to stay visibly
failed.

---

## Database-level error handling

The layer that catches what the app does not.

| Mechanism | Prevents |
| --- | --- |
| `not null` on every `business_id` | An untenanted row |
| `check (amount >= 0)`, `check (seats > 0)`, `check (duration_min > 0)` | Nonsense values |
| `constraint appointments_time_order check (ends_at > starts_at)` | **Caught a real bug** — 23 past-midnight bookings |
| `unique (business_id, invoice_number)` | Duplicate invoice numbers per tenant |
| `unique (business_id, sku)` | Duplicate SKUs per tenant |
| `payments_paid_consistency` | A "paid" invoice with no payment detail |
| `agents_capability_required` | A specialist agent with no capability |
| RLS with `using` **and** `with check` | Reading *or writing* another tenant's row |
| `reject_audit_mutation()` triggers | Rewriting the audit trail, even as `service_role` |
| `protect_approval_decision()` | Altering a decision after the fact |
| `storage_business_id()` returning `null` on a malformed path | Storage access outside a tenant folder |

The `appointments_time_order` case is the argument for this whole approach: the
application had a bug, the application did not notice, and the constraint would
have refused the insert. **Prefer a constraint to a validation whenever the rule
is about data rather than presentation.**

---

## What is missing

| Gap | Impact |
| --- | --- |
| **No error reporting service** | No Sentry, no Rollbar, no Bugsnag. `console.error` only. A production error is invisible unless a user reports it. The `error.tsx` comment already names the intended fix |
| **No structured logging** | Nowhere for a backend to log |
| **No retry on any failure** | Every transient failure is a visible error |
| **No error-code taxonomy** | `useAsync` exposes a string; a 401, 403 and 404 are indistinguishable to the UI |
| **No offline handling** | No `navigator.onLine`, no service worker, no queued mutations |
| **No `ErrorBoundary` inside pages** | A throw in one widget takes the whole route to `error.tsx` |
| **`void complete()`** | The one swallowed rejection in the codebase |
| **No schema validation** | Malformed data would surface as a render crash rather than a clean message |

The first is the one to fix before the first real deployment. The `digest`
plumbing is already in place for it.

---

## Related documents

- `12_DATA_FLOW.md` — where errors originate
- `11_DATABASE_ARCHITECTURE.md` — the constraints
- `30_DEBUGGING_GUIDE.md` — diagnosing each of these
- `32_UNKNOWN_BROKEN_INCOMPLETE.md` — the open items
