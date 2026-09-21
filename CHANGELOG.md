# Changelog

## Unreleased

### `npm test` fallaba en Linux y macOS: 3 casos "pendientes" que no eran deuda

El primer run de GitHub Actions (que existe recién desde esta versión) falló con:

```
FAIL - payload suite reports no pending cases once policy_engine.js exists
  policy_engine.js exists but 3 engine case(s) are still pending — port task 02 is not done (G14)
```

No era el port: los 3 casos son `msys_drive_path_no_bypass`,
`cygdrive_path_no_bypass` y `msys_drive_structured_no_bypass`, que construyen la
forma MSYS (`/c/Users/...`) del home **de esta máquina** para probar que el
bypass de Git Bash sigue cerrado. En Linux y macOS `os.homedir()` no tiene letra
de unidad, así que no hay forma MSYS que construir y la suite los reportaba como
`pend`. El chequeo del kit leía eso como "la tarea 02 del port no está hecha" y
fallaba en toda máquina que no fuera Windows.

`pend` y `skip` no son la misma afirmación, y juntarlas hacía que una de las dos
mintiera:

- **`pend`** = el código bajo prueba todavía no existe. Es deuda, y el CI del kit
  falla mientras quede alguno.
- **`skip`** = este caso no se puede expresar en esta máquina. No es deuda y no
  se resuelve nunca.

Ahora la suite del payload cuenta las dos por separado, imprime cada `skip` con
su razón al lado, y el resumen aclara que en Linux/macOS el bypass MSYS sólo lo
verifica una corrida en Windows.

Para que "skip" no se convierta en la forma silenciosa de callar un caso
incómodo, la lista de casos salteables está **congelada** en
`test/install.test.js` (`SKIPPABLE_ENGINE_CASES`): si un caso se saltea sin estar
en la lista, o sin dar razón, el CI falla. Y en Windows, donde los tres aplican,
no se admite ningún skip.

También se corrigió el comentario del bloque, que afirmaba lo contrario de lo que
hacía el código ("These run on every platform").

## v1.0.0 — 2026-09-18

Primera versión publicada del kit (motor en Node, payload con js-yaml
vendorizado). No hay instalaciones previas en el mundo real, así que no hay
nada que migrar.

### Reinstalar dejaba el kit imposible de desinstalar (corregido)

`copyFile`/`writeText` decidían sólo por `fs.existsSync`. En una reinstalación
todos los archivos existen, así que los 26 se escribían como `.new` **y** se
registraban en el manifest con `status: "skipped"`, que significa "esto ya
estaba en el proyecto antes de que llegáramos".

El ruido de los `.new` era la mitad visible. La otra mitad: `classifyFile()`
mapea `skipped` a `preexisting`, así que `uninstall.js` concluía que el kit
entero era del usuario y **no borraba nada** — dejaba los hooks enganchados
después de decir que desinstalaba. Verificado en un fixture: "No hay archivos
para borrar (ninguno coincide con lo que el instalador escribió)".

Ahora, si lo que está en disco es byte por byte lo que íbamos a escribir
(comparado normalizando fines de línea, igual que hashea el manifest), el
instalador no escribe nada, reporta `= archivo (sin cambios)` y lo registra como
propio. G4 se mantiene intacto: no se pisa nada porque no hay nada que pisar, y
un archivo que vos editaste sigue recibiendo su `.new` como siempre.

### Los git hooks se commiteaban sin permiso de ejecución desde Windows (mitigado)

Git no ejecuta un hook que no sea ejecutable, y **no avisa**. El instalador ya
hacía `chmod 755`, pero git en Windows usa `core.filemode=false` (NTFS no tiene
bit de ejecución que leer), así que al commitear los registra como `100644`.
Resultado: el equipo entero en Linux/macOS clona hooks que git ignora en
silencio. Misma clase de falla que `core.hooksPath`, una capa más abajo.

