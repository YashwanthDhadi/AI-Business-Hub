-- ============================================================================
-- 008_reports_agent.sql
-- Reporting for the Reports Agent.
-- Run once, in the Supabase SQL Editor. Safe to re-run.
--
-- NO NEW TABLES. A report is a question about data that already exists, so
-- this file is views and one function. Storing daily totals would mean a
-- nightly job, a scheduler, and numbers that go stale when a booking is
-- cancelled after the job ran. Postgres can add up a few thousand rows in
-- milliseconds, so it does it on demand.
--
-- The LLM is NOT used to calculate anything here. SQL produces the numbers;
-- the agent may summarise them in a sentence afterwards. A model that does
-- arithmetic is a model that will eventually get arithmetic wrong.
-- ============================================================================

-- --------------------------------------------------- one row per day, per business
-- Dates are the BUSINESS's local dates, not UTC. A 7 AM IST class is 01:30 UTC
-- and belongs to the day the owner thinks it does.
drop view if exists public.report_daily;
create view public.report_daily
with (security_invoker = true) as
with days as (
  select b.id as business_id,
         coalesce(b.timezone, 'Asia/Kolkata') as tz,
         generate_series(
           (now() at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date - interval '89 days',
           (now() at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date,
           interval '1 day'
         )::date as day
  from public.businesses b
)
select
  d.business_id,
  d.day,
  coalesce(c.conversations, 0)    as conversations,
  coalesce(bk.bookings, 0)        as bookings,
  coalesce(bk.completed, 0)       as completed_bookings,
  coalesce(bk.cancelled, 0)       as cancelled_bookings,
  coalesce(inv.invoices, 0)       as invoices_issued,
  coalesce(inv.collected, 0)      as collected,
  coalesce(cust.new_customers, 0) as new_customers
from days d
left join lateral (
  select count(*) as conversations
  from public.conversations x
  where x.business_id = d.business_id
    and (x.created_at at time zone d.tz)::date = d.day
) c on true
left join lateral (
  select
    count(*)                                        as bookings,
    count(*) filter (where a.status = 'completed')  as completed,
    count(*) filter (where a.status = 'cancelled')  as cancelled
  from public.appointments a
  where a.business_id = d.business_id
    and (a.starts_at at time zone d.tz)::date = d.day
) bk on true
left join lateral (
  select
    count(*) filter (where (i.created_at at time zone d.tz)::date = d.day) as invoices,
    -- Money is counted on the day it was MARKED PAID, which is the day the
    -- owner saw it arrive - not the day the invoice was written.
    coalesce(sum(i.amount) filter (
      where i.status = 'paid' and (i.paid_at at time zone d.tz)::date = d.day
    ), 0) as collected
  from public.invoices i
  where i.business_id = d.business_id
) inv on true
left join lateral (
  select count(*) as new_customers
  from public.customers cu
  where cu.business_id = d.business_id
    and (cu.created_at at time zone d.tz)::date = d.day
) cust on true;

-- ------------------------------------------------------- headline numbers
-- Everything the dashboard's summary cards need, for a window of N days.
create or replace function public.report_summary(
  p_business_id uuid,
  p_days        int default 30
)
returns table (
  days                int,
  conversations       bigint,
  bookings            bigint,
  completed_bookings  bigint,
  cancelled_bookings  bigint,
  invoices_issued     bigint,
  collected           numeric,
  outstanding         numeric,
  new_customers       bigint,
  active_customers    bigint,
  low_stock_items     bigint
)
language sql
stable
as $$
  with window_days as (
    select greatest(1, least(coalesce(p_days, 30), 90)) as n
  ),
  span as (
    select d.* from public.report_daily d, window_days w
    where d.business_id = p_business_id
      and d.day > (current_date - w.n)
  )
  select
    (select n from window_days)::int,
    coalesce(sum(s.conversations), 0)::bigint,
    coalesce(sum(s.bookings), 0)::bigint,
    coalesce(sum(s.completed_bookings), 0)::bigint,
    coalesce(sum(s.cancelled_bookings), 0)::bigint,
    coalesce(sum(s.invoices_issued), 0)::bigint,
    coalesce(sum(s.collected), 0)::numeric,
    -- Outstanding is a CURRENT figure, not a windowed one: what is owed right
    -- now, whenever it was invoiced.
    (select coalesce(sum(i.amount), 0) from public.invoices i
      where i.business_id = p_business_id and i.status = 'pending')::numeric,
    coalesce(sum(s.new_customers), 0)::bigint,
    (select count(*) from public.customer_overview c
      where c.business_id = p_business_id and c.status = 'active')::bigint,
    (select count(*) from public.inventory_overview v
      where v.business_id = p_business_id and v.stock_status <> 'in_stock' and v.is_active)::bigint
  from span s;
$$;

revoke execute on function public.report_summary(uuid, int) from public, anon, authenticated;
grant execute on function public.report_summary(uuid, int) to service_role;

-- --------------------------------------------------------- what sells most
create or replace function public.report_top_services(
  p_business_id uuid,
  p_days        int default 30,
  p_limit       int default 5
)
returns table (service_name text, bookings bigint, revenue numeric)
language sql
stable
as $$
  select
    a.service_name,
    count(*)::bigint as bookings,
    -- The price stored ON the booking, so an old booking keeps its old price.
    coalesce(sum(a.price) filter (where a.status in ('confirmed', 'completed')), 0)::numeric
      as revenue
  from public.appointments a
  where a.business_id = p_business_id
    and a.starts_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
    and a.status <> 'cancelled'
  group by a.service_name
  -- Ordered by POSITION, not by name. In a "returns table" function the output
  -- column names (service_name, bookings, revenue) are not in scope in ORDER BY,
  -- so "order by revenue desc" fails with: column "revenue" does not exist.
  order by 2 desc, 3 desc
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

revoke execute on function public.report_top_services(uuid, int, int) from public, anon, authenticated;
grant execute on function public.report_top_services(uuid, int, int) to service_role;

-- --------------------------------------------- switch it on for the demo gym
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
select id, 'reports', true, '{"default_days": 30}'::jsonb
  from public.businesses
on conflict (business_id, agent_key) do update set is_active = true;

notify pgrst, 'reload schema';

select
  (select count(*) from public.report_daily) as daily_rows,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'reports') as reports_active;
