-- ============================================================================
-- 004_payments_agent.sql
-- Invoices and UPI payments for the Payments Agent.
-- Run once, in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

-- ------------------------------------------------ 1. bookings, as a pair
-- Lets an invoice point at (booking id, business id) together, so it can never
-- reference another business's booking. Same idea as customers in 003.
do $$ begin
  alter table public.appointments add constraint appointments_id_business_key
    unique (id, business_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- ------------------------------------------ 2. one counter per financial year
create table if not exists public.invoice_counters (
  business_id    uuid not null references public.businesses (id) on delete cascade,
  financial_year text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  last_number    int  not null default 0 check (last_number >= 0),
  primary key (business_id, financial_year)
);

alter table public.invoice_counters enable row level security;

drop policy if exists invoice_counters_member_access on public.invoice_counters;
create policy invoice_counters_member_access on public.invoice_counters
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------------------------------- 3. invoices
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  customer_id     uuid not null,
  appointment_id  uuid,
  -- The chat to post the invoice, reminders and the receipt into.
  conversation_id uuid references public.conversations (id) on delete set null,

  invoice_number  text not null,
  financial_year  text not null,
  sequence_number int  not null check (sequence_number > 0),

  -- A SNAPSHOT of what was billed: [{description, quantity, unit_price, total}].
  -- Changing a service's price later does not change an issued invoice.
  items    jsonb not null
             check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  amount   numeric(12,2) not null check (amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),

  status   text not null default 'pending'
             check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  due_date date not null,
  notes    text not null default '',

  -- The pay page's address. 32 random hex characters: the URL is the permission.
  public_token text not null default replace(gen_random_uuid()::text, '-', ''),

  -- The CUSTOMER says they paid (chat or pay page). A claim, not proof.
  customer_reported_at timestamptz,
  customer_reference   text check (customer_reference is null or char_length(customer_reference) <= 60),

  -- The OWNER saw the money arrive.
  paid_at        timestamptz,
  paid_method    text,
  paid_reference text not null default '',

  cancelled_at  timestamptz,
  cancel_reason text not null default '',
  refunded_at   timestamptz,
  refund_note   text not null default '',

  last_reminded_at timestamptz,
  created_at       timestamptz not null default now(),

  constraint invoices_number_unique   unique (business_id, invoice_number),
  constraint invoices_sequence_unique unique (business_id, financial_year, sequence_number),
  constraint invoices_token_unique    unique (public_token),

  -- GST allows at most 16 characters: INV/2026-27/0001 is exactly 16.
  constraint invoices_number_length check (char_length(invoice_number) <= 16),

  constraint invoices_paid_method_values
    check (paid_method is null or paid_method in ('upi', 'cash', 'card', 'bank_transfer')),

  -- "Paid" (and later "refunded") always says when and how.
  constraint invoices_paid_needs_method
    check ((status in ('paid', 'refunded')) = (paid_at is not null and paid_method is not null)),
  constraint invoices_cancel_stamped check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint invoices_refund_stamped check ((status = 'refunded') = (refunded_at is not null)),

  -- The customer and the booking must belong to the SAME business as the invoice.
  constraint invoices_customer_same_business
    foreign key (customer_id, business_id) references public.customers (id, business_id),
  constraint invoices_booking_same_business
    foreign key (appointment_id, business_id) references public.appointments (id, business_id)
);

create index if not exists invoices_business_created_idx
  on public.invoices (business_id, created_at desc);
create index if not exists invoices_customer_idx
  on public.invoices (business_id, customer_id);

-- One LIVE invoice per booking. A cancelled one does not count, so you can
-- cancel a wrong invoice and issue the right one.
create unique index if not exists invoices_one_live_per_booking
  on public.invoices (appointment_id)
  where appointment_id is not null and status in ('pending', 'paid');

alter table public.invoices enable row level security;

drop policy if exists invoices_member_access on public.invoices;
create policy invoices_member_access on public.invoices
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------ 4. issued invoices never change
create or replace function public.invoices_guard()
returns trigger
language plpgsql
as $$
begin
  if new.business_id     <> old.business_id
  or new.customer_id     <> old.customer_id
  or new.appointment_id  is distinct from old.appointment_id
  or new.invoice_number  <> old.invoice_number
  or new.financial_year  <> old.financial_year
  or new.sequence_number <> old.sequence_number
  or new.items           <> old.items
  or new.amount          <> old.amount
  or new.due_date        <> old.due_date
  or new.public_token    <> old.public_token
  or new.created_at      <> old.created_at then
    raise exception 'invoices_immutable: invoice % is issued and cannot be edited. Cancel it and issue a new one.',
      old.invoice_number;
  end if;

  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('paid', 'cancelled'))
    or (old.status = 'paid'    and new.status = 'refunded')
  ) then
    raise exception 'invoices_bad_transition: invoice % cannot go from % to %.',
      old.invoice_number, old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard
  before update on public.invoices
  for each row execute function public.invoices_guard();

