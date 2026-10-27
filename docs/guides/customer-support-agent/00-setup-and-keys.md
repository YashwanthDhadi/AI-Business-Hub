# Part 0 — Setup and keys (STEP 1 → STEP 2)

Three accounts. All free, none needs a card. This part is short because dropping
WhatsApp removed three quarters of the setup work: no Meta app, no business
verification, no phone-number allow-list, no ngrok tunnel.

At the end you will have a handful of values in a scratch file. Part 2 pastes
them into `backend/.env`.

```
What we are setting up and why

  Supabase    →  the database. Businesses, knowledge, conversations, transcripts.
  OpenRouter  →  the agent's brain. One key in front of hundreds of models,
                 so a model going away is a one-line change, not a rebuild.
  Groq        →  the agent's ears. Free Whisper, for the microphone in Part 6.
                 Not needed until then.
```

That is the whole list. Everything else runs on your laptop.

---

## STEP 1 — Create a fresh Supabase project

### Goal

Create a brand-new, empty PostgreSQL database in the cloud, and copy the three
credentials your backend needs.

### Why?

Every piece of data lives here: which businesses exist, what the agent knows
about each of them, every chat message a customer ever sends, and every handoff
the owner has to deal with.

Supabase is PostgreSQL with a web dashboard, an auth system and an HTTP API
bolted on. You get all three free.

### Architecture

```
FastAPI  ──HTTPS──►  Supabase API  ──►  PostgreSQL
                          │
                          └── Row Level Security decides which rows are visible
```

### Files involved

None yet. Browser only.

### What to click

1. Go to <https://supabase.com> and sign in (GitHub login is fastest).

2. **Delete the old project** if you still have one from an earlier attempt:
   **Project Settings** (gear, bottom left) → **General** → scroll down →
   **Delete project** → type the name → confirm. Keeping it costs nothing
   either; the free plan allows two.

3. Click **New project**.
   - **Name:** `ai-business-hub`
   - **Database Password:** click *Generate a password* and **save it
     immediately**. You cannot see it again. This guide never needs it (we use
     the API, not a direct Postgres connection), but a SQL client would.
   - **Region:** the one physically closest to you. For India choose
     `South Asia (Mumbai)`. A far region adds 200–400 ms to *every* database
     call, and your agent makes several per message. On a live chat that is the
     difference between snappy and sluggish.
   - **Pricing plan:** Free.
   - **Create new project**, then wait ~2 minutes.

4. When it is green, open **Project Settings → API**. Copy three values into a
   scratch text file:

   | What the dashboard calls it | What we will call it | Looks like |
   | --- | --- | --- |
   | Project URL | `SUPABASE_URL` | `https://abcdefgh.supabase.co` |
   | `anon` `public` key | `SUPABASE_ANON_KEY` | a long `eyJhbGciOi...` string |
   | `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` | another long `eyJhbGciOi...` string |

   > **Newer dashboards** show **Publishable key** (`sb_publishable_...`) and
   > **Secret keys** (`sb_secret_...`) instead, with the old names under a
   > **Legacy API keys** tab. Either format works. Use publishable-or-anon
   > wherever this guide says `SUPABASE_ANON_KEY`, and secret-or-service_role
   > wherever it says `SUPABASE_SERVICE_ROLE_KEY`.

### Explain the two keys

The most important security idea in the project, so read it twice:

- **`anon` key** — safe in a browser. Every request made with it is filtered by
  **Row Level Security (RLS)**: Postgres itself checks, row by row, whether the
  caller may see that row. A stolen anon key gets an attacker nothing new.

- **`service_role` key** — **bypasses RLS completely.** Every row in every
  table, no questions asked. If it leaks, every business's data leaks.

  Rules: `backend/.env` only. Never in `frontend/`. Never in a `NEXT_PUBLIC_*`
  variable. Never pasted into a chat, a screenshot, or a commit.

Our FastAPI backend uses `service_role`, because it answers messages from
customers who are not logged in at all — an anonymous visitor has no Supabase
identity for RLS to check.

