"""
List OpenRouter models this agent can actually use.

The agent needs TOOL CALLING. Most "access denied" and "the model ignored my
tools" problems come from picking a model that does not support it. This script
asks OpenRouter which ones do, so you never have to guess.

Run from backend/:

    python scripts\\check_models.py            # free models with tool support
    python scripts\\check_models.py --all      # paid ones too
    python scripts\\check_models.py --test     # also send a real tool call to
                                               # the model in your .env
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" — Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.config import settings

MODELS_URL = "https://openrouter.ai/api/v1/models"


def is_free(model: dict) -> bool:
    pricing = model.get("pricing") or {}
    try:
        return float(pricing.get("prompt", "1")) == 0 and float(pricing.get("completion", "1")) == 0
    except (TypeError, ValueError):
        return False


def supports_tools(model: dict) -> bool:
    return "tools" in (model.get("supported_parameters") or [])


def fetch_models() -> list[dict]:
    with httpx.Client(timeout=30) as client:
        response = client.get(MODELS_URL)
    response.raise_for_status()
    return response.json().get("data", [])


def list_models(show_all: bool) -> None:
    models = fetch_models()
    usable = [m for m in models if supports_tools(m)]
    if not show_all:
        usable = [m for m in usable if is_free(m)]

    usable.sort(key=lambda m: -(m.get("context_length") or 0))

    heading = "free models" if not show_all else "all models"
    print(f"\n  {len(usable)} {heading} on OpenRouter support tool calling")
    print(f"  (out of {len(models)} total)\n")
    print(f"  {'MODEL ID':<58} {'CONTEXT':>9}  {'COST':>6}")
    print(f"  {'-' * 58} {'-' * 9}  {'-' * 6}")

    for model in usable[:40]:
        context = model.get("context_length") or 0
        cost = "free" if is_free(model) else "paid"
        print(f"  {model['id']:<58} {context:>9,}  {cost:>6}")

    if len(usable) > 40:
        print(f"\n  ... and {len(usable) - 40} more. Use --all or browse "
              "https://openrouter.ai/models?supported_parameters=tools")

    print(f"\n  Your .env currently uses: {settings.llm_model}")
    current = next((m for m in models if m["id"] == settings.llm_model), None)
    if current is None:
        print("  ^^ NOT FOUND on OpenRouter. Copy an id from the list above.")
    elif not supports_tools(current):
        print("  ^^ EXISTS but does NOT support tool calling. The agent will not work.")
    else:
        print("  ^^ looks good: exists and supports tool calling.")
    print()


def test_tool_call() -> None:
    """Prove the configured model really emits a tool call, not just text."""
    from langchain_core.tools import tool

    from app.agents.llm import describe_error, get_llm

    @tool
    def get_membership_price(plan: str) -> str:
        """Look up the price of a gym membership plan."""
        return f"{plan} costs 1800 rupees"

    print(f"\n  Testing tool calling on: {settings.llm_model}")

    try:
        llm = get_llm(temperature=0).bind_tools([get_membership_price])
        reply = llm.invoke("How much is the monthly membership? Use the tool.")
    except Exception as exc:  # noqa: BLE001
        print(f"  FAILED: {describe_error(exc)}\n")
        return

    calls = getattr(reply, "tool_calls", None) or []
    if calls:
        print(f"  PASS — the model called: {calls[0]['name']}({calls[0]['args']})")
        print("  This model will work for the agent.\n")
    else:
        print(f"  FAIL — the model replied with text instead of calling the tool:")
        print(f"         {str(reply.content)[:160]}")
        print("  Pick a different model from the list above.\n")


if __name__ == "__main__":
    if "--test" in sys.argv:
        test_tool_call()
    else:
        list_models(show_all="--all" in sys.argv)
