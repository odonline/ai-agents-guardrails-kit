#!/usr/bin/env python3
"""
Claude Code PreToolUse adapter.
Reads Claude Code's hook JSON from stdin, calls the shared policy engine,
and prints a Claude Code-shaped permission decision to stdout.

Claude Code hook input shape (relevant fields):
  {"tool_name": "Bash", "tool_input": {"command": "..."}}
  {"tool_name": "Write", "tool_input": {"file_path": "...", "content": "..."}}

Expected output shape:
  {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                           "permissionDecision": "allow"|"deny"|"ask",
                           "permissionDecisionReason": "..."}}
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agent-security"))
from policy_engine import evaluate_from_dict  # noqa: E402


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        # Can't parse the hook payload at all -> default deny.
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Guardrail hook could not parse tool input; defaulting to deny.",
            }
        }))
        return 0

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    decision = evaluate_from_dict(tool_name, tool_input)

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision.action,
            "permissionDecisionReason": decision.reason,
        }
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
