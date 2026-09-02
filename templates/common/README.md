# .agent-security

Shared, audited policy engine used by every agent hook in this repo
(Claude Code, VS Code/Codex, Antigravity), plus Git hooks and CI.

> Just installed this and unsure what to do next? See
> [`POST_INSTALL.md`](./POST_INSTALL.md) — this file explains how the
> engine itself works; that one walks through the installer's next-steps
> checklist. Want to *prove* the engine is actually engaged, not just
> installed? See [`SELF_TEST_PROMPT.md`](./SELF_TEST_PROMPT.md).

```
.agent-security/
├── policy.yaml              # single source of truth for rules
├── policy_engine.js         # evaluate(toolName, toolInput) -> Decision
├── policy_loader.js         # reads + validates policy.yaml, fails closed
├── final_check.js           # evidence-based completion gate
├── test_policy_engine.js    # test suite (no runner to install)
├── vendor/                  # js-yaml, vendored verbatim (see vendor/VENDOR.md)
├── toggle.js                # --disable / --enable: turns enforcement off and
│                            # back on without deleting anything
├── uninstall.js             # removes the kit; shows a plan first and asks
├── kit_manifest.js          # shared by toggle.js and uninstall.js: reads the
│                            # manifest and decides which files are still ours
├── install-manifest.json    # what the installer wrote + what it changed
│                            # outside these files. Do not delete: the
│                            # uninstaller needs it to know what is safe
│                            # to remove and what is yours.
├── audit.log                # every decision, appended (gitignored)
└── completion_reports.log   # every Stop-gate result, appended (gitignored)
```

## How it's wired

Each harness has a thin **adapter** that only knows how to parse that
harness's JSON and print that harness's JSON back. All actual logic
(protected paths, blocked commands, symlink/escape checks, default-deny)
lives in `policy_engine.js` so there is exactly one place to audit and test.

- Claude Code   → `.claude/hooks/pretooluse.js`
- VS Code/Codex → `.github/hooks/pretooluse.js`
- Antigravity   → `.agents/scripts/pretooluse.js`

Everything here runs on Node (>= 16). There is nothing to install: the one
third-party dependency (js-yaml, for reading `policy.yaml`) ships vendored
as a single file you can read and checksum — see `vendor/VENDOR.md`.

## Editing the policy

1. Edit `policy.yaml`.
2. Run `node .agent-security/test_policy_engine.js`. The engine refuses to
   run on a policy file it cannot fully parse — a malformed pattern or a
   bad action value is an error at load time, not a rule that silently
   stops applying — so this catches a typo before it becomes a gap.
3. This directory is itself protected: any agent trying to edit files under
   `.agent-security/**` gets an automatic `ask` decision (see
   `policy_engine.js`'s self-protection block). Changes should go through a
   human-reviewed PR, not an agent edit in the same session it's trying to
   bypass.

## What this never does to your git history

It does not commit. The installer, the uninstaller and `toggle.js` never run
`git add`, `commit`, `push`, `checkout`, `reset`, `merge`, `rebase`, `stash`,
`tag` or `branch`, and neither does anything the kit generated — a hook that
staged files for you would keep doing it, on every commit, in everyone's clone.

The one piece of git state the installer writes is `core.hooksPath` (without it
the hooks in `.husky/` never execute), recorded in the manifest and reverted when
you uninstall or disable. Everything else it wrote is sitting there untracked,
for you to review and commit yourself.

## Turning it off for a while

```bash
node .agent-security/toggle.js --disable
```

Nothing is deleted. Your `policy.yaml`, the adapters and `.husky/` all stay
exactly where they are; what changes is that the harness stops calling them —
each harness's hook config is renamed out of the way
(`settings.json` → `settings.json.disabled`) and `core.hooksPath` goes back to
whatever it was before the install. To turn it back on:

```bash
node .agent-security/toggle.js --enable
```

A `--disable`/`--enable` round trip returns the config byte-for-byte. `--dry-run`
shows the plan and stops; `--yes` skips the confirmation on `--disable`
(re-enabling never asks — turning protection back on needs no gate).

Two things worth knowing:

- For Claude Code, `settings.json` also holds the `permissions` deny/ask lists,
  which Claude Code itself applies. Disabling the file turns those off too.
  "Disabled" means disabled.
- If you merged a `.new` into your own hook config by hand, that file holds your
  settings *and* ours. Renaming it would carry yours away, so it is left alone
  and reported — you take out the hook blocks yourself. For Antigravity,
  `"enabled": false` in `.agents/hooks.json` is enough.

**Why a rename and not an `enabled: false` flag?** Because that flag would have
to be read by the *engine* — a code path whose only job is to return `allow` for
everything, inside the one component that exists to fail closed. It would also be
a single file an agent could try to create to free itself, and it would be
invisible in a code review. A rename is subtractive and shows up in
`git status`.

## Removing the kit

```bash
node .agent-security/uninstall.js
```

It prints a plan first — what it will delete, what it will keep and why, what
happens to `core.hooksPath` and `.gitignore` — and asks before doing anything.
`--dry-run` stops after the plan; `--yes` skips the confirmation.

The rule it follows: **it removes what the installer put there, and never
touches what you edited.** A file is deleted only if the manifest recorded it
*and* its content still matches what was written. So a `policy.yaml` you tuned,
or a `settings.json` you merged by hand, is kept and reported rather than
deleted.

That means an uninstall can end deliberately incomplete. If a hook config still
has our blocks in it, the summary says so explicitly — because until you remove
them, every tool call runs a hook pointing at an `.agent-security/` that no
longer exists, and the adapters answer `deny`. It fails closed, so you get
everything denied rather than everything allowed.

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
   `policy_engine.js` — there's no shared spec across vendors, so this list
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
