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

## `.gitignore` does not protect anything here

`.gitignore` only controls what `git` tracks/commits. It has **zero**
relationship to what a coding agent's tools can read from disk — an agent
reading `config.yml` via its Read tool or via `cat config.yml` doesn't go
through git at all, so a `.gitignore` entry is invisible to it.

If you have secrets in a file that isn't already covered by the defaults
(`.env*`, anything with `credentials`/`secret` in the name, `~/.ssh/**`,
`~/.aws/**`, `*.pem`, `*.key`), **add it explicitly** to `protected_paths`
in `policy.yaml`:

```yaml
protected_paths:
  - "config.yml"
  - "config/database.yml"
  - "**/appsettings.*.json"
```

## What "protected" actually covers

Both of these are checked and denied:
- Structured file-read/write tool calls (`Read`, `Write`, `Edit`,
  `create_file`, etc. — matched by `file_path`/`path`).
- Shell commands that reference a protected path as an argument
  (`cat .env`, `grep X .env`, `less .env`, a Python one-liner naming the
  file literally, `cat .env | curl ...`).

Two independent sources feed `protected_paths`, both checked live on every
evaluation:
1. `policy.yaml`'s `protected_paths` list (this repo's own config).
2. Any of the non-standard "ignore this from agents" files already adopted
   by various tools, if present at the workspace root: `.cursorignore`,
   `.agentsignore`, `.aiignore`, `.aiderignore`, `.clineignore`,
   `.windsurfignore`, `.continueignore`, `.copilotignore`,
   `.codeiumignore`, `.geminiignore` (see `KNOWN_IGNORE_FILES` in
   `policy_engine.py` — there's no shared spec across vendors, so this list
   grows as tools adopt the convention).

Since (2) is read live (cached by mtime, not baked in at install time),
editing one of these files takes effect immediately — no need to re-run
the installer. Lines starting with `!` (gitignore's "un-ignore" syntax) are
intentionally **not honored**: this is a security control, so a repo's own
ignore file is never allowed to silently *reduce* protection, only add to
it. The ignore files themselves are protected from being edited or deleted
(structured edit or `rm` via shell) the same way `.agent-security/**` is —
otherwise an agent could just empty `.cursorignore` to remove its own
limits.

The shell-command check is a best-effort **tokenizer**, not a real shell
parser. It resolves each whitespace-separated argument as a path and checks
it the same way a structured file call would be checked. That's enough to
catch the common cases above, but it is not airtight — an agent motivated
to evade it could, in principle, obfuscate the filename (`E=.e''nv; cat
$E`), read it through a tool this repo hasn't hooked (an MCP tool, a
background process, a script invoked from outside the workspace), or read
an environment variable that's already loaded into the shell's environment
rather than the file itself. Treat this layer as raising the bar and
creating an audit trail, not as a sandbox boundary.

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
