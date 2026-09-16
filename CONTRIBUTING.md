# Contributing to ai-agents-guardrails-kit

Thanks for taking the time to contribute! This project scaffolds a
policy-enforcement system (a policy engine, per-harness adapters, git
hooks, and CI) into other people's projects, so changes here can affect
every project that installs or reinstalls the kit — we'd rather be a
little slower and careful about that than fast and wrong.

## Before you start

Get oriented first:

- **[`README.md`](./README.md)** — what the kit does and how to install it.
- **[`Docs/`](./Docs/)** — the "why": architecture, the policy engine's
  real decision logic, the design constraints (G1–G17) that gate changes,
  and a written history of concrete bugs found and fixed.
- **[`HOWTO.md`](./HOWTO.md)** — the technical reference for *making*
  structural changes: adding a language stack, adding an agent harness,
  touching the vendored dependency, generated git hooks, or the
  manifest/uninstaller/toggle. Read this before touching `install.js`,
  `stacks.js`, `generate.js`, `docs.js`, or anything under `templates/**`.
- **[`RULES.md`](./RULES.md)** — generated (`node docs.js`), the literal,
  always-current table of every rule the policy engine enforces. Never
  hand-edited.
- **[`CHANGELOG.md`](./CHANGELOG.md)** — what changed and why, in order.

One thing worth internalizing up front: this repo has two audiences.
**Kit-side** code (`install.js`, `stacks.js`, `generate.js`, `docs.js`)
runs once, on a contributor's own machine, to scaffold a target project.
**Payload** code (everything under `templates/`) gets copied into that
target project and runs there, on every AI agent tool call, for the life
of that project. Confusing which one you're changing is the most common
way to introduce a subtle bug here — `HOWTO.md` and `Docs/architecture.md`
both cover this distinction in detail.

## Code of conduct

This project doesn't have a separate `CODE_OF_CONDUCT.md` yet. Until it
does: be respectful, assume good faith, and keep disagreements about code
and design rather than people. Maintainers may remove comments or block
participants that don't meet this bar.

## Ways to contribute

- **Report a bug** — including a rule that should block/ask/allow
  something and doesn't, or one that's over- or under-broad.
- **Propose an enhancement** — a new stack, a new agent harness, a new
  core rule, better installer ergonomics.
- **Improve documentation** — `README.md`, `Docs/`, `HOWTO.md`, or the
  generated-but-reviewable `RULES.md`.
- **Fix something you found while using the kit** — several of the most
  important bug fixes in this project's history came from actually running
  the installed guardrails against a real project rather than from the
  test suite. See `Docs/lessons-learned.md` for examples; that kind of
  report is exactly as valuable as a code contribution.

## Reporting bugs

Open a GitHub issue with:

1. What you expected to happen, and what happened instead.
2. The exact command you ran (`install.js` flags, or the specific tool
   call an installed agent made).
3. Your OS and shell (Windows/Git Bash, macOS, Linux) — several past bugs
   were platform-specific path-handling issues.
4. Which stack(s) and agent harness(es) are involved, if relevant.
5. If it's a policy-engine decision that looked wrong, the relevant line
   from `.agent-security/audit.log` if you have it.

## Suggesting enhancements

For anything beyond a small fix — a new core `blocked_commands`/
`protected_paths` rule, a new stack, a new harness, a change to the
install/uninstall/toggle lifecycle — please open an issue first to discuss
the approach. Changes to core rules affect every installed project, and
changes to the installer's git-hook or manifest behavior carry real risk of
silently breaking a project's existing safeguards if not done carefully
(see `HOWTO.md`).

## Development setup

Requires only Node.js >= 16 — the kit itself has zero installable
dependencies.

```bash
git clone <your fork's URL>
cd ai-agents-guardrails-kit
npm test                 # the installer's own regression suite
node docs.js              # regenerate RULES.md and check it doesn't drift
node install.js --help    # see all installer flags
```

**Never run `install.js` against this repository.** Always target a
scratch/temp directory:

```bash
node install.js --target /tmp/some-test-dir --agents claude-code --stacks node --git-hooks true --ci github --yes
```

The payload (policy engine) has its own pure test suite that runs straight
from the source, no install required:

```bash
node templates/common/test_policy_engine.js
```

## Before opening a pull request

- [ ] `npm test` passes.
- [ ] If you changed core rules in `generate.js` (or anything in
      `stacks.js`), you ran `node docs.js` and committed the regenerated
      `RULES.md`. CI diffs it and fails the build if it's stale.
- [ ] If you touched `install.js`, `stacks.js`, `generate.js`,
      `templates/**`, the manifest, the uninstaller, or the toggle script,
      you've read the relevant section of `HOWTO.md` — those areas carry
      hard invariants (the G1–G17 constraints in `Docs/constraints-g-series.md`)
      that are enforced by tests and by review.
- [ ] You tested against a scratch directory, never against this repo.
- [ ] New behavior has a test. A guardrail change without a test that
      would fail if the guardrail regressed doesn't really verify
      anything — see `Docs/testing-and-verification.md` for why mutation
      testing specifically matters here.

## Commit messages

This repo loosely follows a `type: short summary` style (`feat:`, `fix:`,
`refactor:`, `docs:`, ...) — not strictly enforced, but appreciated for a
readable history.

## Pull request process

1. Describe **what** changed and **why** — link an issue if there is one.
2. State explicitly whether the change is kit-side, payload, or both, and
   which stacks/harnesses it touches.
3. Expect review against the constraints in `Docs/constraints-g-series.md`
   — a reviewer citing "this weakens G8" is citing that table.
4. A maintainer may ask for `node docs.js` to be re-run, for additional
   test coverage, or for `Docs/`/`HOWTO.md`/`CHANGELOG.md` to be updated to
   match. Once addressed and green in CI, a maintainer will merge.

## License

By contributing, you agree that your contributions will be licensed under
this project's [MIT license](./LICENSE).
