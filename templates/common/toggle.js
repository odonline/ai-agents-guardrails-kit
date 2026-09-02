#!/usr/bin/env node
/**
 * toggle.js — turns the guardrails off and back on without deleting anything.
 *
 *   node .agent-security/toggle.js --disable            # show the plan, confirm
 *   node .agent-security/toggle.js --disable --dry-run  # show the plan and stop
 *   node .agent-security/toggle.js --disable --yes      # skip the confirmation
 *   node .agent-security/toggle.js --enable             # turn it back on
 *
 * How it works, and why it works that way:
 *
 * Disabling means the engine is never CALLED. Each harness's hook config is
 * renamed out of the way (settings.json -> settings.json.disabled) and
 * core.hooksPath is unset. The harness finds no config, runs no hook, and the
 * engine does not exist as far as it is concerned.
 *
 * There is deliberately NO `enabled: false` flag, and no sentinel file, that the
 * ENGINE reads. That would mean adding a code path whose job is to return
 * "allow" for everything, inside the one component that exists to fail closed —
 * a single file an agent could try to create to free itself, invisible in a code
 * review. Renaming the wiring is subtractive, and it shows up in `git status`.
 *
 * Nothing is deleted here. Your policy.yaml, your adapters, your .husky/ hooks
 * all stay exactly where they are. Deleting is `uninstall.js`.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync } = require("child_process");

const K = require("./kit_manifest.js");
const { abs, DISABLED_SUFFIX, HOOK_CONFIGS, PROJECT_ROOT } = K;

/** Does this config, as it sits on disk right now, call the engine? */
function isWired(relPath) {
  try {
    return K.WIRED_PATTERN.test(fs.readFileSync(abs(relPath), "utf8"));
  } catch (e) {
    return false;
  }
}

/**
 * For each harness, decide what --disable would do to its hook config.
 *
 * The `modified` case is the important one: a hook config the user merged by
 * hand holds their own settings in the SAME file as ours. Renaming it would
 * carry their config away with it, which is worse than editing it. So we do
 * neither, and say so.
 */
function planDisable(manifest) {
  const plan = { rename: [], keepModified: [], notOurs: [], alreadyDisabled: [], absent: [], blocked: [] };

  for (const cfg of HOOK_CONFIGS) {
    const entry = K.findEntry(manifest, cfg.path);
    if (!entry) continue; // harness not installed

    const disabledPath = cfg.path + DISABLED_SUFFIX;
    if (fs.existsSync(abs(disabledPath)) && !fs.existsSync(abs(cfg.path))) {
      plan.alreadyDisabled.push({ ...cfg, disabledPath });
      continue;
    }

    const state = K.classifyFile(entry);
    if (state.state === "preexisting") {
      // The project already had this config, so ours went in as a .new. Whether
      // the harness is wired now depends on something the manifest cannot know:
      // did the user merge that .new by hand? Read the file instead of guessing.
      if (isWired(cfg.path)) {
        plan.keepModified.push({ ...cfg, why: "mergeaste nuestros hooks en tu propia config" });
      } else {
        plan.notOurs.push({ ...cfg });
      }
      continue;
    }
    if (state.state === "missing") {
      plan.absent.push({ ...cfg });
      continue;
    }
    if (state.state === "modified" || state.state === "unreadable") {
      plan.keepModified.push({ ...cfg, why: state.why });
      continue;
    }
    if (fs.existsSync(abs(disabledPath))) {
      // A .disabled we did not write. Never overwrite (G4).
      plan.blocked.push({ ...cfg, disabledPath });
      continue;
    }
    plan.rename.push({ ...cfg, from: cfg.path, to: disabledPath });
  }
  return plan;
}

/** The mirror image: what --enable would put back. */
function planEnable(manifest) {
  const plan = { restore: [], missing: [], alreadyEnabled: [], notWired: [], blocked: [], engineChanged: [] };

  for (const cfg of HOOK_CONFIGS) {
    const entry = K.findEntry(manifest, cfg.path);
    if (!entry) continue;

    const disabledPath = cfg.path + DISABLED_SUFFIX;
    const hasDisabled = fs.existsSync(abs(disabledPath));
    const hasLive = fs.existsSync(abs(cfg.path));

    if (!hasDisabled && hasLive) {
      // "Present" is not the same as "wired": the project's own config may be
      // sitting here with our .new never merged. Only claim it is on if it is.
      if (isWired(cfg.path)) plan.alreadyEnabled.push({ ...cfg });
      else plan.notWired.push({ ...cfg, newFile: cfg.path + ".new" });
    } else if (!hasDisabled && !hasLive) {
      plan.missing.push({ ...cfg });
    } else if (hasDisabled && hasLive) {
      // Something is now living at the original path. Restoring would overwrite
      // it, so it is the user's call, not ours.
      plan.blocked.push({ ...cfg, disabledPath });
    } else {
      plan.restore.push({ ...cfg, from: disabledPath, to: cfg.path });
    }
  }

  // Re-wiring against an engine that was edited by hand is something the user
  // has to know before it starts making decisions again.
  const engineFiles = manifest.files.filter(
    (f) => f.path.startsWith(".agent-security/") || /pretooluse\.js$/.test(f.path)
  );
  for (const entry of engineFiles) {
    const state = K.classifyFile(entry);
    if (state.state === "modified" || state.state === "missing" || state.state === "unreadable") {
      plan.engineChanged.push({ path: entry.path, state: state.state, why: state.why });
    }
  }
  return plan;
}

