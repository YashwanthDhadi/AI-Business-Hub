# 18 — Configuration

**No secret value appears in this document.** For anything sensitive, only the
variable name and its kind are given, as required.

---

## Where configuration lives

| File | Purpose | Committed? |
| --- | --- | --- |
| `lib/config.ts` | The single typed configuration surface for the app | Yes |
| `.env.example` | Template documenting every variable, all values blank | Yes |
| `.env.local` | Actual values for local development | **No** — gitignored, and `git ls-files` confirms only `.env.example` is tracked |
| `next.config.mjs` | Build behaviour + the build-time auth guard | Yes |
| `tsconfig.json` | TypeScript, `strict: true` | Yes |
| `tailwind.config.ts` | Design tokens mapped to CSS variables | Yes |
| `postcss.config.mjs` | Tailwind + autoprefixer | Yes |
| `eslint.config.mjs` | Flat config, `eslint-config-next` | Yes |
| `vitest.config.ts` | Test runner | Yes |
| `supabase/config.toml` | Supabase CLI project settings | Yes |
| `.github/workflows/ci.yml` | CI | Yes |

`lib/config.ts` states the design intent in its own header: *"Nothing in the UI
reads `process.env` directly, so connecting real services later is a change to
this file plus the service transport in `lib/services/api-client.ts`."*

That holds, with two exceptions worth knowing: `lib/supabase/config.ts` reads the
two Supabase variables directly (it has to — middleware runs before `lib/config`
would be useful there), and `next.config.mjs` reads them at build time.

---

## Every environment variable

### Mode

