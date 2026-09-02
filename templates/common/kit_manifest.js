/**
 * kit_manifest.js — reading the install manifest, and deciding what is ours.
 *
 * Shared by uninstall.js and toggle.js. It exists so the hash comparison lives
 * in exactly one place: that comparison IS the safety argument for both scripts
 * ("we only touch files the installer wrote and nobody edited since"), and two
 * copies of it would be two chances to get it subtly different.
 *
 * Nothing here has side effects. It reads and classifies; the callers act.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const AGENT_SECURITY_DIR = __dirname;
const PROJECT_ROOT = path.resolve(AGENT_SECURITY_DIR, "..");
const MANIFEST_PATH = path.join(AGENT_SECURITY_DIR, "install-manifest.json");

/**
 * The files that wire a harness to the engine — one per harness (G7). If one of
 * these is present with our hooks still in it, enforcement is on. That single
 * fact is what both scripts have to report at the end.
 */
const HOOK_CONFIGS = [
  { harness: "claude-code", path: ".claude/settings.json" },
  { harness: "vscode-codex", path: ".github/hooks/security.json" },
  { harness: "antigravity", path: ".agents/hooks.json" },
];

/** Suffix used by toggle.js to park a hook config without editing it. */
const DISABLED_SUFFIX = ".disabled";

/** A hook config still references the engine if it mentions either of these. */
const WIRED_PATTERN = /\.agent-security|pretooluse/;

/**
 * Must match install.js's sha256Normalized() exactly.
 *
 * Line endings are normalized to \n before hashing. Without that, a CRLF
 * checkout makes every untouched file hash differently from what was recorded,
 * every file looks "modified", and neither script ever touches anything.
 */
function sha256Normalized(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  return crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

function abs(rel) {
  return path.join(PROJECT_ROOT, rel);
}

function isGitRepo() {
  return fs.existsSync(path.join(PROJECT_ROOT, ".git"));
}

function gitConfigGet(key) {
  try {
    return (
      execSync(`git config --get ${key}`, {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch (e) {
    return null; // not set, or not a repo — the caller distinguishes
  }
}

/**
 * Load and validate the manifest, or explain why we are not going to touch
 * anything. Returns null on any problem: a broken manifest can never degrade
 * into "delete/rename whatever looks right", because knowing what is safe to
 * touch is the manifest's entire job.
 */
function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(
      "No encontré .agent-security/install-manifest.json.\n\n" +
        "Sin ese archivo no sé qué escribió el instalador y qué escribiste vos, así que\n" +
        "no voy a tocar nada por las dudas. Si lo borraste, podés reinstalar el kit\n" +
        "(regenera el manifest), o hacerlo a mano guiándote por\n" +
        ".agent-security/README.md."
    );
    return null;
  }
  let raw;
  try {
    raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  } catch (e) {
    console.error(`No pude leer el manifest: ${e.message}. No toqué nada.`);
    return null;
  }
  let m;
  try {
    m = JSON.parse(raw);
  } catch (e) {
    console.error(
      `El manifest está corrupto (${e.message}). No toqué nada.\n\n` +
        "Un manifest roto no puede degradar en 'borrá lo que te parezca': lo que\n" +
        "sabe es justamente qué es seguro tocar."
    );
    return null;
  }
  if (!m || !Array.isArray(m.files)) {
    console.error("El manifest no tiene la forma esperada (falta 'files'). No toqué nada.");
    return null;
  }
  return m;
}

/**
 * Where one recorded file stands right now.
 *
 *   preexisting — the manifest says `skipped`: it was already in the project
 *                 when we arrived, so it was never ours to touch.
 *   ours        — present, and hashes to what the installer wrote.
 *   modified    — present, but the content changed. Yours now.
 *   unreadable  — treated exactly like `modified`: if we cannot verify it, we
 *                 do not touch it.
 *   missing     — gone already.
 */
function classifyFile(entry) {
  if (entry.status === "skipped") {
    return { state: "preexisting", path: entry.path, exists: fs.existsSync(abs(entry.path)) };
  }
  const p = abs(entry.path);
  if (!fs.existsSync(p)) return { state: "missing", path: entry.path };
  let actual;
  try {
    actual = sha256Normalized(fs.readFileSync(p));
  } catch (e) {
    return { state: "unreadable", path: entry.path, why: `no pude leerlo (${e.message})` };
  }
  if (actual === entry.sha256) return { state: "ours", path: entry.path };
  return { state: "modified", path: entry.path, why: "lo editaste" };
}

/** The manifest entry for a given relative path, or undefined. */
function findEntry(manifest, relPath) {
  return manifest.files.find((f) => f.path === relPath);
}

/**
 * Which hook configs currently on disk still reference the engine.
 *
 * `ignore` lets a caller ask the question about a hypothetical future — "which
 * would still be wired if I removed these?" — which is how the plan output can
 * promise an outcome instead of describing an action.
 */
function wiredHookConfigs(ignore) {
  const skip = new Set(ignore || []);
  const wired = [];
  for (const cfg of HOOK_CONFIGS) {
    if (skip.has(cfg.path)) continue;
    const p = abs(cfg.path);
    if (!fs.existsSync(p)) continue;
    let text;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch (e) {
      continue;
    }
    if (WIRED_PATTERN.test(text)) wired.push(cfg.path);
  }
  return wired;
}

module.exports = {
  AGENT_SECURITY_DIR,
  PROJECT_ROOT,
  MANIFEST_PATH,
  HOOK_CONFIGS,
  DISABLED_SUFFIX,
  WIRED_PATTERN,
  sha256Normalized,
  abs,
  isGitRepo,
  gitConfigGet,
  loadManifest,
  classifyFile,
  findEntry,
  wiredHookConfigs,
};