That makes **tenant isolation the backend's job**, which is why every repository
function in STEP 9 takes a `business_id` and filters on it. RLS stays switched on
as the second line of defence for anything that reaches Postgres with a real
user's token.

This matters more here than it did with WhatsApp. A public chat endpoint is
reachable by anyone on the internet, so "which business is this request allowed
to touch?" has to be answered on every single call.

### How to test

Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**:

```sql
select current_database(), version();
```

### Expected result

One row: database `postgres`, and a `PostgreSQL 15.x` or `17.x` version string.

### Common errors

| What you see | What it means | Fix |
| --- | --- | --- |
| Stuck on "Setting up project" >5 min | Provisioning hiccup | Refresh. After 10 min, delete and recreate in another region. |
| "Free plan limit reached: 2 active projects" | Two already exist | Delete or pause one (Settings → General → Pause project). |
| Cannot find `service_role` | Newer dashboard | Settings → API → **Legacy API keys**, or use the `sb_secret_...` key. |

---

## STEP 2 — Get an OpenRouter key (and keep Groq for voice)

### Goal

One key for the agent's brain, and one for its ears.

| Job | Provider | Why |
| --- | --- | --- |
| Chat + tool calling | **OpenRouter** | One key, hundreds of models, free tiers, and you can switch model without changing code |
| Speech to text | **Groq** | Free Whisper, and very fast |

### Why two providers?

An earlier version of this guide used Groq for both. That works right up until the
chat model you want is not available on your account — Groq gates some models,
and you get `model_not_found` or a 403 with no way to fix it from your side.

OpenRouter solves that by being a **router**: it sits in front of dozens of
providers and exposes them all through one OpenAI-compatible API. If a model
disappears or rate-limits you, you change one line in `.env` and carry on. No new
account, no new key, no code change.

Groq stays for Whisper because its speech endpoint is free, fast and unrestricted —
and transcription needs no tool calling, so none of the above applies to it.

### The one requirement that matters: tool calling

Your agent is not a chatbot. It must be able to emit a structured function call
like `search_knowledge(query="freeze membership")` so your Python can run it
against Supabase. That capability is called **tool calling**, and **most free
models do not have it.**

This is the single most common way to waste an afternoon here. A model without
tool support does not error — it just writes a chatty sentence and ignores your
tools, so the agent invents prices instead of looking them up.

You do not have to guess. STEP 10 gives you a script that asks OpenRouter which
models support tools, and a `--test` flag that sends a real tool call to prove
it. Run those before you build anything on top.

### Architecture

```
  customer types                    customer speaks
        │                                 │
        │                         audio blob (webm/mp4)
        │                                 ▼
        │                   Groq Whisper   whisper-large-v3-turbo
        │                                 │
        │                              text
        ▼                                 ▼
        └────────────►  the agent  ◄──────┘
                            │
             OpenRouter  →  a tool-capable model
                            │
                          reply
```

### What to click — OpenRouter

