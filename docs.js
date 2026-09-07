#!/usr/bin/env node
/**
 * docs.js — regenerates RULES.md FROM the actual rule data in generate.js
 * and stacks.js, so the documentation can never silently drift from what
 * the installer really does. Run this after editing rules:
 *
 *   node docs.js
 *
 * CI checks that RULES.md matches this output (see .gitlab-ci.yml).
 */
const fs = require("fs");
const path = require("path");
const { STACKS } = require("./stacks");
const { CORE_BLOCKED_COMMANDS, CORE_PROTECTED_PATHS } = require("./generate");

// KNOWN_IGNORE_FILES lives in ONE place — templates/common/policy_engine.js
// (the file that actually enforces it at runtime). Now that the engine is
// Node, require it and read the exported constant instead of regexing the
// source: if the engine is ever renamed or the export removed, this throws
// and CI fails, which is the intended behavior (G5).
const { KNOWN_IGNORE_FILES } = require("./templates/common/policy_engine.js");
if (!Array.isArray(KNOWN_IGNORE_FILES) || KNOWN_IGNORE_FILES.length === 0) {
  throw new Error("policy_engine.js no exporta KNOWN_IGNORE_FILES");
}

function table(headers, rows) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

function actionBadge(action) {
  return { deny: "🔴 deny", ask: "🟡 ask", allow: "🟢 allow" }[action] || action;
}

let out = `# Reglas del policy engine

> **Este archivo se genera con \`node docs.js\` a partir de \`generate.js\` y
> \`stacks.js\` — no lo edites a mano, se va a sobreescribir.** Si necesitás
> agregar o cambiar una regla, editá esos archivos y volvé a correr
> \`node docs.js\`. El objetivo es que esta página nunca pueda quedar
> desactualizada respecto al comportamiento real del instalador.

Esto documenta **cómo está pensado el kit por dentro**: qué reglas trae por
default, de dónde salen, y qué cubre cada capa. Para la referencia de lo
que queda instalado en un proyecto concreto, ver
\`.agent-security/README.md\` (se genera al instalar, ya con el detalle del
stack elegido).

## Capas de protección, de arriba hacia abajo

1. **\`blocked_commands\`** (comandos de shell) — regex sobre el texto del
   comando. Acción \`deny\` o \`ask\` según la regla.
2. **\`protected_paths\`** (archivos) — glob sobre la ruta resuelta del
   archivo. Aplica tanto a tool calls estructuradas (\`Read\`/\`Write\`/\`Edit\`)
   como a argumentos de comandos de shell (\`cat .env\`) vía un tokenizer
   best-effort.
3. **Archivos de ignore no estándar** (\`.cursorignore\` y similares) — se
   leen en vivo del repo y se suman a (2), con las mismas dos coberturas
   (tool call + shell).
4. **Auto-protección de la infraestructura del propio kit** — editar o
   borrar \`.agent-security/**\`, los hooks de cada agente, o cualquiera de
   los archivos de ignore listados en (3), da \`deny\`. Leerlos está
   permitido: leer no desactiva nada, y preguntar por lecturas sólo entrena
   al humano a aprobar prompts de \`.agent-security/**\` de memoria.
5. **\`required_checks\` / completion gate** — no es una restricción de
   \`PreToolUse\`, corre al final (\`Stop\`) y re-ejecuta los checks en vez de
   confiar en lo que el agente dice.

## \`deny\` se hace cumplir; \`ask\` se delega

Distinción que importa más que cualquier regla de esta lista:

- **\`deny\` lo hace cumplir el hook.** El motor devuelve \`deny\`, el harness
  corta, y la operación no ocurre. No hay modo de sesión que lo saltee.
- **\`ask\` se lo delega al harness.** El motor dice "esto necesita un humano" y
  el harness decide cómo pedirlo. Si la sesión corre en un modo que
  auto-aprueba —auto-accept, bypass, \`--dangerously-skip-permissions\`— el
  \`ask\` se aprueba solo, sin prompt visible. Queda registrado en
  \`audit.log\` como \`ask\`, pero el comando corre.

O sea: **todo lo marcado 🟡 \`ask\` acá es advertencia, no barrera**, y su valor
depende del modo de permisos con el que se corra el agente. Si algo tiene que
quedar impedido sí o sí, tiene que ser \`deny\` en \`policy.yaml\` — editar el
\`action\` de la regla es un cambio de una palabra.

Verificado en campo (2026-09-04): en una sesión con prompts activos, las tres
reglas \`ask\` del core preguntaron y esperaron la respuesta del humano. El
tier funciona; lo que depende del modo es si se llega a preguntar.

**Corolario para validar esto:** un agente **no puede** verificar el tier
\`ask\` por su cuenta. El prompt va al humano, y una vez aprobado la tool call
simplemente tiene éxito — desde el agente, un \`ask\` aprobado y un \`allow\`
son idénticos. Sólo el humano puede confirmarlo. \`SELF_TEST_PROMPT.md\` está
escrito así a propósito: esas filas se marcan "needs human confirmation", no
✅ ni ❌.

## 1. Comandos bloqueados — reglas core (agnósticas al lenguaje)

Aplican siempre, sin importar el stack detectado.

${table(
  ["Patrón", "Acción", "Motivo"],
  CORE_BLOCKED_COMMANDS.map((r) => [`\`${r.pattern}\``, actionBadge(r.action), r.reason])
)}

