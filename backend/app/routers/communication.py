"""
The owner's communication screen: /api/v1/dashboard/communication.

OWNER-ONLY, deliberately. There is no chat tool for this capability, because
a person chatting on a public link has no business starting a message to
everyone else. Every route here needs the dashboard key.

The one place an LLM is involved is /draft: the owner asks for wording and
gets a suggestion they can edit. It writes TEXT into a form. It cannot create,
approve or send anything.

Sending is a real send: the message is posted into each customer's own chat
thread, which is free. No SMS, no WhatsApp - see the module docstring in
repositories/campaigns.py for why.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.agents.llm import describe_error, get_model
from app.repositories import businesses as business_repo
from app.repositories import campaigns as campaign_repo
from app.repositories import conversations as conversation_repo
from app.schemas import CampaignApproval, CampaignDraftRequest, CampaignInput, CampaignPatch
from app.security import business_scope, require_dashboard_key

logger = logging.getLogger("aibh.router.communication")

router = APIRouter(
    prefix="/api/v1/dashboard/communication",
    tags=["communication"],
    dependencies=[Depends(require_dashboard_key)],
)

DRAFT_PROMPT = """You write short messages a small business sends to its customers.

Business: {business_name}
What the owner wants to say: {intent}
Who it goes to: {audience}

Write ONE message, 2 to 3 short sentences, warm and plain. It appears in the
customer's chat window, so no subject line, no greeting placeholder like
"Dear [Name]", no markdown and no emoji.

Never invent a discount, a price, a date or an offer the owner did not mention.
Reply with the message only - no quotes, no explanation."""


def _is_uuid(value: str | None) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def _campaign(row: dict) -> dict:
    """campaign_overview row -> the frontend's Campaign type."""
    return {
        "id": row["id"],
        "businessId": row["business_id"],
        "name": row["name"],
        "body": row["body"],
        "audience": row.get("audience") or "custom",
        "channel": "chat",
        "status": row.get("status") or "draft",
        "createdBy": row.get("created_by") or "owner",
        "recipientCount": int(row.get("recipient_count") or 0),
        "sentCount": int(row.get("sent_count") or 0),
        "skippedCount": int(row.get("skipped_count") or 0),
        "failedCount": int(row.get("failed_count") or 0),
        "approvedAt": row.get("approved_at"),
        "approvedBy": row.get("approved_by"),
        "sentAt": row.get("sent_at"),
        "cancelReason": row.get("cancel_reason") or "",
        "createdAt": row.get("created_at"),
    }


def _recipient(row: dict) -> dict:
    customer = row.get("customers") or {}
    return {
        "id": row["id"],
        "customerId": row["customer_id"],
        "customerName": customer.get("name") or customer.get("phone") or "Customer",
        "status": row.get("status") or "pending",
        "reason": row.get("reason") or "",
        "sentAt": row.get("sent_at"),
    }


def _load(business_id: str, campaign_id: str) -> dict:
    found = campaign_repo.get(business_id, campaign_id) if _is_uuid(campaign_id) else None
    if found is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return found


@router.get("")
def list_campaigns(business_id: str = Depends(business_scope)) -> dict:
    if business_repo.get_business(business_id) is None:
        raise HTTPException(status_code=404, detail="Business not found")
    return {
        "campaigns": [_campaign(c) for c in campaign_repo.list_campaigns(business_id)],
        # The screen states this plainly rather than showing channel pickers
        # that do nothing.
        "channels": ["chat"],
        "channelNote": "Messages appear in the customer's own chat thread. "
        "SMS and WhatsApp are not available: neither has a free tier.",
    }


@router.get("/{campaign_id}")
def get_campaign(campaign_id: str, business_id: str = Depends(business_scope)) -> dict:
    found = _load(business_id, campaign_id)
    return {
        "campaign": _campaign(found),
        "recipients": [_recipient(r) for r in campaign_repo.recipients(business_id, campaign_id)],
    }


