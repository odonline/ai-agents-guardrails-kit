/**
 * policy_engine.js — the one place a tool call becomes a decision.
 *
 * Every per-harness adapter (.claude/hooks/pretooluse.js,
 * .github/hooks/pretooluse.js, .agents/scripts/pretooluse.js) translates its
 * harness's JSON and calls evaluate(). All decision logic lives here, so there
 * is exactly one place to audit. Adapters must never make a policy decision,
 * and this file must never learn a harness's JSON shape.
 *
 * Evaluation order — this order is the contract, not an implementation detail:
 *   1. Structured file-tool calls: resolve the path, deny if it escapes the
 *      workspace or matches a protected pattern.
 *   2. Shell commands: blocked_commands regexes first, then every path-looking
 *      token against protected paths, then against guardrail infrastructure.
 *   3. Guardrail self-protection for structured calls: writes and deletes are
 *      denied, reads are allowed.
 *   4. Default: allow.
 *
 * Two things this deliberately does NOT do:
 *   - Honor `!negation` lines in agent-ignore files. A repo's own ignore file
 *     may only ever ADD protection. See _gitignoreLineToPattern.
 *   - Parse shell properly. The tokenizer catches `cat .env` and friends; it is
 *     not a shell and cannot promise no evasion exists. Stated plainly in
 *     README.md rather than implied away.
 *
 * Fail closed, always (G2). Anything unexpected becomes `deny`, never `allow`.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { loadPolicy, PolicyError } = require("./policy_loader.js");

const REPO_ROOT_ENV = "GUARDRAILS_WORKSPACE_ROOT";
const AUDIT_LOG_NAME = "audit.log";
const SECURITY_DIR = ".agent-security";

// Non-standard "ignore for agents" files various tools already look for. Read
// live on every evaluation (mtime-cached) so editing one takes effect at once.
// docs.js reads this list to generate RULES.md — keep it a plain array literal.
const KNOWN_IGNORE_FILES = [
  ".cursorignore",
  ".agentsignore",
  ".aiignore",
  ".aiderignore",
  ".clineignore",
  ".windsurfignore",
  ".continueignore",
  ".copilotignore",
  ".codeiumignore",
  ".geminiignore",
];

// The guardrail's own infrastructure. Writing to OR shell-deleting any of these
// is DENIED, or the guardrails are trivial to switch off from inside the very
// session they bind. Reading them is allowed — see READ_ONLY_TOOLS.
const GUARDRAIL_INFRA_PATTERNS = [
  ".agent-security/**",
  ".claude/settings*.json",
  ".claude/hooks/**",
  ".agents/hooks.json",
  ".github/hooks/**",
  ".husky/**",
  ".github/workflows/**",
  ...KNOWN_IGNORE_FILES,
];

/**
 * The subset of GUARDRAIL_INFRA_PATTERNS where merely *naming* the path in a
 * shell command is unusual enough to be worth a prompt.
 *
 * Every pattern above is protected against writes by four independent paths
 * (structured file tools, mutating shell verbs, redirect targets, and the
 * unrecognized-tool default). This list governs only the leftover case: a shell
 * command that names guardrail config without any recognizable mutation. We
 * cannot prove such a command is read-only, so for these paths we ask.
 *
 * `.github/workflows/**` is deliberately NOT here. It is where anyone goes to
 * answer "how does CI work in this repo", so agents and humans list, cat and
 * grep it constantly — and the old behavior was not even a coherent policy:
 * `ls .github/workflows/` was allowed while `ls .github/workflows/*.yml` asked,
 * because a bare directory does not match a `/**` glob. Prompting arbitrarily
 * on ordinary inspection is how a human learns to approve prompts without
 * reading them, which is the failure mode all of this exists to avoid.
 *
 * Its sensitivity is entirely about modification — CI plus branch protection is
 * the real enforcement layer, so deleting the security job is the attack — and
 * modification is still denied by all four paths.
 */
