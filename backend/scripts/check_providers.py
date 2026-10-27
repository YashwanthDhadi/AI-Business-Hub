"""
STEP 51: verify the models and providers we actually have, before choosing one
for the supervisor.

For every candidate model it measures four things:

  1. reachable      - the key works and the model id exists
  2. tool calling   - it really emits a tool call (the agent loop needs this)
  3. latency        - median of three small calls
  4. routing        - accuracy on scripts/routing_cases.py, the job the
                      supervisor will actually do

Nothing is switched over here. This produces the numbers that justify the
choice in STEP 52.

    python scripts\\check_providers.py              # all candidates
    python scripts\\check_providers.py --quick      # skip the routing test
    python scripts\\check_providers.py --only gemini-3.5-flash-lite

Uses: 1 tool-call + 3 latency + one call per routing case, per model. The
Gemini models draw on Google's quota, not OpenRouter's 50 a day.
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
import re
import statistics
import time

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from app.config import settings
from routing_cases import CASES, KNOWN, describe

# ---------------------------------------------------------------- candidates
# (label, provider, model id). Providers both speak the OpenAI API format, so
# one class reaches both - only the key and base_url change.
CANDIDATES = [
    ("openrouter (in use today)", "openrouter", settings.llm_model),
    ("google", "google", "gemini-3.5-flash-lite"),
    ("google", "google", "gemini-3.1-flash-lite"),
]

PROVIDERS = {
    "openrouter": (settings.openrouter_api_key, settings.llm_base_url),
    "google": (settings.google_api_key, settings.google_base_url),
}

# A first draft. STEP 53 owns the real one; this is only to compare models
# fairly, with every model getting exactly the same instructions.
ROUTER_PROMPT = """You route a customer's chat message to the right part of a small business assistant.

The ONLY capabilities that exist are:
- customer_support: questions about the business, opening hours, prices, policies, complaints, anything needing a human
- booking: appointments - checking free times, booking, cancelling
- customers: things the customer tells you about themselves, preferences, and whether they want marketing messages
- payment: invoices, what someone owes, and customers saying they have paid

Reply with ONLY a JSON object, no other text:
{"capabilities": ["..."], "lead": "..."}

