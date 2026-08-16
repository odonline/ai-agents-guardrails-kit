# CLAUDE.md

See `AGENTS.md` for the full operating contract — it applies to Claude Code
as well. This file exists only for tools that specifically look for
`CLAUDE.md`.

Claude-specific notes:
- Hooks live in `.claude/settings.json` → `.claude/hooks/pretooluse.py`.
- Do not request `--dangerously-skip-permissions` / bypass modes for normal
  work in this repository.
