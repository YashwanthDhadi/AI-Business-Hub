# Part 4 — The public chat API (STEP 14 → STEP 17)

The agent works. Now we open it to the internet — carefully.

This is the part of the project that needs the most care, because it is the
first endpoint with **no authentication at all**. Anyone who finds the URL can
call it. That is by design: a customer must be able to ask a question without
signing up. It also means every guard has to be deliberate.

---

## STEP 14 — Anonymous sessions

### Goal

Give a visitor an identity that lasts across a page reload, without an account,
a login, or a cookie banner.

### Why?

A customer opens `/chat/pulse-fitness`, asks three questions, accidentally hits
refresh, and expects their conversation to still be there. But they have no
account, and we do not want one — requiring a signup before a stranger can ask
"what time do you close?" would kill the product.

So: the server creates a **session token**, the browser keeps it, and every
request carries it. The token identifies one conversation and nothing else.

### Architecture

```
Browser opens /chat/pulse-fitness
      │
      ▼  POST /api/v1/chat/session   {"chat_slug": "pulse-fitness"}
      │
FastAPI ├─ look up the business by slug
        ├─ create a conversation
        ├─ token = secrets.token_urlsafe(32)      ← raw, sent once
        ├─ store sha256(token)                    ← only the hash is saved
        └─ return {session_token, greeting, business}
      │
      ▼  browser saves the token in localStorage
      │
      ▼  every later request: header  X-Chat-Session: <token>
```

### Why hash the token

We store `sha256(token)`, never the token itself.

If the database leaked, an attacker would hold a list of hashes — useless for
resuming anyone's chat, because the server looks up by hash and they cannot
reverse one. This is the same reason you never store a password. It costs two
lines and removes a whole class of problem.

### Files involved

```
backend/app/
├── repositories/sessions.py    ← create
└── services/
    ├── __init__.py             ← create (empty)
    └── chat.py                 ← create
```

### Code

**`backend/app/repositories/sessions.py`**:

```python
"""
Anonymous chat sessions.

One row per browser tab that opened a chat link. The raw token exists only in
the visitor's browser; we store its SHA-256 hash.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import db, one


def new_token() -> str:
    """A 43-character URL-safe random string. Never stored in this form."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def hash_ip(ip: str | None) -> str | None:
    """
    Salted hash of the visitor's IP.

    Enough to count requests per address; not enough to identify a person.
    The salt means the stored value cannot be reversed by hashing all four
    billion IPv4 addresses.
    """
    if not ip:
        return None
    return hashlib.sha256(f"{settings.ip_hash_salt}:{ip}".encode("utf-8")).hexdigest()


def create(
    *,
    business_id: str,
    conversation_id: str,
    token: str,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    expires = datetime.now(timezone.utc) + timedelta(days=settings.chat_session_ttl_days)
    created = one(
        db.table("chat_sessions")
        .insert(
            {
                "business_id": business_id,
                "conversation_id": conversation_id,
                "token_hash": hash_token(token),
                "ip_hash": hash_ip(ip),
                "user_agent": (user_agent or "")[:400],
                "expires_at": expires.isoformat(),
            }
        )
        .execute()
    )
    if not created:
        raise RuntimeError("Could not create chat session")
    return created


def resolve(token: str) -> dict | None:
    """Find a live session by its raw token. Expired sessions return None."""
    if not token:
        return None

    row = one(
        db.table("chat_sessions")
        .select("*")
        .eq("token_hash", hash_token(token))
        .limit(1)
        .execute()
    )
    if row is None:
        return None

    try:
        expires = datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00"))
    except ValueError:
        return None

    if expires < datetime.now(timezone.utc):
        return None

    return row


def touch(session_id: str, message_count: int) -> None:
    db.table("chat_sessions").update(
        {
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
            "message_count": message_count,
        }
    ).eq("id", session_id).execute()
```

**`backend/app/services/__init__.py`** — empty:

```python
```

**`backend/app/services/chat.py`**:

