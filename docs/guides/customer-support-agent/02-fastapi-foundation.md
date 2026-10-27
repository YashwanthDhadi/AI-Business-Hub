# Part 2 — The FastAPI foundation (STEP 5 → STEP 9)

Five steps. At the end you will have a running Python web server that reads and
writes your Supabase tables, with a clickable API documentation page. No AI yet —
we build the plumbing first, so that when the agent misbehaves in Part 3 you
already know the plumbing is sound.

---

## STEP 5 — Install the Python dependencies

### Goal

Install every library the backend needs into the `.venv` you already created,
and record them in `requirements.txt`.

### Why?

`.venv` is a private Python installation for this project. Installing into it
instead of your system Python means this project's versions can never break
another project, and `requirements.txt` lets you — or a teammate, or a server —
recreate the exact environment with one command.

### Architecture

```
What each library does

  fastapi            the web framework — turns Python functions into HTTP routes
  uvicorn            the web server that actually runs FastAPI
  pydantic-settings  reads .env into a typed Python object
  supabase           official client for talking to your database over HTTPS
  langchain-core     the tool and message abstractions the agent is built from
  langchain-openai   the OpenAI-format adapter - talks to OpenRouter
  httpx              plain HTTP client — used for Whisper speech-to-text
  python-multipart   lets FastAPI accept the uploaded audio file in Part 6
  tzdata             Windows has no timezone database; zoneinfo needs this
```

No vendor SDK for speech. Groq's transcription endpoint is one multipart POST,
and `httpx` already does that.

### Files involved

```
backend/
└── requirements.txt     ← create
```

### Code

Create `backend/requirements.txt`:

```text
# ------------------------------------------------------------------ web layer
fastapi>=0.115,<1.0
uvicorn[standard]>=0.32,<1.0
python-multipart>=0.0.9,<1.0
pydantic>=2.9,<3.0
pydantic-settings>=2.6,<3.0

# ------------------------------------------------------------------- database
supabase>=2.10,<3.0

# ------------------------------------------------------------------------ LLM
# OpenRouter speaks the OpenAI API format, so the OpenAI adapter is what we use.
langchain-core>=0.3,<0.4
langchain-openai>=0.2,<0.4

# ---------------------------------------------------------------------- misc
httpx>=0.27,<1.0
# Windows ships no system timezone database; zoneinfo needs this package.
tzdata>=2024.2

# ----------------------------------------------------------------- dev / test
pytest>=8.3,<9.0
```

### Explain the code

```text
fastapi>=0.115,<1.0
```
A **version range**, not a fixed pin. `>=0.115` means "at least this version,
because I use features added in it". `<1.0` means "never jump to the next major
version automatically, because major versions are allowed to break things". The
sweet spot for a learning project: bug fixes without waking up to a broken build.

```text
uvicorn[standard]
```
The `[standard]` in brackets is an *extra* — optional performance packages
(`httptools`, `watchfiles` for auto-reload). Without it `--reload` is noticeably
slower.

```text
python-multipart
```
Easy to forget, cryptic when missing. The voice endpoint in Part 6 accepts an
uploaded audio file, and FastAPI can only parse `multipart/form-data` if this is
installed. Skip it and you get
`Form data requires "python-multipart" to be installed` at startup.

```text
langchain-core + langchain-openai
```
Note there is no plain `langchain` package. You do not need it. `langchain-core`
gives you the message and tool types; `langchain-openai` gives you `ChatOpenAI`.
Installing the full meta-package pulls in dozens of integrations you will never
use and makes dependency conflicts far more likely.

`langchain-openai` does **not** mean you are using OpenAI. OpenRouter exposes the
OpenAI wire format, so this one adapter talks to OpenRouter, Groq, Together or
OpenAI depending only on `LLM_BASE_URL`.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
.\.venv\Scripts\Activate.ps1
```

Your prompt should now start with `(.venv)`. If it does not, nothing below
works — see Common errors.

```powershell
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

This takes 1–3 minutes.

### How to test

```powershell
python -c "import fastapi, uvicorn, supabase, httpx, langchain_openai; print('all imports OK')"
python -c "from zoneinfo import ZoneInfo; print(ZoneInfo('Asia/Kolkata'))"
```

### Expected result

```
all imports OK
Asia/Kolkata
```

The second line proves `tzdata` landed. Without it that call raises
`ZoneInfoNotFoundError`, and it would not bite you until STEP 11.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `Activate.ps1 ... running scripts is disabled on this system` | PowerShell execution policy | Run once: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, answer `Y`, activate again. |
| Prompt does not show `(.venv)` | Venv not active — pip is installing globally | Re-run activate from the **project root**. Confirm with `python -c "import sys; print(sys.prefix)"`; it must end in `.venv`. |
| `ModuleNotFoundError` after installing | Installed into one Python, running another | VS Code: `Ctrl+Shift+P` → *Python: Select Interpreter* → the one inside `.venv`. |
| `ERROR: Could not build wheels for ...` | No C compiler for a source-only package | Everything here ships Windows wheels for Python 3.12. Stay on your 3.12 venv. |
| `OSError: [Errno 22] Invalid argument` mid-install | OneDrive syncing the folder | Pause OneDrive sync (tray → Pause syncing → 2 hours). |

---

## STEP 6 — Configuration and secrets

### Goal

Put every secret in one git-ignored `.env`, and load it into a single typed
Python object the rest of the codebase reads from.

### Why?

Three reasons, in order of importance:

1. **Secrets must never reach git.** A key committed to a public repo is scraped
   by bots within minutes.
2. **One place to change things.** Model names, limits and URLs change. Hunting
   them across twenty files is how bugs are born.
3. **Fail fast.** If `OPENROUTER_API_KEY` is missing the server should refuse to
   start with a clear message, not crash three hours later on a live chat.

### Architecture

```
backend/.env            (real secrets — git-ignored, never committed)
      │
      ▼
backend/app/config.py   (reads and validates them once at startup)
      │
      ▼
settings.openrouter_api_key  (everything else imports this)
```

### Files involved

```
backend/
├── .env.example        ← create (committed — a template, no real values)
├── .env                ← create (your real keys — git-ignored)
└── app/
    ├── __init__.py     ← create (empty)
    └── config.py       ← create
```

### Code

**`backend/.env.example`** — the committed template:

