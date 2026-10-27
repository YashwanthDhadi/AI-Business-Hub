"""
Request authentication for dashboard routes.

DEVELOPMENT GRADE. A shared header key proves the caller is our own frontend;
it does NOT prove which business they belong to. See the appendix in
docs/guides/customer-support-agent/07-owner-dashboard.md for the Supabase JWT
version that replaces it.
"""

import logging

from fastapi import Header, HTTPException, Query, status

from app.config import settings

logger = logging.getLogger("aibh.security")


def require_dashboard_key(x_dashboard_key: str | None = Header(default=None)) -> None:
    """FastAPI dependency: reject anything without the shared key."""
    expected = settings.dashboard_api_key
    if not expected or expected == "change-me":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DASHBOARD_API_KEY is not configured on the server",
        )
    if x_dashboard_key != expected:
        logger.warning("Dashboard request rejected: bad or missing X-Dashboard-Key")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-Dashboard-Key header",
        )


def business_scope(business_id: str = Query(..., description="Business workspace id")) -> str:
    """
    The tenant every dashboard route operates on.

    Today it comes from the query string. When Supabase Auth lands it will be
    read from the verified JWT instead — and because every route depends on
    THIS function, that is a one-function change.
    """
    if not business_id:
        raise HTTPException(status_code=400, detail="business_id is required")
    return business_id
