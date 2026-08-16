# Changelog

## v1.0.0

- Motor de políticas compartido (`policy_engine.py`): protected paths con
  resolución de symlinks/escape de workspace, blocked commands por regex,
  default-deny, audit log.
- Adapters para Claude Code, VS Code/Codex, Antigravity.
- Completion gate basado en evidencia (`final_check.py`).
- Detección automática de stack (Node, PHP, Java Maven/Gradle, Python) con
  generación de `policy.yaml` / git hooks / CI ajustada a cada uno.
- Instalador vía `curl | bash` (`bootstrap.sh`, agnóstico al host git) y
  vía `npx`.

  
- El motor lee, en vivo, los archivos no estándar `.cursorignore`,
  `.agentsignore`, `.aiignore`, `.aiderignore`, `.clineignore`,
  `.windsurfignore`, `.continueignore`, `.copilotignore`, `.codeiumignore`,
  `.geminiignore` si existen en el repo, y los trata como `protected_paths`
  adicionales (lectura Y escritura bloqueadas). Los propios archivos de
  ignore quedan auto-protegidos contra edición/borrado.
- Cerrado un gap: comandos de shell (`cat .env`, `grep X .env`, `rm
  .cursorignore`) ahora se chequean contra protected_paths e infra
  protegida, no solo las tool calls estructuradas de lectura/escritura.
