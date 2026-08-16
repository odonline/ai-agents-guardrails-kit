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
Corré los tests después:

```bash
node install.js --target /tmp/test --agents claude-code --stacks node --yes
python3 -m pytest /tmp/test/.agent-security/test_policy_engine.py -q
```
