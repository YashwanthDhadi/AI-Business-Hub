"""
Campaigns: one message sent to many customers.

HONEST SCOPE. The only channel is the customer's own chat thread. There is no
SMS and no WhatsApp, because neither has a free tier: Twilio charges per
message and Meta charges per conversation and requires business verification.
Rather than build a Send button that quietly does nothing, this sends a real
message to a real place - the chat the customer already has open - and the
screen says exactly that.

TWO RULES THE DATABASE ENFORCES (migration 007):
  1. Nothing sends without an owner's approval.
  2. One customer receives one message per campaign, ever. A unique index on
     (campaign_id, customer_id) makes a double-click harmless.

WHO IS SKIPPED, and why the owner is told:
  * anyone who opted out of marketing (customers.marketing_consent)
  * anyone with no chat thread - there is nowhere to post
A campaign that reaches 3 of 40 people explains itself instead of looking broken.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.db import db, one, rows

logger = logging.getLogger("aibh.campaigns")

AUDIENCES = {"all", "active", "leads", "inactive", "unpaid_invoices", "custom"}

RULES = {
    "campaigns_immutable": "An approved campaign's message cannot be edited.",
    "campaigns_bad_transition": "That change is not allowed for a campaign in this state.",
    "campaigns_approval_stamped": "An approved campaign must record who approved it.",
    "campaigns_body_check": "The message must be between 3 and 2000 characters.",
    "campaigns_name_check": "The campaign needs a name.",
    "campaigns_audience_check": "That is not one of the allowed audiences.",
    "campaigns_channel_check": "Chat is the only channel available.",
}


class CampaignRefused(Exception):
    def __init__(self, rule: str, message: str) -> None:
        self.rule = rule
        super().__init__(message)


class NotInState(Exception):
    """The campaign moved on before this request arrived - probably another tab."""


def _explain(exc: Exception) -> Exception:
    text = str(exc)
    for rule, message in RULES.items():
        if rule in text:
            return CampaignRefused(rule, message)
    return exc


def _run(query):
    try:
        return query.execute()
    except Exception as exc:  # noqa: BLE001
        explained = _explain(exc)
        if explained is exc:
            raise
        raise explained from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------------- read


def get(business_id: str, campaign_id: str) -> dict | None:
    return one(
        db.table("campaign_overview")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", campaign_id)
        .limit(1)
        .execute()
    )


def list_campaigns(business_id: str, limit: int = 200) -> list[dict]:
    return rows(
        db.table("campaign_overview")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )


def recipients(business_id: str, campaign_id: str) -> list[dict]:
    return rows(
        db.table("campaign_recipients")
        .select("*, customers(id, name, phone)")
        .eq("business_id", business_id)
        .eq("campaign_id", campaign_id)
        .order("created_at")
        .execute()
    )


# ------------------------------------------------------------ who it goes to


def resolve_audience(business_id: str, audience: str, customer_ids: list[str] | None = None) -> list[dict]:
    """
    Turn an audience name into real customers.

    Reads customer_overview, so "active" and "leads" mean exactly what the
    Customers screen shows - the status calculated from bookings, not a
    separate idea of the same word.
    """
    if audience == "custom":
        if not customer_ids:
            return []
        return rows(
            db.table("customer_overview")
            .select("*")
            .eq("business_id", business_id)
            .in_("id", customer_ids[:500])
            .execute()
        )

    if audience == "unpaid_invoices":
        owing = rows(
            db.table("invoices")
            .select("customer_id")
            .eq("business_id", business_id)
            .eq("status", "pending")
            .execute()
        )
        ids = sorted({r["customer_id"] for r in owing})
        if not ids:
            return []
        return rows(
            db.table("customer_overview")
            .select("*")
            .eq("business_id", business_id)
            .in_("id", ids[:500])
            .execute()
        )

    everyone = rows(
        db.table("customer_overview")
        .select("*")
        .eq("business_id", business_id)
        .limit(1000)
        .execute()
    )
    if audience == "all":
        return everyone
    return [c for c in everyone if c.get("status") == {"active": "active", "leads": "lead", "inactive": "inactive"}[audience]]


def _latest_conversation(business_id: str, customer_id: str) -> str | None:
    found = one(
        db.table("conversations")
        .select("id")
        .eq("business_id", business_id)
        .eq("customer_id", customer_id)
        .order("last_message_at", desc=True)
        .limit(1)
        .execute()
    )
    return (found or {}).get("id")


def build_recipients(business_id: str, campaign: dict, customer_ids: list[str] | None = None) -> dict:
    """
    Work out who will receive this, and write one row per person.

    Everybody in the audience gets a row, including the people who will be
    skipped, with the reason. The owner then sees "40 chosen, 31 will receive
    it, 6 opted out, 3 have never chatted" BEFORE approving, rather than
    discovering it afterwards.
    """
    people = resolve_audience(business_id, campaign["audience"], customer_ids)

    planned: list[dict] = []
    for customer in people:
        reason = ""
        status = "pending"
        conversation_id = None

        if customer.get("marketing_consent") == "opted_out":
            status, reason = "skipped", "Asked not to receive offers"
        else:
            conversation_id = _latest_conversation(business_id, customer["id"])
            if not conversation_id:
                status, reason = "skipped", "Has never chatted, so there is nowhere to send it"

        planned.append(
            {
                "business_id": business_id,
                "campaign_id": campaign["id"],
                "customer_id": customer["id"],
                "conversation_id": conversation_id,
                "status": status,
                "reason": reason,
            }
        )

    if planned:
        # The unique index on (campaign_id, customer_id) means a second call
        # for the same campaign inserts nothing rather than duplicating.
        try:
            db.table("campaign_recipients").upsert(
                planned, on_conflict="campaign_id,customer_id"
            ).execute()
        except Exception:  # noqa: BLE001
            logger.exception("Could not write recipients for campaign %s", campaign["id"])
            raise

    return {
        "total": len(planned),
        "will_receive": sum(1 for p in planned if p["status"] == "pending"),
        "skipped": sum(1 for p in planned if p["status"] == "skipped"),
    }


# ---------------------------------------------------------------------- write


def create(
    business_id: str,
    *,
    name: str,
    body: str,
    audience: str = "custom",
    created_by: str = "owner",
) -> dict:
    if audience not in AUDIENCES:
        raise CampaignRefused("campaigns_audience_check", RULES["campaigns_audience_check"])
    created = one(
        _run(
            db.table("campaigns").insert(
                {
                    "business_id": business_id,
                    "name": (name or "").strip(),
                    "body": (body or "").strip(),
                    "audience": audience,
                    "channel": "chat",
                    "created_by": created_by,
                }
            )
        )
    )
    if created is None:
        raise RuntimeError("Could not create the campaign")
    logger.info("Campaign %s drafted by %s", created["name"], created_by)
    return get(business_id, created["id"]) or created


def update_draft(business_id: str, campaign_id: str, fields: dict) -> dict | None:
    """Edit a draft. The database refuses this once it has been approved."""
    patch = {
        key: (value.strip() if isinstance(value, str) else value)
        for key, value in fields.items()
        if key in {"name", "body", "audience"} and value is not None
    }
    if patch:
        _run(
            db.table("campaigns")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", campaign_id)
        )
    return get(business_id, campaign_id)


def _move(business_id: str, campaign_id: str, patch: dict, *, only_from: str) -> dict:
    """
    Apply a status change only while the campaign is still in `only_from`.

    The status filter is part of the UPDATE, so two tabs approving at once
    cannot both succeed - the second matches no row and raises NotInState.
    """
    changed = rows(
        _run(
            db.table("campaigns")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", campaign_id)
            .eq("status", only_from)
        )
    )
    if not changed:
        raise NotInState(f"This campaign is no longer a {only_from.replace('_', ' ')}.")
    return get(business_id, campaign_id) or changed[0]


def submit(business_id: str, campaign_id: str) -> dict:
    return _move(business_id, campaign_id, {"status": "pending_approval"}, only_from="draft")


def approve(business_id: str, campaign_id: str, approved_by: str = "owner") -> dict:
    """
    The owner says yes. The ONLY path to a campaign that can be sent.

    The agent has no route and no tool that reaches this.
    """
    return _move(
        business_id,
        campaign_id,
        {"status": "approved", "approved_at": _now(), "approved_by": approved_by},
        only_from="pending_approval",
    )


def cancel(business_id: str, campaign_id: str, reason: str = "") -> dict | None:
    current = get(business_id, campaign_id)
    if current is None:
        return None
    if current["status"] in {"sent", "cancelled"}:
        raise NotInState("This campaign has already been sent or cancelled.")
    return _move(
        business_id,
        campaign_id,
        {"status": "cancelled", "cancelled_at": _now(), "cancel_reason": (reason or "")[:300]},
        only_from=current["status"],
    )


def mark_sent(business_id: str, campaign_id: str) -> dict:
    return _move(
        business_id, campaign_id, {"status": "sent", "sent_at": _now()}, only_from="approved"
    )


def claim_recipient(business_id: str, recipient_id: str) -> dict | None:
    """
    Mark one recipient as sent, but ONLY if it was still pending.

    This is what makes a retried or double-clicked send safe: the row is
    claimed and delivered once. A second attempt matches nothing and is
    skipped rather than messaging the customer twice.
    """
    changed = rows(
        db.table("campaign_recipients")
        .update({"status": "sent", "sent_at": _now()})
        .eq("business_id", business_id)
        .eq("id", recipient_id)
        .eq("status", "pending")
        .execute()
    )
    return changed[0] if changed else None


def mark_failed(business_id: str, recipient_id: str, reason: str) -> None:
    db.table("campaign_recipients").update(
        {"status": "failed", "reason": reason[:300]}
    ).eq("business_id", business_id).eq("id", recipient_id).execute()