## 2. Rutas protegidas — core

${table(["Patrón"], CORE_PROTECTED_PATHS.map((p) => [`\`${p}\``]))}

## 3. Reglas extra por stack

Cada stack detectado agrega sus propios \`blocked_commands\` y sus propios
\`required_checks\`. Se combinan (no reemplazan) con las reglas core. En un
monorepo con más de un stack, se suman las de todos.

${Object.entries(STACKS)
  .map(([key, s]) => {
    const blocked = s.extraBlocked.length
      ? table(
          ["Patrón", "Acción", "Motivo"],
          s.extraBlocked.map((r) => [`\`${r.pattern}\``, actionBadge(r.action), r.reason])
        )
      : "_(sin reglas extra de comandos)_";
    const checks = table(
      ["Check", "Comando"],
      s.checks.map((c) => [c.name, `\`${c.command}\``])
    );
    return `### \`${key}\` — ${s.label}

Detectado por: ${s.markers.map((m) => `\`${m}\``).join(", ")}

**Comandos bloqueados extra:**

${blocked}

**Checks de completion gate:**

${checks}

**Extensiones que disparan el gate:** ${s.changedExtensions.map((e) => `\`${e}\``).join(", ")}
`;
  })
  .join("\n")}

## 4. Archivos de ignore no estándar soportados

Se leen del root del repo, en vivo (no hace falta reinstalar para que un
cambio tome efecto). Sintaxis estilo gitignore, con una excepción
deliberada: **las líneas \`!negación\` no se honran** — un archivo de ignore
del propio repo nunca puede *reducir* protección, solo sumarla.

${table(["Archivo"], KNOWN_IGNORE_FILES.map((f) => [`\`${f}\``]))}

## 5. Infraestructura auto-protegida (\`deny\` al escribir/borrar, \`allow\` al leer)

Un comando de shell que **modificaría** cualquiera de estas rutas (\`rm\`,
\`mv\`, \`>\`, \`sed -i\`, \`chmod\`, \`tee\`, \`patch\`...) también da \`deny\`.
Uno que sólo las **nombra** da \`ask\`, porque el tokenizer no es un parser de
shell y no puede probar que sea lectura.

**Excepción: \`.github/workflows/**\`.** Escribirla sigue denegado por las
cuatro vías, pero nombrarla en un comando de shell no pide permiso. Es donde
cualquiera mira para responder "cómo funciona el CI acá", así que agentes y
humanos la listan y la leen todo el tiempo — y el comportamiento anterior no era
ni coherente: \`ls .github/workflows/\` pasaba y \`ls .github/workflows/*.yml\`
preguntaba, porque un directorio pelado no matchea un glob \`/**\`. Preguntar
arbitrariamente sobre inspección normal es cómo se entrena a alguien a aprobar
prompts sin leerlos.

- \`.agent-security/**\`
- \`.claude/settings*.json\`, \`.claude/hooks/**\`
- \`.agents/hooks.json\`
- \`.github/hooks/**\`
- \`.husky/**\`
- \`.github/workflows/**\`
- Todos los archivos de ignore listados en la sección 4

Cubre tanto tool calls estructuradas (\`Write\`/\`Edit\` con \`file_path\`) como
comandos de shell que referencien esas rutas (\`rm .cursorignore\`).

## Qué NO cubre nada de esto

Ver la sección "What this does NOT do" / "What 'protected' actually
covers" de \`.agent-security/README.md\` (se instala junto con el resto) —
en resumen: esto es un gate de políticas evaluado por regex/paths, no un
sandbox. Un agente con motivación activa de evadirlo puede, en principio,
ofuscar nombres de archivo, usar una tool que este kit no hookea, o leer
variables de entorno ya cargadas en el shell. Esta capa sube el costo y
deja rastro de auditoría (\`.agent-security/audit.log\`); no reemplaza
aislamiento a nivel OS/contenedor ni el hecho de no darle al agente
credenciales de producción.
`;

const outPath = path.join(__dirname, "RULES.md");
fs.writeFileSync(outPath, out);
console.log(`RULES.md generado (${out.length} bytes).`);
