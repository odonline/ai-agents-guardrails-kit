# Contributing

## Agregar un nuevo stack (lenguaje)

Un bloque nuevo en `stacks.js`, nada más — `install.js` y `generate.js` lo
recogen automáticamente.

```js
ruby: {
  label: "Ruby (Bundler)",
  markers: ["Gemfile"],
  detect: (dir) => exists(dir, "Gemfile"),
  checks: [
    { name: "tests", command: "bundle exec rspec" },
    { name: "lint", command: "bundle exec rubocop" },
  ],
  changedExtensions: [".rb"],
  extraBlocked: [
    { pattern: "\\bgem\\s+push\\b", action: "ask", reason: "Publishing a gem requires approval." },
  ],
  ci: { setupAction: "ruby/setup-ruby@v1", withBlock: "ruby-version: '3.3'", install: "bundle install" },
  gitlabCi: { image: "ruby:3.3", install: "bundle install" },
},
```

`ci` es el setup step para GitHub Actions; `gitlabCi` es la imagen Docker
equivalente para GitLab CI (`generate.js` genera ambos formatos de CI a
partir del mismo stack — el instalador elige uno según el host git
detectado, ver `README.md`). No te olvides de sumar el nuevo stack a
`STACK_MARKERS` en `test/install.test.js` si querés que el smoke test lo
cubra.

Después:
```bash
node install.js --target /tmp/algún-proyecto-de-prueba --agents claude-code --stacks ruby --yes
node /tmp/algún-proyecto-de-prueba/.agent-security/test_policy_engine.js  # sanity check
```

## Agregar un nuevo agente/harness

1. Carpeta nueva en `templates/<agente>/` con su adapter (`pretooluse.js`)
   que traduzca el JSON de ese harness al formato que espera
   `policy_engine.evaluateFromDict()`, y su archivo de config de hooks. El
   adapter tiene que emitir una decisión bien formada y salir con 0 **en todos
   los caminos de error**, incluido no poder cargar el motor: un hook que se
   muere deja el comportamiento del harness indefinido.
2. Entrada nueva en el objeto `AGENTS` de `install.js`, y el `command` del
   config de hooks tiene que decir `node`, apuntando a un archivo que el
   instalador realmente copie (hay un test que lo verifica).
3. No toques `policy_engine.js` — esa lógica es compartida por diseño; el
   adapter es la única pieza que debe conocer el formato JSON específico
   del harness.
4. Entrada nueva en `HOOK_CONFIGS` de `templates/common/kit_manifest.js`. Ese
   array es lo que `toggle.js` renombra al desactivar y lo que `uninstall.js` lee
   para decir si el enforcement quedó enganchado. Un harness que no esté ahí no
   se puede apagar, y peor: el resumen del desinstalador va a decir que los
   guardrails quedaron desactivados cuando no es cierto.
5. Sumá el harness a `HARNESS_WIRING` en `test/install.test.js` — el ciclo
   disable→enable se testea por harness (G7).

## Dependencias vendorizadas

El kit no tiene dependencias instalables: `package.json` no declara
`dependencies` y hay un test que lo verifica. La única excepción es
**`js-yaml`**, que viaja vendorizado en `templates/common/vendor/js-yaml.js`
porque el motor de políticas necesita leer `policy.yaml` dentro del proyecto
destino — que puede ser un proyecto Java o PHP sin ningún flujo de npm.

Reglas:

- El archivo vendorizado es **byte-idéntico** al `dist/js-yaml.js` publicado en
  npm. No se le agrega header, no se le aplican parches, no se minifica.
- Su SHA-256 está registrado en `templates/common/vendor/VENDOR.md` y
  `npm test` lo verifica. Si editás el archivo, el pipeline falla — a propósito.
- Se vendoriza el bundle **sin minificar**: pesa 131 KB en vez de 43 KB y se
  puede leer. Es lo único que separa a un agente del filesystem del usuario;
  que sea auditable vale más que los 88 KB.
- Si hace falta un fix, va upstream y después se vendoriza la versión liberada.
  Una copia parcheada localmente no la puede verificar nadie, que es
  exactamente lo que se buscaba al vendorizar.

El procedimiento completo de actualización está en
`templates/common/vendor/VENDOR.md`. Agregar **cualquier otra** dependencia,
del lado del kit o del payload, necesita aprobación explícita — no es un detalle
de implementación.

## Cambiar reglas core (agnósticas al lenguaje)

Editar `CORE_BLOCKED_COMMANDS` / `CORE_PROTECTED_PATHS` en `generate.js`.
Corré `node docs.js` para regenerar `RULES.md` (documentación de todas las
reglas — CI falla si te olvidás de este paso) y los tests después:

```bash
node docs.js
node install.js --target /tmp/test --agents claude-code --stacks node --yes
node /tmp/test/.agent-security/test_policy_engine.js
```

## Tocar los git hooks generados o el encadenamiento

Dos trampas verificadas en este repo, las dos silenciosas:

- **`git rev-parse --git-path hooks` respeta `core.hooksPath`.** En un proyecto
  con el kit instalado devuelve `.husky`, así que un shim que lo use se llama a
  sí mismo. Usá `"$(git rev-parse --git-common-dir)/hooks"`, que es inmune y
  además resuelve bien en un worktree enlazado (ahí `--git-dir` apunta a
  `.git/worktrees/<name>`, que no es donde viven los hooks).
