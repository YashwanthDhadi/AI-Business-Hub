"""
Reporting.

There are no tables here. A report is a question about data that already
exists, so migration 008 is views and functions, and this module just calls
them.

The arithmetic is done by Postgres, never by a model. A language model that
adds up revenue will eventually add it up wrong, and it will be confident
about it. The model's only job in reporting is to say what the numbers mean,
after SQL has produced them - see routers/reports.py.
"""

from __future__ import annotations

import logging

from app.db import db, one, rows

logger = logging.getLogger("aibh.reports")


def summary(business_id: str, days: int = 30) -> dict:
    """Headline totals for a window of days, worked out in one query."""
    found = one(
        db.rpc("report_summary", {"p_business_id": business_id, "p_days": days}).execute()
    )
    return found or {}


def daily(business_id: str, days: int = 30) -> list[dict]:
    """
    One row per day, oldest first - what the charts draw.

    The view holds 90 days per business; this trims to what was asked for.
    Dates are the BUSINESS's local dates, so a 7 AM class counts on the day
    the owner thinks it does rather than the UTC day.
    """
    window = max(1, min(days, 90))
    found = rows(
        db.table("report_daily")
        .select("*")
        .eq("business_id", business_id)
        .order("day", desc=True)
        .limit(window)
        .execute()
    )
    return list(reversed(found))


def top_services(business_id: str, days: int = 30, limit: int = 5) -> list[dict]:
    return rows(
        db.rpc(
            "report_top_services",
            {"p_business_id": business_id, "p_days": days, "p_limit": limit},
        ).execute()
    )