const INFRA_ASK_ON_MENTION = [
  ".agent-security/**",
  ".claude/settings*.json",
  ".claude/hooks/**",
  ".agents/hooks.json",
  ".github/hooks/**",
  ".husky/**",
  ...KNOWN_IGNORE_FILES,
];

const FILE_TOOLS = new Set([
  "Write", "Edit", "create_file", "write_to_file", "replace_file_content",
  "multi_replace_file_content", "str_replace", "replace_string_in_file",
]);

/**
 * The one sanctioned way to change guardrail configuration, quoted in every
 * deny reason. A blocked agent must be told the legitimate path, or the next
 * thing it tries is a workaround.
 */
const DISABLE_HINT =
  "Guardrail setup and config are off limits to agents. A human edits them directly, " +
  "or runs 'node .agent-security/toggle.js --disable' first — both are deliberate and " +
  "both show up in git status.";

/**
 * Shell verbs and operators that clearly modify a file.
 *
 * Used only to split "this command would change guardrail config" (deny) from
 * "this command merely names it" (ask). The split exists because denying every
 * command that mentions the directory would break `tail audit.log`, while
 * asking about all of them leaves a one-click bypass — an agent that cannot
 * Edit policy.yaml could just `rm` it.
 *
 * Deliberately a denylist of mutators rather than an allowlist of readers, and
 * that is safe *here* because of which way each mistake falls: a mutator we
 * fail to recognize still lands on `ask` (the pre-existing behavior, no worse),
 * and a
 * read we misjudge as a mutation lands on `deny` (mild friction). Neither
 * error can produce an `allow`.
 */
