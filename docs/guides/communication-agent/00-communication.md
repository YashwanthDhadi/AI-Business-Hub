# Guide 8 — The Communication Agent (STEP 68 → STEP 72)

One message, sent to many customers. Reminders, offers, announcements.

---

## Read this first: what "send" honestly means

The mock screen offered **SMS**, **WhatsApp** and **email**. Two of those
cannot be built for free, and the third needs a mail service:

| Channel | Why not |
| --- | --- |
| SMS | Twilio and every Indian gateway charge per message. No free tier. |
| WhatsApp | Meta charges per conversation **and** requires business verification. |
| Email | Possible later via Gmail SMTP, but needs an app password and has its own limits. |

So there is **one** channel: the customer's own chat thread. It is free, it is
real, and the customer already has it open.

The database enforces this — `channel` has `check (channel in ('chat'))` — and
the screen says it in plain words rather than showing pickers that do nothing:

> *Messages appear in the customer's own chat thread. SMS and WhatsApp are not
> available: neither has a free tier.*

A Send button that silently does nothing is worse than no Send button.

---

## The two rules the database enforces

1. **Nothing sends without an owner's approval.** The agent cannot approve.
2. **One customer receives one message per campaign, ever** — however many
   times Send is pressed.

And one rule of courtesy, also enforced: anyone who asked the assistant to stop
sending offers is skipped, and the owner is told.

---

## Why this one is owner-only

`communication` is **not** in `OPTIONAL_CAPABILITIES`, so the chat agent has no
tool for it and the supervisor can never route to it.

A customer on a public chat link must not be able to start a message to
everyone else. The only place a model appears is the **Suggest** button, which
writes wording into a form the owner then edits and approves.

---

## STEP 68 — The campaigns migration

### Architecture

```
  campaigns                          campaign_recipients
  ---------                          -------------------
  status: draft                      one row per customer
        -> pending_approval          status: pending | sent | skipped | failed
        -> approved     <- a person  reason: why they were skipped
        -> sent                      UNIQUE (campaign_id, customer_id)
        -> cancelled                        ^ the duplicate guard
```

Everyone in the audience gets a row, **including the people who will be
skipped**, with the reason. So before approving, the owner sees:

> 40 chosen · 31 will receive it · 6 asked not to get offers · 3 have never chatted

rather than discovering the reach afterwards.

### Files involved

```
database/migrations/
└── 007_communication_agent.sql     ← new
```

### Code

**`database/migrations/007_communication_agent.sql`** — complete file:

