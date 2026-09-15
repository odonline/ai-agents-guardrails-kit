# Constraints (the G-series)

Seventeen invariants that gate every non-trivial change to this codebase.
They're cited by ID (`G8`, `G14`, ...) in specs, task files, and code
review — that's why they're numbered rather than just prose. This file is
the standalone reference; the canonical copy that agents working in this
repo actually load lives in
`.claude/skills/sdd-spec-iteration/SKILL.md`, surfaced via the
`sdd-spec-iteration` skill.

| ID | Constraint |
|---|---|
| **G1** | **Dependencies are a human decision.** Kit-side JS stays zero-dependency (stdlib only). The payload carries exactly one authorized dependency, `js-yaml` (MIT), approved 2026-08-26, shipped **vendored** as a single file under `templates/common/vendor/` so no target project ever runs `npm install` to get guardrails. Any further dependency, either side, needs explicit approval — never added as an implementation detail. |
| **G2** | **Fail closed.** Unparseable tool input, a broken regex in `policy.yaml`, a missing policy file, or an unreadable path must produce `deny` or `ask` — never `allow`. A guardrail that fails open is worse than none, because it is trusted. |
| **G3** | **One audit point.** All decision logic lives in the shared engine's `evaluate()`. Adapters only translate harness JSON in and out — never harness-specific parsing in the engine, never a policy decision in an adapter. |
| **G4** | **Never overwrite.** The installer writes a `.new` sibling instead of clobbering an existing file. Re-running the installer on an already-configured project must stay safe. |
| **G5** | **Docs sync.** `RULES.md` is generated. Changing core rules means running `node docs.js` and committing the result. CI diffs it and fails on drift — `RULES.md` is never hand-edited. |
| **G6** | **Stack parity.** A new or changed stack needs its `ci` (GitHub) profile **and** its `gitlabCi` (Docker image) profile **and** a `STACK_MARKERS` fixture in `test/install.test.js`. A missing `gitlabCi` silently emits a broken GitLab pipeline. |
| **G7** | **Harness parity.** An engine signature or contract change must be applied to all three adapters *and* all three hook configs. Two-out-of-three is a silent breakage for the third harness's users. |
| **G8** | **Self-protection is a deny, and it covers reads separately.** Writing or deleting `.agent-security/**`, any harness hook config, `.husky/**`, `.github/workflows/**`, or any known ignore-file entry returns `deny` — for structured file calls, for shell commands that would modify them, and for any unrecognized tool name. `ask` was tried here and was wrong: it put the most consequential decision in the system behind the click a distracted human makes fastest, and the prize for that click is every guardrail off at once. The sanctioned path is a human editing the file, or `toggle.js --disable` first — both deliberate, both visible in `git diff`. **Reading** these files is `allow`: reading disables nothing, and prompting on reads only trains the human to approve `.agent-security/**` reflexively (it also made `SELF_TEST_PROMPT.md` unrunnable). A shell command that merely names the directory stays `ask`, since the tokenizer can't prove it's read-only. |
| **G9** | **Ignore files only add.** `!negation` lines in `.cursorignore`/`.aiignore`/etc. are deliberately never honored. A repo's own ignore file may only *add* protection, never remove it. Intentional, not a bug — never "fix" this. |
| **G10** | **Cross-platform.** Kit-side JS must work on Windows, macOS, and Linux. `npm test` runs on Windows. No bash-only assumptions, no hardcoded `/tmp`, no POSIX-only path handling. |
| **G11** | **Exactly one CI file.** `.github/workflows/security.yml` **or** `.gitlab-ci.yml` — never both, and never guessed when the host is unknown and `--ci` wasn't passed. |
| **G12** | **hooksPath or nothing — but never steal it.** Git hooks in `.husky/` never execute unless `core.hooksPath` points there. `configureHooksPath()` sets it when the target is a git repo; when it isn't, the final summary must say the step is still required. Setting `hooksPath` silences the *previous* hook directory entirely — including plain `.git/hooks/`, which anything (`pre-commit`, lefthook, husky v4, an IDE) may have already populated. **Chain, don't replace:** shim every hook found in the previously-effective directory so the project's own hook runs first and its exit code propagates. Ask the human only when chaining is unsafe — a target outside the repo, an unreadable directory, or a `.husky/<hook>` this kit didn't write. Breaking a project's existing safeguard while installing a safeguard is exactly the failure this kit exists to prevent. |
| **G13** | **Interpreter parity.** The interpreter named in every hook config's `command` string must match the engine's actual runtime. A mismatch means the hook silently never runs — the guardrails look installed and enforce nothing. |
| **G14** | **Behavior parity on port.** Porting the engine may not drop a single test case or a single rule. Prove it test-for-test against `main` (the last-known-good reference), not against a working tree that may already have drifted. |
| **G15** | **Uninstall is subtractive, honest, and confirmed.** It removes only what the kit put there and that still matches what it wrote, per the manifest — never what the user edited. Anything modified, unrecorded, or unrecognized is *reported for the human*, never deleted, never rewritten. It must print the full plan (what's deleted, what's kept and why, what happens to `core.hooksPath` and `.gitignore`) and wait for confirmation (`--yes` skips the wait, `--dry-run` stops after the plan). Plan and summary must both say, unmissably, whether the guardrails are still active. An uninstall may end **deliberately incomplete**; it may not end silently with enforcement still wired. It must also unset `core.hooksPath` (the mirror of G12) and revert only the `.gitignore` lines it added. Deleting a user's edited policy or contract file is data loss, not cleanup. |
| **G16** | **No kill switch inside the engine.** Deactivation works by **unhooking** — removing the harness's hook wiring so the engine is never called — never by a flag, sentinel file, or `enabled: false` the engine itself reads and then allows everything for. A path inside the engine whose job is to return `allow` for all input is both a fail-open path (violates G2) and a single file an agent could try to create to free itself (violates G8). Unhooking is visible in a `git diff`; a silent flag is not. |
| **G17** | **The kit never commits.** The target repository's history belongs to the client. Nothing kit-side or payload may run `git add`, `commit`, `push`, `checkout`, `reset`, `merge`, `rebase`, `stash`, `tag`, `branch`, or any other history/index-mutating command — not the installer, not the uninstaller or toggle, not anything the kit *generates*. A generated hook that staged files for you would keep doing it, in every clone, on every commit. The kit reads git state freely and writes exactly one piece of git config, `core.hooksPath` (G12), which it records and reverts on uninstall/disable. Everything else it writes is left **untracked**, for the client to review and commit themselves. |

## Why these are numbered rather than left as prose

Two reasons, both practical: a spec or task file can cite a rule by ID
instead of re-explaining it, and — more importantly — a hard stop during
review ("this weakens G8") is unambiguous in a way "this weakens
self-protection" is not, because "self-protection" could mean several
things depending on which layer someone has in mind. See
[`policy-engine-semantics.md`](./policy-engine-semantics.md) for the deeper
discussion of G2, G8, and G9 specifically, and
[`install-uninstall-lifecycle.md`](./install-uninstall-lifecycle.md) for
G4, G12, G15, G16, and G17.
