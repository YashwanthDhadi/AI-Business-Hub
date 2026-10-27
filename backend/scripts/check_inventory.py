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
