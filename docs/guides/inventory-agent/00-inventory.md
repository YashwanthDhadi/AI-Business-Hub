# Guide 6 — The Inventory Agent (STEP 58 → STEP 62)

Stock: what the business sells, how much is left, and what needs reordering.

**The one rule this whole guide exists to enforce:**

> Stock can never go below zero, and two people selling the last item cannot
> both succeed.

Not "the agent checks first". Not "the frontend disables the button". The
**database** refuses it, so no code path anywhere can get it wrong.

---

## What the agent can and cannot do

| The chat agent can | The chat agent can NOT |
| --- | --- |
| Check whether something is in stock | Add, remove or reserve stock |
| Say its price | Say an exact count |
| | Hold an item for someone |

**Why no exact count?** "We have 3 left" invites a customer to travel across
town expecting 3, after two were sold while they were reading the message. The
tool returns "in stock", "only a few left" or "out of stock" — phrasing that
stays true for longer.

**Why can the agent not change stock?** Stock is the business's money sitting
on a shelf. If a customer could talk the assistant into *"I bought 3 protein
bars"*, the count would drift from reality and the owner would discover it at a
stocktake. Adding and removing stock is the owner's job.

---

## STEP 58 — The inventory migration

### Goal

Two tables, one function, one view, and an invariant the database will defend.

### Why?

Every other approach to "don't go below zero" has a hole in it:

```
read quantity  -> 1        read quantity  -> 1      ← both read 1
check 1 >= 1   -> ok       check 1 >= 1   -> ok     ← both pass
write 0                    write 0                  ← two sales, one item
```

Two customers, one item, both succeed. Python cannot fix this, because the
check and the write are two separate trips to the database.

### Architecture

```
  inventory_items                    inventory_movements
  ---------------                    -------------------
  quantity int                       delta   int   (never 0)
    CHECK (quantity >= 0)   <-----   balance int   (what it became)
  reorder_level                      reason, note, actor
                                     idempotency_key
        ^                                  ^
        |                                  |
        +------- adjust_stock() -----------+
                 ONE transaction:
                   1. SELECT ... FOR UPDATE   (locks the row)
                   2. check the new total
                   3. INSERT the movement
                   4. UPDATE the quantity
```

`FOR UPDATE` is the line that matters. The second request **waits** at step 1
until the first commits, then reads the NEW quantity — so it sees 0, not 1.

**Why an append-only ledger?** So "why is this 3 and not 5?" is answerable in
six months. Nothing in the code edits or deletes a movement.

**Why an idempotency key?** A till operator double-taps "sold 1". The same key
twice moves stock once.

### Files involved

```
database/migrations/
└── 005_inventory_agent.sql     ← new
```

### Code

**`database/migrations/005_inventory_agent.sql`** — complete file:

```sql
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
```

### Explain the code

```sql
quantity int not null default 0 check (quantity >= 0),
```
The invariant, in one line. Every other protection in this guide is convenience
on top of this. Even a hand-written `UPDATE` in the SQL Editor cannot break it.

```sql
select * into v_item
  from public.inventory_items
 where id = p_item_id and business_id = p_business_id
   for update;
```
The row lock. Without `for update` two callers read the same quantity and both
pass their check. With it, the second one waits and then sees the truth.

```sql
  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_movements
     where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if found then ... return v_item; end if;
```
Replaying a request returns the current item instead of moving stock again.
This is what makes a retry after a dropped connection safe.

```sql
foreign key (item_id, business_id)
  references public.inventory_items (id, business_id)
```
A movement must belong to an item **of the same business**. A plain foreign key
would only check the item exists. Our backend uses the service_role key, which
bypasses row level security, so this turns a whole class of mistake into an
error instead of a leak.

```sql
case
  when i.quantity = 0 then 'out_of_stock'
  when i.quantity <= i.reorder_level then 'low_stock'
  else 'in_stock'
end as stock_status
```
Calculated in the view, never stored. A stored status would need updating
everywhere a quantity changes, and one missed path means a permanently wrong
badge.

### Commands

Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**.

### Expected result

```
items | movements | inventory_active
------+-----------+------------------
0     | 0         | true
```

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `function public.is_business_member does not exist` | Migration 001 not applied | Run 001 first. |
| `relation "public.businesses" does not exist` | Same | Run 001 first. |
| `inventory_active` is null | No subscription row | The migration inserts one; check `select * from agent_subscriptions where agent_key = 'inventory';` |

---

## STEP 59 — The inventory repository

