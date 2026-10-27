# AI Business Hub

**One AI workforce, configured per business.**

## Live links

| What | URL |
| --- | --- |
| Frontend (Vercel) | https://ai-business-hub-pcd5.vercel.app |
| Demo customer chat | https://ai-business-hub-pcd5.vercel.app/chat/fitzone |
| Backend health (Render) | https://ai-business-hub-2guw.onrender.com/health |
| API docs (Render) | https://ai-business-hub-2guw.onrender.com/docs |

> The backend runs on Render's free tier and sleeps when idle. The first
> request can take up to a minute while it wakes up.

## Which LLMs, and for what

| Job | Provider | Model | Why |
| --- | --- | --- | --- |
| Routing: picks which capabilities a message needs | Google AI Studio | `gemini-3.5-flash-lite` | Fast, returns small JSON, separate free quota from chat |
| Chat agent: answers the customer and calls tools | OpenRouter | `google/gemma-4-31b-it:free` | Free tier, supports tool calling |
| Chat fallbacks, used if the main model is rate-limited | OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free`, `nex-agi/nex-n2.5-pro:free`, `openrouter/free` | Keeps chat working when the free tier limits the main model |
| Voice: speech-to-text | Groq | `whisper-large-v3-turbo` | Free, fast transcription |

The models only *suggest* what to do. Application code decides what is
allowed, and the database is the source of truth.

## Supabase schema

The full schema is plain SQL in [`database/migrations/`](database/migrations/)
(`001` to `008`, applied in order), with demo data in
[`database/seed.sql`](database/seed.sql).

A multi-tenant AI platform for small Indian businesses: salons, gyms, retail
shops, clinics and coaching centres. A customer opens a chat link, types or
speaks, and an assistant that knows *that* business answers with its prices,
policies, free slots and stock. The owner gets a dashboard where every
sensitive action waits for their approval.

**Everything runs on free tiers.** No credit card, no paid service, no Docker.

| I want to… | Go to |
| --- | --- |
| Set it up from a fresh clone (~45 min) | **[SETUP.md](SETUP.md)** |
| Start it and test every agent | **[docs/guides/RUN-AND-TEST.md](docs/guides/RUN-AND-TEST.md)** |
| See how one message travels the system | **[docs/guides/HOW-IT-WORKS.md](docs/guides/HOW-IT-WORKS.md)** |
| Learn how each agent was built, step by step | **[docs/guides/](docs/guides/README.md)** |

---

## Contents

- [How it works](#how-it-works)
- [The eight capabilities](#the-eight-capabilities)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Repository structure](#repository-structure)
- [Security model](#security-model)
- [Testing](#testing)
- [Project status](#project-status)
- [Documentation](#documentation)

---

## How it works

```
Customer types a message
   → Supervisor classifies it into capabilities          (Gemini, free tier)
      → narrowed to what THIS business has enabled       ← the security boundary
         → one agent loop with only those tools          (OpenRouter, free tier)
            → tools read and write the database          (Supabase)
               → anything irreversible stops for the owner
                  → owner approves in the dashboard
                     → the customer is told, in their chat
```

Three sentences govern the whole design:

> **The LLM** decides what it *thinks* should happen.
> **Application code** decides whether it is *allowed* to happen.
> **The database** decides what is *actually true*.

---

## The eight capabilities

There is one agent loop. Capabilities are rows in a table, not separate
services. Adding one takes a migration, a tools module, a prompt block and one
line in `compose_tools()`.

| Capability | What it does | Reachable from chat? |
| --- | --- | --- |
| **Customer support** | Answers from the business's own knowledge base | Yes |
| **Booking** | Offers free slots, takes a booking *request* | Yes |
| **Customers** | Remembers notes, records marketing opt-**out** | Yes |
| **Payments** | Looks up an invoice, records a payment *claim* | Yes |
| **Inventory** | Says whether something is in stock | Yes |
| **Documents** | Quotes a published policy, with its source | Yes |
| **Communication** | Drafts and sends campaigns | **Owner only** |
| **Reports** | Revenue, bookings, collections | **Owner only** |

With everything switched on, a chat agent has **15 tools**. None of them can
confirm a booking, mark an invoice paid, move stock or send a message. Those
actions run only through dashboard routes, under the owner's control.

Communication and reports are kept out of `OPTIONAL_CAPABILITIES` entirely, so
the supervisor cannot route to them even if the model asks. A customer can
never message everyone else, or ask what the business earned.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | FastAPI, Python 3.12 | Python-first AI tooling; keys stay server-side |
| Database | Supabase (Postgres) | Free tier, SQL Editor migrations, file storage |
| Frontend | Next.js 16, TypeScript, Tailwind 4 | App Router, `src/` layout |
| Chat model | OpenRouter free models | With fallbacks |
| Router model | Google AI Studio (Gemini) | Separate quota from the chat model |
| Voice | Groq Whisper | Free speech-to-text |
| Payments | UPI deep links + QR | No gateway, no fees |

**No Celery, Redis, queues, workers, vector database or RAG.** A small business
has tens of documents, not millions. Postgres full-text search answers "what
does the refund policy say?" in one query, with nothing extra to run or pay for.

---

## Quick start

First-time setup (accounts, keys, migrations, env files) is in
**[SETUP.md](SETUP.md)**. Once that is done:

```powershell
# Terminal 1 — backend (from the repo root)
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn app.main:app --reload --port 8000     # API docs: http://127.0.0.1:8000/docs

