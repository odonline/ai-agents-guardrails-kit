# Docs/ — project knowledge base

This folder holds durable, "why"-focused documentation about
**ai-agents-guardrails-kit**: the installer/generator that scaffolds an
agent-guardrails system (policy engine, per-harness adapters, git hooks, CI)
into other target projects.

It is deliberately separate from the files that already exist at the repo
root:

- **`CLAUDE.md`** — operating instructions for an AI agent working *in this
  repo*. Task-oriented, tells an agent what to run and what not to touch.
- **`README.md`** — the public-facing quickstart for someone installing the
  kit into their own project.
- **`RULES.md`** — generated output (`node docs.js`), the literal rule table
  enforced by the policy engine. Never hand-edited.
- **`CHANGELOG.md`** — chronological record of what changed and which bug
  motivated it.

Those four answer "how do I use this" and "what changed when." This folder
answers a different question: **why is the system shaped the way it is**,
what would break if a design decision were reversed, and what concrete
incidents taught the team the lessons baked into the code. It is meant to be
read topic-by-topic, each file self-contained, rather than end to end.

## Contents

- [`glossary.md`](./glossary.md) — core terms used throughout the codebase
  and the other docs in this folder.
- [`architecture.md`](./architecture.md) — the two roles (kit-side vs
  payload), the generation pipeline, and the module map.
- [`policy-engine-semantics.md`](./policy-engine-semantics.md) — how
  `evaluate()` actually decides `allow`/`ask`/`deny`, and why `deny` and `ask`
  are not points on the same spectrum.
- [`constraints-g-series.md`](./constraints-g-series.md) — the G1–G17
  invariants that gate every change to this codebase, with the reasoning
  behind each one.
- [`install-uninstall-lifecycle.md`](./install-uninstall-lifecycle.md) — what
  happens on install, toggle, and uninstall, and why each is manifest-driven
  rather than convention-driven.
- [`lessons-learned.md`](./lessons-learned.md) — concrete bypasses that were
  found (mostly by *using* the kit, not by its own test suite) and the
  general principle each one left behind.
- [`testing-and-verification.md`](./testing-and-verification.md) — what each
  test suite actually proves, and why mutation testing matters more here than
  in most codebases.

## What this repo is, in one paragraph

Running `install.js` against some other project copies a policy engine, a
generated `policy.yaml`, per-agent-harness adapters, git hooks, and a CI
workflow into that project. From then on, every tool call an AI coding agent
makes inside that project is evaluated against the policy before it runs.
This kit is the installer/generator itself — it is never installed into
itself, and nothing in it enforces anything on work done in *this*
repository.