| Variable | Kind | Default | Read by |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_DATA_MODE` | `"mock"` \| `"api"` | `"mock"` | `lib/config.ts:22` → `DATA_MODE`, branched on in `api-client.ts:83` |
| `NEXT_PUBLIC_DEMO_MODE` | `"1"` or unset | unset | `next.config.mjs` only |

`NEXT_PUBLIC_DEMO_MODE=1` is the explicit acknowledgement that a build has no
Supabase project attached and is therefore guarded only in the browser. Never set
it on a deployment holding real data.

### FastAPI (reserved)

| Variable | Kind | Default | Read by |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | public URL | `""` | `config.api.baseUrl` — the second half of the `serve()` branch condition |

`config.api` also holds two hard-coded values: `prefix: "/api/v1"` and
`timeoutMs: 20_000`. Neither is environment-driven.

### Supabase

| Variable | Kind | Read by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public URL | `lib/supabase/config.ts`, `lib/config.ts`, `next.config.mjs` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public key, RLS-constrained | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret — bypasses all RLS** | **Nothing.** Only its *name* is stored, as `config.supabase.serviceRoleKeyEnvVar` |
| `SUPABASE_DB_URL` | secret connection string | Nothing in app code; used by CLI tooling |

`isSupabaseConfigured()` is the gate for everything auth-related:

```ts
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
}
```

Both checks are shape checks, not validity checks — an anon key of 21 wrong
characters passes. That is intentional: it distinguishes "configured" from
"blank", and a wrong key fails at the first API call.

### LLM (reserved, entirely unread)

| Variable | Kind | Read by any code? |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret / API key | **No** |
| `OPENAI_API_KEY` | secret / API key | **No** |
| `GOOGLE_API_KEY` | secret / API key | **No** |
| `LLM_SUPERVISOR_MODEL` | model name (non-secret) | **No** |
| `LLM_AGENT_MODEL` | model name (non-secret) | **No** |
| `LLM_FAST_MODEL` | model name (non-secret) | **No** |

The last three are documented in `.env.example` as *"model overrides (defaults
live in lib/config.ts)"*, but `config.ts` hard-codes the model strings and never
consults `process.env` for them. **Setting them today changes nothing.** Either
wire them up or remove the comment; recorded in doc 32.

### Messaging (reserved, unread)

| Variable | Kind |
| --- | --- |
| `WHATSAPP_API_KEY` | secret / API key |
| `WHATSAPP_PHONE_NUMBER_ID` | identifier (non-secret) |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | identifier (non-secret) |
| `TWILIO_ACCOUNT_SID` | identifier (non-secret) |
| `TWILIO_AUTH_TOKEN` | secret / token |
| `TWILIO_MESSAGING_SERVICE_SID` | identifier (non-secret) |
| `RESEND_API_KEY` | secret / API key |
| `RESEND_FROM_EMAIL` | address (non-secret) |

### Payments (reserved, unread)

| Variable | Kind |
| --- | --- |
| `RAZORPAY_KEY_ID` | identifier (non-secret) |
| `RAZORPAY_KEY_SECRET` | secret |
| `RAZORPAY_WEBHOOK_SECRET` | secret |
| `STRIPE_SECRET_KEY` | secret |
| `STRIPE_WEBHOOK_SECRET` | secret |

### Calendar, accounting, telephony (reserved, unread)

| Variable | Kind |
| --- | --- |
| `GOOGLE_CLIENT_ID` | identifier (non-secret) |
| `GOOGLE_CLIENT_SECRET` | secret |
| `GOOGLE_CALENDAR_REDIRECT_URI` | URL (non-secret) |
| `ACCOUNTING_API_KEY` | secret |
| `ACCOUNTING_ORG_ID` | identifier (non-secret) |
| `TELEPHONY_API_KEY` | secret |
| `TELEPHONY_WEBHOOK_SECRET` | secret |

### Site URL

| Variable | Kind | Read by |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | public URL | `siteUrl()` in `lib/config.ts` |
| `NEXT_PUBLIC_VERCEL_URL` | public URL | `siteUrl()` fallback |

```ts
export function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
```

Used by `metadataBase`, `robots.ts` and `sitemap.ts`. The trailing-slash strip
matters — a doubled slash in an Open Graph URL breaks link previews.

---

## The `NEXT_PUBLIC_` rule

Anything prefixed `NEXT_PUBLIC_` is **replaced with a literal string at build
time and shipped to every browser**. Two consequences, both important:

1. **Never give a secret that prefix.** There is no runtime protection; the value
   is in the JavaScript bundle, permanently, in every user's browser cache. Of
   the 30-odd variables above, exactly five carry the prefix and all five are
   public by design.
2. **Build-time inlining is why the auth guard can be erased at build.**
   `isSupabaseConfigured()` compiles to a constant. Build without the Supabase
   variables and `middleware.ts`'s guard becomes `if (true) return next()`. Fully
   explained in docs 14 and 15; `next.config.mjs` fails the build to prevent it.

---

## `config` object — full shape

```
config
├── dataMode                                        NEXT_PUBLIC_DATA_MODE
├── api
│   ├── baseUrl                                     NEXT_PUBLIC_API_BASE_URL
│   ├── prefix          "/api/v1"                   hard-coded
│   └── timeoutMs       20_000                      hard-coded
├── supabase
│   ├── url · anonKey                               NEXT_PUBLIC_SUPABASE_*
│   ├── serviceRoleKeyEnvVar  "SUPABASE_SERVICE_ROLE_KEY"   ← a NAME, not a value
│   └── schema          "public"
├── llm
│   ├── defaultProvider "anthropic"
│   ├── providers.{anthropic,openai,google}
│   │     label · apiKeyEnvVar · baseUrl · models{supervisor,agent,fast}
│   └── orchestration   maxSteps 12 · maxToolCallsPerStep 6
│                       temperature 0.2 · streaming true
├── integrations.{whatsapp,twilio,razorpay,stripe,googleCalendar,resend}
│         apiKeyEnvVar · baseUrl "" · enabled false
├── features
│   ├── voiceCommands       false
│   ├── attachments         true
│   ├── commandPalette      true
│   ├── multiTenantSwitcher true
│   └── simulatedLatency    true
└── mockLatency         min 220 · max 620
```

Plus `BRAND` (name, shortName, tagline, description, supportEmail) and two
functions, `isBackendConnected()` and `siteUrl()`.

### Which parts actually do something

| Section | Effect |
| --- | --- |
| `dataMode` | **Real** — decides the `serve()` branch |
| `api.baseUrl` | **Real** — the other half of that condition |
| `api.prefix`, `api.timeoutMs` | Used by `fetchFromApi()`, which never runs |
| `supabase.url`, `.anonKey` | **Real** — every auth call |
| `supabase.serviceRoleKeyEnvVar`, `.schema` | Display only |
| `llm.*` | **Display only** — rendered on two admin pages |
| `integrations.*` | **Display only** |
| `features.simulatedLatency` | **Real** — gates `randomLatency()` |
| `features.voiceCommands` | Display only |
| `features.attachments`, `.commandPalette`, `.multiTenantSwitcher` | Display only — the palette and switcher are always rendered regardless |
| `mockLatency` | **Real** |
| `BRAND` | **Real** — used throughout the UI and metadata |

The feature flags are worth being precise about: `commandPalette: true` does not
gate the command palette. `CommandPaletteProvider` is mounted unconditionally by
both workspace layouts — `app/app/layout.tsx:54` with `scope="business"` and
`app/admin/layout.tsx:40` with `scope="admin"`. The flag is read only by
`app/admin/settings/page.tsx` to draw a switch. Four of the five flags are
decorative; only `simulatedLatency` changes behaviour.

---

## npm scripts

```json
"predev":         "node scripts/clean-next-diagnostics.mjs",
"dev":            "next dev",
"build":          "next build",
"start":          "next start",
"lint":           "eslint .",
"lint:fix":       "eslint . --fix",
"typecheck":      "tsc --noEmit",
"test":           "vitest run",
"test:watch":     "vitest",
"verify":         "npm run typecheck && npm run lint && npm run test",
"db:start":       "supabase start",
"db:stop":        "supabase stop",
"db:reset":       "supabase db reset",
"db:test":        "supabase test db",
"db:diff":        "supabase db diff",
"db:lint":        "supabase db lint --level warning",
"seed:generate":  "tsx scripts/generate-seed.ts"
```

`npm run verify` is the one to run before committing — it is exactly what CI runs.

### `predev` and the OneDrive problem

`scripts/clean-next-diagnostics.mjs` runs automatically before `next dev`. It
exists for a specific Windows + OneDrive failure:

```
[Error: EINVAL: invalid argument, readlink
 '...\.next\diagnostics'] { errno: -4071, code: 'EINVAL', syscall: 'readlink' }
