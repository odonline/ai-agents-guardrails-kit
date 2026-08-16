#!/usr/bin/env python3
"""
Antigravity PreToolUse adapter.

Antigravity input shape:
  {"toolCall": {"name": "run_command", "args": {"command": "..."}}}

Antigravity accepts allow / deny / ask / force_ask:
  {"decision": "allow"|"deny"|"ask"|"force_ask", "reason": "..."}
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agent-security"))
from policy_engine import evaluate_from_dict  # noqa: E402

TOOL_NAME_MAP = {
    "run_command": "Bash",
    "write_to_file": "Write",
    "replace_file_content": "Edit",
    "multi_replace_file_content": "Edit",
}

# Extra Antigravity-only tools that need special handling regardless of
# what the shared policy engine says about paths/commands.
ALWAYS_ASK_TOOLS = {"schedule", "invoke_subagent", "define_subagent", "ask_permission"}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        print(json.dumps({"decision": "deny", "reason": "Could not parse tool call; defaulting to deny."}))
        return 0

    tool_call = payload.get("toolCall", {}) or {}
    raw_tool_name = tool_call.get("name", "")
    tool_input = tool_call.get("args", {}) or {}

    if raw_tool_name in ALWAYS_ASK_TOOLS:
        print(json.dumps({
            "decision": "ask",
            "reason": f"'{raw_tool_name}' can create persistent/recurring effects and always requires approval.",
        }))
        return 0

    tool_name = TOOL_NAME_MAP.get(raw_tool_name, raw_tool_name)
    decision = evaluate_from_dict(tool_name, tool_input)

    print(json.dumps({"decision": decision.action, "reason": decision.reason}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
