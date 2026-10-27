# 02 — System architecture

Diagrams of the architecture that exists. Dashed borders mark things that are
written but never execute; yellow marks mock data.

---

## A. High-level architecture

```mermaid
flowchart TD
    U["Browser<br/>business owner or platform admin"]

    U -->|"HTTP"| MW["middleware.ts<br/>Edge runtime, runs before rendering"]

    MW -->|"validate cookie"| AUTH[("Supabase Auth<br/>GoTrue")]
    MW -->|"no session → 307"| LOGIN["/login"]
    MW -->|"wrong workspace → 307"| OTHER["the other workspace"]
    MW -->|"allowed"| RSC["Next.js App Router<br/>app/**/page.tsx — 33 pages"]

    RSC --> PROV["AppProviders<br/>theme → session → tooltip → toaster"]
    PROV --> SESS["SessionProvider<br/>session + active tenant"]
    SESS --> AUTH
    SESS --> PGT[("Postgres<br/>profiles, business_users, businesses")]

    RSC --> HOOKS["hooks<br/>useAsync · useTableState · useCommandRun"]
    HOOKS --> SVC["lib/services — 10 modules"]
    SVC --> SERVE{"serve(path, resolver)<br/>api-client.ts:78"}

    SERVE -->|"DATA_MODE=mock"| MOCK["lib/mock<br/>11 modules, seeded PRNG"]
    SERVE -->|"DATA_MODE=api"| FASTAPI["FastAPI<br/>NOT BUILT"]
    SVC -->|"tenants + capabilities"| PGT

    SIM["simulated run<br/>workflows.ts + use-command-run"]
    RSC --> SIM --> SVC

    style MOCK fill:#fff3cd,color:#000
    style FASTAPI stroke-dasharray: 5 5
    style SIM fill:#fff3cd,color:#000
```

**Nodes.**

| Node | File | Role |
| --- | --- | --- |
| `middleware.ts` | `middleware.ts:20` | The only server-side gate. Matches everything except static assets |
| Supabase Auth | hosted | Validates the session cookie via `getUser()`, not `getSession()` |
| App Router | `app/` | 33 pages; 89 of 153 files are client components |
| `AppProviders` | `components/providers/app-providers.tsx` | Fixed nesting order — theme outermost so the toaster can read the resolved theme |
| `SessionProvider` | `components/providers/session-provider.tsx` | Single source of truth for who and which tenant |
| hooks | `lib/hooks/` | Only four; no data library |
| services | `lib/services/` | The only layer allowed to know where data lives |
| `serve()` | `api-client.ts:78` | The branch point. `api` side has never executed |
| `lib/mock` | 11 modules | Deterministic dataset built at import |

**Edges that do not exist:** service layer → FastAPI (no server), anything → LLM,
anything → queue.

---

## B. Component dependency diagram

```mermaid
flowchart LR
    subgraph L1["Pages — app/"]
        BIZ["13 business pages"]
        ADM["11 admin pages"]
        AUTHP["4 auth pages"]
        ONB["onboarding"]
        LAND["landing"]
    end

    subgraph L2["Composition"]
        SHELL["app-shell<br/>27 importers"]
        HEADER["page-header<br/>25"]
        TABLE["data-table"]
        CHARTS["chart-kit"]
        DRAWER["approval-drawer"]
        PANEL["workflow-panel"]
    end

    subgraph L3["Primitives — components/ui, 21 files"]
        BTN["button — 45"]
        BADGE["badge — 42"]
        SKEL["skeleton — 41"]
        STATUS["status — 32"]
    end

    subgraph L4["State"]
        SESSION["session-provider — 25"]
        ASYNC["use-async — 30"]
        TSTATE["use-table-state"]
        CRUN["use-command-run"]
    end

    subgraph L5["Services — 10"]
        SVCS["business · customer · operations<br/>approval · workflow · insight · admin · auth"]
    end

    subgraph L6["Domain"]
        TYPES["types.ts — 36"]
        DOMAIN["domain.ts — 36"]
        UTILS["utils.ts — 90 (hottest)"]
        CONFIG["config.ts"]
        NAV["navigation.ts"]
    end

    subgraph L7["Data"]
        MOCKD["lib/mock — 11"]
        SUPA["lib/supabase — 6"]
    end

    BIZ & ADM --> SHELL & HEADER
    BIZ --> TABLE & CHARTS & DRAWER & PANEL
    SHELL & HEADER & TABLE --> BTN & BADGE & SKEL & STATUS
    BIZ & ADM & AUTHP & ONB --> SESSION
    BIZ & ADM --> ASYNC --> SVCS
    BIZ --> TSTATE & CRUN --> SVCS
    SESSION --> SVCS
    SVCS --> MOCKD & SUPA
    SVCS & MOCKD & SUPA --> TYPES & DOMAIN & UTILS
    SHELL --> NAV --> DOMAIN
    SVCS --> CONFIG
    LAND -->|"build-time only"| MOCKD
```

