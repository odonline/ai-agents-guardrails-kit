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
      { pattern: "\\bnpm\\s+publish\\b", action: "ask", reason: "Publishing a package requires approval." },
      { pattern: "\\bnpx\\s+\\S+@\\S+", action: "ask", reason: "Running an unpinned remote npx package requires approval." },
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
      { pattern: "\\bphp\\s+artisan\\s+migrate:(fresh|reset)\\b", action: "deny", reason: "Destructive Laravel migration blocked." },
      { pattern: "\\bphp\\s+artisan\\s+migrate\\b", action: "ask", reason: "Running migrations requires approval." },
      { pattern: "\\bphp\\s+artisan\\s+db:wipe\\b", action: "deny", reason: "Destructive database wipe blocked." },
      { pattern: "\\bcomposer\\s+(remove|require)\\b", action: "ask", reason: "Changing dependencies requires approval." },
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
      { pattern: "\\btwine\\s+upload\\b", action: "ask", reason: "Publishing to PyPI requires approval." },
      { pattern: "\\bpip\\s+install\\s+.*--index-url\\b", action: "ask", reason: "Installing from a non-default index requires approval." },
    ],
    ci: { setupAction: "actions/setup-python@v5", withBlock: "python-version: '3.12'", install: "pip install -r requirements.txt --break-system-packages || true" },
    gitlabCi: { image: "python:3.12-slim", install: "pip install -r requirements.txt --break-system-packages || true" },
  },
};

function detectStacks(dir) {
  return Object.keys(STACKS).filter((k) => STACKS[k].detect(dir));
}

module.exports = { STACKS, detectStacks };