```text
# =============================================================================
# AI Business Hub — backend environment template
# Copy to .env and fill in real values. NEVER commit .env.
# =============================================================================

# ------------------------------------------------------------------- general
APP_ENV=development
LOG_LEVEL=INFO
# Browser origins allowed to call this API. The public chat page is one of them.
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# ------------------------------------------------------------------ Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
# service_role / secret key. Bypasses row level security. Server only.
SUPABASE_SERVICE_ROLE_KEY=

# ------------------------------------------------- LLM (via OpenRouter)
# Get a key at https://openrouter.ai/keys - it starts with sk-or-v1-
OPENROUTER_API_KEY=
# Model id EXACTLY as OpenRouter lists it. Must support tool calling:
#   python scripts/check_models.py
LLM_MODEL=qwen/qwen3.8-27b:free
LLM_BASE_URL=https://openrouter.ai/api/v1
# Shown on OpenRouter's leaderboard. Any value works.
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=AI Business Hub
LLM_TEMPERATURE=0.3
# Safety net: the agent may call tools at most this many times per message.
AGENT_MAX_STEPS=6

# ------------------------------------------------ speech to text (Groq)
# Chat is on OpenRouter; Groq is kept ONLY for free Whisper in Part 6.
GROQ_API_KEY=
GROQ_STT_MODEL=whisper-large-v3-turbo

# ---------------------------------------------------------------- public chat
# How long an anonymous visitor's session stays resumable.
CHAT_SESSION_TTL_DAYS=7
# Longest message a visitor may send. Stops prompt-stuffing and runaway bills.
CHAT_MAX_MESSAGE_CHARS=1000
# Abuse limits, counted over CHAT_RATE_WINDOW_SECONDS.
CHAT_RATE_WINDOW_SECONDS=300
CHAT_RATE_LIMIT_PER_SESSION=20
CHAT_RATE_LIMIT_PER_IP=40
VOICE_RATE_LIMIT_PER_SESSION=8
# Largest audio upload accepted, in megabytes.
VOICE_MAX_UPLOAD_MB=8
# Salt for hashing visitor IPs. Any long random string. Changing it resets
# rate-limit history, which is harmless.
IP_HASH_SALT=change-me-to-a-long-random-string

# ---------------------------------------------------------------- dashboard
# Shared secret the Next.js server sends as X-Dashboard-Key.
# Development-grade only — replaced by Supabase Auth JWTs in a later phase.
DASHBOARD_API_KEY=change-me-to-a-long-random-string

# --------------------------------------------------------------------- demo
# Used by the terminal test scripts so they know which business to talk to.
DEMO_CHAT_SLUG=pulse-fitness
```

**`backend/.env`** — your real file. Copy the template and paste in your Part 0
values. Generate the two random strings first:

```powershell
python -c "import secrets; print('IP_HASH_SALT=' + secrets.token_hex(24))"
python -c "import secrets; print('DASHBOARD_API_KEY=' + secrets.token_hex(24))"
```

```text
APP_ENV=development
LOG_LEVEL=INFO
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...your real service role key...

OPENROUTER_API_KEY=sk-or-v1-...your real openrouter key...
LLM_MODEL=qwen/qwen3.8-27b:free
LLM_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=AI Business Hub
LLM_TEMPERATURE=0.3
AGENT_MAX_STEPS=6

# Only needed from Part 6 onward. Leave blank for now if you like.
GROQ_API_KEY=gsk_...your real groq key...
GROQ_STT_MODEL=whisper-large-v3-turbo

CHAT_SESSION_TTL_DAYS=7
CHAT_MAX_MESSAGE_CHARS=1000
CHAT_RATE_WINDOW_SECONDS=300
CHAT_RATE_LIMIT_PER_SESSION=20
CHAT_RATE_LIMIT_PER_IP=40
VOICE_RATE_LIMIT_PER_SESSION=8
VOICE_MAX_UPLOAD_MB=8
IP_HASH_SALT=paste-the-generated-value
DASHBOARD_API_KEY=paste-the-other-generated-value

DEMO_CHAT_SLUG=pulse-fitness
```

**`backend/app/__init__.py`** — create it empty:

```python
```

**`backend/app/config.py`**:

```python
"""
Application configuration.

Every secret and every tunable value enters the program here and nowhere else.
Import `settings` from this module; never read os.environ elsewhere.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/app -> backend
BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    """Typed view of backend/.env, validated once at import time."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------- general
    app_env: str = "development"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:3000"

    # ------------------------------------------------------------ Supabase
    supabase_url: str
    supabase_service_role_key: str

    # ------------------------------------------------- LLM (via OpenRouter)
    # OpenRouter speaks the OpenAI API format, so llm_base_url + llm_model also
    # work unchanged for Groq, Together or OpenAI. Only the key is provider
    # specific.
    openrouter_api_key: str
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = "qwen/qwen3.8-27b:free"
    # Sent as HTTP-Referer and X-Title. OpenRouter only; harmless elsewhere.
    openrouter_site_url: str = "http://localhost:3000"
    openrouter_app_name: str = "AI Business Hub"
    llm_temperature: float = 0.3
    agent_max_steps: int = 6

    # ------------------------------------------------ speech to text (Groq)
    # Chat moved to OpenRouter; transcription stays on Groq's free Whisper.
    # Optional, so the server still starts before you reach Part 6.
    groq_api_key: str = ""
    groq_stt_model: str = "whisper-large-v3-turbo"

    # --------------------------------------------------------- public chat
    chat_session_ttl_days: int = 7
    chat_max_message_chars: int = 1000
    chat_rate_window_seconds: int = 300
    chat_rate_limit_per_session: int = 20
    chat_rate_limit_per_ip: int = 40
    voice_rate_limit_per_session: int = 8
    voice_max_upload_mb: int = 8
    ip_hash_salt: str = "change-me"

    # ----------------------------------------------------------- dashboard
    dashboard_api_key: str = "change-me"

    # ---------------------------------------------------------------- demo
    demo_chat_slug: str = "pulse-fitness"

    # ------------------------------------------------------------ helpers
    @property
    def cors_origin_list(self) -> list[str]:
        """CORS_ORIGINS is a comma-separated string; FastAPI wants a list."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def voice_max_upload_bytes(self) -> int:
        return self.voice_max_upload_mb * 1024 * 1024

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() in {"development", "dev", "local"}

    def masked(self) -> dict[str, object]:
        """Safe-to-log view. Used by /health — never leaks a secret."""

        def mask(value: str) -> str:
            if not value:
                return "MISSING"
            if len(value) <= 8:
                return "set"
            return f"{value[:4]}...{value[-4:]}"

        return {
            "app_env": self.app_env,
            "supabase_url": self.supabase_url,
            "supabase_service_role_key": mask(self.supabase_service_role_key),
            "openrouter_api_key": mask(self.openrouter_api_key),
            "llm_model": self.llm_model,
            "llm_base_url": self.llm_base_url,
            "groq_api_key": mask(self.groq_api_key),
            "groq_stt_model": self.groq_stt_model,
            "dashboard_api_key": mask(self.dashboard_api_key),
            "ip_hash_salt": mask(self.ip_hash_salt),
            "cors_origins": self.cors_origin_list,
            "demo_chat_slug": self.demo_chat_slug,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Build Settings once and reuse it for the life of the process."""
    return Settings()


# Module-level singleton, imported everywhere as: from app.config import settings
settings = get_settings()
```

