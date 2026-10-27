# 17 — External integrations

## Status: one real integration, eleven declared

**Supabase is the only external service this codebase actually calls.** Every
other integration exists as configuration and as a card in the admin UI.

| Service | Called by code? | Evidence |
| --- | --- | --- |
| **Supabase** (Auth, Postgres, Storage) | **Yes** | `@supabase/supabase-js`, `@supabase/ssr` in `dependencies`; real calls in `lib/supabase/*` |
| Anthropic | No | No SDK, no `fetch` to `api.anthropic.com` |
| OpenAI | No | Same |
| Google (Gemini) | No | Same |
| WhatsApp Business | No | `enabled: false`, blank `baseUrl` |
| Twilio | No | Same |
| Resend | No | Same |
| Razorpay | No | Same |
| Stripe | No | Same |
| Google Calendar | No | Same |
| Tally / Zoho Books | No | Not even in `config.integrations` |
| Voice telephony | No | Same |

**Zero HTTP requests leave the browser except to Supabase.** Verified: the only
`fetch` calls in the codebase are `fetchFromApi()` in `api-client.ts` (whose
branch never executes because `config.api.baseUrl` is empty) and whatever
`supabase-js` makes internally.

---

## The one real integration: Supabase

| Sub-service | Used | Where |
| --- | --- | --- |
| Auth (GoTrue) | **Yes** | `lib/services/auth-service.ts`, `lib/supabase/middleware.ts` |
| Postgres via PostgREST | **Yes**, 5 of 24 tables | `lib/supabase/session.ts`, `businesses.ts` |
| Row-level security | **Yes**, 50 policies | `supabase/migrations/*_rls.sql` |
| Storage | **No** | Bucket + 4 policies exist; nothing uploads |
| Realtime | **No** | Available, never subscribed |
| Edge Functions | **No** | No `supabase/functions/` directory |

Client construction, three variants:

```ts
lib/supabase/client.ts      createBrowserClient   — memoised, null when unconfigured
lib/supabase/server.ts      createServerClient    — cookie-based. NO IMPORTER
lib/supabase/middleware.ts  createServerClient    — the only server-side use that runs
```

