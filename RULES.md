# Reglas del policy engine

> **Este archivo se genera con `node docs.js` a partir de `generate.js` y
> `stacks.js` — no lo edites a mano, se va a sobreescribir.** Si necesitás
> agregar o cambiar una regla, editá esos archivos y volvé a correr
> `node docs.js`. El objetivo es que esta página nunca pueda quedar
> desactualizada respecto al comportamiento real del instalador.

Esto documenta **cómo está pensado el kit por dentro**: qué reglas trae por
default, de dónde salen, y qué cubre cada capa. Para la referencia de lo
que queda instalado en un proyecto concreto, ver
`.agent-security/README.md` (se genera al instalar, ya con el detalle del
stack elegido).

## Capas de protección, de arriba hacia abajo

1. **`blocked_commands`** (comandos de shell) — regex sobre el texto del
   comando. Acción `deny` o `ask` según la regla.
2. **`protected_paths`** (archivos) — glob sobre la ruta resuelta del
   archivo. Aplica tanto a tool calls estructuradas (`Read`/`Write`/`Edit`)
   como a argumentos de comandos de shell (`cat .env`) vía un tokenizer
   best-effort.
3. **Archivos de ignore no estándar** (`.cursorignore` y similares) — se
   leen en vivo del repo y se suman a (2), con las mismas dos coberturas
   (tool call + shell).
4. **Auto-protección de la infraestructura del propio kit** — editar o
   borrar `.agent-security/**`, los hooks de cada agente, o cualquiera de
   los archivos de ignore listados en (3), siempre da `ask`.
5. **`required_checks` / completion gate** — no es una restricción de
   `PreToolUse`, corre al final (`Stop`) y re-ejecuta los checks en vez de
   confiar en lo que el agente dice.

## 1. Comandos bloqueados — reglas core (agnósticas al lenguaje)

Aplican siempre, sin importar el stack detectado.

| Patrón | Acción | Motivo |
| --- | --- | --- |
| `\bgit\s+push\s+(--force\|-f\|--force-with-lease)\b` | 🔴 deny | Force push blocked. |
| `\bgit\s+push\b` | 🟡 ask | Pushing changes requires explicit human approval. |
| `\bgit\s+(reset\s+--hard\|clean\s+-f\|branch\s+-D)\b` | 🔴 deny | Destructive Git operation blocked. |
| `\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\|--recursive.*--force\|--force.*--recursive)\b` | 🔴 deny | Recursive forced deletion blocked. |
| `\b(git\s+commit\s+.*--no-verify\|git\s+push\s+.*--no-verify)\b` | 🔴 deny | Hook bypass is not permitted. |
| `\b(DROP\s+DATABASE\|DROP\s+TABLE\|TRUNCATE)\b` | 🔴 deny | Destructive database operation blocked. |
| `\bDELETE\s+FROM\b(?!.*\bWHERE\b)` | 🔴 deny | DELETE without WHERE clause blocked. |
| `\bDELETE\s+FROM\b` | 🟡 ask | Potentially destructive database operation requires approval. |
| `\bcurl\b.*\\|\s*(sh\|bash\|zsh)\b` | 🔴 deny | curl-pipe-shell execution blocked. |
| `\bdocker\s+push\b` | 🟡 ask | Pushing a container image requires approval. |
| `\b(aws\|gcloud\|az)\s+.*(delete\|terminate\|destroy)\b` | 🟡 ask | Cloud-provider destructive action requires approval. |

## 2. Rutas protegidas — core

| Patrón |
| --- |
| `.env` |
| `.env.*` |
| `**/*credentials*` |
| `**/*secret*` |
| `~/.ssh/**` |
| `~/.aws/**` |
| `~/.config/gcloud/**` |
| `**/*.pem` |
| `**/*.key` |

## 3. Reglas extra por stack

Cada stack detectado agrega sus propios `blocked_commands` y sus propios
`required_checks`. Se combinan (no reemplazan) con las reglas core. En un
monorepo con más de un stack, se suman las de todos.

### `node` — Node.js / TypeScript

Detectado por: `package.json`

**Comandos bloqueados extra:**

| Patrón | Acción | Motivo |
| --- | --- | --- |
| `\bnpm\s+publish\b` | 🟡 ask | Publishing a package requires approval. |
| `\bnpx\s+\S+@\S+` | 🟡 ask | Running an unpinned remote npx package requires approval. |

**Checks de completion gate:**

| Check | Comando |
| --- | --- |
| typecheck | `npm run typecheck --if-present` |
| tests | `npm test --if-present` |
| lint | `npm run lint --if-present` |

**Extensiones que disparan el gate:** `.ts`, `.tsx`, `.js`, `.jsx`

### `php` — PHP (Composer)

Detectado por: `composer.json`

