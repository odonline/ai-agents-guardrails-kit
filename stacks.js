/**
 * stacks.js — per-language profiles used to generate policy.yaml,
 * git hooks, and the CI workflow. The policy engine itself
 * (.agent-security/policy_engine.py) never changes — only the
 * "what counts as dangerous" and "what to run to prove completion"
 * data changes per stack.
 *
 * Adding a new language = adding one entry here. Nothing else in the
 * kit needs to change.
 */
const fs = require("fs");
const path = require("path");

/**
 * Glue for "…and then, in the same command, …" when writing a
 * `blocked_commands` pattern.
 *
 * USE THIS INSTEAD OF `\s+` BETWEEN A PROGRAM AND ITS SUBCOMMAND.
 *
 * Every rule shaped `\bgit\s+commit\b` assumed the program and its subcommand
 * are adjacent, and almost no CLI works that way. Global options go in between:
 *
 *   git -c user.email=x commit --no-verify     ← ordinary, not an evasion
 *   git -C /path reset --hard
 *   git --no-pager push
 *   docker --config=/tmp push image
 *   npm --registry=http://x publish
 *   php -d memory_limit=1G artisan migrate
 *   pip --quiet install --index-url http://x
 *
 * Found by a real self-test run (2026-09-07): `git -c k=v commit --no-verify`
 * sailed straight through the hook-bypass rule. Measured afterwards, eleven
 * rules across the core set and the stack profiles had the same hole. One of
 * them *appeared* to hold — `git --git-dir=.git branch -D main` denied — but
 * only because the path happened to end in `.git`, so `git branch -D` existed
 * as a substring. Coincidence, not protection.
 *
 * `[^;&|\n]*?` is deliberately a plain lazy character class, not a model of
 * option syntax: it is linear (no nested quantifiers, so no ReDoS in a matcher
 * that runs on every tool call), it needs no maintenance as CLIs add flags, and
 * excluding `;`, `&`, `|` and newlines keeps it from reaching across into a
 * separate command — so `git status; echo commit` is not a commit.
 *
 * The residual cost is over-matching inside one segment: a commit message that
 * literally contains "--no-verify" gets denied. Erring toward deny on a
 * bypass-shaped string is the correct direction, and it is cheap to rephrase.
 */
const THEN = "[^;&|\\n]*?";

function exists(dir, ...names) {
  return names.some((n) => fs.existsSync(path.join(dir, n)));
}

