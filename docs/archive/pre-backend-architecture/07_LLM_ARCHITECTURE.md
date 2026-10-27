# 07 — LLM architecture

## Status: no LLM is called

**No LLM is called anywhere in this repository.** The evidence:

| Check | Result |
| --- | --- |
| LLM SDK in `dependencies` | **None.** No `@anthropic-ai/sdk`, no `openai`, no `@google/generative-ai`, no `langchain` |
| `fetch` to any model endpoint | 0 occurrences of `api.anthropic.com`, `api.openai.com` or `generativelanguage` outside `lib/config.ts` string literals |
| `messages.create` / `chat.completions` / `generateContent` | 0 |
| Streaming consumer (`ReadableStream`, SSE, `text/event-stream`) | 0 |
| Any read of an LLM API key | 0 — no code reads `process.env.ANTHROPIC_API_KEY` |
| Token counting, cost tracking, usage metering | 0 |

Everything below documents the **configuration** that exists for LLMs and the
exact place a real call would go. That distinction matters: the wiring diagram is
drawn, the wire is not connected.

The 31 dependencies are listed in `18_CONFIGURATION.md`; none of them is an AI
library.

---

## What is configured

`lib/config.ts:44-90` — the `config.llm` object. Reproduced in full because every
model string in this product lives here:

```ts
llm: {
  defaultProvider: "anthropic" as const,
  providers: {
    anthropic: {
      label: "Anthropic",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      baseUrl: "https://api.anthropic.com",
      models: {
        supervisor: "claude-opus-5",
        agent: "claude-sonnet-5",
        fast: "claude-haiku-4-5-20251001",
      },
    },
    openai: {
      label: "OpenAI",
      apiKeyEnvVar: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      models: { supervisor: "", agent: "", fast: "" },   // ← blank
    },
    google: {
      label: "Google",
      apiKeyEnvVar: "GOOGLE_API_KEY",
      baseUrl: "",                                        // ← blank
      models: { supervisor: "", agent: "", fast: "" },
    },
  },
  orchestration: {
    maxSteps: 12,
    maxToolCallsPerStep: 6,
    temperature: 0.2,
    streaming: true,
  },
}
```

Note the shape: `apiKeyEnvVar` stores the **name** of the variable, not the
value. `"ANTHROPIC_API_KEY"` is a string that gets rendered on the admin page so
an operator can see which variable to set. No key ever reaches the browser by
this route — a deliberate and correct choice, and the pattern to preserve.

### Model roles

Three named tiers, declared and unused:

| Role | Model string | Intent behind it |
| --- | --- | --- |
| `supervisor` | `claude-opus-5` | Interpret the request, plan the steps |
| `agent` | `claude-sonnet-5` | Do one specialist's work |
| `fast` | `claude-haiku-4-5-20251001` | Cheap, high-volume steps |

The same tiering appears independently in `lib/mock/agents.ts`, where each of the
11 roster rows carries its own `model` string. Those two sources are **not
linked** — `agents.ts` hard-codes the literals rather than reading
`config.llm.providers.anthropic.models`. If you change the model in `config.ts`,
the agent cards keep the old value. Recorded in `26_CODE_QUALITY_AUDIT.md`.

---

## Who reads this configuration

Exhaustive. Two files, both display-only:

| Reader | Line | What it does with it |
| --- | --- | --- |
| `app/admin/agents/page.tsx` | 119 | Renders `providers.anthropic.label` as a caption |
| | 149-155 | Iterates all three providers into a table; marks `defaultProvider` |
| | 203-211 | Renders `maxSteps`, `maxToolCallsPerStep`, `temperature`, `streaming` as read-only rows |
| `app/admin/settings/page.tsx` | 218-223 | Same provider table |
| | 316-324 | Same orchestration rows |

That is the entire consumer set. `config.llm.orchestration.maxSteps = 12` is
rendered as text on two pages and enforced nowhere, because there is no loop to
bound.

---

## Model selection logic

There is none. There is no router, no fallback chain, no cost-based selection, no
retry-on-a-cheaper-model. `defaultProvider: "anthropic"` is read only to draw a
"Default" badge in a table.

`app/admin/agents/page.tsx:155`:

```tsx
const isDefault = key === config.llm.defaultProvider;
```

That is the sum total of provider-selection logic in the codebase.

---

## Prompts, temperature, tokens, streaming

