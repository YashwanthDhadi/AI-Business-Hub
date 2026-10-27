# Part 5 — Connect the chat to your backend (STEP 18 → STEP 20)

Good news: **you do not have to build a chat UI.** The frontend already has one —
a polished, mobile-first, dark-themed chat at `/chat/[businessSlug]`, with quick
actions, typing indicators and message bubbles.

What it does not have is a brain. Right now it talks to
`src/features/customer-chat/mockAssistant.ts`, a rule-based fake that runs
entirely in the browser and invents everything.

This part replaces that fake with the real agent you built in Part 3. The UI
barely changes; what changes is where the answers come from.

```
BEFORE                                  AFTER

CustomerChatApp                         CustomerChatApp
      │                                       │
      ▼                                       ▼  fetch
mockAssistant.ts  (browser)             FastAPI /api/v1/chat/*
      │                                       │
  invented answers                      OpenRouter + Supabase
                                              │
                                        real prices, real policies
```

---

## STEP 18 — A public business endpoint, and the API client

### Goal

Add one backend route that describes a business publicly, and one frontend file
that talks to all the chat endpoints.

### Why?

The chat page is a **server component**. Before any conversation starts it needs
the business's name, services and greeting so it can render the header and set
the page title. Your `POST /chat/session` route returns some of that, but only
after a session exists — too late for `generateMetadata`.

So we add `GET /api/v1/chat/business/{slug}`. It is public and read-only, and it
returns exactly the shape the frontend already uses (`BusinessProfile` and
`AssistantSettings`), so no component or type has to change.

**One thing it deliberately does not return: your knowledge base.** The agent
reads `knowledge_articles` server-side; publishing them to the browser would let
anyone scrape every policy the business has written. `faqs` comes back empty and
that is correct.

### Architecture

```
Browser opens /chat/pulse-fitness
      │
      ▼  (server component, on the Next.js server)
GET /api/v1/chat/business/pulse-fitness
      │
      ▼
  { profile: {...}, assistant: {...} }   ← same shape as the mock data
      │
      ▼
CustomerChatApp renders the header, then opens a session
```

### Files involved

```
backend/app/
├── services/chat.py       ← edit (add public_business)
└── routers/chat.py        ← edit (add one route)

frontend/
├── .env.local             ← edit (one variable)
└── src/lib/api/chat.ts    ← create
```

### Code

**`backend/app/services/chat.py`** — add this near the top, below `AGENT_KEY`:

```python
# The frontend uses a colour name; the chat header needs a real hex value.
ACCENT_HEX = {
    "indigo": "#6366f1",
    "emerald": "#10b981",
    "rose": "#f43f5e",
    "amber": "#f59e0b",
    "sky": "#0ea5e9",
    "violet": "#8b5cf6",
}

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
```

and this function at the bottom of the file:

```python
def public_business(chat_slug: str) -> dict:
    """
    Everything the public chat page may know about a business.

    Read-only, unauthenticated, and deliberately narrow: no owner contact
    details beyond what a customer would see on a shopfront, and NO knowledge
    base. The agent reads that server-side; publishing it would let anyone
    scrape every policy the owner has written.
    """
    from app.repositories import businesses as repo

    business = repo.get_business_by_chat_slug(chat_slug)
    if business is None:
        raise ChatError("This chat link is not available.", status_code=404)

    hours = []
    for entry in business.get("hours") or []:
        index = int(entry.get("day", 0)) % 7
        hours.append(
            {
                "day": DAY_NAMES[index],
                "isOpen": not entry.get("closed"),
                "openTime": entry.get("open") or "09:00",
                "closeTime": entry.get("close") or "18:00",
            }
        )

    services = [
        {
            "id": s["id"],
            "name": s["name"],
            "description": s.get("description") or "",
            "durationMinutes": s.get("duration_minutes") or 0,
            "price": float(s.get("price") or 0),
        }
        for s in repo.list_services(business["id"])
    ]

    location = business.get("location") or ""
    accent = business.get("chat_accent") or "indigo"

    return {
        "profile": {
            "id": business["id"],
            "name": business["name"],
            "slug": business["chat_slug"],
            "type": (business.get("business_type") or "business").title(),
            "tagline": "Ask us anything, any time.",
            "description": business.get("description") or "",
            "email": business.get("owner_email") or "",
            "phone": business.get("owner_phone") or "",
            "address": location,
            "city": location.split(",")[-1].strip() if location else "",
            "currency": business.get("currency") or "INR",
            "workingHours": hours,
            "services": services,
            "enabledCapabilities": [],
        },
        "assistant": {
            "assistantName": "Assistant",
            "greeting": business.get("chat_greeting") or "Hi! How can I help you today?",
            "tone": "friendly",
            "businessDescription": business.get("description") or "",
            # Never published. The agent uses the knowledge base server-side.
            "faqs": [],
            "allowBookings": False,      # the Booking Agent turns this on later
            "requireBookingApproval": True,
            "handoffToStaff": True,
            "voiceInputEnabled": True,
            "chatEnabled": bool(business.get("chat_enabled")),
            "brandColor": ACCENT_HEX.get(accent, ACCENT_HEX["indigo"]),
        },
    }
```

