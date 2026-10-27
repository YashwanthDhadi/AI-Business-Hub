"""Run each tool by hand, with no LLM involved. Run from backend/."""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json

from app.agents.tools.support_tools import AgentContext, build_tools
from app.config import settings
from app.repositories import businesses, conversations

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
thread = conversations.create(business["id"])

ctx = AgentContext(
    business_id=business["id"],
    conversation_id=thread["id"],
    business=business,
)

tools = {t.name: t for t in build_tools(ctx)}
print("tools:", list(tools), "\n")


def show(tool_name: str, /, **kwargs) -> None:
    """
    Run one tool and pretty-print the result.

    The `/` makes tool_name POSITIONAL-ONLY. Without it, a tool argument that
    happens to share the parameter's name collides with it — save_contact_details
    takes a `name`, so show("save_contact_details", name="Akshaya") tried to bind
    two values to the same parameter.
    """
    print(f"--- {tool_name}({kwargs}) ---")
    print(json.dumps(tools[tool_name].invoke(kwargs), indent=2, default=str))
    print()


show("get_business_info")
show("list_services")
show("search_knowledge", query="freeze pause membership")
show("search_knowledge", query="do you sell protein shakes")
show("save_contact_details", name="Akshaya", phone="9876543210",
     reason="Wants a call about corporate membership")
show("save_contact_details", name="Nobody", reason="No contact details given")
show("escalate_to_human", reason="Customer asking for a refund",
     summary="Joined 2 days ago, used the gym once, wants their money back.")
