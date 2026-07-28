#!/usr/bin/env python3
"""Single entrypoint for all data/cert generation (Issue 9).

Orchestrates the existing generators — it does NOT generate anything itself,
so the "no new generator scripts" rule still holds. Each step shells out to
the script that already owns that data.

    python generate.py all            # everything below, in order
    python generate.py train          # branch FL training CSVs (generate_data.py)
    python generate.py certs          # mTLS certs (generate_certs.py)
    python generate.py banking        # banking accounts + seed DB
    python generate.py supplementary  # AML / remittance datasets

ponytail: thin subprocess dispatcher; if a step needs flags later, add them to
the owning script, not here.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# step -> ordered list of scripts to run for that step
STEPS: dict[str, list[str]] = {
    "train": ["generate_data.py"],
    "certs": ["generate_certs.py"],
    "banking": ["generate_banking_data.py", "seed_banking_data.py"],
    "supplementary": ["generate_supplementary_data.py"],
}
ALL_ORDER = ["train", "certs", "banking", "supplementary"]


def run_step(step: str) -> None:
    for script in STEPS[step]:
        path = ROOT / script
        if not path.exists():
            print(f"  skip {script} (not found)")
            continue
        print(f"  → {script}")
        subprocess.run([sys.executable, str(path)], cwd=str(ROOT), check=True)


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    steps = ALL_ORDER if arg == "all" else [arg]
    if arg != "all" and arg not in STEPS:
        print(f"unknown step: {arg}\nchoose: all, {', '.join(STEPS)}")
        return 2
    for step in steps:
        print(f"[{step}]")
        run_step(step)
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