```python
"""
Public chat orchestration.

Sits between the HTTP routes and everything else: resolves the business, owns
the session lifecycle, runs the agent, and persists both sides of the exchange.
Routes stay thin; this file holds the rules.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.agents import support_agent
from app.repositories import businesses as business_repo
from app.repositories import conversations as conversation_repo
from app.repositories import sessions as session_repo

logger = logging.getLogger("aibh.chat")

AGENT_KEY = support_agent.AGENT_KEY


class ChatError(Exception):
    """Something the visitor should be told about, with an HTTP status."""

    def __init__(self, message: str, status_code: int = 400, retry_after: int = 0):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        # Seconds the client should wait. Only set on 429.
        self.retry_after = retry_after


@dataclass
class ResolvedSession:
    session: dict
    business: dict
    conversation: dict


def start_session(
    *, chat_slug: str, ip: str | None = None, user_agent: str | None = None
) -> dict:
    """Open a new anonymous conversation for a business's public chat link."""
    business = business_repo.get_business_by_chat_slug(chat_slug)
    if business is None:
        raise ChatError("This chat link is not available.", status_code=404)

    if not business_repo.is_agent_active(business["id"], AGENT_KEY):
        raise ChatError("This business is not accepting chats right now.", status_code=403)

    conversation = conversation_repo.create(business["id"], channel="web")
    token = session_repo.new_token()
    session_repo.create(
        business_id=business["id"],
        conversation_id=conversation["id"],
        token=token,
        ip=ip,
        user_agent=user_agent,
    )

    greeting = business.get("chat_greeting") or "Hi! How can I help you today?"

    # Persist the greeting so the transcript the owner reads starts where the
    # customer's screen started.
    conversation_repo.add_message(
        business_id=business["id"],
        conversation_id=conversation["id"],
        direction="outbound",
        author="agent",
        body=greeting,
        meta={"kind": "greeting"},
    )

    logger.info("Chat session opened for %s (%s)", business["name"], conversation["id"])

    return {
        "session_token": token,
        "conversation_id": conversation["id"],
        "business": {
            "name": business["name"],
            "chat_slug": business["chat_slug"],
            "accent": business.get("chat_accent") or "indigo",
            "location": business.get("location") or "",
        },
        "greeting": greeting,
    }


def resolve_session(token: str) -> ResolvedSession:
    """Turn the X-Chat-Session header into a business and a conversation."""
    session = session_repo.resolve(token)
    if session is None:
        raise ChatError("Your chat session has expired. Please refresh the page.", 401)

    business = business_repo.get_business(session["business_id"])
    if business is None or not business.get("chat_enabled"):
        raise ChatError("This chat is no longer available.", status_code=403)

    conversation = conversation_repo.get(business["id"], session["conversation_id"])
    if conversation is None:
        raise ChatError("This conversation no longer exists.", status_code=404)

    return ResolvedSession(session=session, business=business, conversation=conversation)


def handle_message(resolved: ResolvedSession, text: str, *, from_voice: bool = False) -> dict:
    """
    One full exchange: store the question, run the agent, store the answer.

    Returns what the browser needs to render, and nothing more — never the
    business id, never internal ids the visitor has no use for.
    """
    business = resolved.business
    conversation = resolved.conversation
    business_id = business["id"]
    conversation_id = conversation["id"]

    conversation_repo.add_message(
        business_id=business_id,
        conversation_id=conversation_id,
        direction="inbound",
        author="customer",
        body=text,
        meta={"source": "voice" if from_voice else "text"},
    )

    session_repo.touch(resolved.session["id"], (resolved.session.get("message_count") or 0) + 1)

    # A human has taken over: store what they said, stay silent.
    if conversation.get("human_takeover"):
        logger.info("Conversation %s is under human control — agent silent", conversation_id)
        return {
            "reply": None,
            "handed_over": True,
            "notice": "Someone from the team is looking at this and will reply here shortly.",
        }

    reply = support_agent.run(
        business=business,
        conversation_id=conversation_id,
        message=text,
    )

    conversation_repo.add_message(
        business_id=business_id,
        conversation_id=conversation_id,
        direction="outbound",
        author="agent",
        body=reply.text,
        meta={
            "tool_calls": reply.tool_calls,
            "latency_ms": reply.latency_ms,
            "steps": reply.steps,
            "escalated": reply.escalated,
        },
    )

    return {
        "reply": reply.text,
        "handed_over": reply.escalated,
        "notice": (
            "Someone from the team will reply here shortly."
            if reply.escalated
            else None
        ),
        "latency_ms": reply.latency_ms,
    }


def transcript(resolved: ResolvedSession, limit: int = 100) -> list[dict]:
    """The visitor's own conversation, for restoring the page after a reload."""
    rows = conversation_repo.messages_for(
        resolved.business["id"], resolved.conversation["id"], limit=limit
    )
    return [
        {
            "id": row["id"],
            "role": "customer" if row["author"] == "customer" else "agent",
            "author": row["author"],
            "body": row["body"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]
```

