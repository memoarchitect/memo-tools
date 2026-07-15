<p align="center">
  <strong>meMO Tools</strong><br>
  <em>Model engine + CLI for the Medical Engineering Modelling Ontology</em>
</p>

<p align="center">
  Parse text-first SysML v2 into a semantic graph, run closure and consistency
  checks, and generate assurance views — <code>memo validate</code> in CI.
</p>

<p align="center">
  <code>memo-tools 0.4.2</code> &middot; MIT &middot; SysML v2 &middot; ISO 14971 &middot; IEC 62304 &middot; ISO/IEC/IEEE 42010
</p>

---

> **Status: work in progress.** meMO Tools is in the initial stages of
> development and is not yet ready for release. APIs, CLI flags, and model
> semantics may change without notice.

## Version compatibility

`memo`, `memo-tools`, and `memo-architect` share a `MAJOR.MINOR` compatibility
line. Any `0.4.x` release is intended to work with the other `0.4.x` products;
patch versions may advance independently for fixes and additive changes.

## The meMO stack

meMO is a four-layer stack — adopt what you need
(see [memoarchitect.com](https://memoarchitect.com)):

| Layer | What | Where |
|---|---|---|
| 01 Ontology | Typed SysML v2 elements, Arcadia-inspired architecture layers | [memoarchitect/memo](https://github.com/memoarchitect/memo) |
| 02 Methodology | Profiles, viewpoints, rules, workflow gates | [memoarchitect/memo](https://github.com/memoarchitect/memo) |
| **03 Tools** | **Model engine + `memo` CLI — this repo** | memoarchitect/memo-tools |
| 04 Architect | Web workbench over the same model | [memoarchitect/memo-architect](https://github.com/memoarchitect/memo-architect) |

## What the tools do

- **Parse** text-first SysML v2 into a semantic graph (Langium-based).
- **Check** native KerML closure & consistency rules — errors, warnings, completeness.
- **Analyze** change impact, DSM, and traceability across the model.
- **Generate** DHF artifacts and document-backed review views.
- **Import / export** Enterprise Architect, Cameo, OWL, CSV.

CLI verbs: `validate` · `dev` · `build` · `export` · `import` · `ontology` ·
`dhf` · `generate` · `req`

Run `memo validate` in CI and each change produces a defined re-review scope.

## Layout

```
packages/core/       @memo/core — grammar, parser, model builder, validator, serializers
packages/cli/        @memo/cli — the memo CLI (Commander.js)
tools/               ontology lint/diagram tooling, ontology viewer, VS Code extension
memo/ git submodule → memoarchitect/memo (canonical SysML content)
```

The engine reads the ontology content live from the `memo`
submodule — clone with `git clone --recurse-submodules`.

## Quickstart

Requires Node ≥ 20 and pnpm.

```bash
git clone --recurse-submodules https://github.com/memoarchitect/memo-tools.git
cd memo-tools
pnpm install && pnpm run build && pnpm run test

# live model + validation for the GPCA reference pump
pnpm run example:dev        # memo dev on memo/src/examples/gpca-pump
```

> Note: `memo dev` serves the parsed model, validation results, and the
> WebSocket model API. The browser UI it normally serves comes from
> **meMO Architect** (`@memo/web`, Layer 04) — an optional peer that is not
> part of this repo, so the root page is unavailable here until Architect
> is installed alongside. `memo build` (static site export) likewise
> requires a built `@memo/web`.

## License

MIT © 2026 memoarchitect
