# Command: /sdd-new

Create the initial SDD spec folder from an idea, bug, audit, or refactor request.

**Usage:** `/sdd-new <feature-slug or short description>`

## Steps

1. Load `.claude/skills/sdd-spec-iteration/SKILL.md`.
2. Run preflight:
   - Read root `CLAUDE.md`.
   - Read `.agents/constraints.md`, `.agents/rules.md`,
     `.agents/behavior.md` **if present** — never block on a missing one.
   - `git status` + current branch.
   - `ls templates/common/` to confirm whether the Python→Node engine port has
     landed. Every path assumption downstream depends on this.
   - If `engram` MCP is available: `mem_search` for prior context on this area.
   - If `code-review-graph` MCP is available: `detect_changes`,
     `get_impact_radius`, `query_graph`, `semantic_search_nodes`. Otherwise
     grep/glob/read.
3. Classify the request against the Component Matrix, and state for each affected
   file whether it is **kit-side** or **payload**. A spec that does not do this is
   not a Draft.
4. Create `Tasks/<feature-slug>/00-overview.md` using
   `references/template-overview.md`, with:
   - Status: `Draft`
   - Goal / Summary / Context (components, kit-side vs payload)
   - In Scope / Out of Scope
   - Global SDD Contracts — including Generation, Payload, Policy Semantics,
     Interpreter/Runtime, Docs Sync, Parity, and Cross-Platform contracts
   - Required Verification Commands (the real ones: `npm test`, `node docs.js`,
     scratch install, engine suite)
   - Hard Stops, cited by G-series ID
   - Open Questions
   - Proposed Task List

## Rules
- Do not create numbered implementation task files in this step unless asked.
- Do not code in this step.
- Open questions must be decision-grade. "Which YAML strategy?" is a decision.
  "Investigate options" is not.
- The engine-port decisions of record are settled: `policy.yaml` stays YAML read
  with vendored `js-yaml`, and `node` is a hard requirement with no Python
  fallback. Cite them; do not reopen them as open questions.
- If the request is a payload change, state the `.new` behavior (G4). There are
  no installs in the wild yet, so do not invent a migration story.
- Slug in kebab-case, matching the folder name.

## Output
Report:
- Created or updated spec path.
- Component(s) affected, kit-side vs payload.
- Open decisions the human must make.
- Recommended next command: `/sdd-refine` or `/sdd-plan`.
