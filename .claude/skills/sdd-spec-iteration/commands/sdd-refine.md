# Command: /sdd-refine

Iterate an SDD overview or task file until contracts and open decisions are clear.

**Usage:** `/sdd-refine Tasks/<feature-slug>/00-overview.md`

## Steps

1. Load `.claude/skills/sdd-spec-iteration/SKILL.md`.
2. Read the target spec or task file.
3. Run preflight:
   - Read root `CLAUDE.md` if not already in context.
   - Read `.agents/*.md` if present.
   - Confirm the engine port status (`ls templates/common/`) if the spec cites a
     Node-target path.
   - If refinement depends on current behavior, inspect it — graph tools if
     available, else grep/glob/read. Do not refine a contract against a guess
     about what the code does today.
4. Validate against the Draft → Reviewed checklist in the skill:
   - Inputs, outputs, failure behavior, compatibility
   - Generation contract (write / skip / `.new`)
   - Payload contract + existing-install impact (G4)
   - Policy semantics — every rule has an action and a user-facing reason
   - Interpreter/runtime contract (G13)
   - Docs sync — `RULES.md` via `node docs.js` only (G5)
   - Parity — stacks (G6), harnesses (G7), CI formats (G11)
   - Cross-platform (G10)
   - Fail-closed behavior for every new failure mode (G2)
   - No dependency beyond the authorized vendored `js-yaml` (G1)
   - Named test cases, not "add tests"
5. Edit the file to remove ambiguity.

## Rules
- Ask the human before resolving a real product or architecture decision.
- If a decision is already constrained by root `CLAUDE.md` or the G-series,
  document the constraint instead of asking.
- Preserve approved decisions unless asked to revisit them.
- Watch for the two recurring confusions and fix them wherever they appear:
  - `templates/common/CLAUDE.md` (payload) vs root `CLAUDE.md` (this repo).
  - The `python` **stack** (a target project's language) vs the engine's own
    **runtime**.
- Mark status `Reviewed` only when every ambiguity is resolved or recorded as an
  explicit open question.

## Output
Report:
- Decisions resolved.
- Remaining open questions, each addressed to the human.
- Whether the spec is ready for `/sdd-plan`.
