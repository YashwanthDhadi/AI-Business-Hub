"""
Text a PERSON reads, the Indian way.

Dates are day-month-year ("Sat, 3 Oct 2026") and money uses lakh grouping
("₹1,20,000"). Data sent to the dashboard stays machine-readable - ISO dates,
plain numbers - and the frontend formats it. These are only for sentences that
go straight into a customer's chat.
"""

from __future__ import annotations

from datetime import date, datetime


def spoken_date(value: date | str) -> str:
    """
    '2026-10-17' -> 'Sat, 17 Oct 2026'.

    Built by hand rather than with %-d, which is a GNU extension and raises
    ValueError on Windows.
    """
    if isinstance(value, str):
        try:
            value = datetime.strptime(value[:10], "%Y-%m-%d").date()
        except ValueError:
            return value
    return f"{value:%a}, {value.day} {value:%b %Y}"


def rupees(amount: float | int | str) -> str:
    """
    120000 -> '₹1,20,000'.   9000.5 -> '₹9,000.50'.

    Indian grouping: the last three digits, then pairs. Python's own "{:,}"
    groups in threes (120,000), which reads wrong to an Indian customer.
    """
    value = round(float(amount), 2)
    whole = int(abs(value))
    paise = round((abs(value) - whole) * 100)

    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        pairs = []
        while len(head) > 2:
            pairs.insert(0, head[-2:])
            head = head[:-2]
        if head:
            pairs.insert(0, head)
        digits = ",".join(pairs) + "," + tail

    text = f"₹{digits}" + (f".{paise:02d}" if paise else "")
    return f"-{text}" if value < 0 else text
