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
