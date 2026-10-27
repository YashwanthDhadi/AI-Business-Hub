"""
Tools for the Documents capability.

ONE tool, and it only reads documents the owner has marked PUBLIC:

    look_up_document - what does our written policy actually say?

This is the same idea as search_knowledge, for longer material. The knowledge
base holds short answers the owner typed; documents hold the real price list
and the real policy. Both exist so the assistant quotes what the business
wrote instead of inventing something plausible.

Two things it deliberately cannot do:

  * see private documents. `is_public` defaults to FALSE, so a salary sheet
    uploaded by mistake is not quotable until someone decides otherwise.
  * hand out a file. It returns TEXT. Download links are signed, short-lived
    and owner-only, so a customer cannot be given a link to the raw file.
"""

from __future__ import annotations

import logging

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.agents.tools.support_tools import AgentContext
from app.repositories import documents as document_repo

logger = logging.getLogger("aibh.tools.documents")

CATEGORY_WORDS = {
    "price_list": "price list",
    "policy": "policy",
    "form": "form",
    "guide": "guide",
    "receipt": "receipt",
    "other": "document",
}


class DocumentArgs(BaseModel):
    query: str = Field(
        description="Keywords describing what the customer wants to know, in their "
        "own words plus obvious synonyms, e.g. 'refund cancellation policy'. "
        "Not a full sentence."
    )


def _look_up(ctx: AgentContext, query: str) -> dict:
    found = document_repo.search(ctx.business_id, query, limit=3, public_only=True)

    if not found:
        return {
            "found": 0,
            "instruction": "No document covers this. Do NOT guess. Say you will check "
            "with the team and offer to take their number, or call escalate_to_human.",
        }

    return {
        "found": len(found),
        "documents": [
            {
                "title": doc["title"],
                "kind": CATEGORY_WORDS.get(doc.get("category") or "other", "document"),
                "text": (doc.get("content") or "")[:900],
            }
            for doc in found
        ],
        "instruction": "Answer using ONLY the text above, and say which document it "
        "came from (for example 'our cancellation policy says...'). Do not add "
        "conditions it does not mention, and do not offer to send the file.",
    }


def build_tools(ctx: AgentContext) -> list[StructuredTool]:
    """Document tools, bound to this business."""

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
            _look_up,
            "look_up_document",
            "Search the business's written documents - price lists, policies, forms - "
            "for what they actually say. Use this for detailed questions about rules, "
            "refunds, cancellations, terms or prices where search_knowledge gave you "
            "nothing. Returns text only; you cannot send anyone a file.",
            DocumentArgs,
        ),
    ]