**`backend/app/routers/chat.py`** — add this route:

```python
@router.get("/business/{chat_slug}")
def get_business(chat_slug: str) -> dict:
    """Public profile for a business's chat page. No authentication."""
    try:
        return chat_service.public_business(chat_slug)
    except chat_service.ChatError as error:
        raise _fail(error) from error
```

**`frontend/.env.local`** — add at the bottom:

```text
# ------------------------------------------------------- public chat backend
# Browser-visible on purpose: the chat API is public and holds no secret.
NEXT_PUBLIC_CHAT_API_URL=http://127.0.0.1:8000
```

**`frontend/src/lib/api/chat.ts`**:

```ts
/**
 * Client for the public chat API.
 *
 * The only file that talks to FastAPI's /api/v1/chat routes, and the only one
 * that touches localStorage.
 *
 * The public chat calls FastAPI directly rather than through a Next.js proxy:
 * this API is public by design, there is no secret to hide, and the browser's
 * own CORS check is exactly the right mechanism for "which sites may call
 * this". The owner's dashboard in Part 7 is the opposite case.
 */

import type { AssistantSettings, BusinessProfile } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://127.0.0.1:8000";
const PREFIX = "/api/v1/chat";

/* ------------------------------------------------------------------- types */

export interface PublicBusinessResponse {
  profile: BusinessProfile;
  assistant: AssistantSettings;
}

export interface ChatSession {
  session_token: string;
  conversation_id: string;
  business: { name: string; chat_slug?: string; accent?: string; location?: string };
  greeting: string;
}

export interface ChatTurn {
  id: string;
  role: "customer" | "agent";
  author: "customer" | "agent" | "owner" | "system";
  body: string;
  created_at: string;
}

export interface ChatHistory {
  business: { name: string; accent?: string };
  handed_over: boolean;
  messages: ChatTurn[];
}

export interface ChatReply {
  reply: string | null;
  handed_over: boolean;
  notice: string | null;
  latency_ms?: number;
}

export interface ChatVoiceReply extends ChatReply {
  transcript: string;
}

/* ------------------------------------------------------------------ errors */

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    /** Seconds to wait, from the Retry-After header. 0 when not rate limited. */
    readonly retryAfter = 0,
  ) {
    super(message);
    this.name = "ChatApiError";
  }

  /** The session is gone; the page should quietly start a new one. */
  get isExpiredSession() {
    return this.status === 401;
  }
}

/* ----------------------------------------------------------------- storage */

const storageKey = (slug: string) => `aibh.chat.${slug}`;

/** localStorage throws in some private-browsing modes — never let that crash the page. */
export function readToken(slug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
}

export function writeToken(slug: string, token: string) {
  try {
    window.localStorage.setItem(storageKey(slug), token);
  } catch {
    /* the session simply will not survive a reload */
  }
}

export function clearToken(slug: string) {
  try {
    window.localStorage.removeItem(storageKey(slug));
  } catch {
    /* nothing to do */
  }
}

/* --------------------------------------------------------------- transport */

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail ?? fallback;
    const retryAfter = Number(response.headers.get("Retry-After") ?? 0) || 0;
    throw new ChatApiError(detail, response.status, retryAfter);
  }

  return body as T;
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${PREFIX}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Chat-Session": token } : {}),
        ...(headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new ChatApiError(
      "Could not reach the assistant. Please check your connection.",
      0,
    );
  }

  return parse<T>(response, `Something went wrong (${response.status}).`);
}

/* ------------------------------------------------------------------- calls */

export const chatApi = {
  /** Called from the SERVER component — no token, no localStorage. */
  business: (slug: string) =>
    request<PublicBusinessResponse>(`/business/${encodeURIComponent(slug)}`),

  startSession: (slug: string) =>
    request<ChatSession>("/session", {
      method: "POST",
      body: JSON.stringify({ chat_slug: slug }),
    }),

  sendMessage: (token: string, message: string) =>
    request<ChatReply>("/message", {
      method: "POST",
      token,
      body: JSON.stringify({ message }),
    }),

  history: (token: string) => request<ChatHistory>("/history", { token }),

  sendVoice: async (token: string, audio: Blob): Promise<ChatVoiceReply> => {
    const form = new FormData();
    // The filename extension matters — the backend maps it for Whisper.
    const extension = audio.type.includes("mp4") ? "mp4" : "webm";
    form.append("file", audio, `recording.${extension}`);

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${PREFIX}/voice`, {
        method: "POST",
        // NO Content-Type header: the browser must set the multipart boundary.
        headers: { "X-Chat-Session": token },
        body: form,
        cache: "no-store",
      });
    } catch {
      throw new ChatApiError("Could not reach the assistant.", 0);
    }

    return parse<ChatVoiceReply>(response, "Could not send that recording.");
  },
};
```

### Explain the code

```python
raise ChatError("This chat link is not available.", status_code=404)
```
The same error type the rest of the chat service uses, so the route layer
translates it to HTTP without a second `try/except`. The message is written for
a customer, not a developer.

```python
"faqs": [],
```
Worth pausing on. The mock frontend put the FAQ list in the browser because it
had to — there was no server. Now there is one, and publishing the knowledge base
would let a competitor download every policy the owner wrote. The agent searches
it server-side; the browser never sees it.

```python
"allowBookings": False,
```
Honest about scope. The chat UI has a whole booking flow built in — slot pickers,
confirmation cards — and your Customer Support Agent cannot book anything. This
flag keeps that UI dormant until the Booking Agent exists. Nothing is deleted;
it simply never triggers.

```python
DAY_NAMES[index] ... "isOpen": not entry.get("closed")
```
Shape translation. Your database stores `{"day": 0, "closed": false}`; the
frontend's `WorkingHours` type wants `{"day": "Sunday", "isOpen": true}`. Doing
the mapping **in the backend** means no frontend type changes — and those types
are used by a dozen components you do not want to touch.

```ts
const API_BASE = process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://127.0.0.1:8000";
```
`NEXT_PUBLIC_` means Next.js bakes this into the browser bundle. Normally
something to avoid — here it is correct, because the chat API is public and the
browser has to know where to send requests.

```ts
export class ChatApiError extends Error {
  get isExpiredSession() { return this.status === 401; }
}
```
A typed error so the UI can react differently to "you are going too fast" (show a
countdown) versus "your session expired" (silently start a new one). Without it
you end up string-matching error messages, which breaks the first time you reword
one.

```ts
const text = await response.text();
try { body = text ? JSON.parse(text) : null } catch { body = null }
```
Read as text first, then parse. If FastAPI returns an HTML error page or an empty
body, `response.json()` throws an unhelpful "Unexpected token <".

```ts
// NO Content-Type header: the browser must set the multipart boundary.
```
The single most confusing bug in file uploads. When you pass a `FormData` body,
the browser sets `multipart/form-data` **and** a unique boundary marker. Setting
the header yourself produces a body the server cannot parse, and the error says
nothing useful.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
New-Item -ItemType Directory -Force src\lib\api
```

