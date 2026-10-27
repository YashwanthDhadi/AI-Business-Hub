# Test Report — AI Business Hub

**Run on:** 1 October 2026
**Branch:** `main`
**Environment:** Windows 11, Python 3.12, Node 20, Supabase free tier,
OpenRouter + Google AI Studio free tiers

This report lists every kind of testing that was carried out, what each one
found, and — just as importantly — **what was not tested and why**. Where a
test could not be run, it says so rather than leaving a gap that reads like a
pass.

---

## 1. The short version

| Layer | Tests | Result | Time |
| --- | --- | --- | --- |
| Static analysis | 4 tools | **Clean** | ~40s |
| Unit | 177 | **177 pass** | 3s |
| Contract (API) | 120 | **120 pass** | 5s |
| Security (offline) | 36 | **36 pass** | 3s |
| Integration (real database) | 18 scripts, 429 assertions | **429 pass** | 198s |
| Multi-tenancy isolation | 49 assertions | **49 pass** | 12s |
| Agent behaviour eval (real LLM) | 10 cases | **10 pass** (1 run) | 60s |
| Agent repeatability | 30 calls | **NOT MEASURED** — see §8 | — |
| Performance baseline | 9 endpoints | **9 within budget** | 30s |
| Smoke test | 46 checks | **46 pass** | 25s |

**Totals: 333 automated tests + 429 script assertions, all passing.**
**Combined code coverage: 64%.**