```sql
-- ============================================================================
-- 007_communication_agent.sql
-- Campaigns for the Communication Agent.
-- Run once, in the Supabase SQL Editor. Safe to re-run.
--
-- HONEST SCOPE: the only channel is the customer's own chat thread. There is
-- no SMS and no WhatsApp, because neither has a free tier - Twilio and Meta
-- both charge per message and Meta needs business verification. A "channel"
-- column exists so a paid channel can be added later, but 'chat' is the only
-- value allowed today, and the constraint says so rather than the UI pretending.
--
-- TWO RULES THE DATABASE ENFORCES:
--   1. Nothing sends without an owner's approval (the agent cannot approve).
--   2. One customer gets one message per campaign, ever.
-- ============================================================================

-- ------------------------------------------------------------- campaigns
create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,

  name         text not null check (char_length(btrim(name)) between 1 and 120),
  -- Who it goes to. Resolved to real customers when the campaign is built.
  audience     text not null default 'custom'
                 check (audience in ('all', 'active', 'leads', 'inactive', 'unpaid_invoices', 'custom')),
  channel      text not null default 'chat' check (channel in ('chat')),
  body         text not null check (char_length(btrim(body)) between 3 and 2000),

  status       text not null default 'draft'
                 check (status in ('draft', 'pending_approval', 'approved', 'sent', 'cancelled')),

  -- Who made it. An agent-drafted campaign still needs an owner to approve.
  created_by   text not null default 'owner' check (created_by in ('owner', 'agent')),

  approved_at  timestamptz,
  approved_by  text,
  sent_at      timestamptz,
  cancelled_at timestamptz,
  cancel_reason text not null default '',

  created_at   timestamptz not null default now(),

  -- Approved means a human approved it, and says who and when.
  constraint campaigns_approval_stamped
    check ((status in ('approved', 'sent')) = (approved_at is not null and approved_by is not null)),
  constraint campaigns_sent_stamped check ((status = 'sent') = (sent_at is not null)),
  constraint campaigns_cancel_stamped check ((status = 'cancelled') = (cancelled_at is not null))
);

create index if not exists campaigns_business_idx
  on public.campaigns (business_id, created_at desc);

do $$ begin
  alter table public.campaigns add constraint campaigns_id_business_key
    unique (id, business_id);
exception when duplicate_object or duplicate_table then null; end $$;

alter table public.campaigns enable row level security;
drop policy if exists campaigns_member_access on public.campaigns;
create policy campaigns_member_access on public.campaigns
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------------------------------ recipients
create table if not exists public.campaign_recipients (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  campaign_id     uuid not null,
  customer_id     uuid not null,
  conversation_id uuid references public.conversations (id) on delete set null,

  status  text not null default 'pending'
            check (status in ('pending', 'sent', 'skipped', 'failed')),
  -- Why it was skipped: "opted out", "no chat thread". Shown to the owner so a
  -- campaign that reached 3 of 40 people explains itself.
  reason  text not null default '',

  sent_at    timestamptz,
  created_at timestamptz not null default now(),

  constraint recipients_sent_stamped check ((status = 'sent') = (sent_at is not null)),

  foreign key (campaign_id, business_id)
    references public.campaigns (id, business_id) on delete cascade,
  foreign key (customer_id, business_id)
    references public.customers (id, business_id) on delete cascade
);

-- THE duplicate-send guard. One row per customer per campaign, enforced by the
-- database, so pressing Send twice cannot message anyone twice.
create unique index if not exists campaign_recipients_once_uidx
  on public.campaign_recipients (campaign_id, customer_id);

create index if not exists campaign_recipients_campaign_idx
  on public.campaign_recipients (business_id, campaign_id, status);

alter table public.campaign_recipients enable row level security;
drop policy if exists campaign_recipients_member_access on public.campaign_recipients;
create policy campaign_recipients_member_access on public.campaign_recipients
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------- a campaign cannot change after approval
create or replace function public.campaigns_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('approved', 'sent', 'cancelled') then
    if new.body <> old.body or new.audience <> old.audience or new.channel <> old.channel then
      raise exception 'campaigns_immutable: campaign "%" is % and its message cannot be edited.',
        old.name, old.status;
    end if;
  end if;

  if new.status <> old.status and not (
       (old.status = 'draft'            and new.status in ('pending_approval', 'cancelled'))
    or (old.status = 'pending_approval' and new.status in ('approved', 'cancelled'))
    or (old.status = 'approved'         and new.status in ('sent', 'cancelled'))
  ) then
    raise exception 'campaigns_bad_transition: campaign "%" cannot go from % to %.',
      old.name, old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists campaigns_guard on public.campaigns;
create trigger campaigns_guard
  before update on public.campaigns
  for each row execute function public.campaigns_guard();

-- ------------------------------------------------------------- the view
drop view if exists public.campaign_overview;
create view public.campaign_overview
with (security_invoker = true) as
select
  c.*,
  coalesce(r.total, 0)   as recipient_count,
  coalesce(r.sent, 0)    as sent_count,
  coalesce(r.skipped, 0) as skipped_count,
  coalesce(r.failed, 0)  as failed_count
from public.campaigns c
left join lateral (
  select
    count(*)                                  as total,
    count(*) filter (where status = 'sent')    as sent,
    count(*) filter (where status = 'skipped') as skipped,
    count(*) filter (where status = 'failed')  as failed
  from public.campaign_recipients cr
  where cr.campaign_id = c.id and cr.business_id = c.business_id
) r on true;

-- --------------------------------------------- switch it on for the demo gym
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
select id, 'communication', true,
       '{"require_approval": true, "max_recipients": 200}'::jsonb
  from public.businesses
on conflict (business_id, agent_key) do update set is_active = true;

notify pgrst, 'reload schema';

select
  (select count(*) from public.campaigns)           as campaigns,
  (select count(*) from public.campaign_recipients) as recipients,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'communication')              as communication_active;
```

