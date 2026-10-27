# 08 — Prompt architecture

## Status: no prompts exist

**There is not one LLM prompt in this repository.** Searched every `.ts`, `.tsx`,
`.sql`, `.md`, `.json` and `.mjs` file:

| Searched for | Occurrences |
| --- | --- |
| `systemPrompt`, `system_prompt`, `SYSTEM_PROMPT` | 0 |
| `"You are …"` / `You are a` (prompt-style second person) | 0 |
| `role: "system"` / `role: "user"` / `role: "assistant"` | 0 |
| `messages: [` in a model-call shape | 0 |
| A `prompts/` directory or `.prompt` / `.txt` / `.jinja` / `.hbs` template file | 0 |
| Few-shot example blocks | 0 |
| Output-format or JSON-schema instructions to a model | 0 |

The word `prompt` does appear in the codebase. Every occurrence is one of two
unrelated things:

1. **A URL query parameter.** `/app/command?prompt=<text>` pre-fills the command
   box so the palette, the overview page and deep links can launch a command.
   `app/app/command/page.tsx:~80`:
   ```ts
   const prompt = searchParams.get("prompt");
   if (!prompt || !businessId || prompted.current === prompt) return;
   prompted.current = prompt;
   setDraft(prompt);
   void run.submit(prompt);
   ```
   Producers include `lib/mock/metrics.ts:320`
   (`/app/command?prompt=Confirm%20today%27s%20unconfirmed%20bookings`) and the
   suggested-command cards.
2. **`prompted`** — a `useRef` guard so the same query string does not re-submit
   on every render.

Neither has anything to do with a language model.

---

## What stands in for a prompt

Two things do the job a prompt would do. Understanding them tells you exactly
what the future prompts must reproduce.

### 1. `INTENT_KEYWORDS` — instead of intent classification

`lib/mock/workflows.ts:43`. A record of nine intents, each with a keyword list.
`classify()` (`:80`) scores the lowercased command against every list and takes
the highest:

```ts
const score = keywords.reduce((total, keyword) => {
  if (!text.includes(keyword)) return total;
  return total + 1 + keyword.length / 40;   // longer phrases outrank single words
}, 0);
```

This is the decision an LLM would make from a system prompt reading something
like *"classify the owner's request into one of these nine capabilities."* The
keyword table is the prompt's spec, written as code.

Its limits are the reason a real model is wanted: no synonyms it was not given,
no spelling tolerance, no multi-intent requests, no clarifying question, no
language other than English. It has already produced one real bug — a bare
`"tomorrow"` keyword in `booking_confirm` captured every request mentioning the
day. The fix was to delete the keyword (comment at `workflows.ts:52`).

### 2. `PLAN_BY_INTENT` — instead of a planning prompt

`lib/mock/workflows.ts:~120-162`. Nine literal objects, one per intent:

```ts
fallback: {
  intent: "General business request",
  scope: "Your business data",
  action: "Interpret and route",
  capability: "customer_support",
  requiresApproval: false,
},
```

`planCommand()` picks one, then rewrites `scope` through
`vocabulary(business.type)` for three intents so a gym reads "classes" where a
salon reads "appointments". That vocabulary substitution is the only
tenant-awareness in the whole pipeline — and it is precisely the context a real
system prompt would carry.

---

## The customer-facing message templates

These are **not** prompts. They are the *output* a prompt would produce, written
by hand. They matter because they are the target quality bar and they show what
context the real drafting step needs.

`lib/mock/approvals.ts:19` — `reminderMessage(business, payment, variant)`, three
templates rotated by `variant % 3`:

```
Hi {first}, a gentle reminder from {business.name}: invoice {invoiceNumber}
for {amount} was due on {due}. You can pay by UPI or at the counter. Thank you!

Hello {first}, hope you are doing well. {amount} is pending against
{invoiceNumber} (due {due}). Reply here if you would like a payment link.
— {business.name}

Hi {first}, your balance of {amount} for "{description}" is now
{daysOverdue} days past due. Let us know if you need a little more time.
— {business.name}
```

