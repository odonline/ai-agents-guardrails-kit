# Glossary

Core terms used across this codebase and the rest of `Docs/`. Each entry
states the definition and the distinction that actually matters — the part
that, if missed, leads to a wrong assumption about how the system behaves.

## Kit-side vs payload

**Kit-side** code (`install.js`, `stacks.js`, `generate.js`, `docs.js`,
`test/install.test.js`) runs once, on the developer's own machine, to
scaffold a target project. It is zero-dependency by design (see G1 in
[`constraints-g-series.md`](./constraints-g-series.md)).

**Payload** code (`templates/common/policy_engine.js`, `policy_loader.js`,
`final_check.js`, the per-harness adapters) is what gets *copied into* the
target project and runs there, on every agent tool call, for the life of
that project.

Both are JavaScript. The distinction is *when and where* each runs, not the
language. A file under `templates/` is never a instructions file for working
in this repo — `templates/common/CLAUDE.md` is payload that ships to target
projects; the `CLAUDE.md` at this repo's root is what an agent working on
the kit itself reads.

## `allow` / `ask` / `deny`

The three possible return values of the policy engine's `evaluate()`
function, and they are **not** a single ordered spectrum:

- **`deny`** is enforced by the hook itself. The engine returns `deny`, the
  harness aborts the operation, and there is no session mode that can
  override it.
- **`ask`** is *delegated* to the harness. The engine is saying "a human
  needs to weigh in," but how that's presented is entirely up to the
  harness. If the agent session runs in an auto-approving mode
  (`--dangerously-skip-permissions`, auto-accept, bypass), the `ask` is
  granted with no visible prompt. It is logged in `audit.log` as `ask`, but
  the command runs.
- **`allow`** is the default when nothing matches.

The practical consequence: **anything that must be prevented unconditionally
has to be `deny` in `policy.yaml`, never `ask`.** An agent cannot tell the
difference between an approved `ask` and a plain `allow` from the inside —
only a human watching the prompt can confirm the tier actually fired. See
[`policy-engine-semantics.md`](./policy-engine-semantics.md) for the full
evaluation order.

## `protected_paths`

A list of glob patterns (`.env`, `**/*secret*`, `~/.ssh/**`, ...) checked
against **resolved** file paths — symlinks followed, `~` and relative paths
expanded, before matching. Applies to both structured tool calls
(`Write`/`Edit` with a `file_path`) and to shell command arguments, via a
best-effort tokenizer (not a real shell parser).

`protected_paths` is not a static list baked in at install time: the engine
merges `policy.yaml`'s own list with whatever non-standard ignore files
(`.cursorignore`, `.agentsignore`, ...) exist at the workspace root, reading
both live (mtime-cached) on every call.

## `blocked_commands`

A list of `{pattern, action, reason}` entries, matched with a case-insensitive
regex against the raw shell command text. Distinct from `protected_paths` —
this layer never inspects the filesystem, it only looks at command text. A
command can trip `blocked_commands` (e.g. `git push --force`) without
touching any file at all.

## `required_checks` / completion gate

Not a `PreToolUse` restriction — this is the check that runs at session end
(the `Stop` hook), implemented by `final_check.js`. It **re-executes** the
checks named in `policy.yaml` (tests, lint, typecheck, ...) rather than
trusting the agent's own claim that "tests passed." Results are appended to
`completion_reports.log`.

## Manifest (`install-manifest.json`)

The record of exactly what a given `install.js` run wrote: every file path
plus a content hash and whether it was `written` or `skipped` (because it
already existed), every directory created, the previous and new
`core.hooksPath`, and the exact lines added to `.gitignore`. It is the only
kit-authored file that gets **overwritten** on reinstall rather than written
as a `.new` sibling — it's a derived artifact describing kit state, not
project content. Both `uninstall.js` and `toggle.js` read it to know
precisely what is theirs to touch. See
[`install-uninstall-lifecycle.md`](./install-uninstall-lifecycle.md).

## `core.hooksPath`

Git configuration (not a file) that tells git where to look for hooks. If it
doesn't point at `.husky/`, git silently never executes anything written
there — no error, no warning, the hooks are just inert text files. This is
the single piece of git state the installer is allowed to write (see G12/G17
in [`constraints-g-series.md`](./constraints-g-series.md)), and it cannot be
committed — every developer who clones the repo has to set it locally
themselves (`git config core.hooksPath .husky`).

## Harness / adapter

A **harness** is the agent tool itself (Claude Code, VS Code + Codex,
Antigravity). An **adapter** (`templates/<agent>/hooks/pretooluse.js` or
equivalent) is the thin translation layer between that harness's
hook-invocation JSON format and the engine's `evaluate()` call. Adapters
contain *zero* decision logic — they only translate in and out. All actual
policy logic lives in exactly one place, `policy_engine.js`, so there is
exactly one module to audit for security-relevant behavior.

## Stack

A detected project language/ecosystem (`node`, `php`, `java-maven`,
`java-gradle`, `python`). Each stack contributes its own extra
`blocked_commands`, its own `required_checks`, and both CI profiles (GitHub
Actions and GitLab CI). Stacks are additive: a monorepo with more than one
detected stack gets the union of all their rules, on top of the
language-agnostic core rules.

## Self-protection

The rule that an agent can never disable its own guardrails mid-session:
editing or deleting `.agent-security/**`, any harness's hook config,
`.husky/**`, `.github/workflows/**`, or any known ignore file always
returns `deny` — never `ask`, and never dependent on session permission
mode. *Reading* those same paths is `allow`. See G8 in
[`constraints-g-series.md`](./constraints-g-series.md) and the deeper
discussion in [`policy-engine-semantics.md`](./policy-engine-semantics.md).
