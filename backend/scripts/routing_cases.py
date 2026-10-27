"""
Labelled messages for testing the supervisor's routing. Shared, so STEP 51
(picking a model) and STEP 55 (testing the finished supervisor) measure the
same thing.

`expect` is the set of capabilities that SHOULD be switched on for that
message. `lead` is the one that should answer. A case with lead=None is one
where any sensible answer is fine, and what we really test is that it does
not crash or invent a capability.

Only these four capabilities exist today:

    customer_support   answering questions, escalating to a human
    booking            appointments
    customers          who the customer is, preferences, marketing consent
    payment            invoices and payments

inventory, communication, documents and reports are NOT built. Messages about
them are in the set on purpose, marked `future=True`: the right behaviour is to
fall back to customer_support (a human can help), never to invent a capability.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Every capability the CHAT router may return. Anything else is a
# hallucination. communication and reports are missing on purpose: they are
# owner-only and the chat agent is never given them.
KNOWN = ("customer_support", "booking", "customers", "payment", "inventory", "documents")


@dataclass(frozen=True)
class Case:
    message: str
    expect: set[str]
    lead: str | None = None
    # Earlier turns, oldest first, as (who, what). Tests continuation.
    history: tuple[tuple[str, str], ...] = ()
    future: bool = False
    note: str = ""


CASES: list[Case] = [
    # ---------------------------------------------------- one capability
    Case("what time do you open on sunday?", {"customer_support"}, "customer_support"),
    Case("do you have parking?", {"customer_support"}, "customer_support"),
    Case("I want to book a personal training session on friday evening",
         {"booking"}, "booking"),
    Case("can I cancel my appointment?", {"booking"}, "booking"),
    Case("what slots are free tomorrow morning?", {"booking"}, "booking"),
    Case("how much do I owe on invoice INV/2026-27/0007?", {"payment"}, "payment"),
    Case("I've paid, my UPI reference is 412345678901", {"payment"}, "payment"),
    Case("please stop sending me promotional messages", {"customers"}, "customers"),
    Case("just so you know, I can only come in the mornings", {"customers"}, "customers"),

    # ------------------------------------------- more than one capability
    Case("book me friday at 6 pm and send me the invoice",
         {"booking", "payment"}, "booking",
         note="the classic mixed message"),
    Case("how much is personal training, and can I book one on saturday?",
         {"customer_support", "booking"}, None,
         note="a price question plus a booking"),
    Case("cancel my saturday session and refund me",
         {"booking", "payment"}, None),

    # ------------------------------------------------------ continuation
    Case("6 pm works", {"booking"}, "booking",
         history=(("customer", "can I book personal training on monday?"),
                  ("agent", "I have 5:30 PM, 6 PM or 6:30 PM free on Monday. Which suits you?")),
         note="means nothing on its own - only the previous turn explains it"),
    Case("yes please", {"payment"}, "payment",
         history=(("customer", "how much do I owe?"),
                  ("agent", "Invoice INV/2026-27/0007 is 9,000 rupees. Shall I send the payment link?")),
         note="continuation, different capability"),
    Case("and when is his next appointment?", {"booking"}, "booking",
         history=(("customer", "show me ravi's payment"),
                  ("agent", "Ravi's invoice INV/2026-27/0003 is unpaid.")),
         note="the subject carries over but the capability changes"),

    # ---------------------------------------- escalation and the unknown
    Case("this is the third time I've been charged twice, I want a refund now",
         {"customer_support", "payment"}, None,
         note="a money dispute: a human must get involved"),
    Case("hi", {"customer_support"}, "customer_support", note="no signal at all"),
    Case("asdfgh", {"customer_support"}, "customer_support", note="nonsense"),

    # ------------------------------------------------- stock and documents
    Case("do you have protein bars in stock?", {"inventory"}, "inventory"),
    Case("how much is a yoga mat?", {"inventory"}, "inventory",
         note="a price question about a PRODUCT, not a service"),
    Case("what does your cancellation policy actually say?", {"documents"}, "documents"),

    # ------------------------- capabilities the CHAT deliberately cannot reach
    # communication and reports are owner-only: a customer must not be able to
    # message everyone else, or ask what the business earned. They are not in
    # OPTIONAL_CAPABILITIES, so the router can never choose them.
    Case("send a reminder to everyone who hasn't paid", {"customer_support", "payment"}, None,
         future=True, note="communication is owner-only"),
    Case("how much money did you make this month?", {"customer_support"}, "customer_support",
         future=True, note="reports is owner-only - a customer must never get this"),
]


def describe() -> str:
    live = [c for c in CASES if not c.future]
    future = [c for c in CASES if c.future]
    multi = [c for c in CASES if len(c.expect) > 1]
    continuation = [c for c in CASES if c.history]
    return (
        f"{len(CASES)} cases: {len(live)} on built capabilities, {len(future)} on "
        f"capabilities that do not exist yet, {len(multi)} needing more than one, "
        f"{len(continuation)} that only make sense with the previous turn"
    )
