#!/usr/bin/env node
/**
 * test/install.test.js — regression tests for install.js's OWN logic:
 * agent/file scaffolding, stack wiring, git-host CI selection (GitHub vs
 * GitLab vs unknown), --ci override, --git-hooks toggling, and the
 * existing-file → *.new conflict path.
 *
 * This does NOT replace .agent-security/test_policy_engine.py — that
 * suite tests the policy engine that ships INTO installed projects. This
 * one tests the installer that ships the kit itself, so it has to run
 * without external dependencies and on any OS Node runs on (Windows
 * included) — no bash, no python required.
 *
 * Run after any change to install.js / generate.js / stacks.js:
 *   node test/install.test.js
 *   npm test
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const KIT_ROOT = path.join(__dirname, "..");
const INSTALL = path.join(KIT_ROOT, "install.js");

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function mkTmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `guardrails-test-${name}-`));
}

function runInstall(target, args) {
  return execFileSync("node", [INSTALL, "--target", target, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitInit(dir, remoteUrl) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (remoteUrl) execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: dir });
}

function exists(...parts) {
  return fs.existsSync(path.join(...parts));
}

// Marker file needed for each stack's auto-detection (mirrors stacks.js).
const STACK_MARKERS = {
  node: () => ({ "package.json": "{}" }),
  php: () => ({ "composer.json": "{}" }),
  "java-maven": () => ({ "pom.xml": "<project></project>" }),
  "java-gradle": () => ({ "build.gradle": "" }),
  python: () => ({ "pyproject.toml": "" }),
};

function writeFixtureFiles(dir, files) {
  Object.entries(files).forEach(([name, content]) => fs.writeFileSync(path.join(dir, name), content));
}

console.log("== install.js regression tests ==\n");

Object.keys(STACK_MARKERS).forEach((stack) => {
  test(`scaffolds core files for stack "${stack}"`, () => {
    const dir = mkTmp(stack);
    writeFixtureFiles(dir, STACK_MARKERS[stack]());
    runInstall(dir, ["--agents", "claude-code", "--stacks", stack, "--git-hooks", "false", "--yes"]);
    assert(exists(dir, ".agent-security/policy_engine.py"), "missing policy_engine.py");
    assert(exists(dir, ".agent-security/policy.yaml"), "missing policy.yaml");
    assert(exists(dir, ".claude/settings.json"), "missing .claude/settings.json");
    assert(exists(dir, "AGENTS.md") && exists(dir, "CLAUDE.md") && exists(dir, "GEMINI.md"), "missing contract files");
  });
});

test("github remote generates .github/workflows/security.yml, not .gitlab-ci.yml", () => {
  const dir = mkTmp("gh");
  writeFixtureFiles(dir, STACK_MARKERS.node());
  gitInit(dir, "https://github.com/someorg/somerepo.git");
  runInstall(dir, ["--agents", "claude-code", "--stacks", "node", "--git-hooks", "true", "--yes"]);
  assert(exists(dir, ".github/workflows/security.yml"), "expected a GitHub Actions workflow");
  assert(!exists(dir, ".gitlab-ci.yml"), "should NOT generate .gitlab-ci.yml for a github.com remote");
});

test("gitlab remote generates .gitlab-ci.yml, not .github/workflows", () => {
  const dir = mkTmp("gl");
  writeFixtureFiles(dir, STACK_MARKERS.node());
  gitInit(dir, "https://gitlab.com/someorg/somerepo.git");
  runInstall(dir, ["--agents", "claude-code", "--stacks", "node", "--git-hooks", "true", "--yes"]);
  assert(exists(dir, ".gitlab-ci.yml"), "expected .gitlab-ci.yml");
  assert(!exists(dir, ".github/workflows/security.yml"), "should NOT generate a GitHub Actions workflow for a gitlab.com remote");
});

test("self-hosted gitlab-like remote is still detected as gitlab", () => {
  const dir = mkTmp("glself");
  writeFixtureFiles(dir, STACK_MARKERS.node());
  gitInit(dir, "https://git.gitlab.mycompany.internal/someorg/somerepo.git");
  runInstall(dir, ["--agents", "claude-code", "--stacks", "node", "--git-hooks", "true", "--yes"]);
  assert(exists(dir, ".gitlab-ci.yml"), "expected .gitlab-ci.yml for a self-hosted gitlab-like host");
});

test("no git repo + --yes + no --ci: skips CI generation without failing", () => {
  const dir = mkTmp("nogit");
  writeFixtureFiles(dir, STACK_MARKERS.node());
  runInstall(dir, ["--agents", "claude-code", "--stacks", "node", "--git-hooks", "true", "--yes"]);
  assert(!exists(dir, ".github/workflows/security.yml"), "should not guess GitHub without evidence");
  assert(!exists(dir, ".gitlab-ci.yml"), "should not guess GitLab without evidence");
  assert(exists(dir, ".husky/pre-commit"), "git hooks should still be written even without a CI target");
});

test("--ci gitlab overrides a github.com remote", () => {
  const dir = mkTmp("override");
  writeFixtureFiles(dir, STACK_MARKERS.node());
  gitInit(dir, "https://github.com/someorg/somerepo.git");
  runInstall(dir, ["--agents", "claude-code", "--stacks", "node", "--git-hooks", "true", "--ci", "gitlab", "--yes"]);
  assert(exists(dir, ".gitlab-ci.yml"), "explicit --ci gitlab should win over the detected github remote");
  assert(!exists(dir, ".github/workflows/security.yml"), "explicit --ci gitlab should suppress the github workflow");
});

test("--git-hooks false installs neither hooks nor CI", () => {
  const dir = mkTmp("nohooks");
  writeFixtureFiles(dir, STACK_MARKERS.node());
  gitInit(dir, "https://github.com/someorg/somerepo.git");
  runInstall(dir, ["--agents", "claude-code", "--stacks", "node", "--git-hooks", "false", "--yes"]);
  assert(!exists(dir, ".husky/pre-commit"), "should not write git hooks");
  assert(!exists(dir, ".github/workflows/security.yml"), "should not write CI without git-hooks");
});

test("invalid --ci value exits non-zero with a clear error", () => {
  const dir = mkTmp("badci");
  writeFixtureFiles(dir, STACK_MARKERS.node());
  let threw = false;
  try {
    runInstall(dir, ["--agents", "claude-code", "--stacks", "node", "--git-hooks", "true", "--ci", "bitbucket", "--yes"]);
  } catch (e) {
    threw = true;
    assert(/valor inv.lido/i.test(e.stderr || e.message), "expected a clear error message about the invalid --ci value");
  }
  assert(threw, "expected install.js to exit non-zero on an invalid --ci value");
});

test("existing file is preserved, new content written as *.new", () => {
  const dir = mkTmp("conflict");
  writeFixtureFiles(dir, STACK_MARKERS.node());
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude/settings.json"), '{"custom":true}');
  runInstall(dir, ["--agents", "claude-code", "--stacks", "node", "--git-hooks", "false", "--yes"]);
  const original = fs.readFileSync(path.join(dir, ".claude/settings.json"), "utf8");
  assert(original === '{"custom":true}', "pre-existing file must not be overwritten");
  assert(exists(dir, ".claude/settings.json.new"), "expected a .new file with the generated content");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