### Explain the code

```python
return secrets.token_urlsafe(32)
```
`secrets`, not `random`. `random` is a predictable pseudo-random generator — if
an attacker sees a few tokens they can compute the next ones. `secrets` uses the
operating system's cryptographic source. Any token that grants access must come
from `secrets`.

```python
hashlib.sha256(f"{settings.ip_hash_salt}:{ip}".encode()).hexdigest()
```
The salt is what makes this meaningful. Without it, an unsalted hash of an IPv4
address is reversible in seconds — there are only 4.3 billion of them and you can
hash the lot. With a secret salt, the stored value is useless to anyone who does
not have your `.env`.

```python
if expires < datetime.now(timezone.utc):
    return None
```
Expiry is checked in code as well as being stored. A token older than the TTL
stops working even though the row is still in the table. Cleaning up old rows is
a separate, unhurried job.

```python
class ChatError(Exception):
    def __init__(self, message: str, status_code: int = 400):
```
One exception type carrying the message *and* the HTTP status. The route layer in
STEP 16 catches it and turns it into a clean JSON response. Without this you end
up either leaking internals or writing the same `try/except` in five routes.

Notice every message in a `ChatError` is written **for a customer to read**:
"This chat link is not available", not "business lookup returned None". The
visitor is a member of the public, not a developer.

```python
conversation_repo.add_message(..., body=greeting, meta={"kind": "greeting"})
```
The greeting is stored, not just displayed. Otherwise the owner opens the
transcript later and sees the customer apparently starting mid-conversation.
The record should match what was on screen.

```python
if conversation.get("human_takeover"):
    return {"reply": None, "handed_over": True, "notice": "..."}
```
The half of escalation people forget. `escalate_to_human` sets the flag; this is
what honours it. Without it the agent keeps chirping over the owner's head while
they are dealing with an angry customer. Note the message is **still stored
first** — the owner needs to read what was said.

```python
return {"reply": ..., "handed_over": ..., "latency_ms": ...}
```
The response contains only what the browser needs to draw the screen. No
`business_id`, no `conversation_id`, no tool calls, no internal ids. On a public
endpoint, every field you return is a field a stranger can read — so return the
minimum.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
New-Item -ItemType Directory -Force backend\app\services
New-Item -ItemType File -Force backend\app\services\__init__.py
```

Then create `sessions.py` and `chat.py`.

### How to test

Tested together with STEP 17.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `Could not create chat session` | Insert failed | Check the `chat_sessions` table exists and you are using the service_role key. |
| Every session immediately "expired" | `expires_at` parsing | Supabase returns ISO strings; the `.replace("Z", "+00:00")` handles the UTC suffix. |
| `ImportError: cannot import name 'support_agent'` | Wrong module path | It is `from app.agents import support_agent`. |

---

## STEP 15 — Rate limiting and abuse guards

### Goal

Stop one person — or one script — from running up your Groq bill or filling your
database.

### Why?

This is a genuinely new problem. Every previous endpoint in this project was
either behind a key or called by a provider you trust. This one is open to the
internet, and a language model call is **expensive relative to an HTTP request**.

Without limits, a bored person with a `for` loop can:

- exhaust your Groq free-tier quota in a minute, taking the agent down for every
  business on the platform
- create thousands of conversations and messages
- paste a 200,000-character block and make one request cost as much as a
  thousand

None of that requires skill. It requires the URL, which is printed on a poster.

We add four cheap guards:

| Guard | Limit | Stops |
| --- | --- | --- |
| Per session | 20 messages / 5 min | one tab spamming |
| Per IP | 40 messages / 5 min | one person opening many tabs |
| Message length | 1000 characters | prompt stuffing, cost blowups |
| Agent steps | 6 tool calls | a runaway loop inside one message |

The last one you already built in STEP 12.

### Architecture

```
request
   │
   ├─ too long?        ──► 413, no LLM call
   ├─ session over 20? ──► 429 with retry_after
   ├─ IP over 40?      ──► 429 with retry_after
   ▼
  the agent runs
