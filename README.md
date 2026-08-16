# AI Agents Guardrails Kit

Instalador de guardrails para agentes de código (Claude Code, VS Code/Codex,
Antigravity): un motor de políticas único, auditado, con detección
automática del stack del proyecto (Node, PHP, Java, Python...).

## Quickstart

El instalador es agnóstico al host git (`bootstrap.sh` usa `git clone`, no
una URL de API específica de un proveedor). Los ejemplos de abajo asumen
que ya hosteaste este repo en algún lado — ver
["Si forkeás/hosteás esto en otro lugar"](#si-forkeásosteás-esto-en-otro-lugar).

```bash
# GitHub
curl -fsSL https://raw.githubusercontent.com/TU-ORG/guardrails-kit/main/bootstrap.sh | bash
npx --package=github:TU-ORG/guardrails-kit install-guardrails

# GitLab (gitlab.com o self-hosted)
curl -fsSL https://gitlab.com/TU-ORG/guardrails-kit/-/raw/main/bootstrap.sh | bash
npx --package=git+https://gitlab.com/TU-ORG/guardrails-kit.git install-guardrails

# Cualquier otro host git (Bitbucket, self-hosted genérico...)
GUARDRAILS_REPO_URL=https://tu-host.com/TU-ORG/guardrails-kit.git \
  curl -fsSL https://tu-host.com/.../bootstrap.sh | bash
```

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
| Este README | los ejemplos de `TU-ORG/guardrails-kit` |

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
