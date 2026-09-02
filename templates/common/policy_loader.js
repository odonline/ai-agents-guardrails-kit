/**
 * policy_loader.js — reads and validates .agent-security/policy.yaml.
 *
 * Single responsibility: hand back a policy the engine can trust, or refuse.
 * It makes no decisions about tool calls; it only decides whether the policy
 * file is understood well enough to be used at all.
 *
 * FAIL CLOSED. Every failure path here throws PolicyError. Callers
 * (policy_engine.js, final_check.js) MUST translate a throw into `deny` —
 * never into `allow`, and never into "use the parts that parsed". A guardrail
 * that keeps running on half a policy is worse than one that stops, because it
 * still looks like it is working.
 *
 * Two rules earned by looking at what goes wrong in practice:
 *
 *   1. Validate every regex at LOAD time, not at match time. A pattern that
 *      does not compile is a hole in exactly one rule, and a hole discovered
 *      at match time is discovered by the command that walks through it.
 *   2. Never silently skip a malformed entry. Skipping is indistinguishable
 *      from the rule having been deleted.
 *
 * Both are deliberate divergences from the Python engine this replaces, which
 * `continue`s past broken patterns under a comment claiming it does not. See
 * Tasks/policy-engine-node-port/01-vendor-js-yaml-and-loader.md.
 *
 * YAML is parsed by the vendored js-yaml (see vendor/VENDOR.md) rather than a
 * hand-rolled reader. A hand-rolled reader that only understands block-style
 * lists returns an empty `protected_paths` for a flow-style file — valid YAML,
 * zero protection, no error. That is not a hypothetical; it is what the bash
 * port of this engine does today.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("./vendor/js-yaml.js");

const POLICY_FILENAME = "policy.yaml";

// The only actions the engine knows how to act on. Anything else in a policy
// file is a typo that would otherwise degrade to "not deny".
const VALID_ACTIONS = ["allow", "ask", "deny"];

// Parity with the Python engine's rule.get(...) defaults — do not change these
// without a spec decision; they are the behavior installed projects rely on.
const DEFAULT_ACTION = "deny";
const DEFAULT_REASON = "Blocked by policy.";

class PolicyError extends Error {
  constructor(message, { policyPath, cause } = {}) {
    super(message);
    this.name = "PolicyError";
    this.policyPath = policyPath;
    if (cause) this.cause = cause;
  }
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Where the policy lives, relative to this module — mirrors the Python default. */
function defaultPolicyPath() {
  return path.join(__dirname, POLICY_FILENAME);
}

function requireStringArray(value, keyName, policyPath) {
  if (!Array.isArray(value)) {
    throw new PolicyError(
      `'${keyName}' must be a list, got ${Array.isArray(value) ? "array" : typeof value}.`,
      { policyPath }
    );
  }
  return value.map((entry, i) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new PolicyError(
        `'${keyName}[${i}]' must be a non-empty string.`,
        { policyPath }
      );
    }
    return entry;
  });
}

function normalizeBlockedCommands(value, policyPath) {
  if (!Array.isArray(value)) {
    throw new PolicyError(`'blocked_commands' must be a list, got ${typeof value}.`, {
      policyPath,
    });
  }

  const rules = [];
  const compiled = [];

  value.forEach((entry, i) => {
    const at = `blocked_commands[${i}]`;

    if (!isPlainObject(entry)) {
      throw new PolicyError(
        `'${at}' must be a mapping with a 'pattern' key.`,
        { policyPath }
      );
    }
    if (typeof entry.pattern !== "string" || entry.pattern.trim() === "") {
      throw new PolicyError(
        `'${at}' has no usable 'pattern'. A rule without a pattern blocks ` +
          `nothing — remove the entry or give it a pattern.`,
        { policyPath }
      );
    }

    const action = entry.action === undefined || entry.action === null
      ? DEFAULT_ACTION
      : entry.action;
    if (!VALID_ACTIONS.includes(action)) {
      throw new PolicyError(
        `'${at}.action' is '${action}'; must be one of ${VALID_ACTIONS.join(", ")}.`,
        { policyPath }
      );
    }

    const reason = entry.reason === undefined || entry.reason === null
      ? DEFAULT_REASON
      : String(entry.reason);

    // Compile now. The engine matches case-insensitively (parity with the
    // Python engine's re.IGNORECASE), so compile with the same flag the engine
    // will use — a pattern can be valid without a flag and invalid with it.
    let re;
    try {
      re = new RegExp(entry.pattern, "i");
    } catch (e) {
      throw new PolicyError(
        `'${at}.pattern' is not a valid regular expression: ${e.message}. ` +
          `Leaving it unvalidated would silently disable this rule.`,
        { policyPath, cause: e }
      );
    }

    rules.push({ pattern: entry.pattern, action, reason });
    compiled.push(re);
  });

  return { rules, compiled };
}

