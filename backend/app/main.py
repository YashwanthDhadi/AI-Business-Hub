"""
FastAPI application entry point.

Creates the app, installs middleware, and mounts every router. Routers are
imported here and nowhere else, so this file is the map of the whole API.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import (
    chat,
    communication,
    customers,
    dashboard,
    documents,
    health,
    inventory,
    pay,
    payments,
    reports,
)

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("aibh")

app = FastAPI(
    title="AI Business Hub API",
    description="Backend for the AI Business Hub agent platform.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)

# ------------------------------------------------------------------ middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Chat-Session", "X-Dashboard-Key"],
)


# --------------------------------------------------------------- error handler
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Last line of defence. Logs the full traceback for you, returns a short,
    safe message to the caller. Never leak internals to a public endpoint.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "path": request.url.path},
    )


# -------------------------------------------------------------------- lifecycle
@app.on_event("startup")
async def on_startup() -> None:
    logger.info("AI Business Hub API starting in %s mode", settings.app_env)
    logger.info("CORS origins: %s", settings.cors_origin_list)


# ---------------------------------------------------------------------- routes
app.include_router(health.router)
app.include_router(chat.router)
app.include_router(dashboard.router)
app.include_router(customers.router)
app.include_router(payments.router)
app.include_router(pay.router)
app.include_router(inventory.router)
app.include_router(documents.router)
app.include_router(communication.router)
app.include_router(reports.router)


@app.get("/")
def root() -> dict:
    return {
        "name": "AI Business Hub API",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }
