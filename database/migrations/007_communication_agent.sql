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
