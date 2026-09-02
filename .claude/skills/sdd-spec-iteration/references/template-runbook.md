# AI Automation Runbook

## Purpose
How an agent should implement this feature safely in **ai-agents-guardrails-kit**.
Read this before starting any task in this folder.

## Required Preflight
1. Read root `CLAUDE.md`.
2. Read `.claude/skills/sdd-spec-iteration/SKILL.md`.
3. Read `.agents/constraints.md`, `.agents/rules.md`,
   `.agents/behavior.md` **if present** — never block on a missing one.
4. `git status` + confirm the current branch. Never commit or push unless asked.
5. `ls templates/common/` — confirm whether the Python→Node engine port has
   landed. Node-target paths do not exist before it does.
6. Codebase exploration: `engram` `mem_search` and `code-review-graph` tools if
   available; otherwise grep/glob/read.
7. Read the specific task file and restate its contracts before editing.

## Owner Roles

| Work area | Role | Side |
|---|---|---|
| `install.js` — CLI, flags, prompts, summary | Installer/CLI | kit |
| `stacks.js` — per-language profiles | Stack Profiles | kit |
| `generate.js` — `policy.yaml`, hooks, both CI formats | Renderers | kit |
| `docs.js` / `RULES.md` | Docs Generator | kit |
| `templates/common/policy_engine.*` | Policy Engine | payload |
| `templates/common/final_check.*` | Completion Gate | payload |
| `templates/*/…/pretooluse.*` | Harness Adapter | payload |
| `templates/*/{settings,security,hooks}.json` | Harness Hook Configs | payload |
| `templates/common/*.md` | Payload Docs | payload |
| `test/install.test.js` | Kit Tests | kit |
| `.gitlab-ci.yml` | Kit CI | kit |

## Command Matrix

| Situation | Command |
|---|---|
| Syntax check | `node --check install.js` (also `generate.js`, `stacks.js`, `docs.js`) |
| Installer regression suite | `npm test` |
| Regenerate `RULES.md` | `node docs.js` |
| Confirm no docs drift | `node docs.js` then `git diff --exit-code RULES.md` |
| See installer flags | `node install.js --help` |
| Scratch install | `node install.js --target <scratch>/<name> --agents <agent> --stacks <stack> --git-hooks true --ci github --yes` |
| Engine suite (post-install only) | today `python -m pytest <scratch>/<name>/.agent-security/test_policy_engine.py -q`; after the Node port `node <scratch>/<name>/.agent-security/test_policy_engine.js` |
| End-to-end policy check | follow `<scratch>/<name>/.agent-security/SELF_TEST_PROMPT.md` with a real agent |

There is no `/test`, `/audit`, `/manage-migrations`, or `/memory` command in this
repo unless one has been added under `.claude/commands/`. Use the commands above.

## Scratch Install Matrix

Never install into this repo. Build fixtures in a scratch directory with the
marker file for the stack:

| Stack | Marker file |
|---|---|
| `node` | `package.json` |
| `php` | `composer.json` |
| `java-maven` | `pom.xml` |
| `java-gradle` | `build.gradle` |
| `python` | `pyproject.toml` |

Git host detection reads `git remote get-url origin` in the target, so to
exercise CI selection: no remote → `unknown`; a `github.com` remote → GitHub
Actions; any URL containing `gitlab` → GitLab CI (covers self-hosted). `--ci`
overrides all of it.

## Constraints Reference

| ID | Rule | Check when |
|---|---|---|
| G1 | Kit-side zero-dep; payload may use only the vendored `js-yaml` | always |
| G2 | Fail closed on bad input / broken regex / missing policy | engine, adapters |
| G3 | One audit point — logic in the engine, translation in adapters | engine, adapters |
| G4 | Never overwrite; write `.new` | installer |
| G5 | `RULES.md` regenerated, never hand-edited | core rule changes |
| G6 | Stack parity: `ci` + `gitlabCi` + `STACK_MARKERS` | `stacks.js` changes |
| G7 | Harness parity: three adapters + three hook configs | engine contract changes |
| G8 | Self-protection always `ask` | engine changes |
| G9 | Ignore-file negation never honored | engine changes |
| G10 | Cross-platform; `npm test` passes on Windows | kit JS changes |
| G11 | Exactly one CI file | installer, renderers |
| G12 | `core.hooksPath` or hooks are cosmetic | hook installation |
| G13 | Interpreter parity in hook configs | payload runtime changes |
| G14 | No test case dropped on port | port work |
| G15 | Uninstall deletes only manifest-recorded, unmodified files | uninstaller |
| G16 | Deactivation unhooks; no kill switch inside the engine | engine, uninstaller |

## SDD Implementation Pattern
For each task:
1. Restate input, output, and failure contracts.
2. Add or update the named tests first when feasible.
3. Implement only the task's file scope.
4. Run `node --check`, `npm test`, `node docs.js` + diff.
5. Run the scratch install matrix, then the engine suite on each fixture.
6. Inspect generated files by hand for what tests do not assert.
7. Update `CHANGELOG.md` (and `CONTRIBUTING.md` if the workflow changed).
8. Save decisions via `engram` `mem_save` if available.

## Hard Stops
Stop and ask before:
- Adding any dependency beyond the authorized vendored `js-yaml` (G1).
- Anything that could make the engine fail open (G2).
- Moving logic into an adapter, or harness parsing into the engine (G3).
- Making the installer overwrite a file (G4).
- Hand-editing `RULES.md` (G5).
- A stack without `gitlabCi` or a `STACK_MARKERS` fixture (G6).
- An engine contract change that reaches fewer than all three harnesses (G7, G13).
- Weakening self-protection (G8) or honoring `!negation` lines (G9).
- Anything Windows-breaking (G10).
- Emitting both CI files or guessing an unknown host (G11).
- Changing `policy.yaml`'s format, or resolving `js-yaml` from anywhere but the
  vendored copy (G1).
- Reintroducing a Python fallback engine (G3).
- Installing into this repo.
- Committing or pushing unasked.

## Definition Of Done
- Task pass criteria satisfied; non-breakage criteria verified.
- `npm test` green.
- `node docs.js` produces no unexpected `RULES.md` drift.
- Scratch install + engine suite green for every stack and harness touched.
- Generated output manually inspected.
- `CHANGELOG.md` updated for user-facing changes.
- Any skipped verification documented with the exact command and reason.

## Per-Task Test Gate
Do not mark a task complete until:
- Its named cases in `test/install.test.js` and/or the engine suite pass.
- The listed regression commands pass.
- Failures are fixed, or documented with the exact failing command and its real
  output. A failing suite is never reported as passing.
