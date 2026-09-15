# Architecture

## The two roles, one language

Everything in this repo is JavaScript. The distinction that matters is *when
and where* each piece runs, not what language it's written in:

- **Kit-side** — `install.js`, `stacks.js`, `generate.js`, `docs.js`. Runs
  once, on the developer's own machine, to scaffold a target project.
  Zero dependencies (stdlib only).
- **Payload** — `templates/common/policy_engine.js`, `policy_loader.js`,
  `final_check.js`, plus the per-harness adapters. Copied into the target
  project and run there, on every agent tool call, for the life of that
  project. Never varies by target-project language — only the data in the
  generated `policy.yaml` does. Its one third-party dependency, `js-yaml`,
  is vendored under `templates/common/vendor/` so no target project ever
  runs `npm install` to get guardrails (see G1 in
  [`constraints-g-series.md`](./constraints-g-series.md)).

## The generation pipeline

Three kit-side modules, in a strict dependency order: `stacks.js` →
`generate.js` → `install.js`.

- **`stacks.js`** — one entry per supported language. Each entry declares
  how to `detect()` the stack from marker files (`package.json`,
  `composer.json`, `pom.xml`, ...), extra `blocked_commands`, completion-gate
  `checks` (name + shell command), which file extensions should trigger
  those checks, and both CI profiles (`ci` for GitHub Actions, `gitlabCi`
  for a Docker image). Adding a language is exactly one new entry here.
- **`generate.js`** — combines the language-agnostic
  `CORE_BLOCKED_COMMANDS` / `CORE_PROTECTED_PATHS` with whatever stacks were
  selected or detected, and renders `policy.yaml`, `.husky/pre-commit`,
  `.husky/pre-push`, `.github/workflows/security.yml`, and
  `.gitlab-ci.yml`. It exports the core constants so `docs.js` can read the
  exact same data it renders from — this is the mechanism that keeps
  `RULES.md` from silently drifting out of sync with actual behavior.
- **`install.js`** — the interactive CLI. Copies the common payload files
  (policy engine + the `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` operating
  contract) plus per-agent adapter files, then writes the files rendered by
  `generate.js`. Never overwrites an existing file — writes a `.new` sibling
  instead — so re-running the installer against an already-configured
  project stays safe (G4).
- **`docs.js`** — regenerates `RULES.md` by importing the same constants
  `generate.js` exports, and by parsing `KNOWN_IGNORE_FILES` directly out of
  `policy_engine.js` via `require()` rather than keeping a second hardcoded
  copy. CI enforces this by diffing `RULES.md` before and after regenerating
  it, and fails the pipeline on drift (G5).

## Git host detection and CI selection

`detectGitHost()` reads `git remote get-url origin` in the target directory
and classifies it as `github`, `gitlab`, or `unknown` (`--ci github|gitlab|none`
overrides this). Exactly one of `.github/workflows/security.yml` or
`.gitlab-ci.yml` is ever written — never both, and never guessed when the
host is unknown and `--ci` wasn't passed explicitly (G11). The installer
says so out loud rather than silently emitting a CI file that would never
run.

Git hooks require `core.hooksPath` to point at `.husky/`, or git silently
never executes them. `configureHooksPath()` sets this automatically when the
target is already a git repo, and reports `"no-git"` / `"failed"` otherwise
so the final summary can tell the user the step is still required (G12).
The installer's closing summary is built dynamically from what actually
happened in that specific run — each step tagged
`[obligatorio]`/`[recomendado]`/`[opcional]`/`[listo]` — rather than being a
static list, because which steps are mandatory depends on what that
particular install did.

## The policy engine

`templates/common/policy_engine.js` exposes one entrypoint, `evaluate()`,
called by every per-harness adapter. Adapters only translate
harness-specific JSON in and out; all decision logic lives in this one
module, so there is exactly one place to audit (G3). It never varies by
target-project language — only the data in `policy.yaml` does.

See [`policy-engine-semantics.md`](./policy-engine-semantics.md) for the
full evaluation order and the reasoning behind it.

## Module responsibility map

| Concern | Lives in | Side | Key invariant |
|---|---|---|---|
| Installer CLI | `install.js` | kit | never overwrites (G4), cross-platform (G10), exactly one CI file (G11) |
| Stack profiles | `stacks.js` | kit | every stack needs `ci` **and** `gitlabCi` **and** a test fixture (G6) |
| Renderers | `generate.js` | kit | keeps `RULES.md` in sync (G5), renders `policy.yaml` + hooks + both CI formats |
| Docs generator | `docs.js` → `RULES.md` | kit | parses the engine source directly; breaks loudly if the engine is renamed |
| Runtime policy engine | `templates/common/policy_engine.js` | payload | fails closed (G2), one audit point (G3), self-protection (G8), no ignore-file negation (G9) |
| Completion gate | `templates/common/final_check.js` | payload | re-executes `required_checks`; never trusts the agent's own claim |
| Harness adapters | `templates/<agent>/hooks/pretooluse.js` | payload | translation only, zero decision logic (G3); all three must stay in sync (G7) |
| Harness hook configs | `templates/<agent>/settings.json` (or equivalent) | payload | interpreter in the command string must match the engine's actual runtime (G13) |
| Agent contract payload | `templates/common/{AGENTS,CLAUDE,GEMINI}.md` | payload | copied verbatim, English, language-agnostic |
| Vendored dependency | `templates/common/vendor/js-yaml.js` | payload | the one authorized dependency (G1); never resolved from a target's `node_modules` |
| Uninstaller / toggle | `templates/common/uninstall.js`, `toggle.js` | payload | manifest-driven removal (G15), unhook-not-killswitch (G16) |
| Install manifest | `.agent-security/install-manifest.json` | both | written kit-side, lives in the payload, itself protected by G8 |

## Adding things

- **New stack/language** → one entry in `stacks.js`, plus its marker
  fixture in `test/install.test.js`'s `STACK_MARKERS` (G6).
- **New agent/harness** → a new `templates/<agent>/` adapter translating
  that harness's JSON to/from the engine, plus an entry in `install.js`'s
  `AGENTS` map. Harness-specific parsing never goes inside
  `policy_engine.js` (G3).
- **Changing core (language-agnostic) rules** → edit
  `CORE_BLOCKED_COMMANDS`/`CORE_PROTECTED_PATHS` in `generate.js`, then run
  `node docs.js` to regenerate `RULES.md` (G5; CI fails if this is skipped).