Four more single templates, inline at their call sites:

| Where | Purpose | Variables it interpolates |
| --- | --- | --- |
| `approvals.ts:59` | Booking confirmation | first name, service, start time, staff name, business name |
| `approvals.ts:77` | Win-back for a quiet customer | first name, business name, a randomly picked incentive |
| `approvals.ts:91` | Purchase order | quantity, item name, SKU, unit price |
| `approvals.ts:109` | Invoice | service, date, price |

Properties of every one of them:

- **Deterministic.** Variant selection is `index % 3` and the incentive uses the
  seeded `pick(rng, …)`, so the same tenant always sees the same message. See
  `lib/mock/seed.ts`.
- **Real data.** Amounts, invoice numbers, due dates and overdue counts come from
  the tenant's actual generated rows, not from placeholders.
- **Editable by the human.** `approvalService.editItemMessage()`
  (`lib/services/approval-service.ts:~75`) writes `item.proposedMessage` back.
  The owner can rewrite any draft before approving. That mutation is in-memory.
- **Never sent.** No channel exists. See `17_EXTERNAL_INTEGRATIONS.md`.

The `ApprovalItemRecord.proposedMessage` field (`lib/types.ts:307`) is where a
real drafting step would write. The approval drawer, the include/exclude toggle
and the edit affordance all already work against it.

---

## Prompt engineering techniques used

None, because there are no prompts. For completeness against the template:

| Technique | Present? |
| --- | --- |
| Few-shot examples | No |
| Chain-of-thought instructions | No |
| Output schema / JSON mode | No |
| Role prompting | No |
| Prompt templates or a template engine | No |
| Prompt versioning | No |
| Dynamic context injection | No — though `vocabulary()` is the mechanism that would do it |
| Prompt caching | No |
| Prompt-injection defence | No — and none is needed yet, because untrusted text never reaches a model. **This changes the moment one does:** the command box is free text typed by a tenant user, and customer names, service descriptions and invoice notes would all become model input |

That last row is the one to carry forward. When the model is connected, the
command string and every customer-supplied field are untrusted input.

---

## Where prompts will need to live

Four distinct prompts are implied by the existing code shape:

| Prompt | Replaces | Must output |
| --- | --- | --- |
| **Classifier / planner** | `classify()` + `PLAN_BY_INTENT` | A `CommandPlan`: `intent`, `scope`, `action`, `capability`, `requiresApproval` |
| **Supervisor / orchestrator** | `buildSteps()`'s switch | A sequence of `WorkflowStep` objects, choosing which specialists and where the gate goes |
| **Specialist worker** | each `kind: "agent"` step's `detail` and `facts` | A short human summary plus `facts[]` and `records[]` for the step card |
| **Message drafter** | `reminderMessage()` and the four inline templates | One `proposedMessage` per `ApprovalItemRecord`, in the business's voice |

The context each one needs is already assembled and available in the codebase:

```ts
business.name, business.type, business.currency, business.timezone
business.ownerName, business.hours          // lib/types.ts Business
business.enabledCapabilities                // which powers this tenant has
vocabulary(business.type)                   // lib/domain.ts — the tenant's nouns
datasetFor(business.id)                     // the tenant's rows
```

`vocabulary()` is the single most important input for a prompt author here. It is
what keeps the product from hardcoding itself to salons — the twelfth product
rule — and a prompt that ignores it will regress that immediately.

---

## Related documents

- `05_AGENT_ARCHITECTURE.md` — the classifier in full
- `07_LLM_ARCHITECTURE.md` — the models configured but never called
- `09_TOOL_ARCHITECTURE.md` — the data functions a prompt would expose as tools
- `15_SECURITY_ARCHITECTURE.md` — why untrusted input matters at that seam
