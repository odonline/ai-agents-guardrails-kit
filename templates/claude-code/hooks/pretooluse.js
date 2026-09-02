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

function main() {
  let engine;
  try {
    engine = require(path.join(ENGINE_DIR, "policy_engine.js"));
  } catch (e) {
    // The engine being absent is exactly what a half-removed install looks
    // like. Deny rather than die.
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

  const toolName = (payload && payload.tool_name) || "";
  const toolInput = (payload && payload.tool_input) || {};

  const decision = engine.evaluateFromDict(toolName, toolInput);
  emit(decision.action, decision.reason);
  process.exit(0);
}

try {
  main();
} catch (e) {
  denyAndExit(`Guardrail hook error, defaulting to deny: ${(e && e.message) || e}`);
}
