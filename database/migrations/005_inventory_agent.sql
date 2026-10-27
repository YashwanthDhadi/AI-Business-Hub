-- ============================================================================
-- 005_inventory_agent.sql
-- Stock for the Inventory Agent.
-- Run once, in the Supabase SQL Editor. Safe to re-run.
--
-- THE RULE THIS FILE ENFORCES: stock can never go below zero, and two
-- simultaneous sales of the last item cannot both succeed. Neither the agent
-- nor the frontend is trusted to prevent that - the database does.
-- ============================================================================

-- ------------------------------------------------------------------- items
create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,

  name          text not null check (char_length(btrim(name)) between 1 and 160),
  sku           text,
  description   text not null default '',
  category      text not null default '',
  -- "piece", "kg", "litre", "box". Display only.
  unit          text not null default 'piece',

  -- THE invariant. Not a default, not a Python check: a constraint.
  quantity      int not null default 0 check (quantity >= 0),
  -- Below this, the dashboard calls it low stock and the agent says "few left".
  reorder_level int not null default 0 check (reorder_level >= 0),

  cost_price    numeric(12,2) not null default 0 check (cost_price >= 0),
  sale_price    numeric(12,2) not null default 0 check (sale_price >= 0),

  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists inventory_items_business_idx
  on public.inventory_items (business_id, is_active, name);

-- One SKU per business, when a SKU is given at all.
create unique index if not exists inventory_items_sku_uidx
  on public.inventory_items (business_id, lower(btrim(sku)))
  where sku is not null and btrim(sku) <> '';

-- Two items with the same name in one business is almost always a mistake.
create unique index if not exists inventory_items_name_uidx
  on public.inventory_items (business_id, lower(btrim(name)));

-- Lets other tables reference (id, business_id) as a pair, so a movement can
-- never point at another business's item. Same idea as customers in 003.
do $$ begin
  alter table public.inventory_items add constraint inventory_items_id_business_key
    unique (id, business_id);
exception when duplicate_object or duplicate_table then null; end $$;

alter table public.inventory_items enable row level security;
drop policy if exists inventory_items_member_access on public.inventory_items;
create policy inventory_items_member_access on public.inventory_items
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- --------------------------------------------------------------- movements
-- Append-only. Every change to a quantity leaves a row here, so "why is this
-- 3 and not 5?" is always answerable. Nothing ever updates or deletes these.
create table if not exists public.inventory_movements (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  item_id     uuid not null,

  -- Negative takes stock out, positive puts it in. Never zero.
  delta       int not null check (delta <> 0),
  -- What the quantity became. Stored so the ledger reads on its own.
  balance     int not null check (balance >= 0),

  reason      text not null default 'adjustment'
                check (reason in ('sale', 'restock', 'adjustment', 'damage', 'return', 'stocktake')),
  note        text not null default '',
  actor       text not null default 'owner' check (actor in ('owner', 'agent', 'system')),

  -- Set by the caller to make a repeated request harmless. Two clicks on
  -- "sold 1" with the same key change the stock once.
  idempotency_key text,

  created_at  timestamptz not null default now(),

  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete cascade
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (business_id, item_id, created_at desc);

create unique index if not exists inventory_movements_idempotency_uidx
  on public.inventory_movements (business_id, idempotency_key)
  where idempotency_key is not null;

alter table public.inventory_movements enable row level security;
drop policy if exists inventory_movements_member_access on public.inventory_movements;
create policy inventory_movements_member_access on public.inventory_movements
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ------------------------------------------- the ONLY way stock changes
-- One function, one transaction. It locks the row, checks the new quantity,
-- writes the movement and updates the item together - so two requests for the
-- last item cannot both succeed.
create or replace function public.adjust_stock(
  p_business_id     uuid,
  p_item_id         uuid,
  p_delta           int,
  p_reason          text default 'adjustment',
  p_note            text default '',
  p_actor           text default 'owner',
  p_idempotency_key text default null
)
returns public.inventory_items
language plpgsql
as $$
declare
  v_item    public.inventory_items;
  v_new     int;
  v_existing public.inventory_movements;
begin
  if p_delta = 0 then
    raise exception 'inventory_zero_delta: a movement must add or remove at least one.';
  end if;

  -- Replaying the same request returns the current item instead of moving
  -- stock twice.
  if p_idempotency_key is not null then
    select * into v_existing
      from public.inventory_movements
     where business_id = p_business_id and idempotency_key = p_idempotency_key
     limit 1;
    if found then
      select * into v_item from public.inventory_items
       where id = v_existing.item_id and business_id = p_business_id;
      return v_item;
    end if;
  end if;

  -- FOR UPDATE takes a row lock: a second call waits here until this one
  -- commits, then reads the NEW quantity. Without it, both could read 1 and
  -- both could sell it.
  select * into v_item
    from public.inventory_items
   where id = p_item_id and business_id = p_business_id
     for update;

  if not found then
    raise exception 'inventory_unknown_item: no item % for this business.', p_item_id;
  end if;

  v_new := v_item.quantity + p_delta;

  if v_new < 0 then
    raise exception 'inventory_insufficient_stock: % has % left, cannot remove %.',
      v_item.name, v_item.quantity, abs(p_delta);
  end if;

  insert into public.inventory_movements
    (business_id, item_id, delta, balance, reason, note, actor, idempotency_key)
  values
    (p_business_id, p_item_id, p_delta, v_new, coalesce(p_reason, 'adjustment'),
     coalesce(p_note, ''), coalesce(p_actor, 'owner'), p_idempotency_key);

  update public.inventory_items
     set quantity = v_new, updated_at = now()
   where id = p_item_id and business_id = p_business_id
   returning * into v_item;

  return v_item;
end;
$$;

-- Only the backend (service role) may move stock. The public anon key must
-- not even be able to try.
revoke execute on function public.adjust_stock(uuid, uuid, int, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, uuid, int, text, text, text, text)
  to service_role;

-- ------------------------------------------------------------ the view
-- status is CALCULATED, never stored, so it can never be out of date.
drop view if exists public.inventory_overview;
create view public.inventory_overview
with (security_invoker = true) as
select
  i.*,
  case
    when i.quantity = 0 then 'out_of_stock'
    when i.quantity <= i.reorder_level then 'low_stock'
    else 'in_stock'
  end as stock_status,
  (i.quantity * i.cost_price) as stock_value,
  (select max(m.created_at) from public.inventory_movements m
    where m.item_id = i.id and m.business_id = i.business_id) as last_movement_at
from public.inventory_items i;

-- --------------------------------------------- switch it on for the demo gym
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
select id, 'inventory', true, '{"low_stock_alerts": true}'::jsonb
  from public.businesses
on conflict (business_id, agent_key) do update set is_active = true;

notify pgrst, 'reload schema';

select
  (select count(*) from public.inventory_items)  as items,
  (select count(*) from public.inventory_movements) as movements,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'inventory')                as inventory_active;
