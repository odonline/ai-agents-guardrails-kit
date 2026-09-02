# Post-install checklist — what each step actually means

**Requirement: `node` must be on your `PATH`.** The policy engine runs on
Node (>= 16) and vendors its only dependency, so that is the entire
prerequisite — nothing to install, no package manager, no virtualenv. If
`node --version` fails, the hooks cannot run and nothing here is enforced.

The installer just printed a numbered list of "next steps." This file is
the long version: for each one, what it is, why it's there, and what
concretely breaks if you skip it. Read this once after installing, then
you shouldn't need it again unless you re-run the installer against a
fresh project.

Each step below is tagged the same way the installer tags it in its
console summary:

- **[required]** — skip it and part of what you just installed is inert
  (writes files, but nothing actually enforces anything).
- **[recommended]** — nothing breaks if you skip it, but you lose a real
  safety net and should have a reason for skipping.
- **[if applicable]** / **[done]** / **[pending]** — situational: the
  installer already tells you which one applies to your specific run.
- **[optional]** — purely a matter of taste/tuning, the defaults work.

## 1–2. Nothing to install — run the engine's test suite — [1: done, 2: recommended]

There are no dependencies to install. The policy engine runs on Node and
ships its only dependency (js-yaml) vendored in
`.agent-security/vendor/` — a single self-contained file, verified by
checksum, no package manager involved. Step 1 is already done.

Step 2 runs the engine's own test suite once, locally:

```bash
node .agent-security/test_policy_engine.js
```

`policy_engine.js` is the actual enforcement logic (what gets denied, what
needs approval). Running its suite now tells you the engine works on this
machine — rather than finding out the first time an agent tries something
dangerous and the hook fails. Skipping it turns nothing off; it just means
you are trusting the engine without having checked.

## 3. Merge any `*.new` files — [if applicable]

Only shows up if a file the installer wanted to write already existed
(e.g. you already had a `.claude/settings.json`). The installer never
overwrites an existing file — it writes the generated version next to it
with a `.new` suffix so you can diff and merge by hand. If this step
didn't print, there was nothing to merge; you can ignore it.

## 4. `core.hooksPath` pointing at `.husky/` — [required if you installed git hooks]

This is the one that's easy to get wrong silently. Git **only** runs
hooks from `.git/hooks/` unless you tell it otherwise — writing files
into `.husky/pre-commit` and `.husky/pre-push` does nothing on its own.
The installer tries to run `git config core.hooksPath .husky`
automatically the moment it detects your project is already a git repo,
and its summary tells you which of these happened:

- **`[done]`** — it configured it for you. The hooks are live; try
  `git commit` once to see the `[pre-commit]` output.
- **`[required]`, no repo yet** — you scaffolded the project before
  running `git init`. Once you do, run
  `git config core.hooksPath .husky` yourself (or `npx husky init` and
  move the generated hook files into whatever Husky sets up) — otherwise
  the hooks in `.husky/` are just text files nobody ever executes.
- **`[required]`, config failed** — same fix, run it manually; the
  installer will tell you it couldn't do it automatically (unusual — a
  permissions issue is the most likely cause).

Either way, remember these are a **convenience layer**, not the
enforcement layer: anyone can bypass them with `--no-verify` (which the
policy engine itself blocks as a command, but only for agents it's
hooked into — a human at the terminal can still do it). The layer that
can't be bypassed is CI + branch protection, which is step 5.

## 5. Branch protection / CI enforcement — [recommended]

The installer generates a CI job that re-runs your stack's checks and
the policy-engine test suite (`.github/workflows/security.yml` on GitHub,
`.gitlab-ci.yml` on GitLab — it picks the file based on your `origin`
remote, or `--ci <host>` if you passed it explicitly). Generating the
file isn't enough by itself:

- **GitHub** — go to repo Settings → Branches → add a protection rule for
  your default branch, require the `security-gate` / `guardrails` status
  check to pass before merging.
- **GitLab** — add a merge request approval rule and/or a push rule that
  requires the pipeline defined in `.gitlab-ci.yml` to succeed.
- **Neither generated** (unknown host, or you passed `--ci none`) — no CI
  file was written at all. Either re-run the installer with
  `--ci github` / `--ci gitlab`, or wire your own pipeline using
  `.agent-security/test_policy_engine.js` and the per-stack checks listed
  in `RULES.md` as a reference.

Until this is wired up, the *only* thing stopping an agent (or a human)
from bypassing every check is discipline — the git hooks from step 4 can
always be skipped with `--no-verify`.

## 6. Tune `policy.yaml` — [optional]

`.agent-security/policy.yaml` is the single source of truth for rules —
generated once at install time from the stack(s) detected, never
overwritten by re-running the installer. The defaults are usable as-is;
edit it when you have project-specific paths to protect (see "`.gitignore`
does not protect anything here" in `.agent-security/README.md`) or
commands to add. After editing, re-run
`node .agent-security/test_policy_engine.js` to make sure nothing
regressed — the engine refuses to run at all on a policy file it cannot
fully parse, so this catches a typo before it becomes a silent gap.

## 7. Have an agent validate the guardrails itself — [optional, recommended once]

Every step above tells you the files are in place; none of it proves the
policy actually fires against a live agent session. `SELF_TEST_PROMPT.md`
(same directory as this file) is a ready-to-paste prompt that has an agent
attempt each blocked command and protected path with its real tools and
report the real decision it got back — the same "don't trust, verify"
principle `final_check.js` applies to tests, applied to the guardrails
themselves. It's built to be safe to run even if something turns out to
be broken (scratch directory, no real remote, no real database) — read
its "Safety rules" section before running it.

## Need it out of the way for a bit?

```bash
node .agent-security/toggle.js --disable    # ...and --enable to bring it back
```

Nothing is deleted — not your `policy.yaml`, not the adapters, not `.husky/`.
Each harness's hook config is renamed out of the way and `core.hooksPath` goes
back to what it was, so the harness simply stops calling the engine. Use this
when you want to work without the gate for a while, or to check whether the kit
is what's causing something.

There is deliberately no `enabled: false` flag for this, because that flag would
live inside the engine — a code path whose whole job is to allow everything, in
the one component that exists to fail closed. Disabling means unhooking, and a
rename shows up in `git status` where a flag inside a YAML would not.

## Changed your mind for good?

```bash
node .agent-security/uninstall.js
```

Shows a plan, asks for confirmation, then removes what the installer put there —
and only that. Anything you edited is kept and reported, `core.hooksPath` goes
back to whatever it was before, and only the `.gitignore` lines the installer
added get removed. See `.agent-security/README.md` for the details.

Being able to leave cleanly is the point: a kit you cannot remove is a kit
nobody tries.

## What none of this covers

See `.agent-security/README.md` → "What this does NOT do." Short version:
this is a policy gate evaluated by regex/paths, not a sandbox. Combine it
with OS/container isolation and never give the agent production
credentials.
