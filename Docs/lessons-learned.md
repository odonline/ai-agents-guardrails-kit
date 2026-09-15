# Lessons learned

Concrete bugs found in this system, most of them by actually *using* the
kit against a real project rather than by its own test suite — and the
general, reusable principle each one left behind. The full blow-by-blow
lives in `CHANGELOG.md`; this file is the distilled "what should the next
person watch out for" version.

## An `ask` rule is not a barrier if the session auto-approves

The most consequential rule in the whole system — self-protection — was
originally `ask`. It looked safe on paper: an agent trying to rewrite
`policy.yaml`, delete an ignore file, or edit a hook config would be asked
first. In practice, in any session running with auto-approval, that "ask"
was granted silently, with no human ever seeing a prompt. A full
self-protection bypass, verified: the engine answered `allow` on a rewrite
of its own rules.

**The general lesson:** `ask` and `deny` are not the same mechanism with
different friction — `ask` is *delegated* to the harness and its outcome
depends on the session's permission mode, while `deny` is enforced
unconditionally by the hook itself. Anything that must never happen,
regardless of session mode, has to be `deny`. See
[`policy-engine-semantics.md`](./policy-engine-semantics.md).

## Reading a protected file is not the same risk as writing it

The mirror image of the bug above: self-protection originally fired on
*reads* too, with the reasoning "change to guardrail infrastructure" — but
reading `policy.yaml` doesn't change anything, and `policy.yaml` itself is
committed and readable in plain text anyway. Prompting on every read had a
real cost: an agent reads constantly, so a human gets trained to approve
`.agent-security/**` prompts reflexively — and then the one prompt that
actually mattered got clicked through unread too. It also made the kit's
own self-test prompt literally impossible to run, since denying reads (the
"safe-looking" instinct) blocked legitimate verification outright.

**The general lesson:** a security control that fires on harmless actions
doesn't just annoy people — it actively degrades the control, because it
trains the human overseeing it to stop reading prompts. Match the
control's cost to the actual risk of the action, not to which directory the
action touches.

## A rule matching one spelling of a command is not a rule

A pattern like `git\s+commit\s+.*--no-verify` requires `git` and `commit` to
sit directly adjacent — but almost no CLI actually works that way; global
options go between the program and its subcommand
(`git -c user.email=x commit --no-verify`, `git -C /path reset`,
`docker --config=/tmp push`). Measuring the actual blast radius found
**eleven** rules with the identical gap, not one — including force-push,
destructive git operations, `npm publish`, unpinned `npx`, Laravel
migrations, `composer remove`, `twine upload`, and `pip install
--index-url`. One rule that *looked* like it still held
(`git --git-dir=.git branch -D main` was denied) turned out to be a
coincidence: the path happened to end in `.git`, so `git branch -D` existed
as a substring by accident, not by design — `--git-dir=/tmp/x` sailed
straight through.

The fix replaced the adjacency assumption with a deliberately simple,
deliberately linear character class (`[^;&|\n]*?`, documented in
`RULES.md`) rather than trying to model each CLI's actual option grammar —
modeling the grammar would mean the rule goes stale the moment any of those
tools adds a flag.

**The general lesson:** a regex written against one example invocation of a
command is a rule that matches one spelling, not the command. Test every
new blocked-command pattern with a global option inserted between the
program and its subcommand — this is now a standing structural test that
fails and names the offending pattern if adjacency creeps back in, verified
by deliberately reintroducing the bug and confirming the test catches it.

## The same protected path can be spelled differently by the OS

`~/.ssh/id_rsa` was denied. `/c/Users/<user>/.ssh/id_rsa` — the exact same
file, reached through Git Bash / MSYS2's own path convention — was
`allow`ed. `path.resolve()` on Windows turned `/c/...` into the literal,
nonexistent path `C:\c\...`, which naturally matched no anchored pattern.
This affected every anchored pattern (`~/.ssh/**`, `~/.aws/**`,
`~/.config/gcloud/**`); patterns matching by bare filename (`.env`) still
caught it, which is exactly why the bug went unnoticed for a while.

The fix translates MSYS-style (`/c/...`) and Cygwin-style (`/cygdrive/c/...`)
paths to real Windows paths before resolving — only on `win32`, since on
genuine POSIX systems `/c/Users` is a legitimate absolute path and rewriting
it would be wrong there.

**The general lesson:** a path-matching security rule has to be tested
against every way the *host OS and shell combination* can spell the same
file, not just the canonical form. This was found by running the kit's own
self-test prompt against a real project, not by any test the kit shipped
with — which is itself a lesson about what test suites tend to miss.

## Installing a file is not the same as delivering it

Three ecosystems (PHP/Composer, Go, Ruby) ship a bare `vendor` line in
their default `.gitignore`. Unanchored, that pattern matches a directory
named `vendor` at *any* depth — including
`.agent-security/vendor/`, where the vendored `js-yaml` engine dependency
lives. The installer wrote the files, reported success, the developer
committed — and whoever cloned the repo got an engine that couldn't load
its own YAML parser. Because the engine fails closed (G2, correctly), the
result was every tool call denied, `git status` included: an entire team
locked out by one missing vendored file nobody had been warned about.

The fix adds two negation lines to the target's `.gitignore` (`
!.agent-security/vendor` and `!.agent-security/vendor/**` — both are needed,
one re-includes the directory itself or git never descends into it, the
other re-includes the files inside it), and then **verifies** the fix
worked with `git check-ignore` rather than assuming a negation added at the
end of a file always wins — a nested `.gitignore` inside
`.agent-security/` could still shadow it.

**The general lesson:** when a payload gets installed into a project with
its own pre-existing configuration (in this case, `.gitignore`), the
installer has to check for interaction with that configuration, not just
write files and declare success. "Files exist on disk" and "files survive
the target's own tooling" are different claims.

## A gate that can time out without writing a report has already failed

The completion gate re-executes `required_checks` at session end rather
than trusting the agent's claim that tests passed — but each individual
check had a 600-second allowance while the hook config that invokes the
whole gate only allowed 60 seconds for the `Stop` event. For a stack with
three checks, the theoretical ceiling was 1800 seconds against a 60-second
budget. A hook the harness kills for running too long **writes no report at
all** — which is a gate failing *open*, the one thing a gate must never do.

The fix introduced a single total budget the gate enforces internally
(shorter than the hook's own timeout, so it always has time left to write a
result), and raised the hook timeout to leave room for that. Exhausting the
budget now produces an explicit `blocked` result naming what didn't get to
run, with a non-zero exit — a failure that's closed and on the record,
instead of one that's silent.

**The general lesson:** two independent timeout values that are supposed to
nest inside one another (an outer hook timeout and an inner per-check
budget) need a test asserting the invariant between them, or they will
drift apart independently and the failure mode is invisible until
something actually times out in production.

## A value recorded for "this machine" cannot be restored blindly on another

The uninstaller restores `core.hooksPath` to whatever it was before
install — but that value is genuinely per-machine, and a manifest is
committed and shared across every developer who clones the repo. Someone
else's clone can perfectly well have a manifest recording a
`core.hooksPath` value that names a directory that never existed on *their*
disk. Restoring it anyway leaves their git pointing at nothing — and git
then runs no hooks at all, in total silence, which is the exact failure
class this system exists to prevent, just triggered on the way out instead
of the way in.

**The general lesson:** a manifest that's meant to be shared (for good
reasons — see
[`install-uninstall-lifecycle.md`](./install-uninstall-lifecycle.md)) can
still contain fields whose correct value is genuinely local. Every
consumer of that manifest has to treat those fields as *claims to verify*,
not facts to trust.
