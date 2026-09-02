#!/usr/bin/env node
/**
 * uninstall.js — removes the guardrails kit from this project.
 *
 *   node .agent-security/uninstall.js            # show the plan, then confirm
 *   node .agent-security/uninstall.js --dry-run  # show the plan and stop
 *   node .agent-security/uninstall.js --yes      # skip the confirmation
 *
 * This ships INTO your project on purpose. The recommended install path
 * (bootstrap.sh) clones the kit to a temp dir and deletes it, so a kit-side
 * uninstaller would be unreachable exactly for the people most likely to want
 * it. This one works offline, with no network and no dependencies, and deletes
 * itself when it is done.
 *
 * The rule it follows, and the only one that matters:
 *
 *     It removes what the installer put there. It never touches what you
 *     edited.
 *
 * Concretely, a file is deleted only if the install manifest recorded it AND its
 * content still hashes to what the installer wrote. Anything you changed is kept
 * and reported. That means an uninstall can end deliberately incomplete — which
 * is fine, as long as it says so, and the summary always states whether the
 * guardrails are still active.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync } = require("child_process");

// Manifest reading and the hash comparison live in one shared module so this
// script and toggle.js can never disagree about what counts as "ours".
const K = require("./kit_manifest.js");
const { abs, sha256Normalized, DISABLED_SUFFIX } = K;

const HERE = K.AGENT_SECURITY_DIR;
const PROJECT_ROOT = K.PROJECT_ROOT;
const MANIFEST_PATH = K.MANIFEST_PATH;

/**
 * Classify every recorded file. This is the whole safety argument: `delete` only
 * ever contains files we wrote whose content is still byte-for-byte (modulo line
 * endings) what we wrote.
 */
function buildPlan(manifest) {
  const plan = { delete: [], keepModified: [], keepPreexisting: [], missing: [], newFiles: [] };

  for (const entry of manifest.files) {
    const state = K.classifyFile(entry);
    switch (state.state) {
      case "preexisting":
        // Already in the project when we arrived; the installer never owned it.
        if (state.exists) plan.keepPreexisting.push(entry.path);
        break;
      case "ours":
        plan.delete.push(entry.path);
        break;
      case "modified":
      case "unreadable":
        plan.keepModified.push({ path: entry.path, why: state.why });
        break;
      case "missing": {
        // A file parked by `toggle.js --disable` is recorded in the manifest
        // under its ORIGINAL name, so without this it would classify as "ya no
        // estaba" and survive as the one piece of leftover junk — exactly what
        // this whole feature exists to prevent.
        const parked = entry.path + DISABLED_SUFFIX;
        if (fs.existsSync(abs(parked))) {
          let actual = null;
          try {
            actual = sha256Normalized(fs.readFileSync(abs(parked)));
          } catch (e) {
            /* fall through to keepModified below */
          }
          if (actual === entry.sha256) plan.delete.push(parked);
          else plan.keepModified.push({ path: parked, why: "desactivado y editado" });
        } else {
          plan.missing.push(entry.path);
        }
        break;
      }
    }
  }

  // .new files were written by us; if they were never merged they are our junk.
  for (const p of manifest.newFiles || []) {
    if (fs.existsSync(abs(p))) plan.newFiles.push(p);
  }
  return plan;
}

/**
 * Which hook configs would still reference the engine after the deletions.
 *
 * Not asserted — read off disk. The summary's one important claim ("are the
 * guardrails still on?") has to be a measurement, not a prediction.
 */
function stillWired(plan) {
  return K.wiredHookConfigs([...plan.delete, ...plan.newFiles]);
}

function planGitSteps(manifest) {
  const steps = [];
  if (!K.isGitRepo()) {
    steps.push({ kind: "note", text: "No es un repo git — no hay core.hooksPath que tocar." });
    return steps;
  }
  const current = K.gitConfigGet("core.hooksPath");
  const set = (manifest.git && manifest.git.hooksPathSet) || null;
  const before = manifest.git ? manifest.git.hooksPathBefore : null;

  if (!set) {
    steps.push({ kind: "note", text: "El instalador no configuró core.hooksPath." });
  } else if (current !== set) {
    steps.push({
      kind: "note",
      text:
        `core.hooksPath vale '${current === null ? "(sin valor)" : current}', no '${set}'. ` +
        "Alguien lo cambió después de instalar, así que no lo toco.",
    });
  } else if (before) {
    steps.push({ kind: "restore-hookspath", value: before, text: `Restaurar core.hooksPath = '${before}'.` });
  } else {
    steps.push({ kind: "unset-hookspath", text: "Desetear core.hooksPath (no tenía valor antes)." });
  }
  return steps;
}