# Terminal 2 — frontend
cd frontend
npm run dev                                   # http://localhost:3000
```

---

## Repository structure

```
AI_Business_Hub/
├── backend/                  FastAPI service                 → backend/README.md
│   ├── app/
│   │   ├── agents/           supervisor (routing), support_agent (the one loop), llm
│   │   │   └── tools/        one module per capability
│   │   ├── channels/         speech-to-text
│   │   ├── repositories/     every database read and write; all filter business_id
│   │   ├── routers/          public chat, pay page, owner dashboard
│   │   └── services/         chat sessions, formatting, payments, rate limiting
│   ├── scripts/              terminal harnesses against the real database
│   └── tests/                pytest: unit, contract, security
│
├── frontend/                 Next.js app                     → frontend/README.md
│   └── src/
│       ├── app/              /chat/[businessSlug], /pay/[token], /dashboard/*, /admin/*
│       ├── features/         components for each screen
│       ├── components/       shared UI, navigation, charts
│       ├── lib/              API client, formatting, constants
│       └── types/            shared TypeScript types
│
├── database/                 Postgres schema                 → database/README.md
│   ├── migrations/           001–008, applied in order in the Supabase SQL Editor
│   └── seed.sql              the demo business, Pulse Fitness Studio
│
├── docs/
│   ├── guides/               build guides, run-and-test, test report, bug log
│   ├── report/               project report (.docx) and presentation (.pdf)
│   └── archive/              superseded documents, kept for history
│
├── SETUP.md                  first-time setup
└── .github/workflows/        CI
```

---

## Security model

Each point below has a test enforcing it. Read this before changing anything.

**Multi-tenancy is enforced in code, not by RLS.** The backend uses Supabase's
`service_role` key, which bypasses row-level security by design. So every
repository function filters `business_id`, and several tables carry a composite
foreign key `(id, business_id)` so the database refuses a cross-tenant row even
if the Python is wrong. `scripts/check_tenant_isolation.py` proves it with 49
checks that verify the **data returned**, not just status codes.

**The supervisor narrows authority and never adds any.** What the agent may do
is *requested ∩ business-enabled ∩ system-allowed*. Even if an injection
completely fools the model into asking for every capability, the intersection
removes them. The model's output is a **request, never a grant**.

**The model never invents** payment status, customer records, stock quantity,
booking availability, invoice numbers, permissions or configuration. Each comes
from a tool, and each has a test.

**Privacy, stated plainly.** Messages are redacted before routing: phone
numbers, emails and invoice numbers are stripped. But **redaction is not
anonymisation**. Names and free text still pass through, and Google's free-tier
terms allow human review of API input. Use synthetic data while developing.

---

## Testing

```powershell
cd backend
python -m pytest                      # 333 tests, ~5s, no network
python scripts\smoke_test.py          # 46 checks: "is it alive?"
python scripts\run_all_checks.py      # 18 scripts, 429 assertions, ~3 min

cd ..\frontend
npx tsc --noEmit                      # typecheck
npm run lint
```

| Layer | Count | Result |
| --- | --- | --- |
| Unit | 177 | pass |
| Contract (API) | 120 | pass |
| Security | 36 | pass |
| Integration (real database) | 18 scripts / 429 assertions | pass |
| Multi-tenancy isolation | 49 assertions | pass |
| Agent behaviour eval (real model) | 10 cases | pass, **one run** |
| Performance baseline | 9 endpoints | within budget |

**64% combined coverage.** Full numbers, every kind of testing done, and what
is **not** tested are in **[TEST-REPORT.md](docs/guides/TEST-REPORT.md)**.

---

## Project status

| Area | State |
| --- | --- |
| Public chat (text + voice), session resume, rate limiting | Working |
| Owner inbox, takeover, replies | Working |
| Bookings with database-enforced no-double-booking, owner approval | Working |
| Customers, notes, consent, calculated status | Working |
| Invoices with gapless GST-safe numbering, UPI deep links + QR, public pay page | Working |
| Inventory with row-locked stock, append-only ledger, idempotent adjustments | Working |
| Documents with Postgres full-text search, private storage, signed URLs | Working |
| Campaigns with approval gate and no-double-send | Working |
| Reports computed in SQL, with an optional plain-language summary | Working |
| Supervisor routing with narrowing and universal fallback | Working |

**Not built on purpose.** The screens say so rather than faking these:

- SMS and WhatsApp: no free tier exists
- PDF text extraction: upload and download work; paste the text to make it quotable
- GST calculation and PDF invoices
- Automatic payment confirmation: plain UPI cannot notify anyone
- Merging duplicate customers

**Known gaps:** the screens have been tested by hand on the live deployment,
but there are no automated component or end-to-end browser tests; agent repeatability has not been
measured because the free tier rate-limited every attempt; and no real UPI
payment has ever been made.

---

## Documentation

| Document | What it covers |
| --- | --- |
| [SETUP.md](SETUP.md) | First-time setup: accounts, keys, migrations, env files |
| [docs/guides/HOW-IT-WORKS.md](docs/guides/HOW-IT-WORKS.md) | How a message travels the system, what to ask each agent, a 20-minute demo script |
| [docs/guides/RUN-AND-TEST.md](docs/guides/RUN-AND-TEST.md) | Start the project; test every agent, by script and by hand |
| [docs/guides/TEST-REPORT.md](docs/guides/TEST-REPORT.md) | Every kind of testing, the numbers, and the gaps |
| [docs/guides/BUGS.md](docs/guides/BUGS.md) | Eighteen real bugs: symptom, cause, how it was found, lesson |
| [docs/guides/](docs/guides/README.md) | How each agent was built, step by step, with full code |
| [docs/report/](docs/report/) | Project report and presentation |

Every step in the build guides has a goal, the reasoning, complete code, exact
commands, expected output and a table of likely errors. [BUGS.md](docs/guides/BUGS.md)
is the honest record of how the project was built, including the five bugs that
were in the **tests** rather than the code.
