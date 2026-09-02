# Vendored dependencies

This directory holds third-party code shipped **verbatim** into your project.
Nothing here is installed by a package manager, and nothing here is modified by
us — so you can verify every byte against what its authors published.

That is the point. This is a security tool: if you cannot audit what it loads on
every agent tool call, it is not doing its job.

## js-yaml

| | |
|---|---|
| Version | **4.3.2** |
| File | `js-yaml.js` (the published `dist/js-yaml.js` UMD bundle) |
| SHA-256 | `d4370eaa1b657d25595f0b426de5372de8f001661415ceac8ba043c1c06de7d2` |
| Source | `https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.2.tgz` → `package/dist/js-yaml.js` |
| Upstream | https://github.com/nodeca/js-yaml |
| License | MIT — see `js-yaml.LICENSE` |

**Why vendored instead of a dependency.** The policy engine runs inside *your*
repo, which may be a Java, PHP, or Python project with no npm workflow at all.
Requiring `npm install` inside `.agent-security/` to get guardrails would make
the guardrails conditional on a toolchain your project may not have. A single
self-contained file has no such condition.

**Why the unminified bundle.** It is 131 KB instead of 43 KB, and it is
readable. Shipping an opaque minified blob into every user's repo, as the one
thing standing between an agent and their filesystem, is not a trade we are
willing to make for 88 KB.

**Why only this file.** `dist/js-yaml.js` is a self-contained UMD bundle with
zero external `require()` calls. js-yaml's own `argparse` dependency is used
only by its CLI (`bin/js-yaml.js`), which we do not ship. So this one file is
the complete library.

**How it is used.** `policy_loader.js` calls `yaml.load()` — the v4 safe loader,
which does not construct arbitrary types. `yaml.dump()` is never called; the kit
only ever reads YAML.

### Verifying this copy

```bash
sha256sum templates/common/vendor/js-yaml.js
```

Compare against the SHA-256 above. To check it against upstream yourself:

```bash
npm pack js-yaml@4.3.2 && tar xzf js-yaml-4.3.2.tgz && sha256sum package/dist/js-yaml.js
```

### Updating

1. `npm pack js-yaml@<new-version>` and extract it.
2. Confirm the new `dist/js-yaml.js` still has no external `require()` calls:
   `grep -c 'require(' package/dist/js-yaml.js` must print `0`.
3. Copy it over `js-yaml.js` — byte-identical, no edits, no added header.
4. Copy `package/LICENSE` over `js-yaml.LICENSE` in case it changed.
5. Update the version, SHA-256, and source URL in the table above.
6. Run the payload test suite (`node .agent-security/test_policy_engine.js`, or
   `node templates/common/test_policy_engine.js` inside the kit repo) and the
   kit's own `npm test`.

Never patch the vendored file in place. If a fix is needed, take it upstream and
vendor the released version — a locally patched copy cannot be verified by
anyone, which defeats the reason it is vendored.
