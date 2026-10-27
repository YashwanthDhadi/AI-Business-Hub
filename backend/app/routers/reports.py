"""
The owner's reports screen: /api/v1/dashboard/reports.

OWNER-ONLY. There is no chat tool for reporting, and that is not an oversight:
the public chat is for customers, and a customer must never be able to ask how
much the business earned this week.

WHERE THE NUMBERS COME FROM. Every figure on this screen is produced by SQL
(migration 008). The model is given the finished numbers and asked to write
two or three sentences about them. It never calculates, and it is told in the
prompt to use only the numbers it was handed.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.agents.llm import describe_error, get_model
from app.repositories import businesses as business_repo
from app.repositories import reports as report_repo
from app.services.formatting import rupees
from app.security import business_scope, require_dashboard_key

logger = logging.getLogger("aibh.router.reports")

router = APIRouter(
    prefix="/api/v1/dashboard/reports",
    tags=["reports"],
    dependencies=[Depends(require_dashboard_key)],
)

SUMMARY_PROMPT = """You are writing a short note for the owner of {business_name} about the last {days} days.

Here are the numbers. They are already correct - do NOT recalculate anything,
and do not mention any figure that is not in this list.

{numbers}

Write 2 to 3 plain sentences: what stands out, and one thing worth doing next.
No headings, no bullet points, no markdown, no emoji. If the numbers are all
zero, say plainly that there is not enough activity yet to draw a conclusion."""


def _summary(row: dict) -> dict:
    return {
        "days": int(row.get("days") or 0),
        "conversations": int(row.get("conversations") or 0),
        "bookings": int(row.get("bookings") or 0),
        "completedBookings": int(row.get("completed_bookings") or 0),
        "cancelledBookings": int(row.get("cancelled_bookings") or 0),
        "invoicesIssued": int(row.get("invoices_issued") or 0),
        "collected": float(row.get("collected") or 0),
        "outstanding": float(row.get("outstanding") or 0),
        "newCustomers": int(row.get("new_customers") or 0),
        "activeCustomers": int(row.get("active_customers") or 0),
        "lowStockItems": int(row.get("low_stock_items") or 0),
    }


def _day(row: dict) -> dict:
    return {
        "day": str(row.get("day") or ""),
        "conversations": int(row.get("conversations") or 0),
        "bookings": int(row.get("bookings") or 0),
        "completedBookings": int(row.get("completed_bookings") or 0),
        "cancelledBookings": int(row.get("cancelled_bookings") or 0),
        "invoicesIssued": int(row.get("invoices_issued") or 0),
        "collected": float(row.get("collected") or 0),
        "newCustomers": int(row.get("new_customers") or 0),
    }


@router.get("")
def get_report(
    days: int = Query(default=30, ge=1, le=90),
    business_id: str = Depends(business_scope),
) -> dict:
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    return {
        "summary": _summary(report_repo.summary(business_id, days)),
        "daily": [_day(d) for d in report_repo.daily(business_id, days)],
        "topServices": [
            {
                "serviceName": s.get("service_name") or "",
                "bookings": int(s.get("bookings") or 0),
                "revenue": float(s.get("revenue") or 0),
            }
            for s in report_repo.top_services(business_id, days)
        ],
        "business": {"name": business.get("name") or ""},
    }


@router.post("/summarise")
def summarise(
    days: int = Query(default=30, ge=1, le=90),
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Ask the model to describe the numbers SQL produced.

    On purpose, this is a separate request the owner chooses to make. Loading
    the screen must not spend model quota, and the numbers are useful without
    a sentence about them.
    """
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    figures = _summary(report_repo.summary(business_id, days))
    top = report_repo.top_services(business_id, days, limit=3)

    # The model is handed finished, formatted numbers. It has no tools and no
    # database access, so it cannot look anything up or work anything out.
    lines = [
        f"- conversations: {figures['conversations']}",
        f"- bookings: {figures['bookings']} ({figures['completedBookings']} completed, "
        f"{figures['cancelledBookings']} cancelled)",
        f"- invoices issued: {figures['invoicesIssued']}",
        f"- money collected: {rupees(figures['collected'])}",
        f"- still owed: {rupees(figures['outstanding'])}",
        f"- new customers: {figures['newCustomers']}",
        f"- active customers: {figures['activeCustomers']}",
        f"- products low or out of stock: {figures['lowStockItems']}",
    ]
    for service in top:
        lines.append(
            f"- {service.get('service_name')}: {int(service.get('bookings') or 0)} bookings, "
            f"{rupees(service.get('revenue') or 0)}"
        )

    prompt = SUMMARY_PROMPT.format(
        business_name=business.get("name") or "the business",
        days=figures["days"],
        numbers="\n".join(lines),
    )

    try:
        reply = get_model("reports", temperature=0.3, timeout=30).invoke(prompt)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Report summary failed: %s", exc)
        raise HTTPException(status_code=503, detail=describe_error(exc)) from exc

    text = str(reply.content or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="The model returned nothing. Try again.")
    return {"summary": text[:1200], "basedOn": figures}
