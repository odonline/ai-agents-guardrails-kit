## Token Efficiency Rules

### Response Style
- Don't repeat back what I asked you to do.
- Don't explain standard operations (file reads, grep, running tests).
- DO explain non-obvious decisions, tradeoffs, or assumptions.
- Keep summaries to one line after changes unless the change was complex.
- NEVER narrate between tool calls. No "Let me check...",
  "Now let me...", "Looking back at...", "I'll now...".
  Just call the tool silently.
- Don't think out loud. Don't describe your reasoning process
  step-by-step. Just do the work and report results.
- If you need to call multiple tools in sequence,
  call them without commentary between each one.

### File Operations
- Before opening or editing a path, check `.aiignore`, `.claudeignore`, `.cursorignore`, and `.gitignore`.
- Do not read, quote, summarize, or edit files matched by those ignore files unless the user explicitly authorizes that exact path in the current task.
- `.dist` files and files under `dist/` are not automatically restricted; they may be changed when the task requires it.
- Prefer Edit over Write for existing files. Only use Write for new files.
- Make targeted, surgical edits. Don't replace large blocks for small changes.
- Read specific line ranges instead of whole files when you know exactly
  what you need — but read the full file when you need surrounding context
  for correct edits.

### Command Output
- Pipe verbose test output through `tail -50` or `grep -A 5 "FAIL"`
  when you expect a single failure. For multi-failure runs, increase the
  line count or use `grep -B 2 -A 5 "FAIL\|ERROR"` to catch all failures.
- For builds: redirect to file, only show output on failure.
- Never `cat` large files - use `head`, `tail`, or line ranges.
- When running linters/formatters, pipe through `head -30`.

### Agent Usage
- Don't spawn sub-agents for simple tasks. Do it directly.

### General
- Don't re-read files already in context.
- Use .claudeignore to exclude generated files, build artifacts, lock files.
- Don't think out loud. Don't describe your reasoning process step-by-step. Just do the work and report results.