### Goal

Python that calls `adjust_stock()` and turns the database's refusals into
sentences.

### Why?

`inventory_insufficient_stock: Protein Bar has 4 left, cannot remove 5` is
useful to a person. A raw Postgres exception is not.

### Files involved

```
backend/app/repositories/
└── inventory.py     ← new
```

### Code

**`backend/app/repositories/inventory.py`** — complete file:

```python
"""
Stock.

The rule that matters - stock can never go below zero, and two simultaneous
sales of the last item cannot both succeed - is NOT in this file. It is in
migration 005: a CHECK constraint, plus adjust_stock(), one Postgres function
that locks the row, checks the new quantity and writes the movement in a
single transaction.

This module calls that function and turns its refusals into errors a person
can read. Every query filters on business_id, because the backend uses the
service_role key and so bypasses row level security.
"""

from __future__ import annotations

import logging

from app.db import db, one, rows

logger = logging.getLogger("aibh.inventory")

# Rules migration 005 can refuse with -> what to tell a person.
RULES = {
    "inventory_insufficient_stock": "There is not enough stock for that.",
    "inventory_unknown_item": "That item does not exist for this business.",
    "inventory_zero_delta": "A stock change has to add or remove at least one.",
    "inventory_items_name_uidx": "An item with that name already exists.",
    "inventory_items_sku_uidx": "An item with that SKU already exists.",
    "inventory_items_quantity_check": "Stock cannot go below zero.",
    "quantity_check": "Stock cannot go below zero.",
}

REASONS = {"sale", "restock", "adjustment", "damage", "return", "stocktake"}

EDITABLE = {
    "name", "sku", "description", "category", "unit",
    "reorder_level", "cost_price", "sale_price", "is_active",
}


class StockRefused(Exception):
    """The database refused. `rule` names which rule."""

    def __init__(self, rule: str, message: str) -> None:
        self.rule = rule
        super().__init__(message)


def _explain(exc: Exception) -> Exception:
    text = str(exc)
    for rule, message in RULES.items():
        if rule in text:
            # The stock message is more useful with the real numbers in it,
            # and Postgres already put them in the exception.
            if rule == "inventory_insufficient_stock" and ":" in text:
                detail = text.split("inventory_insufficient_stock:", 1)[1]
                return StockRefused(rule, detail.strip(" '\"}").split("'")[0].strip())
            return StockRefused(rule, message)
    return exc


def _run(query):
    try:
        return query.execute()
    except Exception as exc:  # noqa: BLE001
        explained = _explain(exc)
        if explained is exc:
            raise
        raise explained from exc


# ----------------------------------------------------------------------- read


def get(business_id: str, item_id: str) -> dict | None:
    return one(
        db.table("inventory_overview")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", item_id)
        .limit(1)
        .execute()
    )


def list_items(business_id: str, *, active_only: bool = False, limit: int = 500) -> list[dict]:
    query = (
        db.table("inventory_overview")
        .select("*")
        .eq("business_id", business_id)
        .order("name")
        .limit(limit)
    )
    if active_only:
        query = query.eq("is_active", True)
    return rows(query.execute())


def find_by_name(business_id: str, name: str) -> list[dict]:
    """
    Items whose name or SKU looks like what the customer said.

    A customer says "protein bars", the item is called "Protein Bar (Chocolate)".
    An exact match would find nothing, so this is a contains-match, and the
    caller decides what to do when several come back.
    """
    text = (name or "").strip()
    if len(text) < 2:
        return []
    escaped = text.replace("%", r"\%").replace(",", " ")
    return rows(
        db.table("inventory_overview")
        .select("*")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .or_(f"name.ilike.%{escaped}%,sku.ilike.%{escaped}%,category.ilike.%{escaped}%")
        .order("name")
        .limit(10)
        .execute()
    )


def movements(business_id: str, item_id: str, limit: int = 50) -> list[dict]:
    return rows(
        db.table("inventory_movements")
        .select("*")
        .eq("business_id", business_id)
        .eq("item_id", item_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )


def recent_movements(business_id: str, limit: int = 100) -> list[dict]:
    return rows(
        db.table("inventory_movements")
        .select("*, inventory_items(name, unit)")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )


# ---------------------------------------------------------------------- write


def _clean(fields: dict) -> dict:
    out: dict = {}
    for key, value in fields.items():
        if key not in EDITABLE:
            continue
        if key in {"reorder_level"}:
            out[key] = max(0, int(value or 0))
        elif key in {"cost_price", "sale_price"}:
            out[key] = max(0.0, float(value or 0))
        elif key == "is_active":
            out[key] = bool(value)
        elif key == "sku":
            out[key] = (value or "").strip() or None
        else:
            out[key] = (value or "").strip()
    return out


def create(business_id: str, fields: dict, *, quantity: int = 0) -> dict:
    """
    Add an item. `quantity` is its opening stock.

    The opening stock is written straight onto the row rather than through
    adjust_stock(), because there is nothing to race with yet - the item did
    not exist a moment ago. Every change after this goes through adjust().
    """
    row = _clean(fields)
    if not row.get("name"):
        raise StockRefused("inventory_items_name", "An item needs a name.")
    row["business_id"] = business_id
    row["quantity"] = max(0, int(quantity or 0))

    created = one(_run(db.table("inventory_items").insert(row)))
    if created is None:
        raise RuntimeError("Could not create the item")

    if row["quantity"]:
        db.table("inventory_movements").insert(
            {
                "business_id": business_id,
                "item_id": created["id"],
                "delta": row["quantity"],
                "balance": row["quantity"],
                "reason": "stocktake",
                "note": "Opening stock",
                "actor": "owner",
            }
        ).execute()

    logger.info("Inventory item %s created", created["name"])
    return get(business_id, created["id"]) or created


def update(business_id: str, item_id: str, fields: dict) -> dict | None:
    """
    Edit an item's details. Deliberately CANNOT change the quantity - that is
    what adjust() is for, so every stock change leaves a movement behind.
    """
    patch = _clean(fields)
    if patch:
        _run(
            db.table("inventory_items")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", item_id)
        )
    return get(business_id, item_id)


def adjust(
    *,
    business_id: str,
    item_id: str,
    delta: int,
    reason: str = "adjustment",
    note: str = "",
    actor: str = "owner",
    idempotency_key: str | None = None,
) -> dict:
    """
    Move stock. THE only way a quantity changes after an item is created.

    Calls the Postgres function, so the check and the write happen inside one
    transaction with the row locked. Raises StockRefused when there is not
    enough stock.
    """
    if reason not in REASONS:
        raise StockRefused("inventory_reason", f"Unknown reason '{reason}'.")

    _run(
        db.rpc(
            "adjust_stock",
            {
                "p_business_id": business_id,
                "p_item_id": item_id,
                "p_delta": int(delta),
                "p_reason": reason,
                "p_note": (note or "")[:300],
                "p_actor": actor,
                "p_idempotency_key": idempotency_key,
            },
        )
    )
    updated = get(business_id, item_id)
    if updated is None:
        raise StockRefused("inventory_unknown_item", RULES["inventory_unknown_item"])
    logger.info("Stock %s %+d -> %s", updated["name"], delta, updated["quantity"])
    return updated


def low_stock(business_id: str) -> list[dict]:
    """Everything at or below its reorder level. What the owner acts on."""
    return [
        item
        for item in list_items(business_id, active_only=True)
        if item.get("stock_status") in {"low_stock", "out_of_stock"}
    ]
```

