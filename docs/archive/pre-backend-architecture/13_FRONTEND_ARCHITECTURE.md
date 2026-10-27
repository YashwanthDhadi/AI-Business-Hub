# 13 — Frontend architecture

The frontend is the finished part of this project. 152 tracked TypeScript files,
89 of them client components, 33 pages, 62 components, 4 hooks.

---

## Stack

| Concern | Choice | Version |
| --- | --- | --- |
| Framework | Next.js App Router | ^15.5.4 |
| UI library | React | ^19.0.0 |
| Language | TypeScript, `strict: true` | ^5.7.3 |
| Styling | Tailwind CSS + CSS custom properties | ^3.4.17 |
| Primitives | 16 Radix packages | various |
| Variants | `class-variance-authority` | ^0.7.1 |
| Class merging | `clsx` + `tailwind-merge` | — |
| Icons | `lucide-react` | ^0.475.0 |
| Charts | Recharts | ^2.15.1 |
| Theming | `next-themes` | ^0.4.4 |
| Command palette | `cmdk` | ^1.1.1 |
| Toasts | `sonner` | ^2.0.1 |
| Dates | `date-fns` | ^4.1.0 |
| Animation | `tailwindcss-animate` | ^1.0.7 |

**No state-management library.** No Redux, Zustand, Jotai, MobX, TanStack Query
or SWR. State is React Context plus local `useState`. For an app of this size
that is a defensible choice; the place it costs something is caching, which does
not exist (doc 25).

**No form library.** No React Hook Form, no Formik, no Zod. Forms are controlled
components with hand-written validation — see `app/onboarding/page.tsx:~90`.
There is **no schema validation anywhere in the codebase**, which matters once
untrusted input starts reaching a server (doc 15).

---

## Routing

App Router, file-based. One route group, two workspace subtrees.

```
app/
├── layout.tsx                 root — html, fonts, metadata, AppProviders
├── page.tsx                   / (landing, static)
├── error.tsx                  segment error boundary
├── global-error.tsx           root error boundary (its own <html>)
├── not-found.tsx              404
├── robots.ts · sitemap.ts · opengraph-image.tsx · icon.svg
├── (auth)/                    route group — URL has no /(auth)
│   ├── layout.tsx             centred card, brand mark
│   └── login · register · forgot-password · reset-password
├── onboarding/page.tsx        the 4-step wizard (one route, internal state)
├── app/                       BUSINESS_USER workspace
│   ├── layout.tsx             AppShell: sidebar, topbar, workforce rail
│   ├── page.tsx               redirect("/app/overview")
│   └── 13 pages + workforce/[key]
└── admin/                     PLATFORM_ADMIN workspace
    ├── layout.tsx             AppShell in admin mode
    ├── page.tsx               redirect("/admin/overview")
    └── 10 pages + businesses/[id]
```

Two dynamic segments: `app/app/workforce/[key]` (a `CapabilityKey`) and
`app/admin/businesses/[id]`.

`(auth)` is a route group — the parentheses keep it out of the URL while giving
the four auth pages a shared layout. `/login`, not `/auth/login`.

**Suspense boundaries.** Any page reading `useSearchParams()` must be wrapped in
`<Suspense>` or the App Router build fails. Two pages do:
`app/app/command/page.tsx` and `app/onboarding/page.tsx`. Both follow the same
shape — an outer default export that renders `<Suspense fallback={…}>` around the
real component. If you add a page that reads a query parameter, copy that
pattern.

---

## Provider tree

`components/providers/app-providers.tsx`, mounted once in the root layout:

```tsx
<ThemeProvider>
  <SessionProvider>
    <TooltipProvider delayDuration={220} skipDelayDuration={280}>
      {children}
      <Toaster />
    </TooltipProvider>
  </SessionProvider>
</ThemeProvider>
```

Order is load-bearing:

- `ThemeProvider` outermost, so the theme class is on `<html>` before anything
  paints.
- `SessionProvider` next, because everything below needs `businessId`.
- `TooltipProvider` and `Toaster` innermost — leaf concerns.

---

## SessionProvider — the centre of the application

`components/providers/session-provider.tsx`. Multi-tenancy lives here. Its own
comment states the design: *"`activeBusiness` decides which tenant's data every
screen requests, and a business user can only ever select from the workspaces on
their own session."*

Context value:

```ts
interface SessionContextValue {
  status: "loading" | "authenticated" | "unauthenticated";
  session: Session | null;
  user: User | null;
  businesses: Business[];
  activeBusiness: Business | null;
  activeBusinessId: string | undefined;
  vocabulary: BusinessVocabulary;
  isPlatformAdmin: boolean;
  signIn(email, password): Promise<AuthResult>;
  register({ name, email, password }): Promise<AuthResult>;
  signOut(): Promise<void>;
  setActiveBusiness(businessId): void;
  attachBusiness(business): void;      // called after onboarding
  refreshBusinesses(): Promise<void>;
}
```

Two consumer hooks: `useSession()` for identity, `useWorkspace()` for
`{ business, businessId, actorName, vocabulary }`. Pages use `useWorkspace()`
almost exclusively.

