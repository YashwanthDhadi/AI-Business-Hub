"""Throwaway sanity check for the repository layer. Run from backend/."""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" — Python puts scripts/ on sys.path, not backend/.
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