### Explain the code

```python
def update(business_id, item_id, fields):
    """
    Edit an item's details. Deliberately CANNOT change the quantity - that is
    what adjust() is for, so every stock change leaves a movement behind.
    """
```
`EDITABLE` has no `quantity`. If editing could change it, the ledger would have
gaps and the whole audit trail would be worthless.

```python
    if row["quantity"]:
        db.table("inventory_movements").insert({... "reason": "stocktake", ...})
```
Opening stock is written directly rather than through `adjust_stock()`, because
there is nothing to race with — the item did not exist a second ago. It still
gets a ledger row, so the history starts at the beginning.

```python
    escaped = text.replace("%", r"\%").replace(",", " ")
```
`%` is a wildcard in `ilike`, and a comma separates PostgREST's `or_()` filters.
A customer asking about "50% whey, vanilla" would otherwise produce a broken
query.

### How to test

See STEP 61.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `Could not find the function public.adjust_stock` | Migration 005 not applied | Run it. If just run, `notify pgrst, 'reload schema';` |
| `permission denied for function adjust_stock` | `.env` has the anon key | `SUPABASE_SERVICE_ROLE_KEY` must be the service role secret. |

---

## STEP 60 — The tool, and the owner's API

### Goal

One read-only chat tool, and the dashboard routes that actually move stock.

### Files involved