El instalador no puede arreglarlo solo: `git update-index --chmod=+x` sólo
funciona sobre archivos ya trackeados, y los nuestros están sin trackear cuando
el instalador corre — staged­earlos sería exactamente lo que G17 prohíbe. Así
que se automatiza todo lo que sí se puede:

- detecta `core.filemode=false` y muestra el comando exacto como paso
  `[obligatorio]`, en vez de dejar que se enteren por un colega;
- escribe `.gitattributes` con `.husky/** text eol=lf` — la otra mitad del mismo
  problema, esa sí automatizable: con `core.autocrlf=true` (el default en
  Windows) el hook se checkouteaba con CRLF y moría en Linux/macOS con
  `/usr/bin/env: 'sh\r': No such file or directory`;
- el CI generado (GitHub **y** GitLab) falla el build si los hooks están
  commiteados sin `100755`, así que olvidarse frena en el pipeline.

`uninstall.js` saca del `.gitattributes` exactamente las líneas que agregó, con
el mismo contrato que ya tenía para el `.gitignore`.

### El repo del kit no tenía CI propio

`origin` apunta a GitHub y el repo sólo traía `.gitlab-ci.yml`, así que **nada
verificaba el kit**: ni `npm test`, ni el chequeo de que `RULES.md` esté al día,
ni el install por stack. Por eso pasó desapercibido que la suite venía fallando.
Se agrega `.github/workflows/ci.yml`, espejo del pipeline de GitLab.

### El workflow de GitHub generado para proyectos PHP era YAML inválido (corregido)

Los checks del stack PHP empiezan con `[ -x vendor/bin/phpunit ] && ...`, y un
valor YAML sin comillas que abre con `[` se parsea como flow sequence. El
`.github/workflows/security.yml` resultante no era YAML válido, así que **GitHub
se negaba a correrlo**: todo proyecto PHP en GitHub quedaba sin la única capa de
enforcement que no se puede saltear con `--no-verify`, sin que nada lo dijera.

El builder de GitLab ya citaba los comandos (`yamlStr`); el de GitHub no. Ahora
los dos lo hacen, y hay un test que parsea los 10 archivos generados (5 stacks x
2 hosts) con el js-yaml vendorizado.

### El `--git-hooks` pelado se comía el flag siguiente (corregido)

`--help` documenta la forma pelada, pero el parser consumía el token siguiente
siempre: `--git-hooks --yes` se leía como `gitHooks=true` y **sin** `--yes`, así
que una corrida pensada para no ser interactiva se quedaba esperando en un
prompt. Ahora sólo consume el token si es `true` o `false`.

### Correcciones menores

- El test de integridad del js-yaml vendorizado hasheaba bytes crudos, así que
  **fallaba en todo checkout de Windows** (CRLF en el working copy, LF en el
  blob) y pasaba en el CI de Linux. Ahora normaliza fines de línea, igual que
  `kit_manifest.js`. Una falsa alarma sobre lo único que ese test existe para
  detectar es peor que no tenerlo: enseña a ignorar un fallo de integridad.
- El paso 3 del resumen decía "ya existía uno con ese nombre" siempre, incluso
  cuando no se escribió ningún `.new`. Ahora se arma con lo que la corrida
  realmente hizo.
- `uninstall.js` dejaba `.agent-security/audit.log` y su directorio sin
  mencionarlo, bajo un resumen que decía "Conservados: 0". Sigue sin borrarlos
  —son tu registro de auditoría, no un archivo nuestro— pero ahora los nombra y
  explica por qué.
- El mensaje de "no se generó CI" todavía citaba `test_policy_engine.py`,
  borrado en el port a Node.

### El motor vendorizado no se commiteaba en proyectos PHP/Go/Ruby (corregido)

Esos tres ecosistemas traen una línea `vendor` en su `.gitignore`, y **sin
anclar matchea un directorio con ese nombre a cualquier profundidad** — o sea
que también se comía `.agent-security/vendor/`, donde vive el js-yaml
vendorizado del motor.

Medido sobre las siete formas de escribirlo que se usan en la práctica:

| Patrón | ¿Se comía el vendor del kit? |
|---|---|
| `vendor`, `vendor/`, `**/vendor`, `**/vendor/**` | **sí** |
| `/vendor`, `/vendor/`, `vendor/**` | no (anclados al root) |

La consecuencia no es cosmética. El instalador escribía los archivos, reportaba
éxito, y el desarrollador commiteaba — pero quien clonaba recibía un motor que
no podía cargar su propio parser de YAML. El adapter entonces falla cerrado
(G2, correcto) y **deniega TODAS las tool calls, `git status` incluido**. Un
equipo entero trabado por un archivo faltante del que nadie avisó.

El instalador ahora agrega dos negaciones al `.gitignore` del proyecto:

```gitignore
!.agent-security/vendor
!.agent-security/vendor/**
```

Son dos y no una. La primera re-incluye el *directorio*, sin lo cual git ni
siquiera desciende a él y nada de adentro puede recuperarse; la segunda cubre
los patrones que matchean los archivos directamente (`**/vendor/**`). Verificado:
juntas limpian las seis formas que muerden; por separado, cada una deja una
abierta.

Y después de escribirlas, **le pregunta a git si funcionó**
(`git check-ignore`) en vez de asumirlo: un `.gitignore` anidado dentro de
`.agent-security/` todavía le gana al del root, y ahí el instalador avisa en vez
de imprimir un ✓ sobre un motor que nunca se va a commitear.

Para revisarlo a mano en un proyecto ya instalado:

```bash
git check-ignore -v .agent-security/vendor/js-yaml.js
```

Sin salida = está bien. Si sale algo, agregá las dos líneas al final del
`.gitignore` (el orden importa: git se queda con el último patrón que matchea).

**Los tres adapters ahora nombran la ausencia concreta** en vez de decir sólo
"could not load the policy engine". Quien caiga en esto ve un agente que deniega
todo y necesita un hilo del cual tirar, no una categoría. Tres ramas distintas:
falta `.agent-security/` entero (instalación a medio sacar), falta
`vendor/js-yaml.js` (el caso de arriba, con el comando de diagnóstico incluido en
el mensaje), o el motor está presente y no parsea (se incluye el error real).

### Bypass de comandos por opciones globales (corregido) — once reglas afectadas

Lo encontró una corrida real del `SELF_TEST_PROMPT.md`, no un test del kit:

```
git commit --no-verify                             → deny  ✓
git -c user.email=x -c user.name=y commit --no-verify → ALLOW ✗
```

Mismo comando, y `-c user.email=x` no es una evasión exótica: es la forma
ordinaria de fijar la identidad del commit. El patrón era
`git\s+commit\s+.*--no-verify`, que exige que `git` y `commit` estén
pegados — y **casi ningún CLI funciona así**. Entre el programa y su subcomando
van las opciones globales.

Medido después: **once reglas** tenían el mismo agujero, no una.

| Regla | Forma que la evadía |
|---|---|
| hook bypass | `git -c k=v commit --no-verify` |
| force push | `git -c core.pager=cat push --force` |
| git destructivo | `git -C /path reset --hard` |
| push (ask) | `git --no-pager push` |
| `docker push` | `docker --config=/tmp push` |
| `npm publish` | `npm --registry=http://x publish` |
| `npx` sin pinear | `npx --yes pkg@1` |
| `artisan migrate` ×3 | `php -d memory_limit=1G artisan migrate` |
| `composer remove` | `composer --no-interaction remove x` |
| `twine upload` | `twine --repository x upload` |
| `pip install --index-url` | `pip --quiet install --index-url http://x` |

Una **parecía** aguantar: `git --git-dir=.git branch -D main` denegaba. Pero sólo
porque el path terminaba en `.git`, así que `git branch -D` existía como
substring. Coincidencia, no regla — con `--git-dir=/tmp/x` pasaba igual.

El fix es un solo lugar: `THEN` en `stacks.js`, la pieza que reemplaza al `\s+`
entre un programa y su subcomando. Es `[^;&|\n]*?` — una clase de caracteres
simple, a propósito:

- **Lineal.** Sin cuantificadores anidados, porque el matcher corre en cada tool
  call. Medido con entradas adversariales (200 opciones, flags de 5000 chars,
  20k chars sin estructura): peor caso **0.88ms** contra 5000ms de timeout.
- **Sin mantenimiento.** No modela la sintaxis de opciones de cada CLI, así que
  no se queda vieja cuando alguno agrega flags.
- **No cruza comandos.** Excluir `;`, `&`, `|` y saltos de línea es lo que hace
  que `git status; echo "commit --no-verify"` **no** sea un commit.

### Y un agujero preexistente que salió al mirar: `git clean`

Buscando el alcance apareció que `clean\s+-f` exigía que la `f` fuera el
**último** carácter del flag. O sea: atrapaba `git clean -f` y dejaba pasar
`git clean -fd`, `git clean -xdf` y `git clean --force` — que es como se escribe
en la vida real. **La forma más común del comando destructivo nunca estuvo
bloqueada.** Ahora `-[a-zA-Z]*f` cubre el bundle y la forma larga, y
`branch --delete --force` (el sinónimo largo de `-D`) también.

### Limitación conocida que queda documentada, no arreglada

El motor compila **todos** los patrones con el flag `i`, así que `-D` también
matchea `-d` y `git branch -d merged` —el borrado *seguro*, que se niega a
tirar trabajo sin mergear— se deniega igual.

El flag no es un error: es lo que atrapa `drop table users` en minúscula, y
perder eso sería mucho peor que esta fricción. Arreglarlo bien requiere
sensibilidad al case **por regla** en `policy.yaml`, que es una decisión propia.
Mientras tanto, errar hacia denegar un borrado de branch es la dirección segura.
Está escrito en el comentario de la regla, no descubierto por el próximo.

### Guards para que la clase no vuelva

- **Estructural**: un test recorre las 22 reglas (core + stacks) y falla si
  alguna vuelve a exigir adyacencia programa/subcomando, nombrando el patrón.
  Verificado por mutación: reintroduje `docker\s+push` y el test falló
  citándolo. La **primera** versión de ese test no detectaba nada —era un regex
  sobre regexes, sobre-escapado— y pasaba por vacío; lo expuso justamente la
  corrida de mutación.
- **De performance**: otro test mide el matching contra entradas adversariales y
  falla si pasa de 500ms.
- **En el self-test**: sección **A2** nueva, gemela de la E2 de rutas. Reejecuta
  los comandos de la sección A escritos con una opción global adelante, más los
  dos que **no** deben denegarse (`git clean -n`, y nombrar un comando sin
  ejecutarlo). La próxima corrida los revisa en vez de redescubrirlos.

`RULES.md` explica ahora cómo leer `[^;&|\n]*?` en la tabla, para que los
patrones no parezcan ruido.


### `policy.yaml` ya no anuncia controles que no existen

De las siete secciones que generaba, **tres no las leía nadie**:
`sensitive_tools`, `approval_required` y `completion_rules`. Se emitían en cada
instalación, el loader las preservaba, y ninguna rama del motor ni del gate las
consultaba. Se van las tres.

El costo nunca fue el código muerto — fue la confianza. Alguien agrega una
entrada a `approval_required`, no observa ningún cambio de comportamiento, y
concluye razonablemente que **los guardrails no funcionan**. Es la peor
conclusión posible, y era la correcta a partir de la evidencia que tenía. Ahora
las cuatro secciones que quedan (`version`, `protected_paths`,
`blocked_commands`, `required_checks`) afectan todas una decisión real.

**Dos de ellas no deberían volver:**

- `approval_required` listaba *conceptos*, no patrones matcheables:
  `database_migration` no aparece nunca literalmente en un comando. Y
  `blocked_commands` ya cubre cada una de esas categorías con un regex de verdad
  y un motivo legible — `git push`, `php artisan migrate`, los destructivos de
  cloud. Era una taxonomía al lado del mecanismo que la implementa.
