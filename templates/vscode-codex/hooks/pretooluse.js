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

function main() {
  let engine;
  try {
    engine = require(path.join(ENGINE_DIR, "policy_engine.js"));
  } catch (e) {
    denyAndExit("Guardrail hook could not load the policy engine; defaulting to deny.");
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

  const decision = engine.evaluateFromDict(toolName, toolInput);
  emit(decision.action, decision.reason);
  process.exit(0);
}

try {
  main();
} catch (e) {
  denyAndExit(`Guardrail hook error, defaulting to deny: ${(e && e.message) || e}`);
}