### Why the active business is a cookie, not localStorage

`ACTIVE_BUSINESS_COOKIE = "aibh-active-business"`, written by `writeCookie()`:

```ts
document.cookie =
  `${name}=${encodeURIComponent(value)}; path=/; max-age=${ACTIVE_BUSINESS_COOKIE_MAX_AGE}` +
  `; SameSite=Lax${secure}`;
```

The source comment gives the reason: *"kept in a cookie rather than localStorage
so the server can read it too — middleware and, from phase 03, server components
need to know which tenant to render without waiting for the browser to tell
them."*

That is the correct instinct. `localStorage` is invisible to the server, so a
server component could never know which tenant to render. `SameSite=Lax` and
`Secure` on HTTPS are both set. The cookie is **not** `HttpOnly` — deliberately,
since the client writes it — which is acceptable because it holds only a business
id whose access is independently enforced by RLS. It is a preference, not a
credential.

### The demo fallback

`MOCK_SESSION_KEY = "aibh.session.v1"` in `localStorage`, used only when no
Supabase project is attached. `readMockSession()` / `persistMockSession()` are
both wrapped in `try/catch` — correct, because `localStorage` throws in private
browsing and in some embedded contexts.

---

## Component organisation

62 components in 16 folders. The split is by role, not by page.

| Folder | Files | Contents |
| --- | --- | --- |
| `ui/` | 21 | Design-system primitives: `button`, `card`, `table`, `badge`, `dialog`, `sheet`, `select`, `tabs`, `input`, `skeleton`, `states`, `status`, `pagination`, `toaster`, `tooltip`, `popover`, `dropdown-menu`, `command`, `icon`, `primitives`, `toggle-controls` |
| `layout/` | 11 | `app-shell`, `sidebar`, `topbar`, `mobile-nav`, `business-switcher`, `command-palette`, `notifications`, `page-header`, `theme-toggle`, `user-menu`, `workforce-rail` |
| `command/` | 5 | `command-composer`, `workflow-panel`, `workflow-step-card`, `suggested-commands`, + 1 |
| `onboarding/` | 5 | `step-indicator`, `business-profile-step`, `capability-step`, `activation-step`, `success-step` |
| `landing/` | 4 | `sections`, `product-preview`, + 2 |
| `dashboard/` | 3 | KPI and attention widgets |
| `providers/` | 3 | `app-providers`, `session-provider`, `theme-provider` |
| `approvals/` | 2 | `approval-card`, `approval-drawer` |
| `activity`, `admin`, `appointments`, `brand`, `charts`, `customers`, `tables`, `workforce` | 1 each | Feature-specific |

`ui/primitives.tsx` and `ui/states.tsx` are worth knowing: the first holds small
shared bits, the second the empty/error/loading state components used across
every page, which is why those states are consistent.

### The variant pattern

Every UI primitive uses `class-variance-authority`:

```tsx
const buttonVariants = cva("inline-flex items-center …", {
  variants: {
    variant: { default: …, outline: …, ghost: …, destructive: … },
    size:    { sm: …, default: …, lg: …, icon: … },
  },
  defaultVariants: { variant: "default", size: "default" },
});
```

and `cn()` from `lib/utils.ts` (`clsx` + `tailwind-merge`) to merge caller
classes without conflict. `lib/utils.ts` has **92 importers — the hottest module
in the codebase.**

---

## Hooks

Four, all in `lib/hooks/`.

### `use-async.ts` — the data-fetching hook

Used by nearly every page. Signature:

```ts
useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options: { enabled?: boolean } = {},
): { data, loading, error, refetch, mutate }
```

Four details that make it work:

- **`enabled`** — pages pass `{ enabled: Boolean(businessId) }` so no fetch fires
  before the session resolves. When disabled it sets `loading = false` and
  returns early rather than leaving a permanent skeleton.
- **`fetcherRef.current = fetcher`** on every render, with the effect depending on
  `[enabled, nonce, ...deps]` — so an inline arrow function as the fetcher does
  not retrigger the effect. This is why call sites can write
  `useAsync(() => service.thing(id), [id])` without memoising.
- **`let cancelled = false`** with a cleanup that flips it — a resolved promise
  from an unmounted component never sets state.
- **`refetch()`** bumps a `nonce`; **`mutate()`** replaces `data` locally for an
  optimistic update with no round trip.

What it does **not** do: cache, dedupe, retry, or revalidate. Every mount is a
fresh call. The module comment names the intended replacement — *"when the
FastAPI backend arrives this can be swapped for React Query without touching call
sites, because the returned shape is the same."* See doc 25.

### `use-table-state.ts` — table interaction state

`{ search, page, pageSize, sortBy, sortDir, filters }` plus setters, shaped to
match `ListParams` in `api-client.ts` so it can be passed straight through. This
is why nine tables behave identically.

### `use-command-run.ts` — the run animator

Documented in full in `06_AGENT_EXECUTION_TRACES.md`. 167 lines, the most
intricate hook in the project: six phases, two refs for cancellation and
fast-forward, and a `for` loop that patches step statuses on timers.

