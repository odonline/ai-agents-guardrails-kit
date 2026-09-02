#!/usr/bin/env node
/**
 * final_check.js — evidence-based completion gate.
 *
 * Runs at Stop / PostToolUse. It re-runs the required checks itself instead of
 * trusting the agent's claim that "tests pass", and writes a machine-readable
 * report. Any harness (Claude Code, VS Code hooks, Antigravity) can use it as
 * its Stop hook.
 *
 *   node final_check.js                  # full completion gate (Stop)
 *   node final_check.js --post-tool-use  # lightweight check after one edit
 *
 * Exit 0 when every required check passed, 1 otherwise. A gate that cannot read
 * its own policy exits 1 — it has no basis on which to approve anything.
 *
 * Known and deliberate, carried over from the Python version rather than fixed
 * here (see Tasks/policy-engine-node-port/00-overview.md, "Deuda preexistente"):
 *   - `--post-tool-use` runs NO checks. It appends an "ok" report and returns.
 *     That is what it has always done; it is log noise, not a check.
 *   - Each check gets 600 s, but the harnesses declare a 60 s hook timeout. A
 *     slow suite gets the hook killed before the gate finishes.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadPolicy, PolicyError } = require("./policy_loader.js");

const HERE = __dirname;
const PROJECT_ROOT = path.resolve(HERE, "..");
const REPORT_LOG = path.join(HERE, "completion_reports.log");
const CHECK_TIMEOUT_MS = 600 * 1000;

/** Python's time.strftime("%Y-%m-%dT%H:%M:%S%z"), so log lines stay uniform. */
function timestamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin < 0 ? "-" : "+";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.trunc(Math.abs(offsetMin) / 60))}${pad(Math.abs(offsetMin) % 60)}`
  );
}

/**
 * Run one check through a shell, from the project root.
 *
 * `required_checks` commands are shell strings (that is how stacks.js writes
 * them), so a shell is required to run them at all. Note several stack profiles
 * use POSIX syntax — on Windows those will not run under cmd.exe. That is
 * pre-existing behavior, not something this port introduced.
 */
function runCheck(name, command) {
  try {
    const proc = spawnSync(command, {
      shell: true,
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: CHECK_TIMEOUT_MS,
    });
    if (proc.error) {
      return { executed: false, exit_code: null, command, error: String(proc.error.message) };
    }
    // A killed process (timeout) has a signal and a null status — that is not a
    // pass, so report it as not executed rather than as exit code 0.
    if (proc.status === null) {
      return {
        executed: false,
        exit_code: null,
        command,
        error: proc.signal ? `killed by ${proc.signal}` : "did not produce an exit code",
      };
    }
    return { executed: true, exit_code: proc.status, command };
  } catch (e) {
    return { executed: false, exit_code: null, command, error: String((e && e.message) || e) };
  }
}

function writeReport(report) {
  try {
    fs.mkdirSync(HERE, { recursive: true });
    fs.appendFileSync(REPORT_LOG, JSON.stringify(report) + "\n", "utf8");
  } catch (e) {
    /* the report on stdout is the primary output; a log failure is not a pass */
  }
}

function main(argv) {
  const light = argv.includes("--post-tool-use");

  let required = [];
  if (!light) {
    try {
      required = loadPolicy(path.join(HERE, "policy.yaml")).required_checks || [];
    } catch (e) {
      // A gate that cannot read its policy must not approve anything, and must
      // not die with a traceback either — the harness needs a decision.
      const why = e instanceof PolicyError ? e.message : String((e && e.message) || e);
      const report = {
        ts: timestamp(),
        status: "blocked",
        checks: {},
        reason: `Completion denied: could not read the policy. ${why}`,
      };
      writeReport(report);
      console.log(JSON.stringify(report));
      return 1;
    }
  }

  const checks = {};
  for (const check of required) {
    checks[check.name] = runCheck(check.name, check.command);
  }

  const names = Object.keys(checks);
  const allOk = names.length
    ? names.every((n) => checks[n].executed && checks[n].exit_code === 0)
    : true;

  const report = { ts: timestamp(), status: allOk ? "ok" : "blocked", checks };
  if (!allOk && names.length) {
    const failed = names.filter((n) => !(checks[n].executed && checks[n].exit_code === 0));
    report.reason =
      `Completion denied: checks failed or were not run: ${failed.join(", ")}.`;
  }

  writeReport(report);
  console.log(JSON.stringify(report));
  return allOk ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, runCheck, timestamp };