| Parameter | State |
| --- | --- |
| System prompt | Does not exist — see `08_PROMPT_ARCHITECTURE.md` |
| User prompt construction | Does not exist |
| `temperature` | `0.2` declared; never passed to anything |
| `max_tokens` | Not declared anywhere |
| `stop_sequences` | Not declared |
| `streaming` | `true` declared; no stream is opened or consumed |
| Structured output / JSON mode / tool schemas | Not declared |
| Context window management | Not applicable |
| Conversation history | Not stored. Every command is independent; no thread, no memory |

---

## Rate limiting, retries, timeouts, cost

| Concern | State |
| --- | --- |
| Rate limiting | None anywhere in the repo |
| Retry / backoff | None |
| Timeout | `config.api.timeoutMs = 20_000` exists but applies to the **FastAPI** transport (`api-client.ts:55`), not to any model call |
| Cost tracking | None. No token counts, no spend, no budget |
| Caching of responses | None |
| Observability / tracing | None. No LangSmith, no OpenTelemetry, no logging of any model interaction |

The `avgLatencyMs`, `tasksToday`, `successRate` and `escalationRate` figures on
the agent cards are literal constants in `lib/mock/agents.ts`. They are not
measurements of anything.

---

## Environment variables reserved for LLMs

From `.env.example`. **Values are never shown in this documentation** — only
names and what they are:

| Variable | Kind | Read by any code today? |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret / API key | No |
| `OPENAI_API_KEY` | secret / API key | No |
| `GOOGLE_API_KEY` | secret / API key | No |
| `LLM_SUPERVISOR_MODEL` | model name (non-secret) | **No** — declared in `.env.example`, not read by `config.ts` |
| `LLM_AGENT_MODEL` | model name (non-secret) | No |
| `LLM_FAST_MODEL` | model name (non-secret) | No |

The last three are worth flagging: `.env.example` presents them as "model
overrides (defaults live in lib/config.ts)", but `config.ts` hard-codes the
model strings and never consults `process.env` for them. Setting
`LLM_AGENT_MODEL` today changes nothing. Recorded in
`32_UNKNOWN_BROKEN_INCOMPLETE.md`.

None of the six has a `NEXT_PUBLIC_` prefix, so none is inlined into the client
bundle. That is correct and must stay that way — anything `NEXT_PUBLIC_` is
public, permanently, in every user's browser.

---

## Where a real LLM call would go

The seam is narrow, and this is the most useful fact in this document.

```
app/app/command/page.tsx
        │  run.submit(command)
        ▼
lib/hooks/use-command-run.ts       ← client-side pacing; would become a stream reader
        │  workflowService.plan()  ·  workflowService.start()
        ▼
lib/services/workflow-service.ts:34, :51
        │  serve(path, resolver)
        ▼
lib/services/api-client.ts:78      ← THE BRANCH POINT
        │
        ├── DATA_MODE === "api" && config.api.baseUrl
        │      → fetchFromApi(path)   ← the real backend goes here
        │
        └── otherwise
               → planCommand() / buildRun()   ← the simulation lives here
```

Two ways to connect a model, and they are not equivalent:

**Option A — inside the mock resolver (fast, wrong long-term).** Make
`planCommand` async and call a model from it. Works in a day; puts an API key in
a browser bundle, which is unacceptable. Only viable behind a Next route handler.

**Option B — the intended path.** Stand up the FastAPI service, set
`NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_DATA_MODE=api`, and implement
`POST /api/v1/businesses/{id}/commands/plan` and `.../commands` server-side. The
key stays on the server, `serve()` takes its other branch, and **no component
changes.** The 66 paths already declared in `lib/services/` are the contract —
see `04_API_REFERENCE.md`.

Either way, the response must satisfy the two existing types:

```ts
CommandPlan  { intent, scope, action, capability, requiresApproval }
WorkflowRun  { id, businessId, request, intent, scope, action, capability,
               status, steps: WorkflowStep[], startedAt, triggeredBy,
               channel, approvalId? }
```

There are currently **no route handlers at all** in this repository — `find app
-name route.ts` returns nothing, and there is no `app/api/` directory. Every
`.ts` file under `app/` is a page, a layout, or a metadata route (`robots.ts`,
`sitemap.ts`). Adding the first route handler is described in
`31_MODIFICATION_GUIDE.md`.

---

## Related documents

- `05_AGENT_ARCHITECTURE.md` — the roster and the actor strings
- `08_PROMPT_ARCHITECTURE.md` — no prompts exist
- `09_TOOL_ARCHITECTURE.md` — the data functions that would become tools
- `18_CONFIGURATION.md` — every environment variable