1. Go to <https://openrouter.ai> and sign in (Google or GitHub is fastest).
2. Open **Keys** (<https://openrouter.ai/keys>) → **Create Key**.
3. Name it `ai-business-hub-dev`. Leave the credit limit blank.
4. **Copy it now.** It looks like `sk-or-v1-XXXXXXXX...` and is shown once.
   Save it as `OPENROUTER_API_KEY`.

5. **Check your privacy settings** — this one catches people out.
   Open <https://openrouter.ai/settings/privacy>. Free models are served by
   providers that may log prompts, and if your settings forbid all of them you
   get `No allowed providers are available for the selected model` on every
   request, which reads like a broken key.

   For development, enable free/training-permitted providers. For real customer
   data later, turn them off and pay for a private model — a support chat carries
   other people's phone numbers, so that is a decision worth making deliberately.

6. Pick a model. Do **not** copy one from a blog post; catalogues change monthly.
   Browse <https://openrouter.ai/models?supported_parameters=tools&max_price=0>,
   or just take the default in the guide and verify it in STEP 10.

   Save it as `LLM_MODEL`, exactly as OpenRouter writes it, including the
   `:free` suffix if there is one:

   ```
   LLM_MODEL=qwen/qwen3.8-27b:free
   ```

### What to click — Groq (voice only)

1. Go to <https://console.groq.com> and sign in.
2. **API Keys** → **Create API Key** → name it `ai-business-hub-stt`.
3. Copy it — `gsk_XXXXXXXX...` — and save it as `GROQ_API_KEY`.
4. Note the speech model id from <https://console.groq.com/docs/speech-to-text>.
   `whisper-large-v3-turbo` is the right default: nearly as accurate as the full
   model, several times faster, and multilingual — which the English-only
   `distil-whisper` variant is not, and you will have customers mixing English
   with Hindi or Telugu.

If you already have a Groq key from an earlier attempt, keep it. Nothing about
the key was the problem; only the chat model was.

**You can skip Groq entirely for now.** It is not needed until Part 6. The
backend treats it as optional and will start without it.

### Free-tier limits, honestly

OpenRouter's free models are genuinely free, with real caps:

- about **20 requests per minute**
- a **daily cap** that is low on a brand-new account and rises substantially
  once you have ever bought credits

Your agent makes 2–3 model calls per customer message (one to decide the tool,
one to answer). So a low daily cap translates to roughly 15–25 customer
conversations a day — fine for building and demoing, not enough for a real
business.

When that starts to pinch, the fix is cheap rather than free: a small, capable
model on OpenRouter costs a fraction of a rupee per conversation. Nothing in the
code changes — you edit `LLM_MODEL`.

### How to test

Test the OpenRouter key:

```powershell
curl.exe -s https://openrouter.ai/api/v1/auth/key -H "Authorization: Bearer sk-or-v1-PASTE_YOUR_KEY"
```

Test the Groq key (only if you set one up now):

```powershell
curl.exe -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer gsk_PASTE_YOUR_KEY" | Select-String "whisper"
```

### Expected result

OpenRouter returns your key's status, something like:

```json
{"data":{"label":"ai-business-hub-dev","usage":0,"limit":null,"is_free_tier":true,"rate_limit":{"requests":20,"interval":"10s"}}}
```

`"is_free_tier":true` is expected and fine.

Groq returns lines containing `whisper-large-v3-turbo`.

### Common errors

| What you see | What it means | Fix |
| --- | --- | --- |
| `{"error":{"message":"No auth credentials found"}}` | Key wrong or missing | OpenRouter keys start with `sk-or-v1-`. Regenerate at openrouter.ai/keys. |
| `User not found` | You pasted the key *name* instead of the key | Copy the long `sk-or-v1-...` value. |
| `curl` behaves oddly in PowerShell | PowerShell aliases `curl` to `Invoke-WebRequest` | Always type `curl.exe` on Windows. |
| No whisper model listed | Audio models not enabled on your Groq account | Everything except Part 6 works without it. |
| You cannot decide on a model | Normal — the catalogue is large | Take the guide's default and run the STEP 10 checker. |

---

## End of Part 0 — checklist

Your scratch file should hold five values:

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

OPENROUTER_API_KEY=sk-or-v1-...
LLM_MODEL=qwen/qwen3.8-27b:free
LLM_BASE_URL=https://openrouter.ai/api/v1

GROQ_API_KEY=gsk_...            (optional until Part 6)
GROQ_STT_MODEL=whisper-large-v3-turbo
```

- [ ] A Supabase project that answers a SQL query
- [ ] An OpenRouter key that returns its status via curl
- [ ] Privacy settings at openrouter.ai/settings/privacy allow free providers
- [ ] A model id copied exactly, `:free` suffix included
- [ ] (Optional for now) a Groq key that lists a whisper model

Do **not** worry yet about whether that model supports tool calling — STEP 10
gives you a script that checks it properly, and swaps it in one line if not.

Next: [01-database.md](01-database.md).