@router.post("/draft")
def draft_message(payload: CampaignDraftRequest, business_id: str = Depends(business_scope)) -> dict:
    """
    Ask the model for wording. It returns TEXT for the owner to edit.

    This creates nothing and sends nothing.
    """
    business = business_repo.get_business(business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    prompt = DRAFT_PROMPT.format(
        business_name=business.get("name") or "the business",
        intent=payload.intent.strip(),
        audience=payload.audience,
    )
    try:
        reply = get_model("communication", temperature=0.4, timeout=30).invoke(prompt)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Draft failed: %s", exc)
        raise HTTPException(status_code=503, detail=describe_error(exc)) from exc

    text = str(reply.content or "").strip().strip('"')
    if not text:
        raise HTTPException(status_code=502, detail="The model returned nothing. Try again.")
    return {"body": text[:2000]}


@router.post("", status_code=201)
def create_campaign(payload: CampaignInput, business_id: str = Depends(business_scope)) -> dict:
    if business_repo.get_business(business_id) is None:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        created = campaign_repo.create(
            business_id,
            name=payload.name,
            body=payload.body,
            audience=payload.audience,
            created_by="owner",
        )
        counts = campaign_repo.build_recipients(business_id, created, payload.customer_ids)
    except campaign_repo.CampaignRefused as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return {"campaign": _campaign(campaign_repo.get(business_id, created["id"]) or created), "plan": counts}


@router.patch("/{campaign_id}")
def update_campaign(
    campaign_id: str, payload: CampaignPatch, business_id: str = Depends(business_scope)
) -> dict:
    current = _load(business_id, campaign_id)
    if current["status"] not in {"draft", "pending_approval"}:
        raise HTTPException(status_code=409, detail="Only a draft can be edited.")
    try:
        updated = campaign_repo.update_draft(
            business_id, campaign_id, payload.model_dump(exclude_none=True)
        )
        if payload.audience or payload.customer_ids:
            campaign_repo.build_recipients(business_id, updated or current, payload.customer_ids)
    except campaign_repo.CampaignRefused as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"campaign": _campaign(campaign_repo.get(business_id, campaign_id) or current)}


@router.post("/{campaign_id}/submit")
def submit_campaign(campaign_id: str, business_id: str = Depends(business_scope)) -> dict:
    _load(business_id, campaign_id)
    try:
        return {"campaign": _campaign(campaign_repo.submit(business_id, campaign_id))}
    except campaign_repo.NotInState as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{campaign_id}/approve")
def approve_campaign(
    campaign_id: str, payload: CampaignApproval, business_id: str = Depends(business_scope)
) -> dict:
    """The owner gate. The ONLY path to a campaign that can be sent."""
    _load(business_id, campaign_id)
    try:
        approved = campaign_repo.approve(business_id, campaign_id, payload.approved_by)
    except campaign_repo.NotInState as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    logger.info("Campaign %s approved by %s", campaign_id, payload.approved_by)
    return {"campaign": _campaign(approved)}


@router.post("/{campaign_id}/send")
def send_campaign(campaign_id: str, business_id: str = Depends(business_scope)) -> dict:
    """
    Post the message into each customer's chat thread.

    Synchronous on purpose. A few hundred messages is a few hundred inserts,
    which takes a moment - adding a queue and a worker to avoid that would be
    more moving parts than the problem deserves. If this ever needs to reach
    thousands, that is the time to make it a background job.

    Each recipient is CLAIMED before it is delivered, so a retry or a second
    click cannot message anyone twice.
    """
    campaign = _load(business_id, campaign_id)
    if campaign["status"] != "approved":
        raise HTTPException(
            status_code=409,
            detail="Only an approved campaign can be sent. Submit it and approve it first.",
        )

    sent = failed = 0
    for recipient in campaign_repo.recipients(business_id, campaign_id):
        if recipient["status"] != "pending":
            continue
        claimed = campaign_repo.claim_recipient(business_id, recipient["id"])
        if claimed is None:
            continue  # someone else already delivered this one
        try:
            conversation_repo.add_message(
                business_id=business_id,
                conversation_id=recipient["conversation_id"],
                direction="outbound",
                author="system",
                body=campaign["body"],
                meta={"kind": "campaign", "campaign_id": campaign_id},
            )
            sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("Could not deliver to %s", recipient["customer_id"])
            campaign_repo.mark_failed(business_id, recipient["id"], str(exc))
            failed += 1

    try:
        final = campaign_repo.mark_sent(business_id, campaign_id)
    except campaign_repo.NotInState as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    logger.info("Campaign %s sent to %s, %s failed", campaign_id, sent, failed)
    return {"campaign": _campaign(final), "sent": sent, "failed": failed}


@router.post("/{campaign_id}/cancel")
def cancel_campaign(campaign_id: str, business_id: str = Depends(business_scope)) -> dict:
    _load(business_id, campaign_id)
    try:
        cancelled = campaign_repo.cancel(business_id, campaign_id)
    except campaign_repo.NotInState as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"campaign": _campaign(cancelled) if cancelled else None}
