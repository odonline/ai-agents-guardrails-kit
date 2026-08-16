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

// KNOWN_IGNORE_FILES lives in ONE place — templates/common/policy_engine.py
// (it's the file that actually enforces it at runtime). Parse it out of
// there instead of keeping a second copy in JS that could drift.
function readKnownIgnoreFiles() {
  const src = fs.readFileSync(
    path.join(__dirname, "templates/common/policy_engine.py"),
    "utf8"
  );
  const match = src.match(/KNOWN_IGNORE_FILES\s*=\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error("No pude encontrar KNOWN_IGNORE_FILES en policy_engine.py");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
const KNOWN_IGNORE_FILES = readKnownIgnoreFiles();

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
   los archivos de ignore listados en (3), siempre da \`ask\`.
5. **\`required_checks\` / completion gate** — no es una restricción de
   \`PreToolUse\`, corre al final (\`Stop\`) y re-ejecuta los checks en vez de
   confiar en lo que el agente dice.

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

## 5. Infraestructura auto-protegida (siempre \`ask\` al editar/borrar)

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
