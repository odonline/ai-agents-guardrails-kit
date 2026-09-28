import { createRequire } from "node:module";
import path from "node:path";

export const Guardrails = async ({ directory }) => {
  const require = createRequire(import.meta.url);
  let engine;
  let engineError;
  try {
    engine = require(path.join(directory, ".agent-security", "policy_engine.js"));
  } catch (error) {
    engineError = error;
  }

  const enforce = (toolName, toolInput) => {
    if (!engine) {
      throw new Error(`[guardrails] Policy engine unavailable; blocking tool call: ${engineError.message}`);
    }
    const decision = engine.evaluate(toolName, toolInput, directory);
    if (decision.action !== "allow") {
      throw new Error(`[guardrails] ${decision.action}: ${decision.reason}`);
    }
  };

  return {
    "tool.execute.before": async (input, output) => {
      const args = output.args || {};
      switch (input.tool) {
        case "read":
          if (typeof args.filePath !== "string" || !args.filePath) {
            throw new Error("[guardrails] OpenCode read omitted filePath; blocking the call.");
          }
          enforce("Read", { file_path: args.filePath });
          return;
        case "grep":
          enforce("Grep", {
            search_scope: { path: args.path || ".", include: args.include },
          });
          return;
        case "glob":
          enforce("Glob", {
            search_scope: { path: args.path || ".", include: args.pattern },
          });
          return;
        case "bash":
          if (typeof args.command !== "string" || !args.command) {
            throw new Error("[guardrails] OpenCode bash omitted command; blocking the call.");
          }
          enforce("Bash", { command: args.command || "" });
          return;
        case "write":
          if (typeof args.filePath !== "string" || !args.filePath) {
            throw new Error("[guardrails] OpenCode write omitted filePath; blocking the call.");
          }
          enforce("Write", { filePath: args.filePath });
          return;
        case "edit":
          if (typeof args.filePath !== "string" || !args.filePath) {
            throw new Error("[guardrails] OpenCode edit omitted filePath; blocking the call.");
          }
          enforce("Edit", { filePath: args.filePath });
          return;
        case "apply_patch": {
          const paths = [...String(args.patchText || "").matchAll(
            /^\*\*\* (?:(?:Add|Update|Delete) File:|Move to:)\s*(.+?)\s*$/gm
          )]
            .map((match) => match[1]);
          if (paths.length === 0) {
            throw new Error("[guardrails] Could not identify patch paths; blocking the patch.");
          }
          for (const filePath of paths) enforce("Write", { filePath });
          return;
        }
        default:
          enforce(input.tool, args);
      }
    },
  };
};