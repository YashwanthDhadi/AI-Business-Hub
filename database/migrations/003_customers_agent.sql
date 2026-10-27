-- ============================================================================
-- 003_customers_agent.sql
-- The Customers Agent: a real client directory behind /dashboard/customers.
-- Run once, in the Supabase SQL Editor. Safe to re-run: every statement is
-- "if not exists" or ignores "already exists".
-- ============================================================================

-- ------------------------------------------------ 1. new fields on customers
-- Only things a HUMAN decides are stored. Status, spend and last visit are
-- calculated from appointments in the view at the bottom of this file.
alter table public.customers
  add column if not exists status_override    text,
  add column if not exists membership_plan    text,
  add column if not exists preferred_channel  text,
  add column if not exists source             text not null default 'chat',
  add column if not exists marketing_consent  text not null default 'unknown',
  add column if not exists consent_source     text,
  add column if not exists consent_updated_at timestamptz;

-- ------------------------------------------- 2. rules the database enforces
-- Each rule is in its own block, so re-running the file skips the ones that
-- already exist instead of failing.

-- Phones are stored one way only: +<country code><number>, 10-15 digits.
-- The unique index on (business_id, phone) only works if '98765 43210' and
-- '+919876543210' cannot both be stored.
do $$ begin
  alter table public.customers add constraint customers_phone_format
    check (phone is null or phone ~ '^\+[0-9]{10,15}$');
exception when duplicate_object then null; end $$;

-- Emails are stored lowercase for the same reason.
do $$ begin
  alter table public.customers add constraint customers_email_format
    check (email is null or (
      email = lower(btrim(email))
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ));
exception when duplicate_object then null; end $$;

-- A record has to identify somebody.
do $$ begin
  alter table public.customers add constraint customers_identifiable
    check (coalesce(btrim(name), '') <> '' or phone is not null or email is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.customers add constraint customers_status_override_values
    check (status_override is null or status_override in ('lead', 'active', 'inactive'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.customers add constraint customers_channel_values
    check (preferred_channel is null or preferred_channel in ('sms', 'whatsapp', 'email'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.customers add constraint customers_source_values
    check (source in ('chat', 'dashboard', 'import'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.customers add constraint customers_consent_values
    check (
      marketing_consent in ('unknown', 'opted_in', 'opted_out')
      and (consent_source is null or consent_source in ('chat', 'dashboard'))
    );
exception when duplicate_object then null; end $$;

-- THE consent rule. Anyone can type anyone's number into a public chat, so a
-- chat may record an opt-OUT but never an opt-IN. Only the owner can opt a
-- customer in, from the dashboard, after asking them in person.
do $$ begin
  alter table public.customers add constraint customers_opt_in_needs_owner
    check (marketing_consent <> 'opted_in' or consent_source = 'dashboard');
exception when duplicate_object then null; end $$;

-- Lets other tables reference (id, business_id) as a pair. See customer_notes.
do $$ begin
  alter table public.customers add constraint customers_id_business_key
    unique (id, business_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- ----------------------------------------------------- 3. the agent's notes
-- Append-only. The owner's own notes stay in customers.notes, so nothing the
-- agent writes can ever overwrite what the owner typed.
create table if not exists public.customer_notes (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  customer_id     uuid not null,
  conversation_id uuid references public.conversations (id) on delete set null,

  kind   text not null default 'note'
           check (kind in ('preference', 'interest', 'note')),
  body   text not null
           check (char_length(btrim(body)) between 3 and 300),
  author text not null default 'agent'
           check (author in ('agent', 'owner')),

  created_at timestamptz not null default now(),

  -- The PAIR must exist in customers. A note can never be attached to a
  -- customer of a different business, even if Python passes the wrong id.
  foreign key (customer_id, business_id)
    references public.customers (id, business_id) on delete cascade
);

create index if not exists customer_notes_customer_idx
  on public.customer_notes (business_id, customer_id, created_at desc);

-- Models repeat themselves. The same note twice on one customer is refused,
-- whatever the capitalisation or surrounding spaces.
create unique index if not exists customer_notes_no_repeats
  on public.customer_notes (customer_id, kind, lower(btrim(body)));

alter table public.customer_notes enable row level security;

drop policy if exists customer_notes_member_access on public.customer_notes;
create policy customer_notes_member_access on public.customer_notes
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------------------------ 4. the directory view
-- Calculated on every read, so nothing has to remember to keep it up to date.
--
-- security_invoker = true makes the view obey the row level security of the
-- tables underneath it. Without it, a view runs with its OWNER's rights and
-- would show every business's customers to anyone allowed to read the view.
drop view if exists public.customer_overview;

create view public.customer_overview
with (security_invoker = true) as
select
  c.*,
  coalesce(s.bookings_count, 0)  as bookings_count,
  coalesce(s.upcoming_count, 0)  as upcoming_count,
  coalesce(s.completed_spend, 0) as completed_spend,
  s.last_visit_date,
  coalesce(
    c.status_override,
    case
      when coalesce(s.recent_count, 0) > 0 then 'active'
      when coalesce(s.ever_count, 0) > 0   then 'inactive'
      else 'lead'
    end
  ) as status,
  c.status_override is null as status_is_automatic
from public.customers c
join public.businesses b on b.id = c.business_id
left join lateral (
  select
    count(*) as bookings_count,
    count(*) filter (
      where a.status in ('pending', 'confirmed') and a.starts_at >= now()
    ) as upcoming_count,
    sum(a.price) filter (where a.status = 'completed') as completed_spend,
    -- The business's local date, not the UTC one: a 7 AM IST visit is
    -- 01:30 UTC and must not show as the day before.
    max((a.starts_at at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date)
      filter (where a.status = 'completed') as last_visit_date,
    count(*) filter (
      where a.status in ('confirmed', 'completed')
        and a.starts_at >= now() - interval '60 days'
    ) as recent_count,
    count(*) filter (where a.status in ('confirmed', 'completed')) as ever_count
  from public.appointments a
  where a.customer_id = c.id
    and a.business_id = c.business_id
) s on true;

-- ------------------------------------------------ 5. switch it on for the gym
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
select id, 'customers', true, '{}'::jsonb
  from public.businesses
 where chat_slug = 'pulse-fitness'
on conflict (business_id, agent_key) do update set is_active = true;

-- Tell the API layer about the new table and view straight away.
notify pgrst, 'reload schema';

-- Confirm
select
  (select count(*) from public.customer_overview) as customers_in_view,
  (select count(*) from public.customer_notes)    as notes,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'customers')                 as customers_active;
