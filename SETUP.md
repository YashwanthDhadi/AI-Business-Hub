# Setup — from a fresh clone to a working system

Follow this once, in order. It takes about 45 minutes, and **every service used
is free**. Nothing here needs a credit card.

When you reach the end, go to
[docs/guides/RUN-AND-TEST.md](docs/guides/RUN-AND-TEST.md) to start the project
and verify it works.

---

## What you are setting up

A multi-tenant platform where one chat agent serves a small business and its
customers, with eight capabilities (support, booking, customers, payments,
inventory, documents, communication, reports) that can be switched on per
business.

**You will need four free accounts.** All four have permanent free tiers.

| Service | What for | Where |
| --- | --- | --- |
| **Supabase** | Postgres database + file storage | <https://supabase.com> |
| **OpenRouter** | The model that answers customers | <https://openrouter.ai> |
| **Google AI Studio** | The supervisor that routes messages | <https://aistudio.google.com> |
| **Groq** | Voice → text (optional) | <https://console.groq.com> |

---

## 0. Prerequisites

| Tool | Version | Check with |
| --- | --- | --- |
| Python | 3.11 or 3.12 | `python --version` |
| Node.js | 20 or newer | `node --version` |
| Git | any recent | `git --version` |

> **Windows users:** the commands below are PowerShell. On macOS or Linux use
> `source .venv/bin/activate` instead of `.\.venv\Scripts\Activate.ps1`, and
> forward slashes in paths.

---

## 1. Clone and install

```powershell
git clone https://github.com/YashwanthDhadi/AI_Business_Hub.git
cd AI_Business_Hub
```

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

### Frontend

```powershell
cd frontend
npm install
cd ..
```

---

## 2. Supabase — the database

### 2.1 Create the project

1. Sign in at <https://supabase.com> → **New project**.
2. Name it anything. **Choose a region near you** — every query crosses it.
3. Save the database password somewhere. You will not need it for this project
   (everything goes through the API), but losing it is annoying later.
4. Wait for provisioning to finish, about two minutes.

### 2.2 Get the two values you need

**Settings → API**:

| Value | Where | Notes |
| --- | --- | --- |
| **Project URL** | `https://xxxxx.supabase.co` | Goes in both `.env` files |
| **service_role** key | Under "Project API keys" → reveal | **Secret.** Server only |
| **anon** key | Same page | Browser-safe by design |

> **The `service_role` key bypasses row level security.** It must never reach a
> browser, never go in a `NEXT_PUBLIC_` variable, and never be committed. In
> this project, tenant isolation is enforced by **application code** filtering
> `business_id` on every query — which is exactly why
> `scripts/check_tenant_isolation.py` exists.

### 2.3 Run the migrations — in order

Open **SQL Editor** in the Supabase dashboard. For each file in
`database/migrations/`, in numerical order:

1. Open the file in your editor.
2. Copy the whole thing.
3. Paste into a new SQL Editor query.
4. **Run**. Wait for success before starting the next one.

```
001_customer_support_agent.sql  businesses, customers, conversations, messages, knowledge
002_booking_agent.sql         appointments, the double-booking unique index
003_customers_agent.sql       customer_overview, notes, consent
004_payments_agent.sql        invoices, invoice_counters, the GST-safe numbering
005_inventory_agent.sql       inventory_items, movements, adjust_stock()
006_documents_agent.sql       documents, full-text search, the storage bucket
007_communication_agent.sql   campaigns, campaign_recipients
008_reports_agent.sql         report_daily, report_summary(), report_top_services()
```

**Order matters** — later files reference earlier tables.

> There is no Docker, no `psql`, and no connection string anywhere in this
> project. Migrations are deliberately files you paste into the dashboard, so
> you always see exactly what ran.

### 2.4 Check they all applied

```sql
select
  to_regclass('public.appointments')        as m002,
  to_regclass('public.customer_overview')   as m003,
  to_regclass('public.invoices')            as m004,
  to_regclass('public.inventory_overview')  as m005,
  to_regclass('public.documents')           as m006,
  to_regclass('public.campaigns')           as m007,
  to_regclass('public.report_daily')        as m008;
```

**Every column must be a name, not `null`.** A `null` means that migration did
not run — go back and run it.

### 2.5 Seed the demo business

Run `database/seed.sql` the same way. This creates
**Pulse Fitness Studio** with chat slug `pulse-fitness`, some services, and
knowledge articles — which is what every test script expects.

Then get its id, which you need for the frontend:

```sql
select id, name, chat_slug from public.businesses;
```

---

## 3. The API keys

### 3.1 OpenRouter — answers customers

1. <https://openrouter.ai> → sign in → **Keys** → **Create key**.
2. Copy it. It starts with `sk-or-v1-` and is shown once.

Free models are rate-limited (roughly 50 calls a day) and sometimes return 429
or 503. **The system is built for this** — it falls back and keeps working.

### 3.2 Google AI Studio — routes messages

1. <https://aistudio.google.com/apikey> → **Create API key**.
2. Copy it. It starts with `AIza`.

> **Privacy, stated plainly:** Google's free tier terms allow **human review of
> API input**. Messages are redacted before routing — phone numbers, emails and
> invoice numbers are stripped — but **redaction is not anonymisation**. Names
> and free text still pass through. Use synthetic data while developing, and
> move to a paid tier before handling real customer data.

