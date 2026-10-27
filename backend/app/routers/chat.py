"""
The public chat API.

NO AUTHENTICATION. Anyone on the internet can call these routes — that is the
point, and it is why every one of them validates, rate limits, and returns the
smallest possible response.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile

from app.schemas import ChatMessageRequest, StartSessionRequest
from app.services import chat as chat_service

logger = logging.getLogger("aibh.router.chat")

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


def client_ip(request: Request) -> str | None:
    """
    The visitor's IP address.

    X-Forwarded-For is set by proxies and CDNs. It is trivially spoofable by the
    client, so treat it as a hint for rate limiting and never as identity. Once
    you deploy behind a known proxy, trust only that proxy's value.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _fail(error: chat_service.ChatError) -> HTTPException:
    """
    Translate a service error into HTTP.

    Retry-After is the standard header for 429. The chat UI reads it and shows
    a countdown instead of a dead end.
    """
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
    return HTTPException(
        status_code=error.status_code, detail=error.message, headers=headers
    )


@router.post("/session")
def start_session(payload: StartSessionRequest, request: Request) -> dict:
    """Open a new anonymous conversation. Called once when the page loads."""
    try:
        return chat_service.start_session(
            chat_slug=payload.chat_slug,
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    except chat_service.ChatError as error:
        raise _fail(error) from error


@router.post("/message")
def send_message(
    payload: ChatMessageRequest,
    request: Request,
    x_chat_session: str | None = Header(default=None),
) -> dict:
    """Send one message and get the agent's reply."""
    try:
        resolved = chat_service.resolve_session(x_chat_session or "")
        text = chat_service.validate_message(payload.message)
        chat_service.check_limits(resolved, client_ip(request))
        return chat_service.handle_message(resolved, text)
    except chat_service.ChatError as error:
        raise _fail(error) from error


@router.get("/history")
def history(x_chat_session: str | None = Header(default=None)) -> dict:
    """The visitor's own transcript, for restoring the page after a reload."""
    try:
        resolved = chat_service.resolve_session(x_chat_session or "")
        return {
            "business": {
                "name": resolved.business["name"],
                "accent": resolved.business.get("chat_accent") or "indigo",
            },
            "handed_over": bool(resolved.conversation.get("human_takeover")),
            "messages": chat_service.transcript(resolved),
        }
    except chat_service.ChatError as error:
        raise _fail(error) from error


@router.get("/business/{chat_slug}")
def get_business(chat_slug: str) -> dict:
    """Public profile for a business's chat page. No authentication."""
    try:
        return chat_service.public_business(chat_slug)
    except chat_service.ChatError as error:
        raise _fail(error) from error


@router.post("/voice")
async def send_voice(
    request: Request,
    file: UploadFile = File(...),
    x_chat_session: str | None = Header(default=None),
) -> dict:
    """Upload a recording; get back what we heard and the agent's reply."""
    try:
        resolved = chat_service.resolve_session(x_chat_session or "")
        chat_service.check_limits(resolved, client_ip(request), voice=True)
        audio = await file.read()
        return chat_service.handle_voice(resolved, audio, file.content_type)
    except chat_service.ChatError as error:
        raise _fail(error) from error
