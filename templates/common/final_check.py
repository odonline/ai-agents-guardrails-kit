#!/usr/bin/env python3
"""
final_check.py — Evidence-based completion gate.

Runs at Stop / PostToolUse. Re-runs the required checks itself instead of
trusting the agent's claim that "tests pass", and writes a machine-readable
report. Any harness (Claude Code, VS Code hooks, Antigravity) can call this
as its Stop hook.

Usage:
  python3 final_check.py                 # full completion gate (Stop)
  python3 final_check.py --post-tool-use # lightweight check after one edit
"""
import json
import subprocess
import sys
import time
from pathlib import Path

try:
    import yaml
except ImportError:
    raise SystemExit("PyYAML is required. Install with: pip install pyyaml --break-system-packages")

HERE = Path(__file__).resolve().parent
POLICY_PATH = HERE / "policy.yaml"


def load_policy() -> dict:
    with open(POLICY_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def run_check(name: str, command: str) -> dict:
    try:
        proc = subprocess.run(
            command, shell=True, cwd=HERE.parent, capture_output=True, text=True, timeout=600
        )
        return {"executed": True, "exit_code": proc.returncode, "command": command}
    except Exception as e:  # noqa: BLE001
        return {"executed": False, "exit_code": None, "command": command, "error": str(e)}


def main() -> int:
    light = "--post-tool-use" in sys.argv
    policy = load_policy()
    required = policy.get("required_checks", [])

    results = {}
    if not light:
        for check in required:
            results[check["name"]] = run_check(check["name"], check["command"])

    all_ok = all(r["executed"] and r["exit_code"] == 0 for r in results.values()) if results else True

    report = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "status": "ok" if all_ok else "blocked",
        "checks": results,
    }
    if not all_ok and results:
        failed = [name for name, r in results.items() if not (r["executed"] and r["exit_code"] == 0)]
        report["reason"] = f"Completion denied: checks failed or were not run: {', '.join(failed)}."

    audit_dir = HERE
    audit_dir.mkdir(parents=True, exist_ok=True)
    with open(audit_dir / "completion_reports.log", "a", encoding="utf-8") as f:
        f.write(json.dumps(report, ensure_ascii=False) + "\n")

    print(json.dumps(report, ensure_ascii=False))
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
