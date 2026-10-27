"""
STEP 38 fix: what the customer hears when the agent runs out of steps.

Found running STEP 38 against the live model: it spent all six steps on tools,
saved the customer's callback on the last one, and then said "Sorry, I'm having
trouble" - telling the customer it failed when it had not.

This drives the REAL run() loop with a fake model, so it needs no LLM calls:

  1. a model that never stops calling tools -> run() asks once more with no
     tools, and that answer is what the customer sees
  2. if that last call fails too -> the old apology, not a crash

Run from backend/:  python scripts\\check_step_limit.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.messages import AIMessage

from app.agents import support_agent
from app.config import settings
from app.db import db
from app.repositories import businesses, conversations

business = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
bid = business["id"]

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<46} {detail}")


class FakeModel:
    """Bound to tools: always asks for one more tool. Unbound: answers, or fails."""

    def __init__(self, wrap_up_fails: bool = False) -> None:
        self.bound = False
        self.wrap_up_fails = wrap_up_fails
        self.calls = 0

    def bind_tools(self, tools):
        bound = FakeModel(self.wrap_up_fails)
        bound.bound = True
        bound.parent = self
        return bound

    def invoke(self, messages):
        owner = getattr(self, "parent", self)
        owner.calls += 1
        if self.bound:
            return AIMessage(
                content="",
                tool_calls=[{"name": "get_business_info", "args": {}, "id": f"call-{owner.calls}"}],
            )
        if self.wrap_up_fails:
            raise RuntimeError("simulated provider outage")
        return AIMessage(content="I've checked our hours for you - we're open until 10 PM today.")


def run_with(fake: FakeModel) -> support_agent.AgentReply:
    chat = conversations.create(bid, channel="web")
    original = support_agent.get_model
    support_agent.get_model = lambda *a, **k: fake
    # The supervisor is off here: this test is about the step limit, and a
    # real routing call would make it non-deterministic and spend quota.
    router_was = settings.router_enabled
    settings.router_enabled = False
    try:
        return support_agent.run(business=business, conversation_id=chat["id"], message="are you open?")
    finally:
        support_agent.get_model = original
        settings.router_enabled = router_was
        db.table("conversations").delete().eq("business_id", bid).eq("id", chat["id"]).execute()


print("\nstep limit")
model = FakeModel()
reply = run_with(model)
check("tools ran until the limit", len(reply.tool_calls) == settings.agent_max_steps,
      f"{len(reply.tool_calls)} tool calls, limit {settings.agent_max_steps}")
check("exactly one extra model call, with no tools", model.calls == settings.agent_max_steps + 1,
      f"{model.calls} model calls")
check("the customer gets the wrap-up answer", reply.text.startswith("I've checked our hours"), repr(reply.text[:50]))
check("  ...not the apology", reply.text != support_agent.GIVE_UP)

failing = run_with(FakeModel(wrap_up_fails=True))
check("wrap-up fails too -> the apology", failing.text == support_agent.GIVE_UP, repr(failing.text[:50]))
check("  ...and no crash", failing.error is None)

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