Rules:
- Use only the capability names listed above. Never invent one.
- List every capability the message needs. Usually one, sometimes two.
- "lead" is the single capability that should answer, and must be in your list.
- If the message needs something this business cannot do, use customer_support.
- If the message is short or unclear, use the previous turns to work out what it is about."""


def build(provider: str, model: str, temperature: float = 0) -> ChatOpenAI:
    key, base_url = PROVIDERS[provider]
    if not key:
        raise RuntimeError(f"No API key configured for {provider}")
    # 90s: a free endpoint's FIRST call can be very slow while it warms up.
    # 12 s was seen on Gemini here, and 45 s was not always enough.
    return ChatOpenAI(model=model, api_key=key, base_url=base_url,
                      temperature=temperature, max_retries=2, timeout=90)


@tool
def get_membership_price(plan: str) -> str:
    """Look up the price of a gym membership plan."""
    return f"{plan} costs 1800 rupees"


def parse_route(text: str) -> dict | None:
    """
    Read the model's answer as JSON, forgivingly.

    Models wrap JSON in ```json fences, or add a sentence before it. The real
    supervisor needs the same tolerance, so measure with it here.
    """
    cleaned = re.sub(r"^```(?:json)?|```$", "", (text or "").strip(), flags=re.M).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", cleaned, re.S)  # first {...} anywhere
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


def measure(label: str, provider: str, model: str, quick: bool) -> dict:
    result: dict = {"label": label, "provider": provider, "model": model}
    print(f"\n{'=' * 78}\n  {model}   ({label})\n{'=' * 78}")

    # ---- 1. reachable -------------------------------------------------------
    try:
        llm = build(provider, model)
        started = time.perf_counter()
        reply = llm.invoke("Reply with exactly: pong")
        result["reachable"] = True
        result["first_ms"] = int((time.perf_counter() - started) * 1000)
        print(f"  reachable     : yes  ({result['first_ms']} ms)  said {str(reply.content).strip()[:30]!r}")
    except Exception as exc:  # noqa: BLE001
        result["reachable"] = False
        result["error"] = str(exc)
        print(f"  reachable     : NO")
        print(f"                  {str(exc)[:200]}")
        return result

    # ---- 2. tool calling ----------------------------------------------------
    try:
        reply = build(provider, model).bind_tools([get_membership_price]).invoke(
            "How much is the monthly membership? Use the tool."
        )
        calls = getattr(reply, "tool_calls", None) or []
        result["tools"] = bool(calls)
        print(f"  tool calling  : {'yes' if calls else 'NO - replied with text'}"
              f"{'  ' + calls[0]['name'] + '(' + str(calls[0]['args']) + ')' if calls else ''}")
    except Exception as exc:  # noqa: BLE001
        result["tools"] = False
        print(f"  tool calling  : ERROR  {str(exc)[:120]}")

    # ---- 3. latency ---------------------------------------------------------
    # Keep going after a failure: on a free tier a refused call is itself a
    # result worth reporting, and stopping early hides the successful ones.
    timings, refused = [], 0
    warm = build(provider, model)
    for _ in range(3):
        try:
            started = time.perf_counter()
            warm.invoke("Reply with exactly: ok")
            timings.append((time.perf_counter() - started) * 1000)
        except Exception as exc:  # noqa: BLE001
            refused += 1
            result.setdefault("refusals", []).append(str(exc)[:100])
    result["refused"] = refused
    if timings:
        result["median_ms"] = int(statistics.median(timings))
        print(f"  latency       : {result['median_ms']} ms median of {len(timings)}"
              f"  (min {int(min(timings))}, max {int(max(timings))})"
              f"{f', {refused} refused' if refused else ''}")
    else:
        print(f"  latency       : all {refused} calls refused")

    if quick:
        return result

    # ---- 4. routing accuracy ------------------------------------------------
    exact = leads = valid = 0
    failures: list[str] = []
    router = build(provider, model)

    for case in CASES:
        messages = [SystemMessage(content=ROUTER_PROMPT)]
        for who, text in case.history:
            messages.append(HumanMessage(content=text) if who == "customer" else AIMessage(content=text))
        messages.append(HumanMessage(content=case.message))

        try:
            answer = parse_route(str(router.invoke(messages).content))
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{case.message[:38]!r} -> error {str(exc)[:60]}")
            continue

        if not isinstance(answer, dict) or not isinstance(answer.get("capabilities"), list):
            failures.append(f"{case.message[:38]!r} -> unreadable answer")
            continue

        got = {str(c) for c in answer["capabilities"]}
        # A capability that does not exist is the worst failure: it means the
        # model invented authority. Counted separately from a wrong choice.
        if got <= set(KNOWN):
            valid += 1
        else:
            failures.append(f"{case.message[:38]!r} -> INVENTED {sorted(got - set(KNOWN))}")
            continue

        if got == case.expect:
            exact += 1
        else:
            failures.append(f"{case.message[:38]!r} -> {sorted(got)}, wanted {sorted(case.expect)}")
        if case.lead and answer.get("lead") == case.lead:
            leads += 1

    total = len(CASES)
    with_lead = sum(1 for c in CASES if c.lead)
    result.update(exact=exact, valid=valid, leads=leads, total=total, failures=failures)
    print(f"  routing       : {valid}/{total} answers used only real capabilities")
    print(f"                  {exact}/{total} matched the expected set exactly")
    print(f"                  {leads}/{with_lead} picked the expected lead")
    if failures:
        print("  where it differed:")
        for line in failures[:8]:
            print(f"                  {line}")
        if len(failures) > 8:
            print(f"                  ... and {len(failures) - 8} more")
    return result


if __name__ == "__main__":
    quick = "--quick" in sys.argv
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None

    print(f"\n  routing set: {describe()}")
    print(f"  keys: openrouter={'set' if settings.openrouter_api_key else 'MISSING'}, "
          f"google={'set' if settings.google_api_key else 'MISSING'}")

    results = [
        measure(label, provider, model, quick)
        for label, provider, model in CANDIDATES
        if not only or only in model
    ]

    print(f"\n{'=' * 78}\n  SUMMARY\n{'=' * 78}")
    print(f"  {'MODEL':<34} {'UP':>4} {'TOOLS':>6} {'MEDIAN':>8} {'ROUTING':>9} {'LEAD':>6}")
    print(f"  {'-' * 34} {'-' * 4} {'-' * 6} {'-' * 8} {'-' * 9} {'-' * 6}")
    for r in results:
        routing = f"{r['exact']}/{r['total']}" if "exact" in r else "-"
        lead = f"{r['leads']}" if "leads" in r else "-"
        print(f"  {r['model'][:34]:<34} {'yes' if r.get('reachable') else 'NO':>4} "
              f"{'yes' if r.get('tools') else 'no':>6} "
              f"{str(r.get('median_ms', '-')) + ' ms':>8} {routing:>9} {lead:>6}")
    print("\n  Nothing was switched over. STEP 52 makes the choice from these numbers.\n")
