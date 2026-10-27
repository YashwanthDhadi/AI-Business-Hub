"""
STEP 46: a real conversation about an invoice. THIS ONE CALLS THE LLM
(about eight model calls from your 50 a day).

The customer asks what they owe, gets the link, and says they have paid. The
invoice must STILL be pending afterwards - only the owner can mark it paid.

Runs in a sandbox business, so no real invoice number is used. The public chat
API refuses an inactive business, so this calls the same agent loop the chat
API calls, the same way services/chat.py does. Run from backend/:

    python scripts\\check_payment_chat.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import re
from datetime import timedelta

from app.agents import support_agent
from app.db import db, one
from app.repositories import conversations
from app.repositories import customers as customer_repo
from app.repositories import invoices as invoice_repo
from app.services import payments as payments_service
from sandbox import create_sandbox, destroy_sandbox

PHONE = "9000000601"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<48} {detail}")


# Phrases that would mean the agent claimed the money arrived.
CLAIMED_PAID = re.compile(
    r"(you('| a)re (all )?paid|(it|this|that|invoice) (is|has been) (now )?paid|"
    r"marked (it )?(as )?paid|payment (is |has been )?(confirmed|received))",
    re.IGNORECASE,
)

sandbox = create_sandbox("payment-chat")
try:
    bid = sandbox["id"]
    customer = customer_repo.upsert_from_chat(business_id=bid, name="Chat Check", phone=PHONE)
    invoice = invoice_repo.create(
        business_id=bid,
        customer_id=customer["id"],
        items=[{"description": "Personal Training", "quantity": 1, "unit_price": 9000}],
        due_date=payments_service.business_today(sandbox) + timedelta(days=7),
    )
    chat = conversations.create(bid, channel="web")

    script = [
        "hi, I got an invoice from you. how much do I owe?",
        f"it's {invoice['invoice_number']} and my number is {PHONE}",
        "done, I just paid it. the reference is 412345678901",
    ]

    tools_used: list[str] = []
    replies: list[str] = []
    for text in script:
        # Exactly what services/chat.py handle_message does.
        conversations.add_message(
            business_id=bid, conversation_id=chat["id"], direction="inbound", author="customer", body=text
        )
        reply = support_agent.run(business=sandbox, conversation_id=chat["id"], message=text)
        conversations.add_message(
            business_id=bid, conversation_id=chat["id"], direction="outbound", author="agent", body=reply.text
        )

        print(f"\nyou   > {text}")
        print(f"agent > {reply.text}")
        for call in reply.tool_calls:
            print(f"        [tool] {call['tool']}({call['args']})")
        tools_used += [call["tool"] for call in reply.tool_calls]
        replies.append(reply.text)

    after = invoice_repo.get(bid, invoice["id"])
    print()
    check("asked for / used get_invoice", "get_invoice" in tools_used)
    check("the reply contains the real pay link", payments_service.pay_url(invoice) in " ".join(replies))
    check("report_payment was called", "report_payment" in tools_used)
    check("the customer's reference was recorded", after["customer_reference"] == "412345678901",
          after["customer_reference"])
    check("the invoice is STILL pending", after["status"] == "pending", after["status"])
    said_paid = [r for r in replies if CLAIMED_PAID.search(r)]
    check("the agent never said it was paid", not said_paid, said_paid[0][:60] if said_paid else "")

finally:
    destroy_sandbox(sandbox)
    gone = one(db.table("businesses").select("id").eq("id", sandbox["id"]).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