### Explain the code

```python
BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"
```
`__file__` is the path of `config.py` itself; `.resolve()` makes it absolute;
two `.parent` hops land on `backend/`. The point: `.env` is found by its position
**relative to the code**, not relative to whatever folder you happened to be
standing in. Without this, running uvicorn from the repo root silently loads no
config at all.

```python
supabase_url: str
```
No default value, so the field is **required**. Miss it and the program refuses
to start, naming the field. Compare `log_level: str = "INFO"`, which is optional
because it has a default.

```python
chat_max_message_chars: int = 1000
```
A limit that exists because this endpoint is public. Without it, someone pastes
a 200,000-character novel, you forward it to the model, and you have handed a stranger
control of your token spend. Every public-facing knob in this block is there for
the same reason.

```python
ip_hash_salt: str = "change-me"
```
We rate-limit by IP, but we never store an IP. Hashing with a secret salt means
the stored value is useless to anyone who gets the database — including you —
while still being stable enough to count requests. Without the salt, hashes of
IPv4 addresses are trivially reversible: there are only four billion of them.

```python
extra="ignore"
```
Your `.env` will grow to hold settings for the Booking Agent before `Settings`
knows about them. `ignore` means unknown variables are skipped instead of
crashing.

```python
@lru_cache(maxsize=1)
def get_settings() -> Settings:
```
Memoises the function: the first call reads the file, every later call returns
the identical object. The `.env` file is read from disk exactly once per process.

```python
def masked(self) -> dict[str, object]:
```
Lets `/health` prove a key is loaded (`gsk_...3f9a`) without printing the key.
You will use this constantly. Never add a route that returns raw secrets, not
even "temporarily" — temporary code gets deployed.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
New-Item -ItemType Directory -Force backend\app
New-Item -ItemType File -Force backend\app\__init__.py
```

Then create the three files above. Confirm `.env` is invisible to git:

```powershell
git status --short backend
```

### How to test

```powershell
cd backend
python -c "from app.config import settings; import json; print(json.dumps(settings.masked(), indent=2))"
cd ..
```

### Expected result

```json
{
  "app_env": "development",
  "supabase_url": "https://xxxx.supabase.co",
  "supabase_service_role_key": "eyJh...sYm8",
  "openrouter_api_key": "sk-o...9f2c",
  "llm_model": "qwen/qwen3.8-27b:free",
  "llm_base_url": "https://openrouter.ai/api/v1",
  "groq_api_key": "gsk_...3f9a",
  "groq_stt_model": "whisper-large-v3-turbo",
  "dashboard_api_key": "a3f1...7c02",
  "ip_hash_salt": "9f2c...4b81",
  "cors_origins": ["http://localhost:3000", "http://127.0.0.1:3000"],
  "demo_chat_slug": "pulse-fitness"
}
```

Nothing should say `MISSING`. And `git status --short backend` must **not** list
`backend/.env`.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `ValidationError ... supabase_url Field required` | `.env` not found, or the variable is missing | Check the file is exactly `backend\.env`. Windows loves saving it as `.env.txt` — run `Get-ChildItem backend -Force` to see the true name. |
| `.env.txt` shown instead of `.env` | Notepad appended `.txt` | `Rename-Item backend\.env.txt backend\.env`. In future save with the filename in quotes: `".env"`. |
| Values load but are wrong | Quotes in `.env` | Write `GROQ_API_KEY=gsk_abc`, not `GROQ_API_KEY="gsk_abc"`. The quotes become part of the value. |
| `git status` lists `backend/.env` | Ignore rule not matching | Run `git check-ignore -v backend/.env` to see which rule applies. The root `.gitignore` already has `.env`. |
| `ModuleNotFoundError: No module named 'app'` | Wrong working directory | Run from `backend/`. |

---

## STEP 7 — The application and a health route

### Goal

Get a web server running on `http://127.0.0.1:8000` with an interactive API
documentation page and one route that proves your configuration loaded.

### Why?

Everything from here on is an HTTP route. This step builds the object they
attach to, plus the CORS rules that let the browser call it.

CORS matters more here than in a typical backend. The public
chat page runs in a **customer's browser** and calls this API directly. Get the
rules wrong and the chat silently fails with an empty error in the console.

### Architecture

```
uvicorn  (the server process, listens on port 8000)
   │
   ▼
FastAPI app  (app/main.py)
   │
   ├── CORSMiddleware       which websites may call this API from a browser
   ├── /health              is the process alive? are keys loaded?
   ├── /api/v1/chat/*       the public chat — STEP 14 onward
   └── /api/v1/dashboard/*  the owner's screens — STEP 23
```

### Files involved

```
backend/app/
├── main.py                 ← create
└── routers/
    ├── __init__.py         ← create (empty)
    └── health.py           ← create
```

### Code

**`backend/app/routers/__init__.py`** — empty:

```python
```

**`backend/app/routers/health.py`**:

```python
"""Liveness and configuration checks."""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    """Cheap liveness probe. Touches nothing external."""
    return {
        "status": "ok",
        "env": settings.app_env,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health/config")
def health_config() -> dict:
    """Shows which credentials are loaded. Values are masked, never raw."""
    return {"status": "ok", "config": settings.masked()}
```

**`backend/app/main.py`**:

