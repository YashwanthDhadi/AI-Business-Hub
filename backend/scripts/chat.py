"""
Interactive terminal chat with the Customer Support Agent.

Talks to the SAME database, the SAME tools and the SAME prompt that the web
chat will use — only the transport differs. Run from backend/:

    python scripts\\chat.py
    python scripts\\chat.py some-other-chat-slug
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents import support_agent
from app.config import settings
from app.repositories import businesses, conversations

from app.config import settings
from app.services.rate_limit import SlidingWindowLimiter

SLUG = sys.argv[1] if len(sys.argv) > 1 else settings.demo_chat_slug


def main() -> None:
    business = businesses.get_business_by_chat_slug(SLUG)
    if business is None:
        print(f"No active business with chat_slug '{SLUG}'.")
        return

    if not businesses.is_agent_active(business["id"], support_agent.AGENT_KEY):
        print("The customer support agent is not activated for this business.")
        return

    thread = conversations.create(business["id"])

    print(f"\n  {business['name']} — Customer Support Agent")
    print(f"  chat slug    : {business['chat_slug']}")
    print(f"  conversation : {thread['id']}")
    print(f"  model        : {settings.llm_model}")
    print("  commands     : /quit   /history\n")
    print(f"agent> {business['chat_greeting']}\n")

    while True:
        try:
            text = input("you  > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return

        if not text:
            continue
        if text == "/quit":
            return
        if text == "/history":
            for row in conversations.history(thread["id"], limit=10):
                print(f"   {row['author']:9} {row['body'][:90]}")
            print()
            continue

        conversations.add_message(
            business_id=business["id"], conversation_id=thread["id"],
            direction="inbound", author="customer", body=text,
        )

        reply = support_agent.run(
            business=business,
            conversation_id=thread["id"],
            message=text,
        )

        conversations.add_message(
            business_id=business["id"], conversation_id=thread["id"],
            direction="outbound", author="agent", body=reply.text,
            meta={"tool_calls": reply.tool_calls, "latency_ms": reply.latency_ms},
        )

        print(f"\nagent> {reply.text}")
        # What the supervisor decided, so the narrowing is visible as you type.
        # `source` matters as much as the capabilities: "fallback" means the
        # router failed and every enabled capability was used.
        if reply.routing:
            chosen = ", ".join(reply.routing.get("capabilities") or [])
            print(f"       [route] {chosen}"
                  f"  lead={reply.routing.get('lead')}"
                  f"  via={reply.routing.get('source')}"
                  f"  {reply.routing.get('latency_ms')}ms")
        for call in reply.tool_calls:
            print(f"       [tool] {call['tool']}({call['args']})")
        print(f"       [{reply.latency_ms}ms, {reply.steps} step(s)]\n")

        if reply.escalated:
            print("       *** escalated — the agent will now stay quiet ***\n")
        if reply.captured_contact:
            print("       *** contact details captured ***\n")


if __name__ == "__main__":
    main()