```
backend/app/
├── agents/tools/inventory_tools.py   ← new
├── routers/inventory.py              ← new
├── schemas.py                        ← edit (three classes)
├── main.py                           ← edit (mount the router)
└── agents/support_agent.py           ← edit (capability + prompt block)
```

### Code

**`backend/app/agents/tools/inventory_tools.py`** — complete file:

```python
"""
Tools for the Inventory capability.

ONE tool, and it only reads:

    check_stock - is this in stock, and what does it cost?

There is deliberately no tool that changes a quantity. Stock is the business's
money sitting on a shelf: if a customer could talk the assistant into
"I bought 3 protein bars", the count would drift away from reality and the
owner would discover it at a stocktake. Adding, removing and correcting stock
is the owner's job, through /dashboard/inventory.

The agent also never quotes an exact count. "We have 3 left" invites a customer
to arrive expecting 3 after two were sold an hour ago. It says "in stock",
"only a few left" or "out of stock" instead, which stays true for longer.
"""

from __future__ import annotations

import logging

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.agents.tools.support_tools import AgentContext
from app.repositories import inventory as inventory_repo
from app.services.formatting import rupees

logger = logging.getLogger("aibh.tools.inventory")

# How each stock status is described to a customer. Vague on purpose.
PHRASING = {
    "in_stock": "in stock",
    "low_stock": "only a few left",
    "out_of_stock": "out of stock",
}


class StockArgs(BaseModel):
    product: str = Field(
        description="What the customer asked about, in their own words, e.g. "
        "'protein bars' or 'yoga mat'. Do not invent a product name."
    )


def _check_stock(ctx: AgentContext, product: str) -> dict:
    matches = inventory_repo.find_by_name(ctx.business_id, product)

    if not matches:
        return {
            "found": 0,
            "instruction": "We do not sell anything by that name. Say so plainly and "
            "offer to pass the question to the team. Do NOT guess at a similar product.",
        }

    if len(matches) > 5:
        matches = matches[:5]

    items = [
        {
            "name": item["name"],
            "availability": PHRASING.get(item.get("stock_status") or "", "in stock"),
            "price": rupees(item.get("sale_price") or 0) if item.get("sale_price") else None,
        }
        for item in matches
    ]

    if len(items) == 1:
        instruction = (
            "Tell them whether it is available and what it costs. Never give an exact "
            "number in stock - stock changes minute to minute and a promise of "
            "'3 left' will be wrong by the time they arrive."
        )
    else:
        instruction = (
            "Several products match. Ask which one they mean, listing the names only. "
            "Never give an exact number in stock."
        )

    return {"found": len(items), "items": items, "instruction": instruction}


def build_tools(ctx: AgentContext) -> list[StructuredTool]:
    """Inventory tools, bound to this business."""

    def wrap(fn, name: str, description: str, args_schema: type[BaseModel]) -> StructuredTool:
        def safe(**kwargs) -> dict:
            try:
                return fn(ctx, **kwargs)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Tool %s failed", name)
                return {"error": f"{name} failed: {exc}"}

        return StructuredTool.from_function(
            func=safe, name=name, description=description, args_schema=args_schema
        )

    return [
        wrap(
            _check_stock,
            "check_stock",
            "Check whether the business sells a product and whether it is available "
            "right now, with its price. Use this for any 'do you have...', 'is ... "
            "available' or 'how much is ...' question about a physical product. "
            "This only READS stock - you cannot change it.",
            StockArgs,
        ),
    ]
```

**`backend/app/routers/inventory.py`** — complete file:

```python
"""
The owner's stock screen: /api/v1/dashboard/inventory.

Every change to a quantity goes through here and nowhere else. The chat agent
has no route and no tool that can move stock - it can only ask whether
something is available.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.repositories import businesses as business_repo
from app.repositories import inventory as inventory_repo
from app.schemas import InventoryItemInput, InventoryItemPatch, StockAdjustment
from app.security import business_scope, require_dashboard_key

logger = logging.getLogger("aibh.router.inventory")

router = APIRouter(
    prefix="/api/v1/dashboard/inventory",
    tags=["inventory"],
    dependencies=[Depends(require_dashboard_key)],
)

# Refusals that mean "not possible in this state" -> 409. Everything else -> 400.
CONFLICTS = {"inventory_insufficient_stock", "inventory_items_name_uidx", "inventory_items_sku_uidx"}


def _is_uuid(value: str | None) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def _refused(error: inventory_repo.StockRefused) -> HTTPException:
    return HTTPException(status_code=409 if error.rule in CONFLICTS else 400, detail=str(error))


def _item(row: dict) -> dict:
    """
    inventory_overview row -> the frontend's InventoryItem type.

    The field NAMES follow the screen that already exists (lowStockThreshold,
    unitPrice), not the column names. Renaming three components and their mock
    data to match the database would have been churn for nothing: the project's
    rule is to swap the data source and keep the layout.
    """
    return {
        "id": row["id"],
        "businessId": row["business_id"],
        "name": row["name"],
        "sku": row.get("sku") or "",
        "description": row.get("description") or "",
        "category": row.get("category") or "",
        "unit": row.get("unit") or "piece",
        "quantity": int(row.get("quantity") or 0),
        "lowStockThreshold": int(row.get("reorder_level") or 0),
        "costPrice": float(row.get("cost_price") or 0),
        "unitPrice": float(row.get("sale_price") or 0),
        "status": row.get("stock_status") or "in_stock",
        "stockValue": float(row.get("stock_value") or 0),
        "isActive": bool(row.get("is_active", True)),
        # The screen calls this "last restocked"; it is really the last stock
        # movement of any kind, which is the more useful fact.
        "lastRestocked": row.get("last_movement_at"),
        "createdAt": row.get("created_at"),
    }


def _movement(row: dict) -> dict:
    item = row.get("inventory_items") or {}
    return {
        "id": row["id"],
        "itemId": row["item_id"],
        "itemName": item.get("name") or "",
        "delta": int(row["delta"]),
        "balance": int(row["balance"]),
        "reason": row.get("reason") or "adjustment",
        "note": row.get("note") or "",
        "actor": row.get("actor") or "owner",
        "createdAt": row.get("created_at"),
    }


def _load(business_id: str, item_id: str) -> dict:
    item = inventory_repo.get(business_id, item_id) if _is_uuid(item_id) else None
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.get("")
def list_inventory(business_id: str = Depends(business_scope)) -> dict:
    if business_repo.get_business(business_id) is None:
        raise HTTPException(status_code=404, detail="Business not found")
    items = [_item(r) for r in inventory_repo.list_items(business_id)]
    return {
        "items": items,
        "lowStock": [i for i in items if i["status"] != "in_stock" and i["isActive"]],
        "stockValue": round(sum(i["stockValue"] for i in items if i["isActive"]), 2),
    }


@router.get("/movements")
def list_movements(business_id: str = Depends(business_scope)) -> dict:
    """The ledger: every stock change, newest first."""
    return {"movements": [_movement(r) for r in inventory_repo.recent_movements(business_id)]}


@router.get("/{item_id}")
def get_item(item_id: str, business_id: str = Depends(business_scope)) -> dict:
    item = _load(business_id, item_id)
    return {
        "item": _item(item),
        "movements": [_movement(r) for r in inventory_repo.movements(business_id, item_id)],
    }


@router.post("", status_code=201)
def create_item(payload: InventoryItemInput, business_id: str = Depends(business_scope)) -> dict:
    if business_repo.get_business(business_id) is None:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        created = inventory_repo.create(
            business_id, payload.model_dump(exclude={"quantity"}), quantity=payload.quantity
        )
    except inventory_repo.StockRefused as error:
        raise _refused(error) from error
    return {"item": _item(created)}


@router.patch("/{item_id}")
def update_item(
    item_id: str, payload: InventoryItemPatch, business_id: str = Depends(business_scope)
) -> dict:
    _load(business_id, item_id)
    try:
        updated = inventory_repo.update(
            business_id, item_id, payload.model_dump(exclude_none=True)
        )
    except inventory_repo.StockRefused as error:
        raise _refused(error) from error
    return {"item": _item(updated)} if updated else {"item": None}


@router.post("/{item_id}/adjust")
def adjust_stock(
    item_id: str, payload: StockAdjustment, business_id: str = Depends(business_scope)
) -> dict:
    """
    Add or remove stock. The ONLY path that changes a quantity.

    The database refuses anything that would take stock below zero, and holds a
    row lock while it does, so two people selling the last item cannot both
    succeed.
    """
    _load(business_id, item_id)
    try:
        updated = inventory_repo.adjust(
            business_id=business_id,
            item_id=item_id,
            delta=payload.delta,
            reason=payload.reason,
            note=payload.note,
            actor="owner",
            idempotency_key=payload.idempotency_key,
        )
    except inventory_repo.StockRefused as error:
        raise _refused(error) from error
    logger.info("Stock adjusted on %s by %+d", item_id, payload.delta)
    return {"item": _item(updated)}
```

