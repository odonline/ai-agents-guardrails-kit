# Changelog

## Unreleased

- CI generado según el host git real: `detectGitHost()` lee el remote
  `origin` y elige `.github/workflows/security.yml` (GitHub) o
  `.gitlab-ci.yml` (GitLab, con un job Docker por stack) — antes siempre
  se generaba el workflow de GitHub, quedando muerto en proyectos GitLab.
  Override manual con `--ci github|gitlab|none`.
- Git hooks que se activan solos: si el target ya es un repo git, el
  instalador corre `git config core.hooksPath .husky` automáticamente —
  antes los hooks quedaban escritos pero inertes hasta que alguien
  corriera ese comando a mano (`git` no ejecuta nada de `.husky/` sin él).
- El resumen final de "próximos pasos" ahora es dinámico: solo muestra los
  pasos que aplican a esa instalación puntual, con etiqueta
  `[obligatorio]`/`[recomendado]`/`[opcional]`/`[listo]` según corresponda,
  en vez de una lista fija de 6 pasos sin distinguir cuáles son críticos.
- Nuevo `.agent-security/POST_INSTALL.md`: explica cada paso del resumen
  final en detalle (qué es, por qué existe, qué pasa si se lo saltea).
- Nuevo `.agent-security/SELF_TEST_PROMPT.md`: prompt listo para pegarle a
  un agente para que valide él mismo, con sus herramientas reales, que
  cada comando/ruta bloqueada efectivamente se deniega/pregunta y que el
  trabajo legítimo no se ve afectado — en vez de confiar en que la
  política hace lo que dice el `policy.yaml`.
- Nueva suite `test/install.test.js` (`npm test`) que prueba el instalador
  en sí — sin dependencias externas, corre en Windows — sumada al pipeline
  del propio kit.

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