- **Los shims se generan desde template literals de JS.** Una expansión de shell
  con la forma `${...}` dentro de un backtick **no** llega al shell: JS la
  interpola primero. `${1+"$@"}` se evaluaba como `1 + "$@"` y el archivo quedaba
  con `1$@`. Toda expansión que tenga que llegar al shell va escapada
  (`\${...}`), y el test `chain shims forward arguments without mangling them`
  revisa el **texto emitido**, no el fuente. Si agregás sintaxis de shell nueva a
  un builder, testeá la salida.

Además: el contenido de `.husky/` se **commitea** en el proyecto destino, así que
nada de paths absolutos adentro de un shim, y todo path se chequea antes de
invocarse (otro dev puede no tener ese hook). `sh` POSIX, sin flags GNU de
`mktemp`, sin `[[ ]]` — corre en Git Bash también (G10).

Y la regla que ordena todo esto: **si no se pueden escribir los shims, no se
configura `core.hooksPath`.** Configurarlo igual apagaría hooks del proyecto sin
nada que los reemplace, que es el bug que el encadenamiento existe para arreglar.

## El kit nunca commitea (G17)

La historia del repo destino es del cliente. Nada del kit —ni `install.js`, ni el
desinstalador, ni el toggle, ni **nada que el kit genere**— puede correr
`git add`, `commit`, `push`, `checkout`, `reset`, `merge`, `rebase`, `stash`,
`tag` ni `branch`.

Lo único que el kit escribe en git es **una** pieza de config: `core.hooksPath`
(G12), que además registra en el manifest y revierte al desinstalar. Todo lo
demás que escribe queda **sin trackear**, para que el cliente lo revise y lo
commitee él.

El caso que se olvida: un hook generado que staggee o commitee por vos sería peor
que el instalador haciéndolo una vez — lo haría en cada commit, en el clone de
cada persona del equipo. Por eso hay un test que revisa el **contenido generado**
(`pre-commit`, `pre-push`, los dos formatos de CI) además de los sitios de
invocación.

Los tests no buscan texto: el fuente contiene `git push --force` y
`git commit --no-verify` legítimamente, como patrones de `blocked_commands` y como
fixtures. Buscan qué se le pasa a `execSync`/`execFileSync`/`spawnSync`, y hay
además un test end-to-end que instala sobre un repo con un commit y un working
tree sucio y verifica que `HEAD`, el index y los archivos sin commitear quedaron
igual.

Si necesitás una operación de git nueva, va a la lista `ALLOWED` de ese test — y
sólo después de decidir explícitamente que es segura.

## Tocar el manifest, el desinstalador o el toggle

`install.js` registra en `.agent-security/install-manifest.json` todo lo que
escribe y todo el estado que cambia afuera (`core.hooksPath`, líneas del
`.gitignore`). `uninstall.js` y `toggle.js` **sólo** actúan sobre lo que ese
registro dice que es nuestro y sigue intacto.

Dos reglas para no romperlo:

- **El hash se calcula normalizando fines de línea a LF**, en `install.js` y en
  `templates/common/kit_manifest.js`. Si las dos implementaciones se separan, en
  un checkout con CRLF todo archivo intacto parece modificado y el desinstalador
  no borra nada — falla silencioso y hacia el lado inútil. Hay un test que lo
  cubre; no lo saques.
- **Todo archivo nuevo que copie el instalador tiene que entrar al manifest.** Si
  lo agregás a `COMMON_FILES` o a `AGENTS`, eso pasa solo (`copyFile()`/
  `writeText()` alimentan el acumulador). Si lo escribís por fuera de esas dos
  funciones, registralo a mano o queda huérfano al desinstalar.

Y una que no es negociable: **no le agregues al motor ningún flag, sentinel file
ni `enabled: false` que lo haga permitir todo.** Desactivar se hace
desenganchando el harness, no desde adentro de la pieza que existe para fallar
cerrada. Hay un test que verifica que `policy_engine.js`, `policy_loader.js` y
`final_check.js` no conozcan esa idea.

Verificación mínima al cambiar cualquiera de los tres: `npm test` y un
round-trip real contra un directorio de scratch (nunca contra este repo).

```bash
node install.js --target /tmp/rt --agents claude-code --stacks node --git-hooks true --ci none --yes
```

```bash
node /tmp/rt/.agent-security/uninstall.js --yes
```

## Correr los tests después de tocar install.js / generate.js / stacks.js

`test/install.test.js` es la suite que valida el **instalador en sí**
(qué se escribe, para qué stack, según qué host git) — no confundir con
`templates/common/test_policy_engine.js`, que valida el motor de políticas
que queda instalado en el proyecto destino (y que `npm test` corre también,
como subproceso). Sin dependencias externas, corre igual en
Windows/macOS/Linux:

```bash
npm test
```

Corré esto después de cualquier cambio a `install.js`, `generate.js` o
`stacks.js` — está en el pipeline (`.gitlab-ci.yml`) así que un cambio que
lo rompa no debería mergearse. Si agregás un stack nuevo o un caso de
detección de host, sumá su caso ahí también.