Then create `src/lib/api/chat.ts`, edit `.env.local`, and make the two backend
edits.

> **Restart `npm run dev` after editing `.env.local`.** Next.js reads env files
> only at startup. This catches everyone once.

### How to test

Backend first, with uvicorn running:

```powershell
curl.exe -s http://127.0.0.1:8000/api/v1/chat/business/pulse-fitness
```

Then a slug that does not exist:

```powershell
curl.exe -s -i http://127.0.0.1:8000/api/v1/chat/business/nope
```

### Expected result

```json
{
  "profile": {
    "id": "a1b2c3d4-...",
    "name": "Pulse Fitness Studio",
    "slug": "pulse-fitness",
    "type": "Gym",
    "city": "Hyderabad",
    "currency": "INR",
    "workingHours": [{"day": "Sunday", "isOpen": true, "openTime": "07:00", "closeTime": "13:00"}, ...],
    "services": [{"id": "...", "name": "Monthly Membership", "price": 1800.0, "durationMinutes": 0}, ...],
    "enabledCapabilities": []
  },
  "assistant": {
    "assistantName": "Assistant",
    "greeting": "Hi! I'm the Pulse Fitness assistant...",
    "faqs": [],
    "chatEnabled": true,
    "brandColor": "#6366f1"
  }
}
```

`"faqs": []` is correct, not a bug.

The bad slug returns `404` and
`{"detail":"This chat link is not available."}`.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `AttributeError: module has no attribute 'ChatError'` | The new function is above the class | Put `public_business` at the **bottom** of `chat.py`. |
| `KeyError: 'chat_slug'` | Old seed data | Re-run `database/seed.sql`; the column came from migration 001. |
| `services: []` | No active services | Check `business_services.is_active` is true. |
| `Module not found: Can't resolve '@/lib/api/chat'` | Wrong path | `@/*` maps to `src/*`, so the file goes at `frontend/src/lib/api/chat.ts`. |

