#!/usr/bin/env node
/**
 * Claude Code PreToolUse adapter.
 *
 * Reads Claude Code's hook JSON from stdin, calls the shared policy engine, and
 * prints a Claude Code-shaped permission decision to stdout. Translation only —
 * no policy decisions live here (G3).
 *
 * Input shape (relevant fields):
 *   {"tool_name": "Bash", "tool_input": {"command": "..."}}
 *   {"tool_name": "Write", "tool_input": {"file_path": "...", "content": "..."}}
 *
 * Output shape:
 *   {"hookSpecificOutput": {"hookEventName": "PreToolUse",
 *                           "permissionDecision": "allow"|"deny"|"ask",
 *                           "permissionDecisionReason": "..."}}
 *
 * Every failure path prints a well-formed deny and exits 0. A crashed hook —
 * empty stdout, non-zero exit — leaves the harness's behavior undefined, and
 * "undefined" in a PreToolUse gate can mean "go ahead".
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ENGINE_DIR = path.resolve(__dirname, "..", "..", ".agent-security");

function emit(action, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: action,
        permissionDecisionReason: reason,
      },
    }) + "\n"
  );
}

function denyAndExit(reason) {
  emit("deny", reason);
  process.exit(0);
}

/**
 * Why the engine would not load, phrased so the person staring at a blocked
 * session can act on it. Presentation only — no policy decision is made here
 * (G3); the decision was already "deny".
 *
 * Naming the specific absence matters because the most common one has a
 * non-obvious cause. `.agent-security/vendor/` holds the engine's YAML parser,
 * and PHP, Go and Ruby projects ignore `vendor` at any depth, so that one
 * directory can be missing from a fresh clone while every other file is
 * present. The symptom is every tool call denied, including `git status`, with
 * nothing to pull on.
 */
function engineLoadFailureReason(err) {
  if (!fs.existsSync(ENGINE_DIR)) {
    return (
      "Guardrail hook could not load the policy engine: .agent-security/ does not exist. " +
      "This install looks half-removed — reinstall the kit, or remove the hook entry " +
      "that points here. Denying until then."
    );
  }
  if (!fs.existsSync(path.join(ENGINE_DIR, "vendor", "js-yaml.js"))) {
    return (
      "Guardrail hook could not load the policy engine: its vendored YAML parser " +
      "(.agent-security/vendor/js-yaml.js) is missing. That directory is usually absent " +
      "because it was never committed — an unanchored `vendor` rule in .gitignore, standard " +
      "in PHP, Go and Ruby projects, hides it. Check with " +
      "`git check-ignore -v .agent-security/vendor/js-yaml.js`. Denying until then."
    );
  }
  return `Guardrail hook could not load the policy engine (${(err && err.message) || err}); defaulting to deny.`;
}

function main() {
  let engine;
  try {
    engine = require(path.join(ENGINE_DIR, "policy_engine.js"));
  } catch (e) {
    // The engine being absent is exactly what a half-removed install looks
    // like. Deny rather than die — but say which absence.
    denyAndExit(engineLoadFailureReason(e));
  }

  let raw;
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch (e) {
    denyAndExit("Guardrail hook could not read tool input; defaulting to deny.");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    denyAndExit("Guardrail hook could not parse tool input; defaulting to deny.");
  }

  const toolName = (payload && payload.tool_name) || "";
  const toolInput = (payload && payload.tool_input) || {};

  // Pass the payload straight through as audit context. The engine keeps an
  // allowlist of metadata keys and ignores everything else, so this cannot leak
  // tool content into the log. The one that matters is `permission_mode`:
  // `deny` is enforced here, but `ask` is handed to the harness, and in an
  // auto-approving mode it is approved with no prompt. Without the mode on the
  // line, "asked and a human said yes" and "asked and the mode said yes" look
  // identical after the fact.
  const decision = engine.evaluateFromDict(toolName, toolInput, payload);
  emit(decision.action, decision.reason);
  process.exit(0);
}

try {
  main();
} catch (e) {
  denyAndExit(`Guardrail hook error, defaulting to deny: ${(e && e.message) || e}`);
}
