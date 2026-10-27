# Part 7 — The owner's dashboard (STEP 23 → STEP 25)

Same story as Part 5: the dashboard screens already exist and look good — they
just run on mock data.

`/dashboard/customer-chat` has a conversation list, filters, search, a transcript
viewer, a reply box, stat cards and a chat-link card with a QR code. All of it
works. None of it is connected to anything.

This part connects it, and adds the one thing that makes the product worth
paying for: an owner who can **teach the agent** from a conversation that went
wrong.

---

## STEP 23 — The dashboard API

### Goal

Backend routes for the owner's screens, returning exactly the shapes the
frontend types already declare.

### Why?

Two decisions worth stating up front.

**First, the gate.** This is the first API a *staff member* opens, and it returns
everything: full transcripts, phone numbers, the lot. We use a shared secret
header (`X-Dashboard-Key`) plus an explicit `business_id`. That is enough for
local development and gives the frontend a stable contract. It is **not**
production authentication — anyone holding the key can read any business. The
appendix at the bottom shows the Supabase JWT swap, and the code is shaped so it
is a change to one function.

**Second, the shape.** The backend maps its rows onto the frontend's
`ConversationSession` and `ChatMessage` types, rather than inventing its own JSON
and making you rewrite components. Those types are used across the dashboard;
changing them would ripple. Mapping in Python costs twenty lines and keeps the
frontend diff tiny.

### Architecture

```
Next.js server  ──X-Dashboard-Key──►  require_dashboard_key()
                                              │
                                              ▼
                                    /api/v1/dashboard/*
                                              │  business_id from the query
                                              ▼
                                      repositories (filtered)
```

### Files involved

```
backend/app/
├── security.py                ← create
├── schemas.py                 ← edit (add four models)
├── routers/dashboard.py       ← create
└── main.py                    ← edit (mount it)
```

### Code

**`backend/app/security.py`**:

```python
"""
Request authentication for dashboard routes.

DEVELOPMENT GRADE. A shared header key proves the caller is our own frontend;
it does NOT prove which business they belong to. See the appendix in
docs/guides/customer-support-agent/07-owner-dashboard.md for the Supabase JWT
version that replaces it.
"""

import logging

from fastapi import Header, HTTPException, Query, status

from app.config import settings

logger = logging.getLogger("aibh.security")


def require_dashboard_key(x_dashboard_key: str | None = Header(default=None)) -> None:
    """FastAPI dependency: reject anything without the shared key."""
    expected = settings.dashboard_api_key
    if not expected or expected == "change-me":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DASHBOARD_API_KEY is not configured on the server",
        )
    if x_dashboard_key != expected:
        logger.warning("Dashboard request rejected: bad or missing X-Dashboard-Key")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-Dashboard-Key header",
        )


def business_scope(business_id: str = Query(..., description="Business workspace id")) -> str:
    """
    The tenant every dashboard route operates on.

    Today it comes from the query string. When Supabase Auth lands it will be
    read from the verified JWT instead — and because every route depends on
    THIS function, that is a one-function change.
    """
    if not business_id:
        raise HTTPException(status_code=400, detail="business_id is required")
    return business_id
```

**`backend/app/schemas.py`** — add below the existing models:

```python
class OwnerReply(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ResolveConversation(BaseModel):
    resolved: bool = True


class ArticleInput(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    body: str = Field(min_length=3, max_length=8000)
    tags: list[str] = Field(default_factory=list)
    is_active: bool = True


class ChatSettingsInput(BaseModel):
    chat_greeting: str | None = Field(default=None, max_length=500)
    chat_enabled: bool | None = None
    agent_persona: str | None = Field(default=None, max_length=4000)
```

**`backend/app/routers/dashboard.py`**:

```python
"""
Routes for the business owner's dashboard.

Responses deliberately match the frontend's ConversationSession / ChatMessage
types, so the React side needs no new shapes.

Every route depends on require_dashboard_key (authentication) and
business_scope (which tenant), so tenant filtering can never be forgotten.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from app.repositories import businesses as business_repo
from app.repositories import conversations as conversation_repo
from app.repositories import knowledge as knowledge_repo
from app.repositories import support as support_repo
from app.schemas import ArticleInput, ChatSettingsInput, OwnerReply, ResolveConversation
from app.security import business_scope, require_dashboard_key

logger = logging.getLogger("aibh.router.dashboard")

router = APIRouter(
    prefix="/api/v1/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(require_dashboard_key)],
)

# Backend author -> the frontend's SenderRole union.
SENDER = {"customer": "customer", "agent": "assistant", "owner": "staff", "system": "system"}


def _tz(business: dict | None) -> ZoneInfo:
    try:
        return ZoneInfo((business or {}).get("timezone") or "Asia/Kolkata")
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def _clock(iso: str | None, tz: ZoneInfo) -> str:
    """
    A short local time label, e.g. '2:04 PM' — what ChatMessage.timestamp wants.

    Note we use %I and strip the leading zero by hand. The tidier %-I is a GNU
    extension: it works on Linux and raises ValueError on Windows, which is
    where you are developing.
    """
    if not iso:
        return ""
    try:
        moment = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return ""
    return moment.astimezone(tz).strftime("%I:%M %p").lstrip("0")


def _status(row: dict) -> str:
    """conversations -> the frontend's 'active' | 'resolved' | 'escalated'."""
    if row.get("human_takeover"):
        return "escalated"
    if row.get("status") == "closed":
        return "resolved"
    return "active"


def _message(row: dict, tz: ZoneInfo) -> dict:
    return {
        "id": row["id"],
        "sender": SENDER.get(row["author"], "assistant"),
        "text": row["body"],
        "timestamp": _clock(row.get("created_at"), tz),
        # ChatMessage.metadata declares {actionType?, data?}, so extras go in `data`.
        "metadata": {"data": {"fromVoice": (row.get("meta") or {}).get("source") == "voice"}},
    }


def _session(row: dict, business: dict, messages: list[dict] | None = None) -> dict:
    tz = _tz(business)
    customer = row.get("customers") or {}
    return {
        "id": row["id"],
        "businessId": business["id"],
        "businessSlug": business["chat_slug"],
        "customerName": customer.get("name") or row.get("visitor_label") or "Visitor",
        "customerPhone": customer.get("phone"),
        "status": _status(row),
        "startedAt": row.get("created_at"),
        "lastMessageAt": row.get("last_message_at"),
        "messages": [_message(m, tz) for m in (messages or [])],
        "topic": (row.get("last_message_preview") or "")[:60],
        "summary": row.get("last_message_preview") or "",
        "source": "link",
    }


# ------------------------------------------------------------------ overview


@router.get("/stats")
def stats(business_id: str = Depends(business_scope)) -> dict:
    """The four StatCard numbers. Matches the frontend's ChatStats type."""
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    threads = conversation_repo.list_conversations(business_id, limit=500)
    today = datetime.now(_tz(business)).date().isoformat()

    return {
        "totalConversations": len(threads),
        "todayConversations": sum(
            1 for t in threads if str(t.get("last_message_at") or "").startswith(today)
        ),
        # No Booking Agent yet, so nothing books from chat. Honest zero.
        "bookingsFromChat": 0,
        "questionsAnswered": sum(1 for t in threads if not t.get("human_takeover")),
        "openRequests": support_repo.open_count(business_id),
        "business": {
            "id": business["id"],
            "name": business["name"],
            "chatSlug": business["chat_slug"],
            "chatEnabled": bool(business.get("chat_enabled")),
        },
    }


# ------------------------------------------------------------- conversations


@router.get("/conversations")
def list_conversations(business_id: str = Depends(business_scope)) -> dict:
    """
    The inbox. Each row carries its full transcript, because the list is small
    and the frontend's ConversationSession type expects `messages` to be there.
    """
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    out = []
    for row in conversation_repo.list_conversations(business_id, limit=50):
        messages = conversation_repo.messages_for(business_id, row["id"], limit=200)
        out.append(_session(row, business, messages))
    return {"conversations": out}


@router.post("/conversations/{conversation_id}/reply")
def owner_reply(
    conversation_id: str,
    payload: OwnerReply,
    business_id: str = Depends(business_scope),
) -> dict:
    """
    The owner types a message themselves.

    It lands in the same thread, so the customer's open chat window picks it up
    on its next poll. There is nothing to send — the transcript IS the channel.
    Replying also takes the thread over, so the agent stops talking across them.
    """
    business = business_repo.get_business(business_id)
    thread = conversation_repo.get(business_id, conversation_id)
    if business is None or thread is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    conversation_repo.add_message(
        business_id=business_id,
        conversation_id=conversation_id,
        direction="outbound",
        author="owner",
        body=payload.body,
        meta={"sent_by": "owner"},
    )
    conversation_repo.set_human_takeover(business_id, conversation_id, True)

    logger.info("Owner replied on conversation %s", conversation_id)
    updated = conversation_repo.get(business_id, conversation_id)
    messages = conversation_repo.messages_for(business_id, conversation_id)
    return {"conversation": _session(updated or thread, business, messages)}


@router.post("/conversations/{conversation_id}/resolve")
def resolve_conversation(
    conversation_id: str,
    payload: ResolveConversation,
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Mark a thread done: close it, hand control back to the agent, and clear any
    open handoffs attached to it.
    """
    from app.db import db

    business = business_repo.get_business(business_id)
    thread = conversation_repo.get(business_id, conversation_id)
    if business is None or thread is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.table("conversations").update(
        {"status": "closed" if payload.resolved else "open", "human_takeover": False}
    ).eq("business_id", business_id).eq("id", conversation_id).execute()

    db.table("support_requests").update(
        {
            "status": "resolved",
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "resolved_by": "owner",
        }
    ).eq("business_id", business_id).eq("conversation_id", conversation_id).eq(
        "status", "open"
    ).execute()

    updated = conversation_repo.get(business_id, conversation_id)
    messages = conversation_repo.messages_for(business_id, conversation_id)
    return {"conversation": _session(updated or thread, business, messages)}


# ------------------------------------------------------------- knowledge base


@router.get("/knowledge")
def list_knowledge(business_id: str = Depends(business_scope)) -> dict:
    """Everything the agent is allowed to say, as the frontend's FaqItem shape."""
    return {
        "faqs": [
            {"id": a["id"], "question": a["title"], "answer": a["body"], "tags": a.get("tags") or []}
            for a in knowledge_repo.list_articles(business_id)
            if a.get("is_active", True)
        ]
    }


@router.post("/knowledge")
def create_knowledge(
    payload: ArticleInput, business_id: str = Depends(business_scope)
) -> dict:
    created = knowledge_repo.create_article(
        business_id, payload.title, payload.body, payload.tags
    )
    if created is None:
        raise HTTPException(status_code=500, detail="Could not create the article")
    return {"faq": {"id": created["id"], "question": created["title"], "answer": created["body"]}}


@router.patch("/knowledge/{article_id}")
def update_knowledge(
    article_id: str, payload: ArticleInput, business_id: str = Depends(business_scope)
) -> dict:
    knowledge_repo.update_article(
        business_id,
        article_id,
        {
            "title": payload.title,
            "body": payload.body,
            "tags": payload.tags,
            "is_active": payload.is_active,
        },
    )
    return {"id": article_id, "updated": True}


@router.delete("/knowledge/{article_id}")
def delete_knowledge(article_id: str, business_id: str = Depends(business_scope)) -> dict:
    knowledge_repo.delete_article(business_id, article_id)
    return {"id": article_id, "deleted": True}


# ---------------------------------------------------------------- chat setup


@router.patch("/chat-settings")
def update_chat_settings(
    payload: ChatSettingsInput, business_id: str = Depends(business_scope)
) -> dict:
    """Greeting, on/off switch, and the owner's instructions to the agent."""
    from app.db import db

    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if patch:
        db.table("businesses").update(patch).eq("id", business_id).execute()
    return {"updated": list(patch)}
```