```

Every guard runs **before** the model is called. A rejected request should cost
you a dictionary lookup, not a token.

### Files involved

```
backend/app/services/
└── rate_limit.py       ← create
```

### Code

**`backend/app/services/rate_limit.py`**:

```python
"""
In-memory rate limiting.

A sliding window counter per key. Deliberately simple:

  * It lives in this process only. Restart the server and counters reset.
  * Run two workers and each keeps its own counts, so the real limit doubles.

Both are fine for now and NOT fine in production — see the note at the bottom
of this file. The interface is what matters: when you swap in Redis, only the
body of `hit()` changes.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass

logger = logging.getLogger("aibh.ratelimit")


@dataclass
class RateVerdict:
    allowed: bool
    remaining: int
    retry_after: int = 0


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: int, name: str = "limiter"):
        self.limit = limit
        self.window = window_seconds
        self.name = name
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> RateVerdict:
        """Record one request against `key` and say whether it is allowed."""
        now = time.monotonic()
        bucket = self._hits[key]

        # Drop everything that fell out of the window.
        cutoff = now - self.window
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= self.limit:
            retry_after = int(bucket[0] + self.window - now) + 1
            logger.warning("%s limit hit for key=%s...", self.name, key[:12])
            return RateVerdict(allowed=False, remaining=0, retry_after=max(1, retry_after))

        bucket.append(now)
        return RateVerdict(allowed=True, remaining=self.limit - len(bucket))

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def sweep(self, max_keys: int = 10_000) -> None:
        """
        Drop empty buckets so the dict cannot grow forever.

        Without this, one key per unique visitor accumulates until restart.
        """
        if len(self._hits) < max_keys:
            return
        cutoff = time.monotonic() - self.window
        stale = [k for k, v in self._hits.items() if not v or v[-1] < cutoff]
        for key in stale:
            self._hits.pop(key, None)
        logger.info("%s swept %s stale keys", self.name, len(stale))
```

Now wire the limiters into `backend/app/services/chat.py`. Add these imports at
the top:

```python
from app.config import settings
from app.services.rate_limit import SlidingWindowLimiter
```

and this block just below `logger = logging.getLogger("aibh.chat")`:

```python
# One limiter per dimension. Module-level, so they persist across requests.
session_limiter = SlidingWindowLimiter(
    settings.chat_rate_limit_per_session, settings.chat_rate_window_seconds, "session"
)
ip_limiter = SlidingWindowLimiter(
    settings.chat_rate_limit_per_ip, settings.chat_rate_window_seconds, "ip"
)
voice_limiter = SlidingWindowLimiter(
    settings.voice_rate_limit_per_session, settings.chat_rate_window_seconds, "voice"
)


def check_limits(resolved: "ResolvedSession", ip: str | None, *, voice: bool = False) -> None:
    """Raise ChatError(429) when the visitor is going too fast."""
    from app.repositories import sessions as session_repo

    session_key = resolved.session["id"]
    ip_key = session_repo.hash_ip(ip) or f"session:{session_key}"

    if voice:
        verdict = voice_limiter.hit(session_key)
        if not verdict.allowed:
            raise ChatError(
                "That's a lot of voice messages. Please wait a moment and try again.",
                status_code=429,
                retry_after=verdict.retry_after,
            )

    verdict = session_limiter.hit(session_key)
    if not verdict.allowed:
        raise ChatError(
            "You're sending messages very quickly. Please wait a moment.",
            status_code=429,
            retry_after=verdict.retry_after,
        )

    verdict = ip_limiter.hit(ip_key)
    if not verdict.allowed:
        raise ChatError(
            "Too many messages from your network. Please wait a moment.",
            status_code=429,
            retry_after=verdict.retry_after,
        )

    session_limiter.sweep()
    ip_limiter.sweep()


def validate_message(text: str) -> str:
    """Reject empty and oversized messages before anything expensive happens."""
    clean = (text or "").strip()
    if not clean:
        raise ChatError("Please type a message.", status_code=400)
    if len(clean) > settings.chat_max_message_chars:
        raise ChatError(
            f"That message is too long. Please keep it under "
            f"{settings.chat_max_message_chars} characters.",
            status_code=413,
        )
    return clean
```

### Explain the code

```python
while bucket and bucket[0] < cutoff:
    bucket.popleft()
```
A **sliding window**. The bucket holds the timestamp of each recent request; old
ones fall off the left as time passes. So "20 per 5 minutes" really means "at
most 20 in any 5-minute stretch", not "20 per calendar 5 minutes" — which would
let someone send 40 across a boundary.

`deque` rather than a list because `popleft()` is instant on a deque and a slow
copy on a list.

```python
retry_after = int(bucket[0] + self.window - now) + 1
```
Tells the client exactly how long to wait: when the oldest request in the window
expires. The chat UI in Part 5 shows this as a countdown instead of a bare
error, which turns a frustrating dead end into a mild pause.

```python
def sweep(self, max_keys: int = 10_000) -> None:
```
A memory guard that is easy to forget. Every unique visitor creates a dictionary
entry. On a busy day that dictionary grows all day and never shrinks — a slow
leak that only shows up in production. Sweeping when it gets large keeps it
bounded.

```python
ip_key = session_repo.hash_ip(ip) or f"session:{session_key}"
```
We rate limit on the **hashed** IP, so the limiter never holds a real address
either. If we cannot determine an IP at all, fall back to the session so the
request is still counted somewhere.

```python
if voice:
    verdict = voice_limiter.hit(session_key)
```
Voice gets its own, tighter limit, and it is checked first. A transcription is
several times more expensive than a chat message — an audio upload, a Whisper
call, *then* the agent. Eight per five minutes is generous for a real person and
useless to a script.

```python
if len(clean) > settings.chat_max_message_chars:
    raise ChatError(..., status_code=413)
```
Length is checked before anything else because it is free to check and the most
expensive thing to get wrong. `413 Payload Too Large` is the correct status.

```python
session_limiter.sweep()
```
Called on each request rather than on a timer. It returns immediately unless the
dictionary is actually large, so the cost is one `len()` in the normal case — no
background task, no scheduler, nothing else to run.

### A note on honesty

This limiter is **per-process and in-memory**. That means:

- restarting the server clears every counter
- running `uvicorn --workers 4` gives you four independent limiters, so your
  real limit is four times what you configured
- deploying two instances behind a load balancer doubles it again

For local development and a single-instance deployment this is genuinely fine.
The day you scale out, move the counters to Redis — and because every caller
goes through `hit()`, that is a change to one function.

What it does **not** protect against is a distributed attack from many IPs. That
needs a CDN or a WAF in front of the API, which is a deployment concern rather
than a code one.

### Commands

Create `rate_limit.py`, then add the block to `chat.py`.

### How to test

Tested in STEP 17.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `NameError: name 'ResolvedSession' is not defined` | `check_limits` is defined above the dataclass | The type hint is quoted — `"ResolvedSession"` — precisely so order does not matter. Keep the quotes. |
| Limits never trigger | You restarted the server between attempts | Counters are in memory. Send the messages in one run. |
| Limits trigger far too early | Limits set very low in `.env` | Check `CHAT_RATE_LIMIT_PER_SESSION`. |
| Circular import | `rate_limit.py` importing from `chat.py` | It must not. Data flows one way: `chat.py` imports `rate_limit.py`. |

---

## STEP 16 — The chat endpoints

### Goal

Three public routes: start a session, send a message, load the transcript.

### Why?

These are the only three things a chat window needs to do. Keeping the surface
that small is itself a security measure — every extra public route is another
thing to get right.

### Architecture

```
POST /api/v1/chat/session     open a conversation, get a token
POST /api/v1/chat/message     send text, get the agent's reply
GET  /api/v1/chat/history     restore the transcript after a reload

  all three, except session, authenticated by:  X-Chat-Session: <token>
```

### Files involved

```
backend/app/
├── schemas.py              ← create
├── routers/chat.py         ← create
└── main.py                 ← edit (mount it)
```

### Code

**`backend/app/schemas.py`**:

```python
"""Request and response shapes."""

from pydantic import BaseModel, Field


class StartSessionRequest(BaseModel):
    chat_slug: str = Field(min_length=1, max_length=120)


class ChatMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
```

**`backend/app/routers/chat.py`**:

```python
"""
The public chat API.

