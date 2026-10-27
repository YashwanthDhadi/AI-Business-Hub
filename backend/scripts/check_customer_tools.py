"""
STEP 37: the customers capability, proven without the LLM.

  1. Switching the `customers` subscription off and on changes exactly the
     tools and prompt a real chat would get (via compose_tools, the function
     run() itself uses).
  2. The two tools do what they say - and no tool can read a customer back.

Run from backend/:  python scripts\\check_customer_tools.py
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
from app.repositories import businesses, conversations
from app.repositories import customer_notes as notes_repo
from app.repositories import customers as customer_repo

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]
PHONE = "9000000202"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<50} {detail}")


def set_customers(active: bool) -> None:
    db.table("agent_subscriptions").update({"is_active": active}).eq("business_id", bid).eq(
        "agent_key", "customers"
    ).execute()


def inspect() -> tuple[list[str], list[str], str]:
    capabilities = active_capabilities(bid)
    ctx = AgentContext(business_id=bid, conversation_id="dry-run", business=business)
    names = [t.name for t in compose_tools(ctx, capabilities)]
    return capabilities, names, build_system_prompt(business, capabilities)


# ---- 1. the switch -----------------------------------------------------------
print("\ncapability switch")
try:
    set_customers(False)
    off_caps, off_tools, off_prompt = inspect()
    set_customers(True)
    on_caps, on_tools, on_prompt = inspect()
finally:
    set_customers(True)  # leave the demo business switched on, whatever happens

mine = {"remember_about_customer", "set_marketing_preference"}
check("off: no customers capability", "customers" not in off_caps, off_caps)
check("off: no customer tools", not mine & set(off_tools), f"{len(off_tools)} tools")
check("off: no customer rules in the prompt", "CUSTOMER RECORDS" not in off_prompt)
check("on: customers capability", "customers" in on_caps, on_caps)
check("on: both customer tools", mine <= set(on_tools), f"{len(on_tools)} tools")
check("on: customer rules in the prompt", "CUSTOMER RECORDS" in on_prompt)
check("on: booking still there", "request_booking" in on_tools)
readers = [n for n in on_tools if n.startswith(("get_customer", "lookup", "read_", "find_customer"))]
check("no tool can read a customer back", not readers, readers or "none")

# ---- 2. the tools ------------------------------------------------------------
print("\ntools")
first_chat = conversations.create(bid, channel="web")
ctx = AgentContext(business_id=bid, conversation_id=first_chat["id"], business=business)
tools = {t.name: t for t in compose_tools(ctx, ["customer_support", "customers"])}
remember = tools["remember_about_customer"]
marketing = tools["set_marketing_preference"]

anonymous = remember.invoke({"note": "Prefers morning sessions"})
check("unknown visitor -> not saved", anonymous.get("saved") is False)
check("  ...and told not to ask for a number", "Do NOT ask" in anonymous.get("instruction", ""))

saved = remember.invoke(
    {"note": "Prefers morning sessions", "name": "Tool Check", "phone": PHONE}
)
customer = customer_repo.get_by_phone(bid, PHONE)
check("with a phone -> saved", saved.get("saved") is True)
check("  ...a lead was created from chat", bool(customer) and customer["source"] == "chat")
check(
    "  ...and the conversation is linked",
    conversations.get(bid, first_chat["id"]).get("customer_id") == customer["id"],
)

again = remember.invoke({"note": "prefers MORNING sessions "})
check("same note again -> already known", again.get("already_known") is True)

interest = remember.invoke({"note": "Interested in the yoga trial", "kind": "interest"})
check("an interest -> saved (linked, no phone needed)", interest.get("saved") is True)

stop = marketing.invoke({"wants_offers": False})
check("'stop sending offers' -> opted out", stop.get("opted_out") is True)
check(
    "  ...recorded as from chat",
    customer_repo.get(bid, customer["id"])["consent_source"] == "chat",
)

start = marketing.invoke({"wants_offers": True})
after = customer_repo.get(bid, customer["id"])
check("'send me offers' -> NOT opted in", start.get("opted_in") is False)
check("  ...consent unchanged", after["marketing_consent"] == "opted_out", after["marketing_consent"])

notes = notes_repo.list_for_customer(bid, customer["id"])
check("notes on the customer", len(notes) == 3, [n["body"][:28] for n in notes])

# A second visitor claims the same number with a different name.
second_chat = conversations.create(bid, channel="web")
ctx2 = AgentContext(business_id=bid, conversation_id=second_chat["id"], business=business)
tools2 = {t.name: t for t in compose_tools(ctx2, ["customer_support", "customers"])}
tools2["remember_about_customer"].invoke(
    {"note": "Wants evening classes", "name": "Someone Else", "phone": PHONE}
)
check("second chat, same phone -> name NOT overwritten", customer_repo.get(bid, customer["id"])["name"] == "Tool Check")

# ---- clean up -------------------------------------------------------------------
db.table("customers").delete().eq("business_id", bid).eq("id", customer["id"]).execute()
for chat in (first_chat, second_chat):
    db.table("conversations").delete().eq("business_id", bid).eq("id", chat["id"]).execute()
print("\ncleaned up")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
