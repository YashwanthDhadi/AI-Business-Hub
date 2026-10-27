# 14 — Backend architecture

## Status: there is no application backend

**No backend service exists in this repository.**

| Checked for | Found |
| --- | --- |
| FastAPI, Flask, Django, Express, Nest, Fastify | **None** |
| Any Python file | **None** — 0 `.py` files tracked |
| `requirements.txt`, `pyproject.toml`, `Pipfile` | **None** |
| Next.js route handlers (`app/**/route.ts`) | **None** — 0. There is no `app/api/` directory |
| Server actions (`"use server"`) | **None** |
| `Dockerfile`, `docker-compose.yml` | **None** |
| A `server/`, `api/` or `backend/` directory | **None** |

There is exactly **one** piece of code in this project that executes on a server
under this project's control: `middleware.ts`. Everything else runs either in the
browser or inside Supabase.

---

## What actually runs where

```
┌─────────────────────────── Browser ───────────────────────────┐
│  33 pages · 62 components · 4 hooks                           │
│  lib/services (66 paths)  →  serve()  →  lib/mock (in memory) │
│  SessionProvider  →  supabase-js  ─────────────────┐          │
└──────────────────┬─────────────────────────────────┼──────────┘
                   │ every request                    │
┌──────────────────▼──── Edge runtime (Vercel) ──┐    │
│  middleware.ts — the only server-side code     │    │
│    updateSession() → supabase.auth.getUser()───┼────┤
│    redirect or pass through                    │    │
└────────────────────────────────────────────────┘    │
                                                       │
┌────────────────────── Supabase (managed) ────────────▼────────┐
│  GoTrue (Auth)  ·  PostgREST  ·  Postgres + 50 RLS policies   │
│  Storage (1 bucket, 4 policies, unused)                       │
└───────────────────────────────────────────────────────────────┘
```

Supabase **is** the backend. Auth, the database, PostgREST and the policy engine
are all managed. What is missing is the layer that would sit between the browser
and Supabase — the one that would hold API keys, run the agent loop, and call
external services. That layer is what `config.api.baseUrl` is reserved for.

---

## The middleware — the only server-side code

`middleware.ts`, 68 lines. Read it in full; it is the security boundary of the
whole application.

```ts
export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const { response, user } = await updateSession(request);

  const role = (user?.app_metadata?.role as string | undefined) ?? "BUSINESS_USER";
  const isPlatformAdmin = role === "PLATFORM_ADMIN";
  const workspace = isPlatformAdmin ? "/admin/overview" : "/app/overview";

  if (isGuardedPath(pathname)) {
    if (!user) {
      const next = `${pathname}${request.nextUrl.search}`;
      return redirectWithSession(request, response, `/login?next=${encodeURIComponent(next)}`);
    }
    if (pathname.startsWith("/admin") && !isPlatformAdmin) {
      return redirectWithSession(request, response, "/app/overview");
    }
    if (pathname.startsWith("/app") && isPlatformAdmin) {
      return redirectWithSession(request, response, "/admin/overview");
    }
  }

  if (user && SIGNED_OUT_ONLY.includes(pathname)) {
    return redirectWithSession(request, response, workspace);
  }

  return response;
}
```

### Why it exists at all

The file comment states the problem it solved: *"Before phase 02 the guards lived
in the browser, which meant the workspace HTML was already on the wire by the
time the redirect fired. Anything the server rendered was readable by an
unauthenticated caller who ignored the redirect."*

A client-side guard is a suggestion. A caller using `curl` receives the HTML and
never runs the redirect. Middleware runs **before** any HTML is generated, so an
unauthenticated request to `/app/overview` gets a 29-byte 307 and nothing else.

### Four details that each prevent a specific failure

**1. `getUser()`, not `getSession()`.** From `lib/supabase/middleware.ts`'s
comment: *"getSession trusts the cookie; getUser validates it against the auth
server, which is the difference between a guard and a suggestion."* A forged or
expired cookie passes `getSession()`. This single choice is the guard.

**2. Cookies are carried onto redirects.** `redirectWithSession()` copies every
cookie from the `updateSession` response onto the `NextResponse.redirect`:

```ts
const redirect = NextResponse.redirect(url);
for (const cookie of source.cookies.getAll()) redirect.cookies.set(cookie);
```

Without this, a session refreshed during a redirect is dropped and the user is
signed out on the next hop. It is the most commonly missed part of the
`@supabase/ssr` contract.

**3. The role comes from `app_metadata.role`.** `app_metadata` is writable only by
the service role; `user_metadata` is writable by the user. Reading the wrong one
would let any user set `role: "PLATFORM_ADMIN"` on themselves and walk into the
admin workspace. The default is `"BUSINESS_USER"` — fail closed.

**4. The unconfigured escape hatch.** `if (!isSupabaseConfigured()) return
NextResponse.next()`. With no project attached the session lives in
`localStorage`, invisible to the server, so redirecting every visitor to sign-in
would make the demo unusable. This is a deliberate, documented downgrade — and it
is exactly what the build guard below exists to police.

### The matcher

```
"/((?!_next/static|_next/image|favicon.ico|icon.svg|opengraph-image|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"
```

A negative lookahead: everything except static assets and metadata routes. The
reason is cost — `updateSession()` makes a network call to Supabase, and running
it for every image request would be pure latency.

---

## The build-time guard — the subtlest thing in the repository

`next.config.mjs` throws and fails the build:

```
Refusing to build: Supabase is not configured.
```

