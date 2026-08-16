#!/usr/bin/env node
/**
 * install-guardrails — scaffolds the defense-in-depth guardrails kit into
 * a project, adapted to the agent(s)/IDE(s) you pick.
 *
 * Usage:
 *   node install.js                 # interactive
 *   node install.js --agents claude-code,antigravity --target . --yes
 *
 * No external dependencies on purpose, so it runs anywhere Node runs.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { STACKS, detectStacks } = require("./stacks");
const { buildPolicyYaml, buildPreCommit, buildPrePush, buildCiWorkflow } = require("./generate");

const KIT_ROOT = __dirname;
const TEMPLATES = path.join(KIT_ROOT, "templates");

const AGENTS = {
  "claude-code": {
    label: "Claude Code (VS Code / CLI)",
    files: [
      { src: "claude-code/settings.json", dest: ".claude/settings.json" },
      { src: "claude-code/hooks/pretooluse.py", dest: ".claude/hooks/pretooluse.py" },
    ],
  },
  "vscode-codex": {
    label: "VS Code with Codex (or Copilot-compatible agents)",
    files: [
      { src: "vscode-codex/hooks/security.json", dest: ".github/hooks/security.json" },
      { src: "vscode-codex/hooks/pretooluse.py", dest: ".github/hooks/pretooluse.py" },
    ],
  },
  antigravity: {
    label: "Antigravity",
    files: [
      { src: "antigravity/hooks.json", dest: ".agents/hooks.json" },
      { src: "antigravity/scripts/pretooluse.py", dest: ".agents/scripts/pretooluse.py" },
    ],
  },
};

// These are language-agnostic — they operate on shell/git/path semantics,
// not on the project's source language — so they're copied verbatim.
const COMMON_FILES = [
  { src: "common/policy_engine.py", dest: ".agent-security/policy_engine.py" },
  { src: "common/final_check.py", dest: ".agent-security/final_check.py" },
  { src: "common/test_policy_engine.py", dest: ".agent-security/test_policy_engine.py" },
  { src: "common/README.md", dest: ".agent-security/README.md" },
  { src: "common/AGENTS.md", dest: "AGENTS.md" },
  { src: "common/CLAUDE.md", dest: "CLAUDE.md" },
  { src: "common/GEMINI.md", dest: "GEMINI.md" },
];

// policy.yaml, .husky/pre-commit, .husky/pre-push, and the CI workflow are
// GENERATED from the detected/selected stack(s) — see generate.js — instead
// of being copied statically, since their content (which tests/lint to run,
// which extra commands are dangerous) is language-specific.

function parseArgs(argv) {
  const args = { agents: null, target: process.cwd(), yes: false, gitHooks: null, stacks: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agents") args.agents = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--stacks") args.stacks = argv[++i].split(",").map((s) => s.trim()).filter((s) => s !== "none");
    else if (a === "--target") args.target = path.resolve(argv[++i]);
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--git-hooks") args.gitHooks = argv[++i] !== "false";
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function getInteractiveInput() {
  // When this script runs via `curl ... | bash`, stdin is the pipe that
  // fed the *script itself* — by the time node starts, that pipe is
  // already at EOF, so readline.question() never gets an answer and the
  // process exits silently without installing anything. Reopen the
  // controlling terminal directly so prompts work regardless of how the
  // installer was invoked.
  if (process.stdin.isTTY) return process.stdin;
  const devicePath = process.platform === "win32" ? "\\\\.\\CONIN$" : "/dev/tty";
  try {
    const fd = fs.openSync(devicePath, "r");
    return fs.createReadStream(null, { fd });
  } catch (e) {
    return null;
  }
}

async function selectAgents(rl) {
  const keys = Object.keys(AGENTS);
  console.log("\n¿Para qué agente(s)/IDE querés instalar los guardrails?\n");
  keys.forEach((k, i) => console.log(`  ${i + 1}) ${AGENTS[k].label}`));
  console.log(`  ${keys.length + 1}) Todos`);
  const answer = await ask(rl, `\nElegí uno o varios separados por coma (ej: 1,3) [${keys.length + 1}]: `);
  const trimmed = answer.trim() || String(keys.length + 1);
  if (trimmed === String(keys.length + 1)) return keys;
  const idxs = trimmed.split(",").map((s) => parseInt(s.trim(), 10) - 1);
  return idxs.filter((i) => i >= 0 && i < keys.length).map((i) => keys[i]);
}

function copyFile(srcRel, destAbs, { mode } = {}) {
  const src = path.join(TEMPLATES, srcRel);
  if (fs.existsSync(destAbs)) {
    const newPath = destAbs + ".new";
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.copyFileSync(src, newPath);
    if (mode) fs.chmodSync(newPath, mode);
    console.log(`  ⚠ ${rel(destAbs)} ya existe → escrito como ${rel(newPath)} (revisar/mergear a mano)`);
    return "skipped";
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(src, destAbs);
  if (mode) fs.chmodSync(destAbs, mode);
  console.log(`  ✓ ${rel(destAbs)}`);
  return "written";
}

let TARGET_ROOT = process.cwd();
function rel(p) {
  return path.relative(TARGET_ROOT, p) || ".";
}

function writeText(destAbs, content, { mode } = {}) {
  if (fs.existsSync(destAbs)) {
    const newPath = destAbs + ".new";
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.writeFileSync(newPath, content);
    if (mode) fs.chmodSync(newPath, mode);
    console.log(`  ⚠ ${rel(destAbs)} ya existe → escrito como ${rel(newPath)} (revisar/mergear a mano)`);
    return "skipped";
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.writeFileSync(destAbs, content);
  if (mode) fs.chmodSync(destAbs, mode);
  console.log(`  ✓ ${rel(destAbs)}`);
  return "written";
}

async function selectStacks(rl, target) {
  const detected = detectStacks(target);
  const keys = Object.keys(STACKS);
  console.log("\nDetección de stack:");
  if (detected.length) {
    detected.forEach((k) => console.log(`  ✓ ${STACKS[k].label} (detectado por ${STACKS[k].markers.join("/")})`));
  } else {
    console.log("  (no se detectó ningún stack conocido en el directorio raíz)");
  }
  keys.forEach((k, i) => {
    if (!detected.includes(k)) console.log(`  ${i + 1}) ${STACKS[k].label} — no detectado`);
  });
  const suggestion = detected.length ? detected.map((k) => keys.indexOf(k) + 1).join(",") : "ninguno";
  const answer = await ask(
    rl,
    `\n¿Confirmás estos stacks? Enter para aceptar los detectados, o listá números separados por coma (0 = ninguno) [${suggestion}]: `
  );
  const trimmed = answer.trim();
  if (trimmed === "") return detected;
  if (trimmed === "0") return [];
  const idxs = trimmed.split(",").map((s) => parseInt(s.trim(), 10) - 1);
  return idxs.filter((i) => i >= 0 && i < keys.length).map((i) => keys[i]);
}

function ensureGitignore(target) {
  const gi = path.join(target, ".gitignore");
  const lines = [".agent-security/audit.log", ".agent-security/completion_reports.log", "*.new"];
  let existing = "";
  if (fs.existsSync(gi)) existing = fs.readFileSync(gi, "utf8");
  const missing = lines.filter((l) => !existing.includes(l));
  if (missing.length) {
    fs.appendFileSync(gi, (existing.endsWith("\n") || existing === "" ? "" : "\n") + missing.join("\n") + "\n");
    console.log(`  ✓ ${rel(gi)} actualizado (${missing.length} entradas)`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`
install-guardrails

  --agents claude-code,vscode-codex,antigravity   Salta el prompt de agentes
  --stacks node,php,java-maven,java-gradle,python  Salta la detección de stack ("none" = ninguno)
  --target <dir>                                  Directorio del proyecto (default: cwd)
  --git-hooks / --git-hooks false                  Instalar hooks de Husky + workflow de CI
  --yes                                            No preguntar confirmaciones

Stacks soportados: ${Object.keys(STACKS).join(", ")}
`);
    return;
  }

  TARGET_ROOT = args.target;
  fs.mkdirSync(TARGET_ROOT, { recursive: true });

  let stacks = args.stacks;
  let selected = args.agents;
  let installGitHooks = args.gitHooks;

  const needsPrompt = stacks === null || selected === null || installGitHooks === null;
  let rl = null;
  if (needsPrompt) {
    const input = getInteractiveInput();
    if (!input) {
      console.error(
        "\nNo hay una terminal interactiva disponible para preguntar (esto pasa " +
          "seguido con `curl | bash` en algunos entornos). Pasá los valores explícitamente:\n\n" +
          "  ... | bash -s -- --stacks node --agents claude-code --git-hooks true --yes\n\n" +
          `Stacks válidos: ${Object.keys(STACKS).join(", ")} (o "none")\n` +
          `Agentes válidos: ${Object.keys(AGENTS).join(", ")}\n`
      );
      process.exit(1);
    }
    rl = readline.createInterface({ input, output: process.stdout });
  }

  if (!stacks) stacks = await selectStacks(rl, TARGET_ROOT);
  if (!selected) selected = await selectAgents(rl);
  if (installGitHooks === null) {
    const answer = await ask(rl, "\n¿Instalar también git hooks (Husky) + workflow de CI de referencia? [S/n]: ");
    installGitHooks = !/^n/i.test(answer.trim());
  }
  if (rl) rl.close();

  const invalidStacks = (stacks || []).filter((s) => !STACKS[s]);
  if (invalidStacks.length) {
    console.error(`Stacks desconocidos: ${invalidStacks.join(", ")}. Válidos: ${Object.keys(STACKS).join(", ")}`);
    process.exit(1);
  }
  const invalid = (selected || []).filter((s) => !AGENTS[s]);
  if (invalid.length) {
    console.error(`Agentes desconocidos: ${invalid.join(", ")}. Válidos: ${Object.keys(AGENTS).join(", ")}`);
    process.exit(1);
  }
  if (!selected || selected.length === 0) {
    console.error("No se seleccionó ningún agente. Nada para instalar.");
    process.exit(1);
  }

  console.log(`\nInstalando en: ${TARGET_ROOT}`);
  console.log(`Stack(s): ${stacks.length ? stacks.map((s) => STACKS[s].label).join(", ") : "ninguno (genérico)"}\n`);

  console.log("Motor de políticas compartido (.agent-security/, AGENTS.md, CLAUDE.md, GEMINI.md):");
  COMMON_FILES.forEach((f) => copyFile(f.src, path.join(TARGET_ROOT, f.dest)));
  writeText(path.join(TARGET_ROOT, ".agent-security/policy.yaml"), buildPolicyYaml(stacks));

  for (const key of selected) {
    console.log(`\n${AGENTS[key].label}:`);
    AGENTS[key].files.forEach((f) => copyFile(f.src, path.join(TARGET_ROOT, f.dest)));
  }

  if (installGitHooks) {
    console.log("\nGit hooks + CI (generados según el/los stack(s)):");
    writeText(path.join(TARGET_ROOT, ".husky/pre-commit"), buildPreCommit(stacks), { mode: 0o755 });
    writeText(path.join(TARGET_ROOT, ".husky/pre-push"), buildPrePush(stacks), { mode: 0o755 });
    writeText(path.join(TARGET_ROOT, ".github/workflows/security.yml"), buildCiWorkflow(stacks));
  }

  console.log("\nProtecciones extra:");
  ensureGitignore(TARGET_ROOT);

  console.log(`
Listo. Próximos pasos:
  1. pip install pyyaml pytest --break-system-packages
  2. pytest .agent-security/test_policy_engine.py
  3. Revisar cualquier archivo *.new (ya existía uno con ese nombre) y mergearlo a mano.
  4. Si instalaste git hooks: 'npx husky init' (o mover .husky/pre-commit y pre-push a tu setup de husky) y 'chmod +x .husky/*'.
  5. Configurar branch protection en GitHub apuntando a '.github/workflows/security.yml'.
  6. Editar .agent-security/policy.yaml a gusto — es la única fuente de verdad para las reglas.
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