-- ------------------------------- 5. the booking's payment status follows
-- appointments.payment_status (from 002) is now DERIVED from its invoice, by
-- the database, so no code path can forget to update it.
create or replace function public.invoices_sync_booking()
returns trigger
language plpgsql
as $$
begin
  if new.appointment_id is not null then
    update public.appointments
       set payment_status = case new.status
                              when 'paid'     then 'paid'::payment_state
                              when 'refunded' then 'refunded'::payment_state
                              else 'unpaid'::payment_state
                            end
     where id = new.appointment_id
       and business_id = new.business_id;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_sync_booking on public.invoices;
create trigger invoices_sync_booking
  after insert or update of status on public.invoices
  for each row execute function public.invoices_sync_booking();

-- ------------------------------------ 6. the ONLY way an invoice is issued
create or replace function public.create_invoice(
  p_business_id     uuid,
  p_customer_id     uuid,
  p_items           jsonb,
  p_due_date        date,
  p_appointment_id  uuid default null,
  p_conversation_id uuid default null,
  p_notes           text default '',
  p_prefix          text default 'INV'
)
returns public.invoices
language plpgsql
as $$
declare
  v_today  date;
  v_start  int;
  v_fy     text;
  v_seq    int;
  v_item   jsonb;
  v_desc   text;
  v_qty    int;
  v_price  numeric(12,2);
  v_items  jsonb := '[]'::jsonb;
  v_amount numeric(12,2) := 0;
  v_row    public.invoices;
begin
  -- "Today" in the business's own timezone, not UTC.
  select (now() at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date
    into v_today
    from public.businesses b
   where b.id = p_business_id;

  if v_today is null then
    raise exception 'invoices_unknown_business: no business %', p_business_id;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invoices_no_items: an invoice needs at least one item.';
  end if;

  -- Re-build every item and add them up HERE. Any total the caller sent is ignored.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_desc  := btrim(coalesce(v_item ->> 'description', ''));
    v_qty   := coalesce((v_item ->> 'quantity')::int, 1);
    v_price := coalesce((v_item ->> 'unit_price')::numeric, -1);
    if v_desc = '' or v_qty < 1 or v_price < 0 then
      raise exception 'invoices_bad_item: every item needs a description, a quantity of at least 1 and a price of 0 or more.';
    end if;
    v_items := v_items || jsonb_build_object(
      'description', v_desc, 'quantity', v_qty, 'unit_price', v_price, 'total', v_qty * v_price
    );
    v_amount := v_amount + v_qty * v_price;
  end loop;

  if p_due_date is null or p_due_date < v_today then
    raise exception 'invoices_due_in_past: the due date cannot be before today (%).', v_today;
  end if;

  -- India's financial year runs 1 April - 31 March. 26 Sep 2026 is FY 2026-27.
  v_start := extract(year from v_today)::int - case when extract(month from v_today) < 4 then 1 else 0 end;
  v_fy    := v_start::text || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');

  -- The row lock taken here makes a second, simultaneous call WAIT, then get
  -- the next number. If anything below fails, this bump is rolled back too.
  insert into public.invoice_counters as c (business_id, financial_year, last_number)
  values (p_business_id, v_fy, 1)
  on conflict (business_id, financial_year)
  do update set last_number = c.last_number + 1
  returning c.last_number into v_seq;

  insert into public.invoices (
    business_id, customer_id, appointment_id, conversation_id,
    invoice_number, financial_year, sequence_number,
    items, amount, due_date, notes
  )
  values (
    p_business_id, p_customer_id, p_appointment_id, p_conversation_id,
    upper(coalesce(nullif(btrim(p_prefix), ''), 'INV')) || '/' || v_fy || '/' || lpad(v_seq::text, 4, '0'),
    v_fy, v_seq,
    v_items, v_amount, p_due_date, coalesce(p_notes, '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Supabase exposes public functions to the API. Only the backend (service
-- role) may issue invoices; the public anon key must not even try.
revoke execute on function public.create_invoice(uuid, uuid, jsonb, date, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, uuid, jsonb, date, uuid, uuid, text, text)
  to service_role;

-- ------------------------------------------------ 7. switch it on for the gym
-- upi_id stays empty until the owner enters theirs on the Payments screen.
update public.agent_subscriptions
   set is_active = true,
       settings  = '{"upi_id": null, "payee_name": null, "invoice_prefix": "INV", "due_days": 7}'::jsonb
                   || coalesce(settings, '{}'::jsonb)
 where agent_key = 'payment';

notify pgrst, 'reload schema';

-- Confirm
select
  (select count(*) from public.invoices)                    as invoices,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'payment')                             as payment_active,
  (select settings from public.agent_subscriptions
    where agent_key = 'payment' limit 1)                     as payment_settings;