- `sensitive_tools` duplicaba el matcher del propio harness. E implementarla como
  su nombre sugiere —un filtro sobre qué se evalúa— significaría que **una
  herramienta no listada se saltea el motor entero**: fail-open dentro de la
  pieza que existe para fallar cerrada. Sacarla es una mejora de seguridad en
  expectativa, no sólo limpieza.

**`completion_rules` puede volver como feature.** Describía algo real y útil:
correr sólo los checks relevantes según qué cambió, que además ayudaría con el
presupuesto del gate. Pero es una feature con decisiones propias (qué significa
"cambió" en un hook `Stop`, correr todo si el diff no se puede determinar) y con
un `require: []` hardcodeado que hoy está al revés. Vuelve por sus méritos y con
sus tests, no como clave emitida esperando implementación.

**Instalaciones existentes:** no se rompe nada. G4 significa que un `policy.yaml`
instalado nunca se sobrescribe, y el loader **preserva** claves desconocidas sin
fallar — verificado con un test. Un proyecto ya instalado conserva su archivo y
las tres claves siguen tan inertes como siempre; sólo cambia lo que se genera de
acá en adelante.

La propiedad que hace seguro el cambio, y que se verifica en vez de afirmarse:
**la suite del payload no se movió** (90 casos, iguales antes y después). Si
alguna decisión del motor hubiera cambiado, ahí se vería.

Con esto quedan cerrados los cinco puntos de la deuda heredada del port a Node.


### El completion gate ya no puede fallar abierto, ni decir "ok" sin verificar nada

Los dos problemas los mostró un `completion_reports.log` real, no un test.

**1. `status: "ok"` con `checks: {}`.** Pasaba en dos casos distintos:
`--post-tool-use` (que por diseño no corre ningún check) y un proyecto sin stack
detectado (`required_checks` vacío). Quien leyera el log después veía un gate en
verde donde nunca se había verificado nada.

Los dos reportan ahora **`status: "skipped"`** con el motivo, porque "no
verifiqué nada" no es "pasó todo". El caso del `required_checks` vacío además
dice dónde agregar los checks, y que hasta entonces el gate aprueba todo.

**2. El gate podía morir sin escribir reporte.** Cada check tenía 600s mientras
los hook configs declaraban 60s de `Stop`. Con los 3 checks de un stack PHP el
techo teórico eran **1800s contra 60s** — y un hook que el harness mata **no
escribe reporte**, o sea el gate fallando *abierto*: lo único que un gate nunca
debe hacer.

- Presupuesto **total** (`TOTAL_BUDGET_MS`, 280s), y ningún check puede durar más
  que lo que queda de él.
- Los tres hook configs suben `Stop` de 60s a **300s**, que deja margen para
  escribir el reporte (G7).
- Agotar el presupuesto es un `blocked` que nombra qué no llegó a correr, con
  exit 1. Falla cerrado y por escrito.
- El motivo aclara que hay que subir **los dos** números si tu suite necesita
  más tiempo: subir uno solo reproduce el bug original. Y hay un test que verifica
  que el timeout del hook siga por encima del presupuesto — son un par, no dos
  constantes independientes.

Nota que queda documentada en el README del payload: un `exit_code: 0` de un
check puede significar *salteado* y no *pasó*, porque los comandos generados
degradan a propósito (`[ -x vendor/bin/phpunit ] && ... || echo "skipping"`). Es
deliberado — el gate no debería fallar porque una herramienta no esté instalada —
pero un reporte verde en una máquina sin el toolchain prueba menos de lo que
parece. El `command` va en el reporte para poder distinguirlo.

Con esto quedan resueltos los puntos 3, 4 y 5 de la deuda heredada del port. Los
que siguen abiertos son el 1 y el 2: las tres claves de `policy.yaml` que no
hacen nada (`sensitive_tools`, `approval_required`, `completion_rules`).