function planGitignore(manifest) {
  const added = (manifest.gitignore && manifest.gitignore.linesAdded) || [];
  if (!added.length) return null;
  const gi = abs(".gitignore");
  if (!fs.existsSync(gi)) return null;
  return {
    path: ".gitignore",
    lines: added,
    // If the installer created the file, reverting our lines empties it, and an
    // empty .gitignore is exactly the leftover junk this is supposed to avoid.
    // If the project already had one, an empty result is theirs to keep.
    createdByUs: !!(manifest.gitignore && manifest.gitignore.created),
  };
}

function printPlan(plan, gitSteps, gitignore, wired) {
  const say = (s) => console.log(s);
  say("\n=== Plan de desinstalación ===\n");

  if (plan.delete.length) {
    say(`Se van a BORRAR ${plan.delete.length} archivos que puso el instalador y siguen intactos:`);
    plan.delete.forEach((p) => say(`  - ${p}`));
  } else {
    say("No hay archivos para borrar (ninguno coincide con lo que el instalador escribió).");
  }

  if (plan.newFiles.length) {
    say(`\nSe van a BORRAR ${plan.newFiles.length} archivos *.new que escribimos y nunca se mergearon:`);
    plan.newFiles.forEach((p) => say(`  - ${p}`));
  }

  if (plan.keepModified.length) {
    say(`\nSe CONSERVAN ${plan.keepModified.length} archivos porque tienen cambios tuyos:`);
    plan.keepModified.forEach((e) => say(`  ~ ${e.path}  (${e.why})`));
  }
  if (plan.keepPreexisting.length) {
    say("\nSe CONSERVAN estos porque ya existían antes de instalar (nunca fueron nuestros):");
    plan.keepPreexisting.forEach((p) => say(`  ~ ${p}`));
  }
  if (plan.missing.length) {
    say("\nYa no estaban:");
    plan.missing.forEach((p) => say(`  · ${p}`));
  }

  say("\nEstado de git:");
  gitSteps.forEach((s) => say(`  - ${s.text}`));
  if (gitignore) {
    say(`  - Sacar del .gitignore las ${gitignore.lines.length} líneas que agregó el instalador.`);
    if (gitignore.createdByUs) {
      say("    (ese .gitignore lo creamos nosotros: si queda vacío, se borra)");
    }
  } else {
    say("  - No hay líneas propias que sacar del .gitignore.");
  }

  say("\n" + "-".repeat(70));
  if (wired.length) {
    say("⚠ LOS GUARDRAILS VAN A SEGUIR ACTIVOS después de esto.");
    say("");
    say("  Estos archivos todavía enganchan el motor y no los voy a tocar porque");
    say("  tienen cambios tuyos:");
    wired.forEach((p) => say(`    - ${p}`));
    say("");
    say("  Saká a mano los bloques de hooks que apuntan a .agent-security/ y a");
    say("  pretooluse. Hasta que lo hagas, cada tool call va a ejecutar un hook que");
    say("  apunta a un .agent-security/ que ya no existe: los adapters devuelven");
    say("  'deny', o sea que te va a denegar TODO en vez de dejar pasar todo.");
  } else {
    say("✓ Los guardrails van a quedar DESACTIVADOS: no queda ningún hook enganchado.");
  }
  say("-".repeat(70));
}

function askConfirm() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\n¿Desinstalar? Esto no se puede deshacer. [s/N]: ", (answer) => {
      rl.close();
      resolve(/^s(i|í)?$/i.test(answer.trim()) || /^y(es)?$/i.test(answer.trim()));
    });
  });
}

