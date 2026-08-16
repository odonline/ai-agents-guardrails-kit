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
workflow de CI de referencia. Para saltar los prompts (CI, scripting):

```bash
curl -fsSL .../bootstrap.sh | bash -s -- --agents claude-code --stacks node --yes
```

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
├── policy_engine.py       # motor de evaluación, agnóstico al lenguaje
├── final_check.py         # completion gate: re-ejecuta los checks, no
│                          # confía en que el agente diga "tests OK"
└── test_policy_engine.py  # pytest suite

.claude/ | .github/hooks/ | .agents/   # adapter fino por harness — solo
                                        # traducen el JSON de cada uno
.husky/pre-commit, .husky/pre-push     # generados según el stack
.github/workflows/security.yml         # CI de referencia
AGENTS.md, CLAUDE.md, GEMINI.md        # contrato operativo (no es
                                        # control de seguridad, eso es
                                        # policy_engine.py)
```

## Stacks soportados

Node.js/TS, PHP (Composer/Laravel), Java (Maven), Java/Kotlin (Gradle),
Python. Agregar uno nuevo es un solo bloque en `stacks.js` — ver
`CONTRIBUTING.md`.

## Todas las reglas, documentadas

**[`RULES.md`](./RULES.md)** — cada comando bloqueado, cada ruta protegida,
cada check por stack, con su motivo. Se genera con `node docs.js`
directamente desde `generate.js`/`stacks.js`/`policy_engine.py`, así que
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

El motor (`policy_engine.py`) nunca cambia por lenguaje del proyecto; opera
sobre texto de comando y rutas de archivo, no sobre sintaxis de ningún
lenguaje en particular.

## Importante

Esto es un *gate* de políticas, no un sandbox. Combinalo con aislamiento a
nivel OS/contenedor, branch protection en CI, y nunca darle al agente
credenciales de producción. Ver `.agent-security/README.md` una vez
instalado para el detalle de qué SÍ y qué NO cubre.
