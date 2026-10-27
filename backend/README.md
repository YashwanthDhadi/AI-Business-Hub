# Backend — FastAPI

The Python API between the Next.js frontend, Supabase and the language models.
Setup is in [SETUP.md](../SETUP.md); running and testing in
[RUN-AND-TEST.md](../docs/guides/RUN-AND-TEST.md).

## Layout

```
backend/
├── app/
│   ├── main.py            FastAPI app, CORS, router registration
│   ├── config.py          typed settings read from .env
│   ├── db.py              the Supabase client
│   ├── security.py        dashboard-key check for owner routes (development grade)
│   ├── schemas.py         Pydantic request/response models
│   ├── agents/
│   │   ├── supervisor.py      routes a message to capabilities (narrows, never grants)
│   │   ├── support_agent.py   the one agent loop; composes tools per business
│   │   ├── llm.py             model clients and fallbacks
│   │   └── tools/             one module per capability
│   ├── channels/speech.py voice → text (Groq Whisper)
│   ├── repositories/      every database read and write — all filter business_id
│   ├── routers/           HTTP routes: public chat, pay page, owner dashboard
│   └── services/          chat sessions, formatting, payments, rate limiting
├── scripts/               terminal harnesses against the real database
├── tests/                 pytest: unit/, contract/, security/
├── requirements.txt
├── pytest.ini
└── .env.example           copy to .env — the real .env is never committed
```

## Commands

Run from `backend/` with the virtual environment active.

```powershell
uvicorn app.main:app --reload --port 8000   # start the API
python -m pytest                            # 333 tests, no network
python scripts\smoke_test.py                # is it alive
python scripts\run_all_checks.py            # full integration suite
python scripts\chat.py                      # talk to the agent in the terminal
```
