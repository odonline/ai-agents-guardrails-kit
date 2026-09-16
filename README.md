# ai-agents-guardrails-kit

Instalador de guardrails para agentes de código (Claude Code, VS Code/Codex,
Antigravity): un motor de políticas único, auditado, con detección
automática del stack del proyecto (Node, PHP, Java, Python...).

## Quickstart

El instalador es agnóstico al host git (`bootstrap.sh` usa `git clone`, no
una URL de API específica de un proveedor). Los ejemplos de abajo asumen
que ya hosteaste este repo en algún lado — ver
["Si forkeás/hosteás esto en otro lugar"](#si-forkeásosteás-esto-en-otro-lugar).

```bash
# GitHub — recomendado (funciona igual en bash, zsh, y Git Bash de Windows)
bash -c "$(curl -fsSL https://raw.githubusercontent.com/TU-ORG/ai-agents-guardrails-kit/main/bootstrap.sh)"
npx --package=github:TU-ORG/ai-agents-guardrails-kit install-guardrails

# GitLab (gitlab.com o self-hosted) — recomendado
bash -c "$(curl -fsSL https://gitlab.com/TU-ORG/ai-agents-guardrails-kit/-/raw/main/bootstrap.sh)"
npx --package=git+https://gitlab.com/TU-ORG/ai-agents-guardrails-kit.git install-guardrails

# Cualquier otro host git (Bitbucket, self-hosted genérico...)
GUARDRAILS_REPO_URL=https://tu-host.com/TU-ORG/ai-agents-guardrails-kit.git \
  bash -c "$(curl -fsSL https://tu-host.com/.../bootstrap.sh)"
```

> **¿Por qué `bash -c "$(curl ...)"` y no `curl ... | bash`?** El instalador
> pregunta interactivamente (qué stack, qué agente). Con un pipe simple,
> `stdin` queda ocupado por el propio script que viaja por el pipe, así
> que el instalador reabre la terminal real (`/dev/tty` / `CONIN$` en
> Windows) para poder preguntar — pero eso puede fallar en entornos sin
> terminal controladora (algunos contenedores/CI). La forma con
> `bash -c "$(curl ...)"` evita el problema de raíz: el contenido de
> `curl` se pasa como argumento, no por stdin, así que la terminal queda
> libre desde el principio. El pipe simple (`curl ... | bash`) también
> funciona en la gran mayoría de terminales, pero se recomienda la otra
> forma si vas a documentarlo para otros developers.

Todos corren interactivamente: detectan el stack del proyecto, preguntan
para qué agente(s) instalar, y opcionalmente agregan git hooks + un
workflow de CI de referencia — GitHub Actions o GitLab CI, autodetectado
del remote `origin` del repo (o forzado con `--ci github|gitlab|none`).
Para saltar los prompts (CI, scripting):

```bash
curl -fsSL .../bootstrap.sh | bash -s -- --agents claude-code --stacks node --ci github --yes
```

Cuando instala los git hooks, si el directorio ya es un repo git el
instalador configura `core.hooksPath` solo — sin esto, `git` nunca llega a
ejecutar los hooks generados en `.husky/`. El resumen final indica, paso
por paso, qué es obligatorio, qué es recomendado y qué es opcional para tu
instalación puntual; el detalle de cada paso queda en
`.agent-security/POST_INSTALL.md` una vez instalado.

## Si forkeás/hosteás esto en otro lugar

El repo no asume ningún host en particular, pero **tres archivos tienen el
path del repo hardcodeado como placeholder** y hay que actualizarlos
después de un fork:

| Archivo | Qué cambiar |
|---|---|
| `bootstrap.sh` | el default de `REPO_URL` (o simplemente decile a la gente que use `GUARDRAILS_REPO_URL=...`) |
| `package.json` | el campo `repository.url` |
| Este README | los ejemplos de `TU-ORG/ai-agents-guardrails-kit` |

Fuera de eso no hay nada acoplado a GitHub ni a GitLab: ni `install.js`, ni
`stacks.js`, ni `generate.js`, ni los templates hacen referencia a ningún
proveedor. La única diferencia real entre hosts es la sintaxis de la URL de
clone (`https://github.com/...` vs `https://gitlab.com/...` vs
`git@host:org/repo.git` para SSH), que `git clone` ya resuelve solo.

## Qué instala

```
.agent-security/
├── policy.yaml           # generado según el stack detectado — es la única
│                          # fuente de verdad para las reglas
├── policy_engine.js       # motor de evaluación, agnóstico al lenguaje
├── policy_loader.js       # lee y valida policy.yaml; falla cerrado
├── final_check.js         # completion gate: re-ejecuta los checks, no
│                          # confía en que el agente diga "tests OK"
├── test_policy_engine.js  # suite propia, sin runner que instalar
├── vendor/                # js-yaml vendorizado (ver vendor/VENDOR.md)
├── toggle.js              # --disable / --enable: apaga el enforcement
│                          # sin borrar nada, y lo vuelve a encender
├── uninstall.js           # saca el kit; muestra el plan y pregunta
├── kit_manifest.js        # compartido por los dos: lee el manifest y
│                          # decide qué archivos siguen siendo nuestros
├── install-manifest.json  # qué escribió el instalador y qué estado
│                          # cambió fuera de estos archivos. No borrarlo:
│                          # es lo que hace que desinstalar sea preciso
└── POST_INSTALL.md        # explica cada paso del resumen final del
                            # instalador (qué es, por qué, qué pasa si te
                            # lo salteás)

.claude/ | .github/hooks/ | .agents/   # adapter fino por harness — solo
                                        # traducen el JSON de cada uno
.husky/pre-commit, .husky/pre-push     # generados según el stack —
                                        # core.hooksPath se configura solo
                                        # si el directorio ya es un repo git
.husky/<cualquier-otro-hook>           # sólo si el proyecto ya tenía hooks:
                                        # un shim que corre el tuyo primero
                                        # (ver "Tus hooks de git no se pierden")
.github/workflows/security.yml         # CI de referencia (GitHub)
.gitlab-ci.yml                         # CI de referencia (GitLab) — se
                                        # genera el que corresponda según
                                        # el remote 'origin', nunca ambos
AGENTS.md, CLAUDE.md, GEMINI.md        # contrato operativo (no es
                                        # control de seguridad, eso es
                                        # policy_engine.js)
```

## ¿Commitear lo instalado, o dejarlo local?

**Commiteálo, casi todo.** Un guardrail que tiene una sola persona no es un
guardrail: si queda local, el agente de tu compañero corre sin restricciones
sobre el mismo repo, y el riesgo nunca fue "mi agente" sino "un agente".

Tres piezas directamente no funcionan sin estar trackeadas:

| Ruta | Por qué |
|---|---|
| `.husky/pre-commit`, `pre-push` y los shims de encadenamiento | Así funciona husky: son contenido del repo. Los shims se escriben sin paths absolutos justamente para poder commitearse |
| `.github/workflows/security.yml` o `.gitlab-ci.yml` | Sin commitear, el pipeline no existe. CI + branch protection es la capa de enforcement *real*; los git hooks son conveniencia |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Es el contrato operativo de los agentes de todo el equipo, no del tuyo |

`policy.yaml` también va a git: es el set de reglas compartido, y cambiar una
regla debería revisarse como cualquier otro cambio. El `install-manifest.json`
igual — sin él, nadie que clone el repo puede desinstalar.

Y hay una razón estructural: desactivar funciona **desenganchando** y no con un
flag precisamente porque un rename aparece en `git diff` y un flag enterrado en
un YAML no. Si nada está trackeado, ningún cambio a los guardrails es revisable
y ese argumento se cae.

**Lo que queda local, por developer:** `core.hooksPath` (es `git config`, no un
archivo), `audit.log` y `completion_reports.log` (forenses por máquina, con
texto de comandos — ya gitignoreados), los `*.new`, y
`.claude/settings.local.json` para los permisos personales de cada uno.

### El paso que nadie le transmite a quien clona

`core.hooksPath` no se puede commitear, así que **cada persona que clone tiene
que correrlo una vez**:

```bash
git config core.hooksPath .husky
```

Hasta que lo haga, recibe `.husky/` en su working tree y git ignora ese
directorio por completo — los hooks son archivos de texto que nadie ejecuta, y
**nada se lo avisa**. Es la forma más común de que un equipo crea que los
guardrails están puestos para todos cuando están puestos para uno.

## Lo que el instalador NO hace con tu git

No commitea. Nunca. Tu historia es tuya: el kit no corre `git add`, `commit`,
`push`, `checkout`, `reset`, `merge`, `rebase`, `stash`, `tag` ni `branch` — no lo
hace el instalador, no lo hace el desinstalador, y no lo hace nada de lo que el
kit genera. Un hook generado que te staggeara archivos sería peor que el
instalador haciéndolo una vez: lo haría en cada commit, en el clone de cada
persona del equipo.

Lo único que escribe en git es **una** pieza de config: `core.hooksPath` (sin eso
los hooks de `.husky/` no se ejecutan nunca), que queda registrada en el manifest
y se revierte al desinstalar o desactivar. Todo lo demás que escribe queda **sin
trackear**, para que lo revises y lo commitees vos.

Está verificado por tests, no sólo prometido acá: se inspeccionan los sitios de
invocación, el contenido generado (hooks y los dos formatos de CI), y hay un caso
end-to-end que instala sobre un repo con un commit y un working tree sucio y
comprueba que `HEAD`, el index y los archivos sin commitear quedaron igual.

## Tus hooks de git no se pierden

Los hooks de `.husky/` no corren si `core.hooksPath` no apunta ahí, así que el
instalador lo configura. El detalle que importa: **apuntar `core.hooksPath` a
`.husky` no hace que `.husky` "gane" sobre el directorio anterior — hace que git
deje de mirarlo por completo.** Verificado, no asumido.

Eso afecta a cualquier proyecto que ya tenga hooks propios: en `.githooks/` con
su `core.hooksPath` puesto, o directamente en `.git/hooks/` — donde los deja el
`pre-commit` de Python, husky v4, lefthook o algún IDE. Y como nosotros sólo
generamos `pre-commit` y `pre-push`, un `commit-msg` o un `post-merge` que
hubiera no tendría ni reemplazo: desaparecía.

Así que el instalador **encadena en vez de pisar**. Para cada hook que encuentra
en el directorio que estaba efectivo antes (ignorando los `*.sample`, que git
nunca ejecuta) escribe en `.husky/` un shim que corre el tuyo primero y propaga
su exit code — si el tuyo falla, el commit se corta ahí y el nuestro no corre.
Para `pre-commit` y `pre-push` el bloque va arriba del hook generado; para
cualquier otro tipo, el archivo entero es un passthrough sin checks propios.

El bloque está marcado con `>>> guardrails-kit: chained hook >>>` y explica en
un comentario qué es y cómo sacarlo, porque alguien lo va a encontrar en un
`git diff` sin contexto. `--uninstall` lo borra; `--no-chain-hooks` instala sin
encadenar.

Cuando encadenar **no** se puede hacer con seguridad —el `core.hooksPath`
anterior es absoluto o apunta afuera del repo, el directorio no se puede leer, o
ya hay un `.husky/<hook>` que no escribimos nosotros— el instalador **no toca
`core.hooksPath`**, explica qué encontró y te da el comando exacto por si querés
seguir igual. Preferimos dejarte los guardrails inactivos y decírtelo, antes que
apagarte en silencio una salvaguarda que ya tenías.

## Apagarlo o sacarlo

Un kit que sabe entrar y no sabe salir es un kit que nadie prueba, porque
probarlo es irreversible en la práctica. Las dos operaciones se instalan junto
con el resto y funcionan **offline, sin el kit** — importa, porque
`bootstrap.sh` borra su propio clone al terminar.

```bash
node .agent-security/toggle.js --disable    # apaga el enforcement, no borra nada
```

```bash
node .agent-security/uninstall.js           # lo saca del proyecto
```

Las dos muestran el plan completo antes de tocar algo y piden confirmación
(`--dry-run` termina en el plan; `--yes` saltea la pregunta). También se llegan
desde el instalador: `node install.js --disable|--enable|--uninstall --target <dir>`
delega en el script instalado, así la lógica tiene un solo lugar donde vive.

La regla que siguen las dos, y es la que importa: **sacan lo que puso el
instalador, nunca lo que vos editaste.** Un archivo se borra sólo si el manifest
lo registró *y* su contenido sigue coincidiendo con lo que se escribió. Un
`policy.yaml` que ajustaste, o un `settings.json` que mergeaste a mano,
se conserva y se reporta.

Consecuencia asumida: una desinstalación puede terminar **incompleta a
propósito**. El resumen lo dice en una línea imposible de perderse — si algún
hook config quedó enganchado, lo nombra, porque hasta que lo saques cada tool
call va a ejecutar un hook que apunta a un `.agent-security/` que ya no existe y
los adapters van a responder `deny`. Falla cerrado: te deniega todo, no te
permite todo.

**Desactivar es desenganchar, no un flag.** No existe ningún `enabled: false`
que lea el *motor*: eso sería agregarle un camino cuyo trabajo es devolver
`allow` para todo, adentro de la única pieza que existe para fallar cerrada — y
un solo archivo que un agente podría intentar crear para liberarse solo.
`--disable` renombra la config de hooks de cada harness
(`settings.json` → `settings.json.disabled`) y devuelve `core.hooksPath` a lo que
era. Es subtractivo, y se ve en `git status`.

## Stacks soportados

Node.js/TS, PHP (Composer/Laravel), Java (Maven), Java/Kotlin (Gradle),
Python. Agregar uno nuevo es un solo bloque en `stacks.js` — ver
`HOWTO.md`.

## Todas las reglas, documentadas

**[`RULES.md`](./RULES.md)** — cada comando bloqueado, cada ruta protegida,
cada check por stack, con su motivo. Se genera con `node docs.js`
directamente desde `generate.js`/`stacks.js`/`policy_engine.js`, así que
nunca queda desactualizado respecto a lo que el instalador realmente hace
(CI lo verifica).

## Agentes soportados

Claude Code, VS Code + Codex (o cualquier agente compatible con
Copilot-style hooks), Antigravity.

## Arquitectura

- `install.js` — CLI interactivo (sin dependencias externas).
- `stacks.js` — perfiles por lenguaje: checks de test/lint, comandos
  peligrosos extra, setup de CI.
- `generate.js` — combina las reglas *core* (agnósticas: `git push --force`,
  `rm -rf`, `DROP TABLE`, `curl | sh`...) con las del stack detectado, y
  genera `policy.yaml` / hooks de git / workflow de CI.
- `templates/` — archivos que se copian tal cual (motor de políticas,
  adapters por harness, contrato AGENTS.md).

El motor (`policy_engine.js`) nunca cambia por lenguaje del proyecto; opera
sobre texto de comando y rutas de archivo, no sobre sintaxis de ningún
lenguaje en particular.

## Importante

Esto es un *gate* de políticas, no un sandbox. Combinalo con aislamiento a
nivel OS/contenedor, branch protection en CI, y nunca darle al agente
credenciales de producción. Ver `.agent-security/README.md` una vez
instalado para el detalle de qué SÍ y qué NO cubre.