function normalizeRequiredChecks(value, policyPath) {
  if (!Array.isArray(value)) {
    throw new PolicyError(`'required_checks' must be a list, got ${typeof value}.`, {
      policyPath,
    });
  }
  return value.map((entry, i) => {
    const at = `required_checks[${i}]`;
    if (!isPlainObject(entry)) {
      throw new PolicyError(`'${at}' must be a mapping with 'name' and 'command'.`, {
        policyPath,
      });
    }
    for (const key of ["name", "command"]) {
      if (typeof entry[key] !== "string" || entry[key].trim() === "") {
        throw new PolicyError(`'${at}.${key}' must be a non-empty string.`, {
          policyPath,
        });
      }
    }
    return { name: entry.name, command: entry.command };
  });
}

/**
 * Read and validate the policy file.
 *
 * @param {string} [policyPath] Defaults to policy.yaml beside this module.
 * @returns {object} The parsed policy with unknown keys preserved verbatim,
 *   plus guaranteed-shaped `protected_paths`, `blocked_commands`,
 *   `required_checks`, and a non-enumerable `_compiled` array of RegExp
 *   aligned by index with `blocked_commands`.
 * @throws {PolicyError} On anything it cannot fully understand.
 */
function loadPolicy(policyPath) {
  const resolved = policyPath ? String(policyPath) : defaultPolicyPath();

  let text;
  try {
    text = fs.readFileSync(resolved, "utf8");
  } catch (e) {
    throw new PolicyError(
      e.code === "ENOENT"
        ? `${POLICY_FILENAME} not found at ${resolved}.`
        : `Could not read ${resolved}: ${e.message}`,
      { policyPath: resolved, cause: e }
    );
  }

  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (e) {
    // js-yaml throws YAMLException with line/column context — keep it.
    throw new PolicyError(
      `${resolved} is not valid YAML: ${e.message}`,
      { policyPath: resolved, cause: e }
    );
  }

  // An empty file parses to undefined/null. Python treated that as {} and
  // carried on with empty lists; keep that, it is a legitimate "no rules yet".
  if (parsed === undefined || parsed === null) parsed = {};

  if (!isPlainObject(parsed)) {
    throw new PolicyError(
      `${resolved} must contain a mapping at the top level, got ` +
        `${Array.isArray(parsed) ? "a list" : typeof parsed}.`,
      { policyPath: resolved }
    );
  }

  // Unknown keys are preserved on purpose. The generated header invites hand
  // editing, and today's policy.yaml carries keys nothing reads yet
  // (sensitive_tools, approval_required, completion_rules). Rejecting them
  // would break valid installs.
  const policy = { ...parsed };

  // An absent key defaults to empty, matching Python's setdefault(). Note this
  // means a policy.yaml with no protected_paths protects nothing and loads
  // clean — inherited behavior, recorded as debt rather than changed here,
  // because tightening it is a behavior change and not part of a port.
  policy.protected_paths =
    parsed.protected_paths === undefined || parsed.protected_paths === null
      ? []
      : requireStringArray(parsed.protected_paths, "protected_paths", resolved);

  const blocked =
    parsed.blocked_commands === undefined || parsed.blocked_commands === null
      ? { rules: [], compiled: [] }
      : normalizeBlockedCommands(parsed.blocked_commands, resolved);
  policy.blocked_commands = blocked.rules;

  policy.required_checks =
    parsed.required_checks === undefined || parsed.required_checks === null
      ? []
      : normalizeRequiredChecks(parsed.required_checks, resolved);

  // Non-enumerable so JSON.stringify(policy) and key iteration stay clean —
  // RegExp objects would serialize to {} and confuse anything logging a policy.
  Object.defineProperty(policy, "_compiled", {
    value: blocked.compiled,
    enumerable: false,
  });

  return policy;
}

module.exports = {
  loadPolicy,
  PolicyError,
  POLICY_FILENAME,
  VALID_ACTIONS,
  DEFAULT_ACTION,
  DEFAULT_REASON,
  defaultPolicyPath,
};
