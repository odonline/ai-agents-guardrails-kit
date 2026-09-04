---
name: sdd-spec-iteration
description: Spec-driven development workflow for the ai-agents-guardrails-kit installer/generator. Load before writing or refining a spec in Tasks/**, turning an idea/bug/refactor into a plan, splitting a plan into numbered tasks, implementing from a task file, or making any non-trivial change to install.js, stacks.js, generate.js, docs.js, or templates/**. Carries the kit-side vs payload rule, the G1-G17 constraints, the Node engine port contract, and the repo's real verification commands.
---

# Skill: SDD Spec Iteration & Task Planning

## Trigger
Load this skill before:
- Creating or refining a feature spec in `Tasks/**`.
- Turning an idea, audit, bug, refactor, or feature request into an implementation plan.
- Splitting an approved spec into numbered coding tasks.
- Implementing from a task file produced by this SDD workflow.
- Reconciling discrepancies between a spec, plan, task file, and current code.
- Any change to `install.js`, `stacks.js`, `generate.js`, `docs.js`, or anything
  under `templates/**` that is more than a typo fix.

## Purpose
Use spec-driven development to prevent coding discrepancies. Iterate a spec
until the contract is clear, convert it into an ordered plan, then create small
implementation tasks with exact code scope, tests, commands, hard stops, and
acceptance criteria.

This skill is adapted for **ai-agents-guardrails-kit** — the installer/generator
that scaffolds an agent-guardrails system (policy engine, per-harness adapters,
git hooks, CI) into *other* target projects.

Read `CLAUDE.md` at the repo root first. It is the authority on what this
repository is; this skill only adds the SDD process on top of it.

## The Two-Audience Rule (read this before anything else)

Every file in this repo serves one of two audiences. Confusing them is the single
most common failure mode here, and every spec must state which side it touches.

| | **Kit-side** | **Payload** |
|---|---|---|
| What | The installer/generator | What gets copied into target projects |
| Files | `install.js`, `stacks.js`, `generate.js`, `docs.js`, `test/install.test.js`, `.gitlab-ci.yml`, root `README.md`/`CONTRIBUTING.md`/`CHANGELOG.md`/`RULES.md`/`CLAUDE.md` | everything under `templates/**` |
| Runs | Once, on a developer's machine | On every agent tool call, in someone else's repo |
| Audience | Contributors to this kit | Agents and developers in installed projects |
| Language | Console output in **Spanish** | Docs in **English** |
| Breakage blast radius | This repo's CI | Every project that reinstalls or updates |

Two consequences that must appear in specs:

1. **`templates/common/CLAUDE.md` is not this repo's `CLAUDE.md`.** Same for
   `AGENTS.md`, `GEMINI.md`, `README.md`. The `templates/` copies are payload.
   Never "fix" one thinking it is the other.
2. **A payload change does not reach an install that already happened.**
   `install.js` never overwrites an existing file — it writes a `.new` sibling
   (G4). So changing `templates/common/policy_engine.*` fixes nothing for a
   project that already installed, unless someone diffs and merges the `.new`
   file. Any payload change whose absence is a security hole must say so in its
   spec and in `CHANGELOG.md`. Note this is a rule about the *future*: there are
   no installs in the wild yet (see Repo-Specific Facts), so no current spec owes
   anyone a migration.

## Component Matrix

Every SDD spec MUST identify which component(s) it affects and apply the
corresponding contracts and hard stops.

| Component | Files | Side | Key constraints | Verification |
|---|---|---|---|---|
| **Installer CLI** | `install.js` | kit | G4 never-overwrite, G10 cross-platform, G11 one-CI-file, G12 hooksPath, Spanish output | `npm test`, real install into scratch dir |
| **Stack profiles** | `stacks.js` | kit | G6 stack parity (`ci` **and** `gitlabCi` **and** `STACK_MARKERS`) | `npm test`, `node docs.js` |
| **Renderers** | `generate.js` | kit | G5 docs sync, G6, G11; renders `policy.yaml` + hooks + both CI formats | `node docs.js` + diff, install + engine tests |
| **Docs generator** | `docs.js` → `RULES.md` | kit | G5 — parses the engine source; breaks if the engine is renamed | `node docs.js` then `git diff --exit-code RULES.md` |
| **Runtime policy engine** | `templates/common/policy_engine.*` | payload | G2 fail-closed, G3 single audit point, G8 self-protection, G9 no negation | engine test suite against a fresh install |
| **Completion gate** | `templates/common/final_check.*` | payload | Re-executes `required_checks` from `policy.yaml`; never trusts the agent's claim | run it inside a fresh install |
| **Harness adapters** | `templates/claude-code/hooks/pretooluse.*`, `templates/vscode-codex/hooks/pretooluse.*`, `templates/antigravity/scripts/pretooluse.*` | payload | G3 — translation only, zero decision logic; G7 harness parity | one install per harness |
| **Harness hook configs** | `templates/claude-code/settings.json`, `templates/vscode-codex/hooks/security.json`, `templates/antigravity/hooks.json` | payload | G7, G13 interpreter parity — each hardcodes the interpreter and the adapter path | inspect generated files after install |
| **Agent contract payload** | `templates/common/{AGENTS,CLAUDE,GEMINI}.md` | payload | Copied verbatim, language-agnostic, English | read-through |
| **Install-time docs** | `templates/common/{README,POST_INSTALL,SELF_TEST_PROMPT}.md` | payload | Must match the commands the installer actually prints | cross-check against `install.js` summary |
| **Engine test suite** | `templates/common/test_policy_engine.*` | payload | Every engine rule needs a case; G14 behavior parity | runs only *after* installing into a target |
| **Vendored `js-yaml`** | `templates/common/vendor/js-yaml.js` | payload | G1 — the one authorized dependency; keep the MIT header; never resolve from a target's `node_modules` | engine tests |
| **Uninstaller** *(planned)* | `install.js --uninstall` / `--disable` / `--enable` | kit | G15 manifest-driven removal, G16 unhook-not-killswitch, G12 unset `hooksPath` | install→uninstall round-trip in a scratch dir |
| **Install manifest** *(planned)* | `.agent-security/install-manifest.json` | both | Written kit-side, lives in the payload; protected by G8 like the rest of `.agent-security/**` | round-trip test |
| **Installer test suite** | `test/install.test.js` | kit | Zero external deps, must pass on Windows (G1, G10) | `npm test` |
| **Kit's own CI** | `.gitlab-ci.yml` | kit | Runs `npm test`, the `RULES.md` staleness diff, and install+engine-test per stack | pipeline |

## Runtime Target: Node (port complete)

**Done as of 2026-08-31.** The runtime engine was ported from Python to Node and
the `.py` files are deleted. The kit is a single-language project now: everything
is JavaScript, and the distinction that matters is kit-side vs payload, not
language.

The payload is `templates/common/{policy_engine,policy_loader,final_check,test_policy_engine}.js`
plus `vendor/js-yaml.js`, and the three `pretooluse.js` adapters. All three hook
configs invoke `node`. Nothing in the payload needs pip, a virtualenv, or pytest.

Snake_case filenames were kept deliberately so `git log --follow` and greps stay
continuous across the port, even though the rest of the kit's JS uses flat
single-word names (`install.js`, `stacks.js`).

### The parity oracle still lives on `main`

Useful when auditing why the engine decides something the way it does:

```bash
git show main:templates/common/policy_engine.py
```

Parity was verified three ways before deletion: the 24 original cases ported
one-for-one under their original names; a 54-input differential run against the
Python engine (53 identical, 1 intentional divergence); and a real end-to-end
install per stack. `test/install.test.js` freezes the 24 case names as the
standing G14 baseline now that the `.py` is gone.

### Deliberate divergences from the Python engine

Four, all in the fail-closed direction, each documented in a port task file:

1. **A regex that does not compile is a load error**, not a rule that silently
   stops applying. The Python engine `continue`d past broken patterns under a
   comment claiming it did not.
2. **A malformed `blocked_commands` entry is a load error**, not a skipped rule.
3. **`filePath` is read in the self-protection check too.** Python read
   `file_path`/`path`/`filePath` for protected paths but only the first two for
   guardrail infrastructure — so on a camelCase harness an agent could rewrite
   `policy.yaml`, delete an ignore file, or edit a hook config with no prompt.
   Measured: the Python engine answered `allow`. A full G8 bypass.
4. **Adapters emit a well-formed `deny` when the engine cannot be loaded**,
   instead of dying with a traceback, empty stdout and a non-zero exit — which is
   exactly the state a half-removed install leaves behind.

Inherited debt deliberately NOT fixed during the port, because a port that
changes rules cannot be verified for parity: `sensitive_tools`,
`approval_required` and `completion_rules` are read by nothing;
`final_check --post-tool-use` runs no checks; and the hook timeout (60 s) is
shorter than the per-check timeout (600 s). All recorded in
`Tasks/policy-engine-node-port/00-overview.md`.

### Decisions of record (both former blockers resolved 2026-08-26)

**Policy format — `policy.yaml` stays, read with vendored `js-yaml`.** G1 was
amended, not violated: `js-yaml` (MIT) is authorized for the payload and ships
**vendored** as a single file under `templates/common/vendor/`, required by
relative path. No target project runs `npm install` to get guardrails, and
`policy.yaml` keeps the explanatory comments the generated header carries —
which is the point, since that header invites the user to edit the file.
Use js-yaml v4 `load()` (safe by default); never `require` it from a
target-project `node_modules`. Keep the MIT license header intact in the
vendored file. Loading still fails closed (G2): a `policy.yaml` that throws on
parse must deny, not allow.

**Runtime — `node` is a hard requirement; Python is removed, not kept as a
fallback.** No dual engine. The `.py` files are deleted from the payload, so
there is exactly one implementation to audit (G3). Consequence to handle
explicitly: a Java/Maven or PHP target project is not guaranteed to have `node`.
`install.js` must detect its absence and say so plainly, and `POST_INSTALL.md`
must state the requirement up front. Note this is not a new burden in kind — the
Python payload already required `pip install pyyaml pytest`; vendoring js-yaml
means the Node payload requires *less* setup than what it replaces.

### Removing the Python payload safely

The `.py` files are the behavioral reference for G14 parity, and deleting them
before the port is verified would throw that reference away. It does not have to:
they are committed on `main`, so the oracle survives deletion.

```bash
git show main:templates/common/policy_engine.py
```

```bash
git show main:templates/common/test_policy_engine.py
```

Parity work therefore compares against `main`, not against the working tree. Cite
this in any task that removes a `.py` file, so the removal is not mistaken for
losing the reference.

### Every touchpoint the port must update

A port task that misses any of these ships a broken install. This list is the
checklist; verify each against current line numbers before relying on it.

Interpreter strings (all three hardcode `python3 …`):
- `templates/claude-code/settings.json` — `PreToolUse`, `PostToolUse`, `Stop`
- `templates/vscode-codex/hooks/security.json` — same three
- `templates/antigravity/hooks.json` — same three

Kit-side generators and CLI:
- `generate.js` — the pre-push hook body invokes `final_check.py`; the GitHub CI
  workflow installs `pyyaml pytest` and runs `pytest`; the GitLab CI job does the
  same. All three are emitted into target projects, so all three must change.
- `install.js` — `COMMON_FILES` dest names, and the "próximos pasos" summary
  steps that tell the user to `pip install pyyaml pytest` and run
  `python -m pytest`.
- `docs.js` — reads `KNOWN_IGNORE_FILES` by regex over `policy_engine.py`'s
  source text. After the port it should `require()` the Node module and read the
  exported constant directly, which is strictly better than the regex. If the
  file is renamed and `docs.js` is not updated, `docs.js` throws and CI fails —
  that is the intended fail-loud behavior (G5).
- `.gitlab-ci.yml` (the kit's own) — drops `python3-pip`, `pyyaml`, `pytest`
  from `before_script` and runs the Node engine tests instead.

Payload docs (all English):
- `templates/common/POST_INSTALL.md` — the venv / `--break-system-packages` /
  `python -m pytest` guidance becomes obsolete. This is the port's biggest
  documentation win; the current file spends substantial space on pip
  environment confusion that stops existing.
- `templates/common/README.md` — the file tree and the "run the tests" step.
- `templates/common/SELF_TEST_PROMPT.md` — any command it tells the agent to run.
- `templates/common/{AGENTS,CLAUDE,GEMINI}.md` — check for engine paths.

Kit docs: root `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `CHANGELOG.md`, and
`RULES.md` (via `node docs.js`, never by hand).

Behavior parity (G14): the Python suite has 24 named test cases covering blocked
commands, path escape, shell-token path matching, ignore-file handling
(including bare-pattern matching and the deliberate non-honoring of `!`
negations), guardrail self-protection, and the unparseable-input deny default.
The Node suite must reproduce **every one of them, case for case**, in the
zero-dependency style of `test/install.test.js`. A port that passes fewer tests
than the original is not a port.

Logic that has no Node stdlib equivalent and must be reimplemented, not
translated line-by-line: `fnmatch` matching, the gitignore-line→fnmatch
translation, `pathlib` resolution semantics (symlinks, `~`, relative-to-workspace),
and the `@dataclass` decision object.

## Constraints (G-series)

Cited by ID in specs, tasks, and hard stops.

| ID | Constraint | Applies to |
|---|---|---|
| **G1** | **Dependencies are a human decision.** Kit-side JS (`install.js`, `stacks.js`, `generate.js`, `docs.js`, `test/install.test.js`) stays **zero-dependency** — stdlib only. The payload carries exactly one authorized dependency: **`js-yaml` (MIT), approved 2026-08-26** for reading `policy.yaml`. It ships **vendored** — a single file under `templates/common/vendor/`, required by relative path — so no target project ever runs `npm install` to get guardrails. Any further dependency, either side, needs explicit approval. Never add one as an implementation detail. | always |
| **G2** | **Fail closed.** Unparseable tool input, a broken regex in `policy.yaml`, a missing policy file, or an unreadable path must produce `deny` or `ask` — never `allow`. A guardrail that fails open is worse than none, because it is trusted. | engine, adapters |
| **G3** | **One audit point.** All decision logic lives in the shared engine's `evaluate()`. Adapters only translate harness JSON in and out. Never put harness-specific parsing in the engine, and never put a policy decision in an adapter. | engine, adapters |
| **G4** | **Never overwrite.** The installer writes a `.new` sibling instead of clobbering an existing file. Re-running the installer on a configured project must stay safe. | installer |
| **G5** | **Docs sync.** `RULES.md` is generated. Change core rules → run `node docs.js` and commit the result. CI diffs it and fails on drift. Never hand-edit `RULES.md`. | `generate.js`, `docs.js`, engine |
| **G6** | **Stack parity.** A new or changed stack needs its `ci` (GitHub) **and** `gitlabCi` (Docker image) profile **and** a `STACK_MARKERS` fixture in `test/install.test.js`. Missing `gitlabCi` silently emits a broken GitLab pipeline. | `stacks.js` |
| **G7** | **Harness parity.** An engine signature or contract change must be applied to all three adapters *and* all three hook configs. Two-out-of-three is a silent breakage for the third harness's users. | payload |
| **G8** | **Self-protection is a deny, and it covers reads separately.** Writing or deleting `.agent-security/**`, any harness hook config, `.husky/**`, `.github/workflows/**`, or any `KNOWN_IGNORE_FILES` entry returns **`deny`** — for structured file calls, for shell commands that would modify them (`rm`, `mv`, `>`, `sed -i`, `chmod`, ...), and for any unrecognized tool name. `ask` was wrong here: it put the most consequential decision in the system behind the click a distracted human makes fastest, and the prize for that click is every guardrail off. The sanctioned path is a human editing the file or `toggle.js --disable` first — deliberate, and visible in `git diff`. **Reading** these files is `allow` (see `READ_ONLY_TOOLS`): reading disables nothing, and prompting on reads only trains the human to approve `.agent-security/**` reflexively — it also made `SELF_TEST_PROMPT.md` unrunnable. A shell command that merely names the directory stays `ask`, because the tokenizer cannot prove it is read-only. | engine |
| **G9** | **Ignore files only add.** `!negation` lines in `.cursorignore`/`.aiignore`/etc. are deliberately never honored. A repo's ignore file may only *add* protection, never remove it. This is intentional, not a bug — do not "fix" it. | engine |
| **G10** | **Cross-platform.** Kit-side JS must work on Windows, macOS, and Linux. `npm test` runs on Windows. No bash-only assumptions, no hardcoded `/tmp`, no POSIX-only path handling. | installer, tests |
| **G11** | **Exactly one CI file.** `.github/workflows/security.yml` **or** `.gitlab-ci.yml` — never both, and never guessed when the host is unknown and `--ci` was not passed. | installer |
| **G12** | **hooksPath or nothing — but never steal it.** Git hooks in `.husky/` never execute unless `core.hooksPath` points at them. `configureHooksPath()` sets it when the target is a git repo; when it is not, the final summary must say the step is still required. **It currently overwrites an existing `core.hooksPath` without checking**, and setting `hooksPath` silences the previous hook directory *entirely* — including plain `.git/hooks/`, which anything may have populated (`pre-commit`, lefthook, husky v4, IDEs). Verified: the old directory stops existing for git, and hook types we do not generate (`commit-msg`, `post-merge`, …) die outright. **Chain, do not replace:** shim every hook found in the previously-effective directory (old `hooksPath`, else `.git/hooks`, ignoring `*.sample`) so the project's hook runs first and its exit code propagates. Ask the human only when chaining is unsafe — target outside the repo, unreadable directory, or a `.husky/<hook>` we did not write. Breaking a project's existing safeguard while installing a safeguard is the exact failure this kit exists to prevent. | installer |
| **G13** | **Interpreter parity.** The interpreter in every hook config's `command` string must match the engine's actual runtime. A mismatch means the hook silently never runs — the guardrails appear installed and enforce nothing. | payload |
| **G14** | **Behavior parity on port.** Porting the engine may not drop a single test case or a single rule. Prove it test-for-test, comparing against `main` (`git show main:templates/common/policy_engine.py`), not against the working tree. | port work |
| **G15** | **Uninstall is subtractive, honest, and confirmed.** It removes what the kit put there, never what the user edited: only files the installer created that are still byte-identical to what it wrote, per the manifest. Anything modified, unrecorded, or unrecognized is *reported for the human*, never deleted and never programmatically rewritten. It must print the full plan — what will be deleted, what will be kept and why, what happens to `core.hooksPath` and `.gitignore` — and wait for confirmation before acting (`--yes` to skip, `--dry-run` to stop after the plan). Plan and summary must both state, unmissably, **whether the guardrails are still active**. An uninstall may end deliberately incomplete; ending silently with enforcement still wired may not. It must also unset `core.hooksPath` (the mirror of G12) and revert only the `.gitignore` lines it added. Deleting a user's edited policy or contract file is data loss, not cleanup. | uninstaller |
| **G16** | **No kill switch inside the engine.** Deactivation works by **unhooking** — removing the harness's hook wiring so the engine is never called — never by a flag, sentinel file, or `enabled: false` that the engine itself reads and then allows everything. A code path inside the engine whose job is to return `allow` for all input is a fail-open path (G2) and a single file an agent could try to create to free itself (G8). Unhooking is also visible in a `git diff`; a silent flag is not. | engine, uninstaller |
| **G17** | **The kit never commits.** The target repository's history belongs to the client. Nothing kit-side or payload may run `git add`, `commit`, `push`, `checkout`, `reset`, `merge`, `rebase`, `stash`, `tag`, `branch`, or any other history- or index-mutating command — not in `install.js`, not in the uninstaller or toggle, and not in anything the kit *generates* (a hook that staged files for you would keep doing it, in everyone's clone). The kit reads git state freely and writes exactly one piece of git config, `core.hooksPath` (G12), which it records and reverts. Everything it writes is left **untracked**, for the client to review and commit themselves. Enforced by tests that inspect invocation sites and generated content, not by grepping for words — the sources legitimately contain `git push --force` as a blocked-command pattern. | installer, uninstaller, renderers |

## Repo-Specific Facts That Change Specs

- **This kit is not self-installed.** There is no `.agent-security/` at this
  repo's root and no active PreToolUse hook. Nothing enforces the rules on work
  done *in this repo* — this skill's hard stops are the only guardrail. Do not
  assume a policy engine will catch a mistake here.
- **There are no agent-ignore files here.** Only `.gitignore`. Every source file
  is readable. Ignore-file handling is a *payload behavior* to test, not a
  boundary that applies to working in this repo.
- **Never install into this repo.** Test installs go into a scratch directory.
  Use the session scratchpad, never the repo root, never `.` by accident.
- **Language convention.** `install.js` console output and root
  `CONTRIBUTING.md`/`Tasks/**` prose are Spanish. Everything under
  `templates/**` is English, because it ships to other people's projects.
  Preserve whichever applies; do not translate existing text as a side effect.
- **Supported stacks** are exactly `node`, `php`, `java-maven`, `java-gradle`,
  `python`. Note the trap: the `python` **stack** describes a target project
  written in Python and is unrelated to the engine's own runtime. A spec that
  says "Python" must say which one it means.
- **Supported harnesses** are exactly `claude-code`, `vscode-codex`,
  `antigravity`.
- **There are no installs of this kit in the wild yet** (as of 2026-08-26).
  Every "what about existing installs?" concern is therefore **forward-looking,
  not a migration problem**. G4 still holds — the installer must never
  overwrite — but no spec needs a migration path for the Python-era payload,
  because nobody is running it. The first shipped version is the Node one, with
  the install manifest included from day one. Do not spend spec space on
  backward compatibility that has no subject.
- **`.agents/` here is kit-side rule docs, not payload.** This repo's
  `.agents/constraints.md`, `rules.md`, and `behavior.md` are instructions for
  working *in this repo*. Confusingly, `.agents/` is also where `install.js`
  writes the **Antigravity payload** in a target project
  (`.agents/hooks.json`, `.agents/scripts/pretooluse.*`). There is no filename
  clash today because this kit is not self-installed, but never reason from one
  to the other, and never let a spec describe `.agents/*.md` as something the
  installer ships.
- **`Tasks/PLAN.md` and `Tasks/PROGRESS.md` are legacy** — the completed
  installer-next-steps work, kept as reference precedent. They do not follow the
  folder convention below. Do not extend them; do not restructure them either.

## Non-Negotiable Preflight

Before drafting or modifying any spec:

1. Read root `CLAUDE.md`.
2. Read these if present (they may not exist yet — never block on a missing one):
   `.agents/constraints.md`, `.agents/rules.md`,
   `.agents/behavior.md`. The G-series above is authoritative regardless.
3. Identify the affected component(s) from the Component Matrix, and state
   kit-side vs payload for each.
4. Confirm whether the Node port has landed (`ls templates/common/`) before
   writing any path from the target mapping.
5. Codebase exploration — fastest available path:
   - If `engram` MCP memory tools are available, call `mem_search` to recover
     context from previous sessions. If unavailable, proceed — never block on MCP.
   - If `code-review-graph` MCP tools are available, use `detect_changes`,
     `get_impact_radius`, `query_graph`, `semantic_search_nodes` before file
     scanning. If unavailable, fall back silently to Grep/Glob/Read.
6. Read the source request and any existing `Tasks/<slug>/` folder.
7. Check `git status` and the current branch. Work on a feature branch; never
   commit or push unless explicitly asked.
8. Identify the owner role: Installer/CLI, Stack Profiles, Renderers, Policy
   Engine, Harness Adapter, Payload Docs, Kit CI, or Kit Tests.

## Artifact Model

Create or maintain a task folder under `Tasks/<feature-slug>/`:

```text
Tasks/<feature-slug>/
  00-overview.md              # goal, global contracts, task index
  01-<first-task>.md          # smallest implementation slice
  02-<second-task>.md
  ...
  09-ai-automation-runbook.md # agent/command/test execution guide when needed
```

Reference templates live in `references/` inside this skill folder.

**`Tasks/` is gitignored on purpose.** These are working documents, not
deliverables: they capture the reasoning while a feature is in flight and are
deliberately not persisted. Do not propose tracking them. When a feature lands,
the durable record goes where users and contributors actually read it —
`CHANGELOG.md`, `CONTRIBUTING.md`, `README.md`, `RULES.md`, and code comments —
written from what actually shipped, not from what the plan said. A task file is
scaffolding; the shipped docs are the building.

## Workflow Commands

Five slash commands drive the lifecycle. Each is a thin wrapper in
`.claude/commands/` that loads this skill and then follows the detailed
procedure in `commands/<name>.md` inside this skill folder:

| Command | Gate | Argument |
|---|---|---|
| `/sdd-new` | Idea → Draft | feature slug or description |
| `/sdd-refine` | Draft → Reviewed | `Tasks/<slug>/00-overview.md` |
| `/sdd-plan` | Approved → Planned | `Tasks/<slug>/00-overview.md` |
| `/sdd-task` | Planned → Tasked | `Tasks/<slug>/00-overview.md` |
| `/sdd-implement` | Tasked → Tested | `Tasks/<slug>/NN-<task>.md` |

The wrappers are what make the commands discoverable — Claude Code does not scan
a skill's own `commands/` subfolder. If a command stops resolving, check that its
wrapper still exists in `.claude/commands/`.

## Spec Lifecycle

```text
Idea -> Draft -> Reviewed -> Approved -> Planned -> Tasked -> Implementing -> Tested -> Done
```

Do not advance to `Approved`, `Planned`, `Tasked`, or `Done` unless that gate is
satisfied.

## Gates

### Idea -> Draft
Produce the first spec from the request and repo context.

Required sections:
- Goal
- Context — component(s) from the matrix, and **kit-side / payload / both**
- Current Behavior
- Desired Behavior
- In Scope
- Out of Scope
- Input Contract
- Output Contract
- Failure Contract
- Compatibility Contract
- **Generation Contract** — which files the installer writes/skips/`.new`s
- **Payload Contract** — what lands in a target project, and the `.new` behavior
  where the file can already exist (G4). No migration story: no installs exist
- **Policy Semantics Contract** — which decisions change from `allow`/`ask`/`deny`
- **Interpreter/Runtime Contract** — which runtime the payload requires, and
  which hook config `command` strings change (G13)
- **Docs Sync Contract** — does `RULES.md` change? via `node docs.js` only
- **Parity Contract** — stacks (G6), harnesses (G7), CI formats (G11)
- **Cross-Platform Contract** — Windows/macOS/Linux impact (G10)
- Observability/Logging Contract — `audit.log`, `completion_reports.log`,
  installer console output
- Open Questions

### Draft -> Reviewed
Resolve contradictions and missing decisions.

General checklist:
- Every open question is a real product or architecture decision, not a placeholder.
- Every new rule, path, or command has a stated `allow`/`ask`/`deny` action and a
  human-readable `reason` — the reason is user-facing text, write it as such.
- Kit-side vs payload is stated for every changed file.
- No dependency beyond the authorized vendored `js-yaml` (G1). Anything further
  is an Approved-gate question, not a checklist item.
- Fail-closed behavior is specified for every new failure mode (G2).
- Adapters gain no logic (G3).
- `.new` behavior is stated (G4). Do not write a migration section for a
  population of zero — see Repo-Specific Facts.
- `RULES.md` regeneration is planned if core rules changed (G5).
- New/changed stack covers `ci` + `gitlabCi` + `STACK_MARKERS` (G6).
- All three adapters and all three hook configs are covered (G7, G13).
- Self-protection still holds — the change cannot open a path for an agent to
  disable its own guardrails (G8).
- Ignore-file negation is still not honored (G9).
- No POSIX-only assumption, no hardcoded `/tmp` (G10).
- Exactly one CI file is still emitted (G11).
- `core.hooksPath` handling is unchanged or explicitly addressed (G12).
- Language convention respected: Spanish CLI output, English payload docs.
- Test plan names actual test cases in `test/install.test.js` and/or the engine
  suite — not "add tests".

Component-specific checklist (apply only what is relevant):

**Installer CLI (`install.js`):**
- New flag → validated with a clear Spanish error on a bad value, documented in
  `--help`, covered by a `test/install.test.js` case, and mentioned in `README.md`.
- Any change to the "próximos pasos" summary stays consistent with
  `templates/common/POST_INSTALL.md`, which explains those same steps at length.
- Non-interactive path (`--yes`, `curl | bash` with no TTY) must not hang or
  prompt.

**Stack profiles (`stacks.js`):**
- `checks` commands must degrade gracefully when the tool is absent — follow the
  existing `--if-present` and `[ -x ... ] || echo "skipping"` patterns rather
  than failing the gate on a tool the project never installed.
- `changedExtensions` must actually be the extensions that should trigger those
  checks.
- `extraBlocked` patterns are regexes matched against raw command text — escape
  them for YAML single-quoting as `generate.js` expects.

**Renderers (`generate.js`):**
- Output must be valid YAML for `policy.yaml` and valid workflow syntax for both
  CI formats. Both CI builders change together or neither does.
- Anything emitted into a target project that invokes the engine must use the
  correct interpreter (G13).

**Policy engine (payload):**
- State the position in `evaluate()`'s order: (1) structured file tool calls,
  (2) shell commands — `blocked_commands` regexes then path-like tokens,
  (3) guardrail self-protection, (4) default `allow`.
- Shell tokenization is best-effort and not a real shell parser. A new rule must
  not silently depend on it being one; state the known evasion surface instead of
  implying coverage.
- `protected_paths` merges `policy.yaml` and live ignore files on every call
  (mtime-cached). A change must preserve that liveness — do not bake anything in
  at install time.
- **Every path shape that reaches a file must reach the same decision.** A rule
  that catches one spelling is not a rule. Found in the field: on Windows,
  `cat ~/.ssh/id_rsa` denied while `cat /c/Users/<user>/.ssh/id_rsa` — the same
  file, through a path Git Bash reads fine — was **allowed**, because `/c/...`
  was not treated as absolute and matched no anchored pattern. See
  `expandShellDrivePath()`. When adding path handling, test the `~`, absolute,
  relative, MSYS `/c/`, and Cygwin `/cygdrive/c/` forms of the same target.
- Every new rule gets a test case in the engine suite.

**Harness adapters (payload):**
- Translation only. Input shape in, decision shape out, nothing else.
- Confirm the harness's actual JSON shape before changing a mapping; each of the
  three differs, and the adapter is where that difference is allowed to live.

**Payload docs:**
- Commands shown must be the commands the installer actually prints. These drift
  silently — cross-check `install.js` against `POST_INSTALL.md` every time.

### Reviewed -> Approved
Ask the user to approve unresolved decisions. Do not infer behavior that is not
documented.

Hard stops — stop and ask:
- **Adding any dependency** to `package.json`, or any runtime dependency to the
  payload (G1).
- **Any change that could make the engine fail open** (G2).
- **Moving decision logic into an adapter**, or harness-specific parsing into the
  engine (G3).
- **Making the installer overwrite an existing file** (G4).
- **Hand-editing `RULES.md`** instead of running `node docs.js` (G5).
- **Adding a stack without `gitlabCi`** or without a `STACK_MARKERS` fixture (G6).
- **Changing the engine contract without updating all three adapters and all
  three hook configs** (G7).
- **Weakening self-protection** — any change that lets an agent edit
  `.agent-security/**`, a hook config, `.husky/**`, `.github/workflows/**`, or an
  ignore file without `ask` (G8).
- **Honoring `!negation` lines** in ignore files (G9).
- **Windows-breaking changes** to kit-side JS (G10).
- **Emitting both CI files**, or guessing the host when it is unknown (G11).
- **Changing the payload's required interpreter** without updating every hook
  config and every doc that names it (G13).
- **Dropping a test case during the port** (G14).
- **Switching `policy.yaml` to another format** — it stays YAML, read with the
  vendored `js-yaml` (decision of record).
- **Requiring `npm install` in a target project**, or requiring `js-yaml` from a
  target-project `node_modules` instead of the vendored copy (G1).
- **Reintroducing a Python fallback engine** — there is exactly one engine (G3).
- **Running the installer against this repo** instead of a scratch directory.
- **Making the kit run any git command that mutates the target repo** —
  `add`, `commit`, `push`, `checkout`, `reset`, `merge`, `rebase`, `stash`,
  `tag`, `branch` — from the installer, the uninstaller, or anything the kit
  *generates* (G17). `core.hooksPath` is the one contracted git write.
- **Committing or pushing** without being asked.
- Product behavior that is not decided in the spec.

### Approved -> Planned
Create an ordered implementation plan containing:
- Dependency order — and explicitly, whether the task depends on the Node port
  having landed.
- Files allowed to change.
- Files explicitly not allowed to change.
- Required verification commands (see below).
- Required tests: named cases in `test/install.test.js` and/or the engine suite.
- Scratch-directory install matrix — which stacks x which harnesses x which
  `--ci` values must be exercised.
- Rollback / non-breakage notes, including existing-install impact.

### Planned -> Tasked
Split into mini tasks, each implementable in one focused coding pass.

Each task file must include: Status, Goal, AI Automation Contract, SDD Spec,
Exact Changes, Implementation Order, Tests To Add Or Update, Regression Tests To
Run, Pass Criteria, Non-Breakage Criteria, Hard Stops.

Split rules for this repo:
- `stacks.js` data changes, `generate.js` rendering changes, and `install.js` CLI
  changes are separate tasks when they have different verification gates.
- Never combine a kit-side change with a payload change in one task unless the
  payload change is what the kit-side change exists to deliver.
- The engine port is not one task. At minimum: the YAML/policy-loading decision,
  the engine itself, the test-suite parity port, the three adapters, the three
  hook configs, the generators (`generate.js` + `install.js` + `docs.js`), the
  kit CI, and the payload docs.

### Tasked -> Implementing
Before code edits:
- Read the task file completely.
- Restate input/output/failure contracts.
- Confirm the task's exact file scope, and confirm each path exists (or is
  supposed to be created).
- Inspect affected code with graph tools if available, else grep/glob/read.
- Confirm kit-side vs payload for every file you are about to touch.

### Implementing -> Tested
After code edits, in this order:

```bash
node --check install.js
```

```bash
npm test
```

```bash
node docs.js
```

Then confirm `RULES.md` did not drift unexpectedly (CI does the same diff):

```bash
git diff --stat RULES.md
```

Then a real install into a scratch directory — never this repo:

```bash
node install.js --target <scratch>/fixture-node --agents claude-code --stacks node --git-hooks true --ci github --yes
```

Then the engine's own suite, which exists only after installing. Use whichever
runtime is current — today Python, after the port Node:

```bash
python -m pytest <scratch>/fixture-node/.agent-security/test_policy_engine.py -q
```

Finally:
- Re-run the install matrix for every stack and harness the change touches.
- Inspect the generated files by hand for anything the tests do not assert
  (interpreter strings, YAML validity, exactly-one-CI-file).
- Update `CHANGELOG.md` for any user-facing change.
- Update `CONTRIBUTING.md` if the contributor workflow changed (e.g. a new
  required field in a stack profile).
- Save new decisions via `engram` `mem_save` if available.
- Document any skipped verification with the exact command and the exact reason.

## Verification Reference

Real commands in this repo. There is no `/test`, `/audit`, `/manage-migrations`,
or `/memory` slash command here unless you have added one — use these.

| Situation | Command |
|---|---|
| Syntax check before running anything | `node --check install.js` (same for `generate.js`, `stacks.js`, `docs.js`) |
| Installer regression suite | `npm test` |
| Regenerate `RULES.md` | `node docs.js` (alias `npm run docs`) |
| Confirm no docs drift | `node docs.js` then `git diff --exit-code RULES.md` |
| See all installer flags | `node install.js --help` |
| Scratch install | `node install.js --target <scratch>/<name> --agents <agent> --stacks <stack> --git-hooks true --ci github --yes` |
| Engine suite (after install) | `python -m pytest <scratch>/<name>/.agent-security/test_policy_engine.py -q` → Node equivalent after the port |
| Manual end-to-end policy check | follow `<scratch>/<name>/.agent-security/SELF_TEST_PROMPT.md` with a real agent |
| Full pipeline, as CI runs it | `npm test`, `RULES.md` diff, then install + engine tests for each of the five stacks |

Stack marker fixtures, for building scratch dirs by hand: `node` →
`package.json`; `php` → `composer.json`; `java-maven` → `pom.xml`;
`java-gradle` → `build.gradle`; `python` → `pyproject.toml`.

## Review Rules

- Prefer smaller tasks over broad ones spanning kit-side and payload.
- Keep `policy.yaml` keys, engine decision shapes, and adapter I/O contracts
  unchanged unless the spec explicitly approves a break — installed projects
  depend on all three.
- Additive behavior must be labeled additive.
- If existing code contradicts the spec, update the spec or ask — do not code
  against a spec you know to be wrong.
- Never hand-edit generated files: `RULES.md` (use `node docs.js`), and in target
  projects `policy.yaml` / `.husky/*` / CI files (regenerate via the installer).
- Do not move implementation detail out of task files into vague overview prose.
  The implementer must be able to work from one task file alone.
- A test that does not run in CI does not count. `test/install.test.js` runs in
  `.gitlab-ci.yml`; add cases there, not to a side script.
- When a change affects what the guardrails *actually block*, say so in plain
  language in `CHANGELOG.md`. The people relying on this kit are relying on that
  list being true.
