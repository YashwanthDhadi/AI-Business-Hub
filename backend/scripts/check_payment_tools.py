"""
STEP 45: the payment capability, proven without the LLM.

  1. Switching the `payment` subscription changes exactly the tools and prompt
     a real chat gets (through compose_tools, the function run() uses), and no
     tool can create an invoice, mark one paid or refund.
  2. The UPI link is the standard NPCI format, and never invented.
  3. get_invoice needs the number AND the phone, and fails identically for both.
  4. report_payment records a claim and leaves the invoice pending.

Invoices are issued in throwaway sandbox businesses, never in Pulse Fitness.
Run from backend/:  python scripts\\check_payment_tools.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import timedelta
from urllib.parse import quote

from app.agents.support_agent import active_capabilities, build_system_prompt, compose_tools
from app.agents.tools.support_tools import AgentContext
from app.config import settings
from app.db import db, one
from app.repositories import businesses, conversations
from app.repositories import customers as customer_repo
from app.repositories import invoices as invoice_repo
from app.services import payments as payments_service
from sandbox import create_sandbox, destroy_sandbox

demo = businesses.get_business_by_chat_slug(settings.demo_chat_slug)
PHONE = "9000000601"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<52} {detail}")


def set_payment(active: bool) -> None:
    db.table("agent_subscriptions").update({"is_active": active}).eq("business_id", demo["id"]).eq(
        "agent_key", "payment"
    ).execute()


def inspect() -> tuple[list[str], str]:
    capabilities = active_capabilities(demo["id"])
    ctx = AgentContext(business_id=demo["id"], conversation_id="dry-run", business=demo)
    return [t.name for t in compose_tools(ctx, capabilities)], build_system_prompt(demo, capabilities)


# ---- 1. the switch -------------------------------------------------------------
print("\ncapability switch")
try:
    set_payment(False)
    off_tools, off_prompt = inspect()
    set_payment(True)
    on_tools, on_prompt = inspect()
finally:
    set_payment(True)  # leave the demo business switched on, whatever happens

mine = {"get_invoice", "report_payment"}
check("off: no payment tools", not mine & set(off_tools), f"{len(off_tools)} tools")
check("off: prompt says the team handles payments", "PAYMENTS - you cannot handle these" in off_prompt)
check("on: both payment tools", mine <= set(on_tools), f"{len(on_tools)} tools")
check("on: payment rules in the prompt", "PAYMENTS - you can look up an invoice" in on_prompt)
# Whole words of the tool name: "mark_paid" is dangerous, "set_marketing_preference" is not.
MONEY_WORDS = {"mark", "paid", "pay", "refund", "issue", "discount", "waive", "charge"}
dangerous = [n for n in on_tools if MONEY_WORDS & set(n.split("_")) or n == "create_invoice"]
check("no tool can create, mark paid or refund", not dangerous, dangerous or "none")

sandbox = create_sandbox("payment-tools")
no_upi = create_sandbox("payment-tools-noupi", upi_id=None)
try:
    bid = sandbox["id"]
    today = payments_service.business_today(sandbox)
    customer = customer_repo.upsert_from_chat(business_id=bid, name="Tool Check", phone=PHONE)
    invoice = invoice_repo.create(
        business_id=bid,
        customer_id=customer["id"],
        items=[{"description": "Personal Training", "quantity": 1, "unit_price": 9000}],
        due_date=today + timedelta(days=7),
    )

    # ---- 2. the UPI link ---------------------------------------------------------
    print("\nUPI link")
    link = payments_service.upi_link(invoice, payments_service.payment_settings(bid), sandbox)
    expected = (
        f"upi://pay?pa=sandbox%40okaxis&pn={quote(sandbox['name'], safe='')}&am=9000.00&cu=INR"
        f"&tn={quote('Invoice ' + invoice['invoice_number'], safe='')}"
    )
    check("standard upi://pay link, everything encoded", link == expected, link)

    other_customer = customer_repo.upsert_from_chat(business_id=no_upi["id"], name="No Upi", phone=PHONE)
    unlinked = invoice_repo.create(
        business_id=no_upi["id"],
        customer_id=other_customer["id"],
        items=[{"description": "Personal Training", "quantity": 1, "unit_price": 9000}],
        due_date=today + timedelta(days=7),
    )
    check(
        "no UPI ID set -> no link, never an invented one",
        payments_service.upi_link(unlinked, payments_service.payment_settings(no_upi["id"]), no_upi) is None,
    )

    # ---- 3. get_invoice ----------------------------------------------------------
    print("\nget_invoice")
    chat = conversations.create(bid, channel="web")
    ctx = AgentContext(business_id=bid, conversation_id=chat["id"], business=sandbox)
    tools = {t.name: t for t in compose_tools(ctx, ["customer_support", "payment"])}
    lookup = tools["get_invoice"]
    report = tools["report_payment"]

    good = lookup.invoke({"invoice_number": invoice["invoice_number"], "customer_phone": "90000 00601"})
    check("right number + right phone -> found", good.get("found") is True, f"{good.get('amount')} due {good.get('due')}")
    check("  ...with the pay-page link", good.get("pay_link") == payments_service.pay_url(invoice))

    wrong_phone = lookup.invoke({"invoice_number": invoice["invoice_number"], "customer_phone": "9999999999"})
    wrong_number = lookup.invoke({"invoice_number": "INV/2026-27/9999", "customer_phone": PHONE})
    check("right number + WRONG phone -> no match", wrong_phone.get("found") is False)
    check("WRONG number + right phone -> no match", wrong_number.get("found") is False)
    check("  ...and the two refusals are identical", wrong_phone == wrong_number)

    # ---- 4. report_payment -------------------------------------------------------
    print("\nreport_payment")
    said = report.invoke(
        {"invoice_number": invoice["invoice_number"], "customer_phone": PHONE, "upi_reference": "412345678901"}
    )
    after = invoice_repo.get(bid, invoice["id"])
    check("customer says paid -> recorded", said.get("recorded") is True)
    check("  ...but the invoice is still pending", after["status"] == "pending", after["status"])
    check("  ...with their reference", after["customer_reference"] == "412345678901", after["customer_reference"])

    invoice_repo.mark_paid(business_id=bid, invoice_id=invoice["id"], method="upi", reference="412345678901")
    again = report.invoke({"invoice_number": invoice["invoice_number"], "customer_phone": PHONE})
    check("after the owner marks it paid -> 'already paid'", again.get("already_paid") is True)
    paid_view = lookup.invoke({"invoice_number": invoice["invoice_number"], "customer_phone": PHONE})
    check("get_invoice on a paid invoice -> no pay link", "pay_link" not in paid_view, paid_view.get("status"))

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(no_upi)
    gone = one(db.table("businesses").select("id").eq("id", sandbox["id"]).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
