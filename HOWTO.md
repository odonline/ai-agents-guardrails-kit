# HOWTO — Extending and Maintaining the Kit

This is the technical reference for making structural changes to the
installer/generator or its payload: adding a stack, adding an agent
harness, touching vendored dependencies, generated git hooks, the
manifest/uninstaller/toggle, or core rules. If you're looking for the
process side of contributing instead — how to open an issue, how to submit
a pull request, code of conduct — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

For the reasoning behind *why* the system is shaped this way (not just
*how* to change it), see the [`Docs/`](./Docs/) folder, in particular
[`Docs/architecture.md`](./Docs/architecture.md) and
[`Docs/constraints-g-series.md`](./Docs/constraints-g-series.md) — the
constraints referenced here by ID (G1, G8, G17, ...) are defined there in
full.

## Adding a new stack (language)

Just a new block in `stacks.js` — `install.js` and `generate.js` pick it up
automatically.

```js
ruby: {
  label: "Ruby (Bundler)",
  markers: ["Gemfile"],
  detect: (dir) => exists(dir, "Gemfile"),
  checks: [
    { name: "tests", command: "bundle exec rspec" },
    { name: "lint", command: "bundle exec rubocop" },
  ],
  changedExtensions: [".rb"],
  extraBlocked: [
    { pattern: "\\bgem\\s+push\\b", action: "ask", reason: "Publishing a gem requires approval." },
  ],
  ci: { setupAction: "ruby/setup-ruby@v1", withBlock: "ruby-version: '3.3'", install: "bundle install" },
  gitlabCi: { image: "ruby:3.3", install: "bundle install" },
},
```

`ci` is the setup step for GitHub Actions; `gitlabCi` is the equivalent
Docker image for GitLab CI (`generate.js` generates both CI formats from
the same stack — the installer picks one based on the detected git host,
see `README.md`). Don't forget to add the new stack to `STACK_MARKERS` in
`test/install.test.js` if you want the smoke test to cover it (G6).

Then:

```bash
node install.js --target /tmp/some-test-project --agents claude-code --stacks ruby --yes
node /tmp/some-test-project/.agent-security/test_policy_engine.js  # sanity check
```

## Adding a new agent/harness

1. A new folder at `templates/<agent>/` with its adapter
   (`pretooluse.js`) translating that harness's JSON into the format
   `policy_engine.evaluateFromDict()` expects, plus its hook-config file.
   The adapter must emit a well-formed decision and exit 0 **on every
   error path**, including failing to load the engine: a hook that dies
   leaves the harness's behavior undefined.