### Qué commitear, y el paso que le falta a quien clona

Faltaba lo más básico: el kit escribía 26 archivos y no decía en ninguna parte
cuáles van a git y cuáles quedan locales.

- **`.agent-security/README.md`** y **`POST_INSTALL.md`** ganan la tabla del
  reparto. La regla en una línea: se commitea casi todo, porque un guardrail que
  tiene una sola persona no es un guardrail. Y hay una razón estructural además
  de la obvia — desactivar funciona desenganchando y no con un flag *porque* un
  rename aparece en `git diff`; si nada está trackeado, ese argumento se cae.
- **El resumen del instalador** cierra avisando dos cosas: commiteá lo que se
  escribió, y `core.hooksPath` es config local de git, así que **cada persona
  que clone tiene que correr `git config core.hooksPath .husky` una vez**. Hasta
  que lo haga recibe `.husky/` y git ignora ese directorio por completo: los
  hooks son texto que nadie ejecuta y nada se lo avisa. Es la forma más común de
  que un equipo crea que los guardrails están puestos para todos cuando están
  puestos para uno.
- **`.claude/hooks/` documentado como punto de extensión.** Es guardrail
  infrastructure, así que un agente no puede editar ni borrar nada de ahí — un
  hook propio de `SessionStart` puesto en ese directorio queda a prueba de
  manipulación por el agente al que está briefeando. Con las dos consecuencias
  dichas: editar `settings.json` a mano hace que `uninstall.js` lo conserve (y
  lo diga), y un script propio no está en el manifest así que sobrevive.

### `--uninstall` ya no restaura un `hooksPath` que este clone no tiene

`git.hooksPathBefore` es el **único** campo del manifest específico de una
máquina: registra lo que tenía *un* developer antes de instalar. Y el manifest
está pensado para commitearse, porque sin él nadie que clone puede desinstalar.

En el clone de otra persona ese valor puede nombrar un directorio que nunca
tuvo. Restaurarlo dejaba a su git apuntando a la nada — y git entonces **no
corre ningún hook, en silencio**: exactamente el fallo G12-al-revés que ese paso
existe para evitar.

Ahora se verifica que el directorio exista en este clone antes de restaurarlo;
si no está, se desetea y se explica por qué. Con test de regresión.

Salió arreglando esto un fixture irreal que tenía la suite: el test de
"restaurar el hooksPath previo" seteaba `core.hooksPath .githooks` sin crear el
directorio. Pasaba igual porque el desinstalador no chequeaba nada.


### Bypass de rutas protegidas en Windows/Git Bash (corregido)

**Lo más importante de esta tanda, y lo encontró el propio
`SELF_TEST_PROMPT.md` corriendo contra un proyecto real** — no lo encontró
ningún test del kit.

| Comando | Antes | Ahora |
|---|---|---|
| `cat ~/.ssh/id_rsa` | deny | deny |
| `cat /c/Users/<usuario>/.ssh/id_rsa` | **allow** | deny |
| `cat /cygdrive/c/Users/<usuario>/.ssh/id_rsa` | **allow** | deny |

Mismo archivo, dos formas de escribir la ruta. `/c/...` es una ruta **válida y
legible** en Git Bash / MSYS2 (y `/cygdrive/c/...` en Cygwin), pero el motor no
la reconocía como absoluta: `path.resolve()` la convertía en `C:\c\...`, una
ruta inexistente que no matchea ningún patrón anclado. Afectaba a
`~/.ssh/**`, `~/.aws/**` y `~/.config/gcloud/**` — todo patrón anclado. Los
patrones "pelados" como `.env` seguían atrapándolo por nombre de archivo, que es
por qué no salió antes.

`expandShellDrivePath()` traduce esas formas a rutas Windows reales antes de
resolver, sólo en `win32` (en POSIX `/c/Users` es una ruta absoluta legítima y
reescribirla sería incorrecto). Con tests de regresión para las tres formas, más
uno que verifica que un primer segmento que **no** es letra de unidad
(`/config/app.yml`) se sigue tratando como antes.

