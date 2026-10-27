"""
Is the system alive and basically correct? Thirty seconds, no LLM.

This is the first thing to run after a deploy, after a migration, or when
something feels wrong. It is deliberately shallow and wide: one touch of every
moving part, so a broken piece is named immediately. It does not try to prove
any of them correct - that is what the other scripts are for.

    python scripts\\smoke_test.py

If this fails, nothing else is worth running until it passes.
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

ROOT = "http://127.0.0.1:8000"
API = f"{ROOT}/api/v1"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL':<5} {label:<46} {detail}")


# ---------------------------------------------------------- configuration
print("\nconfiguration")
try:
    from app.config import settings

    check("settings load", True)
    for name, value in [
        ("SUPABASE_URL", settings.supabase_url),
        ("SUPABASE_SERVICE_ROLE_KEY", settings.supabase_service_role_key),
        ("DASHBOARD_API_KEY", settings.dashboard_api_key),
        ("OPENROUTER_API_KEY", settings.openrouter_api_key),
        ("GOOGLE_API_KEY (router)", settings.google_api_key),
    ]:
        check(f"{name} is set", bool(value), "" if value else "MISSING from .env")
except Exception as exc:  # noqa: BLE001
    check("settings load", False, exc)
    print("\nnothing else can run without configuration")
    sys.exit(1)

# ---------------------------------------------------------------- database
print("\ndatabase")
try:
    from app.config import settings as s
    from app.repositories import businesses

    business = businesses.get_business_by_chat_slug(s.demo_chat_slug)
    check("Supabase answers", business is not None,
          "" if business else f"no business with chat_slug '{s.demo_chat_slug}'")
    if business is None:
        print("\nno demo business - the rest would be meaningless")
        sys.exit(1)
    bid = business["id"]
    check("the demo business is there", True, business["name"])

    # One read per table the product depends on. A missing migration shows up
    # here as a named table rather than as a mystery 500 later.
    from app.db import db

    # Every table the migrations create. There is deliberately no `payments`
    # table - a payment is a state change on the invoice row plus a ledger
    # entry, so there is one place to ask "is this paid?".
    for table in ("agent_logs", "agent_subscriptions", "appointments",
                  "business_members", "business_services", "businesses",
                  "campaign_recipients", "campaigns", "chat_sessions",
                  "conversations", "customer_notes", "customers", "documents",
                  "inventory_items", "inventory_movements", "invoice_counters",
                  "invoices", "knowledge_articles", "messages", "support_requests"):
        try:
            # select("*"), not select("id"): invoice_counters is keyed on
            # (business_id, financial_year) and has no id column.
            db.table(table).select("*").limit(1).execute()
            check(f"table {table}", True)
        except Exception as exc:  # noqa: BLE001
            check(f"table {table}", False, str(exc)[:60])

    # The functions the reports and inventory agents call.
    from app.repositories import reports as report_repo

    check("report_summary() runs", report_repo.summary(bid, days=7) is not None)
    check("report_daily view runs", len(report_repo.daily(bid, days=7)) == 7)
except Exception as exc:  # noqa: BLE001
    check("database", False, f"{type(exc).__name__}: {str(exc)[:70]}")

# ------------------------------------------------------------------- HTTP
print("\nthe API")
try:
    health = httpx.get(f"{ROOT}/health", timeout=20)
    check("GET /health is 200", health.status_code == 200, health.status_code)

    keyed = {"X-Dashboard-Key": settings.dashboard_api_key}
    stats = httpx.get(f"{API}/dashboard/stats", params={"business_id": bid},
                      headers=keyed, timeout=30)
    check("GET /dashboard/stats is 200", stats.status_code == 200, stats.status_code)

    naked = httpx.get(f"{API}/dashboard/stats", params={"business_id": bid}, timeout=20)
    check("the dashboard is guarded", naked.status_code == 401, naked.status_code)

    for path in ("customers", "bookings", "inventory", "documents",
                 "payments/invoices", "conversations", "reports"):
        params = {"business_id": bid}
        if path == "reports":
            params["days"] = 7
        response = httpx.get(f"{API}/dashboard/{path}", params=params,
                             headers=keyed, timeout=30)
        check(f"GET /dashboard/{path}", response.status_code == 200, response.status_code)

    # The public chat, which is the customer's way in.
    session = httpx.post(f"{API}/chat/session",
                         json={"chat_slug": settings.demo_chat_slug}, timeout=30)
    check("POST /chat/session opens a chat", session.status_code == 200, session.status_code)
except httpx.ConnectError:
    check("the API", False, f"nothing is listening on {ROOT} - start uvicorn")
except Exception as exc:  # noqa: BLE001
    check("the API", False, f"{type(exc).__name__}: {str(exc)[:70]}")

# ------------------------------------------------------------- the agent
# Built, not called. Composing the tools proves the wiring without spending
# quota or waiting on a free tier.
print("\nthe agent (built, not called)")
try:
    from app.agents import supervisor, support_agent
    from app.agents.llm import resolve
    from app.agents.tools.support_tools import AgentContext

    ctx = AgentContext(business_id=bid, conversation_id="smoke", business=business)
    every = support_agent.compose_tools(
        ctx, ["customer_support", *support_agent.OPTIONAL_CAPABILITIES]
    )
    check("all capabilities compose", len(every) == 15, f"{len(every)} tools")

    prompt = support_agent.build_system_prompt(business, ["customer_support"])
    check("the system prompt builds", "TODAY IS" in prompt, f"{len(prompt)} chars")

    provider, model = resolve("default")
    check("a chat model is configured", bool(model), f"{provider}/{model}")
    provider, model = resolve("router")
    check("a router model is configured", bool(model), f"{provider}/{model}")

    # The narrowing, with no network: the security boundary itself.
    caps, lead = supervisor._clean(
        {"capabilities": ["payment", "admin"], "lead": "admin"}, {"customer_support"}
    )
    check("the supervisor narrows authority", caps == ("customer_support",), caps)
except Exception as exc:  # noqa: BLE001
    check("the agent", False, f"{type(exc).__name__}: {str(exc)[:70]}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