function execute(plan, gitSteps, gitignore, manifest) {
  const failed = [];
  let deleted = 0;

  for (const rel of [...plan.delete, ...plan.newFiles]) {
    try {
      fs.unlinkSync(abs(rel));
      deleted++;
    } catch (e) {
      failed.push(`${rel}: ${e.message}`);
    }
  }

  // Only remove directories we created, and only when they came out empty —
  // anything the user put in there stays, and so does the directory.
  const dirs = [...((manifest.dirsCreated || []))].sort((a, b) => b.length - a.length);
  const dirsRemoved = [];
  for (const d of dirs) {
    const p = abs(d);
    try {
      if (fs.existsSync(p) && fs.readdirSync(p).length === 0) {
        fs.rmdirSync(p);
        dirsRemoved.push(d);
      }
    } catch (e) {
      /* a non-empty or locked directory is not an error — it just stays */
    }
  }

  for (const step of gitSteps) {
    try {
      if (step.kind === "restore-hookspath") {
        execSync(`git config core.hooksPath ${JSON.stringify(step.value)}`, {
          cwd: PROJECT_ROOT,
          stdio: "ignore",
        });
      } else if (step.kind === "unset-hookspath") {
        execSync("git config --unset core.hooksPath", { cwd: PROJECT_ROOT, stdio: "ignore" });
      }
    } catch (e) {
      failed.push(`core.hooksPath: ${e.message}`);
    }
  }

  if (gitignore) {
    try {
      const p = abs(gitignore.path);
      const drop = new Set(gitignore.lines);
      const kept = fs
        .readFileSync(p, "utf8")
        .split(/\r?\n/)
        .filter((line) => !drop.has(line.trim()));
      // Collapse a trailing run of blank lines left behind by the removal.
      while (kept.length > 1 && kept[kept.length - 1] === "" && kept[kept.length - 2] === "") kept.pop();
      const remaining = kept.join("\n");
      if (gitignore.createdByUs && remaining.trim() === "") {
        fs.unlinkSync(p);
        deleted++;
      } else {
        fs.writeFileSync(p, remaining);
      }
    } catch (e) {
      failed.push(`.gitignore: ${e.message}`);
    }
  }

  return { deleted, dirsRemoved, failed };
}

/**
 * Last act: remove the manifest and this script, then the directory if it came
 * out empty.
 *
 * The manifest is deliberately absent from its own `files[]`, so nothing in the
 * main deletion loop covers it — it has to be removed explicitly or it survives
 * as the one piece of leftover junk, which is precisely what this whole feature
 * exists to prevent.
 *
 * This script, on the other hand, IS in `files[]` (the installer copied it like
 * any other), so by the time we get here it is usually already gone. An ENOENT
 * therefore means success, not failure — reporting it as an error would tell the
 * user to go delete a file that is not there.
 */
function removeLeftovers() {
  const problems = [];

  for (const target of [MANIFEST_PATH, __filename]) {
    try {
      fs.unlinkSync(target);
    } catch (e) {
      if (e.code !== "ENOENT") {
        problems.push(`${path.relative(PROJECT_ROOT, target)}: ${e.message}`);
      }
    }
  }

  try {
    if (fs.existsSync(HERE) && fs.readdirSync(HERE).length === 0) fs.rmdirSync(HERE);
  } catch (e) {
    /* leftover files in .agent-security/ are already reported above */
  }
  return problems;
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const yes = argv.includes("--yes") || argv.includes("-y");

  const manifest = K.loadManifest();
  if (!manifest) return 1;

  const plan = buildPlan(manifest);
  const gitSteps = planGitSteps(manifest);
  const gitignore = planGitignore(manifest);
  const wired = stillWired(plan);

  printPlan(plan, gitSteps, gitignore, wired);

  if (dryRun) {
    console.log("\n--dry-run: no toqué nada.");
    return 0;
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error(
        "\nNo hay terminal interactiva para confirmar. Corré con --yes si estás seguro, " +
          "o con --dry-run para ver el plan sin ejecutar."
      );
      return 1;
    }
    if (!(await askConfirm())) {
      console.log("Cancelado. No toqué nada.");
      return 0;
    }
  }

  const result = execute(plan, gitSteps, gitignore, manifest);

  console.log("\n=== Resultado ===\n");
  console.log(`  Archivos borrados:      ${result.deleted}`);
  console.log(`  Directorios borrados:   ${result.dirsRemoved.length}`);
  console.log(`  Conservados (tuyos):    ${plan.keepModified.length + plan.keepPreexisting.length}`);
  if (result.failed.length) {
    console.log(`\n  ⚠ No pude completar ${result.failed.length}:`);
    result.failed.forEach((f) => console.log(`    - ${f}`));
  }

  const stillWiredAfter = stillWired({ delete: [], newFiles: [] });
  console.log("\n" + "-".repeat(70));
  if (stillWiredAfter.length) {
    console.log("⚠ LOS GUARDRAILS SIGUEN ACTIVOS.");
    stillWiredAfter.forEach((p) => console.log(`    - ${p} todavía engancha el motor`));
    console.log("  Saká esos bloques de hooks a mano para terminar de desinstalar.");
  } else {
    console.log("✓ Guardrails desactivados: no quedó ningún hook enganchado.");
  }
  console.log("-".repeat(70));

  const leftovers = removeLeftovers();
  if (leftovers.length) {
    console.log("\n⚠ No pude borrar estos archivos nuestros, borralos a mano:");
    leftovers.forEach((l) => console.log(`    - ${l}`));
  }

  return result.failed.length || leftovers.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`Error inesperado, no continúo: ${(e && e.message) || e}`);
      process.exit(1);
    }
  );
}

module.exports = { buildPlan, stillWired, sha256Normalized, removeLeftovers, main };