```python
"""
FastAPI application entry point.

Creates the app, installs middleware, and mounts every router. Routers are
imported here and nowhere else, so this file is the map of the whole API.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import health

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("aibh")

app = FastAPI(
    title="AI Business Hub API",
    description="Backend for the AI Business Hub agent platform.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)

# ------------------------------------------------------------------ middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Chat-Session", "X-Dashboard-Key"],
)


# --------------------------------------------------------------- error handler
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Last line of defence. Logs the full traceback for you, returns a short,
    safe message to the caller. Never leak internals to a public endpoint.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "path": request.url.path},
    )


# -------------------------------------------------------------------- lifecycle
@app.on_event("startup")
async def on_startup() -> None:
    logger.info("AI Business Hub API starting in %s mode", settings.app_env)
    logger.info("CORS origins: %s", settings.cors_origin_list)


# ---------------------------------------------------------------------- routes
app.include_router(health.router)


@app.get("/")
def root() -> dict:
    return {
        "name": "AI Business Hub API",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }
```

### Explain the code

```python
app = FastAPI(title=..., docs_url="/docs")
```
`FastAPI()` builds the application object. Think of `app` as a switchboard: it
holds the table of "URL path → Python function". It does not listen on a port
itself — uvicorn does that and asks `app` what to do with each request.

`docs_url="/docs"` gives you an interactive documentation page generated from
your type hints. You will use it for nearly every test in this guide. It is not
a toy: it is a real HTTP client that knows your API's shape.

```python
router = APIRouter(tags=["health"])
```
An `APIRouter` is a mini-app you build in its own file and plug into the main app
with `include_router`. Without routers, `main.py` becomes a two-thousand-line
file.

```python
allow_origins=settings.cors_origin_list,
allow_headers=["Content-Type", "X-Chat-Session", "X-Dashboard-Key"],
```
CORS — cross-origin resource sharing — is a browser rule: JavaScript served from
`http://localhost:3000` may not call `http://127.0.0.1:8000` unless the API says
that origin is welcome.

Two details that will cost you an hour if you get them wrong:

- **`allow_headers` must list your custom headers.** `X-Chat-Session` is how the
  visitor's browser identifies its session in STEP 15. If it is not listed, the
  browser's preflight check fails and the request never leaves the machine —
  with a console error that does not mention the header.
- **`allow_credentials=False` is deliberate.** We use a header token, not
  cookies, so we do not need credentialed requests. Leaving it `False` lets you
  keep using explicit origins safely, and avoids the trap where
  `allow_origins=["*"]` and `allow_credentials=True` together are silently
  rejected by every browser.

Note CORS only affects browsers. `curl` ignores it entirely — so if a route works
in curl but not in the chat page, CORS is your first suspect.

```python
@app.exception_handler(Exception)
```
If any route raises something nobody caught, this runs. It logs the full
traceback to *your* terminal and returns a bland `500` to the caller. That split
matters on a public endpoint: a stranger does not need your stack trace, your
file paths, or your table names.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
New-Item -ItemType Directory -Force backend\app\routers
New-Item -ItemType File -Force backend\app\routers\__init__.py
```

Then create `health.py` and `main.py`.

### How to run

This runs in **terminal 1** and stays running for the rest of the guide:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn app.main:app --reload --port 8000
```

You should see:

```
INFO:     Will watch for changes in these directories: ['...\backend']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
2026-01-01 10:00:00  INFO  aibh  AI Business Hub API starting in development mode
INFO:     Application startup complete.
```

`app.main:app` reads as "in the module `app.main`, use the variable named `app`".
`--reload` restarts the server whenever you save a `.py` file — on while
developing, always off in production.

### How to test

1. Browser: <http://127.0.0.1:8000/docs>
2. Browser: <http://127.0.0.1:8000/health/config>
3. Terminal: `curl.exe -s http://127.0.0.1:8000/health`

### Expected result

**1.** A page titled "AI Business Hub API 0.1.0" listing `GET /`, `GET /health`
and `GET /health/config`. Click `GET /health` → **Try it out** → **Execute** →
`200` with `{"status":"ok",...}`.

**2.** Your masked config. Every field populated, none saying `MISSING`.

**3.** The same JSON in your terminal.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `Error loading ASGI app. Could not import module "app.main"` | Wrong directory | You must be inside `backend/`. `cd backend` first. |
| `[Errno 10048] error while attempting to bind` | Port 8000 in use | `Get-NetTCPConnection -LocalPort 8000 \| Select-Object OwningProcess`, then `Stop-Process -Id <id>`. |
| `DeprecationWarning: on_event is deprecated` | FastAPI prefers lifespan handlers now | Harmless. It still works. |
| `{"detail":"Not Found"}` at `/` | Typo in the path | Routes are case-sensitive. `/Health` is not `/health`. |
| `/docs` blank or unstyled | Corporate network blocking the CDN for Swagger's CSS | Test with `curl.exe` instead, or set `redoc_url="/redoc"`. |
| `--reload` restarts endlessly | Watchfiles reacting to OneDrive touching files | Run with `--reload-dir app`. |

---

## STEP 8 — Connect to Supabase

### Goal

Create one shared Supabase client object that every part of the backend uses.

### Why?

Creating a new client per request re-does TLS handshakes and connection setup
every time. We build one at startup and share it. This file is also the only
place that touches the service_role key, which makes it easy to audit.

### Architecture

```
app/db.py
   │  holds one supabase.Client, built once
   ▼
app/repositories/*.py   the only modules allowed to call it
   │
   ▼
app/routers/*.py        routes call repositories, never the client directly
```

That layering matters. When a route does `supabase.table("messages").select(...)`
inline, you end up with the same query written six slightly different ways, and
one of them forgets the `business_id` filter. Repositories give you one place to
get tenant filtering right.

### Files involved

```
backend/app/
└── db.py               ← create
```

### Code

**`backend/app/db.py`**:

```python
"""
Supabase access.

This module owns the one and only Supabase client. It is created with the
service_role key, which BYPASSES row level security — so every query made
through it must filter by business_id explicitly. That discipline lives in
app/repositories/.
"""

import logging
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from app.config import settings

logger = logging.getLogger("aibh.db")


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Build the Supabase client once and reuse it."""
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env"
        )
    logger.info("Connecting to Supabase at %s", settings.supabase_url)
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


# Imported everywhere as:  from app.db import db
db: Client = get_client()


def rows(response: Any) -> list[dict]:
    """
    Normalise a supabase-py response to a plain list of dicts.

    The SDK returns an object with a .data attribute. Unwrapping it here means
    the rest of the codebase deals in ordinary Python lists.
    """
    data = getattr(response, "data", None)
    if data is None:
        return []
    if isinstance(data, dict):
        return [data]
    return list(data)


def one(response: Any) -> dict | None:
    """First row of a response, or None when nothing matched."""
    found = rows(response)
    return found[0] if found else None


def ping() -> dict:
    """
    Prove the connection works by reading one row from a table we know exists.
    Used by the /health/db route.
    """
    try:
        response = db.table("businesses").select("id, name, chat_slug").limit(1).execute()
        found = rows(response)
        return {
            "connected": True,
            "businesses_visible": len(found),
            "sample": found[0]["name"] if found else None,
            "chat_slug": found[0]["chat_slug"] if found else None,
        }
    except Exception as exc:  # noqa: BLE001 - health checks report, never raise
        logger.exception("Supabase ping failed")
        return {"connected": False, "error": str(exc)}
```

Now add a database health route. **Replace** `backend/app/routers/health.py`
with this:

```python
"""Liveness and configuration checks."""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import settings
from app.db import ping

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    """Cheap liveness probe. Touches nothing external."""
    return {
        "status": "ok",
        "env": settings.app_env,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health/config")
def health_config() -> dict:
    """Shows which credentials are loaded. Values are masked, never raw."""
    return {"status": "ok", "config": settings.masked()}


@router.get("/health/db")
def health_db() -> dict:
    """Round-trips a real query to Supabase."""
    result = ping()
    return {"status": "ok" if result.get("connected") else "error", "database": result}
```

### Explain the code

```python
db: Client = get_client()
```
Module-level code runs once, the first time anything imports `app.db`. Python
caches modules, so every later `from app.db import db` gets the same object. The
simplest correct way to share one connection.

```python
def rows(response: Any) -> list[dict]:
    data = getattr(response, "data", None)
```
supabase-py returns an `APIResponse` object, not a list. Every call site would
otherwise end in `.data`, and one of them would forget. Wrapping it once also
means a future SDK change is one function to fix, not forty call sites.

```python
except Exception as exc:
    return {"connected": False, "error": str(exc)}
```
A health check must **never** raise. If it raises, your monitoring reports
"server down" when the truth is "server up, database unreachable" — two very
different problems with two very different fixes.

```python
db.table("businesses").select("id, name").limit(1).execute()
```
The supabase-py query style you will use constantly. It reads like SQL: pick a
table, pick columns, add filters, then `.execute()` actually sends the HTTP
request. **Nothing happens until `.execute()`.**

### Commands

Create `backend/app/db.py`, then overwrite `backend/app/routers/health.py`.
uvicorn reloads by itself — watch terminal 1 for `Application startup complete.`

### How to test

Open <http://127.0.0.1:8000/health/db>, or:

```powershell
curl.exe -s http://127.0.0.1:8000/health/db
```

### Expected result

```json
{
  "status": "ok",
  "database": {
    "connected": true,
    "businesses_visible": 1,
    "sample": "Pulse Fitness Studio",
    "chat_slug": "pulse-fitness"
  }
}
```

Seeing `"Pulse Fitness Studio"` means config loaded, key valid, network fine,
schema created and seed data present. That one line validates STEP 3 through
STEP 8.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `"connected": false, "error": "Invalid API key"` | Wrong or truncated service_role key | Re-copy from Supabase → Settings → API. The key is long; make sure nothing got cut. |
| `businesses_visible: 0` | Connected, but the seed did not run | Re-run `database/seed.sql`. |
| `relation "public.businesses" does not exist` | Migration not applied, or applied to a different project | Check `SUPABASE_URL` points at the project where you ran the migration. |
| `httpx.ConnectError` / `getaddrinfo failed` | DNS or offline | A wrong project ref gives exactly this. |
| `JWT expired` | Key from a deleted project | Get fresh keys from the current project. |
| Works via `python -c` but not via the server | Two `.env` files or two interpreters | `/health/config` shows what the *server* loaded. Trust that. |

---

## STEP 9 — Repositories: safe, reusable database access

### Goal

Write the functions that read and write each table, with tenant filtering baked
in, so no other file ever writes a raw query.

### Why?

This is the layer that makes multi-tenancy safe. Because the backend uses
`service_role`, Postgres will happily hand over *any* business's rows. The only
thing stopping a bug from leaking data across tenants is that every query
includes `.eq("business_id", business_id)`.

Putting all those queries in one folder means "did we filter by business?" is a
question you answer by reading five short files, not by auditing the codebase.
When the agent's tools call these functions in STEP 11, they physically cannot
reach another business's data.

### Architecture

```
routers / agent tools
        │  business_id is always an argument
        ▼
repositories  ──  .eq("business_id", business_id) on every single query
        │
        ▼
      app.db
```

### Files involved

```
backend/app/repositories/
├── __init__.py          ← create (empty)
├── businesses.py        ← create
├── knowledge.py         ← create
├── conversations.py     ← create
├── customers.py         ← create
├── support.py           ← create
└── logs.py              ← create
```

### Code

**`backend/app/repositories/__init__.py`** — empty:

```python
```

**`backend/app/repositories/businesses.py`**:

```python
"""Reads about a business: its profile, services and agent access."""

from app.db import db, one, rows


def get_business(business_id: str) -> dict | None:
    return one(
        db.table("businesses").select("*").eq("id", business_id).limit(1).execute()
    )


def get_business_by_chat_slug(chat_slug: str) -> dict | None:
    """
    Resolves the public chat URL to a tenant.

    This is the entry point for every anonymous visitor, so it also checks the
    business is active and has the chat channel switched on.
    """
    return one(
        db.table("businesses")
        .select("*")
        .eq("chat_slug", (chat_slug or "").strip().lower())
        .eq("is_active", True)
        .eq("chat_enabled", True)
        .limit(1)
        .execute()
    )


def list_services(business_id: str) -> list[dict]:
    return rows(
        db.table("business_services")
        .select("id, name, description, duration_minutes, price, price_note")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .order("sort_order")
        .execute()
    )


def is_agent_active(business_id: str, agent_key: str) -> bool:
    """
    The subscription gate. If a business has not activated an agent, the
    platform must not run it — this is how you charge per agent.
    """
    row = one(
        db.table("agent_subscriptions")
        .select("is_active")
        .eq("business_id", business_id)
        .eq("agent_key", agent_key)
        .limit(1)
        .execute()
    )
    return bool(row and row.get("is_active"))


def agent_settings(business_id: str, agent_key: str) -> dict:
    row = one(
        db.table("agent_subscriptions")
        .select("settings")
        .eq("business_id", business_id)
        .eq("agent_key", agent_key)
        .limit(1)
        .execute()
    )
    return (row or {}).get("settings") or {}
```

