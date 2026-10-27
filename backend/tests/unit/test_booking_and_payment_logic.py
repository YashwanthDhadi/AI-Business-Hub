"""
Unit tests for the pure logic inside the booking and payment tools: which
slots the model is shown, what a UPI link looks like, and what the public pay
page is allowed to reveal.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.agents.tools.booking_tools import MAX_OFFERED, _minutes, _offer
from app.services import payments as payments_service

pytestmark = pytest.mark.unit


# ------------------------------------------------------------------ _offer


def availability(slots):
    return {"date": "2026-10-05", "day_name": "Monday", "closed": False,
            "free_slots": list(slots), "instruction": "..."}


ELEVEN = ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30",
          "10:00", "10:30", "11:00", "11:30", "12:00"]


def test_the_model_is_never_shown_more_than_three_times():
    """
    The bug this prevents: asked for a Sunday, the agent read out all eleven
    free times. The tool result said "offer at most three" and the model
    ignored it. It cannot read out a list it was never given.
    """
    assert len(_offer(availability(ELEVEN))["free_slots"]) == MAX_OFFERED


def test_it_says_how_many_more_there_are():
    assert _offer(availability(ELEVEN))["more_free_slots"] == len(ELEVEN) - 3


def test_a_short_list_is_passed_through_untouched():
    two = availability(["07:00", "07:30"])
    assert _offer(two) == two
    assert "more_free_slots" not in _offer(two)


def test_a_preferred_time_gets_the_nearest_slots():
    """"Monday evening" should not be answered with three morning times."""
    assert _offer(availability(ELEVEN), "12:00")["free_slots"] == ["11:00", "11:30", "12:00"]


def test_the_nearest_slots_are_returned_in_clock_order():
    """So the agent says "5:30, 6 or 6:30" rather than "6, 5:30, 6:30"."""
    offered = _offer(availability(ELEVEN), "09:30")["free_slots"]
    assert offered == sorted(offered)


@pytest.mark.parametrize("junk", ["evening", "", "later", "6pm", None])
def test_an_unparseable_preferred_time_falls_back_to_the_first_three(junk):
    """The model sometimes sends words. That must not crash a customer's chat."""
    assert _offer(availability(ELEVEN), junk)["free_slots"] == ELEVEN[:3]


def test_a_closed_day_survives():
    closed = {"date": "2026-10-05", "closed": True, "free_slots": [], "instruction": "..."}
    assert _offer(closed) == closed


def test_the_instruction_tells_the_model_other_times_exist():
    """Otherwise it refuses a customer who asks for a time outside the three."""
    assert "call check_availability again" in _offer(availability(ELEVEN))["instruction"]


@pytest.mark.parametrize(
    "clock, expected",
    [("00:00", 0), ("06:30", 390), ("18:00", 1080), ("23:59", 1439), (" 18:00 ", 1080)],
)
def test_clock_to_minutes(clock, expected):
    assert _minutes(clock) == expected


@pytest.mark.parametrize("junk", ["evening", "", "6", "::", None, "aa:bb"])
def test_minutes_refuses_junk(junk):
    assert _minutes(junk) is None


# --------------------------------------------------------------- UPI links


def test_a_upi_link_is_the_standard_npci_format(invoice, payment_settings, business):
    link = payments_service.upi_link(invoice, payment_settings, business)
    assert link.startswith("upi://pay?")
    for part in ["pa=pulsefitness%40okaxis", "am=9000.00", "cu=INR"]:
        assert part in link


def test_the_invoice_number_is_url_encoded(invoice, payment_settings, business):
    """An unencoded "/" breaks the link in some UPI apps."""
    link = payments_service.upi_link(invoice, payment_settings, business)
    assert "INV%2F2026-27%2F0007" in link
    assert "INV/2026-27/0007" not in link


def test_the_amount_always_has_two_decimal_places(invoice, payment_settings, business):
    invoice["amount"] = 9000
    assert "am=9000.00" in payments_service.upi_link(invoice, payment_settings, business)


def test_no_upi_id_means_no_link_rather_than_an_invented_payee(invoice, business):
    assert payments_service.upi_link(invoice, {"upi_id": None}, business) is None


@pytest.mark.parametrize("status", ["paid", "cancelled", "refunded"])
def test_an_invoice_that_is_not_pending_offers_no_way_to_pay_again(
    invoice, payment_settings, business, status
):
    invoice["status"] = status
    assert payments_service.upi_link(invoice, payment_settings, business) is None


# ------------------------------------------------------- overdue is derived


def test_overdue_is_calculated_not_stored(invoice):
    """
    Nothing writes "overdue" anywhere. It is "pending" plus a due date in the
    past, so at midnight it simply becomes true - no nightly job to forget.
    """
    assert payments_service.display_status(invoice, date(2026, 10, 1)) == "pending"
    assert payments_service.display_status(invoice, date(2026, 10, 3)) == "pending"
    assert payments_service.display_status(invoice, date(2026, 10, 4)) == "overdue"


@pytest.mark.parametrize("status", ["paid", "cancelled", "refunded"])
def test_only_an_unpaid_invoice_can_be_overdue(invoice, status):
    invoice["status"] = status
    assert payments_service.display_status(invoice, date(2030, 1, 1)) == status


# ---------------------------------------------- what the pay page may show


def test_the_public_pay_page_reveals_nothing_personal(invoice, payment_settings, business):
    """
    Anyone with the link can open this page, and links get forwarded. It shows
    what a paper bill would show, and no more.
    """
    view = payments_service.public_view(invoice, business, payment_settings, date(2026, 10, 1))
    leaked = {"customerPhone", "customerEmail", "customerId", "businessId", "id", "conversationId"}
    assert not (leaked & set(view))

    text = str(view)
    assert invoice["customers"]["phone"] not in text
    assert invoice["customers"]["email"] not in text
    assert invoice["customer_id"] not in text


def test_the_pay_page_shows_only_a_first_name(invoice, payment_settings, business):
    view = payments_service.public_view(invoice, business, payment_settings, date(2026, 10, 1))
    assert view["customerFirstName"] == "Ravi"
    assert "Kumar" not in str(view)


def test_a_customer_with_no_name_does_not_break_the_page(invoice, payment_settings, business):
    invoice["customers"]["name"] = None
    view = payments_service.public_view(invoice, business, payment_settings, date(2026, 10, 1))
    assert view["customerFirstName"] == ""


def test_the_pay_link_points_at_the_public_site(invoice):
    assert payments_service.pay_url(invoice).endswith(f"/pay/{invoice['public_token']}")


# ------------------------------------------------------------ rate limiter


def test_the_rate_limiter_allows_then_blocks():
    from app.services.rate_limit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(limit=3, window_seconds=60, name="test")
    assert all(limiter.hit("someone").allowed for _ in range(3))

    blocked = limiter.hit("someone")
    assert blocked.allowed is False
    assert blocked.retry_after > 0


def test_one_visitor_hitting_the_limit_does_not_block_another():
    from app.services.rate_limit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(limit=2, window_seconds=60, name="test")
    limiter.hit("noisy")
    limiter.hit("noisy")
    assert limiter.hit("noisy").allowed is False
    assert limiter.hit("quiet").allowed is True