### Explain the code

```sql
create unique index if not exists campaign_recipients_once_uidx
  on public.campaign_recipients (campaign_id, customer_id);
```
The duplicate guard, in one line. Nothing in the application needs to be
careful, because being careless is impossible.

```sql
constraint campaigns_approval_stamped
  check ((status in ('approved', 'sent')) = (approved_at is not null and approved_by is not null)),
```
Read it as *"approved if and only if we know who approved it and when"*. A
campaign cannot become approved by an `UPDATE` that forgets to say who.

```sql
  if old.status in ('approved', 'sent', 'cancelled') then
    if new.body <> old.body ... then
      raise exception 'campaigns_immutable: ...'
```
Once approved, the message is frozen. Otherwise "approve a polite reminder,
then edit it into a 90%-off offer" would be one `UPDATE` away.

```sql
  if new.status <> old.status and not (
       (old.status = 'draft'            and new.status in ('pending_approval', 'cancelled'))
    or (old.status = 'pending_approval' and new.status in ('approved', 'cancelled'))
    or (old.status = 'approved'         and new.status in ('sent', 'cancelled'))
  ) then
```
Every allowed move, written once. A draft cannot jump straight to `sent`.

### Expected result

```
campaigns | recipients | communication_active
----------+------------+----------------------
0         | 0          | true
```

---

## STEP 69 — The repository

### Files involved

```
backend/app/repositories/campaigns.py     ← new
```

### Code

**`backend/app/repositories/campaigns.py`** — complete file:

```python
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
```

### Explain the code

```python
        if customer.get("marketing_consent") == "opted_out":
            status, reason = "skipped", "Asked not to receive offers"
        else:
            conversation_id = _latest_conversation(business_id, customer["id"])
            if not conversation_id:
                status, reason = "skipped", "Has never chatted, so there is nowhere to send it"
```
Consent is checked when the recipient list is **built**, so the owner sees the
real reach before approving. It is the same `marketing_consent` the assistant
writes when a customer says "stop sending me offers" (Guide 3) — one fact, one
place.

```python
def claim_recipient(business_id, recipient_id):
    changed = rows(db.table("campaign_recipients")
        .update({"status": "sent", ...})
        .eq("status", "pending")     # <- only if still pending
        .execute())
    return changed[0] if changed else None
```
Claim-then-deliver. The row is marked sent **before** the message is posted, and
only if it was still pending. A retry finds nothing to claim and skips, so
nobody is messaged twice.

```python
    return [c for c in everyone if c.get("status") == {"active": "active", "leads": "lead", ...}[audience]]
```
Audiences read `customer_overview`, so "active" means exactly what the Customers
screen shows — the status calculated from bookings, not a second definition of
the same word.

---

## STEP 70 — The owner's API

### Files involved

```
backend/app/
├── routers/communication.py    ← new
├── schemas.py                  ← edit (four classes)
└── main.py                     ← edit
```

### Code

**`backend/app/routers/communication.py`** — complete file:

```python
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
```

### Explain the code

```python
@router.post("/draft")
def draft_message(...):
    """
    Ask the model for wording. It returns TEXT for the owner to edit.
    This creates nothing and sends nothing.
    """
```
The model's entire role. It cannot create a campaign, cannot approve one and
cannot send one — there is no route that would let it.

```python
Never invent a discount, a price, a date or an offer the owner did not mention.
```
In the drafting prompt. A model asked to "write a reminder" will happily invent
"and get 20% off!" if not told otherwise.