**`backend/app/repositories/knowledge.py`**:

```python
"""
The knowledge base — what the agent is allowed to say.

`search` is the single most important query in this project: it is what stops
the agent inventing a refund policy.
"""

import logging

from app.db import db, rows

logger = logging.getLogger("aibh.knowledge")


def search(business_id: str, query: str, limit: int = 4) -> list[dict]:
    """
    Full-text search over this business's knowledge base.

    Falls back to a plain substring match when full-text search finds nothing,
    which happens for very short or stopword-only queries ("what about that?").
    """
    text = (query or "").strip()
    if not text:
        return []

    try:
        response = db.rpc(
            "search_knowledge",
            {"p_business_id": business_id, "p_query": text, "p_limit": limit},
        ).execute()
        found = rows(response)
        if found:
            return found
    except Exception:  # noqa: BLE001
        logger.exception("search_knowledge RPC failed; falling back to ilike")

    # Fallback: cheap substring match on the title.
    return rows(
        db.table("knowledge_articles")
        .select("id, title, body")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .ilike("title", f"%{text[:60]}%")
        .limit(limit)
        .execute()
    )


def list_articles(business_id: str, limit: int = 200) -> list[dict]:
    return rows(
        db.table("knowledge_articles")
        .select("id, title, body, tags, is_active, updated_at")
        .eq("business_id", business_id)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )


def create_article(business_id: str, title: str, body: str, tags: list[str] | None = None) -> dict | None:
    from app.db import one

    return one(
        db.table("knowledge_articles")
        .insert(
            {
                "business_id": business_id,
                "title": title.strip(),
                "body": body.strip(),
                "tags": tags or [],
            }
        )
        .execute()
    )


def update_article(business_id: str, article_id: str, patch: dict) -> None:
    allowed = {k: v for k, v in patch.items() if k in {"title", "body", "tags", "is_active"}}
    if not allowed:
        return
    db.table("knowledge_articles").update(allowed).eq("business_id", business_id).eq(
        "id", article_id
    ).execute()


def delete_article(business_id: str, article_id: str) -> None:
    db.table("knowledge_articles").delete().eq("business_id", business_id).eq(
        "id", article_id
    ).execute()
```

**`backend/app/repositories/conversations.py`**:

```python
"""Chat threads and the messages inside them."""

import random
from datetime import datetime, timezone

from app.db import db, one, rows


def create(business_id: str, channel: str = "web") -> dict:
    """
    A new anonymous thread. No customer yet — one appears only if the visitor
    chooses to leave their details.
    """
    label = f"Visitor {random.randint(1000, 9999)}"
    created = one(
        db.table("conversations")
        .insert({"business_id": business_id, "channel": channel, "visitor_label": label})
        .execute()
    )
    if not created:
        raise RuntimeError("Could not create conversation")
    return created


def get(business_id: str, conversation_id: str) -> dict | None:
    return one(
        db.table("conversations")
        .select("*, customers(id, name, phone, email)")
        .eq("business_id", business_id)
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )


def add_message(
    *,
    business_id: str,
    conversation_id: str,
    direction: str,
    author: str,
    body: str,
    meta: dict | None = None,
) -> dict:
    """
    Append one chat turn, and keep the conversation summary in sync.

    Two writes on purpose: the messages row is the permanent record, the
    conversation row is a denormalised summary so the owner's inbox can be
    rendered without reading every message.
    """
    created = one(
        db.table("messages")
        .insert(
            {
                "business_id": business_id,
                "conversation_id": conversation_id,
                "direction": direction,
                "author": author,
                "body": body,
                "meta": meta or {},
            }
        )
        .execute()
    )

    current = one(
        db.table("conversations")
        .select("message_count")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )
    db.table("conversations").update(
        {
            "last_message_at": datetime.now(timezone.utc).isoformat(),
            "last_message_preview": (body or "")[:140],
            "message_count": ((current or {}).get("message_count") or 0) + 1,
        }
    ).eq("id", conversation_id).execute()

    if not created:
        raise RuntimeError("Could not store message")
    return created


def history(conversation_id: str, limit: int = 12) -> list[dict]:
    """
    The last `limit` messages, oldest first.

    Fetched newest-first so the limit keeps the RECENT ones, then reversed,
    because an LLM needs them in chronological order.
    """
    found = rows(
        db.table("messages")
        .select("author, body, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(found))


def messages_for(business_id: str, conversation_id: str, limit: int = 200) -> list[dict]:
    return rows(
        db.table("messages")
        .select("*")
        .eq("business_id", business_id)
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .limit(limit)
        .execute()
    )


def list_conversations(business_id: str, limit: int = 50) -> list[dict]:
    """Owner inbox: threads newest-activity first, with the customer if known."""
    return rows(
        db.table("conversations")
        .select("*, customers(id, name, phone, email)")
        .eq("business_id", business_id)
        .order("last_message_at", desc=True)
        .limit(limit)
        .execute()
    )


def attach_customer(business_id: str, conversation_id: str, customer_id: str) -> None:
    """Called once the visitor gives us a name or a number."""
    db.table("conversations").update({"customer_id": customer_id}).eq(
        "business_id", business_id
    ).eq("id", conversation_id).execute()


def set_human_takeover(business_id: str, conversation_id: str, enabled: bool) -> None:
    db.table("conversations").update({"human_takeover": enabled}).eq(
        "business_id", business_id
    ).eq("id", conversation_id).execute()
```

**`backend/app/repositories/customers.py`**:

```python
"""Customer records. On a web chat these appear late, if at all."""

from datetime import datetime, timezone

from app.db import db, one, rows


def normalise_phone(raw: str | None) -> str | None:
    """
    '+91 98765 43210' -> '+919876543210'
    '9876543210'      -> '+919876543210'   (assumes India when no country code)

    Returns None for anything that is not plausibly a phone number, so we never
    store junk the agent extracted from a sentence.
    """
    if not raw:
        return None
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    if len(digits) < 10:
        return None
    if len(digits) == 10:
        digits = f"91{digits}"
    return f"+{digits}"


def upsert_from_chat(
    *,
    business_id: str,
    name: str | None = None,
    phone: str | None = None,
    email: str | None = None,
) -> dict | None:
    """
    Create or update a customer from details captured in a conversation.

    Matches on phone first, then email. Returns None when we have nothing
    identifying — a name alone is not enough to make a customer record.
    """
    clean_phone = normalise_phone(phone)
    clean_email = (email or "").strip().lower() or None
    clean_name = (name or "").strip() or None

    if not clean_phone and not clean_email:
        return None

    existing = None
    if clean_phone:
        existing = one(
            db.table("customers")
            .select("*")
            .eq("business_id", business_id)
            .eq("phone", clean_phone)
            .limit(1)
            .execute()
        )
    if existing is None and clean_email:
        existing = one(
            db.table("customers")
            .select("*")
            .eq("business_id", business_id)
            .eq("email", clean_email)
            .limit(1)
            .execute()
        )

    now = datetime.now(timezone.utc).isoformat()

    if existing:
        patch = {"last_seen_at": now}
        if clean_name and not existing.get("name"):
            patch["name"] = clean_name
        if clean_phone and not existing.get("phone"):
            patch["phone"] = clean_phone
        if clean_email and not existing.get("email"):
            patch["email"] = clean_email
        db.table("customers").update(patch).eq("id", existing["id"]).execute()
        return {**existing, **patch}

    return one(
        db.table("customers")
        .insert(
            {
                "business_id": business_id,
                "name": clean_name,
                "phone": clean_phone,
                "email": clean_email,
            }
        )
        .execute()
    )


def list_customers(business_id: str, limit: int = 100) -> list[dict]:
    return rows(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .order("last_seen_at", desc=True)
        .limit(limit)
        .execute()
    )
```

**`backend/app/repositories/support.py`**:

```python
"""Handoffs to a human: escalations and callback requests."""

from datetime import datetime, timezone

from app.db import db, one, rows


def create_request(
    *,
    business_id: str,
    conversation_id: str | None,
    kind: str,
    reason: str,
    summary: str = "",
    customer_id: str | None = None,
    contact_name: str | None = None,
    contact_phone: str | None = None,
    contact_email: str | None = None,
) -> dict:
    if kind not in {"escalation", "callback"}:
        raise ValueError(f"Invalid support request kind: {kind}")

    created = one(
        db.table("support_requests")
        .insert(
            {
                "business_id": business_id,
                "conversation_id": conversation_id,
                "customer_id": customer_id,
                "kind": kind,
                "reason": reason[:2000],
                "summary": summary[:2000],
                "contact_name": contact_name,
                "contact_phone": contact_phone,
                "contact_email": contact_email,
            }
        )
        .execute()
    )
    if not created:
        raise RuntimeError("Could not create support request")
    return created


def list_requests(business_id: str, status: str | None = None, limit: int = 100) -> list[dict]:
    query = (
        db.table("support_requests")
        .select("*, conversations(id, visitor_label), customers(id, name, phone, email)")
        .eq("business_id", business_id)
    )
    if status:
        query = query.eq("status", status)
    return rows(query.order("created_at", desc=True).limit(limit).execute())


def open_count(business_id: str) -> int:
    return len(
        rows(
            db.table("support_requests")
            .select("id")
            .eq("business_id", business_id)
            .eq("status", "open")
            .execute()
        )
    )


def resolve(
    *, business_id: str, request_id: str, status: str, resolved_by: str, note: str = ""
) -> dict | None:
    if status not in {"open", "in_progress", "resolved", "dismissed"}:
        raise ValueError(f"Invalid support request status: {status}")

    patch: dict = {"status": status, "resolution_note": note}
    if status in {"resolved", "dismissed"}:
        patch["resolved_at"] = datetime.now(timezone.utc).isoformat()
        patch["resolved_by"] = resolved_by

    db.table("support_requests").update(patch).eq("business_id", business_id).eq(
        "id", request_id
    ).execute()

    return one(
        db.table("support_requests")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
```

**`backend/app/repositories/logs.py`**:

```python
"""Agent execution logs — the audit trail, and future training data."""

import logging

from app.db import db, rows

logger = logging.getLogger("aibh.logs")


def record(
    *,
    business_id: str,
    agent_key: str,
    model: str,
    input_text: str,
    output_text: str,
    tool_calls: list | None = None,
    latency_ms: int = 0,
    conversation_id: str | None = None,
    status: str = "ok",
    error: str | None = None,
) -> None:
    """
    Fire-and-forget. Logging must never break the customer's reply, so any
    failure here is swallowed and reported to the server log instead.
    """
    try:
        db.table("agent_logs").insert(
            {
                "business_id": business_id,
                "conversation_id": conversation_id,
                "agent_key": agent_key,
                "model": model,
                "input_text": input_text[:4000],
                "output_text": output_text[:4000],
                "tool_calls": tool_calls or [],
                "latency_ms": latency_ms,
                "status": status,
                "error": error,
            }
        ).execute()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to write agent log (continuing anyway)")


def recent(business_id: str, limit: int = 50) -> list[dict]:
    return rows(
        db.table("agent_logs")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
```

### Explain the code

```python
def get_business_by_chat_slug(chat_slug: str) -> dict | None:
    ... .eq("is_active", True).eq("chat_enabled", True)
```
The front door of the whole product, and it checks two flags as well as the
slug. A business that pauses its account or switches the chat off must stop
answering immediately, and doing that here means every route gets it for free.

```python
db.rpc("search_knowledge", {"p_business_id": business_id, "p_query": text, ...})
```
`rpc` calls the SQL function you created in STEP 3. Note `p_business_id` is
passed explicitly — the function has no idea who is calling, so the tenant filter
has to be an argument. That is the same discipline as every other query here.

```python
except Exception:
    logger.exception("search_knowledge RPC failed; falling back to ilike")
```
Knowledge search is on the critical path of every customer question. If the RPC
is missing or errors, a degraded substring search is far better than the agent
saying "sorry, something went wrong".