/**
 * core.hooksPath, for either direction.
 *
 * --disable restores the value the project had before we installed (or unsets
 * it); --enable points it back at .husky. The .husky/ files themselves are never
 * touched, so this is the whole git-hook half of the switch.
 */
function planGit(manifest, mode) {
  if (!K.isGitRepo()) {
    return { kind: "note", text: "No es un repo git — no hay core.hooksPath que tocar." };
  }
  const set = (manifest.git && manifest.git.hooksPathSet) || null;
  const before = manifest.git ? manifest.git.hooksPathBefore : null;
  const current = K.gitConfigGet("core.hooksPath");

  if (!set) {
    return { kind: "note", text: "El instalador no configuró core.hooksPath — no hay nada que cambiar." };
  }

  if (mode === "disable") {
    if (current !== set) {
      return {
        kind: "note",
        text:
          `core.hooksPath vale '${current === null ? "(sin valor)" : current}', no '${set}'. ` +
          "Alguien lo cambió después de instalar, así que no lo toco.",
      };
    }
    if (before) {
      return { kind: "set", value: before, text: `Restaurar core.hooksPath = '${before}' (los git hooks del kit dejan de correr).` };
    }
    return { kind: "unset", text: "Desetear core.hooksPath (los git hooks del kit dejan de correr)." };
  }

  // enable
  if (current === set) {
    return { kind: "note", text: `core.hooksPath ya apunta a '${set}'.` };
  }
  if (current !== null && current !== before) {
    return {
      kind: "note",
      text:
        `core.hooksPath vale '${current}', que no es ni lo nuestro ni el valor previo. ` +
        `No lo toco: si querés los git hooks del kit, corré 'git config core.hooksPath ${set}' a mano.`,
    };
  }
  return { kind: "set", value: set, text: `Poner core.hooksPath = '${set}' (los git hooks del kit vuelven a correr).` };
}

function printDisablePlan(plan, git) {
  const say = (s) => console.log(s);
  say("\n=== Plan de desactivación ===\n");

  if (plan.rename.length) {
    say(`Se van a DESENGANCHAR ${plan.rename.length} harness:`);
    plan.rename.forEach((r) => say(`  - ${r.harness}: ${r.from}  →  ${r.to}`));
    if (plan.rename.some((r) => r.harness === "claude-code")) {
      say("");
      say("  Ojo con claude-code: ese settings.json también trae las listas");
      say("  permissions.deny/ask, que las aplica el propio Claude Code. Desenganchar");
      say("  el archivo las apaga también. 'Desactivado' significa desactivado.");
    }
  } else {
    say("No hay ningún harness para desenganchar.");
  }

  if (plan.alreadyDisabled.length) {
    say("\nYa estaban desactivados:");
    plan.alreadyDisabled.forEach((r) => say(`  · ${r.harness}: ${r.disabledPath}`));
  }
  if (plan.notOurs.length) {
    say("\nNunca estuvieron enganchados (el proyecto ya tenía su config y el .new no se mergeó):");
    plan.notOurs.forEach((r) => say(`  · ${r.harness}: ${r.path}`));
  }
  if (plan.absent.length) {
    say("\nYa no están:");
    plan.absent.forEach((r) => say(`  · ${r.harness}: ${r.path}`));
  }
  if (plan.blocked.length) {
    say("\nNo puedo desenganchar estos porque ya existe el destino:");
    plan.blocked.forEach((r) => say(`  ⚠ ${r.harness}: ${r.disabledPath} ya existe y no lo escribí yo.`));
  }
  if (plan.keepModified.length) {
    say(`\nSe CONSERVAN intactos ${plan.keepModified.length} porque tienen cambios tuyos:`);
    plan.keepModified.forEach((r) => say(`  ~ ${r.harness}: ${r.path}  (${r.why})`));
    say("");
    say("  Ese archivo tiene tu config y la nuestra en el mismo lugar. Renombrarlo se");
    say("  llevaría la tuya puesta, así que no lo toco. Para desengancharlo a mano");
    say("  saká los bloques de hooks que apuntan a .agent-security/ y a pretooluse.");
    if (plan.keepModified.some((r) => r.harness === "antigravity")) {
      say("");
      say("  Para antigravity alcanza con poner \"enabled\": false en .agents/hooks.json:");
      say("  ese campo lo lee el harness, no el motor, así que apagarlo es desenganchar");
      say("  de verdad y no un kill switch adentro del motor.");
    }
  }

  say("\nGit hooks:");
  say(`  - ${git.text}`);

  say("\nNo se borra ni un archivo: tu policy.yaml, los adapters y .husky/ quedan donde están.");

  const stillOn = K.wiredHookConfigs(plan.rename.map((r) => r.from));
  say("\n" + "-".repeat(70));
  if (stillOn.length) {
    say("⚠ EL ENFORCEMENT VA A SEGUIR ACTIVO en estos harness:");
    stillOn.forEach((p) => say(`    - ${p}`));
    say("  Desengancharlos a mano es el único paso que falta.");
  } else {
    say("✓ El enforcement va a quedar APAGADO: ningún harness va a llamar al motor.");
    say("  Para volver a encenderlo: node .agent-security/toggle.js --enable");
  }
  say("-".repeat(70));
  return stillOn;
}

