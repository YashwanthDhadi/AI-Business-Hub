"""
STEP 55: how well does the REAL supervisor route, with the REAL model?

check_router.py proves the rules with a fake model. This one measures
judgement: given 20 labelled messages, how often does the router pick the
capabilities a person would have picked?

It calls the router model once per case (Google's quota, not OpenRouter's 50
a day). It never calls the answering model, so it costs no OpenRouter quota
at all.

A case counted "wrong" is not a failure of the system - the fallback still
answers the customer. It is a signal about the prompt or the model.

Run from backend/:  python scripts\\check_routing_live.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import time

from app.agents import supervisor
from app.agents.llm import resolve
from app.config import settings
from routing_cases import CASES, describe

# What this business has switched on. The two "future" cases are about
# capabilities NOT in here, which is the point: the router must not invent them.
ENABLED = {"customer_support", "booking", "customers", "payment", "inventory", "documents"}

# Seconds between cases. 4 keeps 20 cases under the free tier's per-minute cap.
PAUSE_SECONDS = 4.0

provider, model = resolve("router")
print(f"\n  router model : {model}  ({provider})")
print(f"  cases        : {describe()}")
print(f"  enabled      : {', '.join(sorted(ENABLED))}\n")

exact = lead_ok = invented = fell_back = 0
with_lead = sum(1 for c in CASES if c.lead)
notes: list[str] = []

for index, case in enumerate(CASES):
    # Free tiers allow roughly 15-20 calls a minute. Without this pause the
    # test rate-limits ITSELF after about 16 cases and the last few "fail"
    # for a reason that has nothing to do with routing quality.
    if index:
        time.sleep(PAUSE_SECONDS)

    history = [{"author": who, "body": text} for who, text in case.history]
    route = supervisor.route(message=case.message, enabled=ENABLED, history=history)

    got = set(route.capabilities)
    want = case.expect | {"customer_support"}

    if route.source != "model":
        fell_back += 1
        notes.append(f"  fell back  {case.message[:44]!r}  ({route.reason[:60]})")
        continue

    # An invented capability would already have been stripped by _clean(), so
    # if one ever showed up here the narrowing itself is broken.
    if not got <= set(supervisor.KNOWN_CAPABILITIES):
        invented += 1

    if got == want:
        exact += 1
        mark = "ok  "
    else:
        mark = "diff"
        notes.append(f"  {mark}       {case.message[:44]!r}\n"
                     f"               got {sorted(got)}\n"
                     f"              want {sorted(want)}")
    if case.lead and route.lead == case.lead:
        lead_ok += 1

    print(f"  {mark}  {route.lead:<16} {case.message[:52]}")

total = len(CASES)
answered = total - fell_back
print(f"\n  {'-' * 60}")
print(f"  answered by the router : {answered}/{total}   (the rest used the fallback)")
if answered:
    print(f"  exact capability match : {exact}/{answered}")
    print(f"  expected lead          : {lead_ok}/{with_lead}")
print(f"  invented a capability  : {invented}   (must be 0)")

if notes:
    print("\n  detail:")
    for line in notes:
        print(line)

print("\n  A 'diff' is a judgement call, not a broken system: the customer still")
print("  gets an answer. Only 'invented' would be a real fault, and narrowing")
print("  in supervisor._clean() prevents it.\n")

# Only a genuine narrowing failure is an error exit.
sys.exit(1 if invented else 0)