### `use-media-query.ts`

A `matchMedia` subscription for the mobile navigation switch.

---

## Styling and theming

**Tokens as CSS custom properties.** `app/globals.css` defines `--background`,
`--foreground`, `--card`, `--border`, `--primary`, `--muted` and so on for light,
then redefines them under `.dark`. `tailwind.config.ts` maps Tailwind colour
names onto those variables, so `bg-background` resolves through the token.

Consequence: dark mode requires **no conditional classes anywhere**. Nothing in
the codebase reads the current theme to pick a colour. That is the whole reason
both themes stay consistent across 33 pages.

`next-themes` handles the class on `<html>` and the system preference, with
`suppressHydrationWarning` on the root element — required, because the server
cannot know the client's theme.

### Chart colours

`components/charts/chart-kit.tsx:31` exports the palette, and like every other
colour it goes through tokens:

```ts
export const SERIES_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))",
] as const;

export function seriesColor(index: number) {
  return SERIES_COLORS[index] ?? SERIES_COLORS[SERIES_COLORS.length - 1];
}
```

The values live in `app/globals.css`, light at `:root` (lines 55-59) and a
separate dark set under `.dark` (121-125) — **not lightened copies**, as the
comment there says, but a set chosen independently against the dark chart
surface:

| | light `hsl` | dark `hsl` |
| --- | --- | --- |
| `--chart-1` | `245 58% 51%` | `240 84% 69%` |
| `--chart-2` | `17 88% 40%` | `32 95% 44%` |
| `--chart-3` | `192 91% 37%` | `190 87% 39%` |
| `--chart-4` | `142 72% 29%` | `142 76% 36%` |
| `--chart-5` | `271 81% 56%` | `269 82% 64%` |

Validated against three criteria: ΔE ≥ 8 between adjacent series under simulated
colour-vision deficiency, ΔE ≥ 15 under normal vision, and ≥ 3:1 contrast against
the chart surface. The first attempt failed twice (a green/blue pair at ΔE 13.2
normal-vision; an amber at 2.7:1) before these values passed all six checks.

Two rules encoded in the module comment: colours are assigned **in fixed order
and never cycled**, and `seriesColor()` clamps rather than wrapping — a sixth
series reuses the fifth colour instead of silently colliding with the first. If
you need a sixth, re-run the validation rather than picking one by eye.

---

## Responsiveness

Mobile-first Tailwind breakpoints. Three structural behaviours:

| Width | Navigation |
| --- | --- |
| Desktop | Persistent sidebar, collapsible; state in `localStorage` |
| Tablet | Sidebar collapses to icons |
| Mobile | `mobile-nav.tsx` — a sheet triggered from the topbar |

Tables switch to card layouts on narrow screens rather than scrolling
horizontally.

---

## Accessibility

| Concern | Implementation |
| --- | --- |
| Semantics | Radix primitives supply roles, `aria-*` and focus management |
| Keyboard | Full tab order; the command palette is `Cmd/Ctrl+K`; dialogs and sheets trap focus |
| Focus visibility | A `focus-visible` ring token, never `outline: none` without a replacement |
| Labels | Every input has a `<label>` or `aria-label` |
| Status by colour alone | Avoided — `StatusDot` pairs a colour with text |
| Contrast | Tokens chosen for ≥ 4.5:1 body text |
| Reduced motion | `tailwindcss-animate`'s `motion-reduce` variants |

---

## Metadata and SEO

| File | Provides |
| --- | --- |
| `app/layout.tsx` | `metadata` — title template, description, Open Graph, Twitter card, `metadataBase` from `siteUrl()` |
| `app/robots.ts` | `robots.txt` — `allow: "/"`, `disallow: ["/app/", "/admin/", "/onboarding", "/reset-password", "/forgot-password"]`. The two password routes are excluded because a reset link in a search index would be a real leak |
| `app/sitemap.ts` | Public routes only |
| `app/opengraph-image.tsx` | Generated OG image |
| `app/icon.svg` | Favicon |

`siteUrl()` (`lib/config.ts`) resolves `NEXT_PUBLIC_SITE_URL`, then
`NEXT_PUBLIC_VERCEL_URL`, then `http://localhost:3000`.

---

## Server vs client components

89 of 152 files carry `"use client"`. The server components are the landing page,
the layouts, the redirect pages and the metadata routes.

**There is no server-side data fetching.** No page is an async server component;
no page reads Supabase during render. Everything fetches from the browser after
hydration, which is why every screen has a skeleton state. `lib/supabase/server.ts`
was written for exactly this purpose and has **no importer** — the server-render
path is built but unused.

The trade-off, stated honestly: the current approach means one round trip after
paint and no data in the initial HTML. Moving the workspace pages to server
components would remove the skeletons and cut a round trip, and the file to do it
with already exists.

---

## Related documents

- `12_DATA_FLOW.md` — how pages get their data
- `03_USER_WORKFLOWS.md` — every route and what it does
- `22_ERROR_HANDLING.md` — boundaries and states
- `25_PERFORMANCE_ARCHITECTURE.md` — bundle, caching, the missing memoisation
