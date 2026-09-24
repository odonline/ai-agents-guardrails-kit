# Task NN - Task Title

## Status
Draft | Reviewed | Approved | Implemented | Tested

## Goal
One sentence describing the behavior this task delivers.

## AI Automation Contract
- **Owner role**: Installer/CLI | Stack Profiles | Renderers | Docs Generator |
  Policy Engine | Harness Adapter | Payload Docs | Kit CI | Kit Tests
- **Side**: kit-side | payload | both (justify "both" in one line or split the task)
- **Depends on**: the Python→Node engine port having landed? yes/no
- **Read before changing**:
  - root `CLAUDE.md`
  - `.claude/skills/sdd-spec-iteration/SKILL.md`
  - `.agents/*.md` if present
- **Verification commands**:
  - `node --check <file>`
  - `npm test`
  - `node docs.js` (if core rules changed)
  - scratch install + engine suite
- **Forbidden changes**:
  - Do NOT touch `package.json` dependencies; payload may use only the vendored `js-yaml` (G1)
  - Do NOT touch files outside Exact Changes
  - Do NOT hand-edit `RULES.md` (G5)
  - Do NOT install into this repo

## SDD Spec

Input contract:
- CLI flags / tool-call JSON / `policy.yaml` keys consumed, with types and validation

Output contract:
- Exact files written and their paths; console output; engine decision shape

Failure contract:
- Bad input, missing file, broken regex, non-git target, unknown git host — each
  must fail closed (G2) or fail loud

Compatibility contract:
- `policy.yaml` keys, engine decision shape, adapter I/O left unchanged
- (No installs in the wild yet — state "n/a" rather than inventing a migration)

Generation contract:
- Written / skipped-as-`.new` (G4) / never-written
- Exactly one CI file (G11)

Payload contract:
- What lands in the target project
- `.new` behavior if the file can already exist (G4)

Policy semantics contract:
- New or changed rules, each with `allow`/`ask`/`deny` and its user-facing reason
- Self-protection unaffected (G8); negation still not honored (G9)

Interpreter/runtime contract:
- Required runtime; which of the three hook configs change (G13)

Docs sync contract:
- `RULES.md` regenerated via `node docs.js`: yes/no
- `docs.js` still resolves what it parses from the engine source: yes/no

Parity contract:
- Stacks: `ci` + `gitlabCi` + `STACK_MARKERS` (G6)
- Harnesses: three adapters + three hook configs (G7)
- CI: both builders (G11)

Cross-platform contract:
- Windows/macOS/Linux impact (G10)

## Exact Changes

### `<file-path>` — kit-side | payload
- What changes and why

### `<file-path>` — kit-side | payload
- What changes and why

## Implementation Order
0. (If applicable) confirm the engine port has landed — otherwise stop.
1. ...
2. ...
3. Regenerate `RULES.md` with `node docs.js` if core rules changed.
4. Add/update the named tests.
5. Verify.

## Tests To Add Or Update

### `test/install.test.js` (installer behavior)
- Case: `<exact test name>` — asserts ...
- Case: `<exact test name>` — asserts ...

### `templates/common/test_policy_engine.*` (policy behavior)
- Case: `<exact test name>` — asserts ...

A test added anywhere other than these two suites does not run in CI and does not
count.

## Regression Tests To Run

```bash
node --check install.js
```

```bash
npm test
```

```bash
node docs.js
```

```bash
git diff --stat RULES.md
```

```bash
node install.js --target <scratch>/fixture-node --agents claude-code --stacks node --git-hooks true --ci github --yes
```

```bash
node <scratch>/fixture-node/.agent-security/test_policy_engine.js
```

Repeat the install + engine suite for every stack and harness this task touches.

## Pass Criteria
- Every command above exits clean, or a failure is reported with its real output.
- Named tests exist and pass.
- `RULES.md` shows no unexpected drift.
- Generated output inspected by hand for what tests do not assert: interpreter
  strings, `policy.yaml` validity, exactly one CI file.

## Non-Breakage Criteria
- `.new` behavior preserved (G4).
- All five stacks still install cleanly.
- All three harnesses still get a working hook wiring (G7, G13).
- `npm test` still passes on Windows (G10).
- No dependency beyond the authorized vendored `js-yaml` (G1).
- Guardrail self-protection still returns `ask` (G8).

## Hard Stops
- ... (cite G-series IDs)