Configured by `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, both
public by design; the anon key is safe to ship because RLS constrains it.

---

## `config.integrations` — declared, disabled

`lib/config.ts:83-90`. Six entries, each with the same three fields:

```ts
integrations: {
  whatsapp:       { apiKeyEnvVar: "WHATSAPP_API_KEY",              baseUrl: "", enabled: false },
  twilio:         { apiKeyEnvVar: "TWILIO_AUTH_TOKEN",             baseUrl: "", enabled: false },
  razorpay:       { apiKeyEnvVar: "RAZORPAY_KEY_SECRET",           baseUrl: "", enabled: false },
  stripe:         { apiKeyEnvVar: "STRIPE_SECRET_KEY",             baseUrl: "", enabled: false },
  googleCalendar: { apiKeyEnvVar: "GOOGLE_CALENDAR_CLIENT_SECRET", baseUrl: "", enabled: false },
  resend:         { apiKeyEnvVar: "RESEND_API_KEY",                baseUrl: "", enabled: false },
}
```

Every `baseUrl` is empty. Every `enabled` is `false`. `apiKeyEnvVar` holds the
**name** of the variable, not its value — the pattern described in doc 15.

Read by exactly one place: `app/admin/settings/page.tsx:191`, which iterates them
into a table of connection states.

Note the mismatch worth knowing: `.env.example` names `GOOGLE_CLIENT_SECRET`
while `config.ts` names `GOOGLE_CALENDAR_CLIENT_SECRET`. Neither is read by any
code, so nothing breaks today, but they disagree.

---

## `INTEGRATIONS` — the eleven admin cards

`lib/mock/platform.ts:155`. Eleven `Integration` objects rendered on
`/admin/integrations`. Every field is a literal.

| id | Name | Category | `status` | `businessesConnected` | `requiredKeys` |
| --- | --- | --- | --- | --- | --- |
| `int_whatsapp` | WhatsApp Business | messaging | connected | 214 | `WHATSAPP_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID` |
| `int_twilio` | Twilio SMS | messaging | connected | 138 | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| `int_resend` | Resend Email | messaging | connected | 176 | `RESEND_API_KEY` |
| `int_razorpay` | Razorpay | payments | connected | 152 | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| `int_stripe` | Stripe | payments | **disconnected** | 0 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `int_gcal` | Google Calendar | calendar | connected | 97 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `int_tally` | Tally / Zoho Books | accounting | **error** | 63 | `ACCOUNTING_API_KEY`, `ACCOUNTING_ORG_ID` |
| `int_supabase` | Supabase | storage | connected | 248 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `int_anthropic` | Anthropic | llm | connected | 248 | `ANTHROPIC_API_KEY` |
| `int_openai` | OpenAI | llm | **disconnected** | 0 | `OPENAI_API_KEY` |
| `int_telephony` | Voice telephony | messaging | **coming_soon** | 4 | `TELEPHONY_API_KEY` |

**`status: "connected"` is a string in a mock object.** It is not a health check.
`int_anthropic` reads "connected · 248 businesses · synced 1 minute ago" and no
Anthropic call has ever been made from this codebase. Anyone reading that page
without reading this document would conclude the opposite.

`requiredKeys` names only variables — correct, and never a value.

Also in `platform.ts`: `HEALTH_COMPONENTS`, six literal rows for `/admin/health`
(Platform API, AI orchestration, Database, Task queue, Messaging delivery,
Accounting sync), with 32-sample sparklines generated by `samples()` from the
seeded PRNG. No component is probed.

---

## Which integration each capability needs

The mapping is already declared in `lib/mock/capabilities.ts` as
`connectedTools`, and it is the specification for the send layer:

| Capability | Needs | For |
| --- | --- | --- |
| `customer_support` | WhatsApp, Resend, a knowledge base | Answering enquiries |
| `appointments` | Google Calendar, WhatsApp | Booking and confirming |
| `payment_followup` | Razorpay / Stripe, WhatsApp, Twilio | Payment links and chasing |
| `customer_followup` | WhatsApp, Twilio | Win-back messages |
| `communication` | WhatsApp, Twilio, Resend | All outbound drafting and sending |
| `reminders` | WhatsApp, Twilio, a scheduler | Scheduled nudges |
| `documents` | Resend, Supabase Storage, accounting | Invoice creation and delivery |
| `inventory` | A supplier channel | Purchase orders |
| `reports` | — | Reads only |

The `communication` capability is the one to build first: three of the four
approval-generating flows end in "send a message", and all three route through
it.

---

## What integrating for real requires

Not one of the integrations below has any code — no client, no request builder,
no response parser, no error mapping, no webhook receiver.

### Common to all of them

| Requirement | Why | Exists? |
| --- | --- | --- |
| A server to hold the key | Every one of these keys must never reach a browser | **No** — see doc 14 |
| A route handler or worker | To make the call | **No** |
| Retry with backoff | Networks fail | **No** |
| Idempotency keys | A retry must not double-send | **No** |
| Per-tenant credentials | Each business connects **its own** WhatsApp number | Table exists (`business_integrations`), unused and unseeded |
| Webhook receivers | Delivery receipts, inbound replies, payment confirmations | **No** — no route handler |
| Webhook signature verification | An unverified webhook is an open write endpoint | **No** — `*_WEBHOOK_SECRET` variables are reserved and unread |
| Audit rows per call | The product promises an audit record per AI action | Table exists, unused |

**The per-tenant point is the one most easily got wrong.** `config.integrations`
is a single global config — one WhatsApp key for the whole platform. But
`business_integrations` is per-tenant, and that is the correct model: Sri Lakshmi
Salon sends from its own number, not from a platform number. The schema is right
and the config is a placeholder.

### Per service

| Service | First thing to build | Note |
| --- | --- | --- |
| **Anthropic** | The supervisor loop | Doc 07's seam. Highest value, unblocks docs 05–09 |
| **WhatsApp Cloud API** | Send a template message; receive a webhook | Requires a Meta Business account and template approval — the longest lead time of any integration here |
| **Twilio** | SMS send | Simplest to prove end to end |
| **Resend** | Transactional email | Needs a verified sending domain |
| **Razorpay** | Payment-link creation + webhook | India-first, matches the `INR` default and the "pay by UPI" message templates |
| **Stripe** | Same, for international | Already `disconnected` in the mock, honestly |
| **Google Calendar** | OAuth consent, then two-way sync | Per-tenant OAuth, not an API key — the only one needing a full consent flow |
| **Accounting** | Push issued invoices | The mock shows this in `error` state, which is realistic |
| **Telephony** | Inbound call answering | The Voice Agent has `provider: "unassigned"`; genuinely not started |

---

## Related documents

- `07_LLM_ARCHITECTURE.md` — the Anthropic seam
- `09_TOOL_ARCHITECTURE.md` — the send-side tools that need these
- `14_BACKEND_ARCHITECTURE.md` — where the keys would live
- `16_ASYNC_PROCESSING.md` — the worker that would call them
- `18_CONFIGURATION.md` — every variable, by name
