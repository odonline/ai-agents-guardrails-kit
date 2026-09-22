# Architecture Constraints

This file is kit-side guidance for working *in this repo* — it is not
payload. (`.agents/` is overloaded: `install.js` also writes an
**Antigravity payload** under this same directory name in target
projects, e.g. `.agents/hooks.json`. Never confuse the two.)

The authoritative, numbered invariants for this codebase are the G1–G17
constraints in
[`Docs/constraints-g-series.md`](../Docs/constraints-g-series.md), loaded
in full by the `sdd-spec-iteration` skill. They win over anything below —
this file does not restate them, only the one read/write boundary that
applies to an agent's own behavior while working here.

---

## Ignored File Boundaries for AI/Agents (relates to G9)

- Before reading or changing a file, check `.gitignore` and this kit's
  own known ignore-file names — the current, authoritative list is
  `KNOWN_IGNORE_FILES` in `templates/common/policy_engine.js`.
- Do not read, quote, summarize, or modify a file matched by any of those
  lists unless the user explicitly authorizes that exact path for the
  current task.
- If a task appears to require an ignored file, stop and ask for explicit
  permission before accessing it.
- `!negation` lines in those files never remove protection — same rule
  the policy engine itself enforces (G9). An ignore file may only *add*
  restrictions here, never lift them.
