"""
Run every check_*.py script and report which passed.

These are the INTEGRATION tests: each one talks to the real Supabase database,
creates its own rows, proves something about them and cleans up after itself.
They are separate from `pytest` on purpose - pytest stays fast and offline, so
it can be run on every save. This needs the network and takes a few minutes.

    python scripts/run_all_checks.py           # the 17 that never call an LLM
    python scripts/run_all_checks.py --online  # those, plus the 4 that do
    python scripts/run_all_checks.py --only inventory documents

A script counts as passed only if it exits 0 AND prints "ALL PASS". Exit code
alone is not enough: a script that crashes in a `finally` block after printing
failures could still exit 0.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The scripts that never call a model. Safe to run any time, no rate limits,
# no cost, and the result never changes because a free tier was busy.
OFFLINE = [
    "check_router.py",
    "check_duplicate_message.py",
    "check_step_limit.py",
    "check_capability.py",
    "check_slot_offer.py",
    "check_bookings.py",
    "check_approval.py",
    "check_customers.py",
    "check_customer_tools.py",
    "check_customers_api.py",
    "check_invoices.py",
    "check_payment_tools.py",
    "check_payments_api.py",
    "check_inventory.py",
    "check_documents.py",
    "check_communication.py",
    "check_reports.py",
    "check_tenant_isolation.py",
]

# These spend real quota on a free tier and can fail for reasons that are not
# bugs - a 503 from Google, a 429 from OpenRouter. Never in the default run.
ONLINE = [
    "check_providers.py",
    "check_routing_live.py",
    "check_payment_chat.py",
]


def run(script: str, coverage: bool = False) -> tuple[bool, float, str]:
    started = time.time()
    # --parallel-mode writes one data file per process; `coverage combine`
    # later merges them with pytest's, which is the only honest total: most of
    # this code is exercised by these scripts, not by the unit tests.
    command = [sys.executable]
    if coverage:
        command += ["-m", "coverage", "run", "--parallel-mode", "--source", "app"]
    command.append(str(HERE / script))

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(HERE.parent),
    )
    took = time.time() - started
    output = (result.stdout or "") + (result.stderr or "")

    passed = result.returncode == 0 and "ALL PASS" in output
    if result.returncode == 0 and "ALL PASS" not in output:
        reason = "exited 0 but never printed ALL PASS"
    elif result.returncode != 0:
        reason = f"exit code {result.returncode}"
    else:
        reason = ""
    return passed, took, (reason, output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--online", action="store_true", help="also run the scripts that call an LLM")
    parser.add_argument("--only", nargs="*", help="substrings; run only matching scripts")
    parser.add_argument("--coverage", action="store_true",
                        help="record coverage; combine with pytest's afterwards")
    args = parser.parse_args()

    scripts = OFFLINE + (ONLINE if args.online else [])
    if args.only:
        scripts = [s for s in scripts if any(word in s for word in args.only)]
    if not scripts:
        print("Nothing matched.")
        return 1

    print(f"Running {len(scripts)} scripts\n" + "=" * 62)

    failures: list[tuple[str, str, str]] = []
    total = 0.0
    for script in scripts:
        print(f"  {script:<34}", end="", flush=True)
        passed, took, (reason, output) = run(script, coverage=args.coverage)
        total += took
        print(f"{'PASS' if passed else 'FAIL':<6}{took:6.1f}s  {reason}")
        if not passed:
            failures.append((script, reason, output))

    print("=" * 62)
    print(f"{len(scripts) - len(failures)}/{len(scripts)} passed in {total:.0f}s")

    for script, reason, output in failures:
        print(f"\n--- {script}: {reason} " + "-" * 20)
        # The tail is where the failure and the summary line are.
        print("\n".join(output.strip().splitlines()[-25:]))

    if failures:
        print(f"\n{len(failures)} FAILED")
        return 1
    print("\nALL SCRIPTS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
