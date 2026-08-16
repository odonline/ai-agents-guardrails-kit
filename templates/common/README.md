# .agent-security

Shared, audited policy engine used by every agent hook in this repo
(Claude Code, VS Code/Codex, Antigravity), plus Git hooks and CI.

```
.agent-security/
├── policy.yaml              # single source of truth for rules
├── policy_engine.py         # evaluate(tool_name, tool_input) -> Decision
├── final_check.py           # evidence-based completion gate
├── test_policy_engine.py    # pytest suite
├── audit.log                # every decision, appended (gitignored)
└── completion_reports.log   # every Stop-gate result, appended (gitignored)
```

## How it's wired

Each harness has a thin **adapter** that only knows how to parse that
harness's JSON and print that harness's JSON back. All actual logic
(protected paths, blocked commands, symlink/escape checks, default-deny)
lives in `policy_engine.py` so there is exactly one place to audit and test.

- Claude Code   → `.claude/hooks/pretooluse.py`
- VS Code/Codex → `.github/hooks/pretooluse.py`
- Antigravity   → `.agents/scripts/pretooluse.py`

## Editing the policy

1. Edit `policy.yaml`.
2. Run `pytest .agent-security/test_policy_engine.py`.
3. This directory is itself protected: any agent trying to edit files under
   `.agent-security/**` gets an automatic `ask` decision (see
   `policy_engine.py`'s self-protection block). Changes should go through a
   human-reviewed PR, not an agent edit in the same session it's trying to
   bypass.

## What this does NOT do

This is a **policy gate**, not a sandbox. It can deny a tool call before
it runs, but if the agent has a way to reach the same effect through a tool
or process this repo doesn't hook (a background process, an MCP tool, a
script run from outside the workspace), the gate never sees it. Pair this
with:
- OS/container sandboxing (restrict filesystem/network at the process level)
- Git pre-commit/pre-push hooks (`.husky/`)
- CI branch protection (the only layer the agent truly cannot bypass)
- No production credentials available to the agent, ever

See the parent `AGENTS.md` for the full defense-in-depth rationale.
