# Build guides

Hands-on, copy-paste build guides for AI Business Hub. Written for someone who
has never written FastAPI or React before. Every step tells you what to type,
what to paste, how to run it, how to test it, and what breaks.

> **Setting up for the first time? [SETUP.md](../../SETUP.md)** — keys, database,
> migrations, dependencies, in order.
>
> **Want to see how it works, or show someone? [HOW-IT-WORKS.md](HOW-IT-WORKS.md)**
> — the journey of one message, what each agent does, exactly what to type to
> watch each part work, and a 20-minute demo script.
>
> **Already built it? [RUN-AND-TEST.md](RUN-AND-TEST.md)** — the single document
> that starts the project and tests every agent: the five checks that explain
> most "it's broken" reports, every test command, what each layer proves, the
> multi-tenancy checks, a browser walkthrough per agent, and deliberate failure
> tests.
>
> **[TEST-REPORT.md](TEST-REPORT.md)** is the full testing round: every kind of
> testing carried out, the numbers (333 automated tests, 429 script assertions,
> 64% coverage), the five defects it found — and a plain list of what is **not**
> tested and why.
>
> **[BUGS.md](BUGS.md)** is the engineering log: eighteen real bugs, how each was
> found, and what it taught. Read it before the guides if you want the honest
> version of how this was built.

## Guide 1 — Customer Support Agent (STEP 1 → STEP 25)

The first agent. A business gets a public chat link like
`yourapp.com/chat/glow-salon`. Their customers open it, type or **speak**, and an
AI that knows that business answers them — with no account, no app install, and
no WhatsApp.

| File | Steps | What you end up with |
| --- | --- | --- |
| [customer-support-agent/00-setup-and-keys.md](customer-support-agent/00-setup-and-keys.md) | 1–2 | A fresh Supabase project, an OpenRouter key, and a Groq key for voice |
| [customer-support-agent/01-database.md](customer-support-agent/01-database.md) | 3–4 | Every table, full-text search, demo business seeded |
| [customer-support-agent/02-fastapi-foundation.md](customer-support-agent/02-fastapi-foundation.md) | 5–9 | A running API that reads and writes Supabase |
| [customer-support-agent/03-the-agent.md](customer-support-agent/03-the-agent.md) | 10–13 | An agent with real tools, testable from your terminal |
| [customer-support-agent/04-public-chat-api.md](customer-support-agent/04-public-chat-api.md) | 14–17 | Anonymous sessions, rate limits, the chat endpoint |
| [customer-support-agent/05-chat-ui.md](customer-support-agent/05-chat-ui.md) | 18–20 | The existing chat page wired to your real agent |
| [customer-support-agent/06-voice-input.md](customer-support-agent/06-voice-input.md) | 21–22 | Press-to-talk, speech-to-text, and the agent speaking back |
| [customer-support-agent/07-owner-dashboard.md](customer-support-agent/07-owner-dashboard.md) | 23–25 | The owner reads conversations, replies as a human, teaches the agent |
| [customer-support-agent/08-troubleshooting.md](customer-support-agent/08-troubleshooting.md) | — | Every error you are likely to hit, and the fix |

## Guide 2 — Booking Agent (STEP 26 → STEP 33)

The second agent, on the **same chat link, same model, same UI**. A customer asks
for a slot, gets real availability from your calendar, and the owner approves it.

| File | Steps | What you end up with |
| --- | --- | --- |
| [booking-agent/00-overview-and-database.md](booking-agent/00-overview-and-database.md) | 26–27 | `appointments`, a database-level double-booking guard, the repository |
| [booking-agent/01-tools-and-agent.md](booking-agent/01-tools-and-agent.md) | 28–30 | Four booking tools, and one agent carrying two capabilities |
| [booking-agent/02-owner-approval.md](booking-agent/02-owner-approval.md) | 31–33 | Approve/reject, the confirmation landing back in the customer's chat |
| [booking-agent/03-troubleshooting.md](booking-agent/03-troubleshooting.md) | — | Booking-specific errors, and when to add the supervisor |

Start it **only after Guide 1 works end to end.**

## Guide 3 — Customers Agent (STEP 34 → STEP 41)