```python
    Synchronous on purpose. A few hundred messages is a few hundred inserts,
    which takes a moment - adding a queue and a worker to avoid that would be
    more moving parts than the problem deserves.
```
No Celery, no Redis. If this ever needs to reach thousands, that is the time to
make it a background job — and the guide says so rather than pretending the
current design scales forever.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `/draft` returns 503 | The model is rate-limited or down | The message says which. Write it yourself; the rest still works. |
| Send returns 409 | Not approved, or already sent | The status is on screen. |

---

## STEP 71 — Test it

### Code

**`backend/scripts/check_communication.py`** — complete file:

```python
"""
The campaign rules, proven against the real database and the real HTTP API.
No LLM.

The two rules that matter:
  1. NOTHING sends without an owner's approval.
  2. One customer receives one message per campaign, EVER - even if Send is
     pressed twice.

Also checked: people who opted out are skipped, people with no chat thread are
skipped with a reason, an approved message cannot be edited, and one business
cannot see or send another's campaigns.

Needs the backend running. Runs in a throwaway sandbox business.

    python scripts\\check_communication.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.config import settings
from app.db import db, one, rows
from app.repositories import campaigns as campaign_repo
from app.repositories import conversations
from app.repositories import customers as customer_repo
from sandbox import create_sandbox, destroy_sandbox

API = "http://127.0.0.1:8000/api/v1/dashboard/communication"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<54} {detail}")


def detail_of(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", ""))[:70]
    except ValueError:
        return response.text[:70]


def messages_in(bid: str, conversation_id: str) -> list[str]:
    return [m["body"] for m in conversations.messages_for(bid, conversation_id)]


sandbox = create_sandbox("communication")
other = create_sandbox("communication-other")
bid = sandbox["id"]
client = httpx.Client(
    timeout=60, headers={"X-Dashboard-Key": settings.dashboard_api_key}, params={"business_id": bid}
)

try:
    # ---- three customers, deliberately different ---------------------------------
    chatty = customer_repo.upsert_from_chat(business_id=bid, name="Chatty", phone="9000000801")
    optout = customer_repo.upsert_from_chat(business_id=bid, name="Opted Out", phone="9000000802")
    silent = customer_repo.upsert_from_chat(business_id=bid, name="Never Chatted", phone="9000000803")

    chat_a = conversations.create(bid, channel="web")
    conversations.attach_customer(bid, chat_a["id"], chatty["id"])
    chat_b = conversations.create(bid, channel="web")
    conversations.attach_customer(bid, chat_b["id"], optout["id"])
    customer_repo.set_marketing_consent(
        business_id=bid, customer_id=optout["id"], consent="opted_out", source="chat"
    )
    # `silent` gets no conversation at all.

    print("\nplanning who receives it")
    made = client.post(API, json={"name": "October offer", "body": "20% off yoga this month.",
                                  "audience": "all"})
    campaign = made.json().get("campaign", {}) if made.status_code == 201 else {}
    plan = made.json().get("plan", {}) if made.status_code == 201 else {}
    cid = campaign.get("id", "")
    check("created as a draft -> 201", made.status_code == 201 and campaign.get("status") == "draft",
          campaign.get("status"))
    check("3 customers chosen", plan.get("total") == 3, plan)
    check("  ...1 will actually receive it", plan.get("will_receive") == 1, plan.get("will_receive"))
    check("  ...2 skipped, with reasons", plan.get("skipped") == 2, plan.get("skipped"))

    listed = client.get(f"{API}/{cid}").json()
    reasons = {r["customerName"]: r["reason"] for r in listed["recipients"]}
    check("  opted-out person is skipped by name", "offers" in reasons.get("Opted Out", ""),
          reasons.get("Opted Out"))
    check("  person with no chat is skipped by name", "never chatted" in reasons.get("Never Chatted", "").lower(),
          reasons.get("Never Chatted"))

    print("\nnothing sends without approval")
    early = client.post(f"{API}/{cid}/send")
    check("send a draft -> 409", early.status_code == 409, detail_of(early))
    check("  ...and nobody was messaged", campaign["body"] not in messages_in(bid, chat_a["id"]))

    client.post(f"{API}/{cid}/submit")
    pending = client.get(f"{API}/{cid}").json()["campaign"]
    check("submitted -> pending_approval", pending["status"] == "pending_approval", pending["status"])
    still = client.post(f"{API}/{cid}/send")
    check("send while only submitted -> 409", still.status_code == 409, detail_of(still))

    approved = client.post(f"{API}/{cid}/approve", json={"approved_by": "owner"})
    body = approved.json().get("campaign", {})
    check("approve -> 200", approved.status_code == 200 and body.get("status") == "approved")
    check("  ...and it records WHO approved it", body.get("approvedBy") == "owner", body.get("approvedBy"))
    check("approve twice -> 409", client.post(f"{API}/{cid}/approve", json={}).status_code == 409)

    print("\nan approved message cannot be changed")
    edited = client.patch(f"{API}/{cid}", json={"body": "Actually 90% off everything."})
    check("edit after approval -> 409", edited.status_code == 409, detail_of(edited))
    check("  ...the message is untouched",
          client.get(f"{API}/{cid}").json()["campaign"]["body"] == "20% off yoga this month.")

    print("\nsending")
    sent = client.post(f"{API}/{cid}/send")
    result = sent.json() if sent.status_code == 200 else {}
    check("send -> 200", sent.status_code == 200, detail_of(sent))
    check("  reached exactly 1 person", result.get("sent") == 1, result.get("sent"))
    check("  the message really is in their chat",
          "20% off yoga this month." in messages_in(bid, chat_a["id"]))
    check("  the opted-out person got NOTHING",
          "20% off yoga this month." not in messages_in(bid, chat_b["id"]))

    print("\npressing Send twice")
    before = len(messages_in(bid, chat_a["id"]))
    again = client.post(f"{API}/{cid}/send")
    after = len(messages_in(bid, chat_a["id"]))
    check("second send -> 409 (already sent)", again.status_code == 409, detail_of(again))
    check("  ...and nobody received it twice", after == before, f"{before} -> {after}")

    # Straight at the repository, skipping the route's status check entirely.
    claimed_again = campaign_repo.claim_recipient(
        bid, [r["id"] for r in campaign_repo.recipients(bid, cid) if r["status"] == "sent"][0]
    )
    check("re-claiming a delivered recipient -> refused", claimed_again is None)

    print("\nthe duplicate guard is in the DATABASE")
    row = rows(db.table("campaign_recipients").select("*").eq("campaign_id", cid).limit(1).execute())[0]
    try:
        db.table("campaign_recipients").insert(
            {"business_id": bid, "campaign_id": cid, "customer_id": row["customer_id"]}
        ).execute()
        duplicated = "INSERTED (wrong)"
    except Exception as exc:  # noqa: BLE001
        duplicated = "refused" if "23505" in str(exc) else f"other error: {str(exc)[:40]}"
    check("a second row for the same person -> refused", duplicated == "refused", duplicated)

    print("\naudiences")
    unpaid = client.post(API, json={"name": "Unpaid", "body": "A reminder about your invoice.",
                                    "audience": "unpaid_invoices"})
    check("an audience with nobody in it -> 0 recipients",
          unpaid.json().get("plan", {}).get("total") == 0, unpaid.json().get("plan"))
    custom = client.post(API, json={"name": "Just one", "body": "Hello there, one person only.",
                                    "audience": "custom", "customer_ids": [chatty["id"]]})
    check("a custom audience picks exactly those people",
          custom.json().get("plan", {}).get("total") == 1, custom.json().get("plan"))

    print("\none business cannot touch another's")
    foreign = client.get(f"{API}/{cid}", params={"business_id": other["id"]})
    check("read another business's campaign -> 404", foreign.status_code == 404, detail_of(foreign))
    hijack = client.post(f"{API}/{cid}/cancel", params={"business_id": other["id"]})
    check("cancel another business's campaign -> 404", hijack.status_code == 404)
    check("  ...and it is still 'sent'",
          client.get(f"{API}/{cid}").json()["campaign"]["status"] == "sent")
    check("their campaign list is empty",
          client.get(API, params={"business_id": other["id"]}).json()["campaigns"] == [])
    naked = httpx.get(API, params={"business_id": bid}, timeout=30)
    check("no dashboard key -> 401", naked.status_code == 401)

    print("\nhonesty about channels")
    channels = client.get(API).json()
    check("only 'chat' is offered", channels.get("channels") == ["chat"], channels.get("channels"))
    check("  ...and the API says why", "free tier" in channels.get("channelNote", ""))

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(other)
    gone = one(db.table("businesses").select("id").eq("id", bid).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
```