Layering is respected in one direction: pages → services → data — with two
qualifications. 20 files import the static capability catalogue from
`lib/mock/capabilities` (domain metadata in the wrong folder, harmless), and
`components/layout/notifications.tsx:12` fetches `attentionItems()` from
`lib/mock/metrics` without going through `serve()` — the one genuine layering
violation in the codebase. See `12_DATA_FLOW.md`.

---

## C. Request lifecycle

```mermaid
sequenceDiagram
    participant B as Browser
    participant MW as middleware.ts
    participant SB as Supabase Auth
    participant N as Next renderer
    participant P as SessionProvider
    participant S as service
    participant M as lib/mock

    B->>MW: GET /app/customers
    MW->>MW: isSupabaseConfigured()
    MW->>SB: auth.getUser()  (validates, not just decodes)
    SB-->>MW: user + app_metadata.role
    alt no user
        MW-->>B: 307 /login?next=…  (29 bytes)
    else role mismatch
        MW-->>B: 307 to the other workspace
    end
    MW-->>N: NextResponse.next() with refreshed cookies
    N-->>B: HTML shell + JS
    B->>P: hydrate
    P->>SB: getUser() again (client side)
    P->>S: businessService.list()
    S->>SB: select businesses + hours + capabilities
    SB-->>P: Business[]
    B->>S: customerService.list(businessId, params)
    S->>M: paginate(datasetFor(id).customers)
    M-->>B: Paginated<Customer>
    B->>B: skeletons → table
```

`getUser()` is called twice — once in middleware, once on hydration. That is a
confirmed redundancy, noted in `25_PERFORMANCE_ARCHITECTURE.md`.

---

## D. AI request lifecycle

**This is a simulation.** No model is contacted.

```mermaid
sequenceDiagram
    participant U as Owner
    participant PG as command/page.tsx
    participant H as use-command-run.ts
    participant WS as workflow-service
    participant CL as workflows.ts classify()
    participant BS as buildSteps()
    participant DS as business-data.ts

    U->>PG: clicks "Find overdue payments"
    PG->>H: run.submit(command)
    H->>H: phase = "planning"
    H->>WS: plan(businessId, command)
    WS->>CL: classify(command)
    CL-->>WS: "payment_followup" (keyword score)
    WS-->>H: CommandPlan {intent, scope, action, capability, requiresApproval}
    H->>WS: start(businessId, command, actor)
    WS->>BS: buildRun → buildSteps(intent, business, plan)
    BS->>DS: overduePayments(businessId)
    DS-->>BS: 17 Payment rows
    BS-->>WS: 6 WorkflowSteps, all "pending", real counts baked in
    WS-->>H: WorkflowRun
    H->>H: phase = "running"
    loop each step
        H->>H: status = "running"
        H->>H: await sleep(durationMs × 0.42, min 420 ms)
        H->>H: status = "completed"
    end
    Note over H: the approval_gate step becomes "awaiting_approval" and the loop ends
    H->>WS: complete(run) → one activity row appended in memory
    H-->>PG: phase = "awaiting_approval"
    PG-->>U: Approve / Review actions
```

