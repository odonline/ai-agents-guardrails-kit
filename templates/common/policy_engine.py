#!/usr/bin/env python3
"""
policy_engine.py — Common policy engine used by every agent adapter
(Claude Code, VS Code/Codex, Antigravity) and by Git hooks / CI.

Design goals (see .agent-security/README.md):
  - Single source of truth: policy.yaml
  - Default-deny when input can't be parsed or a path can't be resolved
  - No naive substring matching: commands are normalized and matched with
    word-boundary regexes; paths are resolved to absolute, symlink-checked
    paths before being compared to the workspace root.
  - Every decision is written to an audit log.

This module exposes a single function, `evaluate()`, that every adapter
(claude-code, vscode-codex, antigravity) calls. Keep harness-specific
JSON parsing/printing OUT of this file — that belongs in the adapters.
"""
from __future__ import annotations

import json
import os
import re
import time
import fnmatch
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

try:
    import yaml  # PyYAML
except ImportError:  # pragma: no cover
    raise SystemExit(
        "PyYAML is required. Install with: pip install pyyaml --break-system-packages"
    )

REPO_ROOT_ENV = "GUARDRAILS_WORKSPACE_ROOT"
POLICY_FILENAME = "policy.yaml"
AUDIT_LOG_NAME = "audit.log"

# Non-standard "ignore for agents" files various tools already look for.
# There's no shared spec across vendors, so this is a best-effort, growing
# list — add to it as new tools adopt the convention. We read these LIVE on
# every evaluation (not baked into policy.yaml at install time) so editing
# one of these files takes effect immediately without re-running the
# installer.
KNOWN_IGNORE_FILES = [
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
]

# Guardrail's own infrastructure: an agent editing OR shell-deleting any of
# these should always require human approval, or the guardrails become
# trivial to disable from inside the same session that's bound by them.
GUARDRAIL_INFRA_PATTERNS = [
    ".agent-security/**", ".claude/settings*.json", ".claude/hooks/**",
    ".agents/hooks.json", ".github/hooks/**", ".husky/**",
    ".github/workflows/**",
] + KNOWN_IGNORE_FILES


@dataclass
class Decision:
    action: str  # "allow" | "deny" | "ask"
    reason: str
    matched_rule: Optional[str] = None
    tool_name: str = ""
    details: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "action": self.action,
            "reason": self.reason,
            "matched_rule": self.matched_rule,
            "tool_name": self.tool_name,
            "details": self.details,
        }


def _find_workspace_root(start: Path) -> Path:
    """Walk up from `start` looking for .agent-security/, fall back to cwd env var."""
    if os.environ.get(REPO_ROOT_ENV):
        return Path(os.environ[REPO_ROOT_ENV]).resolve()
    cur = start.resolve()
    for _ in range(20):
        if (cur / ".agent-security").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return start.resolve()


def load_policy(policy_path: Optional[Path] = None) -> dict:
    if policy_path is None:
        here = Path(__file__).resolve().parent
        policy_path = here / POLICY_FILENAME
    if not policy_path.exists():
        raise FileNotFoundError(f"policy.yaml not found at {policy_path}")
    with open(policy_path, "r", encoding="utf-8") as f:
        policy = yaml.safe_load(f) or {}
    policy.setdefault("blocked_commands", [])
    policy.setdefault("protected_paths", [])
    policy.setdefault("sensitive_tools", [])
    policy.setdefault("approval_required", [])
    return policy


def _normalize_command(cmd: str) -> str:
    """Collapse whitespace, strip common obfuscation wrappers so regexes
    can't be trivially dodged with extra spaces/quotes."""
    cmd = cmd.strip()
    cmd = re.sub(r"\s+", " ", cmd)
    # Unwrap simple `sh -c "..."` / `bash -c '...'` wrappers one level deep.
    m = re.match(r"^(?:/usr/bin/)?(?:sh|bash|zsh)\s+-c\s+['\"](.*)['\"]$", cmd)
    if m:
        cmd = m.group(1)
    return cmd


