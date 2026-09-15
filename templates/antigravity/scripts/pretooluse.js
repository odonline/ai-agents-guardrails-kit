#!/usr/bin/env node
/**
 * Antigravity PreToolUse adapter.
 *
 * Translation only — no policy decisions here (G3), with one documented
 * exception: ALWAYS_ASK_TOOLS below covers Antigravity-only tools that have no
 * path or command for the engine to reason about, so there is nothing to ask
 * the engine. That list is a harness capability mapping, not a policy rule.
 *
 * Input shape:
 *   {"toolCall": {"name": "run_command", "args": {"command": "..."}}}
 *
 * Output (Antigravity accepts allow / deny / ask / force_ask):
 *   {"decision": "allow"|"deny"|"ask"|"force_ask", "reason": "..."}
 *
 * Every failure path prints a well-formed deny and exits 0.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ENGINE_DIR = path.resolve(__dirname, "..", "..", ".agent-security");

const TOOL_NAME_MAP = {
  run_command: "Bash",
  write_to_file: "Write",
  replace_file_content: "Edit",
  multi_replace_file_content: "Edit",
};

// Antigravity-only tools with persistent or recurring effects and no path or
// command for the engine to inspect. They always require approval.
const ALWAYS_ASK_TOOLS = new Set([
  "schedule",
  "invoke_subagent",
  "define_subagent",
  "ask_permission",
]);

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({ decision, reason }) + "\n");
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
  let raw;
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch (e) {
    denyAndExit("Could not read tool call; defaulting to deny.");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    denyAndExit("Could not parse tool call; defaulting to deny.");
  }

  const toolCall = (payload && payload.toolCall) || {};
  const rawToolName = toolCall.name || "";
  const toolInput = toolCall.args || {};

  // Checked before loading the engine: these need no policy evaluation, so a
  // missing engine should not turn an `ask` into a `deny` here.
  if (ALWAYS_ASK_TOOLS.has(rawToolName)) {
    emit(
      "ask",
      `'${rawToolName}' can create persistent/recurring effects and always requires approval.`
    );
    process.exit(0);
  }

  let engine;
  try {
    engine = require(path.join(ENGINE_DIR, "policy_engine.js"));
  } catch (e) {
    denyAndExit(engineLoadFailureReason(e));
  }

  const toolName = TOOL_NAME_MAP[rawToolName] || rawToolName;
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