The third capability, and a real client directory for the owner. The chat
assistant passes on what customers tell it ("prefers mornings", "interested in
yoga") and records "stop sending me offers". It can **add** to a customer record
and can **never read one back**, because anyone can type anyone's number into a
public chat. The rules live in the database. This guide also makes the whole app
Indian: ₹, lakh grouping, IST and `+91` numbers.

| File | Steps | What you end up with |
| --- | --- | --- |
| [customers-agent/00-overview-and-database.md](customers-agent/00-overview-and-database.md) | 34–35 | Consent and format rules in Postgres, append-only notes, a view that calculates status and spend |
| [customers-agent/01-tools-and-agent.md](customers-agent/01-tools-and-agent.md) | 36–38 | Two write-only tools, a third capability in the same loop, an honest answer when steps run out |
| [customers-agent/02-dashboard.md](customers-agent/02-dashboard.md) | 39–41 | The customers API, Indian formats everywhere, `/dashboard/customers` wired live |

Start it **only after Guide 2 works end to end.**

## Guide 4 — Payments Agent (STEP 42 → STEP 50)

The fourth capability. The owner bills a customer, the invoice lands in the
customer's chat, and the customer pays by **UPI**, with no gateway and no fees.
Invoice numbers follow Indian GST practice (`INV/2026-27/0001`, one unbroken
series per financial year) and are enforced by Postgres. **Only the owner can mark
anything paid**; the chat can only look up an invoice and pass on "I've paid".
No UPI ID is needed to build it. Add yours later: see
[Adding your UPI ID later](payments-agent/02-dashboard-and-pay-page.md#adding-your-upi-id-later).

| File | Steps | What you end up with |
| --- | --- | --- |
| [payments-agent/00-overview-and-database.md](payments-agent/00-overview-and-database.md) | 42–43 | Gapless numbering, immutable invoices, allowed status moves and one invoice per booking, all in Postgres |
| [payments-agent/01-tools-and-agent.md](payments-agent/01-tools-and-agent.md) | 44–46 | The UPI link, two read-and-report tools, a fourth capability in the same loop |
| [payments-agent/02-dashboard-and-pay-page.md](payments-agent/02-dashboard-and-pay-page.md) | 47–50 | The payments API, `/dashboard/payments` wired live, a public pay page with a real UPI QR code |

Start it **only after Guide 3 works end to end.**

## Guide 5 — The Supervisor (STEP 51 → STEP 57)

With four capabilities sharing one loop, every message was handed all 13 tools.
The supervisor reads the message first and chooses which capabilities answer it,
which also lets different capabilities run on different models.

**The rule:** it **narrows** authority and never adds any. Its answer is
intersected with what the business has switched on, so a bad answer — or a
customer trying to talk their way in — can only ever give the agent *fewer*
tools. Every failure falls back to how the system worked before it existed.

| File | Steps | What you end up with |
| --- | --- | --- |
| [supervisor/00-the-supervisor.md](supervisor/00-the-supervisor.md) | 51–57 | `get_model(purpose)`, the router, redaction, the duplicate-message fix, and "Answered by …" in the inbox |

## Guide 6 — Inventory Agent (STEP 58 → STEP 62)

Stock that cannot go below zero, proven with eight threads selling the last
items at once. The chat can check availability and never quotes an exact count.

| File | Steps | What you end up with |
| --- | --- | --- |
| [inventory-agent/00-inventory.md](inventory-agent/00-inventory.md) | 58–62 | A row-locking `adjust_stock()`, an append-only ledger, idempotent changes, a wired screen |

## Guide 7 — Documents Agent (STEP 63 → STEP 67)

Price lists and policies the assistant can quote. **Full-text search, not RAG** —
and the guide explains exactly when that choice should be revisited.

| File | Steps | What you end up with |
| --- | --- | --- |
| [documents-agent/00-documents.md](documents-agent/00-documents.md) | 63–67 | Ranked search, a private storage bucket with signed links, private-by-default publishing |

## Guide 8 — Communication Agent (STEP 68 → STEP 72)

One message to many customers, through the channel that is actually free: their
own chat thread. Nothing sends without the owner's approval, and one customer
gets one message per campaign however many times Send is pressed.

| File | Steps | What you end up with |
| --- | --- | --- |
| [communication-agent/00-communication.md](communication-agent/00-communication.md) | 68–72 | An approval gate in the database, a duplicate-send guard, honest channel limits |

## Guide 9 — Reports Agent (STEP 73 → STEP 76)

**SQL does the arithmetic; the model only describes the result.** No new tables:
a report is a question about data that already exists.

| File | Steps | What you end up with |
| --- | --- | --- |
| [reports-agent/00-reports.md](reports-agent/00-reports.md) | 73–76 | Daily views in the business's own timezone, summary functions, an optional written summary |

## What this first agent does — and deliberately does not

**Does:** answers questions about the business from a knowledge base the owner
controls, quotes real services and prices from the database, says when it does
not know, hands off to a human, and captures a name and number for a callback.

**Does not:** take bookings, take payments, check stock, or send invoices. Those
are the Booking, Payment, Inventory and Invoice agents. Booking (Guide 2),
Customers (Guide 3) and Payments with invoices (Guide 4) are now built. They reuse this exact
shape — same chat UI, same tool pattern, same approval gate — so building this
one properly makes each of the others a much smaller job.

Resist adding them early. One agent, working and tested, beats five half-agents.

## The architecture in one picture

```
  Customer's phone or laptop
        │  opens https://yourapp.com/chat/glow-salon
        │  types, or holds the mic button
        ▼
  Next.js chat page  (public, no login)
        │  POST /api/v1/chat/message      (text)
        │  POST /api/v1/chat/voice        (audio blob)
        ▼
  FastAPI
        │  ├── Groq Whisper   audio → text
        │  ├── OpenRouter     the agent: decides, calls tools, answers
        │  └── Supabase       knowledge base, services, transcript
        ▼
  Owner's dashboard  (logged in)
        reads every conversation, answers handoffs, adds knowledge
```

No third-party messaging provider. No webhooks. No tunnel. Nothing to get
approved. You own the whole channel, which is why this is a better first agent
than WhatsApp was.

## How each step is written

```
STEP X — NAME
  Goal            what we are doing, in plain words
  Why             why the project needs it
  Architecture    a small diagram when it helps
  Files involved  exactly which files to create or change
  Code            complete files, ready to copy-paste
  Explain         what the important lines actually do
  Commands        exact commands to type
  How to run      how to start it
  How to test     a specific test you can perform
  Expected result what you should see
  Common errors   what is likely to break and how to fix it
```

## One thing to know about the code in these guides

When a guide says **"complete file"**, that is the file **as it was at the end
of that guide** — not as it is today.

The guides are in build order, and later ones edit earlier files. For example
`app/agents/support_agent.py` appears complete in Guide 3, and Guides 5, 6 and 7
each add a capability to it. So:

- **Building from scratch?** Follow the guides in order and copy each "complete
  file" as you reach it. Each later edit is described where it happens.
- **Want the current code?** Open the repository. The guides explain *why* each
  line exists; the repository is what actually runs.

## Ground rules

1. **Never commit a secret.** Real keys live in `backend/.env` and
   `frontend/.env.local`. Both are already git-ignored. Only `.env.example`
   files get committed.
2. **One step at a time.** Each step's test must pass before you move on — it is
   ten times harder to debug five broken steps at once.
3. **Three terminals** from STEP 7 onward: FastAPI, Next.js, and one free for
   commands.
4. **When something breaks,** read the last 20 lines of the FastAPI terminal
   first. The answer is almost always there.
5. **The frontend already exists.** Parts 5-7 wire the existing screens in
   `frontend/src/` to your backend; they do not build a UI from scratch. There is
   no test runner - `npx tsc --noEmit` and `npm run lint` are the checks.

## Where everything ends up

```
AI_Business_Hub/
├── .venv/                  Python virtual environment (already created)
├── backend/                ← STEP 5 onward
│   ├── app/
│   │   ├── agents/         the agent and its tools
│   │   ├── channels/       speech-to-text
│   │   ├── repositories/   the only code that touches the database
│   │   ├── routers/        HTTP routes
│   │   └── services/       chat sessions, rate limiting
│   ├── scripts/            terminal test harnesses
│   ├── requirements.txt
│   ├── .env                your real secrets, git-ignored
│   └── .env.example        template, committed
├── database/
│   ├── migrations/         ← STEP 3
│   └── seed.sql            ← STEP 4
├── frontend/               already built (src/ layout, Next 16, Tailwind 4)
│                           STEP 18 onward wires it to the backend
└── docs/guides/            these files
```