### 3.3 Groq — voice to text (optional)

1. <https://console.groq.com/keys> → **Create API Key**.
2. Copy it. It starts with `gsk_`.

Skip this if you do not want voice input. Everything else works without it.

---

## 4. Environment files

**Neither file is ever committed.** Both are git-ignored; only the `.example`
templates are tracked.

### 4.1 Backend

```powershell
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your project URL from §2.2 |
| `SUPABASE_SERVICE_ROLE_KEY` | The **service_role** key |
| `OPENROUTER_API_KEY` | From §3.1 |
| `GOOGLE_API_KEY` | From §3.2 |
| `GROQ_API_KEY` | From §3.3, or leave blank |
| `IP_HASH_SALT` | Any long random string |
| `DASHBOARD_API_KEY` | Any long random string — **remember it**, the frontend needs the same one |

Generate the two random strings:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 4.2 Frontend

```powershell
cp frontend/.env.example frontend/.env.local
```

Fill in:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Same project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The **anon** key, not service_role |
| `HUB_DASHBOARD_KEY` | **Exactly** the `DASHBOARD_API_KEY` from `backend/.env` |
| `NEXT_PUBLIC_LIVE_BUSINESS_ID` | The business id from §2.5 |

> Variables prefixed `NEXT_PUBLIC_` are compiled into the browser bundle and are
> readable by anyone. `HUB_DASHBOARD_KEY` deliberately has no such prefix: the
> Next.js proxy at `src/app/api/hub/[...path]/route.ts` attaches it server-side,
> so the dashboard key never reaches a browser.

---

## 5. Start it

Two terminals.

```powershell
# Terminal 1 - backend
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn app.main:app --reload --port 8000
```

```powershell
# Terminal 2 - frontend
cd frontend
npm run dev
```

| Screen | URL |
| --- | --- |
| Customer chat | <http://localhost:3000/chat/pulse-fitness> |
| Owner dashboard | <http://localhost:3000/dashboard/customer-chat> |
| API docs | <http://127.0.0.1:8000/docs> |

---

## 6. Prove it works

In a third terminal:

```powershell
.\.venv\Scripts\Activate.ps1
cd backend

# 1. Is everything wired? 46 checks, ~25 seconds
python scripts\smoke_test.py

# 2. The offline test suite. 333 tests, ~5 seconds, no network
python -m pytest

# 3. The real database. 18 scripts, ~3 minutes
python scripts\run_all_checks.py
```

All three must end in `ALL PASS` / `333 passed`. If they do, your setup is
correct.

**Then open the chat and ask it something.** A real conversation is the last
check that nothing is subtly wrong.

Full testing instructions, including a browser walkthrough for each of the
eight agents, are in
[docs/guides/RUN-AND-TEST.md](docs/guides/RUN-AND-TEST.md).

---

## 7. If something goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| `SSL: UNEXPECTED_EOF_WHILE_READING` | Your network is intercepting `*.supabase.co` | Try a phone hotspot. **Not a code bug** |
| `Could not find the table ...` | A migration did not run | §2.4, then `notify pgrst, 'reload schema';` |
| `permission denied for function` | You used the **anon** key in `backend/.env` | Use **service_role** |
| `401 Missing or invalid X-Dashboard-Key` | The two keys do not match | `DASHBOARD_API_KEY` must equal `HUB_DASHBOARD_KEY` |
| Dashboard shows *Set NEXT_PUBLIC_LIVE_BUSINESS_ID* | Missing from `.env.local` | §4.2, then restart `npm run dev` |
| `EINVAL` from `next dev` | OneDrive, after a production build | `Remove-Item -Recurse -Force .next` |
| `Rate limit exceeded` / 429 | Free OpenRouter quota used | Resets around 05:30 IST. **Every test except the evals needs no model** |
| Every API call returns `Not Found` | Another app is on port 8000 | `curl.exe -s http://127.0.0.1:8000/openapi.json \| Select-String "AI Business Hub"` |
| `no business with chat_slug 'pulse-fitness'` | The seed did not run | §2.5 |

More in [docs/guides/RUN-AND-TEST.md §9](docs/guides/RUN-AND-TEST.md).

---

## 8. Rules worth knowing before you change anything

These are not style preferences. Each one has a test enforcing it, and several
have a bug in [docs/guides/BUGS.md](docs/guides/BUGS.md) behind them.

1. **Never commit a real key.** `backend/.env` and `frontend/.env.local` are
   git-ignored. `tests/security/` scans every committed file on every test run.
2. **The model never decides anything that matters.** Not whether a booking is
   confirmed, an invoice is paid, how much stock there is, or what anyone is
   allowed to do. The database decides those.
3. **The supervisor narrows authority. It never adds any.** What the agent may
   do is *requested ∩ business-enabled ∩ system-allowed*.
4. **Every query filters `business_id`.** The `service_role` key bypasses row
   level security, so one forgotten filter is a cross-tenant leak.
5. **Money and stock move only through dashboard routes**, never through a
   chat tool. A test asserts no agent tool is even *named* for such an action.
6. **Indian conventions everywhere** — ₹ with lakh grouping (`₹1,20,000`), IST,
   day-month-year, `+91 98765 00011`. Use the helpers; never `en-US`.
7. **If something is not wired, say so** — in the UI and in the docs. Do not
   fake it.