```

`next build` creates `.next/diagnostics`; OneDrive marks that folder read-only
(`attrib` shows `A R`), and the next `next dev` fails trying to read it as a
symlink. The script deletes the folder so `dev` after `build` works. It is a
workaround for the environment, not a project requirement — on Linux or outside a
synced folder it is a no-op.

### The `db:*` scripts have never run here

All six require either Docker (`supabase start`) or a linked remote project. This
machine has neither. The migrations have therefore **never been executed
locally** — CI is the only place they run. See doc 24.

---

## Configuration by environment

| Environment | `NEXT_PUBLIC_DATA_MODE` | Supabase | Notes |
| --- | --- | --- | --- |
| Local demo, no backend | `mock` | unset | Needs `NEXT_PUBLIC_DEMO_MODE=1` for a production build; auth is the localStorage mock |
| Local with Supabase | `mock` | set | Current state. Real auth, mock business data |
| Production, phase 02 | `mock` | set | Same as above, deployed |
| Production, phase 03+ | `api` | set | Needs `NEXT_PUBLIC_API_BASE_URL` and a running backend |

There is no per-environment config file, no `config.development.ts`, no
`NODE_ENV` branching outside `next.config.mjs`.

---

## Related documents

- `14_BACKEND_ARCHITECTURE.md` — the build-time guard
- `15_SECURITY_ARCHITECTURE.md` — secret handling
- `17_EXTERNAL_INTEGRATIONS.md` — what the reserved variables are for
- `24_DEPLOYMENT_ARCHITECTURE.md` — what must be set where