NO AUTHENTICATION. Anyone on the internet can call these routes — that is the
point, and it is why every one of them validates, rate limits, and returns the
smallest possible response.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.schemas import ChatMessageRequest, StartSessionRequest
from app.services import chat as chat_service

logger = logging.getLogger("aibh.router.chat")

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


def client_ip(request: Request) -> str | None:
    """
    The visitor's IP address.

    X-Forwarded-For is set by proxies and CDNs. It is trivially spoofable by the
    client, so treat it as a hint for rate limiting and never as identity. Once
    you deploy behind a known proxy, trust only that proxy's value.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _fail(error: chat_service.ChatError) -> HTTPException:
    """
    Translate a service error into HTTP.

    Retry-After is the standard header for 429. The chat UI reads it and shows
    a countdown instead of a dead end.
    """
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
    return HTTPException(
        status_code=error.status_code, detail=error.message, headers=headers
    )


@router.post("/session")
def start_session(
    payload: StartSessionRequest,
    request: Request,
) -> dict:
    """Open a new anonymous conversation. Called once when the page loads."""
    try:
        return chat_service.start_session(
            chat_slug=payload.chat_slug,
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    except chat_service.ChatError as error:
        raise _fail(error) from error


@router.post("/message")
def send_message(
    payload: ChatMessageRequest,
    request: Request,
    x_chat_session: str | None = Header(default=None),
) -> dict:
    """Send one message and get the agent's reply."""
    try:
        resolved = chat_service.resolve_session(x_chat_session or "")
        text = chat_service.validate_message(payload.message)
        chat_service.check_limits(resolved, client_ip(request))
        return chat_service.handle_message(resolved, text)
    except chat_service.ChatError as error:
        raise _fail(error) from error


