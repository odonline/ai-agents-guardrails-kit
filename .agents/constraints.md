# Architecture Constraints (Never-Break Rules)

These constraints must NEVER be violated during implementation. 

---


## 1. Ignored File Boundaries for AI/Agents

- Before reading or changing files, agents MUST check `.aiignore`, `.claudeignore`, `.cursorignore`, and `.gitignore`.
- Agents MUST NOT read, quote, summarize, or modify files matched by those ignore files unless the user explicitly authorizes that exact path for the current task.
- If a task appears to require an ignored file, stop and ask for explicit permission before accessing it.

---


