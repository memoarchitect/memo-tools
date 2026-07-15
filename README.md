<p align="center">
  <strong>meMO Tools</strong><br>
  <em>Model engine + CLI for the Medical Engineering Modelling Ontology</em>
</p>

<p align="center">
  Parse text-first SysML v2 into a semantic graph, run closure and consistency
  checks, and generate assurance views — <code>memo validate</code> in CI.
</p>

<p align="center">
  <code>memo-tools 0.4.3</code> &middot; MIT &middot; SysML v2 &middot; ISO 14971 &middot; IEC 62304 &middot; ISO/IEC/IEEE 42010
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

## Supported tools

Memo Tools intentionally has two product surfaces and one developer-only quality
toolset. The web UI lives in Memo Architect; editor functionality belongs to a
user's SysML v2 editor rather than a MEMO-specific VS Code extension.

| Surface | Purpose | Typical use |
|---|---|---|
| `@memo/core` | Parser, semantic model, validation, analysis, document, and import/export libraries | Reused by the CLI and Memo Architect server |
| `memo` / `@memo/cli` | Thin command-line wrapper over the shared core operations | Local authoring, CI validation, conversion, and automation |
| `tools/ontology-tools` | Dependency-free repository quality checks | Maintainers validating ontology structure and editor portability |

### CLI usage

```bash
# Create and inspect a project
memo init my-device
memo ontology show

# Validate locally or in CI
memo validate .
memo validate . --format junit --output validation.xml

# Run the local model server used by Memo Architect
memo dev --port 3000

# Exchange and publish model data
memo export json --output model.json
memo export dot --output model.dot
memo import csv elements.csv
memo ontology export owl --output ontology.ttl
memo sysand publish --dry-run

# Generate assurance artifacts
memo dhf status
memo export dhf --format docx --output dhf-output
memo rules coverage
```

Run `memo --help` or `memo <command> --help` for the complete command surface.

### Core library usage

`@memo/core` is the reusable implementation layer. New behavior should be added
there first and exposed through protocol DTOs; the CLI remains a thin adapter,
and React does not import core internals directly.

```ts
import { buildMemoModel } from '@memo/core';
```

The API is pre-stable. Pin an exact `0.4.x` patch when embedding it directly.

### Maintainer checks

```bash
pnpm run ontology:lint    # naming, inheritance, and ontology policy checks
pnpm run ontology:compat  # static SysML v2 / SysIDE portability checks
pnpm run build
pnpm run test
pnpm run type-check
```

The authoritative external parse/package validation remains the `sysand` build
in the nested `memo` repository. Diagram and presentation generators are private
release/documentation machinery maintained in `memo-meta`, not product tools.

## Layout

```
packages/core/       @memo/core — grammar, parser, model builder, validator, serializers
packages/cli/        @memo/cli — the memo CLI (Commander.js)
tools/ontology-tools repository lint and editor-portability checks
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
