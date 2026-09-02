# Changelog

## Unreleased

### Ahora se puede apagar y sacar (`--disable` / `--enable` / `--uninstall`)

Instalar guardrails en un proyecto ajeno es invasivo: toca `.agent-security/`, la
config del harness, `.husky/`, el CI, tres archivos de contrato en la raíz, el
`.gitignore` y `git config core.hooksPath`. Hasta ahora el instalador sabía
entrar y no sabía salir, lo que en la práctica hacía que probarlo fuera
irreversible.

- **`.agent-security/install-manifest.json`**: el instalador registra qué
  escribió (path + hash + `written`/`skipped`), los `.new` que dejó, los
  directorios que creó, el `core.hooksPath` previo y el nuevo, y exactamente qué
  líneas le agregó al `.gitignore`. Sin ese registro, desinstalar sólo puede
  adivinar. Es el único archivo del kit que se **sobrescribe** al reinstalar en
  vez de escribirse como `.new` — es un artefacto derivado, no contenido tuyo, y
  la excepción está comentada en el código.
- **`.agent-security/uninstall.js`**: borrado guiado por el manifest. Muestra el
  plan (qué borra, qué conserva y por qué, qué pasa con `core.hooksPath` y el
  `.gitignore`) y pide confirmación. `--dry-run` termina en el plan; `--yes`
  saltea la pregunta. Restaura el `core.hooksPath` previo en vez de sólo
  desetearlo, borra los directorios que creó **sólo si quedaron vacíos**, y se
  borra a sí mismo y al manifest al final.
- **`.agent-security/toggle.js --disable|--enable`**: apaga el enforcement sin
  borrar nada. `policy.yaml`, los adapters y `.husky/` quedan donde están; lo que
  cambia es que el harness deja de llamarlos. Un ciclo disable→enable devuelve la
  config byte a byte.
- Los tres se llegan también desde `install.js --uninstall|--disable|--enable
  --target <dir>`, que **delega** en el script instalado en vez de reimplementar
  la lógica. Los scripts viven en el proyecto destino a propósito: `bootstrap.sh`
  borra su propio clone, así que un desinstalador kit-side sería inalcanzable
  justo para quien instaló por la vía recomendada.

**La regla, en una línea: saca lo que puso el instalador, nunca lo que vos
editaste.** Un archivo se borra sólo si el manifest lo registró y su contenido
sigue coincidiendo (con fines de línea normalizados, o en un checkout CRLF no se
borraría nada). Un `policy.yaml` ajustado o un `settings.json` mergeado a mano se
conserva y se reporta. Consecuencia asumida: una desinstalación puede terminar
**incompleta a propósito** — y el resumen lo dice en una línea imposible de
perderse, nombrando el archivo que quedó enganchado y aclarando que los adapters
van a responder `deny`, o sea que va a denegar todo en vez de permitir todo.

**Desactivar es desenganchar, no un flag.** No hay ningún `enabled: false` que
lea el motor: eso sería agregarle un camino cuyo trabajo es devolver `allow` para
todo, adentro de la única pieza que existe para fallar cerrada, y un solo archivo
que un agente podría intentar crear para liberarse solo. `--disable` renombra la
config de hooks de cada harness (`settings.json` → `settings.json.disabled`) y
devuelve `core.hooksPath` a su valor previo. Es subtractivo y aparece en
`git status`. (El `"enabled"` que ya existe en el `hooks.json` de Antigravity sí
es aceptable: lo lee el *harness*, no el motor.)

Dos bugs que aparecieron al correr esto de verdad, no al leerlo:

- El manifest sobrevivía a todo desinstall (está excluido de sus propios
  `files[]`, así que nada lo borraba) — el único resto que quedaba, en el paso que
  existe para no dejar restos.
- Sacar nuestras tres líneas de un `.gitignore` que el instalador había **creado**
  lo dejaba existiendo y vacío. Ahora el manifest registra si el archivo es
  nuestro, y se borra sólo si lo creamos nosotros y quedó vacío; un `.gitignore`
  vacío que el proyecto ya tenía se conserva.

`test/install.test.js` pasa de 55 a 87 casos, incluidos round-trip
instalar→desinstalar contra un snapshot previo a la instalación, ciclo
disable→enable por harness (los tres), y un test que verifica que ni
`policy_engine.js`, ni `policy_loader.js`, ni `final_check.js` leen un flag de
desactivación.

### El motor de políticas ahora corre en Node, no en Python

Cambio de fondo para cualquiera que instale el kit: **el payload no instala
nada.** Antes exigía `pip install pyyaml pytest` y, en la práctica, pelearse con
entornos de pip (venv sí o no, `--break-system-packages`, `python -m pytest` vs
`pytest` pelado). Ahora sólo hace falta `node` (>= 16) en el `PATH`.

- `policy_engine.py`, `final_check.py`, `test_policy_engine.py` y los tres
  adapters `pretooluse.py` fueron portados a `.js`. Los tres configs de hooks
  invocan `node`.
- `js-yaml` viaja **vendorizado** en `.agent-security/vendor/`: un archivo
  autocontenido, sin minificar (para que se pueda leer), byte-idéntico al
  publicado en npm y verificado por SHA-256 en CI. Ningún proyecto destino
  corre `npm install` para tener guardrails.
- `policy.yaml` **no cambia de formato**. Sigue siendo el mismo archivo,
  comentado y editable a mano.
- Paridad verificada de tres formas: los 24 casos de la suite original portados
  uno a uno con el mismo nombre; un test diferencial de 54 entradas contra el
  motor Python (53 idénticas, 1 divergencia intencional); y una instalación real
  end-to-end por stack.

#### Dos correcciones de seguridad que salieron del port

- **Bypass de la auto-protección por la clave `filePath`.** El motor Python leía
  `file_path`/`path`/`filePath` al chequear rutas protegidas, pero sólo
  `file_path`/`path` al chequear su propia infraestructura. En un harness que
  nombre el campo en camelCase, un agente podía **reescribir `policy.yaml`,
  borrar un archivo de ignore o editar la config de hooks sin ningún prompt**.
  Medido contra el motor Python: devolvía `allow` en los tres casos. El motor
  Node lee las tres claves en los dos lugares.
- **Los adapters ahora fallan cerrado también cuando falta el motor.** Los
  Python importaban el motor a nivel de módulo: si no estaba, el hook moría con
  traceback, stdout vacío y exit ≠ 0 — o sea el harness no recibía ninguna
  decisión. Los Node emiten un `deny` bien formado. Es justo el estado en que
  queda una instalación borrada a medias.

#### Otras correcciones

- Una política que el motor no entiende del todo ahora **falla al cargar** en vez
  de degradar en silencio: un patrón que no compila o un `action` inválido son
  error, no una regla que deja de aplicar sin avisar. El motor Python salteaba
  esas entradas bajo un comentario que afirmaba lo contrario.
- El completion gate reporta `blocked` con un JSON válido cuando no puede leer
  `policy.yaml`, en vez de morir con traceback.
- Los jobs de CI generados usan un entorno Node (`setup-node@v4` / `node:20`) en
  vez de uno Python. Antes el comando ya era `node` pero el job seguía
  levantando Python, así que el primer pipeline real de un proyecto instalado
  habría fallado.

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
