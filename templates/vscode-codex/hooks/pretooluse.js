#!/usr/bin/env node
/**
 * VS Code agent-hooks adapter (Codex, Copilot-compatible agents).
 *
 * Tool and property names differ from Claude Code, so this adapter normalizes
 * them before calling the shared policy engine. Translation only — no policy
 * decisions here (G3).
 *
 * Input (approximate — verify against your installed version, see
 * https://code.visualstudio.com/docs/agents/reference/hooks-reference):
 *   {"toolName": "runTerminalCommand", "toolInput": {"command": "..."}}
 *   {"toolName": "create_file", "toolInput": {"path": "...", "content": "..."}}
 *
 * Output (VS Code accepts allow/deny/ask; most restrictive wins when several
 * hooks fire):
 *   {"hookSpecificOutput": {"hookEventName": "PreToolUse",
 *                           "permissionDecision": "allow"|"deny"|"ask",
 *                           "permissionDecisionReason": "..."}}
 *
 * Note this harness family names fields in camelCase, which is why the engine
 * checks `filePath` alongside `file_path` everywhere — including in its
 * self-protection check, where the Python engine did not. See
 * Tasks/policy-engine-node-port/02-policy-engine-port.md.
 *
 * Every failure path prints a well-formed deny and exits 0.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ENGINE_DIR = path.resolve(__dirname, "..", "..", ".agent-security");

// Map VS Code / Codex tool names onto the canonical names the engine knows.
const TOOL_NAME_MAP = {
  runTerminalCommand: "Bash",
  create_file: "Write",
  replace_string_in_file: "Edit",
  insert_edit_into_file: "Edit",
};

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

  const rawToolName = (payload && (payload.toolName || payload.tool_name)) || "";
  const toolName = TOOL_NAME_MAP[rawToolName] || rawToolName;
  const toolInput = (payload && (payload.toolInput || payload.tool_input)) || {};

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