**Where a real model would attach:** replace `classify()` + `buildSteps()` with a
supervisor loop. `workflow-service.plan()` and `.start()` are the only two
functions the UI calls, so the panel and step cards do not change.

---

## E. Data flow

```mermaid
flowchart LR
    subgraph gen["Import time — once per page load"]
        SEED["seed.ts<br/>NOW anchor + rngFor()"] --> RECIPES["3 TenantRecipes"]
        RECIPES --> CUST["buildCustomers → 264"]
        CUST --> PAY["buildPayments → 397<br/>quota: 17/23/14 overdue"]
        PAY --> ENRICH["enrichCustomers<br/>balance = Σ unpaid"]
        RECIPES --> APPT["buildAppointments → 780<br/>respects opening hours"]
        RECIPES --> INV["buildInventory"] & DOC["buildDocuments"]
    end

    subgraph derive["Derived on call"]
        APPR["approvals.ts<br/>items drawn from overdue rows"]
        ACT["activity.ts<br/>159 entries + recordActivity()"]
        MET["metrics.ts<br/>KPIs, series, attention"]
    end

    ENRICH & PAY & APPT & INV --> APPR & ACT & MET
    APPR & ACT & MET --> SVC["services"] --> UI["React state"] --> DOM["rendered"]

    UI -->|"approve / mark paid"| MUT["mutate the arrays in place"]
    MUT --> ACT
    MUT -.->|"lost on refresh"| GONE["∅"]

    style GONE stroke-dasharray: 5 5
```

The chain `buildPayments → enrichCustomers` is why a customer's outstanding
balance always equals the sum of their unpaid invoices — and the same reason the
seventeen the Payment Agent "finds" are the seventeen in the approval drawer.
`tests/unit/dataset.test.ts` asserts both.

---

## F. Authentication flow

```mermaid
sequenceDiagram
    participant U as User
    participant LP as login/page.tsx
    participant SP as SessionProvider
    participant AS as auth-service.ts
    participant SB as Supabase Auth
    participant DB as Postgres

    U->>LP: email + password → submit()
    LP->>SP: signIn(email, password)
    SP->>AS: authService.login()
    AS->>AS: validate shape (@, ≥6 chars)
    AS->>SB: signInWithPassword()
    alt rejected
        SB-->>AS: AuthError
        AS->>AS: authMessage() → human wording
        AS-->>LP: throw → inline alert
    end
    SB-->>AS: user + session (cookies set)
    AS->>DB: loadSession → profiles + business_users
    DB-->>AS: profile + memberships (RLS-filtered)
    AS-->>SP: {session, needsOnboarding}
    SP->>SP: status = "authenticated"
    SP->>DB: businessService.list() → real tenants
    LP->>LP: route by role
    Note over LP: PLATFORM_ADMIN → /admin/overview<br/>no workspace → /onboarding<br/>else → next param or /app/overview
```

Two things worth noting. `businessRole` on the session is the role for the
*active* workspace only (`session.ts:63`) — a user with three memberships has
three roles and the type holds one. And the role that gates `/admin` comes from
`app_metadata`, never `user_metadata`, because the user can write the latter
(`session.ts:18`, asserted in `tests/unit/auth-guard.test.ts`).

---

## G. Agent orchestration flow

**No orchestration exists.** This is what the code represents instead:

```mermaid
flowchart TD
    DATA["lib/mock/agents.ts<br/>12 objects: name, model, provider,<br/>tools[], successRate, latency"]
    DATA --> T1["app/admin/agents/page.tsx<br/>renders them as cards"]
    DATA --> T2["scripts/generate-seed.ts<br/>writes them to the agents table"]

    STEPS["buildSteps() switch<br/>9 intent branches"]
    STEPS --> STR["hard-coded actor strings:<br/>'Supervisor', 'Payment Agent',<br/>'Communication Agent'"]
    STR --> CARD["workflow-step-card.tsx<br/>renders actor as a Badge"]

    DATA -. "no link" .- STEPS

    style DATA fill:#fff3cd,color:#000
    style STEPS fill:#fff3cd,color:#000
```

