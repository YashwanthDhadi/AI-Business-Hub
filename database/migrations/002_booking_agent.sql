-- ============================================================================
-- 002_booking_agent.sql
-- Appointments for the Booking Agent.
-- Run once, in the Supabase SQL Editor. Never edit after it has been applied.
-- ============================================================================

-- ---------------------------------------------------------------- enum types
do $$ begin
  create type booking_state  as enum ('pending', 'confirmed', 'cancelled', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_source as enum ('customer_chat', 'dashboard', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_state  as enum ('unpaid', 'paid', 'refunded');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------- appointments
create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses        (id) on delete cascade,
  customer_id     uuid not null references public.customers         (id) on delete cascade,
  service_id      uuid references public.business_services          (id) on delete set null,
  -- The chat this came from, so the confirmation can be posted back into it.
  conversation_id uuid references public.conversations              (id) on delete set null,

  -- Always UTC. The customer says "6 PM"; the database stores 12:30Z.
  starts_at        timestamptz not null,
  duration_minutes int  not null default 30,

  -- Snapshot, NOT a join. The service price may change after the booking is
  -- made, and the customer was quoted today's number.
  price            numeric(12,2) not null default 0,
  service_name     text not null default '',

  status          booking_state  not null default 'pending',
  payment_status  payment_state  not null default 'unpaid',
  source          booking_source not null default 'customer_chat',

  staff_assigned  text,
  notes           text not null default '',

  -- Filled when a human approves or rejects.
  decided_at      timestamptz,
  decided_by      text,
  decision_note   text not null default '',

  created_at      timestamptz not null default now()
);

create index if not exists appointments_business_time_idx
  on public.appointments (business_id, starts_at);
create index if not exists appointments_business_status_idx
  on public.appointments (business_id, status, starts_at);
create index if not exists appointments_customer_idx
  on public.appointments (customer_id, starts_at desc);

-- ------------------------------------------------------- no double booking
-- A partial unique index: one LIVE booking per business per start time.
-- Cancelled rows are excluded, so a freed slot can be rebooked.
--
-- This is the real guard. Checking availability in Python and then inserting
-- has a gap between the two, and two customers can both pass the check. Only
-- the database can make that impossible.
create unique index if not exists appointments_no_double_booking
  on public.appointments (business_id, starts_at)
  where status in ('pending', 'confirmed');

-- ---------------------------------------------------------------------- RLS
alter table public.appointments enable row level security;

drop policy if exists appointments_member_access on public.appointments;
create policy appointments_member_access on public.appointments
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------------------- activate for the demo gym
update public.agent_subscriptions
   set is_active = true,
       settings  = '{"require_approval": true, "slot_minutes": 30, "max_days_ahead": 30}'::jsonb
 where agent_key = 'booking';

-- Confirm
select
  (select count(*) from public.appointments) as appointments,
  (select is_active from public.agent_subscriptions where agent_key = 'booking') as booking_active;
