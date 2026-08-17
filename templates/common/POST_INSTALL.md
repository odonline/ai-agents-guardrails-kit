# Post-install checklist — what each step actually means

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

## 1–2. Install policy-engine deps and run its test suite — [recommended]

```bash
pip install pyyaml pytest --break-system-packages
pytest .agent-security/test_policy_engine.py
```

`policy_engine.py` is the actual enforcement logic (what gets denied, what
needs approval). This runs its own test suite once, locally, so you find
out *now* if something about your Python environment is broken — not the
first time an agent tries to do something dangerous and the hook silently
fails open. Skipping this doesn't turn anything off; it just means you're
trusting the engine works without having checked.

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
  `.agent-security/test_policy_engine.py` and the per-stack checks listed
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
`pytest .agent-security/test_policy_engine.py` to make sure nothing
regressed.

## 7. Have an agent validate the guardrails itself — [optional, recommended once]

Every step above tells you the files are in place; none of it proves the
policy actually fires against a live agent session. `SELF_TEST_PROMPT.md`
(same directory as this file) is a ready-to-paste prompt that has an agent
attempt each blocked command and protected path with its real tools and
report the real decision it got back — the same "don't trust, verify"
principle `final_check.py` applies to tests, applied to the guardrails
themselves. It's built to be safe to run even if something turns out to
be broken (scratch directory, no real remote, no real database) — read
its "Safety rules" section before running it.

## What none of this covers

See `.agent-security/README.md` → "What this does NOT do." Short version:
this is a policy gate evaluated by regex/paths, not a sandbox. Combine it
with OS/container isolation and never give the agent production
credentials.