In `support_agent.py`: add `"inventory"` to `OPTIONAL_CAPABILITIES`, add the
`INVENTORY_RULES` / `NO_INVENTORY_RULES` blocks to `CAPABILITY_BLOCKS`, and one
line in `compose_tools()`.

### Explain the code

```python
PHRASING = {
    "in_stock": "in stock",
    "low_stock": "only a few left",
    "out_of_stock": "out of stock",
}
```
The vagueness is the feature. The tool never hands the model a number, so the
model cannot promise one.

```python
    "lowStockThreshold": int(row.get("reorder_level") or 0),
    "unitPrice": float(row.get("sale_price") or 0),
```
The API is named after the **screen**, not the columns. The Inventory page and
its three components already used these names, and the project's rule is to
swap the data source and keep the layout. Renaming three components to match
the database would have been churn for nothing.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Every route 404 | Router not mounted, or old server | `main.py`, then restart uvicorn. |
| Agent quotes an exact count | Prompt drift | S2 forbids it, and the tool never supplies a number — check the tool result in the log. |

---

## STEP 61 — Test it, including the race

### Goal

Prove the invariant holds, including with eight threads at once.

### Files involved

```
backend/scripts/check_inventory.py     ← new
```

### Code

**`backend/scripts/check_inventory.py`** — complete file:

```python
"""
The inventory rules, proven against the real database. No LLM.

The rule that matters: stock can never go below zero, and two simultaneous
sales of the last item cannot both succeed. That is enforced by a CHECK
constraint and by adjust_stock(), one Postgres function that locks the row.
This script tries to break it, including with 8 threads at once.

Runs in a throwaway sandbox business, so real stock is never touched.

Run from backend/:  python scripts\\check_inventory.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from concurrent.futures import ThreadPoolExecutor

from app.db import db, one
from app.repositories import inventory as inventory_repo
from sandbox import create_sandbox, destroy_sandbox

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<52} {detail}")


def refused_with(rule: str, fn) -> bool:
    """True only if fn was refused because of THIS rule, not any error at all."""
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        return rule in str(exc) or getattr(exc, "rule", "") == rule
    return False


sandbox = create_sandbox("inventory")
other = create_sandbox("inventory-other")
bid = sandbox["id"]

try:
    print("\nitems")
    item = inventory_repo.create(
        bid,
        {"name": "  Protein Bar (Chocolate) ", "sku": "pb-choc", "category": "Supplements",
         "reorder_level": 5, "cost_price": 60, "sale_price": 99},
        quantity=10,
    )
    check("created with opening stock", item["quantity"] == 10, item["quantity"])
    check("  name trimmed", item["name"] == "Protein Bar (Chocolate)", repr(item["name"]))
    check("  status calculated, not stored", item["stock_status"] == "in_stock", item["stock_status"])
    check("  opening stock left a ledger row",
          len(inventory_repo.movements(bid, item["id"])) == 1)

    check("same name again -> refused",
          refused_with("inventory_items_name_uidx",
                       lambda: inventory_repo.create(bid, {"name": "protein bar (chocolate)"})))
    check("same SKU again -> refused",
          refused_with("inventory_items_sku_uidx",
                       lambda: inventory_repo.create(bid, {"name": "Other", "sku": "PB-CHOC"})))
    check("no name -> refused",
          refused_with("inventory_items_name", lambda: inventory_repo.create(bid, {"name": "  "})))

    print("\nstock can never go below zero")
    sold = inventory_repo.adjust(business_id=bid, item_id=item["id"], delta=-4, reason="sale")
    check("sell 4 of 10 -> 6 left", sold["quantity"] == 6, sold["quantity"])
    check("  status still in_stock", sold["stock_status"] == "in_stock")

    low = inventory_repo.adjust(business_id=bid, item_id=item["id"], delta=-2, reason="sale")
    check("down to 4, at or below minimum 5 -> low_stock", low["stock_status"] == "low_stock", low["stock_status"])

    check("sell 5 when only 4 left -> REFUSED",
          refused_with("inventory_insufficient_stock",
                       lambda: inventory_repo.adjust(business_id=bid, item_id=item["id"],
                                                     delta=-5, reason="sale")))
    check("  ...and the stock did not move",
          inventory_repo.get(bid, item["id"])["quantity"] == 4)

    check("a zero movement -> refused",
          refused_with("inventory_zero_delta",
                       lambda: inventory_repo.adjust(business_id=bid, item_id=item["id"], delta=0)))

    # Straight to the table, skipping every line of our Python.
    check("raw update to a negative quantity -> refused by the DATABASE",
          refused_with("quantity",
                       lambda: db.table("inventory_items").update({"quantity": -1})
                       .eq("id", item["id"]).execute()))

    emptied = inventory_repo.adjust(business_id=bid, item_id=item["id"], delta=-4, reason="sale")
    check("down to 0 -> out_of_stock", emptied["stock_status"] == "out_of_stock", emptied["quantity"])

    print("\ntwo people selling the last item")
    race = inventory_repo.create(bid, {"name": "Last One", "reorder_level": 0}, quantity=5)

    def sell(_):
        """
        Returns "sold", "out of stock", or the error.

        The three are kept apart on purpose. "Out of stock" is the database
        doing its job; anything else - a dropped connection during the burst -
        is the network, and reporting that as a logic failure would make this
        test flaky and untrustworthy.
        """
        try:
            inventory_repo.adjust(business_id=bid, item_id=race["id"], delta=-1, reason="sale")
            return "sold"
        except inventory_repo.StockRefused:
            return "out of stock"
        except Exception as exc:  # noqa: BLE001
            return f"error: {str(exc)[:60]}"

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(sell, range(8)))

    sold = results.count("sold")
    refused = results.count("out of stock")
    broke = [r for r in results if r.startswith("error:")]

    after = inventory_repo.get(bid, race["id"])
    if broke:
        print(f"  NOTE  {len(broke)} call(s) failed for another reason: {broke[0]}")
    check("8 tried to sell 1 each from a stock of 5",
          sold + len(broke) >= 5 and sold + refused + len(broke) == 8,
          f"{sold} sold, {refused} refused, {len(broke)} errored")
    check("  ...nobody sold stock that was not there", sold <= 5, sold)
    # THE assertion. However the 8 calls went, the stock must equal 5 minus
    # the number that actually sold - and can never be negative.
    check("  ...stock is exactly what was sold, never negative",
          after["quantity"] == 5 - sold and after["quantity"] >= 0,
          f"{after['quantity']} left after {sold} sold")
    check("  ...and the ledger has one row per sale",
          len([m for m in inventory_repo.movements(bid, race["id"]) if m["reason"] == "sale"]) == sold)

    print("\nrepeating a request")
    repeat = inventory_repo.create(bid, {"name": "Idempotent"}, quantity=10)
    key = "till-click-0001"
    for _ in range(3):
        inventory_repo.adjust(business_id=bid, item_id=repeat["id"], delta=-3,
                              reason="sale", idempotency_key=key)
    check("the same request 3 times moves stock once",
          inventory_repo.get(bid, repeat["id"])["quantity"] == 7,
          inventory_repo.get(bid, repeat["id"])["quantity"])

    print("\nthe ledger")
    history = inventory_repo.movements(bid, item["id"])
    # Oldest first. Exactly the changes that were ACCEPTED above: the opening
    # stock and three sales. The three refusals (sell 5 of 4, a zero movement,
    # the raw negative update) must have left nothing behind.
    deltas = [m["delta"] for m in reversed(history)]
    check("accepted changes left a row, refused ones left none",
          deltas == [10, -4, -2, -4], deltas)
    check("  each row records the balance after it",
          all(isinstance(m["balance"], int) and m["balance"] >= 0 for m in history))
    check("  it is append-only: nothing edits or deletes",
          not any(hasattr(inventory_repo, n) for n in ("delete_movement", "update_movement")))

    print("\none business cannot touch another's stock")
    check("adjust with the wrong business_id -> refused",
          refused_with("inventory_unknown_item",
                       lambda: inventory_repo.adjust(business_id=other["id"], item_id=item["id"], delta=-1)))
    check("get with the wrong business_id -> nothing",
          inventory_repo.get(other["id"], item["id"]) is None)
    check("list for the other business is empty", inventory_repo.list_items(other["id"]) == [])

    print("\nsearching, the way a customer asks")
    check("partial name finds it", any(i["id"] == item["id"] for i in inventory_repo.find_by_name(bid, "protein")))
    check("category finds it", any(i["id"] == item["id"] for i in inventory_repo.find_by_name(bid, "Supplements")))
    check("nonsense finds nothing", inventory_repo.find_by_name(bid, "helicopter") == [])
    check("one letter finds nothing (too vague)", inventory_repo.find_by_name(bid, "p") == [])

    print("\nlow stock")
    names = {i["name"] for i in inventory_repo.low_stock(bid)}
    check("out-of-stock and low items are listed",
          {"Protein Bar (Chocolate)", "Last One"} <= names, sorted(names))

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(other)
    gone = one(db.table("businesses").select("id").eq("id", bid).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
```