const STACKS = {
  node: {
    label: "Node.js / TypeScript",
    markers: ["package.json"],
    detect: (dir) => exists(dir, "package.json"),
    checks: [
      { name: "typecheck", command: "npm run typecheck --if-present" },
      { name: "tests", command: "npm test --if-present" },
      { name: "lint", command: "npm run lint --if-present" },
    ],
    changedExtensions: [".ts", ".tsx", ".js", ".jsx"],
    extraBlocked: [
      { pattern: `\\bnpm${THEN}\\bpublish\\b`, action: "ask", reason: "Publishing a package requires approval." },
      { pattern: `\\bnpx${THEN}\\b\\S+@\\S+`, action: "ask", reason: "Running an unpinned remote npx package requires approval." },
    ],
    ci: { setupAction: "actions/setup-node@v4", withBlock: 'node-version: 20', install: "npm ci" },
    gitlabCi: { image: "node:20", install: "npm ci" },
  },

  php: {
    label: "PHP (Composer)",
    markers: ["composer.json"],
    detect: (dir) => exists(dir, "composer.json"),
    checks: [
      { name: "tests", command: '[ -x vendor/bin/phpunit ] && vendor/bin/phpunit || echo "phpunit not installed, skipping"' },
      { name: "static-analysis", command: '[ -x vendor/bin/phpstan ] && vendor/bin/phpstan analyse || echo "phpstan not installed, skipping"' },
      { name: "lint", command: '[ -x vendor/bin/phpcs ] && vendor/bin/phpcs --standard=PSR12 . || echo "phpcs not installed, skipping"' },
    ],
    changedExtensions: [".php"],
    extraBlocked: [
      { pattern: `\\bphp${THEN}\\bartisan${THEN}\\bmigrate:(fresh|reset)\\b`, action: "deny", reason: "Destructive Laravel migration blocked." },
      { pattern: `\\bphp${THEN}\\bartisan${THEN}\\bmigrate\\b`, action: "ask", reason: "Running migrations requires approval." },
      { pattern: `\\bphp${THEN}\\bartisan${THEN}\\bdb:wipe\\b`, action: "deny", reason: "Destructive database wipe blocked." },
      { pattern: `\\bcomposer${THEN}\\b(remove|require)\\b`, action: "ask", reason: "Changing dependencies requires approval." },
    ],
    ci: { setupAction: "shivammathur/setup-php@v2", withBlock: "php-version: '8.3'", install: "composer install --no-interaction" },
    gitlabCi: { image: "composer:2", install: "composer install --no-interaction" },
  },

  "java-maven": {
    label: "Java (Maven)",
    markers: ["pom.xml"],
    detect: (dir) => exists(dir, "pom.xml"),
    checks: [
      { name: "compile", command: "mvn -q -B compile" },
      { name: "tests", command: "mvn -q -B test" },
    ],
    changedExtensions: [".java"],
    extraBlocked: [
      { pattern: "\\bmvn\\s+.*\\bdeploy\\b", action: "ask", reason: "Deploying an artifact requires approval." },
      { pattern: "\\bmvn\\s+.*-Dmaven\\.test\\.skip(=true)?\\b", action: "ask", reason: "Skipping tests requires approval." },
    ],
    ci: { setupAction: "actions/setup-java@v4", withBlock: "distribution: temurin\n          java-version: '21'", install: "mvn -q -B -DskipTests install" },
    gitlabCi: { image: "maven:3.9-eclipse-temurin-21", install: "mvn -q -B -DskipTests install" },
  },

  "java-gradle": {
    label: "Java/Kotlin (Gradle)",
    markers: ["build.gradle", "build.gradle.kts"],
    detect: (dir) => exists(dir, "build.gradle", "build.gradle.kts"),
    checks: [
      { name: "tests", command: "./gradlew test" },
      { name: "lint", command: "./gradlew check --continue" },
    ],
    changedExtensions: [".java", ".kt"],
    extraBlocked: [
      { pattern: "\\./gradlew\\s+.*\\bpublish\\b", action: "ask", reason: "Publishing an artifact requires approval." },
    ],
    ci: { setupAction: "actions/setup-java@v4", withBlock: "distribution: temurin\n          java-version: '21'", install: "chmod +x gradlew" },
    gitlabCi: { image: "eclipse-temurin:21-jdk", install: "chmod +x gradlew" },
  },

  python: {
    label: "Python",
    markers: ["requirements.txt", "pyproject.toml", "Pipfile"],
    detect: (dir) => exists(dir, "requirements.txt", "pyproject.toml", "Pipfile"),
    checks: [
      { name: "tests", command: "pytest -q" },
      { name: "lint", command: "ruff check ." },
    ],
    changedExtensions: [".py"],
    extraBlocked: [
      { pattern: `\\btwine${THEN}\\bupload\\b`, action: "ask", reason: "Publishing to PyPI requires approval." },
      { pattern: `\\bpip${THEN}\\binstall\\b.*--index-url\\b`, action: "ask", reason: "Installing from a non-default index requires approval." },
    ],
    ci: { setupAction: "actions/setup-python@v5", withBlock: "python-version: '3.12'", install: "pip install -r requirements.txt --break-system-packages || true" },
    gitlabCi: { image: "python:3.12-slim", install: "pip install -r requirements.txt --break-system-packages || true" },
  },
};

function detectStacks(dir) {
  return Object.keys(STACKS).filter((k) => STACKS[k].detect(dir));
}

module.exports = { STACKS, detectStacks, THEN };