@router.get("/history")
def history(
    x_chat_session: str | None = Header(default=None),
) -> dict:
    """The visitor's own transcript, for restoring the page after a reload."""
    try:
        resolved = chat_service.resolve_session(x_chat_session or "")
        return {
            "business": {
                "name": resolved.business["name"],
                "accent": resolved.business.get("chat_accent") or "indigo",
            },
            "handed_over": bool(resolved.conversation.get("human_takeover")),
            "messages": chat_service.transcript(resolved),
        }
    except chat_service.ChatError as error:
        raise _fail(error) from error
```

**`backend/app/main.py`** — update the import and mount:

```python
from app.routers import chat, health
```

```python
app.include_router(health.router)
app.include_router(chat.router)
```

### Explain the code

```python
class ChatMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
```
Two layers of length checking on purpose. Pydantic's `max_length=4000` rejects
absurd payloads before your code runs at all. Then `validate_message` applies the
real, configurable business limit of 1000. The outer one is a cheap structural
guard; the inner one is a policy you can tune per deployment without touching
code.

```python
x_chat_session: str | None = Header(default=None)
```
FastAPI converts the parameter name to a header name: `x_chat_session` reads the
`X-Chat-Session` header. Underscores become hyphens automatically.

We use a header rather than a cookie deliberately. Cookies are sent
automatically, which is convenient and is exactly what makes CSRF possible. A
header must be attached by JavaScript, which means a random website cannot make
a visitor's browser send it. For a token-authenticated public API, headers are
the simpler and safer choice — and they sidestep cookie-consent questions
entirely.

```python
resolved = chat_service.resolve_session(x_chat_session or "")
text = chat_service.validate_message(payload.message)
chat_service.check_limits(resolved, client_ip(request))
```
Order matters, and it is cheapest-first:

1. **Resolve the session** — one indexed lookup. No session, no work.
2. **Validate the message** — a string length check, free.
3. **Check rate limits** — a dictionary lookup, free.
4. Only then does the agent run and cost you tokens.

Reversing any two of these means doing expensive work for requests you were
going to reject.

```python
def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
```
Locally there is no proxy and `request.client.host` is the truth. In production
behind ngrok, a CDN or a load balancer, the real IP is in `X-Forwarded-For` and
`request.client.host` is the proxy.

The comment in the code is the important part: **the client can set this header
themselves**. Someone determined to dodge the IP limit can send a random one on
every request. That is acceptable here because the IP limit is a convenience
layer over the session limit, not the last line of defence. Do not ever use this
value to decide who someone *is*.

```python
except chat_service.ChatError as error:
    raise _fail(error) from error