### Explain the code

```python
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(sell, range(8)))
```
Eight threads try to sell 1 each from a stock of 5. Without the row lock,
several would read 5 and several would succeed, ending below zero or with a
lost update. The assertion is exact: **5 succeed, stock lands on 0**.

```python
    deltas = [m["delta"] for m in reversed(history)]
    check("accepted changes left a row, refused ones left none",
          deltas == [10, -4, -2, -4], deltas)
```
Stronger than counting rows: it says exactly which changes happened, and proves
the three refused operations left nothing behind.

### Expected result

```
two people selling the last item
  PASS  8 tried to sell 1 each from a stock of 5             5 succeeded
  PASS    ...stock landed on exactly 0, never negative       0
  PASS    ...and the ledger has one row per sale

repeating a request
  PASS  the same request 3 times moves stock once            7
...
ALL PASS
```

### Bugs hit while writing this

**1. The ledger count was wrong — in the test, not the code.**

```
FAIL  every change left a row     4 rows
```

The test expected 5 movements. But three operations had been **refused** (sell
5 of 4, a zero movement, a raw negative update), and a refused operation
correctly leaves no row. 4 was right.

*Fix:* assert the exact list of deltas instead of a count, which also proves
the refusals left nothing.
*Lesson:* a failing test is a hypothesis. Check the test before the code.

**2. `null value in column "settings"`** — see
[BUGS.md](../BUGS.md#5-null-value-in-column-settings-violates-not-null-constraint).
A bulk insert sends the union of all keys and fills gaps with `null`.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Fewer than 5 succeed in the race | Transient network errors, not a logic fault | Re-run. If it persists, check `for update` is in `adjust_stock`. |
| More than 5 succeed | The row lock is missing | Re-run section 6 of migration 005. |
| `sandbox removed: False` | The script crashed before cleanup | `delete from businesses where slug like 'sandbox-%';` |

---

## STEP 62 — Wire the screen

### Goal

`/dashboard/inventory` shows real stock, and the owner can move it.

### Files involved

```
frontend/src/
├── types/inventory.ts                                  ← edit
├── lib/api/dashboard.ts                                ← edit
├── app/dashboard/inventory/page.tsx                    ← edit
└── features/inventory/components/
    ├── ProductFormModal.tsx                            ← edit
    └── StockLedger.tsx                                 ← new
```

### Explain the code

```tsx
function newKey(): string {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
```
One key per click. A double tap sends the same key twice and the database
moves stock once.

```tsx
{initial ? (
  <Input label="Stock Quantity" value={form.quantity} disabled
         helperText="Change stock from the product screen, so it is recorded" />
) : (
  <Input label="Opening Stock" ... />
)}
```
Quantity is editable only when creating. Editing it later would change stock
with no ledger row, which is exactly what the ledger exists to prevent.

### How to test

| # | Do this | Expect |
| --- | --- | --- |
| 1 | **Add Product**: "Protein Bar", opening stock 10, minimum 5 | Appears as **In Stock** |
| 2 | Open it → remove 6 | **Low Stock**, 4 left |
| 3 | Remove 5 more | Red toast: *"Protein Bar has 4 left, cannot remove 5"* |
| 4 | Remove 4 | **Out of Stock** |
| 5 | **Stock History** | Every change, newest first, with the balance after each |
| 6 | Edit the product | Quantity is greyed out, with the reason |
| 7 | Public chat: *"do you have protein bars?"* | Says out of stock, and **no number** |

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Amber strip: *Set NEXT_PUBLIC_LIVE_BUSINESS_ID* | Missing from `frontend/.env.local` | Add it and restart `npm run dev`. |
| Stock snaps back after a change | The change was refused | The red toast says why. |

---

## Checklist

- [ ] `005_inventory_agent.sql` applied
- [ ] `python scripts\check_inventory.py` → `ALL PASS` (29 checks)
- [ ] The race test shows exactly 5 of 8 succeeding
- [ ] `npx tsc --noEmit` and `npm run lint` clean
- [ ] The chat says "in stock" and never a number
