# Troubleshooting and daily workflow

Keep this open in a tab. It is organised by **symptom**, because that is what you
have when something breaks.

---

## Your daily startup routine

Three terminals. Terminal 3 stays free for commands.

```powershell
# ---- Terminal 1: the API
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn app.main:app --reload --port 8000

# ---- Terminal 2: the UI
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npm run dev

# ---- Terminal 3: free
```

Then the 20-second smoke test:

```powershell
curl.exe -s http://127.0.0.1:8000/health
curl.exe -s http://127.0.0.1:8000/health/config
curl.exe -s http://127.0.0.1:8000/health/db
curl.exe -s http://127.0.0.1:8000/health/llm
```

All four must return `"status":"ok"`. If one fails, fix that before anything
else — everything downstream depends on it.

Then open <http://localhost:3000/chat/pulse-fitness> and send one message.

Note the slug is your **seeded** business. The old mock slugs (`fitzone`,
`apexdental`) stopped working once the chat page started reading the database.

**Nothing expires in this stack.** No sandbox to re-join, no tunnel to restart,
no 24-hour window, no phone-number allow-list. If it worked yesterday it works
today.

---

## Diagnose in the right order

When a chat message gets no reply, walk the pipeline. Each step rules out a
whole class of causes.

```
1. Did the browser send it?
   DevTools → Network → the POST to /api/v1/chat/message
   Not there?          → a JS error earlier; check the Console tab.
   Red / CORS error?   → CORS_ORIGINS, or the API is down.
   Pending forever?    → uvicorn is not running.

2. Did FastAPI receive it?
   Terminal 1: a line like  "POST /api/v1/chat/message HTTP/1.1" 200 OK
   Nothing?            → wrong NEXT_PUBLIC_CHAT_API_URL.
   401?                → session token expired or missing.
   429?                → rate limited. Wait, or restart uvicorn to clear.

3. Did the agent run?
   Terminal 1: "step 1 -> search_knowledge({...})" and "Replied in NNNms"
   Nothing?            → subscription inactive, or human_takeover is on.
                         Both log a reason.

4. Was the answer right?
   Look at which tools it called.
     No tool call at all  → prompt/description problem, not a data problem.
     Tool called, empty   → the knowledge base has no article for it.
     Tool called, good data, bad sentence → temperature or prompt.

5. Did it reach the screen?
   The reply is in the JSON response in DevTools → Network → Response.
   There but not visible → a React problem, not a backend one.
```

**Nine times out of ten the answer is in terminal 1.** Read the last 30 lines
before doing anything else.

---

## Symptom → cause

### Nothing happens at all

| Symptom | Most likely cause | Fix |
| --- | --- | --- |
| "Could not reach the assistant" | uvicorn not running, or wrong API URL | Start terminal 1. Check `NEXT_PUBLIC_CHAT_API_URL`, restart `npm run dev`. |
| Console: `blocked by CORS policy` | Origin not allowed | `CORS_ORIGINS` in `backend/.env` must include `http://localhost:3000`. Restart uvicorn. |
| Console mentions `X-Chat-Session` not allowed | Header missing from `allow_headers` | STEP 7 lists it in `main.py`. |
| "Chat unavailable" on a slug that exists | `chat_enabled` or `is_active` is false, or the support agent is inactive | Check the `businesses` and `agent_subscriptions` rows. |
| 401 on every message | Token not stored or not sent | DevTools → Application → Local Storage → `aibh.chat.<slug>`. |
| FastAPI logs the message, then silence | Subscription inactive or `human_takeover` | Both log a reason — read it. |
| Env change has no effect | Next.js reads `.env.local` only at startup | Restart `npm run dev`. |

### The agent replies, but wrongly

| Symptom | Cause | Fix |
| --- | --- | --- |
| Invents a policy or a price | It never called a tool | Lower `LLM_TEMPERATURE` to `0.1`; strengthen the tool `description`. |
| "I don't know" for something in the knowledge base | Search did not match | Test directly: `select * from search_knowledge('<business_id>','your words',5);` Add tags. |
| Right facts, wrong tone or too long | Prompt rules 3 and 4 | Tighten them; the system prompt is in `support_agent.py`. |
| Gives medical or injury advice | Persona not reaching the prompt | Check `agent_persona` on the business row; print `build_system_prompt(business)`. |
| Escalates constantly | `escalate_to_human` description too broad | Narrow it to the specific cases. |
| Forgets the previous message | History not loading | Confirm `messages` rows exist for that conversation. |
| Every answer takes 5+ steps | Prompt unclear, or tool descriptions overlap | Watch the `step N ->` lines; a simple question should take 2. |
| Different answer each time | Temperature too high | Drop `LLM_TEMPERATURE` to `0.1`. |