---

## STEP 19 — Point the chat page at the real backend

### Goal

Make `/chat/<slug>` load a real business from your database instead of the mock
list.

### Why?

`src/lib/public-business.ts` currently looks the slug up in `mockTenants`. That
means only the seven hardcoded demo slugs work, and the data is fiction.

The page also uses `generateStaticParams`, which pre-renders those slugs at build
time. That is wrong now: businesses are created at runtime, so the page must be
dynamic.

### Architecture

```
BEFORE                             AFTER

page.tsx (server)                  page.tsx (server, dynamic)
   │                                   │
   ▼                                   ▼
getPublicBusiness(slug)            getPublicBusiness(slug)
   │  looks in mock data              │  awaits chatApi.business(slug)
   ▼                                   ▼
mockTenants                        FastAPI → Supabase
```

### Files involved

```
frontend/src/
├── lib/public-business.ts                 ← replace
└── app/chat/[businessSlug]/page.tsx       ← replace
```

### Code

**`frontend/src/lib/public-business.ts`** — replace the whole file:

```ts
import { chatApi, ChatApiError } from "@/lib/api/chat";
import type { AssistantSettings, BusinessProfile } from "@/types";

export interface PublicBusiness {
  profile: BusinessProfile;
  assistant: AssistantSettings;
}

/**
 * Resolves a public chat slug to a business.
 *
 * Runs on the Next.js server (called from a server component), so the browser
 * never sees this request and there is no CORS involved.
 *
 * Returns null for an unknown slug, a paused business, or a backend that is
 * down — the page renders its not-found state for all three, because from the
 * customer's point of view they are the same thing.
 */
export async function getPublicBusiness(slug: string): Promise<PublicBusiness | null> {
  try {
    const { profile, assistant } = await chatApi.business(slug);
    return { profile, assistant };
  } catch (error) {
    if (error instanceof ChatApiError && error.status === 404) return null;
    // Log for you; show the customer the same friendly page either way.
    console.error(`[chat] could not load business "${slug}":`, error);
    return null;
  }
}
```

**`frontend/src/app/chat/[businessSlug]/page.tsx`** — replace the whole file:

```tsx
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { CustomerChatApp } from "@/features/customer-chat/components/CustomerChatApp";
import { getPublicBusiness } from "@/lib/public-business";

interface ChatPageProps {
  params: Promise<{ businessSlug: string }>;
}

/**
 * Businesses are created at runtime, so this page cannot be pre-rendered.
 * (The mock version used generateStaticParams over a fixed list.)
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: ChatPageProps): Promise<Metadata> {
  const { businessSlug } = await params;
  const business = await getPublicBusiness(businessSlug);
  if (!business) return { title: "Chat not found | AI Business Hub" };
  return {
    title: `Chat with ${business.profile.name}`,
    description: `Get answers from ${business.profile.name}, any time.`,
    // A customer support chat has no business being in search results.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#030712",
};

/** Public, login-free customer chat for one business. */
export default async function PublicChatPage({ params }: ChatPageProps) {
  const { businessSlug } = await params;
  const business = await getPublicBusiness(businessSlug);
  if (!business) notFound();

  return (
    <CustomerChatApp
      slug={businessSlug}
      business={business.profile}
      assistant={business.assistant}
    />
  );
}
```

### Explain the code

```tsx
export const dynamic = "force-dynamic";
```
Replaces `generateStaticParams`. With static generation Next.js would build a
page per known slug at build time — impossible when a business signs up an hour
after you deploy. `force-dynamic` renders on every request.

```ts
export async function getPublicBusiness(slug: string): Promise<PublicBusiness | null>
```
Note it became **async**. The function's contract barely changed, which is the
point — the page still calls it the same way, just with `await`.

```ts
if (error instanceof ChatApiError && error.status === 404) return null;
console.error(...);
return null;
```
Both an unknown slug and a dead backend return `null`, so the customer sees the
same polite "not found" page. But only one of them is *your* problem, so the
backend failure gets logged to the server console.

That distinction matters: the customer should never see "ECONNREFUSED
127.0.0.1:8000", and you should never have to guess whether a 404 meant a typo
or an outage.

```tsx
robots: { index: false, follow: false },
```
Keeps individual customer chat pages out of Google. There is nothing useful to
index and a real risk of a stray conversation being crawled.

```tsx
<CustomerChatApp slug={businessSlug} ... />
```
A new prop. The component needs the slug to key its session token in
`localStorage` — one token per business, so a customer who chats with two
businesses keeps two separate conversations. STEP 20 adds it.

### How to test

