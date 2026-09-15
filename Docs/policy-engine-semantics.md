# Policy engine semantics

`templates/common/policy_engine.js` exposes one entrypoint, `evaluate()`,
called by every per-harness adapter. This document is about what happens
*inside* that function, and the design reasoning behind each layer — the
"why," not just the rule table (that's `RULES.md`, generated and always
current).

## Evaluation order

`evaluate()` checks things in a fixed order, and stops at the first
decision that isn't `allow`:

1. **Structured file tool calls** (`Write`/`Edit`/etc. carrying a
   `file_path`) — resolve the path (symlinks, `~`, relative-to-workspace),
   deny if it escapes the workspace root or matches `protected_paths`.
2. **Shell commands** — match against `blocked_commands` regexes first,
   then tokenize the command (best-effort, not a real shell parser) and
   check every path-like token against the same `protected_paths`.
3. **Guardrail self-protection** — editing/deleting `.agent-security/**`,
   any harness's hook config, or any known ignore file always returns
   `deny`, checked for both structured calls and shell commands, so an
   agent can never disable its own guardrails mid-session.
4. **Default: `allow`.**

## `deny` is enforced; `ask` is delegated

This is the distinction that matters more than any individual rule in the
table:

- **`deny` is enforced by the hook.** The engine returns `deny`, the harness
  aborts, and the operation does not happen. There is no session mode that
  bypasses it.
- **`ask` is delegated to the harness.** The engine says "this needs a
  human," and the harness decides how to ask. If the session runs in a mode
  that auto-approves — auto-accept, bypass,
  `--dangerously-skip-permissions` — the `ask` is granted with no visible
  prompt. It's still logged in `audit.log` as `ask`, but the command runs.

So: **everything marked `ask` in `RULES.md` is a warning, not a barrier**,
and its real-world value depends entirely on the permission mode the agent
happens to be running in. If something must be prevented no matter what,
it has to be `deny` in `policy.yaml` — changing a rule's `action` is a
one-word edit, but it's a decision that has to be made deliberately per
rule.

This was verified in the field: in a session with prompts active, the
core `ask` rules did pause and wait for a human response. The tier
mechanism works; what depends on the session's permission mode is whether
the question ever gets asked.

**Corollary, and the reason this can't be self-certified:** an agent cannot
verify the `ask` tier from the inside. The prompt goes to a human, and once
approved the tool call simply succeeds — from the agent's point of view, an
approved `ask` and a plain `allow` are indistinguishable. Only a human
watching the session can confirm which one actually happened.

## `protected_paths` is live, not baked in

The list merges two sources on every single call (mtime-cached, not read
once at install time):

1. `policy.yaml`'s own `protected_paths` list.
2. Whatever non-standard ignore files (`.cursorignore`, `.agentsignore`,
   `.aiignore`, ...) exist at the workspace root right now.

`!negation` lines in those ignore files are deliberately **never** honored.
A repo's own ignore file may only ever *add* protection, never remove it —
this is intentional (G9), not an oversight to "fix" later. If negation were
honored, a single line committed to `.cursorignore` could quietly re-open a
path the core rules had closed.

## Self-protection (G8): deny on write, allow on read

Early on, self-protection was implemented as `ask`. That was wrong, and the
reasoning for reversing it is worth keeping:

- **Writing/deleting** guardrail infrastructure — `.agent-security/**`, any
  harness's hook config, `.husky/**`, `.github/workflows/**`, or a known
  ignore file — is the single most consequential action an agent could take
  against its own restraints. Putting that decision behind an `ask` prompt
  puts it behind the click a distracted human makes fastest, and the reward
  for that one click is every guardrail turned off at once. It is now
  **`deny`**, unconditionally, for structured calls, for shell commands that
  would modify those paths (`rm`, `mv`, `>`, `sed -i`, `chmod`, `tee`,
  `patch`, `git rm`, ...), for the camelCase `filePath` key as well as
  `file_path`/`path`, and for any **unrecognized** tool name — the exemption
  list is an allowlist, not a denylist.
- **Reading** those same paths is `allow`. Reading disables nothing, and
  putting a prompt in front of every read trains the human to approve
  `.agent-security/**` prompts from memory — which then lets the one prompt
  that actually matters slip through unread. It also made the kit's own
  `SELF_TEST_PROMPT.md` impossible to run, since denying reads is the
  instinctively "safe" choice that actually blocks legitimate verification.
- A shell command that merely **names** one of these paths (`ls
  .agent-security/`) stays `ask` — the tokenizer isn't a real shell parser
  and can't prove the command is read-only.
- **One deliberate exception:** `.github/workflows/**`. Writing it is still
  denied through every path, but *naming* it in a shell command does not
  prompt. It's the place anyone — human or agent — looks to answer "how does
  CI work here," so it gets read and listed constantly, and the previous
  behavior wasn't even internally consistent (`ls .github/workflows/`
  passed while `ls .github/workflows/*.yml` asked, because a bare directory
  doesn't match a `/**` glob). Prompting on ordinary inspection is exactly
  how a human is trained to click through prompts without reading them.

## What this layer does not do

This is a policy gate evaluated by regex and path matching — it is not a
sandbox. An agent with active motivation to evade it could, in principle,
obfuscate filenames, use a tool this kit doesn't hook, or read environment
variables already loaded into the shell. This layer raises the cost of
doing so and leaves an audit trail (`.agent-security/audit.log`); it does
not replace OS/container-level isolation, and an agent should never be
handed production credentials regardless of what the policy engine allows.