const MUTATING_SHELL = [
  [/(^|[\s;&|(])rm\s/, "rm"],
  [/(^|[\s;&|(])rmdir\s/, "rmdir"],
  [/(^|[\s;&|(])unlink\s/, "unlink"],
  [/(^|[\s;&|(])mv\s/, "mv"],
  [/(^|[\s;&|(])cp\s/, "cp"],
  [/(^|[\s;&|(])install\s/, "install"],
  [/(^|[\s;&|(])truncate\s/, "truncate"],
  [/(^|[\s;&|(])dd\s/, "dd"],
  [/(^|[\s;&|(])tee\s/, "tee"],
  [/(^|[\s;&|(])chmod\s/, "chmod"],
  [/(^|[\s;&|(])chown\s/, "chown"],
  [/(^|[\s;&|(])ln\s/, "ln"],
  [/(^|[\s;&|(])(sed|perl|ruby|python3?)\s+[^|;&]*-i\b/, "in-place edit"],
  [/(^|[\s;&|(])(patch|git\s+apply)\b/, "patch"],
  [/(^|[\s;&|(])git\s+(rm|checkout|restore)\b/, "git"],
];

/**
 * Does a redirect in this command actually write TO guardrail config?
 *
 * Testing merely for the presence of `>` was wrong, and a real run caught it:
 * `wc -l .agent-security/audit.log 2>/dev/null` was denied. `2>/dev/null` is a
 * stderr redirect — it writes nothing to the file being read. Appending
 * `2>/dev/null` to a read is one of the most common shell idioms there is, so
 * the coarse check turned ordinary inspection into a wall.
 *
 * Looking at the redirect's TARGET instead handles `/dev/null` and fd
 * duplications (`2>&1`, which cannot match because `&` is excluded from the
 * target class) for free, with nothing special-cased.
 */
function redirectWritesToInfra(command, root) {
  const re = /(?:^|[\s;&|(])\d*>>?\s*("[^"]*"|'[^']*'|[^\s|;&<>]+)/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    const target = m[1].replace(/^["']|["']$/g, "");
    if (!target || target === "/dev/null" || target.toUpperCase() === "NUL") continue;
    const resolved = resolvePath(target, root);
    if (resolved === null) continue;
    if (matchProtectedPath(resolved, root, GUARDRAIL_INFRA_PATTERNS)) return true;
  }
  return false;
}

/**
 * Which mutation, if any, this command performs.
 *
 * The verb checks stay coarse — "the command contains `rm` and names guardrail
 * config" — because knowing which argument `rm` would actually delete needs a
 * real shell parser. That over-blocks a compound like
 * `rm /tmp/x && cat policy.yaml`, which is rare enough to accept. The redirect
 * case gets precise treatment because `2>/dev/null` on a read is not rare.
 */
function mutatingShellVerb(command, root) {
  for (const [re, label] of MUTATING_SHELL) {
    if (re.test(command)) return label;
  }
  if (redirectWritesToInfra(command, root)) return "redirect";
  return null;
}

/**
 * Tools that only ever read.
 *
 * Used by the guardrail self-protection check (step 3 of evaluate) and NOWHERE
 * else. `protected_paths` still denies reads, so `Read .env` stays a deny.
 *
 * The distinction matters because self-protection exists to stop an agent
 * DISABLING its guardrails, and reading policy.yaml disables nothing: the file
 * is committed to the repo and RULES.md documents the same rules in prose.
 * Asking about reads costs security rather than adding it — an agent reads
 * constantly, so a human is trained to approve `.agent-security/**` prompts
 * reflexively, and then waves through the one that mattered: an actual edit.
 * Measured in the field: it also made SELF_TEST_PROMPT.md unrunnable, because
 * denying the read — the correct instinct — stops the agent dead.
 *
 * Anything NOT listed here is treated as potentially mutating and is denied:
 * an unrecognized tool name must never buy silence (G2).
 */
const READ_ONLY_TOOLS = new Set([
  // claude-code
  "Read", "Grep", "Glob", "NotebookRead", "LS",
  // vscode-codex / copilot-style
  "read_file", "list_dir", "grep_search", "file_search", "semantic_search",
  // antigravity
  "view_file", "view_code_item", "codebase_search", "list_directory",
]);

const SHELL_TOOLS = new Set([
  "Bash", "run_command", "runTerminalCommand", "execute_command", "shell",
]);

// Windows filesystems are case-insensitive, so `.ENV` and `.env` are the same
// file and must match the same pattern. Python's fnmatch gets this via
// os.path.normcase; we do it explicitly and keep separators as '/' throughout,
// which avoids normcase's backslash conversion entirely.
const CASE_INSENSITIVE_PATHS = process.platform === "win32";

class Decision {
  constructor(action, reason, { matchedRule = null, toolName = "", details = {} } = {}) {
    this.action = action;
    this.reason = reason;
    this.matchedRule = matchedRule;
    this.toolName = toolName;
    this.details = details;
  }

  toDict() {
    return {
      action: this.action,
      reason: this.reason,
      matched_rule: this.matchedRule,
      tool_name: this.toolName,
      details: this.details,
    };
  }
}

// ── path helpers ─────────────────────────────────────────────────────────

/** Always compare paths with '/' separators, whatever the platform hands us. */
function toPosix(p) {
  return String(p).split(path.sep).join("/").replace(/\\/g, "/");
}

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * On Windows, translate the Unix-style drive paths that Git Bash / MSYS2 /
 * Cygwin shells use into real Windows paths:
 *
 *   /c/Users/me/.ssh/id_rsa           -> C:/Users/me/.ssh/id_rsa
 *   /cygdrive/c/Users/me/.ssh/id_rsa  -> C:/Users/me/.ssh/id_rsa
 *
 * Without this, `/c/...` is not recognized as absolute, so path.resolve()
 * produces `C:\c\...` — a path that does not exist and matches no anchored
 * pattern. That was a live protected-path bypass, found by running
 * SELF_TEST_PROMPT.md against a real project on Windows: `cat ~/.ssh/id_rsa`
 * was denied while `cat /c/Users/<user>/.ssh/id_rsa` — the same file, through a
 * path Git Bash reads perfectly well — was allowed. Bare patterns like `.env`
 * still caught it by basename; every anchored pattern (`~/.ssh/**`,
 * `~/.aws/**`, `~/.config/gcloud/**`) did not.
 *
 * Only applied on win32: on a real POSIX system `/c/Users` is an ordinary
 * absolute path and rewriting it would be wrong. Only a single-letter first
 * segment is treated as a drive, which is exactly what those shells do.
 */
function expandShellDrivePath(p) {
  if (process.platform !== "win32") return p;
  const cygdrive = /^[/\\]cygdrive[/\\]([A-Za-z])(?=[/\\]|$)(.*)$/.exec(p);
  if (cygdrive) return `${cygdrive[1].toUpperCase()}:${cygdrive[2] || "/"}`;
  const msys = /^[/\\]([A-Za-z])(?=[/\\]|$)(.*)$/.exec(p);
  if (msys) return `${msys[1].toUpperCase()}:${msys[2] || "/"}`;
  return p;
}

/**
 * Resolve a possibly-relative, possibly-`~` path to an absolute one, following
 * symlinks where they exist. Mirrors Python's Path.resolve(strict=False): the
 * path need not exist. Returns null when resolution is not possible at all —
 * and a null here means deny, never allow.
 */
function resolvePath(rawPath, workspaceRoot) {
  try {
    if (rawPath === undefined || rawPath === null || String(rawPath) === "") return null;
    const expanded = expandShellDrivePath(expandHome(String(rawPath)));
    const absolute = path.resolve(String(workspaceRoot), expanded);

    // Resolve symlinks on the longest existing prefix, then re-attach the rest.
    // Doing it prefix-wise is what makes this work for paths that do not exist
    // yet (a Write to a new file) without losing symlink resolution on the
    // directories that do.
    let head = absolute;
    const tail = [];
    for (;;) {
      try {
        const real = fs.realpathSync(head);
        return tail.length ? path.resolve(real, ...tail.reverse()) : real;
      } catch (e) {
        const parent = path.dirname(head);
        if (parent === head) return absolute; // hit the filesystem root
        tail.push(path.basename(head));
        head = parent;
      }
    }
  } catch (e) {
    return null;
  }
}

function samePath(a, b) {
  return CASE_INSENSITIVE_PATHS
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/** True when `resolved` is not the workspace root nor anything beneath it. */
function pathEscapesWorkspace(resolved, workspaceRoot) {
  const root = toPosix(path.resolve(String(workspaceRoot)));
  const target = toPosix(resolved);
  if (samePath(target, root)) return false;
  const prefix = root.endsWith("/") ? root : root + "/";
  return CASE_INSENSITIVE_PATHS
    ? !target.toLowerCase().startsWith(prefix.toLowerCase())
    : !target.startsWith(prefix);
}

/** Workspace-relative form of `resolved`, or null when it is outside. */
function relativeToWorkspace(resolved, workspaceRoot) {
  const root = toPosix(path.resolve(String(workspaceRoot)));
  const target = toPosix(resolved);
  const prefix = root.endsWith("/") ? root : root + "/";
  const matches = CASE_INSENSITIVE_PATHS
    ? target.toLowerCase().startsWith(prefix.toLowerCase())
    : target.startsWith(prefix);
  return matches ? target.slice(prefix.length) : null;
}

// ── fnmatch ──────────────────────────────────────────────────────────────
//
// Python's fnmatch, translated. The important and slightly surprising part:
// fnmatch's `*` matches '/' too, so `**` is just `*` twice and behaves
// identically to a single `*`. Patterns like `**/*.pem` therefore match
// `certs/server.pem` — which is exactly what the ignore-file conversion below
// relies on. Do not "fix" `**` into directory-aware globbing; the ignore-file
// patterns are written against these semantics.

const fnmatchCache = new Map();

function fnmatchToRegExp(pattern) {
  const key = pattern + (CASE_INSENSITIVE_PATHS ? " i" : "");
  const cached = fnmatchCache.get(key);
  if (cached) return cached;

  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      out += ".*";
    } else if (c === "?") {
      out += ".";
    } else if (c === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        out += "\\[";
      } else {
        let body = pattern.slice(i + 1, close);
        i = close;
        if (body.startsWith("!")) body = "^" + body.slice(1);
        // Inside a character class only \ and ] need escaping.
        out += "[" + body.replace(/\\/g, "\\\\") + "]";
      }
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  const re = new RegExp(`^${out}$`, CASE_INSENSITIVE_PATHS ? "i" : "");
  fnmatchCache.set(key, re);
  return re;
}

function fnmatch(candidate, pattern) {
  return fnmatchToRegExp(pattern).test(candidate);
}

/**
 * Match a resolved path against a pattern list. Tries the absolute path and the
 * workspace-relative path, and each pattern both bare and prefixed with `*​/`
 * — the same two attempts the Python version makes, which is what lets a
 * pattern like `.env` match at any depth.
 *
 * Returns the pattern that matched (the original, not the expanded form) so the
 * reason string can quote what the user actually wrote.
 */
function matchProtectedPath(resolved, workspaceRoot, patterns) {
  const candidates = [toPosix(resolved)];
  const rel = relativeToWorkspace(resolved, workspaceRoot);
  if (rel !== null) candidates.push(rel);

  for (const pattern of patterns) {
    const expanded = toPosix(expandHome(pattern));
    for (const cand of candidates) {
      if (fnmatch(cand, expanded) || fnmatch(cand, "*/" + expanded)) {
        return pattern;
      }
    }
  }
  return null;
}

// ── agent-ignore files ───────────────────────────────────────────────────

/**
 * Best-effort conversion of one gitignore-style line into an fnmatch pattern.
 *
 * Intentionally conservative, because this feeds a security control: when in
 * doubt a line should protect MORE, never less. In particular `!negation` lines
 * are dropped rather than honored — implementing include/exclude precedence
 * would let a repo's own ignore file quietly weaken this control, and the
 * ignore file itself is separately protected from being rewritten.
 *
 * Returns null for lines that contribute nothing (blank, comment, negation).
 */
function _gitignoreLineToPattern(line) {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) return null;
  if (pattern.startsWith("!")) return null;

  const dirOnly = pattern.endsWith("/");
  if (dirOnly) pattern = pattern.replace(/\/+$/, "");
  const anchored = pattern.startsWith("/");
  pattern = pattern.replace(/^\/+/, "");

  // A bare name with no slash matches at any depth in gitignore, so do the same.
  if (!anchored && !pattern.includes("/")) pattern = `**/${pattern}`;
  if (dirOnly) pattern = `${pattern}/**`;
  return pattern;
}

// Cached per workspace root, invalidated by the newest mtime across the ignore
// files present. Each hook invocation is its own process, so this only pays off
// within a single evaluation — but an evaluation can check many tokens.
const ignoreFileCache = new Map();

function loadIgnoreFilePatterns(workspaceRoot) {
  const root = String(workspaceRoot);
  let newestMtime = 0;
  const present = [];

  for (const name of KNOWN_IGNORE_FILES) {
    const p = path.join(root, name);
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      present.push([p, name]);
      newestMtime = Math.max(newestMtime, st.mtimeMs);
    } catch (e) {
      continue;
    }
  }

  const cached = ignoreFileCache.get(root);
  if (cached && cached.mtime === newestMtime && cached.count === present.length) {
    return cached.patterns;
  }

  const patterns = [];
  for (const [file, name] of present) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const pattern = _gitignoreLineToPattern(line);
      if (pattern) patterns.push({ pattern, source: name });
    }
  }

  ignoreFileCache.set(root, { mtime: newestMtime, count: present.length, patterns });
  return patterns;
}

/**
 * policy.yaml's protected_paths AND every known agent-ignore file present, live.
 * Returns a human-readable reason naming whichever matched first.
 */
function matchAnyProtected(resolved, workspaceRoot, policyPatterns) {
  const matched = matchProtectedPath(resolved, workspaceRoot, policyPatterns);
  if (matched) return `policy.yaml pattern '${matched}'`;

  for (const { pattern, source } of loadIgnoreFilePatterns(workspaceRoot)) {
    if (matchProtectedPath(resolved, workspaceRoot, [pattern])) {
      return `'${source}' pattern '${pattern}'`;
    }
  }
  return null;
}

// ── commands ─────────────────────────────────────────────────────────────

/**
 * Collapse whitespace and strip one layer of `sh -c "..."`, so a regex cannot
 * be dodged with padding or a single wrapper. One level only — this is not an
 * unwrapping loop and does not claim to be.
 */
function normalizeCommand(cmd) {
  let out = String(cmd).trim().replace(/\s+/g, " ");
  const m = out.match(/^(?:\/usr\/bin\/)?(?:sh|bash|zsh)\s+-c\s+['"](.*)['"]$/);
  if (m) out = m[1];
  return out;
}

const SHELL_METACHARS = /[|&;()<>]/;
const QUOTED_OR_WORD = /'[^']*'|"[^"]*"|\S+/g;

/**
 * Tokenize a command and check every path-looking token against `patterns`.
 *
 * Best-effort by construction: split on shell metacharacters, then pull quoted
 * strings or bare words out of each clause. It catches the common shapes
 * (`cat .env`, `grep X .env`, a one-liner naming the file literally). It is not
 * a shell parser and no amount of tuning would make it one.
 *
 * Note what this does NOT do, on purpose: it never evaluates the command, not
 * even to tokenize it. Handing hostile text to the shell to find out what is in
 * it would put arbitrary execution inside the gate meant to prevent it.
 *
 * @param {string} matcher "protected" (policy + ignore files) or "infra"
 * @returns {{resolved: string, matched: string}|null}
 */
function commandTouches(command, workspaceRoot, patterns, matcher) {
  const normalized = normalizeCommand(command);

  for (const clause of normalized.split(SHELL_METACHARS)) {
    if (!clause) continue;
    const tokens = clause.match(QUOTED_OR_WORD) || [];
    for (const rawToken of tokens) {
      const token = rawToken.replace(/^['"]+|['"]+$/g, "");
      if (!token || token.startsWith("-")) continue;
      // Only tokens that could plausibly be a path are worth resolving.
      if (!token.includes("/") && !token.includes(".") && !token.startsWith("~")) continue;

      const resolved = resolvePath(token, workspaceRoot);
      if (resolved === null) continue;

      const matched = matcher === "protected"
        ? matchAnyProtected(resolved, workspaceRoot, patterns)
        : matchProtectedPath(resolved, workspaceRoot, patterns);
      if (matched) return { resolved: toPosix(resolved), matched };
    }
  }
  return null;
}

/**
 * First blocked_commands rule whose pattern matches. Uses the RegExp objects the
 * loader compiled and validated at load time — an unusable pattern never gets
 * this far, so there is no "skip the broken rule" path here to silently open a
 * hole.
 */
function matchBlockedCommand(command, policy) {
  const normalized = normalizeCommand(command);
  const rules = policy.blocked_commands || [];
  const compiled = policy._compiled;

  for (let i = 0; i < rules.length; i++) {
    const re = compiled && compiled[i] ? compiled[i] : new RegExp(rules[i].pattern, "i");
    if (re.test(normalized)) return rules[i];
  }
  return null;
}

// ── workspace root ───────────────────────────────────────────────────────

function findWorkspaceRoot(start) {
  const fromEnv = process.env[REPO_ROOT_ENV];
  if (fromEnv) {
    try {
      return path.resolve(fromEnv);
    } catch (e) {
      /* fall through to the walk */
    }
  }
  let cur = path.resolve(start || process.cwd());
  for (let i = 0; i < 20; i++) {
    try {
      if (fs.statSync(path.join(cur, SECURITY_DIR)).isDirectory()) return cur;
    } catch (e) {
      /* keep walking */
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(start || process.cwd());
}

// ── audit ────────────────────────────────────────────────────────────────

/** Python's time.strftime("%Y-%m-%dT%H:%M:%S%z"), so log lines stay uniform. */
function timestamp(now) {
  const d = now || new Date();
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
 * Append one JSON line per decision. Must never throw and must never turn a
 * deny into an allow: the caller already holds its decision, and a full disk is
 * not a reason to let a command through.
 */
/**
 * Session fields worth recording next to a decision, and nothing else.
 *
 * An allowlist, not a passthrough: a harness payload can carry the file
 * contents of a Write, so copying whatever arrives into a log that lives in the
 * repo is how a guardrail becomes the leak. These four are metadata.
 *
 * `permission_mode` is the one that matters. `deny` is enforced by the hook,
 * but `ask` is handed to the harness — and in an auto-approving mode it is
 * approved with no prompt. Recording the mode is what makes an `ask` line in
 * the log interpretable after the fact: "asked and a human said yes" and
 * "asked and the mode said yes" are the same line today.
 */
const AUDIT_CONTEXT_KEYS = ["permission_mode", "permissionMode", "hook_event_name", "session_id"];

function auditContext(context) {
  if (!context || typeof context !== "object") return null;
  const out = {};
  for (const key of AUDIT_CONTEXT_KEYS) {
    const v = context[key];
    if (typeof v === "string" && v && v.length <= 200) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

function audit(decision, workspaceRoot, context) {
  try {
    const dir = path.join(String(workspaceRoot), SECURITY_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const record = { ts: timestamp(), ...decision.toDict() };
    const ctx = auditContext(context);
    if (ctx) record.session = ctx;
    fs.appendFileSync(path.join(dir, AUDIT_LOG_NAME), JSON.stringify(record) + "\n", "utf8");
  } catch (e) {
    /* deliberately swallowed — see the comment above */
  }
}

// ── entrypoint ───────────────────────────────────────────────────────────

function firstPath(toolInput) {
  return toolInput.file_path || toolInput.path || toolInput.filePath || "";
}

/**
 * Turn one tool call into a Decision. Adapters call this and translate the
 * result into their harness's shape.
 */
function evaluate(toolName, toolInput, workspaceRoot, policy, context) {
  const input = toolInput && typeof toolInput === "object" ? toolInput : {};
  const root = workspaceRoot === undefined || workspaceRoot === null
    ? findWorkspaceRoot(process.cwd())
    : String(workspaceRoot);
  const pol = policy === undefined || policy === null ? loadPolicy() : policy;

  const finish = (decision) => {
    audit(decision, root, context);
    return decision;
  };

  // --- 1. structured file-tool calls ---
  const hasPathKey =
    FILE_TOOLS.has(toolName) || "path" in input || "file_path" in input || "filePath" in input;

  if (hasPathKey) {
    const rawPath = firstPath(input);
    if (rawPath) {
      const resolved = resolvePath(String(rawPath), root);
      if (resolved === null) {
        return finish(new Decision("deny", "Path could not be resolved safely.", { toolName }));
      }
      if (pathEscapesWorkspace(resolved, root)) {
        return finish(new Decision(
          "deny",
          `Path '${rawPath}' resolves outside the workspace root.`,
          { toolName, details: { resolved_path: toPosix(resolved) } }
        ));
      }
      const matched = matchAnyProtected(resolved, root, pol.protected_paths || []);
      if (matched) {
        return finish(new Decision(
          "deny",
          `Path matches protected pattern from ${matched}.`,
          { matchedRule: matched, toolName, details: { resolved_path: toPosix(resolved) } }
        ));
      }
    }
  }

  // --- 2. shell commands ---
  if (SHELL_TOOLS.has(toolName) || "command" in input) {
    const command = input.command || input.cmd || "";
    if (command) {
      const rule = matchBlockedCommand(String(command), pol);
      if (rule) {
        return finish(new Decision(rule.action, rule.reason, {
          matchedRule: rule.pattern,
          toolName,
          details: { command },
        }));
      }

      // A shell command reaches a protected file just as easily as a structured
      // call does (`cat .env`, `grep X .env`, ...), so the same patterns apply.
      const hit = commandTouches(String(command), root, pol.protected_paths || [], "protected");
      if (hit) {
        return finish(new Decision(
          "deny",
          `Command references a path matching protected pattern from ${hit.matched}.`,
          { matchedRule: hit.matched, toolName, details: { command, resolved_path: hit.resolved } }
        ));
      }

      // Same self-protection idea as below, for `rm .cursorignore` and friends.
      //
      // Split by intent, because denying every shell command that merely names
      // the directory would break `tail .agent-security/audit.log`, while
      // asking about all of them leaves a one-click bypass: an agent that
      // cannot Edit policy.yaml could just `rm` it.
      const infra = commandTouches(String(command), root, GUARDRAIL_INFRA_PATTERNS, "infra");
      if (infra) {
        const mutator = mutatingShellVerb(String(command), root);
        if (mutator) {
          return finish(new Decision(
            "deny",
            `Blocked: '${mutator}' would modify guardrail infrastructure ('${infra.matched}'). ` +
              DISABLE_HINT,
            { matchedRule: infra.matched, toolName, details: { command, mutator } }
          ));
        }
        // No mutation we can recognize — and our tokenizer is not a shell
        // parser, so we cannot call it read-only either. Ask, but only for the
        // paths where naming them at all is unusual (see INFRA_ASK_ON_MENTION).
        const mention = commandTouches(String(command), root, INFRA_ASK_ON_MENTION, "infra");
        if (mention) {
          return finish(new Decision(
            "ask",
            `Command references guardrail infrastructure ('${mention.matched}') and requires human approval.`,
            { matchedRule: mention.matched, toolName, details: { command } }
          ));
        }
      }
    }
  }

  // --- 3. guardrail self-protection for structured calls ---
  //
  // This is a `deny`, not an `ask`, and that is the whole point. An agent has
  // no legitimate reason to rewrite the rules binding it mid-session: every
  // such attempt is a mistake or an attack. Offering the choice as a prompt
  // put the one decision that matters most behind the click a distracted human
  // makes fastest — and the prize for getting that click is every guardrail
  // off at once.
  //
  // Denying costs nothing, because the legitimate path is better on every
  // axis: a human edits policy.yaml directly, or runs
  // `node .agent-security/toggle.js --disable` first. Both are deliberate,
  // both show up in `git status`, and neither can be obtained by wearing the
  // reviewer down.
  //
  // Reads all three path keys, including `filePath`. The Python engine checked
  // only file_path/path here while checking all three above, which let a
  // harness sending `filePath` edit .agent-security/** without an `ask` — a
  // G8 bypass. See Tasks/policy-engine-node-port/02-policy-engine-port.md.
  // Reads are exempt here on purpose — see READ_ONLY_TOOLS. Writes, deletes,
  // and any tool name we do not recognize are denied.
  const rawPath = READ_ONLY_TOOLS.has(toolName) ? null : firstPath(input);
  if (rawPath) {
    const resolved = resolvePath(String(rawPath), root);
    if (resolved !== null) {
      const matched = matchProtectedPath(resolved, root, GUARDRAIL_INFRA_PATTERNS);
      if (matched) {
        return finish(new Decision(
          "deny",
          `Blocked: changing guardrail infrastructure ('${matched}'). ${DISABLE_HINT}`,
          { matchedRule: matched, toolName }
        ));
      }
    }
  }

  return finish(new Decision("allow", "No policy rule matched.", { toolName }));
}

/** evaluate() with default-deny on anything unexpected. Adapters use this. */
function evaluateFromDict(toolName, toolInput, context) {
  try {
    return evaluate(toolName, toolInput, undefined, undefined, context);
  } catch (e) {
    const what = e instanceof PolicyError ? e.message : (e && e.message) || String(e);
    return new Decision("deny", `Policy engine error, defaulting to deny: ${what}`, {
      toolName,
    });
  }
}

module.exports = {
  evaluate,
  evaluateFromDict,
  Decision,
  loadPolicy,
  findWorkspaceRoot,
  KNOWN_IGNORE_FILES,
  GUARDRAIL_INFRA_PATTERNS,
  READ_ONLY_TOOLS,
  // exported for the test suite and for anyone auditing the matching rules
  _internals: {
    fnmatch,
    normalizeCommand,
    resolvePath,
    pathEscapesWorkspace,
    matchProtectedPath,
    matchAnyProtected,
    commandTouches,
    _gitignoreLineToPattern,
    timestamp,
  },
};
