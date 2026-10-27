"""
The documents rules, proven against the real database. No LLM.

What this checks:
  * full-text search finds the right document, and ranks it
  * PRIVATE documents are invisible to the chat assistant
  * a file with no extracted text is stored but not quotable
  * one business cannot search or read another's documents
  * files go into a private bucket and are reached by short-lived signed links

Runs in a throwaway sandbox business. Run from backend/:

    python scripts\\check_documents.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.tools import document_tools
from app.agents.tools.support_tools import AgentContext
from app.db import db, one
from app.repositories import documents as document_repo
from sandbox import create_sandbox, destroy_sandbox

REFUND_POLICY = (
    "Refund and cancellation policy. Memberships may be cancelled with 30 days "
    "written notice. Personal training sessions cancelled less than 24 hours "
    "before the appointment are charged in full. We do not refund joining fees."
)
PRICE_LIST = (
    "Price list 2026-27. Monthly membership 1800 rupees. Personal training pack "
    "of 12 sessions 9000 rupees. Yoga add-on 600 rupees per month."
)
STAFF_ONLY = "Staff salary review notes. Trainer salaries increase 8 percent in April."

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<54} {detail}")


def refused_with(rule: str, fn) -> bool:
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        return rule in str(exc) or getattr(exc, "rule", "") == rule
    return False


sandbox = create_sandbox("documents")
other = create_sandbox("documents-other")
bid = sandbox["id"]

try:
    print("\ndocuments")
    policy = document_repo.create(
        bid,
        {"title": "Cancellation Policy", "category": "policy", "content": REFUND_POLICY,
         "is_public": True},
    )
    prices = document_repo.create(
        bid,
        {"title": "Price List", "category": "price_list", "content": PRICE_LIST, "is_public": True},
    )
    private = document_repo.create(
        bid, {"title": "Salary Notes", "category": "other", "content": STAFF_ONLY}
    )
    check("created", bool(policy["id"]) and bool(prices["id"]))
    check("a new document is PRIVATE by default", private["is_public"] is False)
    check("same title again -> refused",
          refused_with("documents_title_uidx",
                       lambda: document_repo.create(bid, {"title": "cancellation policy"})))
    check("an unknown category -> refused",
          refused_with("documents_category_check",
                       lambda: document_repo.create(bid, {"title": "X", "category": "secret"})))
    check("no title -> refused",
          refused_with("documents_title_check", lambda: document_repo.create(bid, {"title": " "})))

    print("\nsearching")
    found = document_repo.search(bid, "cancellation refund")
    check("finds the policy by its words", found and found[0]["title"] == "Cancellation Policy",
          [d["title"] for d in found])
    check("  ...and returns the text to quote", "30 days" in (found[0]["content"] if found else ""))
    check("finds the price list by a different word",
          any(d["title"] == "Price List" for d in document_repo.search(bid, "membership price")))
    check("nonsense finds nothing", document_repo.search(bid, "helicopter maintenance") == [])
    check("punctuation only does not crash", document_repo.search(bid, "???") == [])

    print("\nprivate documents stay private")
    check("a private document is NOT searchable by the assistant",
          not any(d["title"] == "Salary Notes" for d in document_repo.search(bid, "salary trainer")))
    check("  ...but the owner can still find it",
          any(d["title"] == "Salary Notes"
              for d in document_repo.search(bid, "salary trainer", public_only=False)))
    document_repo.update(bid, private["id"], {"is_public": True})
    check("published -> now visible to the assistant",
          any(d["title"] == "Salary Notes" for d in document_repo.search(bid, "salary trainer")))
    document_repo.update(bid, private["id"], {"is_public": False})

    print("\none business cannot read another's")
    check("search in the other business finds nothing",
          document_repo.search(other["id"], "cancellation refund") == [])
    check("get with the wrong business_id -> nothing",
          document_repo.get(other["id"], policy["id"]) is None)
    check("the other business lists nothing", document_repo.list_documents(other["id"]) == [])

    print("\nthe chat tool")
    ctx = AgentContext(business_id=bid, conversation_id="dry-run", business=sandbox)
    tools = {t.name: t for t in document_tools.build_tools(ctx)}
    check("exactly one tool, and it only reads", list(tools) == ["look_up_document"], list(tools))

    answer = tools["look_up_document"].invoke({"query": "cancellation refund"})
    check("the tool finds the policy", answer.get("found", 0) >= 1, answer.get("found"))
    check("  ...and tells the model to quote it",
          "ONLY the text above" in answer.get("instruction", ""))
    check("  ...and not to offer the file", "do not offer to send" in answer.get("instruction", ""))

    hidden = tools["look_up_document"].invoke({"query": "salary trainer percent"})
    check("the tool cannot see private documents", hidden.get("found", 0) == 0, hidden.get("found"))
    nothing = tools["look_up_document"].invoke({"query": "helicopter maintenance"})
    check("nothing found -> told NOT to guess", "Do NOT guess" in nothing.get("instruction", ""))

    print("\nfiles")
    text_path = document_repo.upload_file(bid, "hours.txt", b"We open at 7 AM.", "text/plain")
    check("uploaded into the business's own folder", text_path.startswith(f"{bid}/"), text_path[:40])
    url = document_repo.signed_url(text_path, expires_in=60)
    check("download link is signed, not public", bool(url) and "token=" in (url or ""),
          (url or "")[:60])

    readable = document_repo.extract_text("hours.txt", b"We open at 7 AM.", "text/plain")
    check("text files are read, so the assistant can quote them", readable == "We open at 7 AM.")
    pdf = document_repo.extract_text("policy.pdf", b"%PDF-1.4 binary", "application/pdf")
    check("a PDF is stored but NOT read (honest limit)", pdf == "", repr(pdf))

    document_repo.remove_file(text_path)

    print("\narchiving")
    document_repo.archive(bid, prices["id"])
    check("archived -> gone from the list",
          not any(d["id"] == prices["id"] for d in document_repo.list_documents(bid)))
    check("  ...and gone from search", not any(d["title"] == "Price List"
                                               for d in document_repo.search(bid, "membership price")))
    check("  ...but the row is still there, not deleted",
          document_repo.get(bid, prices["id"]) is not None)

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(other)
    gone = one(db.table("businesses").select("id").eq("id", bid).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