```
One translation point between the service layer's exception and HTTP. The
service never imports FastAPI, so it stays testable from a plain script — which
is exactly how `scripts/chat.py` uses it.

`from error` preserves the original traceback in your logs while the customer
sees only `detail`.

### Commands

Create the two files, edit `main.py`. uvicorn reloads.

### How to test

Covered by STEP 17.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `422 Unprocessable Entity` | Body does not match the schema | The route wants JSON `{"message": "..."}`, not form data. |
| `401 Your chat session has expired` on the very first message | Token not being sent | The header is `X-Chat-Session`, spelled exactly. |
| `ImportError: cannot import name 'chat'` | Router file missing | It goes at `app/routers/chat.py`. |
| Routes missing from `/docs` | Not mounted | `app.include_router(chat.router)` in `main.py`. |

---

## STEP 17 — Test the public API

### Goal

Drive the whole chat from the command line, as a customer would, and prove the
guards work.

### Why?

If this passes, the chat UI in Part 5 is presentation only. Any bug you find now
is a bug you do not have to find through a browser console.

### How to test

**1. Start a session.** No authentication at all — this is the public front door:

```powershell
$body = '{"chat_slug":"pulse-fitness"}'
curl.exe -s -X POST http://127.0.0.1:8000/api/v1/chat/session `
  -H "Content-Type: application/json" -d $body
```

Copy the `session_token` from the response into a variable:

```powershell
$t = "PASTE_THE_SESSION_TOKEN"
```

**2. Ask a question:**

```powershell
curl.exe -s -X POST http://127.0.0.1:8000/api/v1/chat/message `
  -H "Content-Type: application/json" -H "X-Chat-Session: $t" `
  -d '{\"message\":\"can I pause my membership?\"}'
```

**3. Ask a follow-up** (proves memory works):

```powershell
curl.exe -s -X POST http://127.0.0.1:8000/api/v1/chat/message `
  -H "Content-Type: application/json" -H "X-Chat-Session: $t" `
  -d '{\"message\":\"I am on the monthly plan\"}'
```

**4. Load the transcript** (what a page reload does):

```powershell
curl.exe -s -H "X-Chat-Session: $t" http://127.0.0.1:8000/api/v1/chat/history
```

**5. A bad slug must 404:**

```powershell
curl.exe -s -i -X POST http://127.0.0.1:8000/api/v1/chat/session `
  -H "Content-Type: application/json" -d '{\"chat_slug\":\"does-not-exist\"}'
