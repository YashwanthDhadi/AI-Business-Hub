"""
Unit tests for how the agent is assembled: which tools it gets, which rules
go in its prompt, and which model answers.

No database and no model - building a tool does not query anything.
"""

from __future__ import annotations

import pytest

from app.agents import support_agent
from app.agents.llm import resolve
from app.agents.tools.support_tools import AgentContext

pytestmark = pytest.mark.unit


@pytest.fixture
def ctx(business):
    return AgentContext(business_id=business["id"], conversation_id="dry-run", business=business)


def names(tools):
    return {t.name for t in tools}


# ------------------------------------------------------------ compose_tools


def test_support_alone_gets_only_support_tools(ctx):
    tools = names(support_agent.compose_tools(ctx, ["customer_support"]))
    assert tools == {
        "search_knowledge", "get_business_info", "list_services",
        "save_contact_details", "escalate_to_human",
    }


@pytest.mark.parametrize(
    "capability, expected",
    [
        ("booking", {"check_availability", "request_booking", "get_my_bookings", "cancel_booking"}),
        ("customers", {"remember_about_customer", "set_marketing_preference"}),
        ("payment", {"get_invoice", "report_payment"}),
        ("inventory", {"check_stock"}),
        ("documents", {"look_up_document"}),
    ],
)
def test_each_capability_adds_exactly_its_own_tools(ctx, capability, expected):
    base = names(support_agent.compose_tools(ctx, ["customer_support"]))
    with_it = names(support_agent.compose_tools(ctx, ["customer_support", capability]))
    assert with_it - base == expected


def test_capabilities_stack(ctx):
    """
    Everything switched on: 5 support + 4 booking + 2 customers + 2 payment
    + 1 inventory + 1 documents. Spelled out rather than given as a number,
    so a change to any capability says which one moved.
    """
    every = names(support_agent.compose_tools(ctx, ["customer_support", *support_agent.OPTIONAL_CAPABILITIES]))
    per_capability = {
        capability: len(names(support_agent.compose_tools(ctx, ["customer_support", capability])))
        - len(names(support_agent.compose_tools(ctx, ["customer_support"])))
        for capability in support_agent.OPTIONAL_CAPABILITIES
    }
    assert per_capability == {"booking": 4, "customers": 2, "payment": 2, "inventory": 1, "documents": 1}
    assert len(every) == 5 + sum(per_capability.values()) == 15
    # No capability quietly overwrote another's tool by reusing a name.
    assert "check_availability" in every and "check_stock" in every


def test_an_unknown_capability_adds_nothing(ctx):
    base = names(support_agent.compose_tools(ctx, ["customer_support"]))
    assert names(support_agent.compose_tools(ctx, ["customer_support", "admin"])) == base


def test_no_tool_can_move_money_or_stock_by_itself(ctx):
    """
    The owner gate, stated as a test. Money and stock change only through
    dashboard routes, so no CHAT tool may be named for those actions.
    """
    every = names(support_agent.compose_tools(ctx, ["customer_support", *support_agent.OPTIONAL_CAPABILITIES]))
    forbidden = {"mark", "paid", "pay", "refund", "issue", "discount", "waive",
                 "charge", "adjust", "restock", "delete", "approve", "send"}
    for tool in every:
        assert not (forbidden & set(tool.split("_"))), f"{tool} sounds like it can act"


def test_communication_and_reports_are_never_available_to_a_chat():
    """
    A customer must not be able to message everyone else, or ask what the
    business earned. Keeping them out of OPTIONAL_CAPABILITIES means the
    supervisor cannot route to them either - it only chooses from this list.
    """
    assert "communication" not in support_agent.OPTIONAL_CAPABILITIES
    assert "reports" not in support_agent.OPTIONAL_CAPABILITIES


# ------------------------------------------------------ build_system_prompt


def test_a_routed_capability_gets_its_rules(business):
    prompt = support_agent.build_system_prompt(business, ["customer_support", "booking"])
    assert "BOOKINGS - you can take these" in prompt


def test_a_capability_the_business_lacks_gets_a_denial(business):
    prompt = support_agent.build_system_prompt(business, ["customer_support"], enabled=["customer_support"])
    assert "BOOKINGS - you cannot take these" in prompt


def test_enabled_but_not_routed_says_NEITHER(business):
    """
    The bug this prevents: a gym that takes bookings telling a customer it
    takes no bookings, just because the router sent that message to payments.
    Saying nothing is better than saying something false.
    """
    prompt = support_agent.build_system_prompt(
        business, ["customer_support", "payment"],
        enabled=["customer_support", "booking", "payment"],
    )
    assert "BOOKINGS - you can take these" not in prompt
    assert "BOOKINGS - you cannot take these" not in prompt


def test_one_argument_means_routed_and_enabled_are_the_same(business):
    """Backwards compatible: scripts that pass one list still behave."""
    one = support_agent.build_system_prompt(business, ["customer_support"])
    two = support_agent.build_system_prompt(business, ["customer_support"], enabled=["customer_support"])
    assert one == two


def test_the_prompt_always_states_today(business):
    """Without this the agent books dates in the past."""
    assert "TODAY IS" in support_agent.build_system_prompt(business, ["customer_support"])


def test_the_business_details_reach_the_prompt(business):
    prompt = support_agent.build_system_prompt(business, ["customer_support"])
    assert business["name"] in prompt
    assert business["agent_persona"] in prompt


def test_a_business_with_nothing_filled_in_does_not_crash():
    """Real rows have empty strings and missing keys."""
    prompt = support_agent.build_system_prompt({}, ["customer_support"])
    assert "this business" in prompt


def test_a_broken_timezone_falls_back_instead_of_crashing():
    prompt = support_agent.build_system_prompt({"timezone": "Mars/Olympus"}, ["customer_support"])
    assert "TODAY IS" in prompt


# --------------------------------------------------- _already_in_history


def test_the_newest_stored_message_is_not_sent_twice():
    history = [
        {"author": "customer", "body": "hello"},
        {"author": "agent", "body": "Hi! How can I help?"},
        {"author": "customer", "body": "what are your hours?"},
    ]
    assert support_agent._already_in_history(history, "what are your hours?") is True


def test_a_new_message_is_appended():
    history = [{"author": "customer", "body": "hello"}]
    assert support_agent._already_in_history(history, "something else") is False


def test_an_agent_reply_last_means_the_message_is_new():
    history = [{"author": "customer", "body": "hi"}, {"author": "agent", "body": "hi"}]
    assert support_agent._already_in_history(history, "hi") is False


def test_empty_history():
    assert support_agent._already_in_history([], "hello") is False


def test_blank_rows_are_skipped_when_looking_for_the_newest():
    history = [{"author": "customer", "body": "hours?"}, {"author": "system", "body": "   "}]
    assert support_agent._already_in_history(history, "hours?") is True


def test_whitespace_does_not_hide_a_duplicate():
    history = [{"author": "customer", "body": "  hours?  "}]
    assert support_agent._already_in_history(history, "hours?") is True


# --------------------------------------------------------- model resolution


def test_the_router_has_its_own_model():
    provider, model = resolve("router")
    assert provider == "google"
    assert model.startswith("gemini")


@pytest.mark.parametrize("purpose", ["booking", "payment", "customers", "inventory", "default"])
def test_every_capability_uses_the_default_model_unless_configured(purpose):
    """No capability is silently on a different model."""
    assert resolve(purpose) == resolve("default")


def test_an_unknown_purpose_falls_back_to_the_default():
    assert resolve("something_new") == resolve("default")
