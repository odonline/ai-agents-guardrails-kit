# Coding Rules & Standards

## Memory
You have access to Engram persistent memory via MCP tools (mem_save, mem_search, mem_session_summary, etc.).
- Save proactively after significant work — don't wait to be asked.
- After any compaction or context reset, call `mem_context` to recover session state before continuing.

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Bash Scripts | `shCamelCase.bash` | `shDumpCsv.bash` |

---


## Bash Scripting Best Practices

1. Temporary variables should be localized where possible in loops.
2. Temporary table names (`_table_name`) must mirror the unique characteristics of the executing path to avoid overwriting ongoing parallel processes.
3. Clean up the `tmp` and `import` folders safely using string matching (e.g., `find -type f -mtime +2 -delete`), avoiding open wildcard deletions (`rm -rf *`).

---