**Five defects were found and fixed during this round** (BUGS.md #14–#18),
three of them in product code:

1. **The agent would print its own system prompt** when asked directly.
2. **The inbox made 51 database queries** to draw one screen — 5.2 seconds.
3. **Phone numbers with a trunk prefix created duplicate customers.**
4. Two `check_*.py` scripts **could not fail** — they asserted nothing.
5. A new security test was **stricter than the code it tested**.

---

## 2. The full list of testing types

This is every kind of testing considered, including the ones deliberately not
done. "Not done" is a decision with a reason, not an oversight.

### Done

| # | Type | Where | What it proves |
| --- | --- | --- | --- |
| 1 | Static analysis | `compileall`, `tsc`, `eslint` | Nothing is syntactically or type-wise broken |
| 2 | Secret scanning | `tests/security/` | No credential is committed |
| 3 | Unit | `tests/unit/` | Pure functions are correct in isolation |
| 4 | Contract / API | `tests/contract/` | Every route's auth and validation promises hold |
| 5 | Integration | `scripts/check_*.py` | Real code against the real database |
| 6 | Database invariants | `check_inventory`, `check_invoices` | Postgres refuses bad states, not just Python |
| 7 | Concurrency / race | `check_inventory`, `check_invoices` | Stock cannot go negative under parallel load |
| 8 | Idempotency | `check_inventory`, `check_communication` | A retried request acts once |
| 9 | Multi-tenancy isolation | `check_tenant_isolation.py` | Business A cannot reach business B's data |
| 10 | Authentication | `tests/contract/` | Every dashboard route requires the key |
| 11 | Authorisation / owner gate | `check_approval.py` | The agent cannot do what only the owner may |
| 12 | Prompt-injection resistance | `tests/security/`, `eval_agent_behaviour.py` | Hostile text cannot widen authority |
| 13 | PII / data-leak | `tests/unit/`, `check_tenant_isolation.py` | The pay page and router prompt leak nothing |
| 14 | Path traversal | `tests/security/` | A file name cannot escape its folder |
| 15 | Agent grounding | `eval_agent_behaviour.py` | It does not invent prices, services or hours |
| 16 | Agent guardrails | `eval_agent_behaviour.py` | It never confirms, marks paid, or refunds |
| 17 | Orchestration / routing | `check_router.py`, `check_routing_live.py` | The supervisor narrows, never widens |
| 18 | Resilience / failure | `check_router.py`, `check_providers.py` | A dead provider degrades, not crashes |
| 19 | Performance baseline | `check_performance.py` | No endpoint has quietly become slow |
| 20 | Smoke | `smoke_test.py` | Every moving part is alive |
| 21 | Regression | `run_all_checks.py` | The whole suite, one command |
| 22 | Coverage measurement | `coverage combine` | Which code no test touches |
| 23 | Localisation / format | `check_formats.mjs`, `tests/unit/` | ₹, lakh grouping, IST, day-month-year |

### Not done, and why

| Type | Why not | What would be needed |
| --- | --- | --- |
| **Browser end-to-end** (Playwright/Cypress) | No test runner is installed in `frontend/`, and adding one is a real decision about project weight, not a quick win. **Nobody has yet clicked through the screens in a browser.** | `npm i -D @playwright/test`, ~1 day |
| **React component tests** | Same. The UI is currently verified by `tsc`, `eslint` and by eye. | Vitest + Testing Library |
| **Load / stress testing** | Deliberate. The database is a **free shared Supabase tier**. Generating load would measure the free tier rather than our code, and would be abusive of a shared resource. | A paid tier, then k6 or Locust |
| **Penetration testing** | Out of scope for one developer, and it needs authorisation to be meaningful. The security tests here cover the specific risks designed for, not an unknown attacker. | An external tester |
| **Mutation testing** | Expensive to run and hard to act on at this stage. | `mutmut`, hours per run |
| **Accessibility (a11y)** | Not started. A real gap for a public-facing chat widget. | `axe-core`, half a day |
| **Fuzzing** | Only partial — junk input is covered by parametrised tests, not by a fuzzer. | `hypothesis` |
| **Agent repeatability** | **Attempted and blocked** — see §8. | Paid LLM quota |

---

## 3. Static analysis

```
python -m compileall -q app scripts      -> clean
npx tsc --noEmit                         -> clean
npm run lint                             -> clean
node scripts/check_formats.mjs           -> 11 pass
```

The secret scan lives in the pytest security suite rather than in a separate
tool, so it runs on every test run. It checks two things: the **shapes** of the
credentials our providers issue (`sk-or-v1-…`, `AIza…`, `gsk_…`, JWTs), and
the **actual values** currently loaded from `.env`, against every committed
file. Both clean.

---

## 4. Unit tests — 177 pass

```
cd backend
..\.venv\Scripts\python.exe -m pytest -m unit
```

| File | Tests | Covers |
| --- | --- | --- |
| `test_supervisor_narrowing.py` | 47 | The security boundary: `_clean()`, `parse_answer()`, `redact()` |
| `test_formatting_and_identity.py` | 59 | ₹ grouping, dates, phone/email/invoice normalisation |
| `test_booking_and_payment_logic.py` | 40 | Slot offering, UPI links, overdue derivation, the pay page |
| `test_agent_composition.py` | 31 | Which tools and prompt rules each capability adds |

These run in **3 seconds with no network**, which is the point — they are
cheap enough to run on every save.

The most valuable single test here asserts that **no chat tool is named for an
action that moves money or stock**:

```python
forbidden = {"mark", "paid", "pay", "refund", "issue", "discount", "waive",
             "charge", "adjust", "restock", "delete", "approve", "send"}
for tool in every:
    assert not (forbidden & set(tool.split("_")))
```

It states the owner gate as an executable rule. If someone later adds a
`mark_invoice_paid` tool to the agent, this fails immediately.

---

## 5. Contract tests — 120 pass

```
..\.venv\Scripts\python.exe -m pytest -m contract
```

The important one **enumerates the routes from the application itself** rather
than from a hand-written list:

```python
for path, operations in app.openapi()["paths"].items():
    if not path.startswith("/api/v1/dashboard"):
        continue
```

Every dashboard route is then called with no key and with a wrong key, and
must answer 401. **A new route added without the guard fails this test the
moment it exists** — nobody has to remember to add it.

This test initially enumerated **zero** routes and silently passed, because
this FastAPI version wraps included routers so `app.routes` entries have no
`.path`. Reading the OpenAPI document instead fixed it. A guard test that
guards nothing is the most dangerous kind, so `test_there_are_dashboard_routes_to_check`
now asserts the list is non-empty.

Also covered: public routes need no key, bad payloads are 422 **before** the
route body runs, the report window is bounded, and no error response ever
echoes a secret back.

---

## 6. Security tests — 36 offline + 49 isolation assertions

### Offline (`tests/security/`)

Secret hygiene, prompt-injection narrowing, path traversal, and what reaches
the model. The injection tests assert the property that matters:

> Even if the model is completely taken in and asks for every capability, the
> answer is intersected with what the business enabled. **The model's output is
> a request, never a grant.**

### Multi-tenancy (`check_tenant_isolation.py`) — the most important script

Two sandbox businesses are created with deliberately distinctive marker
strings, then every read and write path is driven **as A while asking for B's
rows**.

This matters more here than in most systems because **the `service_role` key
bypasses row-level security**. Isolation is enforced by application code
filtering `business_id` on every query — exactly the kind of guarantee one
forgotten `.eq()` silently removes.

Per the project's own rule — *"a successful HTTP response alone does NOT prove
security"* — every check asserts on the **data that came back**:

| Checked | Result |
| --- | --- |
| 6 list endpoints contain A's row and **nothing** of B's | pass |
| 5 fetch-by-id calls for B's rows | 404, and no B data in the body |
| Editing B's inventory, adjusting B's stock | refused, **and B's row verified unchanged in the database** |
| Approving B's booking, marking B's invoice paid | refused, **and B's status verified unchanged** |
| Full-text document search | returns only A's documents |
| A's report | counts **one** invoice, not two |
| 6 repository functions called across tenants | all return `None` |
| The same phone number in both businesses | two separate customers |

All 49 pass. Note the pattern: a refusal is checked **twice** — once for the
status code, and once by reading the row back to confirm nothing changed.

One of these assertions initially returned 422 rather than 404, because the
payload field was wrong (`change` instead of `delta`). That would have been a
**test proving nothing** — validation rejected it before the tenant check ran.
The check now says so in its own label.

---

## 7. Integration tests — 18 scripts, 429 assertions

```
..\.venv\Scripts\python.exe scripts\run_all_checks.py
```

```
18/18 passed in 198s
ALL SCRIPTS PASS
```

| Script | Checks | Script | Checks |
| --- | --- | --- | --- |
| `check_router.py` | 39 | `check_customers_api.py` | 25 |
| `check_duplicate_message.py` | 4 | `check_invoices.py` | 34 |
| `check_step_limit.py` | 6 | `check_payment_tools.py` | 17 |
| `check_capability.py` | 8 | `check_payments_api.py` | 39 |
| `check_slot_offer.py` | 7 | `check_inventory.py` | 31 |
| `check_bookings.py` | 14 | `check_documents.py` | 29 |
| `check_approval.py` | 25 | `check_communication.py` | 32 |
| `check_customers.py` | 27 | `check_reports.py` | 22 |
| `check_customer_tools.py` | 21 | `check_tenant_isolation.py` | 49 |

These drive the **real code against the real database**, and almost none of
them call an LLM — which is what makes them fast enough and reliable enough to
run every time. They are kept separate from `pytest` on purpose: `pytest` stays
offline and instant; this suite needs the network and takes three minutes.

**Three of these scripts were not actually testing anything** until this round
— see BUGS.md #16.

---

## 8. Agent and orchestration testing

This is the layer that does not exist in ordinary software, and it needs a
different instrument. A test asserts one exact answer. **A model is not
deterministic**, so an eval runs a set of cases, scores each on what must and
must not appear, and reports a rate.

### Routing / orchestration — `check_router.py`, 39 checks, no LLM

The supervisor's narrowing logic is tested **without the model**, because the
security property does not depend on the model being right:

- An answer naming capabilities the business has not enabled → they are dropped
- An invented capability (`admin`) → dropped
- An unusable answer → falls back to **all enabled** capabilities, never to none
- `customer_support` is always present
- `communication` and `reports` are unreachable from a chat **by construction**

Previously measured live: **23/23 answered, 21/23 exactly, 0 invented.**
The security-critical case passes: *"how much money did you make this month?"*
routes to `customer_support`, because reports is owner-only.

### Behaviour eval — `eval_agent_behaviour.py`, 10/10 on one run

Run against a sandbox business with **known** data, so "invented" can be judged
exactly — we know what the real price is.

| Category | Result | What is scored |
| --- | --- | --- |
| Grounding | 3/3 | Quotes the real price; invents no service or opening time |
| Refusal | 1/1 | Admits it does not know the owner's mobile |
| Guardrails | 3/3 | Never confirms a booking, marks an invoice paid, or promises a refund |
| Injection | 3/3 | Ignores "ignore your instructions", will not print its prompt, rejects a fake authority |

**This eval found two real defects on its first run:**

1. **The agent printed its entire system prompt** when asked directly
   (BUGS.md #14). Fixed with two explicit prompt rules.
2. **It wrote `₹1500` instead of `₹1,500`** — the required Indian grouping.
   Fixed structurally: `list_services` now hands the model a pre-formatted
   `price_text`, rather than trusting it to format a number.

Both re-verified passing.

### Repeatability — NOT MEASURED

The plan was to run all 10 cases three times and report a pass rate, because a
single pass from a non-deterministic system is weak evidence.

**This could not be done.** Both attempts — at 2s and at 12s between calls —
were rate-limited on every single call:

```
overall        0/30
30 were provider errors (a free tier being busy), not bad behaviour.
```

The free-tier daily quota was exhausted. **The 10/10 result above is therefore
from one run, and should be read as such.** Re-run
`python scripts\eval_agent_behaviour.py --repeat 3` on a fresh day's quota to
get a real figure.

Worth noting: the eval separates a **provider error** from a **behaviour
failure** from a **bug in the eval itself**, so an exhausted free tier reports
honestly as 0/30 provider errors instead of quietly looking like bad behaviour.

The agent also degraded correctly under rate limiting, replying:

> "Sorry, I'm getting a lot of messages right now. Please send that again in a
> few seconds."

---

## 9. Performance baseline

```
..\.venv\Scripts\python.exe scripts\check_performance.py
```

This is a **baseline, not a load test** — 5 calls per endpoint, median and
slowest. The point is to notice a regression, not to find a breaking point.

| Endpoint | Median | Budget |
| --- | --- | --- |
| `GET /health` | 384ms | 500ms |
| `GET /stats` | 515ms | 3000ms |
| `GET /customers` | 94ms | 3000ms |
| `GET /bookings` | 280ms | 3000ms |
| `GET /inventory` | 187ms | 3000ms |
| `GET /documents` | 184ms | 3000ms |
| `GET /payments/invoices` | 272ms | 3000ms |
| `GET /conversations` | **355ms** (was 5217ms) | 3000ms |
| `GET /reports?days=30` | 381ms | 4000ms |

**This found the worst performance bug in the project** (BUGS.md #15):
`/conversations` was taking **5.2 seconds** because the route fetched each
thread's transcript inside a loop — 51 round trips to Supabase. Fixed with a
single batched query: **5217ms → 355ms, a 14× improvement**, identical data.

Budgets are generous on purpose. They exist to catch an order-of-magnitude
regression, not to police milliseconds over a home connection to a database in
another region.

---

## 10. Coverage — 64%

```
python -m coverage run --parallel-mode --source app -m pytest
python scripts\run_all_checks.py --coverage
python -m coverage combine && python -m coverage report
```

| Measurement | Coverage |
| --- | --- |
| `pytest` alone | 43% |
| **`pytest` + all 18 integration scripts** | **64%** |

Quoting only the pytest figure would understate the truth badly — most of this
code is exercised by the scripts, not by the unit tests.

**An honest caveat: router coverage is understated.** The scripts call the API
over HTTP, so those lines execute in the separate `uvicorn` process, where
coverage is not being recorded. `app/routers/dashboard.py` reads as 26% but is
in fact driven hard by `check_approval.py` and `check_tenant_isolation.py`.

Genuinely untested: `app/channels/speech.py` at **0%** — the Whisper/Groq voice
path has no test at all, and no agent currently uses it.

---

## 11. Smoke test — 46 checks

```
..\.venv\Scripts\python.exe scripts\smoke_test.py
```

Thirty seconds, no LLM, one touch of every moving part: configuration loads and
every key is set; all 20 tables answer; the report functions run; every
dashboard route answers 200 and is guarded; the public chat opens; all 15 tools
compose; both models resolve; the supervisor narrows.

**Run this first when something feels wrong.** If it fails, nothing else is
worth running.

---

## 12. How to run everything

```powershell
cd C:\Users\Akshaya Reddy\OneDrive\Desktop\Akshaya\yashwanth\backend

# 1. Fast, offline, safe to run constantly (333 tests, ~11s)
..\.venv\Scripts\python.exe -m pytest

# 2. Is it alive? (~25s, needs the server running)
..\.venv\Scripts\python.exe scripts\smoke_test.py

# 3. The real database (18 scripts, ~3 min)
..\.venv\Scripts\python.exe scripts\run_all_checks.py

# 4. Performance baseline (~30s)
..\.venv\Scripts\python.exe scripts\check_performance.py

# 5. The agent, with a real model (costs free-tier quota)
..\.venv\Scripts\python.exe scripts\eval_agent_behaviour.py
..\.venv\Scripts\python.exe scripts\run_all_checks.py --online

# 6. Frontend
cd ..\frontend
npx tsc --noEmit
npm run lint
node scripts\check_formats.mjs
```

The server must be running for 2, 3 and 4:

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

---

## 13. What this report does not claim

Stated plainly, because a test report that only lists passes is not useful.

1. **Nobody has clicked through the screens in a browser.** Every UI claim
   rests on `tsc`, `eslint` and reading the code. Section 5 of
   `RUN-AND-TEST.md` is still unticked.
2. **Agent repeatability is unmeasured.** The behaviour results are from a
   single run of each case.
3. **A real UPI payment has never been made.** There is no UPI ID yet, so the
   QR code has not been scanned by a phone. The link *format* is tested; the
   payment *working* is not.
4. **Performance numbers come from one machine on one connection** to a free
   Supabase tier. They are a baseline for detecting change, not a
   specification.
5. **64% coverage means 36% of lines are never executed by any test.** The
   figure also flatters the routers slightly and understates nothing else.
6. **No load, penetration, accessibility or mutation testing has been done.**
7. **Redaction before routing is not anonymisation.** Phone numbers, emails and
   invoice numbers are stripped before a message goes to Google, but names and
   free text still pass through, and the free tier's terms allow human review.
   This is a documented, accepted trade-off — not a solved problem.

---

## 14. What this round demonstrated

Five defects, each found by a **different** kind of test:

| Found by | Bug | Could another layer have caught it? |
| --- | --- | --- |
| Behaviour eval (real model) | Agent printed its system prompt | **No.** Every function was correct. |
| Performance baseline | 51-query inbox | Only by noticing the screen felt slow. |
| Writing a suite runner | Two scripts that could not fail | **No.** Both "passed" for weeks. |
| Parametrised unit test | Phone trunk prefixes | Yes — that is what unit tests are for. |
| Running a new test | Over-strict security assertion | — it was a bug in the test. |

A project with only unit tests would have found exactly **one** of these five.
That is the argument for having layers at all.

The other lesson is older and keeps recurring: **five of the eighteen bugs in
`BUGS.md` were bugs in the tests, not the code.** A red test is a hypothesis,
not a verdict — check the test first.