### Expected result

```
planning who receives it
  PASS  3 customers chosen                      {'total': 3, ...}
  PASS    ...1 will actually receive it         1
  PASS    ...2 skipped, with reasons            2
  PASS    opted-out person is skipped by name   Asked not to receive offers
  PASS    person with no chat is skipped by name  Has never chatted, ...

nothing sends without approval
  PASS  send a draft -> 409
  PASS    ...and nobody was messaged
  PASS  send while only submitted -> 409

pressing Send twice
  PASS  second send -> 409 (already sent)
  PASS    ...and nobody received it twice       1 -> 1
  PASS  re-claiming a delivered recipient -> refused

the duplicate guard is in the DATABASE
  PASS  a second row for the same person -> refused   refused
...
ALL PASS
```

The last one goes **straight at the table**, skipping every line of Python, and
is still refused.

---

## STEP 72 — Wire the screen

### Files involved

```
frontend/src/
├── types/communication.ts                      ← edit (Campaign, CampaignRecipient)
├── lib/api/dashboard.ts                         ← edit
└── app/dashboard/communication/page.tsx         ← edit
```

`src/data/mock-communication.ts` is **deleted** along with `MessageTemplate`
and `SentMessage`: templates with `{name}` placeholders belong to a
multi-channel system we are not building.