def _resolve_path(raw_path: str, workspace_root: Path) -> Optional[Path]:
    """Resolve a path (possibly relative, possibly containing ~) to an
    absolute, symlink-resolved path. Returns None if resolution fails."""
    try:
        expanded = os.path.expanduser(raw_path)
        p = Path(expanded)
        if not p.is_absolute():
            p = workspace_root / p
        resolved = p.resolve(strict=False)
        return resolved
    except Exception:
        return None


def _path_escapes_workspace(resolved: Path, workspace_root: Path) -> bool:
    try:
        resolved.relative_to(workspace_root)
        return False
    except ValueError:
        return True


def _match_protected_path(resolved: Path, workspace_root: Path, patterns: list[str]) -> Optional[str]:
    home = Path.home()
    for pattern in patterns:
        expanded_pattern = os.path.expanduser(pattern)
        if expanded_pattern.startswith("~"):
            expanded_pattern = str(home / expanded_pattern[2:])
        # Try match against absolute resolved path and against workspace-relative path.
        candidates = [str(resolved)]
        try:
            candidates.append(str(resolved.relative_to(workspace_root)))
        except ValueError:
            pass
        for cand in candidates:
            if fnmatch.fnmatch(cand, expanded_pattern) or fnmatch.fnmatch(
                cand, "*/" + expanded_pattern
            ):
                return pattern
    return None


def _gitignore_line_to_fnmatch(line: str) -> Optional[str]:
    """Best-effort conversion of one gitignore-style line to an fnmatch
    pattern. This does NOT implement full gitignore semantics (no
    directory-scoped negation resolution, no precedence between rules) —
    it's intentionally conservative because this feeds a security control:
    when in doubt, a line should make MORE things protected, never fewer.
    """
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    if line.startswith("!"):
        # A negation would "un-protect" a path. Honoring that would let a
        # repo's own ignore file quietly weaken this control, so we skip
        # negations entirely rather than implement include/exclude
        # precedence. The file is still protected from being deleted or
        # rewritten by the guardrail-infra self-protection check below.
        return None
    pattern = line
    is_dir_only = pattern.endswith("/")
    if is_dir_only:
        pattern = pattern.rstrip("/")
    anchored = pattern.startswith("/")
    pattern = pattern.lstrip("/")
    if not anchored and "/" not in pattern:
        # Bare filename/glob with no slash: gitignore matches it at any
        # depth, so do the same.
        pattern = f"**/{pattern}"
    if is_dir_only:
        pattern = f"{pattern}/**"
    return pattern


_ignore_file_cache: dict[Path, tuple[float, list[tuple[str, str]]]] = {}


def _load_ignore_file_patterns(workspace_root: Path) -> list[tuple[str, str]]:
    """Returns [(fnmatch_pattern, source_filename), ...] for every known
    agent-ignore file present at the workspace root. Cached per-process,
    invalidated by mtime, so repeated hook invocations stay cheap."""
    cache_key = workspace_root
    newest_mtime = 0.0
    present_files = []
    for name in KNOWN_IGNORE_FILES:
        p = workspace_root / name
        if p.is_file():
            try:
                mtime = p.stat().st_mtime
            except OSError:
                continue
            present_files.append((p, name))
            newest_mtime = max(newest_mtime, mtime)

    cached = _ignore_file_cache.get(cache_key)
    if cached and cached[0] == newest_mtime:
        return cached[1]

    results: list[tuple[str, str]] = []
    for path, name in present_files:
        try:
            for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
                pattern = _gitignore_line_to_fnmatch(line)
                if pattern:
                    results.append((pattern, name))
        except OSError:
            continue
    _ignore_file_cache[cache_key] = (newest_mtime, results)
    return results


def _match_any_protected(
    resolved: Path, workspace_root: Path, policy_patterns: list[str]
) -> Optional[str]:
    """Checks policy.yaml's protected_paths AND every known agent-ignore
    file present in the repo, live. Returns a human-readable reason for
    whichever matched first."""
    matched = _match_protected_path(resolved, workspace_root, policy_patterns)
    if matched:
        return f"policy.yaml pattern '{matched}'"
    for pattern, source in _load_ignore_file_patterns(workspace_root):
        if _match_protected_path(resolved, workspace_root, [pattern]):
            return f"'{source}' pattern '{pattern}'"
    return None


