# Command: /sdd-implement

Implement one approved SDD task with contract-first execution and verification.

**Usage:** `/sdd-implement Tasks/<feature-slug>/NN-<task>.md`

## Steps

1. Load `.claude/skills/sdd-spec-iteration/SKILL.md`.
2. Read the target task file completely.
3. Run preflight:
   - Read root `CLAUDE.md` if not already in context; `.agents/*.md` if present.
   - `git status` + current branch. Work on a feature branch.
   - `ls templates/common/` — confirm the engine port status matches what the
     task assumes. If the task references a Node-target path that does not exist
     yet, stop: the port task comes first.
   - Inspect affected code — graph tools if available, else grep/glob/read.
4. Restate the input, output, failure, compatibility, and parity contracts.
5. Confirm every file in `Exact Changes` exists (or is meant to be created), and
   confirm each one's kit-side / payload label.
6. Implement only the task's file scope.
7. Verify, in this order:

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

Then a real install into a scratch directory, once per stack/harness the task
touches:

```bash
node install.js --target <scratch>/fixture-node --agents claude-code --stacks node --git-hooks true --ci github --yes
```

Then the engine suite, which exists only after installing:

```bash
node <scratch>/fixture-node/.agent-security/test_policy_engine.js
```

8. Inspect generated output by hand for what tests do not assert: interpreter
   strings in hook configs, `policy.yaml` validity, exactly one CI file.
9. Update `CHANGELOG.md` for user-facing changes. For payload changes, state
   the `.new` behavior where relevant (G4).
10. Update `CONTRIBUTING.md` if the contributor workflow changed.
11. Save new decisions via `engram` `mem_save` if available.

## Hard Stops
Stop and ask if implementation would require:
- A file outside the task's scope.
- A new dependency in `package.json` or in the payload (G1).
- Any path where the engine could fail open (G2).
- Decision logic in an adapter, or harness parsing in the engine (G3).
- The installer overwriting an existing file (G4).
- Hand-editing `RULES.md` (G5).
- A stack without `gitlabCi` or without a `STACK_MARKERS` fixture (G6).
- An engine contract change reaching fewer than all three adapters and all three
  hook configs (G7, G13).
- Weakening guardrail self-protection (G8).
- Honoring `!negation` lines in ignore files (G9).
- Anything that breaks on Windows (G10).
- Emitting both CI files, or guessing an unknown git host (G11).
- Changing `policy.yaml`'s format — it stays YAML, read with vendored `js-yaml`.
- Requiring `npm install` in a target project, or resolving `js-yaml` from the
  target's `node_modules` instead of the vendored copy (G1).
- Reintroducing a Python fallback engine (G3).
- Installing into this repo instead of a scratch directory.
- Committing or pushing when not asked.
- Product behavior the spec does not decide.

## Output
Report:
- Files changed, each labeled kit-side or payload.
- Every command run, with its real result. If a test failed, say so and show the
  output — do not describe a failing suite as passing.
- Any verification skipped, with the exact command and the exact reason.
- Whether the task can move to `Tested`.