The agent roster and the step actors are **two unconnected string sets**. Nothing
resolves `"Payment Agent"` in a step back to `agt_payment` in the roster. Full
detail in `05_AGENT_ARCHITECTURE.md`.

---

## H. RAG flow

**Absent.** No embeddings, no vector column, no retrieval. See
`10_RAG_ARCHITECTURE.md`.

---

## I. Background job flow

**Absent.** No queue, worker or scheduler. `16_ASYNC_PROCESSING.md` documents
the three things that resemble it.

---

## J. Error handling flow

```mermaid
flowchart TD
    subgraph sources["Where failures start"]
        S1["resolver throws<br/>in lib/mock"]
        S2["Supabase returns an error"]
        S3["form validation"]
        S4["render throws"]
    end

    S1 --> WRAP["serve() catch<br/>api-client.ts:91<br/>wrap as ApiError"]
    WRAP --> UA["useAsync catch<br/>error: string in state"]
    UA --> ES["ErrorState / inline<br/>with Try again → refetch()"]

    S2 --> AM["authMessage()<br/>auth-service.ts:79"]
    AM --> ALERT["role=alert panel<br/>on the auth page"]
    S2 --> TOAST["toast.error(...)<br/>for mutations"]

    S3 --> FIELD["Field error prop<br/>components/ui/input.tsx"]

    S4 --> EB["app/error.tsx<br/>console.error + reset()"]
    S4 --> GE["app/global-error.tsx<br/>inline styles, no providers"]
```

`ApiError` carries `status` and `path` (`api-client.ts:13`), and **no caller ever
reads them** — every consumer uses `error.message`. Noted in `26`.

---

## Frontend architecture

- **Routing:** file-based. Two route groups — `(auth)` for a shared split-screen
  layout, and nested `app/app` / `app/admin` for the two workspaces.
- **Client/server split:** pages that fetch are client components. `app/page.tsx`
  (landing), `app/not-found.tsx`, `app/robots.ts`, `app/sitemap.ts` and
  `app/opengraph-image.tsx` are server-rendered.
- **State:** React context for session; local `useState` everywhere else. No
  Redux, Zustand or React Query.
- **Data fetching:** `useAsync` — 42 lines, `{data, loading, error, refetch, mutate}`.
  Deliberately swappable for React Query later.
- **Suspense:** five pages that read `useSearchParams` wrap themselves in
  `<Suspense>` because Next requires it for static generation.

## Backend architecture

What exists: `middleware.ts` on the Edge runtime, and Supabase (Postgres, Auth,
Storage) as a hosted service. That is the entire server.

What does not: any route handler, server action, controller, repository layer, DI
container, logger or job runner.

## Database architecture

24 tables, 37 enums, 50 policies, 39 indexes, 13 triggers, 10 functions. Every
tenant table carries `business_id` and every index leads with it. Full ER diagram
in `11_DATABASE_ARCHITECTURE.md`.

## Storage architecture

One private bucket, `documents`, created in migration 9, with path convention
`{business_id}/…` and four policies keyed off the first path segment. **Nothing
uploads to it** — `documents.storage_path` is nullable and never written.

## Integration architecture

`lib/mock/platform.ts` lists eleven integrations with `requiredKeys` naming
environment variables. Ten are catalogue rows for the admin UI. One — Supabase —
is genuinely connected. See `17_EXTERNAL_INTEGRATIONS.md`.

## Infrastructure architecture

```mermaid
flowchart LR
    DEV["developer machine<br/>Windows, OneDrive"] -->|"git push"| GH["GitHub<br/>Akshaya-Reddi/AI_Business_Hub"]
    GH --> CI["Actions: verify + database"]
    CI --> V["typecheck · lint · 220 tests · build"]
    CI --> D["supabase start → db reset → test db → db lint"]
    DEV -.->|"npx supabase db push<br/>never run"| SB[("Supabase project<br/>nyfjoexwjdbwvfrzhudr")]

    style SB stroke-dasharray: 5 5
```

No deployment target is configured — no Vercel config, no Dockerfile, no
`vercel.json`. See `24_DEPLOYMENT_ARCHITECTURE.md`.