def _match_blocked_command(command: str, rules: list[dict]) -> Optional[dict]:
    normalized = _normalize_command(command)
    for rule in rules:
        pattern = rule.get("pattern")
        if not pattern:
            continue
        try:
            if re.search(pattern, normalized, flags=re.IGNORECASE):
                return rule
        except re.error:
            # A broken regex in policy.yaml must never silently allow traffic.
            continue
    return None


_SHELL_METACHARS = re.compile(r'[|&;()<>]')
_QUOTED_OR_WORD = re.compile(r"""'[^']*'|"[^"]*"|\S+""")


def _command_touches_patterns(
    command: str, workspace_root: Path, patterns: list[str]
) -> Optional[tuple[Path, str]]:
    """Low-level tokenizer shared by the protected-path and guardrail-infra
    shell scans. See _command_touches_protected_path for caveats."""
    normalized = _normalize_command(command)
    for clause in _SHELL_METACHARS.split(normalized):
        for raw_token in _QUOTED_OR_WORD.findall(clause):
            token = raw_token.strip("'\"")
            if not token or token.startswith("-"):
                continue
            if "/" not in token and "." not in token and not token.startswith("~"):
                continue
            resolved = _resolve_path(token, workspace_root)
            if resolved is None:
                continue
            matched = _match_protected_path(resolved, workspace_root, patterns)
            if matched:
                return resolved, matched
    return None


def _command_touches_protected_path(
    command: str, workspace_root: Path, patterns: list[str]
) -> Optional[tuple[Path, str]]:
    """Best-effort scan: tokenize the command and check every token that
    looks like a path against protected_paths (policy.yaml AND any known
    agent-ignore file present in the repo), reusing the same resolution
    logic as structured file-tool calls. This is NOT a full shell parser —
    it exists to catch the common case (`cat .env`, `grep X .env`, a Python
    one-liner naming the file literally), not to guarantee no evasion is
    possible. See .agent-security/README.md for what this does and doesn't
    cover."""
    normalized = _normalize_command(command)
    for clause in _SHELL_METACHARS.split(normalized):
        for raw_token in _QUOTED_OR_WORD.findall(clause):
            token = raw_token.strip("'\"")
            if not token or token.startswith("-"):
                continue
            if "/" not in token and "." not in token and not token.startswith("~"):
                continue
            resolved = _resolve_path(token, workspace_root)
            if resolved is None:
                continue
            matched = _match_any_protected(resolved, workspace_root, patterns)
            if matched:
                return resolved, matched
    return None


