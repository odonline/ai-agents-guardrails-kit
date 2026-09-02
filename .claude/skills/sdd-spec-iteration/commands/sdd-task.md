# Command: /sdd-task

Generate or update detailed numbered implementation task files from an SDD plan.

**Usage:** `/sdd-task Tasks/<feature-slug>/00-overview.md`

## Steps

1. Load `.claude/skills/sdd-spec-iteration/SKILL.md`.
2. Read the overview, the runbook, and any existing task files.
3. For each planned task, create or update `NN-<slug>.md` from
   `references/template-task.md`.
4. Each task must include:
   - Status
   - Goal
   - AI Automation Contract (owner role, files allowed, files forbidden,
     verification commands)
   - SDD Spec — input / output / failure / compatibility, plus Generation,
     Payload, Policy Semantics, Interpreter/Runtime, Docs Sync, Parity, and
     Cross-Platform contracts as applicable
   - Exact Changes, per file, with kit-side or payload labeled
   - Implementation Order
   - Tests To Add Or Update — named cases
   - Regression Tests To Run — real commands
   - Pass Criteria
   - Non-Breakage Criteria
   - Hard Stops, cited by G-series ID

## Rules
- An implementer must be able to work from one task file without guessing.
- Every task needs at least one named test case, or an explicit reason why it
  cannot have one. Acceptable reasons: the change is docs-only; the behavior is
  only observable in a real harness. "Hard to test" is not a reason.
- Name the actual test file: `test/install.test.js` for installer behavior, the
  engine suite (`templates/common/test_policy_engine.*`) for policy behavior.
  A test added anywhere else does not run in CI and does not count.
- Include the real verification commands, not placeholders — `npm test`,
  `node docs.js`, `node --check <file>`, the scratch install, the engine suite.
- Every scratch install command must target a scratch directory. Never `--target .`
  and never this repo.
- Label each `Exact Changes` file kit-side or payload. If a task has both, justify
  it in one line or split the task.
- If the task depends on the engine port, say so in Implementation Order as step
  zero.

## Output
Report:
- Files created or updated.
- Any task still too broad, and how you would split it.
- First task recommended for implementation.
