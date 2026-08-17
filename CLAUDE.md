# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

This is **the installer/generator kit itself**, not a project that uses
it. Running `install.js` scaffolds a copy of the guardrails system
(policy engine, per-harness adapters, git hooks, CI) into some *other*
target project. Don't confuse `templates/common/CLAUDE.md`,
`templates/common/AGENTS.md`, etc. with this file — those are payload
that gets copied into installed projects; they are not instructions for
working in this repo.

Two languages, two roles:
- **JS** (`install.js`, `stacks.js`, `generate.js`, `docs.js`) — the
  installer/generator that runs once, on the developer's machine, to
  scaffold a target project. No external dependencies.
- **Python** (`templates/common/policy_engine.py`, `final_check.py`) —
  the actual runtime enforcement logic that ships into target projects
  and runs on every agent tool call there. Never changes per stack.

## Commands

```bash
npm test                 # test/install.test.js — the installer's own regression suite
node docs.js              # regenerate RULES.md from generate.js/stacks.js (npm run docs)
node install.js --help    # see all installer flags
```

Run a single scenario from `install.js --help`, e.g. against a scratch
directory (never against this repo itself):

```bash
node install.js --target /tmp/some-test-dir --agents claude-code --stacks node --git-hooks true --ci github --yes
```

There is no Python test runner wired into `npm test` — the Python side
(`policy_engine.py`) is tested via `.agent-security/test_policy_engine.py`,
which only exists *after* installing into a target directory:

```bash
python3 -m pytest /tmp/some-test-dir/.agent-security/test_policy_engine.py -q
```

The repo's own CI (`.gitlab-ci.yml`) runs both: `npm test`, a
`node docs.js` staleness check (fails the pipeline if `RULES.md` doesn't
match `generate.js`/`stacks.js`), and an install+pytest loop against a
fixture directory for every supported stack.

## Architecture

### The generation pipeline (JS side)

`stacks.js` → `generate.js` → `install.js`, in that order of dependency:

- **`stacks.js`** — one object entry per language (`node`, `php`,
  `java-maven`, `java-gradle`, `python`). Each entry declares: how to
  `detect()` the stack from marker files, extra `blocked_commands`,
  completion-gate `checks` (name + shell command), which file
  `changedExtensions` should trigger those checks, and both CI profiles:
  `ci` (GitHub Actions setup action) and `gitlabCi` (Docker image). Adding
  a language is exactly one new entry here — nothing else needs to change.
- **`generate.js`** — combines `CORE_BLOCKED_COMMANDS` /
  `CORE_PROTECTED_PATHS` (language-agnostic: `git push --force`, `rm -rf`,
  `DROP TABLE`, `curl | sh`, etc.) with whatever stacks were
  selected/detected, and renders `policy.yaml`, `.husky/pre-commit`,
  `.husky/pre-push`, `.github/workflows/security.yml`, and
  `.gitlab-ci.yml`. Exports `CORE_BLOCKED_COMMANDS`/`CORE_PROTECTED_PATHS`
  so `docs.js` can read the same data it renders — this is what keeps
  `RULES.md` from drifting.
- **`install.js`** — the CLI. Copies `COMMON_FILES` (the policy engine +
  `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` contract, verbatim, language-agnostic)
  plus per-agent adapter files from `templates/`, then writes the
  generated files from `generate.js`. Never overwrites an existing file —
  writes a `.new` sibling instead (`copyFile`/`writeText`'s "skipped" path)
  so re-running the installer against an already-configured project is
  safe.
- **`docs.js`** — regenerates `RULES.md` by importing the same constants
  `generate.js` exports and parsing `KNOWN_IGNORE_FILES` directly out of
  `templates/common/policy_engine.py` (regex over the source, not a second
  hardcoded copy) — so the rules documentation can never silently diverge
  from what the installer actually does. CI enforces this by diffing
  `RULES.md` before/after regenerating it.

### Git host detection and CI selection

`detectGitHost()` in `install.js` reads `git remote get-url origin` in the
target directory and classifies it as `github` / `gitlab` / `unknown`
(`--ci github|gitlab|none` overrides). Exactly one of
`.github/workflows/security.yml` or `.gitlab-ci.yml` is written — never
both, never guessed when the host is unknown and `--ci` wasn't passed
(the installer says so explicitly rather than emitting a CI file that
would never run).

Git hooks require `core.hooksPath` to point at `.husky/` or git silently
never executes them — `configureHooksPath()` sets this automatically when
the target is already a git repo, and reports `"no-git"` /`"failed"`
otherwise so the final summary can tell the user it's still required.

The installer's final "próximos pasos" summary is built dynamically from
what actually happened in that run (`hooksPathStatus`, `ciHost`,
`installGitHooks`), each step tagged `[obligatorio]`/`[recomendado]`/
`[opcional]`/`[listo]` — it is not a static list. The long-form
explanation of each step ships as `.agent-security/POST_INSTALL.md`
(source: `templates/common/POST_INSTALL.md`).

### The policy engine (Python side, ships into target projects)

`templates/common/policy_engine.py` exposes one entrypoint,
`evaluate(tool_name, tool_input, ...)`, called by every per-harness
adapter (`templates/claude-code/hooks/pretooluse.py`,
`templates/vscode-codex/hooks/pretooluse.py`,
`templates/antigravity/scripts/pretooluse.py`). Adapters only translate
harness-specific JSON in/out; **all actual logic lives in this one
module** so there is exactly one place to audit. It never varies by
project language — only the data in `policy.yaml` (generated per-stack)
does.

Evaluation order inside `evaluate()`:
1. Structured file tool calls (`Write`/`Edit`/etc. with a `file_path`) —
   resolve the path (symlinks, `~`, relative-to-workspace), deny if it
   escapes the workspace root or matches `protected_paths`.
2. Shell commands — match against `blocked_commands` regexes first, then
   tokenize the command (best-effort, not a real shell parser — see
   `_command_touches_protected_path`) and check every path-like token
   against the same `protected_paths`.
3. Guardrail self-protection — editing/deleting `.agent-security/**`, any
   harness's hook config, or any of the `KNOWN_IGNORE_FILES` always
   returns `ask`, checked for both structured calls and shell commands,
   so an agent can't disable its own guardrails mid-session.
4. Default: `allow`.

`protected_paths` merges two live sources every call (mtime-cached, not
baked in at install time): `policy.yaml`'s own list, and whatever
non-standard ignore files (`.cursorignore`, `.agentsignore`, ...
— the full list is `KNOWN_IGNORE_FILES`) exist at the workspace root.
`!negation` lines in those files are deliberately never honored — a
repo's own ignore file must only ever *add* protection, never remove it.

`final_check.py` is the completion gate (`Stop` hook): it re-executes
`required_checks` from `policy.yaml` itself rather than trusting the
agent's claim that tests passed, and appends a report to
`completion_reports.log`.

### Adding things

- New stack/language → one entry in `stacks.js` (see `CONTRIBUTING.md` for
  the exact shape, including the `gitlabCi` field) — also add its marker
  fixture to `STACK_MARKERS` in `test/install.test.js`.
- New agent/harness → new `templates/<agent>/` adapter that translates
  that harness's JSON to/from `policy_engine.evaluate_from_dict()`, plus
  an entry in `install.js`'s `AGENTS` map. Never put harness-specific
  parsing inside `policy_engine.py`.
- Changing core (language-agnostic) rules → edit
  `CORE_BLOCKED_COMMANDS`/`CORE_PROTECTED_PATHS` in `generate.js`, then run
  `node docs.js` to regenerate `RULES.md` (CI fails if you forget).
