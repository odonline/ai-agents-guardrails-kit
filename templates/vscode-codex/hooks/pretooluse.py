#!/usr/bin/env python3
"""
VS Code agent-hooks adapter (works for Codex, Copilot-compatible agents).
Tool/property names differ from Claude Code, so this adapter normalizes
them before calling the shared policy engine.

VS Code hook input (approximate — verify against your installed version,
see https://code.visualstudio.com/docs/agents/reference/hooks-reference):
  {"toolName": "runTerminalCommand", "toolInput": {"command": "..."}}
  {"toolName": "create_file", "toolInput": {"path": "...", "content": "..."}}

Output (VS Code accepts an allow/deny/ask permission decision, most
restrictive wins when multiple hooks fire):
  {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                           "permissionDecision": "allow"|"deny"|"ask",
                           "permissionDecisionReason": "..."}}
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agent-security"))
from policy_engine import evaluate_from_dict  # noqa: E402

# Map VS Code / Codex tool names onto the canonical names the policy
# engine already understands (Bash, Write, etc).
TOOL_NAME_MAP = {
    "runTerminalCommand": "Bash",
    "create_file": "Write",
    "replace_string_in_file": "Edit",
    "insert_edit_into_file": "Edit",
}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Guardrail hook could not parse tool input; defaulting to deny.",
            }
        }))
        return 0

    raw_tool_name = payload.get("toolName") or payload.get("tool_name", "")
    tool_name = TOOL_NAME_MAP.get(raw_tool_name, raw_tool_name)
    tool_input = payload.get("toolInput") or payload.get("tool_input", {}) or {}

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