**`backend/app/main.py`** — update the import and mount:

```python
from app.routers import chat, dashboard, health
```

```python
app.include_router(chat.router)
app.include_router(dashboard.router)
```

### Explain the code

```python
router = APIRouter(..., dependencies=[Depends(require_dashboard_key)])
```
Declaring the dependency **on the router** applies it to every route inside,
present and future. Put it on each route individually and the day you add one in
a hurry, you forget, and it is public. Security defaults belong at the highest
level that is correct.

```python
SENDER = {"customer": "customer", "agent": "assistant", "owner": "staff", "system": "system"}
```
The whole mapping philosophy in one line. Your database says `agent`; the
frontend's `SenderRole` union says `assistant`. Translating here means
`ChatMessageBubble` — which already renders staff messages in green with a
different avatar — works untouched.

```python
return moment.astimezone(tz).strftime("%I:%M %p").lstrip("0")
```
`%-I` (hour without a leading zero) looks tidier, but it is a GNU extension: it
works on Linux, where you will deploy, and raises `ValueError` on Windows, where
you are developing. `%I` plus `lstrip("0")` behaves identically on both.

Note also that the parse and the format are in **separate** blocks. Wrapping both
in one `try: ... except ValueError: return ""` would silently swallow a format
error and give you blank timestamps everywhere, with nothing in the log.

```python
def _status(row: dict) -> str:
    if row.get("human_takeover"): return "escalated"
```
Your schema has two fields (`status`, `human_takeover`); the frontend has one
three-valued field. Escalation wins, because "a human needs to look at this" is
the most urgent thing the owner can be told.

```python
thread = conversation_repo.get(business_id, conversation_id)
```
The repository takes **both** ids. Passing only the conversation id would let
business A read business B's thread by guessing a UUID — an "insecure direct
object reference", one of the most common real-world API bugs. Filtering on
`business_id` too means a mismatch returns `None` and the route 404s.

```python
"""
It lands in the same thread, so the customer's open chat window picks it up
on its next poll. There is nothing to send — the transcript IS the channel.
"""
```
Worth pausing on, because it is the quiet advantage of owning your own channel.
On WhatsApp an owner reply means an outbound API call, a 24-hour window, a
delivery receipt and a provider that can refuse. Here it is an `INSERT`, and the
customer's browser is already asking for updates.

```python
"bookingsFromChat": 0,
```
An honest zero rather than a fake number. The Booking Agent does not exist yet,
so nothing books from chat. Inventing a statistic in a dashboard is how people
stop trusting dashboards.

```python
conversation_repo.set_human_takeover(business_id, conversation_id, True)
```
Replying always takes over. If the owner has started typing personally, the agent
must stop talking over them. `resolve` hands control back.

### Commands

Create the two files, edit `schemas.py` and `main.py`. uvicorn reloads.

### How to test

```powershell
$key = "PASTE_YOUR_DASHBOARD_API_KEY"
$biz = "a1b2c3d4-0000-4000-8000-000000000001"

curl.exe -s "http://127.0.0.1:8000/api/v1/dashboard/stats?business_id=$biz"
curl.exe -s -H "X-Dashboard-Key: $key" "http://127.0.0.1:8000/api/v1/dashboard/stats?business_id=$biz"
curl.exe -s -H "X-Dashboard-Key: $key" "http://127.0.0.1:8000/api/v1/dashboard/conversations?business_id=$biz"
curl.exe -s -H "X-Dashboard-Key: $key" "http://127.0.0.1:8000/api/v1/dashboard/knowledge?business_id=$biz"
```