Los tests de regresión pasaron en el primer intento **con el bug reintroducido**:
usaban `evaluateFromDict(tool, input, workspace)`, que sólo acepta dos
argumentos, así que el workspace se descartaba y el motor denegaba por no
encontrar `policy.yaml` — verde por el motivo equivocado. Lo detectó la corrida
de mutación, no la lectura. Ahora usan `evaluate()` y además fallan si el motivo
del deny es un error del loader en vez de una regla de path.

### Editar la config del guardrail pasa de `ask` a `deny` (G8)

Un agente no tiene ninguna razón legítima para reescribir las reglas que lo
limitan en la misma sesión: todo intento es un error o un ataque. Ofrecerlo como
prompt ponía la decisión más consecuente del sistema detrás del click que un
humano distraído hace más rápido — y el premio por ese click es todos los
guardrails apagados de una vez.

- `Write`/`Edit`/borrado de `.agent-security/**`, cualquier config de hooks,
  `.husky/**`, `.github/workflows/**` o un archivo de ignore: **deny**.
- Lo mismo por la clave camelCase `filePath`, y para **cualquier nombre de
  herramienta no reconocido** — la exención es una allowlist, no una denylist.
- Comandos de shell que **modificarían** esa config (`rm`, `mv`, `>`, `sed -i`,
  `chmod`, `tee`, `patch`, `git rm`...): **deny** también. Sin esto el cambio
  sería teatro: un agente que no puede editar `policy.yaml` simplemente la
  borraba con un click. Verificado: `rm .claude/settings.json` pasaba con `ask`.
- Un comando de shell que sólo *nombra* el directorio sigue en `ask`: el
  tokenizador no es un parser de shell y no puede probar que sea lectura, así que
  `tail audit.log` sigue usable sin abrir un camino de escritura.

La vía sancionada es mejor en todos los ejes: un humano edita el archivo, o corre
`node .agent-security/toggle.js --disable` primero. Las dos son deliberadas y las
dos aparecen en `git status`; un click en un prompt no.

### Leer la config del guardrail pasa de `ask` a `allow`

El contracambio, y el que hizo falta primero: la auto-protección se disparaba en
**lecturas**, con el motivo "Change to guardrail infrastructure" sobre algo que no
cambia nada. `policy.yaml` está commiteado y `RULES.md` dice lo mismo en prosa,
así que leerlo no desactiva nada.

Preguntar ahí costaba seguridad en vez de agregarla: un agente lee todo el
tiempo, así que el humano se entrena a aprobar prompts de `.agent-security/**` de
memoria — y después deja pasar el único que importaba. Medido en la práctica:
además volvía **imposible de correr** al propio `SELF_TEST_PROMPT.md`, porque
negar la lectura (el instinto correcto) le corta el paso al agente.

`READ_ONLY_TOOLS` cubre las herramientas de lectura de los tres harnesses.
`protected_paths` no cambió: `Read .env` sigue siendo `deny`.

### `SELF_TEST_PROMPT.md`: tres correcciones que salieron de usarlo

- **Filas 11–14 eran imposibles de correr.** Pedían crear `.env.selftest`
  primero, pero crearlo lo deniega `.env.*`. El fixture nunca hizo falta: el
  motor matchea el *patrón*, no la existencia del archivo. Ahora dice
  explícitamente que no lo cree — y así, si un bloqueo fallara, el resultado es
  "no such file" en vez de un archivo con forma de secreto en el repo.
- **Sección E2 nueva**: la misma ruta protegida escrita de varias formas
  (`~/`, absoluta, `/c/`, `/cygdrive/c/`) tiene que dar la misma decisión. Es la
  sección que habría encontrado el bypass de arriba.
- **"Blocked at setup" es ahora una instrucción.** Un agente que no puede armar
  un fixture registra la fila y **sigue**: una tabla parcial con huecos honestos
  sirve, una corrida que se detuvo en la fila 11 no.


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
