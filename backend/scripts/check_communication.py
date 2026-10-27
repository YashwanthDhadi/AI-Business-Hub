"""
The campaign rules, proven against the real database and the real HTTP API.
No LLM.

The two rules that matter:
  1. NOTHING sends without an owner's approval.
  2. One customer receives one message per campaign, EVER - even if Send is
     pressed twice.

Also checked: people who opted out are skipped, people with no chat thread are
skipped with a reason, an approved message cannot be edited, and one business
cannot see or send another's campaigns.

Needs the backend running. Runs in a throwaway sandbox business.

    python scripts\\check_communication.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.config import settings
from app.db import db, one, rows
from app.repositories import campaigns as campaign_repo
from app.repositories import conversations
from app.repositories import customers as customer_repo
from sandbox import create_sandbox, destroy_sandbox

API = "http://127.0.0.1:8000/api/v1/dashboard/communication"

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<54} {detail}")


def detail_of(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", ""))[:70]
    except ValueError:
        return response.text[:70]


def messages_in(bid: str, conversation_id: str) -> list[str]:
    return [m["body"] for m in conversations.messages_for(bid, conversation_id)]


sandbox = create_sandbox("communication")
other = create_sandbox("communication-other")
bid = sandbox["id"]
client = httpx.Client(
    timeout=60, headers={"X-Dashboard-Key": settings.dashboard_api_key}, params={"business_id": bid}
)

try:
    # ---- three customers, deliberately different ---------------------------------
    chatty = customer_repo.upsert_from_chat(business_id=bid, name="Chatty", phone="9000000801")
    optout = customer_repo.upsert_from_chat(business_id=bid, name="Opted Out", phone="9000000802")
    silent = customer_repo.upsert_from_chat(business_id=bid, name="Never Chatted", phone="9000000803")

    chat_a = conversations.create(bid, channel="web")
    conversations.attach_customer(bid, chat_a["id"], chatty["id"])
    chat_b = conversations.create(bid, channel="web")
    conversations.attach_customer(bid, chat_b["id"], optout["id"])
    customer_repo.set_marketing_consent(
        business_id=bid, customer_id=optout["id"], consent="opted_out", source="chat"
    )
    # `silent` gets no conversation at all.

    print("\nplanning who receives it")
    made = client.post(API, json={"name": "October offer", "body": "20% off yoga this month.",
                                  "audience": "all"})
    campaign = made.json().get("campaign", {}) if made.status_code == 201 else {}
    plan = made.json().get("plan", {}) if made.status_code == 201 else {}
    cid = campaign.get("id", "")
    check("created as a draft -> 201", made.status_code == 201 and campaign.get("status") == "draft",
          campaign.get("status"))
    check("3 customers chosen", plan.get("total") == 3, plan)
    check("  ...1 will actually receive it", plan.get("will_receive") == 1, plan.get("will_receive"))
    check("  ...2 skipped, with reasons", plan.get("skipped") == 2, plan.get("skipped"))

    listed = client.get(f"{API}/{cid}").json()
    reasons = {r["customerName"]: r["reason"] for r in listed["recipients"]}
    check("  opted-out person is skipped by name", "offers" in reasons.get("Opted Out", ""),
          reasons.get("Opted Out"))
    check("  person with no chat is skipped by name", "never chatted" in reasons.get("Never Chatted", "").lower(),
          reasons.get("Never Chatted"))

    print("\nnothing sends without approval")
    early = client.post(f"{API}/{cid}/send")
    check("send a draft -> 409", early.status_code == 409, detail_of(early))
    check("  ...and nobody was messaged", campaign["body"] not in messages_in(bid, chat_a["id"]))

    client.post(f"{API}/{cid}/submit")
    pending = client.get(f"{API}/{cid}").json()["campaign"]
    check("submitted -> pending_approval", pending["status"] == "pending_approval", pending["status"])
    still = client.post(f"{API}/{cid}/send")
    check("send while only submitted -> 409", still.status_code == 409, detail_of(still))

    approved = client.post(f"{API}/{cid}/approve", json={"approved_by": "owner"})
    body = approved.json().get("campaign", {})
    check("approve -> 200", approved.status_code == 200 and body.get("status") == "approved")
    check("  ...and it records WHO approved it", body.get("approvedBy") == "owner", body.get("approvedBy"))
    check("approve twice -> 409", client.post(f"{API}/{cid}/approve", json={}).status_code == 409)

    print("\nan approved message cannot be changed")
    edited = client.patch(f"{API}/{cid}", json={"body": "Actually 90% off everything."})
    check("edit after approval -> 409", edited.status_code == 409, detail_of(edited))
    check("  ...the message is untouched",
          client.get(f"{API}/{cid}").json()["campaign"]["body"] == "20% off yoga this month.")

    print("\nsending")
    sent = client.post(f"{API}/{cid}/send")
    result = sent.json() if sent.status_code == 200 else {}
    check("send -> 200", sent.status_code == 200, detail_of(sent))
    check("  reached exactly 1 person", result.get("sent") == 1, result.get("sent"))
    check("  the message really is in their chat",
          "20% off yoga this month." in messages_in(bid, chat_a["id"]))
    check("  the opted-out person got NOTHING",
          "20% off yoga this month." not in messages_in(bid, chat_b["id"]))

    print("\npressing Send twice")
    before = len(messages_in(bid, chat_a["id"]))
    again = client.post(f"{API}/{cid}/send")
    after = len(messages_in(bid, chat_a["id"]))
    check("second send -> 409 (already sent)", again.status_code == 409, detail_of(again))
    check("  ...and nobody received it twice", after == before, f"{before} -> {after}")

    # Straight at the repository, skipping the route's status check entirely.
    claimed_again = campaign_repo.claim_recipient(
        bid, [r["id"] for r in campaign_repo.recipients(bid, cid) if r["status"] == "sent"][0]
    )
    check("re-claiming a delivered recipient -> refused", claimed_again is None)

    print("\nthe duplicate guard is in the DATABASE")
    row = rows(db.table("campaign_recipients").select("*").eq("campaign_id", cid).limit(1).execute())[0]
    try:
        db.table("campaign_recipients").insert(
            {"business_id": bid, "campaign_id": cid, "customer_id": row["customer_id"]}
        ).execute()
        duplicated = "INSERTED (wrong)"
    except Exception as exc:  # noqa: BLE001
        duplicated = "refused" if "23505" in str(exc) else f"other error: {str(exc)[:40]}"
    check("a second row for the same person -> refused", duplicated == "refused", duplicated)

    print("\naudiences")
    unpaid = client.post(API, json={"name": "Unpaid", "body": "A reminder about your invoice.",
                                    "audience": "unpaid_invoices"})
    check("an audience with nobody in it -> 0 recipients",
          unpaid.json().get("plan", {}).get("total") == 0, unpaid.json().get("plan"))
    custom = client.post(API, json={"name": "Just one", "body": "Hello there, one person only.",
                                    "audience": "custom", "customer_ids": [chatty["id"]]})
    check("a custom audience picks exactly those people",
          custom.json().get("plan", {}).get("total") == 1, custom.json().get("plan"))

    print("\none business cannot touch another's")
    foreign = client.get(f"{API}/{cid}", params={"business_id": other["id"]})
    check("read another business's campaign -> 404", foreign.status_code == 404, detail_of(foreign))
    hijack = client.post(f"{API}/{cid}/cancel", params={"business_id": other["id"]})
    check("cancel another business's campaign -> 404", hijack.status_code == 404)
    check("  ...and it is still 'sent'",
          client.get(f"{API}/{cid}").json()["campaign"]["status"] == "sent")
    check("their campaign list is empty",
          client.get(API, params={"business_id": other["id"]}).json()["campaigns"] == [])
    naked = httpx.get(API, params={"business_id": bid}, timeout=30)
    check("no dashboard key -> 401", naked.status_code == 401)

    print("\nhonesty about channels")
    channels = client.get(API).json()
    check("only 'chat' is offered", channels.get("channels") == ["chat"], channels.get("channels"))
    check("  ...and the API says why", "free tier" in channels.get("channelNote", ""))

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(other)
    gone = one(db.table("businesses").select("id").eq("id", bid).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
