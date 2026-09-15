# Install, toggle, and uninstall lifecycle

Installing guardrails into someone else's project is invasive: it touches
`.agent-security/`, the harness's own config, `.husky/`, CI, three
root-level contract files, `.gitignore`, and `git config core.hooksPath`. A
kit that only knows how to go in, and not how to come back out, is a kit
nobody actually tries — because trying it becomes irreversible in practice.
This doc covers the three lifecycle operations and the reasoning that makes
each one safe.

## What gets committed, and what stays local

**Almost everything gets committed.** A guardrail only one person has isn't
a guardrail: if it stays local, a teammate's agent runs unrestricted over
the same repo, and the risk was never "my agent" — it was always "an
agent."

Three pieces specifically don't work at all unless they're tracked:

| Path | Why it must be committed |
|---|---|
| `.husky/pre-commit`, `.husky/pre-push`, and the chaining shims | That's how husky works — hooks are repo content. Shims are written without absolute paths specifically so they can be committed. |
| `.github/workflows/security.yml` or `.gitlab-ci.yml` | Without committing it, the pipeline doesn't exist. CI + branch protection is the *real* enforcement layer; git hooks are convenience. |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | This is the whole team's operating contract for agents, not one developer's personal config. |

`policy.yaml` is committed too — it's the shared rule set, and changing a
rule should go through review like any other change. `install-manifest.json`
is committed as well, because without it nobody who clones the repo can run
`--uninstall`.

**What stays local, per developer:** `core.hooksPath` (it's `git config`,
not a file), `audit.log` and `completion_reports.log` (per-machine forensic
logs containing literal command text — already gitignored), any `.new`
files, and `.claude/settings.local.json` for personal permission overrides.

There's a structural reason behind all of this, not just a convention:
deactivation works by **unhooking**, not by a flag, specifically *because* a
rename shows up in `git diff` and a flag buried in a YAML file doesn't. If
nothing here were tracked, that argument would collapse — there'd be
nothing for a teammate or a CI diff to notice.

## The step nobody tells the person who clones

`core.hooksPath` cannot be committed, so **every person who clones the repo
has to run this once**:

```bash
git config core.hooksPath .husky
```

Until they do, `.husky/` sits in their working tree and git ignores it
entirely — the hooks are just text files nobody executes, and nothing
warns them. This is the single most common way a team ends up believing
guardrails are active for everyone when they're actually active for one
person.

## What the installer never does to git

It never commits. `install.js` does not run `add`, `commit`, `push`,
`checkout`, `reset`, `merge`, `rebase`, `stash`, `tag`, or `branch` — nor
does the uninstaller, the toggle script, or anything the kit generates
(G17). A generated hook that staged files on your behalf would be worse
than the installer doing it once: it would do it on every commit, in every
clone, forever.

The one piece of git state it writes is `core.hooksPath` (G12), and that
write is recorded in the manifest and reverted on uninstall or disable.
This is verified by tests, not just documented: the invocation sites are
inspected, the generated hook and CI content is inspected, and an
end-to-end test installs over a repo with an existing commit and a dirty
working tree and confirms `HEAD`, the index, and uncommitted files are
untouched afterward.

## Chaining, not replacing, existing hooks

Pointing `core.hooksPath` at `.husky` does not make `.husky` "win" over
whatever directory was effective before — it makes git **stop looking at
the old directory entirely**. That matters for any project that already had
hooks: in `.githooks/` with its own `core.hooksPath` set, or directly in
`.git/hooks/` (where Python's `pre-commit`, husky v4, lefthook, or an IDE
leave them). And since this kit only generates `pre-commit` and `pre-push`,
a project's own `commit-msg` or `post-merge` hook would have no replacement
at all — it would simply disappear.

So the installer **chains instead of overwriting** (G12). For every hook it
finds in the directory that was effective before (ignoring `*.sample`
files, which git never executes), it writes a shim into `.husky/` that runs
the project's original hook first and propagates its exit code — if the
original fails, the operation stops there and the kit's own check never
runs. For `pre-commit` and `pre-push` the chained block sits above the
generated hook body; for any other hook type, the whole file is a pure
passthrough. The block is marked with a `>>> guardrails-kit: chained hook
>>>` comment explaining what it is and how to remove it, because someone
will eventually find it in a `git diff` with zero context.

When chaining can't be done safely — the previous `core.hooksPath` was
absolute or pointed outside the repo, the directory can't be read, or a
`.husky/<hook>` already exists that this kit didn't write — the installer
**does not touch `core.hooksPath` at all**. It explains what it found and
gives the exact command to proceed anyway. The guiding principle: leaving
guardrails inactive and saying so is strictly better than silently
disabling a safeguard the project already had (G12).

`--no-chain-hooks` installs without chaining (the pre-chaining behavior).
`--uninstall` removes the shims and restores the prior `core.hooksPath`.

## The manifest is what makes uninstall precise

`.agent-security/install-manifest.json` records everything a given install
run wrote: each file's path, content hash, and whether it was `written` or
`skipped`; every `.new` sibling left behind; every directory created; the
`core.hooksPath` before and after; and the exact lines added to
`.gitignore`. It's the only kit-authored file that gets **overwritten** on
reinstall rather than written as a `.new` sibling — it's a derived record of
kit state, not project content someone might have hand-edited.

**The rule both `toggle.js` and `uninstall.js` follow, and the one that
actually matters: they remove what the installer put there, never what a
human edited afterward.** A file is deleted only if the manifest recorded
it *and* its current content still matches byte-for-byte what was written
(line-ending differences aside). A `policy.yaml` someone tuned, or a
`settings.json` merged by hand, is preserved and reported — not silently
kept, but explicitly called out.

**Accepted consequence: an uninstall can end deliberately incomplete.** The
summary states this in a line that's impossible to miss — if a hook config
is still wired to a now-partially-removed `.agent-security/`, it names that
file, because until it's removed, every tool call will hit a hook pointing
at a policy engine that no longer exists, and the adapters answer `deny` in
that situation (G2). It fails closed: it denies everything, never allows
everything.

## Disabling is unhooking, not a flag

There is no `enabled: false` the *engine* reads (G16). Adding one would mean
adding a code path inside the one component that exists specifically to
fail closed whose entire job is to return `allow` for everything — and it
would be a single file an agent could try to create to free itself, which
is exactly the class of attack G8 self-protection exists to prevent.

`--disable` renames each harness's hook config (`settings.json` →
`settings.json.disabled`) and restores the previous `core.hooksPath`. It is
purely subtractive, and it shows up in `git status` — a disable→enable cycle
restores the configuration byte for byte. (The `"enabled"` key that already
exists in Antigravity's own `hooks.json` is fine — that's read by the
*harness*, not by the engine.)

## Restoring `core.hooksPath` only when it's safe to

`git.hooksPathBefore` is the one manifest field that's genuinely
machine-specific: it records what *this* developer had configured before
installing. In someone else's clone, that value might name a directory that
never existed on their machine. Restoring it blindly would leave their git
pointing at nothing — and git then runs *no* hooks at all, silently: the
exact G12 failure this system exists to prevent, just triggered by the
uninstaller instead of the installer. The uninstaller now checks that the
recorded directory actually exists in the current clone before restoring
it; if it doesn't, it unsets the value and explains why.