```python
if not clean_phone and not clean_email:
    return None
```
A deliberate refusal. The agent extracts contact details from natural language,
and it *will* sometimes decide that "my name is Priya" is enough to create a
customer. A record with a name and nothing else is unusable — you cannot call it
back. So we require something reachable.

```python
if len(digits) == 10:
    digits = f"91{digits}"
```
An assumption, stated openly: a bare 10-digit number is Indian. That is right for
this project and wrong for a global one. When you expand, take the country from
the business's own profile instead of hardcoding it.

```python
patch = {"last_seen_at": now}
if clean_name and not existing.get("name"):
    patch["name"] = clean_name
```
Only fills in blanks; never overwrites. If a customer already has a name on file
and today's visitor types a nickname, the real record wins. Chat-extracted data
is lower quality than data the owner entered.

```python
found = rows(... .order("created_at", desc=True).limit(limit).execute())
return list(reversed(found))
```
Subtle but important. You want the **most recent** 12 messages, so you sort
newest-first *before* the limit. But an LLM needs them oldest-first to follow the
conversation. Hence sort one way, reverse in Python. Sorting ascending and
limiting would give you the first 12 messages ever sent — useless.

```python
except Exception:
    logger.exception("Failed to write agent log (continuing anyway)")
```
Deliberate. If the logging table is full or a column type is wrong, the customer
should still get their answer. Logs are important; they are not more important
than the product working.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
New-Item -ItemType Directory -Force backend\app\repositories
New-Item -ItemType File -Force backend\app\repositories\__init__.py
```

Then create the six files above.

### How to test

Create `backend/scripts/check_repos.py`:

```python
"""Throwaway sanity check for the repository layer. Run from backend/."""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.repositories import businesses, conversations, customers, knowledge, support

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
print("business         :", (business or {}).get("name"))
if business is None:
    raise SystemExit("No business for that chat slug — check seed.sql and DEMO_CHAT_SLUG")

bid = business["id"]
print("services         :", [s["name"] for s in businesses.list_services(bid)])
print("support agent on :", businesses.is_agent_active(bid, "customer_support"))
print("booking agent on :", businesses.is_agent_active(bid, "booking"))

print("\nknowledge search 'can I pause my membership':")
for row in knowledge.search(bid, "can I pause my membership"):
    print("   -", row["title"])

print("\nknowledge search 'ladies only timing':")
for row in knowledge.search(bid, "ladies only timing"):
    print("   -", row["title"])

thread = conversations.create(bid)
print("\nconversation     :", thread["id"], thread["visitor_label"])

conversations.add_message(
    business_id=bid, conversation_id=thread["id"],
    direction="inbound", author="customer", body="Repository smoke test",
)
conversations.add_message(
    business_id=bid, conversation_id=thread["id"],
    direction="outbound", author="agent", body="Acknowledged.",
)
print("history          :", [m["body"] for m in conversations.history(thread["id"])])

person = customers.upsert_from_chat(business_id=bid, name="Akshaya", phone="9876543210")
print("customer         :", (person or {}).get("name"), (person or {}).get("phone"))
print("name only        :", customers.upsert_from_chat(business_id=bid, name="Nobody"))

request = support.create_request(
    business_id=bid, conversation_id=thread["id"], kind="callback",
    reason="Wants to discuss corporate membership", contact_phone="+919876543210",
)
print("support request  :", request["kind"], request["status"])
print("open requests    :", support.open_count(bid))
```

Run it:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
New-Item -ItemType Directory -Force scripts
python scripts\check_repos.py
```

### Expected result

```
business         : Pulse Fitness Studio
services         : ['Monthly Membership', 'Quarterly Membership', 'Annual Membership', 'Personal Training', 'Group Classes Add-on', 'Day Pass']
support agent on : True
booking agent on : False

knowledge search 'can I pause my membership':
   - Can I freeze or pause my membership?

knowledge search 'ladies only timing':
   - Are there separate timings for women?

conversation     : 3f2a...-.... Visitor 4821
history          : ['Repository smoke test', 'Acknowledged.']
customer         : Akshaya +919876543210
name only        : None
support request  : callback open
open requests    : 1
```

Four things to notice:

1. **`booking agent on: False`** — the subscription gate correctly reports that
   this business has not paid for the next agent. That boolean is your pricing
   model.
2. **Both knowledge searches found the right article** despite completely
   different wording. That is full-text search earning its place.
3. **`9876543210` became `+919876543210`** — normalisation works.
4. **`name only: None`** — a name with no contact details is correctly refused.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `ModuleNotFoundError: No module named 'app'` | Wrong folder | Run from `backend/`, not the repo root. |
| `business: None` | `DEMO_CHAT_SLUG` does not match `chat_slug` in the seed | Both must be `pulse-fitness`. |
| Knowledge searches return nothing | The RPC is missing, or `search_vector` was not created | Re-run the migration; check `select proname from pg_proc where proname='search_knowledge';`. |
| `Could not find a relationship between 'conversations' and 'customers'` | Missing foreign key | Re-run the migration. PostgREST discovers joins from foreign keys only. |
| `'NoneType' object is not subscriptable` after an insert | The insert returned no row | Confirm you are using the service_role key. |
| `APIError: JSON object requested, multiple rows returned` | A `.single()` somewhere matched more than one row | We avoid `.single()` for exactly this — use `one()` from `app.db`. |

---

## End of Part 2 — checklist

- [ ] `python -m pip list` shows fastapi, supabase, httpx, langchain-openai
- [ ] `backend/.env` exists, is filled, and is **not** listed by `git status`
- [ ] `uvicorn app.main:app --reload --port 8000` runs with no errors
- [ ] <http://127.0.0.1:8000/docs> lists your routes
- [ ] `/health/config` shows everything loaded, nothing `MISSING`
- [ ] `/health/db` returns `"sample": "Pulse Fitness Studio"`
- [ ] `python scripts\check_repos.py` prints the expected block
- [ ] Both knowledge searches find the right article

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add backend docs/guides
git status --short          # confirm backend/.env is NOT listed
git commit -m "Add FastAPI foundation: config, Supabase client, repositories"
```

Next: [03-the-agent.md](03-the-agent.md) — where it starts thinking.