function printEnablePlan(plan, git) {
  const say = (s) => console.log(s);
  say("\n=== Plan de reactivación ===\n");

  if (plan.restore.length) {
    say(`Se van a REENGANCHAR ${plan.restore.length} harness:`);
    plan.restore.forEach((r) => say(`  - ${r.harness}: ${r.from}  →  ${r.to}`));
  } else {
    say("No hay ningún harness desactivado para reenganchar.");
  }
  if (plan.alreadyEnabled.length) {
    say("\nYa estaban activos:");
    plan.alreadyEnabled.forEach((r) => say(`  · ${r.harness}: ${r.path}`));
  }
  if (plan.notWired.length) {
    say("\nNunca estuvieron enganchados — el proyecto ya tenía su propia config y la");
    say("nuestra quedó al lado sin mergear:");
    plan.notWired.forEach((r) => say(`  ⚠ ${r.harness}: mergeá ${r.newFile} en ${r.path} a mano.`));
  }
  if (plan.missing.length) {
    say("\nNo encuentro la config de estos harness (ni activa ni desactivada):");
    plan.missing.forEach((r) => say(`  ⚠ ${r.harness}: ${r.path} — reinstalá el kit para recuperarla.`));
  }
  if (plan.blocked.length) {
    say("\nNo puedo reenganchar estos porque el destino ya existe:");
    plan.blocked.forEach((r) =>
      say(`  ⚠ ${r.harness}: hay un ${r.path} nuevo y también un ${r.disabledPath}. Resolvelo vos.`)
    );
  }
  if (plan.engineChanged.length) {
    say("\n⚠ El motor no está como lo instalamos:");
    plan.engineChanged.forEach((e) =>
      say(`    - ${e.path}: ${e.state === "missing" ? "falta" : e.why || "modificado"}`)
    );
    say("  Reenganchar lo vuelve a poner a decidir. Si eso no es lo que querés,");
    say("  reinstalá el kit antes (nunca sobrescribe: escribe .new al lado).");
  }

  say("\nGit hooks:");
  say(`  - ${git.text}`);
  say("-".repeat(70));
}

function askConfirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim();
      resolve(/^s(i|í)?$/i.test(a) || /^y(es)?$/i.test(a));
    });
  });
}

function applyRenames(pairs) {
  const done = [];
  const failed = [];
  for (const r of pairs) {
    try {
      fs.renameSync(abs(r.from), abs(r.to));
      done.push(r);
    } catch (e) {
      failed.push(`${r.from} → ${r.to}: ${e.message}`);
    }
  }
  return { done, failed };
}

function applyGit(step) {
  if (step.kind === "set") {
    try {
      execSync(`git config core.hooksPath ${JSON.stringify(step.value)}`, {
        cwd: PROJECT_ROOT,
        stdio: "ignore",
      });
      return null;
    } catch (e) {
      return `core.hooksPath: ${e.message}`;
    }
  }
  if (step.kind === "unset") {
    try {
      execSync("git config --unset core.hooksPath", { cwd: PROJECT_ROOT, stdio: "ignore" });
      return null;
    } catch (e) {
      // Already absent is success, not failure: git exits 5 for "not found".
      if (K.gitConfigGet("core.hooksPath") === null) return null;
      return `core.hooksPath: ${e.message}`;
    }
  }
  return null;
}