```

**6. A forged token must 401:**

```powershell
curl.exe -s -i -X POST http://127.0.0.1:8000/api/v1/chat/message `
  -H "Content-Type: application/json" -H "X-Chat-Session: totally-made-up" `
  -d '{\"message\":\"hello\"}'
```

**7. An oversized message must 413:**

```powershell
$long = "a" * 2000
curl.exe -s -i -X POST http://127.0.0.1:8000/api/v1/chat/message `
  -H "Content-Type: application/json" -H "X-Chat-Session: $t" `
  -d "{`"message`": `"$long`"}"
```

**8. Rate limiting must kick in.** Fire 25 messages at one session:

```powershell
1..25 | ForEach-Object {
  $r = curl.exe -s -o NUL -w "%{http_code}" -X POST http://127.0.0.1:8000/api/v1/chat/message `
    -H "Content-Type: application/json" -H "X-Chat-Session: $t" `
    -d '{\"message\":\"hi\"}'
  Write-Host "$_ -> $r"
}
```

### Expected result

**1.**
```json
{
  "session_token": "kJ8vQ2mNx7...",
  "conversation_id": "3f2a1b9c-...",
  "business": {"name": "Pulse Fitness Studio", "chat_slug": "pulse-fitness", "accent": "indigo", "location": "Gachibowli, Hyderabad"},
  "greeting": "Hi! I'm the Pulse Fitness assistant. Ask me about memberships, timings, classes or trainers."
}
```

**2.**
```json
{"reply":"Yes — quarterly and annual members can freeze for up to 30 days a year, in blocks of at least a week. Monthly plans can't be frozen. Which plan are you on?","handed_over":false,"notice":null,"latency_ms":640}
```

**3.** The reply refers back to freezing without you repeating the subject —
proof that history is reaching the model.

**4.** The full transcript, greeting first, alternating roles.

**5.** `HTTP/1.1 404` and `{"detail":"This chat link is not available."}`

**6.** `HTTP/1.1 401` and
`{"detail":"Your chat session has expired. Please refresh the page."}`

**7.** `HTTP/1.1 413` and a message about length.

**8.** The first 20 or so return `200`, then the rest return `429`, each
carrying a `Retry-After` header with the seconds to wait. Your uvicorn terminal
logs `session limit hit for key=...`.

**This is the most important test in Part 4.** It proves that a stranger with
your URL cannot run up your bill.

Finally, check Supabase:

| Table | What to check |
| --- | --- |
| `chat_sessions` | One row. `token_hash` is a 64-character hex string — **not** the token you pasted. |
| `conversations` | One row, `channel = web`, `visitor_label` like "Visitor 4821". |
| `messages` | Greeting + your messages + replies, in order. |
| `agent_logs` | One row per agent run with `tool_calls` and `latency_ms`. |

That `token_hash` check matters: confirm with your own eyes that the raw token is
nowhere in the database.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| PowerShell mangles the JSON | Quoting | Escape inner quotes as `\"`, or use `/docs` → Try it out. |
| `curl` behaves strangely | PowerShell alias | Always `curl.exe`. |
| `401` on message right after a successful session | Token copied with surrounding quotes | Copy only the value, no quotes. |
| Rate limit never triggers | Server restarted between calls | Counters are in memory; run the loop in one go. |
| `500 Internal server error` | A real bug | The traceback is in terminal 1. |
| Follow-up ignores context | History not loading | Check `messages` rows exist for that conversation. |

---

## End of Part 4 — checklist

- [ ] `POST /chat/session` returns a token and the business greeting
- [ ] `POST /chat/message` answers using real knowledge base content
- [ ] A follow-up message shows the agent remembers the thread
- [ ] `GET /chat/history` returns the full transcript
- [ ] A bad slug returns 404, a forged token returns 401
- [ ] An oversized message returns 413
- [ ] Message 21 or so returns 429
- [ ] `chat_sessions.token_hash` is a hash, not the token

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add backend docs/guides
git commit -m "Add public chat API: anonymous sessions, rate limits, endpoints"
```

Next: [05-chat-ui.md](05-chat-ui.md) — the part the customer actually sees.
