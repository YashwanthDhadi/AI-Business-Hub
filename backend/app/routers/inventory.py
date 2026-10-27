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
