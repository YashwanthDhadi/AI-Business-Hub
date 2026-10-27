"""
STEP 33: prove booking is genuinely switchable per business.

Flips the `booking` subscription off, rebuilds the agent, flips it back on and
rebuilds again — checking the tools and the prompt each time. Run from backend/.
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.support_agent import active_capabilities, build_system_prompt, compose_tools
from app.agents.tools.support_tools import AgentContext
from app.config import settings
from app.db import db
from app.repositories import businesses

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]


def set_booking(active: bool) -> None:
    db.table("agent_subscriptions").update({"is_active": active}).eq("business_id", bid).eq(
        "agent_key", "booking"
    ).execute()


def inspect(label: str) -> dict:
    """Build exactly what run() would build, without calling the model."""
    capabilities = active_capabilities(bid)
    ctx = AgentContext(business_id=bid, conversation_id="dry-run", business=business)

    # The same function run() uses, so this sees exactly what a real chat gets.
    tools = compose_tools(ctx, capabilities)

    prompt = build_system_prompt(business, capabilities)

    print(f"\n{label}")
    print(f"  capabilities : {capabilities}")
    print(f"  tools ({len(tools)})   : {', '.join(t.name for t in tools)}")
    print(f"  prompt says  : {'CAN book' if 'you can take these' in prompt else 'CANNOT book'}")
    return {"capabilities": capabilities, "tools": [t.name for t in tools], "prompt": prompt}


try:
    set_booking(False)
    off = inspect("booking OFF")

    set_booking(True)
    on = inspect("booking ON")
finally:
    # Leave the demo business switched on however this script exits.
    set_booking(True)

booking_names = {"check_availability", "request_booking", "get_my_bookings", "cancel_booking"}
checks = [
    ("off: no booking capability", "booking" not in off["capabilities"]),
    ("off: no booking tools", not booking_names & set(off["tools"])),
    ("off: prompt refuses booking", "you cannot take these" in off["prompt"]),
    ("off: still has support tools", "search_knowledge" in off["tools"]),
    ("on: booking capability", "booking" in on["capabilities"]),
    ("on: all four booking tools", booking_names <= set(on["tools"])),
    ("on: prompt allows booking", "you can take these" in on["prompt"]),
    ("on: prompt has today's date", "TODAY IS" in on["prompt"]),
]

print()
for name, passed in checks:
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")

print(f"\nbooking is left ON for {business['name']}")

failures = sum(1 for _, passed in checks if not passed)
print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