unless either Supabase is configured or `NEXT_PUBLIC_DEMO_MODE=1` is set. The
reasoning, from the file's own comment:

> `NEXT_PUBLIC_*` values are inlined at build time, including inside middleware.
> That means whether the server-side route guard exists at all is decided when
> you build, not when you start.

This is the footgun. `isSupabaseConfigured()` reads `NEXT_PUBLIC_SUPABASE_URL`,
which Next replaces with a **literal string at build time**. Build with that
variable unset and the check compiles down to `if (false) …` — the guard is gone
from the artifact. Setting the variable later, at runtime, cannot bring it back.
The result would be a production deployment serving `/app` and `/admin` to
anyone, falling back to a browser redirect: the precise hole phase 02 closed.

Failing the build is the only way to make that impossible by accident. The demo
path is still allowed but must be explicit, and it prints a warning:

```
Demo build: no Supabase project attached, so /app and /admin are guarded
in the browser only. Do not expose this build to real business data.
```

Also in `next.config.mjs`, and worth keeping:

```js
reactStrictMode: true,
typescript: { ignoreBuildErrors: false },
eslint:     { ignoreDuringBuilds: false },
```

A type error or lint error fails the build. Both defaults would be tempting to
flip under deadline pressure; don't.

---

## `lib/supabase/` — the server-side module set

| File | Exports | Used? |
| --- | --- | --- |
| `config.ts` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `isSupabaseConfigured()`, `ACTIVE_BUSINESS_COOKIE`, `ACTIVE_BUSINESS_COOKIE_MAX_AGE`, `GUARDED_PREFIXES`, `isGuardedPath()` | Yes |
| `client.ts` | `getBrowserSupabase()` — memoised, returns `null` when unconfigured | Yes |
| `middleware.ts` | `updateSession()`, `redirectWithSession()` | Yes — by `middleware.ts` |
| `session.ts` | `roleFromUser()`, `loadSession()`, `touchLastActive()` | Yes |
| `businesses.ts` | `toBusiness()`, `fetchBusinesses()`, `fetchBusiness()`, `createBusinessForUser()`, `setCapabilityEnabled()`, `updateBusinessRow()` | Yes |
| **`server.ts`** | `getServerSupabase()`, `getServerUser()`, `getActiveBusinessId()` | **No — zero importers. Entirely unused** |

`server.ts` is the cookie-based server client for server components and route
handlers. It is written, typed and correct, and nothing calls it — because no
server component fetches data and no route handler exists. It is the file to
start from when building either.

`GUARDED_PREFIXES = ["/app", "/admin", "/onboarding"]`. The comment explains why
onboarding is in the list: *"it now writes real rows — a business, an owner
membership, capability configuration. Without a session there is nobody to
attribute them to, so the wizard would fail at the last step instead of at the
door."*

---

## What the future backend has to provide

The contract is already written. 66 paths in `lib/services/`, each with a method,
a path and a response type — see `04_API_REFERENCE.md`. The transport is
`fetchFromApi()` in `api-client.ts`, which is complete:

```ts
const response = await fetch(buildUrl(path, options.query), {
  method: options.method ?? "GET",
  headers: { "Content-Type": "application/json" },
  body: options.body ? JSON.stringify(options.body) : undefined,
  signal: options.signal ?? controller.signal,
});
```

Switching over is two environment variables:

```
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
NEXT_PUBLIC_DATA_MODE=api
```

**What `fetchFromApi()` does not do yet, and must:**

| Gap | Consequence |
| --- | --- |
| No `Authorization` header | The backend cannot identify the caller. The Supabase access token has to be attached |
| No tenant header | The backend cannot scope the request without parsing the path |
| No 401 handling | An expired token surfaces as a generic `ApiError`, not a re-auth |
| No retry | A transient failure is a visible error |

All four are additions to one function. None touches a component.

**Non-negotiables for whoever builds it:**

1. Execute queries **as the caller**, using their access token, so the 50 RLS
   policies apply. Using the service role would move tenant isolation from the
   database into application code — throwing away the strongest property this
   system has.
2. Never send `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` or any integration
   secret to the browser, and never give one a `NEXT_PUBLIC_` prefix.
3. Write one `activities` row per meaningful action. The table is append-only and
   the UI already reads it.
4. Wrap `createBusinessForUser()`'s four inserts in a transaction — a
   `security definer` PL/pgSQL function called via `rpc()`.

---

## Runtime, scaling, deployment

| Aspect | State |
| --- | --- |
| Middleware runtime | Edge (Vercel's default for `middleware.ts`) |
| Page rendering | Client components; static shells built at build time |
| Server-side rendering of data | None |
| Background jobs / cron / queue | **None.** See doc 16 |
| Websockets / SSE / realtime | **None.** Supabase Realtime is available and unused |
| Rate limiting | None |
| Caching (server) | None beyond Next's static output |
| Logging / metrics / tracing | None. No Sentry, no OpenTelemetry, no structured logging |
| Health check endpoint | **None** — no route handler exists to serve one |
| Horizontal scaling | Not applicable; there is nothing stateful to scale |

The absence of logging is the most consequential item on that list. When the
backend arrives, there is currently nowhere for an error to be recorded.

---

## Related documents

- `04_API_REFERENCE.md` — the 66-path contract
- `11_DATABASE_ARCHITECTURE.md` — what Supabase holds
- `15_SECURITY_ARCHITECTURE.md` — the guard as a security property
- `16_ASYNC_PROCESSING.md` — the missing scheduler
- `24_DEPLOYMENT_ARCHITECTURE.md` — how this gets deployed
