"""
A performance BASELINE, not a load test.

Each endpoint is called a handful of times and the median and slowest run are
reported. The point is to notice a change - an endpoint that was 80ms and is
now 900ms has usually gained an N+1 query - not to find a breaking point.

This deliberately does NOT hammer the server. Supabase's free tier is a shared
resource and the project runs on it; generating load would be both useless
(the numbers would measure the free tier, not our code) and rude.

Budgets are generous on purpose. They exist to catch an order-of-magnitude
regression, not to police milliseconds over a home internet connection to a
database in another region.

Needs the server running.  Run from backend/:
    python scripts\\check_performance.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import statistics
import time

import httpx

from app.config import settings
from app.repositories import businesses

ROOT = "http://127.0.0.1:8000"
API = f"{ROOT}/api/v1/dashboard"
RUNS = 5

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<44} {detail}")


business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]
client = httpx.Client(timeout=30, headers={"X-Dashboard-Key": settings.dashboard_api_key},
                      params={"business_id": bid})

# (label, how to call it, budget in milliseconds for the MEDIAN)
CASES = [
    ("GET /health", lambda: httpx.get(f"{ROOT}/health", timeout=30), 500),
    ("GET /stats", lambda: client.get(f"{API}/stats"), 3000),
    ("GET /customers", lambda: client.get(f"{API}/customers"), 3000),
    ("GET /bookings", lambda: client.get(f"{API}/bookings"), 3000),
    ("GET /inventory", lambda: client.get(f"{API}/inventory"), 3000),
    ("GET /documents", lambda: client.get(f"{API}/documents"), 3000),
    ("GET /payments/invoices", lambda: client.get(f"{API}/payments/invoices"), 3000),
    ("GET /conversations", lambda: client.get(f"{API}/conversations"), 3000),
    ("GET /reports?days=30", lambda: client.get(f"{API}/reports", params={"business_id": bid, "days": 30}), 4000),
]

print(f"\n{RUNS} runs each, against {ROOT}")
print(f"  {'endpoint':<24}{'median':>9}{'slowest':>10}{'budget':>9}")
print("  " + "-" * 52)

try:
    rows = []
    for label, call, budget in CASES:
        timings = []
        status = 0
        for _ in range(RUNS):
            started = time.perf_counter()
            response = call()
            timings.append((time.perf_counter() - started) * 1000)
            status = response.status_code
        median = statistics.median(timings)
        slowest = max(timings)
        rows.append((label, median, slowest, budget, status))
        print(f"  {label:<24}{median:>8.0f}ms{slowest:>9.0f}ms{budget:>8}ms")

    print()
    for label, median, slowest, budget, status in rows:
        check(f"{label} answered 200", status == 200, status)
    for label, median, slowest, budget, status in rows:
        check(f"{label} within budget", median <= budget, f"{median:.0f}ms of {budget}ms")

    # The one that matters most: a list endpoint whose time grows with row
    # count is an N+1. Compared against /health, which touches no table.
    health = next(r for r in rows if "health" in r[0])
    worst = max((r for r in rows if "health" not in r[0]), key=lambda r: r[1])
    print(f"\n  slowest data endpoint: {worst[0]} at {worst[1]:.0f}ms "
          f"({worst[1] / max(health[1], 1):.0f}x /health)")

finally:
    client.close()

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
