# Command: /sdd-plan

Convert an approved SDD overview into an ordered implementation plan and numbered
task list.

**Usage:** `/sdd-plan Tasks/<feature-slug>/00-overview.md`

## Steps

1. Load `.claude/skills/sdd-spec-iteration/SKILL.md`.
2. Read the overview and anything it references.
3. Run preflight:
   - Read root `CLAUDE.md` if not already in context; `.agents/*.md` if present.
   - Confirm engine port status (`ls templates/common/`).
   - Identify likely changed files — graph tools if available, else grep/glob/read.
4. Produce or update:
   - the `00-overview.md` task index
   - `09-ai-automation-runbook.md` when the feature spans more than ~3 tasks or
     crosses the kit-side / payload line
   - ordered task filenames with one-line summaries
5. For each task define: owner role, exact file scope (allowed and forbidden),
   verification commands, named tests, hard stops, and whether it depends on the
   engine port having landed.

## Planning Rules
- Implementation order must be dependency-safe and explicit.
- Shared prerequisites before feature slices.
- Separate tasks when verification gates differ: `stacks.js` data,
  `generate.js` rendering, `install.js` CLI, engine, adapters, hook configs,
  payload docs, kit CI, kit tests.
- Never combine a kit-side change with a payload change in one task unless the
  payload change is the whole point of the kit-side change.
- Any task that adds or changes a stack must carry `ci` + `gitlabCi` +
  `STACK_MARKERS` in the same task (G6) — splitting those three guarantees a
  broken intermediate state.
- Any task that changes the engine contract must carry all three adapters and all
  three hook configs, or explicitly sequence them with the incomplete state
  called out (G7, G13).
- Any task that changes core rules must include the `node docs.js` regeneration
  in the same task (G5) — CI fails otherwise.
- The engine port is never one task. Minimum split: policy-loading decision,
  engine, test-parity port, adapters, hook configs, generators
  (`generate.js` + `install.js` + `docs.js`), kit CI, payload docs.
- Define the scratch-install matrix up front: which stacks x harnesses x `--ci`
  values must be exercised. Never plan an install against this repo.

## Output
Report:
- Ordered task list with dependencies.
- Approvals still required before task generation.
- Recommended next command: `/sdd-task`.
