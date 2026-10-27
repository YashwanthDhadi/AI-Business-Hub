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
