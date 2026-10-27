"""
Unit tests for the functions that turn data into text a person reads, and
text a person typed into data.

These are where quiet, embarrassing bugs live: a price in the wrong currency,
a date a day out, the same customer stored twice because they typed their
number differently.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services.formatting import rupees, spoken_date

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------- rupees()


@pytest.mark.parametrize(
    "amount, expected",
    [
        (0, "₹0"),
        (9, "₹9"),
        (99, "₹99"),
        (999, "₹999"),
        (1000, "₹1,000"),
        (9000, "₹9,000"),
        (99999, "₹99,999"),
        # Indian grouping starts here: last three digits, then PAIRS.
        (100000, "₹1,00,000"),
        (120000, "₹1,20,000"),
        (1234567, "₹12,34,567"),
        (12345678, "₹1,23,45,678"),
    ],
)
def test_indian_digit_grouping(amount, expected):
    """1,20,000 - not 120,000. Python's own "{:,}" gets this wrong."""
    assert rupees(amount) == expected


@pytest.mark.parametrize(
    "amount, expected",
    [
        (9000.5, "₹9,000.50"),
        (9000.05, "₹9,000.05"),
        (0.5, "₹0.50"),
        # Whole rupees show no paise at all - "₹9,000.00" is just noise.
        (9000.0, "₹9,000"),
    ],
)
def test_paise_only_when_there_are_any(amount, expected):
    assert rupees(amount) == expected


def test_negative_amounts_keep_the_sign_outside():
    assert rupees(-1500) == "-₹1,500"


def test_accepts_a_string_amount():
    """Postgres numerics arrive as strings through PostgREST."""
    assert rupees("9000") == "₹9,000"


def test_rounds_to_paise():
    assert rupees(9000.567) == "₹9,000.57"


# ----------------------------------------------------------- spoken_date()


@pytest.mark.parametrize(
    "value, expected",
    [
        ("2026-10-03", "Sat, 3 Oct 2026"),
        ("2026-01-01", "Thu, 1 Jan 2026"),
        ("2026-12-25", "Fri, 25 Dec 2026"),
        (date(2026, 10, 17), "Sat, 17 Oct 2026"),
    ],
)
def test_day_before_month_with_no_leading_zero(value, expected):
    """
    Indian order, and no "03". Built by hand because %-d is a GNU extension
    that raises ValueError on Windows.
    """
    assert spoken_date(value) == expected


def test_a_timestamp_is_cut_to_its_date():
    assert spoken_date("2026-10-03T18:30:00+05:30") == "Sat, 3 Oct 2026"


@pytest.mark.parametrize("junk", ["not a date", "", "2026-13-45"])
def test_unparseable_input_is_returned_unchanged(junk):
    """A report must not crash because one date is malformed."""
    assert spoken_date(junk) == junk


# --------------------------------------------------- phone and email


@pytest.mark.parametrize(
    "typed",
    [
        "9876543210",           # as printed on a card
        "98765 43210",          # with a space
        "+919876543210",        # with a country code
        "+91 98765 43210",
        "+91-98765-43210",
        "  9876543210  ",       # pasted with whitespace
        "09876543210",          # trunk prefix, as when dialling
        "0919876543210",        # trunk prefix AND country code
        "00919876543210",       # international prefix
    ],
)
def test_every_way_of_typing_one_number_gives_one_value(typed):
    """
    This is what makes "one customer per phone" possible. If two spellings
    stored two values, the unique index would never fire.
    """
    from app.repositories.customers import normalise_phone

    assert normalise_phone(typed) == "+919876543210"


@pytest.mark.parametrize(
    "junk", ["", None, "   ", "12345", "abcdefghij", "98765", "1234567890123456789"]
)
def test_junk_is_refused_rather_than_stored(junk):
    from app.repositories.customers import normalise_phone

    assert normalise_phone(junk) is None


def test_a_ten_digit_number_is_assumed_indian():
    from app.repositories.customers import normalise_phone

    assert normalise_phone("9876543210") == "+919876543210"


def test_a_number_that_already_has_a_country_code_is_left_alone():
    from app.repositories.customers import normalise_phone

    assert normalise_phone("14155550100") == "+14155550100"


@pytest.mark.parametrize(
    "typed, expected",
    [
        ("Ravi@Example.COM", "ravi@example.com"),
        ("  ravi@example.com  ", "ravi@example.com"),
        ("RAVI.KUMAR@GMAIL.COM", "ravi.kumar@gmail.com"),
    ],
)
def test_emails_are_lowercased_and_trimmed(typed, expected):
    from app.repositories.customers import normalise_email

    assert normalise_email(typed) == expected


@pytest.mark.parametrize(
    "junk", ["", None, "not an email", "@example.com", "ravi@", "ravi@example", "a b@c.com"]
)
def test_email_shaped_or_nothing(junk):
    from app.repositories.customers import normalise_email

    assert normalise_email(junk) is None


# ------------------------------------------------------- invoice numbers


@pytest.mark.parametrize(
    "typed",
    ["INV/2026-27/0007", "inv/2026-27/0007", "  INV/2026-27/0007  ",
     "INV\\2026-27\\0007", "INV / 2026-27 / 0007"],
)
def test_an_invoice_number_typed_carelessly_still_matches(typed):
    """A customer reading a number off their phone types it every which way."""
    from app.repositories.invoices import normalise_number

    assert normalise_number(typed) == "INV/2026-27/0007"
