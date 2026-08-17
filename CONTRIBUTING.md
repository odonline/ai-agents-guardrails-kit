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
},
```

Después:
```bash
node install.js --target /tmp/algún-proyecto-de-prueba --agents claude-code --stacks ruby --yes
python3 -m pytest .agent-security/test_policy_engine.py -C /tmp/algún-proyecto-de-prueba  # sanity check
```

## Agregar un nuevo agente/harness

1. Carpeta nueva en `templates/<agente>/` con su adapter (`pretooluse.py`)
   que traduzca el JSON de ese harness al formato que espera
   `policy_engine.evaluate_from_dict()`, y su archivo de config de hooks.
2. Entrada nueva en el objeto `AGENTS` de `install.js`.
3. No toques `policy_engine.py` — esa lógica es compartida por diseño; el
   adapter es la única pieza que debe conocer el formato JSON específico
   del harness.

## Cambiar reglas core (agnósticas al lenguaje)

Editar `CORE_BLOCKED_COMMANDS` / `CORE_PROTECTED_PATHS` en `generate.js`.
Corré `node docs.js` para regenerar `RULES.md` (documentación de todas las
reglas — CI falla si te olvidás de este paso) y los tests después:

```bash
node docs.js
node install.js --target /tmp/test --agents claude-code --stacks node --yes
python3 -m pytest /tmp/test/.agent-security/test_policy_engine.py -q
```

## Correr los tests después de tocar install.js / generate.js / stacks.js

`test/install.test.js` es la suite que valida el **instalador en sí**
(qué se escribe, para qué stack, según qué host git) — no confundir con
`.agent-security/test_policy_engine.py`, que valida el motor de políticas
que queda instalado en el proyecto destino. Sin dependencias externas,
corre igual en Windows/macOS/Linux:

```bash
npm test
```

Corré esto después de cualquier cambio a `install.js`, `generate.js` o
`stacks.js` — está en el pipeline (`.gitlab-ci.yml`) así que un cambio que
lo rompa no debería mergearse. Si agregás un stack nuevo o un caso de
detección de host, sumá su caso ahí también.