### Expected result

Without the key: `{"detail":"Missing or invalid X-Dashboard-Key header"}`.

With it:

```json
{"totalConversations":3,"todayConversations":2,"bookingsFromChat":0,"questionsAnswered":2,"openRequests":1,
 "business":{"id":"a1b2c3d4-...","name":"Pulse Fitness Studio","chatSlug":"pulse-fitness","chatEnabled":true}}
```

The conversations list shows your real chats from Part 5, each with `messages`
already populated and `customerName` falling back to `"Visitor 4821"` for anyone
who never identified themselves.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `DASHBOARD_API_KEY is not configured` | Still the placeholder | Set a real random value in `.env` and restart. |
| `422 ... business_id Field required` | Missing query param | Add `?business_id=...`. |
| Timestamps are empty strings | `%-I` on Windows, or a bad `created_at` | Use `%I` + `lstrip("0")` as shown; keep parse and format in separate try blocks. |
| `KeyError: 'customers'` | The join returned nothing | Use `(row.get("customers") or {})`, as the code does. |
| PowerShell mangles the URL | `&` splits commands | Wrap the whole URL in double quotes. |

---

## STEP 24 — Wire the Customer Chat screen

### Goal

Make `/dashboard/customer-chat` show real conversations, and make the owner's
reply reach the customer.

### Why?

The page is fully built — list, filters, search, transcript, reply box, stat
cards, chat-link card with QR. It imports `mockConversations` and mutates local
state.

We swap the data source and the two handlers. The layout does not change at all.

### Architecture

```
Browser (dashboard)          Next.js server            FastAPI
      │                            │                      │
      │ /api/hub/dashboard/... ───►│ adds X-Dashboard-Key ─►
      │                            │                      │
      ◄────────────── conversations ──────────────────────┘
```

The dashboard goes through a **server-side proxy** so the key never reaches the
browser. That is the opposite of the public chat, which calls FastAPI directly
because it has no secret. Same backend, two access patterns, each with the right
shape.

### Files involved

```
frontend/
├── .env.local                                   ← edit (three variables)
├── src/app/api/hub/[...path]/route.ts           ← create (the proxy)
├── src/lib/api/dashboard.ts                     ← create
├── src/lib/constants.ts                         ← edit (real chat URL)
└── src/app/dashboard/customer-chat/page.tsx     ← edit (five changes)
```

### Code

**`frontend/.env.local`** — add:

```text
# ---------------------------------------------------------- owner dashboard
# Server-only. No NEXT_PUBLIC_ prefix, so these never reach the browser.
HUB_API_BASE_URL=http://127.0.0.1:8000
HUB_DASHBOARD_KEY=paste-the-same-value-as-DASHBOARD_API_KEY-in-backend-env

# Which Supabase business the dashboard reads. Temporary scaffolding until
# Supabase Auth supplies the real workspace id.
NEXT_PUBLIC_LIVE_BUSINESS_ID=a1b2c3d4-0000-4000-8000-000000000001
```

**`frontend/src/app/api/hub/[...path]/route.ts`**:

```ts
/**
 * Server-side proxy to the FastAPI dashboard API.
 *
 * The browser calls /api/hub/<anything>; this forwards it to
 * <HUB_API_BASE_URL>/api/v1/<anything> with the dashboard key attached. The key
 * stays on the server, so it never reaches the client bundle.
 *
 * The PUBLIC chat does NOT go through here — it has no secret and talks to
 * FastAPI directly. Only the owner's screens need this.
 */

import { NextResponse } from "next/server";

const BASE_URL = process.env.HUB_API_BASE_URL ?? "http://127.0.0.1:8000";
const DASHBOARD_KEY = process.env.HUB_DASHBOARD_KEY ?? "";

/** Never cache: this is live operational data. */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: Context, method: string) {
  const { path } = await context.params;
  const search = new URL(request.url).search;
  const target = `${BASE_URL}/api/v1/${path.join("/")}${search}`;

  if (!DASHBOARD_KEY) {
    return NextResponse.json(
      { detail: "HUB_DASHBOARD_KEY is not set in frontend/.env.local" },
      { status: 500 },
    );
  }

  const body = method === "GET" || method === "DELETE" ? undefined : await request.text();

  try {
    const response = await fetch(target, {
      method,
      headers: { "Content-Type": "application/json", "X-Dashboard-Key": DASHBOARD_KEY },
      body,
      cache: "no-store",
    });

    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        detail: "Could not reach the backend.",
        target,
        cause: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: Context) {
  return forward(request, context, "GET");
}
export async function POST(request: Request, context: Context) {
  return forward(request, context, "POST");
}
export async function PATCH(request: Request, context: Context) {
  return forward(request, context, "PATCH");
}
export async function DELETE(request: Request, context: Context) {
  return forward(request, context, "DELETE");
}
```

**`frontend/src/lib/api/dashboard.ts`**:

```ts
/**
 * Client for the owner's dashboard API.
 *
 * Always goes through /api/hub, which is a Next.js route handler that attaches
 * the dashboard key server-side. Nothing secret reaches the browser.
 */

import type { ChatStats, ConversationSession, FaqItem } from "@/types";

export const LIVE_BUSINESS_ID = process.env.NEXT_PUBLIC_LIVE_BUSINESS_ID ?? "";

export interface DashboardStats extends ChatStats {
  openRequests: number;
  business: { id: string; name: string; chatSlug: string; chatEnabled: boolean };
}

export class HubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HubError";
  }
}

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const params = new URLSearchParams({ business_id: LIVE_BUSINESS_ID });

  const response = await fetch(`/api/hub/dashboard${path}?${params.toString()}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new HubError(text.slice(0, 200) || "Unreadable response", response.status);
  }

  if (!response.ok) {
    const detail =
      (body as { detail?: string } | null)?.detail ?? `Request failed (${response.status})`;
    throw new HubError(detail, response.status);
  }

  return body as T;
}

export const dashboardApi = {
  stats: () => call<DashboardStats>("/stats"),

  conversations: () =>
    call<{ conversations: ConversationSession[] }>("/conversations").then((r) => r.conversations),

  reply: (conversationId: string, body: string) =>
    call<{ conversation: ConversationSession }>(`/conversations/${conversationId}/reply`, {
      method: "POST",
      body: { body },
    }).then((r) => r.conversation),

  resolve: (conversationId: string) =>
    call<{ conversation: ConversationSession }>(`/conversations/${conversationId}/resolve`, {
      method: "POST",
      body: { resolved: true },
    }).then((r) => r.conversation),

  knowledge: () => call<{ faqs: FaqItem[] }>("/knowledge").then((r) => r.faqs),

  createArticle: (question: string, answer: string, tags: string[] = []) =>
    call<{ faq: FaqItem }>("/knowledge", {
      method: "POST",
      body: { title: question, body: answer, tags, is_active: true },
    }).then((r) => r.faq),

  updateArticle: (id: string, question: string, answer: string, tags: string[] = []) =>
    call<{ updated: boolean }>(`/knowledge/${id}`, {
      method: "PATCH",
      body: { title: question, body: answer, tags, is_active: true },
    }),

  deleteArticle: (id: string) =>
    call<{ deleted: boolean }>(`/knowledge/${id}`, { method: "DELETE" }),

  updateChatSettings: (patch: { chat_greeting?: string; chat_enabled?: boolean; agent_persona?: string }) =>
    call<{ updated: string[] }>("/chat-settings", { method: "PATCH", body: patch }),
};
```

**`frontend/src/lib/constants.ts`** — replace the chat URL helper:

```ts
/**
 * Frontend-wide constants.
 */

/** Fixed "today" used by the remaining mock screens so they render deterministically. */
export const MOCK_TODAY = "2026-09-23";

/**
 * The public chat link an owner shares.
 *
 * Uses the real origin in the browser so the link works in development and in
 * production without configuration. Falls back to the configured site URL when
 * rendering on the server.
 */
