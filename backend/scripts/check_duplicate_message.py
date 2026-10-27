"""
STEP 51: does one customer message reach the model twice?

This was a suspicion, not a fact, so this script MEASURES it instead of
assuming. It drives the REAL public-chat path - chat_service.handle_message,
the same function the /api/v1/chat/message route calls - with a fake model
that records exactly what it was sent. No LLM calls, no quota used.

Read it as: "for ONE customer message, how many times does that exact text
appear in what we send the model?" The answer should be 1.

Run from backend/:  python scripts\\check_duplicate_message.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.messages import AIMessage, HumanMessage

from app.agents import support_agent
from app.config import settings
from app.db import db
from app.services import chat as chat_service

QUESTION = "what are your opening hours on sunday"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<52} {detail}")


class RecordingModel:
    """Answers immediately, and keeps every message list it was handed."""

    def __init__(self) -> None:
        self.seen: list[list] = []

    def bind_tools(self, tools):
        return self

    def invoke(self, messages):
        self.seen.append(list(messages))
        return AIMessage(content="We're open 7 AM to 1 PM on Sundays.")


def human_texts(messages: list) -> list[str]:
    """What the model was told the CUSTOMER said, in order."""
    return [str(m.content) for m in messages if isinstance(m, HumanMessage)]


# ---- drive the real path -------------------------------------------------------
session = chat_service.start_session(chat_slug=settings.demo_chat_slug, ip="127.0.0.1")
resolved = chat_service.resolve_session(session["session_token"])
conversation_id = session["conversation_id"]

model = RecordingModel()
original = support_agent.get_model
support_agent.get_model = lambda *a, **k: model
# The supervisor is switched off for this test so nothing here calls a real
# model. What it decides cannot change how many times the message is sent -
# that is the supervisor's own test, scripts/check_router.py.
router_was = settings.router_enabled
settings.router_enabled = False
try:
    chat_service.handle_message(resolved, QUESTION)
finally:
    support_agent.get_model = original
    settings.router_enabled = router_was

# ---- what did the model actually receive? ---------------------------------------
print(f"\none customer message: {QUESTION!r}\n")
check("the model was called once", len(model.seen) == 1, f"{len(model.seen)} call(s)")

sent = model.seen[0] if model.seen else []
asked = human_texts(sent)
copies = asked.count(QUESTION)

for index, text in enumerate(asked, start=1):
    print(f"       customer turn {index}: {text!r}")

check("the message is sent ONCE, not twice", copies == 1, f"{copies} copies")
check("  ...and it is the last thing the model reads", asked[-1:] == [QUESTION] if asked else False)

# ---- and the transcript itself must hold exactly one copy -------------------------
stored = [
    m["body"]
    for m in chat_service.conversation_repo.messages_for(resolved.business["id"], conversation_id)
    if m["author"] == "customer"
]
check("stored in the transcript once", stored.count(QUESTION) == 1, f"{stored.count(QUESTION)} rows")

# ---- clean up --------------------------------------------------------------------
db.table("conversations").delete().eq("business_id", resolved.business["id"]).eq(
    "id", conversation_id
).execute()
print("\ncleaned up")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