def evaluate(
    tool_name: str,
    tool_input: dict[str, Any],
    workspace_root: Optional[Path] = None,
    policy: Optional[dict] = None,
) -> Decision:
    """Core evaluation entrypoint. Adapters call this and translate the
    Decision into their harness-specific JSON."""
    if workspace_root is None:
        workspace_root = _find_workspace_root(Path.cwd())
    if policy is None:
        policy = load_policy()

    file_tools = {"Write", "Edit", "create_file", "write_to_file", "replace_file_content",
                  "multi_replace_file_content", "str_replace", "replace_string_in_file"}
    shell_tools = {"Bash", "run_command", "runTerminalCommand", "execute_command", "shell"}

    decision: Decision

    # --- Path-based checks (file read/write tools) ---
    if tool_name in file_tools or "path" in tool_input or "file_path" in tool_input:
        raw_path = tool_input.get("file_path") or tool_input.get("path") or tool_input.get("filePath")
        if raw_path:
            resolved = _resolve_path(str(raw_path), workspace_root)
            if resolved is None:
                decision = Decision("deny", "Path could not be resolved safely.", tool_name=tool_name)
                _audit(decision, workspace_root)
                return decision
            if _path_escapes_workspace(resolved, workspace_root):
                decision = Decision(
                    "deny",
                    f"Path '{raw_path}' resolves outside the workspace root.",
                    tool_name=tool_name,
                    details={"resolved_path": str(resolved)},
                )
                _audit(decision, workspace_root)
                return decision
            matched = _match_any_protected(resolved, workspace_root, policy["protected_paths"])
            if matched:
                decision = Decision(
                    "deny",
                    f"Path matches protected pattern from {matched}.",
                    matched_rule=matched,
                    tool_name=tool_name,
                    details={"resolved_path": str(resolved)},
                )
                _audit(decision, workspace_root)
                return decision

    # --- Command-based checks (shell tools) ---
    if tool_name in shell_tools or "command" in tool_input:
        command = tool_input.get("command") or tool_input.get("cmd") or ""
        if command:
            rule = _match_blocked_command(str(command), policy["blocked_commands"])
            if rule:
                action = rule.get("action", "deny")
                decision = Decision(
                    action,
                    rule.get("reason", "Blocked by policy."),
                    matched_rule=rule.get("pattern"),
                    tool_name=tool_name,
                    details={"command": command},
                )
                _audit(decision, workspace_root)
                return decision

            # A shell command can reach a protected file just as easily as
            # a structured Read/Write call (`cat .env`, `grep X .env`,
            # `python3 -c "open('.env').read()"`...). Scan command tokens
            # for anything that resolves onto a protected_paths pattern.
            matched_path = _command_touches_protected_path(
                str(command), workspace_root, policy["protected_paths"]
            )
            if matched_path:
                decision = Decision(
                    "deny",
                    f"Command references a path matching protected pattern from {matched_path[1]}.",
                    matched_rule=matched_path[1],
                    tool_name=tool_name,
                    details={"command": command, "resolved_path": str(matched_path[0])},
                )
                _audit(decision, workspace_root)
                return decision

            # Same idea as the structured-tool self-protection check below,
            # but for shell commands (`rm .cursorignore`, `rm -f
            # .agent-security/policy.yaml`, ...).
            infra_hit = _command_touches_patterns(str(command), workspace_root, GUARDRAIL_INFRA_PATTERNS)
            if infra_hit:
                decision = Decision(
                    "ask",
                    f"Command references guardrail infrastructure ('{infra_hit[1]}') and requires human approval.",
                    matched_rule=infra_hit[1],
                    tool_name=tool_name,
                    details={"command": command},
                )
                _audit(decision, workspace_root)
                return decision

    # --- Guardrail self-protection: never allow silent edits to the
    #     policy engine or hook config without an explicit "ask". This also
    #     covers the agent-ignore files themselves — otherwise an agent
    #     could just delete/empty .cursorignore to remove its own limits.
    raw_path = tool_input.get("file_path") or tool_input.get("path")
    if raw_path:
        resolved = _resolve_path(str(raw_path), workspace_root)
        if resolved is not None:
            matched = _match_protected_path(resolved, workspace_root, GUARDRAIL_INFRA_PATTERNS)
            if matched:
                decision = Decision(
                    "ask",
                    f"Change to guardrail infrastructure ('{matched}') requires human approval.",
                    matched_rule=matched,
                    tool_name=tool_name,
                )
                _audit(decision, workspace_root)
                return decision

    decision = Decision("allow", "No policy rule matched.", tool_name=tool_name)
    _audit(decision, workspace_root)
    return decision


def _audit(decision: Decision, workspace_root: Path) -> None:
    audit_dir = workspace_root / ".agent-security"
    try:
        audit_dir.mkdir(parents=True, exist_ok=True)
        record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **decision.to_dict()}
        with open(audit_dir / AUDIT_LOG_NAME, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        # Auditing must never crash the hook and must never cause a
        # fail-open allow — the caller already has its decision.
        pass


def evaluate_from_dict(tool_name: str, tool_input: dict) -> Decision:
    """Convenience wrapper with default-deny on any unexpected exception."""
    try:
        return evaluate(tool_name, tool_input)
    except Exception as e:  # noqa: BLE001
        return Decision("deny", f"Policy engine error, defaulting to deny: {e}", tool_name=tool_name)
