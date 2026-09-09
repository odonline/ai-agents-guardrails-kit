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
 * Two things the report is careful about, because both were misleading in the
 * field:
 *
 *   - **"ok" means checks ran and passed.** It used to also mean "nothing ran":
 *     `--post-tool-use` executes no checks, and a project with no detected
 *     stack has no checks to execute, and both produced
 *     `{"status":"ok","checks":{}}`. Anyone reading the log later saw a pass.
 *     Those two now report `status: "skipped"` with a reason that says which
 *     case it was.
 *
 *   - **The gate refuses to be killed silently.** Checks used to get 600 s each
 *     while the harness declared a 60 s hook timeout, so a slow suite meant the
 *     hook was killed with no report written at all — the gate failing *open*,
 *     which is the one thing it must never do. There is now a total budget
 *     (TOTAL_BUDGET_MS, overridable with GUARDRAILS_CHECK_BUDGET_MS) sized to
 *     fit under the shipped hook timeout. Running out of it is a `blocked`
 *     report naming what did not get to run, not a silent death.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadPolicy, PolicyError } = require("./policy_loader.js");

const HERE = __dirname;
const PROJECT_ROOT = path.resolve(HERE, "..");
const REPORT_LOG = path.join(HERE, "completion_reports.log");
/**
 * How long the whole gate may take, and therefore how long any one check may.
 *
 * This has to fit *under* the Stop hook timeout the harness configs declare
 * (300 s as shipped), or the harness kills the hook before a report is written
 * and the gate fails open. 280 s leaves room for node startup and the write.
 *
 * A project whose suite genuinely needs longer raises both: this budget via
 * GUARDRAILS_CHECK_BUDGET_MS, and the `Stop` hook's `timeout` in its harness
 * config. Raising only one of them recreates the original bug, so the blocked
 * report names both.
 */
const TOTAL_BUDGET_MS = (() => {
  const raw = Number(process.env.GUARDRAILS_CHECK_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 280 * 1000;
})();

/** No single check may outlast the whole gate. */
const CHECK_TIMEOUT_MS = TOTAL_BUDGET_MS;

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
function runCheck(name, command, remainingMs) {
  // Clamp to what is left of the whole gate's budget. Without this, check #2
  // can still be running when the harness's hook timeout fires, and a killed
  // hook writes no report at all.
  const budget = Math.min(CHECK_TIMEOUT_MS, Math.max(0, remainingMs));
  if (budget <= 0) {
    return {
      executed: false,
      exit_code: null,
      command,
      error: "not run: the gate's time budget was exhausted by earlier checks",
    };
  }
  try {
    const proc = spawnSync(command, {
      shell: true,
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: budget,
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

  // "nothing ran" is not "everything passed". Reporting both as `ok` meant a
  // reader of completion_reports.log could not tell a green gate from a gate
  // that never had anything to do — both looked like {"status":"ok","checks":{}}.
  if (light) {
    const report = {
      ts: timestamp(),
      status: "skipped",
      checks: {},
      reason:
        "--post-tool-use runs no checks by design; it exists so a PostToolUse hook " +
        "has something to call. The real gate is this script with no flag, at Stop.",
    };
    writeReport(report);
    console.log(JSON.stringify(report));
    return 0;
  }

  if (!required.length) {
    const report = {
      ts: timestamp(),
      status: "skipped",
      checks: {},
      reason:
        "No required_checks are configured, so nothing was verified. Add your " +
        "test/lint commands to required_checks in .agent-security/policy.yaml — " +
        "until then this gate approves everything.",
    };
    writeReport(report);
    console.log(JSON.stringify(report));
    return 0;
  }

  const startedAt = Date.now();
  const checks = {};
  for (const check of required) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    checks[check.name] = runCheck(check.name, check.command, remaining);
  }

  const names = Object.keys(checks);
  const allOk = names.every((n) => checks[n].executed && checks[n].exit_code === 0);

  const report = { ts: timestamp(), status: allOk ? "ok" : "blocked", checks };
  if (!allOk) {
    const failed = names.filter((n) => !(checks[n].executed && checks[n].exit_code === 0));
    const starved = failed.filter((n) => /time budget was exhausted/.test(checks[n].error || ""));
    report.reason =
      `Completion denied: checks failed or were not run: ${failed.join(", ")}.` +
      (starved.length
        ? ` ${starved.join(", ")} ran out of time: the gate's budget is ` +
          `${Math.round(TOTAL_BUDGET_MS / 1000)}s. If this suite legitimately needs longer, ` +
          "raise BOTH the Stop hook's timeout in your harness config AND " +
          "GUARDRAILS_CHECK_BUDGET_MS — raising only one puts you back to the hook " +
          "being killed with no report."
        : "");
  }

  writeReport(report);
  console.log(JSON.stringify(report));
  return allOk ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, runCheck, timestamp };