Your seeded business is `pulse-fitness`, so:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npm run dev
```

Open <http://localhost:3000/chat/pulse-fitness>.

Then try the old mock slug <http://localhost:3000/chat/fitzone>, and a nonsense
one like `/chat/nope`.

### Expected result

- `/chat/pulse-fitness` — the chat opens, header says **Pulse Fitness Studio**,
  the greeting is the one from your `businesses` row.
- `/chat/fitzone` — **not found** now. Correct: it only existed in mock data.
- `/chat/nope` — not found.
- Stop uvicorn and reload: still the not-found page, and your `npm run dev`
  terminal logs `[chat] could not load business ...`.

The chat still replies with nonsense — the mock brain is still in place. STEP 20
fixes that.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Every slug shows not-found | Backend unreachable | Start uvicorn. Check `NEXT_PUBLIC_CHAT_API_URL` and **restart `npm run dev`**. |
| `Type error: Property 'slug' does not exist` on `CustomerChatApp` | STEP 20 not done yet | Expected. Do STEP 20, or drop the `slug` prop until then. |
| `generateStaticParams` error at build | Left over from the old file | Delete it; `force-dynamic` replaces it. |
| `getPublicBusiness is not a function` | Old import of `getPublicBusinessSlugs` | That export is gone — remove any import of it. |

---

## STEP 20 — Replace the mock brain with the real agent

### Goal

Make the chat actually talk to your Customer Support Agent: open a session,
send messages, restore the conversation after a reload, and handle every error
gracefully.

### Why?

This is the moment the whole project comes together. Everything else has been
scaffolding.

Four things the mock version does not do, and the real one must:

1. **Keep a session.** The customer reloads and expects their conversation back.
2. **Handle real failure.** Backend down, rate limited, session expired.
3. **Go quiet on handoff.** When the agent escalates, a human takes over and the
   AI must stop replying.
4. **Not invent anything.** That is the agent's job now, not the browser's.

### What stays, and what goes

The existing component has a lot of good UI. We keep almost all of it:

| Feature | Fate |
| --- | --- |
| Header, bubbles, typing dots, quick actions, composer | **Kept, untouched** |
| Booking attachments (services, slots, confirm cards) | **Kept but dormant** — the support agent never returns them. The Booking Agent will. |
| `getAssistantReply` from `mockAssistant.ts` | **Gone** — replaced by the API |
| Simulated voice overlay | **Kept for now** — Part 6 makes it real |

We are deliberately not deleting the booking UI. It works, it is well built, and
the next agent needs it. It simply never triggers while the support agent is the
one answering.

### Architecture

```
mount
  │
  ├─ token in localStorage?
  │     yes → GET /history      → restore the conversation
  │     no  → POST /session     → greeting, store token
  │
send(text)
  │
  ├─ show the customer's message immediately (optimistic)
  ├─ show typing dots
  ├─ POST /message
  │     reply   → append
  │     notice  → append as a system bubble
  │     429     → disable input, count down
  │     401     → silently open a new session
  └─ hide typing dots
```

### Files involved

```
frontend/src/features/customer-chat/components/CustomerChatApp.tsx   ← replace
```

### Code

**`frontend/src/features/customer-chat/components/CustomerChatApp.tsx`** —
replace the whole file. This is your existing component with the mock brain
swapped out; the markup is deliberately almost identical.

```tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send, Mic, X, CalendarPlus, LayoutGrid, BadgePercent, HelpCircle, Clock, MapPin, Phone, Sparkles, RefreshCw } from "lucide-react";
import type { AssistantSettings, BusinessProfile, ChatMessage } from "@/types";
import { cn, getInitials } from "@/lib/utils";
import { ChatMessageBubble } from "./ChatMessageBubble";
import {
  ChatApiError,
  chatApi,
  clearToken,
  readToken,
  writeToken,
  type ChatTurn,
} from "@/lib/api/chat";

type UiMessage = ChatMessage;

interface CustomerChatAppProps {
  /** URL segment, used to key this business's session token. */
  slug: string;
  business: BusinessProfile;
  assistant: AssistantSettings;
}

function nowLabel() {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
}

function timeLabel(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(parsed);
}

let idCounter = 0;
const nextId = () => `m-${++idCounter}-${Date.now()}`;

/** A stored turn from the API -> the shape the bubbles already expect. */
function toUiMessage(turn: ChatTurn): UiMessage {
  return {
    id: turn.id,
    sender: turn.author === "customer" ? "customer" : turn.author === "owner" ? "staff" : turn.author === "system" ? "system" : "assistant",
    text: turn.body,
    timestamp: timeLabel(turn.created_at),
  };
}

