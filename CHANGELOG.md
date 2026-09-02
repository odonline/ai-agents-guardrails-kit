# Changelog

## Unreleased

### El kit nunca commitea, y ahora está garantizado por tests (G17)

La historia del repo destino es del cliente. Esto **ya era cierto** —ninguna
versión del kit corrió nunca `git add`, `commit` o `push`— pero no había nada que
lo impidiera a futuro. Ahora sí:

- Un test inspecciona los **sitios de invocación** (qué se le pasa a
  `execSync`/`execFileSync`/`spawnSync`) en el instalador, el generador, el
  desinstalador, el toggle, el motor y los tres adapters. No busca texto: el
  fuente contiene `git push --force` y `git commit --no-verify` legítimamente,
  como patrones de `blocked_commands` y como fixtures de test.
- Otro revisa el **contenido generado** — `pre-commit`, `pre-push` y los dos
  formatos de CI. Un hook que staggeara por vos sería peor que el instalador
  haciéndolo una vez: lo haría en cada commit, en el clone de todo el equipo.
- Y uno end-to-end instala sobre un repo con un commit y un working tree sucio,
  y verifica que `HEAD`, el index y los archivos sin commitear quedaron igual, y
  que lo que el kit escribió quedó **sin trackear**.
- Los tres se verificaron por mutación: se les inyectaron seis formas distintas
  de violación (inline, forma de array, template literal con interpolación, un
  verbo desconocido, y un `git add` dentro de un hook generado) y las detectaron
  todas, sin falsos positivos sobre la config legítima ni sobre la prosa.

Lo único que el kit escribe en git sigue siendo `core.hooksPath`, registrado en
el manifest y revertido al desinstalar o desactivar.


### El instalador ya no le roba los git hooks al proyecto

Bug real del instalador, no sólo del desinstalador. `install.js` corría
`git config core.hooksPath .husky` sin leer qué había antes, y —verificado, no
asumido— apuntar `core.hooksPath` a `.husky` **no** hace que `.husky` gane sobre
el directorio anterior: hace que git deje de mirarlo por completo.

Cualquier proyecto con hooks propios los perdía en silencio al instalar: los de
`.githooks/` con su `core.hooksPath` puesto, y los de `.git/hooks/` — donde los
deja el `pre-commit` de Python, husky v4, lefthook o algún IDE. Peor: como el kit
sólo genera `pre-commit` y `pre-push`, un `commit-msg` o un `post-merge` que
hubiera no tenía ni reemplazo.

Ahora el instalador **encadena**. Para cada hook del directorio que estaba
efectivo antes (ignorando los `*.sample`, que git nunca ejecuta) escribe en
`.husky/` un shim que corre el tuyo primero y propaga su exit code: si el tuyo
falla, la operación se corta ahí y el nuestro no corre. En `pre-commit` y
`pre-push` el bloque va arriba del hook generado; para cualquier otro tipo el
archivo es un passthrough sin checks propios. `pre-push` recibe los refs por
stdin, así que ese shim los buferea y se los pasa a los dos hooks — sin eso, el
primero que lee se los consume al otro.

Cuando encadenar no se puede hacer con seguridad —`core.hooksPath` anterior
absoluto o afuera del repo, directorio ilegible, o un `.husky/<hook>` que no
escribimos— el instalador **no toca `core.hooksPath`**, explica qué encontró y da
el comando exacto por si querés seguir igual. Los guardrails quedan inactivos y
dicho, en vez de activos habiendo apagado una salvaguarda tuya.

- `--no-chain-hooks` instala sin encadenar (el comportamiento anterior).
- El manifest registra `git.chainedFrom` y `git.shims[]`, así que `--uninstall`
  borra los shims y devuelve `core.hooksPath` a su valor previo.
- El bloque lleva el marcador `>>> guardrails-kit: chained hook >>>` y un
  comentario que explica qué es y cómo sacarlo: alguien lo va a encontrar en un
  `git diff` sin contexto.

Tres bugs que sólo aparecieron ejecutando esto, no leyéndolo:

- **`${1+"$@"}` dentro de un template literal de JS es una interpolación de JS.**
  Evaluaba `1 + "$@"` y el shim quedaba con `1$@`, así que el hook del proyecto
  recibía `1origin` como primer argumento. Se escapó, y hay un test que revisa el
  texto emitido, no el fuente.
- **`git rev-parse --git-path hooks` respeta `core.hooksPath`.** En un repo con el
  kit instalado devuelve `.husky`, o sea que el shim se habría llamado a sí mismo
  en loop. Lo correcto es `--git-common-dir`, que además resuelve bien en un
  worktree enlazado.
- **Reinstalar envenenaba el manifest.** `core.hooksPath` ya era `.husky` —
  nuestro—, y se registraba como "el valor previo a restaurar", así que
  `--uninstall` habría dejado a git apuntando a un `.husky/` recién borrado.
  Ahora se hereda el valor real del manifest anterior.

`test/install.test.js` pasa de 87 a 102 casos, con verificación funcional bajo
git de verdad: el `pre-commit` del proyecto sigue corriendo, un `commit-msg`
también, `pre-push` recibe los refs completos, y un hook del proyecto que falla
aborta el commit.

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
