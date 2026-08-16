# Agent operating contract

> This file explains expectations. It is **not** a security boundary — the
> real enforcement lives in `.agent-security/policy_engine.py` and the
> `PreToolUse` hooks. If this file and the hooks ever disagree, the hooks win.

## Before editing
- Inspect the relevant files and tests before making changes.
- State the intended files and commands before running them.
- Do not modify generated files manually.

## Prohibited
- Do not access credentials, secrets, or SSH/cloud config directories.
- Do not push, publish, deploy, migrate, or delete data without approval.
- Do not disable hooks, use `--no-verify`, or otherwise bypass checks.
- Do not modify `.agent-security/**`, `.claude/**`, `.agents/**`,
  `.github/hooks/**`, or `.github/workflows/**` without explicit approval.

## Required
- Run focused tests after each logical change.
- Run the security scanner / linter before presenting the result.
- Report failures accurately; never claim a test passed without executing it.
- If a policy hook blocks an operation, stop and ask the user — do not try
  workarounds (different flags, wrapper scripts, alternate working directory).
