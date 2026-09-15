# Testing and verification

What each test suite in this repo actually proves, and why mutation testing
carries more weight here than it does in a typical codebase — this is a
security gate; a passing test suite that never verified its own ability to
fail is not evidence of anything.

## The two suites, and what each one is scoped to

- **`test/install.test.js`** (`npm test`) — the installer's own regression
  suite. Zero external dependencies, runs on Windows, macOS, and Linux
  (G10). Exercises `install.js`, `stacks.js`, `generate.js`, `docs.js`
  against real scratch directories and real git repos — never against this
  repo itself.
- **`templates/common/test_policy_engine.js`** — the payload's own suite.
  Pure, so it runs straight from the kit source without installing
  anything first. `npm test` also runs it as a subprocess, plus checks that
  the generated `policy.yaml` loads for every stack and that the vendored
  `js-yaml` still matches its recorded SHA-256. Inside an installed target
  project, the identical suite lives at
  `.agent-security/test_policy_engine.js`.

The repo's own CI (`.gitlab-ci.yml`) runs `npm test`, a `node docs.js`
staleness check (fails the pipeline if `RULES.md` doesn't match
`generate.js`/`stacks.js` — this is G5 enforced mechanically, not just
documented), and an install-plus-engine-suite loop against a fixture
directory for every supported stack. No Python is provisioned anywhere in
CI — the runtime was fully ported to Node (see
`Tasks/policy-engine-node-port/`).

## Behavior parity on the Python → Node port

Porting the engine could not drop a single test case or a single rule (G14).
Parity was verified three separate ways, not just one: the original suite's
cases were ported one-to-one under the same names; a differential test ran
54 inputs through both engines side by side (53 identical outcomes, one
intentional divergence, documented as such rather than silently accepted);
and a real end-to-end install was run per stack. `test/install.test.js`
freezes those original case names as the standing G14 baseline now that the
Python files are gone — the reference they were compared against no longer
exists in the working tree, so the frozen names are what future changes get
checked against.

## Why mutation testing, specifically, for this codebase

A test that's supposed to catch a security regression has to be proven
capable of catching it — a green suite that would also be green with the
bug reintroduced is worse than no test, because it's trusted. Several
guards in this repo were explicitly verified this way, not just written and
assumed correct:

- The structural test guarding against the "adjacency" class of bypass (see
  [`lessons-learned.md`](./lessons-learned.md)) was mutation-tested by
  deliberately reintroducing `docker\s+push` — the test failed and named
  the exact pattern. Notably, the *first* version of that test didn't
  detect anything at all: it was a regex over regexes, over-escaped, and
  passed vacuously. Only the mutation run exposed that the test itself was
  broken.
- The three tests enforcing "the kit never commits" (G17) — invocation-site
  inspection, generated-content inspection, and the end-to-end dirty-working-tree
  test — were each verified against six distinct injected violations (an
  inline call, an array form, a template literal with interpolation, an
  unrecognized git verb, and a `git add` inside a generated hook). All six
  were caught, with no false positives against the legitimate config or
  prose that happens to contain phrases like `git push --force` as literal
  blocked-command patterns.
- The Windows/MSYS path-escape fix (see
  [`lessons-learned.md`](./lessons-learned.md)) has regression tests for
  all three affected path spellings, plus one confirming a first path
  segment that *isn't* a drive letter (`/config/app.yml`) is still handled
  the old way — a guard against the fix over-firing on unrelated paths.

**The general takeaway:** for a change that's supposed to close a security
gap, "the new test passes" is a necessary condition, not a sufficient one.
Reintroduce the bug and confirm the test actually fails, and check the test
doesn't also fail (or silently pass) on inputs it was never meant to touch.

## `SELF_TEST_PROMPT.md`: verification against a real agent, not just a test runner

`SELF_TEST_PROMPT.md` ships with every installed project — a ready-to-paste
prompt that has an actual agent, using its actual tools, confirm that each
blocked command and protected path really is denied or asked, and that
legitimate work is unaffected, rather than trusting that the policy engine
does what `policy.yaml` claims. Several of the most consequential bugs in
this system's history (the MSYS path bypass, the global-option adjacency
bypass) were found by running this prompt against a real project, not by
the kit's own automated suite — which is itself evidence for why it's worth
keeping current.

Three corrections came directly out of actually using it:

- A set of rows required creating a fixture file (`.env.selftest`) before
  testing that `.env.*` gets denied — but creating that fixture is itself
  denied, since the engine matches the *pattern*, not whether the file
  exists yet. The instruction now says explicitly not to create it.
- A dedicated section verifies that the *same* protected path, written
  several different ways (`~/`, an absolute path, MSYS `/c/`, Cygwin
  `/cygdrive/c/`), produces the *same* decision every time — this is
  precisely the section that would have caught the MSYS bypass before it
  shipped.
- "Blocked at setup" is written as an instruction, not left implicit: an
  agent that can't construct a particular fixture records that row and
  keeps going. A partial table with honest gaps is useful; a run that
  silently stops at the first obstacle is not.

## What "passing" does and doesn't prove

A completion-gate check that exits `0` can mean the check genuinely passed,
or it can mean the check was *skipped* because the required tool isn't
installed on that machine — the generated check commands degrade on
purpose (for example,
`[ -x vendor/bin/phpunit ] && vendor/bin/phpunit || echo "phpunit not installed, skipping"`).
That's a deliberate choice: the gate shouldn't fail just because a toolchain
piece is missing. But it also means a green completion report on a machine
without the full toolchain proves less than it looks like it proves — the
actual `command` that ran is included in the report specifically so this
can be told apart after the fact.