export function CustomerChatApp({ slug, business, assistant }: CustomerChatAppProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [booting, setBooting] = useState(true);
  const [handedOver, setHandedOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [voice, setVoice] = useState<{ state: "idle" | "listening"; transcript: string }>({ state: "idle", transcript: "" });

  const token = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------------------ bootstrap */

  const openSession = useCallback(async () => {
    const session = await chatApi.startSession(slug);
    token.current = session.session_token;
    writeToken(slug, session.session_token);
    setMessages([{ id: "greeting", sender: "assistant", text: session.greeting, timestamp: nowLabel() }]);
    setHandedOver(false);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const existing = readToken(slug);

        if (existing) {
          try {
            const past = await chatApi.history(existing);
            if (cancelled) return;
            token.current = existing;
            setMessages(past.messages.map(toUiMessage));
            setHandedOver(past.handed_over);
            setBooting(false);
            return;
          } catch (cause) {
            // Expired or unknown token: fall through and open a fresh session.
            if (!(cause instanceof ChatApiError) || !cause.isExpiredSession) throw cause;
            clearToken(slug);
          }
        }

        await openSession();
        if (!cancelled) setBooting(false);
      } catch {
        if (cancelled) return;
        setBooting(false);
        setError("We couldn't start the chat. Please refresh the page.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, openSession]);

  /* --------------------------------------------------------------- effects */

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // When a human has taken over, the agent is silent — so poll for their reply.
  useEffect(() => {
    if (!handedOver) return;

    const timer = setInterval(async () => {
      if (!token.current) return;
      try {
        const past = await chatApi.history(token.current);
        setMessages(past.messages.map(toUiMessage));
        setHandedOver(past.handed_over);
      } catch {
        /* transient: keep the last good state and try again next tick */
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [handedOver]);

  /* --------------------------------------------------------------- sending */

  const appendAgent = (text: string, sender: UiMessage["sender"] = "assistant") =>
    setMessages((prev) => [...prev, { id: nextId(), sender, text, timestamp: nowLabel() }]);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || typing || cooldown > 0 || !token.current) return;

      setError(null);
      setInput("");
      setMessages((prev) => [...prev, { id: nextId(), sender: "customer", text: clean, timestamp: nowLabel() }]);
      setTyping(true);

      try {
        const result = await chatApi.sendMessage(token.current, clean);
        if (result.reply) appendAgent(result.reply);
        if (result.notice) appendAgent(result.notice, "system");
        if (result.handed_over) setHandedOver(true);
      } catch (cause) {
        if (cause instanceof ChatApiError) {
          if (cause.isExpiredSession) {
            // Silently start over rather than showing the customer a 401.
            clearToken(slug);
            try {
              await openSession();
              setError("Your session timed out, so we started a new chat.");
            } catch {
              setError("This chat is not available right now.");
            }
          } else {
            setError(cause.message);
            if (cause.retryAfter > 0) setCooldown(cause.retryAfter);
          }
        } else {
          setError("Something went wrong. Please try again.");
        }
      } finally {
        setTyping(false);
        inputRef.current?.focus();
      }
    },
    [typing, cooldown, slug, openSession],
  );

  /* ---------------------------------------------------------------- voice */
  // Part 6 replaces this simulation with a real microphone.

  const startVoice = () => setVoice({ state: "listening", transcript: "" });
  const cancelVoice = () => setVoice({ state: "idle", transcript: "" });

  /* --------------------------------------------------------------- render */

  const chatOff = !assistant.chatEnabled;
  const disabled = typing || cooldown > 0 || booting || chatOff;

  const quickActions = [
    { label: "View Services", icon: LayoutGrid, text: "What services do you offer?" },
    { label: "Membership", icon: BadgePercent, text: "Tell me about memberships" },
    { label: "Opening Hours", icon: Clock, text: "What are your opening hours?" },
    { label: "Book Appointment", icon: CalendarPlus, text: "I want to book an appointment" },
    { label: "Ask a Question", icon: HelpCircle, text: null },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#0b0f19] flex sm:items-center sm:justify-center sm:p-4">
      <div className="w-full sm:max-w-lg h-[100dvh] sm:h-[calc(100dvh-2rem)] sm:max-h-[52rem] flex flex-col bg-gray-950 sm:rounded-3xl sm:border sm:border-gray-800 sm:shadow-2xl overflow-hidden relative">
        {/* Header */}
        <header
          className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950/95 backdrop-blur"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-md"
            style={{ backgroundColor: assistant.brandColor }}
            aria-hidden="true"
          >
            {getInitials(business.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-white truncate">{business.name}</h1>
            <div className={cn("text-[11px] flex items-center gap-1.5", handedOver ? "text-amber-400" : "text-emerald-400")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", handedOver ? "bg-amber-400" : "bg-emerald-400")} />
              {handedOver ? "A team member is replying" : `${assistant.assistantName} is online • replies instantly`}
            </div>
          </div>
          {business.phone && (
            <a href={`tel:${business.phone}`} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800" aria-label={`Call ${business.name}`}>
              <Phone className="w-4 h-4" />
            </a>
          )}
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4" aria-live="polite">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-3 text-center space-y-1">
            <p className="text-xs text-gray-300">{business.tagline}</p>
            {business.city && (
              <p className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {business.city}
              </p>
            )}
          </div>

          {booting && (
            <p className="text-center text-xs text-gray-500 inline-flex w-full items-center justify-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting…
            </p>
          )}

          {messages.map((m) => (
            <ChatMessageBubble key={m.id} message={m} perspective="customer" assistantName={assistant.assistantName} />
          ))}

          {typing && (
            <div className="flex items-center gap-2 text-gray-500 text-xs pl-9" aria-label={`${assistant.assistantName} is typing`}>
              <span className="flex gap-1 bg-gray-800 rounded-2xl px-3 py-2.5">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
            </div>
          )}

          {error && (
            <p className="mx-auto max-w-sm rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-center text-xs text-amber-300">
              {error}
              {cooldown > 0 ? ` Try again in ${cooldown}s.` : ""}
            </p>
          )}
        </div>

        {/* Quick actions */}
        {!chatOff && !booting && (
          <div className="px-3 pt-2 flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {quickActions.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => (q.text ? void send(q.text) : inputRef.current?.focus())}
                disabled={disabled}
                className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-gray-700 bg-gray-900 text-gray-200 hover:border-indigo-500/60 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                <q.icon className="w-3.5 h-3.5 text-indigo-400" />
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="p-3 flex items-center gap-2"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {assistant.voiceInputEnabled && (
            <button
              type="button"
              onClick={voice.state === "listening" ? cancelVoice : startVoice}
              disabled={disabled}
              aria-label={voice.state === "listening" ? "Stop voice input" : "Speak your message"}
              className={cn(
                "w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer disabled:opacity-50",
                voice.state === "listening" ? "bg-rose-600 text-white" : "bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700",
              )}
            >
              <Mic className="w-5 h-5" />
            </button>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={chatOff ? "Chat is currently offline" : cooldown > 0 ? `Please wait ${cooldown}s…` : "Type your message..."}
            aria-label="Message"
            disabled={disabled}
            enterKeyHint="send"
            className="flex-1 min-w-0 rounded-full bg-gray-900 border border-gray-700 px-4 py-2.5 text-base sm:text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || disabled}
            aria-label="Send message"
            className="w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        <p className="text-center text-[10px] text-gray-600 pb-2 -mt-1 px-4">
          <Sparkles className="w-3 h-3 inline-block mr-1" />
          You are chatting with an AI assistant. Replies may not always be accurate.
        </p>

        {/* Voice overlay — Part 6 makes this real */}
        {voice.state === "listening" && (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gray-950/95 backdrop-blur border-t border-gray-800 p-6 pb-10 flex flex-col items-center gap-4" role="dialog" aria-label="Listening">
            <div className="flex items-end gap-1 h-10" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className="w-1.5 rounded-full bg-indigo-500 animate-pulse" style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${i * 90}ms` }} />
              ))}
            </div>
            <p className="text-sm text-white min-h-5 text-center">{voice.transcript || "Listening... speak now"}</p>
            <button
              type="button"
              onClick={cancelVoice}
              className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-full border border-gray-700 text-gray-300 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

You can now delete the mock brain, or leave it — nothing imports it any more:

```powershell
Remove-Item src\features\customer-chat\mockAssistant.ts
```

### Explain the code

```tsx
const existing = readToken(slug);
if (existing) {
  try { const past = await chatApi.history(existing); ... }
  catch (cause) { if (!cause.isExpiredSession) throw cause; clearToken(slug); }
}
await openSession();
```
The reload path. Try the stored token first; if the server says it expired, throw
it away and open a fresh session. The customer sees either their old conversation
or a clean greeting — never an error about tokens.

```tsx
let cancelled = false;
...
return () => { cancelled = true; };
```
React's development Strict Mode runs effects twice on purpose, to surface exactly
this kind of bug. Without the flag you would create two sessions and two
conversations on every page load, and see duplicate rows in Supabase.

```tsx
setMessages((prev) => [...prev, { ..., sender: "customer", text: clean }]);
setTyping(true);
```
The customer's message appears **immediately**, before the server replies. This
optimistic update is what makes the chat feel instant; the typing dots appear in
the same frame.

```tsx
if (cause.isExpiredSession) { clearToken(slug); await openSession(); ... }
```
Self-healing. A visitor who left the tab open for a week presses send and gets a
working chat plus a one-line explanation, instead of a 401 they cannot act on.

```tsx
if (cause.retryAfter > 0) setCooldown(cause.retryAfter);
```
Turns a rate limit into a visible countdown. The input disables itself and the
placeholder becomes "Please wait 43s…". A bare "too many requests" makes people
hammer the button, which is the opposite of what you want.

```tsx
useEffect(() => {
  if (!handedOver) return;
  const timer = setInterval(async () => { ... }, 5000);
```
The other half of escalation. When the agent hands off, it goes silent — so the
customer's window polls for the human's reply. It only runs when `handedOver` is
true, so the normal case costs nothing.

```tsx
sender: turn.author === "owner" ? "staff" : ...
```
Maps your backend's author names onto the `SenderRole` union the bubbles already
understand. `owner` becomes `staff`, which renders in green with a different
avatar — so the customer can see a real person replied.

```tsx
<p>You are chatting with an AI assistant. Replies may not always be accurate.</p>
```
Not optional, in my view. The customer is talking to a machine on a business's
behalf and should know. It also measurably reduces complaints when the agent gets
something wrong.

```tsx
{/* Booking attachments are gone from this render */}
```
Notice `renderAttachment` is no longer called. The support agent returns plain
text, so there is nothing to render. The types and the `ChatMessageBubble`
children slot are still there, so the Booking Agent can switch it back on without
touching this file's layout.

### How to test

Both servers running. Open <http://localhost:3000/chat/pulse-fitness>.

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Load the page | Greeting from your database, within a second |
| 2 | "what plans do you have?" | Real prices — ₹1,800 monthly, ₹4,800 quarterly |
| 3 | Watch while it answers | Typing dots, then the reply |
| 4 | "can I freeze my membership?" | The real policy, and a follow-up question |
| 5 | "do you sell protein powder?" | It says it does not know — **it must not invent a shop** |
| 6 | **Reload the page** | The whole conversation is still there |
| 7 | "I want a refund" | It escalates; a system bubble appears; header turns amber |
| 8 | Send another message | Stored, but no AI reply |
| 9 | Stop uvicorn, send a message | "Could not reach the assistant…" |
| 10 | Send 25 messages fast | Input disables with a live countdown |
| 11 | DevTools → iPhone viewport | Composer on the bottom edge, nothing cut off |

Then check Supabase: `conversations` has one row per browser (**not** per
reload), `messages` holds both sides, `agent_logs` has a row per exchange.

### Expected result

**#6 is the important one.** Reload and the conversation survives — that is the
session token working, with no account involved.

**#5 is the one that proves the agent is real.** The mock brain would have made
something up.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| "Could not reach the assistant" | uvicorn down, or wrong API URL | Start terminal 1; restart `npm run dev` after editing `.env.local`. |
| Console: `blocked by CORS policy` | Origin not allowed | `CORS_ORIGINS` in `backend/.env` must include `http://localhost:3000`. Restart uvicorn. |
| Console mentions `X-Chat-Session` not allowed | Header missing from `allow_headers` | STEP 7 lists it in `main.py`. |
| Two conversations created per load | Strict Mode double-render | Keep the `cancelled` flag in the effect. |
| `Cannot find name 'getAssistantReply'` | Left-over import | Remove the `mockAssistant` import; nothing uses it now. |
| `Property 'slug' is missing` | STEP 19 not applied | The page must pass `slug={businessSlug}`. |
| Replies appear but bubbles look wrong | `sender` mapping | Check `toUiMessage`: only `customer`, `assistant`, `staff`, `system` are valid. |
| Composer hidden by the phone keyboard | Using `100vh` | The component uses `100dvh` — keep it. |

---

## End of Part 5 — checklist

- [ ] `GET /api/v1/chat/business/pulse-fitness` returns profile + assistant
- [ ] `/chat/pulse-fitness` loads real data; `/chat/fitzone` is now not-found
- [ ] Questions get answers grounded in your database
- [ ] It refuses to invent anything it cannot look up
- [ ] Reloading keeps the conversation
- [ ] Escalation shows a notice and turns the header amber
- [ ] Rate limiting shows a live countdown
- [ ] `npx tsc --noEmit` passes

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
npm run lint
cd ..
git add backend frontend docs
git commit -m "Wire the public chat to the Customer Support Agent"
```

> **Note on testing:** this frontend has no test runner — there is no `vitest`
> and no `npm run verify`. `npx tsc --noEmit` plus `npm run lint` is the check.

Next: [06-voice-input.md](06-voice-input.md) — make the microphone real.