export function getPublicChatUrl(slug: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${origin}/chat/${slug}`;
}
```

**`frontend/src/app/dashboard/customer-chat/page.tsx`** — five changes.

**1.** Replace the mock imports:

```tsx
import { mockConversations, mockChatStats, mockBusiness } from "@/data";
```

with:

```tsx
import { dashboardApi, HubError, LIVE_BUSINESS_ID, type DashboardStats } from "@/lib/api/dashboard";
```

**2.** Replace the state block at the top of the component:

```tsx
  const [conversations, setConversations] = useState<ConversationSession[]>(mockConversations);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(mockConversations.find((c) => c.status === "escalated")?.id ?? mockConversations[0]?.id ?? null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
```

with:

```tsx
  const [conversations, setConversations] = useState<ConversationSession[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  /** Refetch everything. Also runs on a 6-second poll so new chats appear. */
  const refresh = React.useCallback(async () => {
    try {
      const [rows, live] = await Promise.all([dashboardApi.conversations(), dashboardApi.stats()]);
      setConversations(rows);
      setStats(live);
      setLoadError(null);
      setSelectedId((current) => current ?? rows.find((c) => c.status === "escalated")?.id ?? rows[0]?.id ?? null);
    } catch (error) {
      setLoadError(error instanceof HubError ? error.message : "Could not load conversations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!LIVE_BUSINESS_ID) {
      setLoading(false);
      setLoadError("Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.");
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => clearInterval(timer);
  }, [refresh]);
```

Add `useEffect` to the React import at the top of the file.

**3.** Replace the two handlers:

```tsx
  const handleReply = async (id: string, text: string) => {
    try {
      const updated = await dashboardApi.reply(id, text);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
      showToast("Reply sent — the customer sees it in their chat window.");
    } catch (error) {
      showToast(error instanceof HubError ? error.message : "Could not send the reply.", "error");
    }
  };

  const handleResolve = async (id: string) => {
    try {
      const updated = await dashboardApi.resolve(id);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
      showToast("Conversation resolved. The assistant is back in control.");
    } catch (error) {
      showToast(error instanceof HubError ? error.message : "Could not resolve.", "error");
    }
  };
```

**4.** Replace the `ChatLinkCard` and `StatCard` block:

```tsx
      <ChatLinkCard businessName={mockBusiness.name} slug={mockBusiness.slug} onCopied={() => showToast("Chat link copied.")} />
```

with:

```tsx
      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          {loadError}
        </div>
      )}

      {stats && (
        <ChatLinkCard
          businessName={stats.business.name}
          slug={stats.business.chatSlug}
          onCopied={() => showToast("Chat link copied.")}
        />
      )}
```

and change the four stat cards to read from `stats`. `CalendarCheck` becomes
unused in this file — drop it from the `lucide-react` import line:

```tsx
        <StatCard label="Total Conversations" value={(stats?.totalConversations ?? 0).toLocaleString("en-US")} icon={MessagesSquare} tone="indigo" hint="Since you went live" />
        <StatCard label="Today's Conversations" value={stats?.todayConversations ?? 0} icon={Sun} tone="blue" hint={`${counts.needs_reply} waiting for your reply`} />
        <StatCard label="Needs Your Reply" value={stats?.openRequests ?? 0} icon={MessageSquare} tone="amber" hint="Escalations and callbacks" />
        <StatCard label="Questions Answered" value={stats?.questionsAnswered ?? 0} icon={HelpCircle} tone="purple" hint="Without staff help" />
```

**5.** Show a loading state instead of an empty list. Just above
`<ConversationList ...>`:

```tsx
            {loading ? (
              <p className="text-xs text-gray-500 px-1 py-6 text-center">Loading conversations…</p>
            ) : (
```

and close the ternary after the component:

```tsx
            )}
```

### Explain the code

```ts
headers: { "X-Dashboard-Key": DASHBOARD_KEY }
```
The whole point of the proxy. This line runs on the Next.js **server**.
`process.env.HUB_DASHBOARD_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js refuses
to include it in the browser bundle — it is literally `undefined` if you try to
read it from a client component.

```ts
const timer = setInterval(() => void refresh(), 6000);
return () => clearInterval(timer);
```
Live updates by polling. Supabase Realtime would be more elegant; polling is
trivially debuggable and six seconds is fine for an inbox. The cleanup matters —
forget it and you leak a timer on every navigation.

```tsx
setSelectedId((current) => current ?? rows.find((c) => c.status === "escalated")?.id ?? rows[0]?.id ?? null);
```
Picks a sensible default **only on first load** — the `current ??` guard means a
poll never yanks the selection away while the owner is reading. It prefers an
escalated thread, because that is the one waiting on them.

```tsx
const updated = await dashboardApi.reply(id, text);
setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
```
The API returns the whole updated conversation, so the UI replaces the row rather
than guessing what changed. No optimistic update here on purpose: the owner needs
to know the reply actually landed, and the round trip is fast.

```tsx
showToast("Reply sent — the customer sees it in their chat window.");
```
The old copy said "(simulated)". Removing that word is the smallest diff in this
guide and the most satisfying.

```ts
typeof window !== "undefined" ? window.location.origin : ...
```
`getPublicChatUrl` was hardcoded to `https://yourplatform.com/chat`, which meant
the copy-link button handed owners a dead URL. Using the real origin makes it
correct in development and in production with no configuration.

```python
"bookingsFromChat": 0,
```
Notice the stat card was relabelled to **Needs Your Reply** rather than showing a
fake booking count. Better an honest metric than a decorative one.

### How to test

Two browser windows side by side:

- **Left:** <http://localhost:3000/chat/pulse-fitness> (the customer)
- **Right:** <http://localhost:3000/dashboard/customer-chat> (the owner)

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Customer: "what are your fees?" | Reply on the left; the thread appears on the right within 6 s |
| 2 | Owner: open the thread | The full conversation, real timestamps |
| 3 | Customer: "I want a refund" | Escalates; the row turns to **Needs Reply** on the right |
| 4 | Owner: type a reply, send | **It appears in the customer's window within 5 s**, in green |
| 5 | Customer: send another message | Stored, but no AI reply — the human has it |
| 6 | Owner: click **Resolve** | Thread closes; the assistant is back in control |
| 7 | Customer: send another message | The agent answers again |
| 8 | Owner: copy the chat link | It is `http://localhost:3000/chat/pulse-fitness`, and it works |

### Expected result

**Test 4 is the one that matters.** The owner types in their dashboard and the
words appear in the customer's chat window, with no messaging provider involved
at all. That is the payoff for owning the channel.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| "Set NEXT_PUBLIC_LIVE_BUSINESS_ID…" | Missing env var | Add it and **restart** `npm run dev`. |
| `502 Could not reach the backend` | uvicorn not running | Start terminal 1. |
| `401 invalid X-Dashboard-Key` | Keys differ | `HUB_DASHBOARD_KEY` must equal `DASHBOARD_API_KEY`. |
| Owner's reply never reaches the customer | Polling only runs when the thread is handed over | Replying sets takeover automatically — check the customer tab is open. |
| `404` from the proxy | Folder name wrong | It must be literally `[...path]` under `src/app/api/hub/`. |
| `Property 'path' does not exist on type 'Promise'` | Missing `await context.params` | Next.js 15+ requires it. |
| Conversation list flickers or jumps | Selection reset on each poll | Keep the `current ??` guard in `setSelectedId`. |

---

## STEP 25 — Teach the agent

### Goal

Let the owner add and edit the agent's knowledge from the Settings screen, so
the next customer gets a better answer.

### Why?

This is what turns the project from a demo into something a business would pay
for.

In STEP 13 you watched the agent say *"I don't have anything on that"* when asked
about protein powder. Right now the only fix is for **you** to write SQL. That
does not scale past one customer.

The Settings screen already has a FAQ editor — add, edit, delete, with proper
labels. It saves to local state and forgets on reload. We point it at
`knowledge_articles` instead. After that, the owner reads a conversation, sees
the gap, types the answer, and the very next customer gets it right. No deploy,
no developer, no ticket.

### Architecture

```
Owner reads a chat where the agent said "I don't know"
      │
      ▼  Settings → AI Assistant → Add FAQ
      │
POST /api/hub/dashboard/knowledge
      │
knowledge_articles   →  search_vector regenerates automatically (STEP 3)
      │
      ▼
Next customer asks the same thing, in different words
      │
      ▼  search_knowledge finds it  →  correct answer
```

### Files involved

```
frontend/src/app/dashboard/settings/page.tsx     ← edit (four changes)
```

### Code

**1.** Add to the imports:

```tsx
import { useEffect } from "react";
import { dashboardApi, HubError, LIVE_BUSINESS_ID } from "@/lib/api/dashboard";
```

**2.** Load the real knowledge base on mount. Add after the `useToast` line:

```tsx
  /** Knowledge lives in the database; the rest of this screen is still mock. */
  useEffect(() => {
    if (!LIVE_BUSINESS_ID) return;
    (async () => {
      try {
        const faqs = await dashboardApi.knowledge();
        setAssistant((a) => ({ ...a, faqs }));
        setSaved((s) => ({ ...s, assistant: { ...s.assistant, faqs } }));
      } catch {
        showToast("Could not load the knowledge base.", "error");
      }
    })();
  }, [showToast]);
```

**3.** Replace the `save` function:

```tsx
  const save = async () => {
    if (!profile.name.trim()) {
      setSection("profile");
      showToast("Business name can't be empty.", "error");
      return;
    }
    setSaving(true);

    try {
      // --- knowledge base: diff the FAQ list against what we last saved ---
      const before = new Map(saved.assistant.faqs.map((f) => [f.id, f]));
      const after = new Map(assistant.faqs.map((f) => [f.id, f]));

      const created: typeof assistant.faqs = [];

      for (const faq of assistant.faqs) {
        const question = faq.question.trim();
        const answer = faq.answer.trim();
        if (question.length < 3 || answer.length < 3) continue; // skip half-typed rows

        const previous = before.get(faq.id);
        if (!previous) {
          created.push(await dashboardApi.createArticle(question, answer));
        } else if (previous.question !== question || previous.answer !== answer) {
          await dashboardApi.updateArticle(faq.id, question, answer);
        }
      }

      for (const faq of saved.assistant.faqs) {
        if (!after.has(faq.id)) await dashboardApi.deleteArticle(faq.id);
      }

      // --- chat settings that live on the businesses row ---
      await dashboardApi.updateChatSettings({
        chat_greeting: assistant.greeting,
        chat_enabled: assistant.chatEnabled,
      });

      // Re-read so local ids are replaced by real database ids.
      const faqs = await dashboardApi.knowledge();
      const next = { ...assistant, faqs };
      setAssistant(next);
      setSaved({ profile, assistant: next });
      showToast(
        created.length > 0
          ? `Saved. The assistant can now answer ${created.length} new question${created.length === 1 ? "" : "s"}.`
          : "Settings saved. Your customer chat is updated.",
      );
    } catch (error) {
      showToast(error instanceof HubError ? error.message : "Could not save.", "error");
    } finally {
      setSaving(false);
    }
  };
```

**4.** The Save button already calls `save`; just make sure it awaits nothing
special — `onClick={save}` still works because `save` returns a promise React
ignores. If your linter objects, use `onClick={() => void save()}`.

### Explain the code

```tsx
const before = new Map(saved.assistant.faqs.map((f) => [f.id, f]));
```
A diff, not a blind overwrite. The editor works on a local array; we compare it
to what we last saved and issue only the calls that are needed — create for new
rows, update for changed ones, delete for removed ones.

The alternative (delete everything, re-insert) would churn ids and lose the
`embedding` column the day you add semantic search.

```tsx
if (question.length < 3 || answer.length < 3) continue;
```
The editor adds an **empty** FAQ row when you click "Add", and the owner may
leave it half-typed. Sending that to the API returns a 422 and a scary toast.
Skipping incomplete rows silently is the kinder behaviour.

```tsx
const faqs = await dashboardApi.knowledge();
```
Re-reading after saving matters. New rows were created with a client-side id like
`faq-1738…`; the database gave them real UUIDs. Without this refresh, editing a
just-created FAQ would try to `PATCH /knowledge/faq-1738…` and 404.

```tsx
showToast(`Saved. The assistant can now answer ${created.length} new question…`)
```
Tells the owner what actually changed, in their terms. "Settings saved" is true
and useless; "the assistant can now answer 2 new questions" is why they came.

```tsx
await dashboardApi.updateChatSettings({ chat_greeting: ..., chat_enabled: ... })
```
Two fields that live on the `businesses` row rather than in the knowledge base.
The greeting is the first thing every customer reads, and `chat_enabled` is the
off switch — worth wiring even though the rest of the Settings screen is still
mock.

**Be clear about what is still mock here:** business profile, working hours and
services save to local state only. They are read by the chat (via
`GET /chat/business/...`), so editing them in the dashboard will not change the
chat until you wire those sections too — the same diff pattern, against
`businesses` and `business_services`. Knowledge is wired first because it is the
one that changes what the agent *says*.

### How to test

The full loop. Do all six steps in order.

1. **Customer:** open `/chat/pulse-fitness`, ask *"do you sell protein powder?"*
   The agent says it does not know and offers a callback.
2. **Owner:** `/dashboard/settings` → **AI Assistant** → **Add FAQ**.
   - Question: `Do you sell protein powder?`
   - Answer: `Yes — we stock whey and plant protein at the front desk. A 1kg tub is ₹2,400 for members.`
3. Click **Save Changes**.
4. **Customer:** in the same chat, ask *"what about protein supplements?"* —
   deliberately different wording.
5. The agent answers correctly, with your price.
6. Reload the Settings page — your FAQ is still there, now with a database id.

### Expected result

Step 5 is the whole point. The owner taught the agent something in twenty
seconds, the customer phrased it differently, and full-text search still found
it — because `to_tsvector` stems "supplements" and "protein" matched.

No deploy. No developer. That is the product.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| FAQ saves but the agent still says "I don't know" | Search did not match | Test the SQL directly: `select * from search_knowledge('<business_id>','protein',5);` Add words customers use. |
| `422 Unprocessable Entity` | Title or body under 3 characters | The save function skips incomplete rows; check you filled both. |
| Editing a new FAQ 404s | Page not refreshed after create | Keep the `await dashboardApi.knowledge()` re-read. |
| FAQs vanish on reload | The load effect is missing | Change 2 must run on mount. |
| Changing the greeting does nothing in the chat | The customer has an open session | The greeting is stored when a session starts. Reload the chat page. |
| Editing services/hours has no effect | Those sections are still mock | Expected, and stated above. Wire them with the same diff pattern. |

---

## End of Guide 1

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
npm run lint
```

> This frontend has **no test runner** — no vitest, no `npm run verify`.
> Typecheck plus lint is the check.

### Full system checklist

- [ ] Two terminals: uvicorn and `npm run dev`
- [ ] `/chat/pulse-fitness` answers using real database content
- [ ] It refuses to invent anything it cannot look up
- [ ] Reloading the chat keeps the conversation
- [ ] The microphone transcribes speech and gets an answer
- [ ] Refunds and medical questions escalate to a human
- [ ] A phone number creates a customer and a callback request
- [ ] The owner sees every conversation with real timestamps
- [ ] The owner's reply appears in the customer's window within 5 seconds
- [ ] Adding a FAQ changes the next answer
- [ ] The chat link copies a URL that actually works
- [ ] Rate limits hold under a burst
- [ ] `npx tsc --noEmit` and `npm run lint` pass

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add backend frontend database docs
git status --short          # confirm no .env files are listed
git commit -m "Wire the owner dashboard to the Customer Support Agent"
```

**You have built a working, multi-tenant, tool-using AI support agent with voice
input, a human handoff path, and an owner-editable knowledge base — end to end.**

### What is still mock, honestly

The dashboard has many screens; you wired the ones the Customer Support Agent
needs. These still run on `src/data/mock-*.ts`:

| Screen | Belongs to |
| --- | --- |
| Bookings | the Booking Agent |
| Payments, invoices | the Payment Agent |
| Inventory | the Inventory Agent |
| Documents | the Document Agent |
| Reports, Admin console | later, once there is real data to report on |
| Settings → profile, hours, services | wire with the same diff pattern when you need them |

That is not technical debt; it is scope. Each one gets real when its agent does.

---

## Appendix — replacing the dashboard key with Supabase Auth

When you are ready for real users, this is the whole change. The frontend signs
in with Supabase Auth and sends the access token:

```
Authorization: Bearer <supabase access token>
```

Then `app/security.py` becomes:

```python
from fastapi import Depends, Header, HTTPException, status

from app.db import db, one


def current_user(authorization: str | None = Header(default=None)) -> dict:
    """Verify the Supabase JWT and return the user it belongs to."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        result = db.auth.get_user(token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    user = getattr(result, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"id": user.id, "email": user.email}


def business_scope(business_id: str, user: dict = Depends(current_user)) -> str:
    """Prove this user is a member of the business they asked for."""
    member = one(
        db.table("business_members")
        .select("id, role")
        .eq("business_id", business_id)
        .eq("user_id", user["id"])
        .limit(1)
        .execute()
    )
    if member is None:
        raise HTTPException(status_code=403, detail="Not a member of this business")
    return business_id
```

Every route already depends on `business_scope`, so **no route changes**. That is
why the dependency exists.

The public chat routes are unaffected — they are supposed to be anonymous.

Problems? [08-troubleshooting.md](08-troubleshooting.md).
