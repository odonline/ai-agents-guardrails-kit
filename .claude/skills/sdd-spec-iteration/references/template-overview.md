# Feature Name

## Status
Draft | Reviewed | Approved | Planned | Tasked | Implementing | Tested | Done

## Goal
One-line summary of the feature.

## Summary
What this delivers and why it matters. Name the component(s) from the skill's
Component Matrix.

## Context
- **Component(s)**: Installer CLI | Stack Profiles | Renderers | Docs Generator |
  Policy Engine | Completion Gate | Harness Adapters | Harness Hook Configs |
  Agent Contract Payload | Install-time Docs | Engine Tests | Installer Tests | Kit CI
- **Side**: kit-side | payload | both — per file, not per feature
- **Engine port status at time of writing**: has the Python→Node port landed?
  (`ls templates/common/`) — every Node-target path below assumes an answer
- **Related files**: the files that will actually change
- **Current behavior**: what happens today
- **Desired behavior**: what should happen after
- **Stacks affected**: node | php | java-maven | java-gradle | python | all | none
  (this is the *target project's* language, not the engine's runtime)
- **Harnesses affected**: claude-code | vscode-codex | antigravity | all

## In Scope
- ...

## Out of Scope
- ...

## Global SDD Contracts

### Input Contract
CLI flags and their validation; tool-call JSON shapes the engine receives;
`policy.yaml` keys read.

### Output Contract
Files written and their exact paths; console output (Spanish for the installer);
the decision shape returned by the engine.

### Failure Contract
What happens on bad input, a missing file, a broken regex, an unreadable path, a
non-git target, an unknown git host. Every case must fail closed (G2) or fail
loud — never silently allow, never silently skip.

### Compatibility Contract
- `policy.yaml` keys, engine decision shape, and adapter I/O contracts that must
  not change
- (No installs in the wild yet — say "n/a" rather than inventing a migration)

### Generation Contract
- Files the installer writes
- Files it skips (already present → `.new` sibling, G4)
- Files it must never write
- Exactly one CI file: `.github/workflows/security.yml` or `.gitlab-ci.yml` (G11)

### Payload Contract
- What lands in the target project, at what path
- `.new` behavior if the target file can already exist (G4). No installs in the
  wild yet, so no migration story — but if that ever changes, a payload fix that
  closes a security hole must say plainly that older installs stay exposed until
  the `.new` file is merged

### Policy Semantics Contract
- New/changed rules with their action: `allow` | `ask` | `deny`
- The user-facing `reason` string for each
- Position in `evaluate()`'s order: structured file calls → shell commands
  (regex, then path-like tokens) → guardrail self-protection → default allow
- Self-protection unchanged or explicitly addressed (G8)
- Ignore-file `!negation` still not honored (G9)

### Interpreter/Runtime Contract
- Runtime the payload requires (`python3` today, `node` after the port)
- Which hook config `command` strings change (G13):
  `templates/claude-code/settings.json`,
  `templates/vscode-codex/hooks/security.json`,
  `templates/antigravity/hooks.json`
- Whether target projects are guaranteed to have that runtime, and what
  `install.js` reports when it is missing

### Docs Sync Contract
- Does `RULES.md` change? If yes: `node docs.js`, never by hand (G5)
- Does `docs.js` still find what it parses out of the engine source?

### Parity Contract
- Stacks: `ci` + `gitlabCi` + `STACK_MARKERS` (G6)
- Harnesses: all three adapters + all three hook configs (G7)
- CI: both `buildCiWorkflow` and `buildGitlabCiYaml` (G11)
- Tests: no case dropped (G14)

### Cross-Platform Contract
Windows / macOS / Linux impact. No bash-only assumptions, no hardcoded `/tmp`,
no POSIX-only path handling (G10). `npm test` runs on Windows.

### Observability/Logging Contract
- `.agent-security/audit.log` — engine decisions
- `.agent-security/completion_reports.log` — completion gate reports
- Installer console output and the dynamic "próximos pasos" summary (Spanish)

### Dependency Contract
Kit-side stays zero-dependency. The payload may use only the authorized vendored
`js-yaml` (G1). Anything further is an Approved-gate question for the human,
recorded in Open Questions.

## Required Verification
- `node --check <changed .js files>`
- `npm test`
- `node docs.js` then `git diff --stat RULES.md`
- Scratch install matrix: which stacks x harnesses x `--ci` values
- Engine suite against each fresh install
- Manual pass with `.agent-security/SELF_TEST_PROMPT.md` when policy behavior
  changed

## Hard Stops
Cite by G-series ID. At minimum:
- Do NOT add a dependency (G1).
- Do NOT let the engine fail open (G2).
- Do NOT put decision logic in an adapter (G3).
- Do NOT overwrite an existing file in a target project (G4).
- Do NOT hand-edit `RULES.md` (G5).
- Do NOT add a stack without `gitlabCi` + `STACK_MARKERS` (G6).
- Do NOT change the engine contract for fewer than all three harnesses (G7, G13).
- Do NOT weaken guardrail self-protection (G8).
- Do NOT honor `!negation` lines (G9).
- Do NOT break Windows (G10).
- Do NOT emit both CI files or guess an unknown host (G11).
- Do NOT run the installer against this repo.
- Do NOT commit or push unless asked.

## Open Questions
Decision-grade only. Mark any that block the `Reviewed -> Approved` gate.

(For engine-port work these are already decided — cite them, do not reopen:
`policy.yaml` stays YAML read with vendored `js-yaml`; `node` is a hard
requirement with no Python fallback.)

## Proposed Task List
1. `01-<first-step>.md` — description
2. `02-<second-step>.md` — description
3. `03-<third-step>.md` — description

## Reference Templates
`references/template-task.md` and `references/template-runbook.md` in this skill
folder.