async function main(argv) {
  const disable = argv.includes("--disable");
  const enable = argv.includes("--enable");
  const dryRun = argv.includes("--dry-run");
  const yes = argv.includes("--yes") || argv.includes("-y");

  if (disable && enable) {
    console.error("--disable y --enable son mutuamente excluyentes. Elegí uno.");
    return 1;
  }
  if (!disable && !enable) {
    console.error(
      "Uso: node .agent-security/toggle.js --disable|--enable [--dry-run] [--yes]\n\n" +
        "  --disable   apaga el enforcement sin borrar nada (pide confirmación)\n" +
        "  --enable    lo vuelve a encender\n" +
        "  --dry-run   muestra el plan y no toca nada\n" +
        "  --yes       saltea la confirmación de --disable\n\n" +
        "Para sacar el kit del todo: node .agent-security/uninstall.js"
    );
    return 1;
  }

  const manifest = K.loadManifest();
  if (!manifest) return 1;

  const mode = disable ? "disable" : "enable";
  const git = planGit(manifest, mode);

  if (disable) {
    const plan = planDisable(manifest);
    printDisablePlan(plan, git);

    if (dryRun) {
      console.log("\n--dry-run: no toqué nada.");
      return 0;
    }
    if (!plan.rename.length && git.kind === "note") {
      // Nothing we are allowed to touch. If enforcement is nonetheless still on,
      // saying "nada que hacer" would be the wrong last word — the plan above
      // already named the one manual step that is left.
      console.log(
        K.wiredHookConfigs([]).length
          ? "\nNo hay nada que yo pueda desenganchar sin pisar tus cambios. El paso manual\nde arriba es el único que falta."
          : "\nNada que hacer: no quedaba nada enganchado."
      );
      return 0;
    }
    // Turning a safeguard off gets a confirmation. Turning it back on does not.
    if (!yes) {
      if (!process.stdin.isTTY) {
        console.error(
          "\nNo hay terminal interactiva para confirmar. Corré con --yes si estás seguro, " +
            "o con --dry-run para ver el plan sin ejecutar."
        );
        return 1;
      }
      if (!(await askConfirm("\n¿Apagar los guardrails? [s/N]: "))) {
        console.log("Cancelado. No toqué nada.");
        return 0;
      }
    }

    const { done, failed } = applyRenames(plan.rename);
    const gitFail = applyGit(git);
    if (gitFail) failed.push(gitFail);

    console.log("\n=== Resultado ===\n");
    console.log(`  Harness desenganchados: ${done.length}`);
    console.log(`  Conservados intactos:   ${plan.keepModified.length}`);
    if (failed.length) {
      console.log(`\n  ⚠ No pude completar ${failed.length}:`);
      failed.forEach((f) => console.log(`    - ${f}`));
    }

    const stillOn = K.wiredHookConfigs([]);
    console.log("\n" + "-".repeat(70));
    if (stillOn.length) {
      console.log("⚠ EL ENFORCEMENT SIGUE ACTIVO en:");
      stillOn.forEach((p) => console.log(`    - ${p}`));
    } else {
      console.log("✓ Guardrails apagados. Nada se borró.");
      console.log("  Para encenderlos de nuevo: node .agent-security/toggle.js --enable");
    }
    console.log("-".repeat(70));
    return failed.length ? 1 : 0;
  }

  // --enable
  const plan = planEnable(manifest);
  printEnablePlan(plan, git);

  if (dryRun) {
    console.log("\n--dry-run: no toqué nada.");
    return 0;
  }
  if (!plan.restore.length && git.kind === "note") {
    // Explicitly a no-op, not an error: asking for protection you already have
    // should never look like a failure.
    console.log("\nLos guardrails ya estaban activos. No había nada que reenganchar.");
    return 0;
  }

  const { done, failed } = applyRenames(plan.restore);
  const gitFail = applyGit(git);
  if (gitFail) failed.push(gitFail);

  console.log("\n=== Resultado ===\n");
  console.log(`  Harness reenganchados: ${done.length}`);
  if (failed.length) {
    console.log(`\n  ⚠ No pude completar ${failed.length}:`);
    failed.forEach((f) => console.log(`    - ${f}`));
  }

  const wired = K.wiredHookConfigs([]);
  console.log("\n" + "-".repeat(70));
  if (wired.length) {
    console.log("✓ Guardrails activos de nuevo en:");
    wired.forEach((p) => console.log(`    - ${p}`));
  } else {
    console.log("⚠ No quedó ningún harness enganchado al motor. Revisá el detalle de arriba.");
  }
  console.log("-".repeat(70));
  return failed.length ? 1 : 0;
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

module.exports = { planDisable, planEnable, planGit, main };