### Explain the code

```tsx
{channelNote && (
  <div className="...">
    <Info /> <span>{channelNote}</span>
  </div>
)}
```
The honest note comes from the **API**, not the frontend, so a future channel
changes one string in one place.

```tsx
<Button size="sm" disabled={busy || willReceive === 0} onClick={() => onSend(campaign)}>
  <Send /> Send to {willReceive}
</Button>
```
The button says how many people it will actually reach, not how many were
chosen. Approving something labelled "Send to 31" and having it reach 3 is how
owners lose trust in a tool.

### How to test

| # | Do this | Expect |
| --- | --- | --- |
| 1 | **New Message**, audience "Everyone", type a message | Draft saved, with "x of y will receive it" |
| 2 | Try **Suggest** with "remind people their invoice is due" | Wording appears, editable |
| 3 | Open it | Who is skipped, and why |
| 4 | **Send for approval**, then **Approve** | Status changes; records who approved |
| 5 | Try to edit it now | Refused: approved messages are frozen |
| 6 | **Send** | Toast with the number reached |
| 7 | Open that customer's chat | The message is really there |
| 8 | Press **Send** again | Refused; nobody gets it twice |

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| "Nobody could be messaged" | Everyone opted out or never chatted | Open it: every skip has a reason. |
| Suggest does nothing | Model unavailable | A red toast says why. Type it yourself. |

---

## Checklist

- [ ] `007_communication_agent.sql` applied
- [ ] `python scripts\check_communication.py` → `ALL PASS` (33 checks)
- [ ] A draft cannot be sent; an approved one can
- [ ] Pressing Send twice messages nobody twice
- [ ] Someone who opted out is skipped, with the reason shown