**Comandos bloqueados extra:**

| Patrón | Acción | Motivo |
| --- | --- | --- |
| `\bphp\s+artisan\s+migrate:(fresh\|reset)\b` | 🔴 deny | Destructive Laravel migration blocked. |
| `\bphp\s+artisan\s+migrate\b` | 🟡 ask | Running migrations requires approval. |
| `\bphp\s+artisan\s+db:wipe\b` | 🔴 deny | Destructive database wipe blocked. |
| `\bcomposer\s+(remove\|require)\b` | 🟡 ask | Changing dependencies requires approval. |

**Checks de completion gate:**

| Check | Comando |
| --- | --- |
| tests | `[ -x vendor/bin/phpunit ] && vendor/bin/phpunit \|\| echo "phpunit not installed, skipping"` |
| static-analysis | `[ -x vendor/bin/phpstan ] && vendor/bin/phpstan analyse \|\| echo "phpstan not installed, skipping"` |
| lint | `[ -x vendor/bin/phpcs ] && vendor/bin/phpcs --standard=PSR12 . \|\| echo "phpcs not installed, skipping"` |

**Extensiones que disparan el gate:** `.php`

### `java-maven` — Java (Maven)

Detectado por: `pom.xml`

**Comandos bloqueados extra:**

| Patrón | Acción | Motivo |
| --- | --- | --- |
| `\bmvn\s+.*\bdeploy\b` | 🟡 ask | Deploying an artifact requires approval. |
| `\bmvn\s+.*-Dmaven\.test\.skip(=true)?\b` | 🟡 ask | Skipping tests requires approval. |

**Checks de completion gate:**

| Check | Comando |
| --- | --- |
| compile | `mvn -q -B compile` |
| tests | `mvn -q -B test` |

**Extensiones que disparan el gate:** `.java`

### `java-gradle` — Java/Kotlin (Gradle)

Detectado por: `build.gradle`, `build.gradle.kts`

**Comandos bloqueados extra:**

| Patrón | Acción | Motivo |
| --- | --- | --- |
| `\./gradlew\s+.*\bpublish\b` | 🟡 ask | Publishing an artifact requires approval. |

**Checks de completion gate:**

| Check | Comando |
| --- | --- |
| tests | `./gradlew test` |
| lint | `./gradlew check --continue` |

**Extensiones que disparan el gate:** `.java`, `.kt`

### `python` — Python

Detectado por: `requirements.txt`, `pyproject.toml`, `Pipfile`

**Comandos bloqueados extra:**

| Patrón | Acción | Motivo |
| --- | --- | --- |
| `\btwine\s+upload\b` | 🟡 ask | Publishing to PyPI requires approval. |
| `\bpip\s+install\s+.*--index-url\b` | 🟡 ask | Installing from a non-default index requires approval. |

**Checks de completion gate:**

| Check | Comando |
| --- | --- |
| tests | `pytest -q` |
| lint | `ruff check .` |

**Extensiones que disparan el gate:** `.py`


## 4. Archivos de ignore no estándar soportados

Se leen del root del repo, en vivo (no hace falta reinstalar para que un
cambio tome efecto). Sintaxis estilo gitignore, con una excepción
deliberada: **las líneas `!negación` no se honran** — un archivo de ignore
del propio repo nunca puede *reducir* protección, solo sumarla.

| Archivo |
| --- |
| `.cursorignore` |
| `.agentsignore` |
| `.aiignore` |
| `.aiderignore` |
| `.clineignore` |
| `.windsurfignore` |
| `.continueignore` |
| `.copilotignore` |
| `.codeiumignore` |
| `.geminiignore` |

## 5. Infraestructura auto-protegida (siempre `ask` al editar/borrar)

- `.agent-security/**`
- `.claude/settings*.json`, `.claude/hooks/**`
- `.agents/hooks.json`
- `.github/hooks/**`
- `.husky/**`
- `.github/workflows/**`
- Todos los archivos de ignore listados en la sección 4

Cubre tanto tool calls estructuradas (`Write`/`Edit` con `file_path`) como
comandos de shell que referencien esas rutas (`rm .cursorignore`).

## Qué NO cubre nada de esto

Ver la sección "What this does NOT do" / "What 'protected' actually
covers" de `.agent-security/README.md` (se instala junto con el resto) —
en resumen: esto es un gate de políticas evaluado por regex/paths, no un
sandbox. Un agente con motivación activa de evadirlo puede, en principio,
ofuscar nombres de archivo, usar una tool que este kit no hookea, o leer
variables de entorno ya cargadas en el shell. Esta capa sube el costo y
deja rastro de auditoría (`.agent-security/audit.log`); no reemplaza
aislamiento a nivel OS/contenedor ni el hecho de no darle al agente
credenciales de producción.
