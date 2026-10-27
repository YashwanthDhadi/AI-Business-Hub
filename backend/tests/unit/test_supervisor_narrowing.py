"""
Unit tests for the supervisor's authority logic.

`_clean()` is the single most security-critical pure function in the project:
it decides what the agent is allowed to do with a message. Everything else in
supervisor.py is plumbing around it.

These are pure - no database, no network, no model.
"""

from __future__ import annotations

import pytest

from app.agents import supervisor

pytestmark = pytest.mark.unit

ALL = {"customer_support", "booking", "customers", "payment"}


# --------------------------------------------------------------- _clean()


def test_keeps_a_capability_the_business_has():
    result = supervisor._clean({"capabilities": ["booking"], "lead": "booking"}, ALL)
    assert result == (("booking", "customer_support"), "booking")


def test_drops_a_capability_the_business_has_not_enabled():
    """THE rule: the router narrows authority, it never adds any."""
    caps, lead = supervisor._clean(
        {"capabilities": ["payment", "booking"], "lead": "payment"},
        {"customer_support", "booking"},
    )
    assert "payment" not in caps
    assert lead in caps


def test_drops_an_invented_capability():
    caps, _ = supervisor._clean({"capabilities": ["admin", "booking"], "lead": "admin"}, ALL)
    assert caps == ("booking", "customer_support")


@pytest.mark.parametrize(
    "invented",
    ["admin", "database", "sudo", "root", "billing_override", "*", "ALL"],
)
def test_no_invented_name_survives(invented):
    caps, _ = supervisor._clean({"capabilities": [invented], "lead": invented}, ALL)
    assert caps == ("customer_support",)


def test_customer_support_is_always_present():
    """However routing goes, the agent must still be able to escalate."""
    caps, _ = supervisor._clean({"capabilities": ["payment"], "lead": "payment"}, ALL)
    assert "customer_support" in caps


def test_lead_outside_its_own_list_is_repaired():
    caps, lead = supervisor._clean({"capabilities": ["booking"], "lead": "payment"}, ALL)
    assert lead in caps


def test_lead_prefers_something_specific_over_support():
    _, lead = supervisor._clean({"capabilities": ["booking"], "lead": "nonsense"}, ALL)
    assert lead == "booking"


@pytest.mark.parametrize(
    "answer",
    [
        {"capabilities": []},
        {"capabilities": "booking"},          # a string, not a list
        {"capabilities": None},
        {"lead": "booking"},                  # no capabilities at all
        {},
    ],
)
def test_unusable_answers_are_rejected(answer):
    """Returning None makes route() fall back, which is the safe direction."""
    assert supervisor._clean(answer, ALL) is None


def test_capability_names_are_case_and_space_insensitive():
    caps, _ = supervisor._clean({"capabilities": ["  BOOKING "], "lead": "BOOKING"}, ALL)
    assert "booking" in caps


def test_result_is_sorted_and_stable():
    """A stable order keeps logs and the inbox chip readable."""
    first, _ = supervisor._clean({"capabilities": ["payment", "booking"], "lead": "booking"}, ALL)
    second, _ = supervisor._clean({"capabilities": ["booking", "payment"], "lead": "booking"}, ALL)
    assert first == second == tuple(sorted(first))


# ---------------------------------------------------------- parse_answer()


@pytest.mark.parametrize(
    "raw",
    [
        '{"capabilities": ["booking"], "lead": "booking"}',
        '```json\n{"capabilities": ["booking"], "lead": "booking"}\n```',
        '```\n{"capabilities": ["booking"], "lead": "booking"}\n```',
        'Sure! {"capabilities": ["booking"], "lead": "booking"} Hope that helps.',
        '  \n {"capabilities": ["booking"], "lead": "booking"}  \n ',
    ],
)
def test_parses_json_however_the_model_wraps_it(raw):
    """Being strict would turn a usable answer into a needless fallback."""
    assert supervisor.parse_answer(raw) == {"capabilities": ["booking"], "lead": "booking"}


@pytest.mark.parametrize("raw", ["", "   ", None, "not json at all", "{broken", "[1, 2, 3]"])
def test_unreadable_answers_return_none(raw):
    assert supervisor.parse_answer(raw) is None


def test_a_json_list_is_not_accepted_as_an_answer():
    """The contract is an object. A list is not one, however valid the JSON."""
    assert supervisor.parse_answer('["booking"]') is None


# --------------------------------------------------------------- redact()


@pytest.mark.parametrize(
    "text, secret",
    [
        ("my number is 9000000303", "9000000303"),
        ("call me on +91 98765 00011", "98765 00011"),
        ("ref 412345678901", "412345678901"),
        ("email ravi.kumar@example.com please", "ravi.kumar@example.com"),
        ("invoice INV/2026-27/0007", "INV/2026-27/0007"),
    ],
)
def test_personal_details_never_leave(text, secret):
    assert secret not in supervisor.redact(text)


@pytest.mark.parametrize(
    "keep",
    [
        "book me on 2026-10-05 at 6 pm",
        "is 6:30 free",
        "I paid 9000 rupees",
        "the 2026-27 season",
        "room 101",
    ],
)
def test_the_words_that_decide_routing_survive(keep):
    """
    Dates, times and small numbers are NOT redacted. Ten digits is the
    threshold: eight would also swallow 2026-09-28, and a booking cannot be
    routed without its date.
    """
    assert supervisor.redact(keep) == keep


def test_redaction_keeps_the_routing_signal():
    redacted = supervisor.redact("I paid invoice INV/2026-27/0007, ref 412345678901")
    assert "paid" in redacted and "invoice" in redacted


@pytest.mark.parametrize("value", ["", None])
def test_redaction_handles_nothing(value):
    assert supervisor.redact(value) == ""


# ------------------------------------------------------------------ Route


def test_route_meta_is_small_and_safe_to_store():
    route = supervisor.Route(
        capabilities=("booking", "customer_support"), lead="booking",
        source="model", latency_ms=120, raw='{"..."}',
        redacted_message="book me friday",
    )
    meta = route.as_meta()
    assert meta == {
        "capabilities": ["booking", "customer_support"],
        "lead": "booking",
        "source": "model",
        "latency_ms": 120,
    }
    # The model's raw reply and the message itself must NOT be stored on the
    # message row, which the owner's inbox reads.
    assert "raw" not in meta and "redacted_message" not in meta


def test_used_model_is_true_only_for_a_real_decision():
    assert supervisor.Route((), "customer_support", "model").used_model is True
    for source in ("fallback", "disabled", "trivial"):
        assert supervisor.Route((), "customer_support", source).used_model is False