2. A new entry in `install.js`'s `AGENTS` object, and the hook config's
   `command` must say `node`, pointing at a file the installer actually
   copies (there's a test that verifies this).
3. Don't touch `policy_engine.js` — that logic is shared by design; the
   adapter is the only piece allowed to know that harness's specific JSON
   format (G3).
4. A new entry in `HOOK_CONFIGS` in `templates/common/kit_manifest.js`.
   That array is what `toggle.js` renames on disable and what
   `uninstall.js` reads to report whether enforcement stayed hooked. A
   harness missing from it can't be disabled — worse, the uninstaller's
   summary will claim guardrails were disabled when they weren't.
5. Add the harness to `HARNESS_WIRING` in `test/install.test.js` — the
   disable→enable cycle is tested per harness (G7).

## Vendored dependencies

The kit has no installable dependencies: `package.json` declares no
`dependencies`, and a test verifies it. The one exception is **`js-yaml`**,
which ships vendored at `templates/common/vendor/js-yaml.js`, because the
policy engine needs to read `policy.yaml` inside the target project —
which might be a Java or PHP project with no npm workflow at all.

Rules:

- The vendored file is **byte-identical** to the `dist/js-yaml.js`
  published on npm. No added header, no patches, not minified.
- Its SHA-256 is recorded in `templates/common/vendor/VENDOR.md` and
  `npm test` verifies it. Edit the file and the pipeline fails — on
  purpose.
- The bundle is vendored **unminified**: 131 KB instead of 43 KB, so it can
  actually be read. It's the one thing standing between an agent and the
  user's filesystem; being auditable is worth the extra 88 KB.
- If a fix is needed, it goes upstream first, then the released version
  gets vendored. A locally patched copy can't be verified by anyone —
  exactly what vendoring exists to avoid.

The full update procedure is in `templates/common/vendor/VENDOR.md`.
Adding **any other** dependency, kit-side or payload-side, needs explicit
approval — it is not an implementation detail (G1).

## Changing core (language-agnostic) rules

Edit `CORE_BLOCKED_COMMANDS` / `CORE_PROTECTED_PATHS` in `generate.js`. Run
`node docs.js` to regenerate `RULES.md` (the rule documentation — CI fails
if you forget this step (G5)), then the tests:

```bash
node docs.js
node install.js --target /tmp/test --agents claude-code --stacks node --yes
node /tmp/test/.agent-security/test_policy_engine.js
```

## Touching generated git hooks or the chaining logic

Two verified traps in this repo, both silent:

- **`git rev-parse --git-path hooks` respects `core.hooksPath`.** In a
  project with the kit installed it returns `.husky`, so a shim using it
  would call itself. Use `"$(git rev-parse --git-common-dir)/hooks"`
  instead — immune to that, and it also resolves correctly in a linked
  worktree (where `--git-dir` points at `.git/worktrees/<name>`, which is
  not where hooks live).
- **Shims are generated from JS template literals.** A shell expansion of
  the form `${...}` inside a backtick string does **not** reach the
  shell — JS interpolates it first. `${1+"$@"}` was evaluated as
  `1 + "$@"`, leaving the file with `1$@`. Any expansion that needs to
  reach the shell must be escaped (`\${...}`), and the test `chain shims
  forward arguments without mangling them` inspects the **emitted text**,
  not the source. If you add new shell syntax to a builder, test the
  output.

Also: `.husky/`'s content gets **committed** in the target project, so no
absolute paths inside a shim, and every path is checked before being
invoked (another dev might not have that hook). POSIX `sh`, no GNU
`mktemp` flags, no `[[ ]]` — it has to run in Git Bash too (G10).

And the rule that governs all of this: **if the shims can't be written,
`core.hooksPath` doesn't get configured.** Configuring it anyway would
silence the project's hooks with nothing to replace them — exactly the bug
chaining exists to fix (G12).

## The kit never commits (G17)

The target repo's history belongs to the client. Nothing in the kit — not
`install.js`, not the uninstaller, not the toggle, and **nothing the kit
generates** — may run `git add`, `commit`, `push`, `checkout`, `reset`,
`merge`, `rebase`, `stash`, `tag`, or `branch`.

The only piece of git state the kit writes is `core.hooksPath` (G12),
which it also records in the manifest and reverts on uninstall. Everything
else it writes stays **untracked**, for the client to review and commit
themselves.

The case people forget: a generated hook that staged or committed on your
behalf would be worse than the installer doing it once — it would do it on
every commit, in every teammate's clone. That's why there's a test
inspecting the **generated content** (`pre-commit`, `pre-push`, both CI
formats) in addition to the invocation sites.

The tests don't grep for text: the source legitimately contains
`git push --force` and `git commit --no-verify`, both as
`blocked_commands` patterns and as fixtures. They inspect what actually
gets passed to `execSync`/`execFileSync`/`spawnSync`, and there's also an
end-to-end test that installs over a repo with a commit and a dirty
working tree and verifies `HEAD`, the index, and uncommitted files stayed
untouched.

If you need a new git operation, it goes into that test's `ALLOWED` list —
and only after explicitly deciding it's safe.

## Touching the manifest, the uninstaller, or the toggle

`install.js` records in `.agent-security/install-manifest.json` everything
it writes and every piece of state it changes outside those files
(`core.hooksPath`, the `.gitignore` lines). `uninstall.js` and `toggle.js`
act **only** on what that record says is ours and still matches.

Two rules to keep this intact:

- **The hash is computed by normalizing line endings to LF**, both in
  `install.js` and in `templates/common/kit_manifest.js`. If the two
  implementations diverge, every intact file looks modified on a CRLF
  checkout and the uninstaller deletes nothing — a silent failure, and in
  the useless direction. There's a test covering this; don't remove it.
- **Every new file the installer copies has to enter the manifest.** Add
  it to `COMMON_FILES` or `AGENTS` and this happens automatically
  (`copyFile()`/`writeText()` feed the accumulator). Write it outside
  those two functions and you have to register it by hand, or it's
  orphaned on uninstall.
- **The manifest gets committed, so watch for machine-specific data.**
  Without it, nobody who clones the repo can uninstall — but that also
  means a value specific to one machine travels into someone else's
  clone. Today there's exactly one: `git.hooksPathBefore`. The uninstaller
  verifies that directory exists in *this* clone before restoring it — if
  it doesn't, it unsets it and explains why. Any new field of that kind
  needs its own verification.

And one that's non-negotiable: **never add a flag, sentinel file, or
`enabled: false` to the engine that would make it allow everything.**
Disabling works by unhooking the harness, not from inside the piece that
exists to fail closed (G16). There's a test verifying that
`policy_engine.js`, `policy_loader.js`, and `final_check.js` know nothing
of that idea.

Minimum verification when changing any of the three: `npm test` plus a
real round-trip against a scratch directory (never against this repo):

```bash
node install.js --target /tmp/rt --agents claude-code --stacks node --git-hooks true --ci none --yes
```

```bash
node /tmp/rt/.agent-security/uninstall.js --yes
```

## Running the tests after touching install.js / generate.js / stacks.js

`test/install.test.js` is the suite that validates the **installer
itself** (what gets written, for which stack, based on which git host) —
don't confuse it with `templates/common/test_policy_engine.js`, which
validates the policy engine that ends up installed in the target project
(and which `npm test` also runs, as a subprocess). No external
dependencies, runs identically on Windows/macOS/Linux:

```bash
npm test
```

Run this after any change to `install.js`, `generate.js`, or `stacks.js` —
it's wired into the pipeline (`.gitlab-ci.yml`), so a change that breaks it
shouldn't get merged. If you add a new stack or a new host-detection case,
add its test case here too.