### Voice

| Symptom | Cause | Fix |
| --- | --- | --- |
| No microphone button | Not a secure context, or `MediaRecorder` missing | Use `localhost`, not a LAN IP. HTTPS in production. |
| Permission prompt never appears | Already denied for this site | Browser settings → Site settings → Microphone → reset. |
| Upload returns 422 | `Content-Type` set manually on the FormData request | Remove it — the browser must set the boundary. |
| "That audio format is not supported" | Browser MIME type not in the map | Log `file.content_type` in the route, add it to `SUPPORTED_TYPES`. |
| Recording indicator stays on after stopping | Tracks not released | `releaseMic()` must run in `onstop` **and** on unmount. |
| Empty transcript | Silence, muted mic, or a clip under a second | Speak close to the microphone for 2+ seconds. |
| Works in Chrome, silent in Safari | Hardcoded `audio/webm` | Keep `pickMimeType()`. |

### Owner dashboard

| Symptom | Fix |
| --- | --- |
| "Live backend not configured" | Set `NEXT_PUBLIC_LIVE_BUSINESS_ID`, restart `npm run dev` |
| `502 Could not reach the backend` | Start uvicorn |
| `401 invalid X-Dashboard-Key` | `HUB_DASHBOARD_KEY` must equal `DASHBOARD_API_KEY` |
| Owner's reply never reaches the customer | The customer's tab must be open; replying sets takeover automatically |
| Redirected to `/login` | Log in with a demo account |
| Inbox never updates | DevTools → Network: a `/api/hub/...` request every 6 s |
| Dashboard shows mock data | Only Customer Chat and Settings-knowledge are wired; other screens are still `src/data/mock-*.ts` |

### Errors in the terminal

| Error | Fix |
| --- | --- |
| `ModuleNotFoundError: No module named 'app'` | Run uvicorn from `backend/` |
| `ZoneInfoNotFoundError` | `python -m pip install tzdata` |
| `No endpoints found for <model>` | Run `python scripts\check_models.py`, copy a live id into `LLM_MODEL` |
| `429` / rate limit (OpenRouter) | Free tier is ~20 req/min plus a daily cap. Wait, or switch model |
| `No allowed providers are available` | openrouter.ai/settings/privacy - allow free providers |
| `401 No auth credentials found` | Key must start with `sk-or-v1-`, and `LLM_BASE_URL` must be set |
| Agent replies but never calls a tool | The model cannot do tool calling. `python scripts\check_models.py --test` |
| `tool_call_id ... no matching tool call` | `messages.append(reply)` must come before the `ToolMessage`s |
| `Could not find a relationship between X and Y` | Missing foreign key — re-run the migration |
| `function public.search_knowledge does not exist` | Migration not fully applied — re-run `001_...sql` |
| `generation expression is not immutable` | `to_tsvector` needs the explicit `'english'` argument |
| `JSON object requested, multiple rows returned` | Use `one()` from `app.db`, not `.single()` |
| `[Errno 10048] bind on address` | Port 8000 busy — kill the old process |
| `Form data requires "python-multipart"` | `python -m pip install python-multipart` |

### Frontend build

| Symptom | Fix |
| --- | --- |
| `Property 'businessSlug' does not exist on type 'Promise'` | Next.js 15+ — `await params` |
| `EINVAL` on `next dev` | `Remove-Item -Recurse -Force .next`, restart (OneDrive quirk) |
| Composer hidden by the phone keyboard | Use `h-[100dvh]`, not `100vh` |
| Two chat sessions per page load | Strict Mode double-render — keep the `cancelled` flag |
| `Module not found: Can't resolve '@/...'` | `@/*` maps to `src/*` — the file belongs under `frontend/src/` |
| `npx tsc --noEmit` fails | Read the first error only; the rest are usually cascades |
| Looking for `npm run verify` or `npm test` | **This frontend has no test runner.** Use `npx tsc --noEmit` and `npm run lint` |

---

## Techniques that save hours

**Test the agent without a browser.** `python scripts\chat.py` is the same agent,
same tools, same prompt. Fix logic there, not through a React re-render.

**Test a tool without the LLM.** `python scripts\check_tools.py` calls each tool
directly. If a tool is broken, no prompt will save it.

**Test the API without the UI.** The curl sequence in STEP 17 drives the whole
chat. If that works and the page does not, the bug is in React.

**Test search without anything.** In the Supabase SQL editor:

```sql
select title, rank from search_knowledge(
  'a1b2c3d4-0000-4000-8000-000000000001', 'your customer''s exact words', 5
);
```

This one query answers "is the agent stupid, or is the knowledge base missing?"
more often than any other check.

**Turn up the logs.** `LOG_LEVEL=DEBUG` in `backend/.env`, restart.

**Read `agent_logs`.** Every run, with input, output, tools and latency:

```sql
select created_at, input_text, output_text, tool_calls, latency_ms, status, error
from agent_logs
order by created_at desc
limit 20;
```

**Find the questions your knowledge base is missing** — the single most valuable
query in the project once you have real traffic:

```sql
select input_text, output_text, created_at
from agent_logs
where tool_calls::text like '%search_knowledge%'
  and (output_text ilike '%check with the team%' or output_text ilike '%don''t have%')
order by created_at desc
limit 30;
```

Every row is a real customer question with no answer. Work down that list in the
Knowledge screen and the agent gets measurably better each week.

**Reset a stuck conversation:**

```sql
update conversations set human_takeover = false where id = 'PASTE_ID';
```

**Clear rate limits:** restart uvicorn. The counters are in memory.

**Start completely fresh:** re-run `database/seed.sql`. It deletes the demo
business and everything cascading from it, then rebuilds. Your keys and code are
untouched.

---

## What to check before you ask for help

1. The last 30 lines of terminal 1
2. DevTools → Network: the failing request's status and response body
3. `/health`, `/health/config`, `/health/db`, `/health/llm`
4. The relevant `agent_logs` row
5. The `search_knowledge` SQL result for the question that went wrong
6. What you changed immediately before it broke

**Never paste a real key** into a chat, an issue, or a screenshot.
`/health/config` exists precisely so you can share what is loaded without
sharing what it is.

---

## Known limitations at this stage

An honest list. None of them block you from starting the next agent.

| Limitation | Impact | When to fix |
| --- | --- | --- |
| `X-Dashboard-Key` is a shared secret, not per-user auth | Anyone with the key can read any business | **Before real users** — see the appendix in Part 7 |
| Backend uses `service_role`, bypassing RLS | Isolation depends on repository code being correct | Keep every query filtered by `business_id`; add pgTAP tests |
| Rate limits are per-process and in memory | Restart clears them; multiple workers multiply them | When you deploy — move to Redis |
| No protection against a distributed flood | Many IPs can still overwhelm the endpoint | A CDN or WAF in front, at deploy time |
| Keyword search, not semantic | "Can I put my plan on hold?" may miss an article titled "freezing" | Phase 3: embeddings into the `embedding` column that already exists |
| Agent remembers only 12 messages | Loses context in a long conversation | Summarise older turns into the prompt |
| Owner replies need the customer's tab open | A reply to a closed tab is only seen on their next visit | Email or SMS notification, later |
| No file or image upload in chat | A customer cannot send a photo | Supabase Storage plus a vision model |
| Self-learning loop not built | Corrections are stored but unused | Phase 3 — `agent_logs.correction` and `correction_embedding` are already there |
| Anonymous sessions never cleaned up | `chat_sessions` grows forever | A scheduled `delete from chat_sessions where expires_at < now()` |

---

## Where this goes next

You now have one agent working end to end. The remaining agents are repetitions
of a shape you have already built.

**The next agent — Booking.** Concretely, it is:

1. A migration adding `appointments` and any tables it needs.
2. A new `app/agents/tools/booking_tools.py` — `check_availability`,
   `request_appointment`, `get_my_appointments`.
3. A new `app/agents/booking_agent.py`, which is `support_agent.py` with a
   different system prompt and a different tool list.
4. `update agent_subscriptions set is_active = true where agent_key = 'booking';`
5. An approval queue in the dashboard, which is the `support_requests` screen
   with different columns.

The chat UI, the voice input, the session handling, the rate limits, the owner
inbox and the knowledge base all work unchanged. That is the whole point of
having built this one carefully.

**Then the supervisor.** Once two or three specialists exist, replace the
hand-written loop in `support_agent.py` with a LangGraph state chart: a
supervisor node reads the message, checks which `agent_subscriptions` are
active, routes to the right specialist, and returns the result. You wrote that
loop by hand in STEP 12 precisely so this is a refactor rather than a mystery.

**One thing worth doing before either:** swap `X-Dashboard-Key` for real Supabase
Auth. Everything above assumes you trust whoever holds that key, and that
assumption stops being safe the moment a second person uses the system.

---

Back to [the guide index](../README.md).
