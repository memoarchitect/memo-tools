<p align="center">
  <strong>meMO Tools</strong><br>
  <em>Model engine + CLI for the Medical Engineering Modelling Ontology</em>
</p>

<p align="center">
  Parse text-first SysML v2 into a semantic graph, run closure and consistency
  checks, and generate assurance views — <code>memo validate</code> in CI.
</p>

<p align="center">
  <code>memo-tools 0.4.4</code> &middot; MIT &middot; SysML v2 &middot; ISO 14971 &middot; IEC 62304 &middot; ISO/IEC/IEEE 42010
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

Memo Tools is one npm package with internal engine, CLI, and maintainer-tool
modules. The UI lives in Memo Architect; editor functionality belongs to a
user's SysML v2 editor rather than a MEMO-specific VS Code extension.

| Surface | Purpose | Typical use |
|---|---|---|
| `@memoarchitect/tools` | Parser, semantic model, validation, analysis, project operations, document tooling, and the `memo` CLI | Reused by the CLI and Memo Architect server |
| `tools/ontology-tools` | Internal dependency-free repository checks (not an npm package) | Maintainers validating ontology structure and editor portability |

### CLI usage

```bash
# Create and inspect a project
memo init my-device
memo ontology show

# Validate locally or in CI
memo validate .
memo validate . --format junit --output validation.xml

# Exchange and publish model data
memo export json --output model.json
memo export dot --output model.dot
memo import csv elements.csv
memo ontology export owl --output ontology.ttl
memo pack --output model.kpar
memo sysand publish --dry-run

# Generate assurance artifacts
memo dhf status
memo export dhf --format docx --output dhf-output
memo rules coverage
```

Run `memo --help` or `memo <command> --help` for the complete command surface.

## Documentation

The [task-oriented documentation](docs/index.md) starts with installation and a
first useful workflow, then covers validation, import, export, CI, configuration,
and the library API. Build it locally with:

```bash
python3 -m pip install "mkdocs>=1.6" "mkdocs-material>=9.5" "pymdown-extensions>=10.0"
pnpm run docs:build
```

### Compiler and packager selection

Projects may select external tools in `memo.package.yaml` or
`memo.config.yaml`. Omit `toolchain` (or use `internal`) to preserve MEMO's
built-in parser and KPAR writer.

```yaml
toolchain:
  compiler: syside       # internal | syside
  packager: sysand       # internal | sysand
  syside:
    executable: ~/.local/bin/syside
    configFile: ./syside.toml
    warningsAsErrors: true  # default: true
    diagnose: all           # default: all; all | external | project | none
  sysand:
    executable: ~/.local/bin/sysand
    configFile: ./sysand.toml
```

`memo validate` and `memo pack` run `syside check --diagnose all
--warnings-as-errors` by default before MEMO's semantic validation, automatically
including the resolved ontology directories. Set `warningsAsErrors: false` or use
`diagnose: none` to relax the check. `memo pack` delegates
archive creation to SysAnd when selected. Relative executable and config paths
resolve from the project directory; bare executable names resolve through `PATH`.

### Core library usage

`@memoarchitect/tools` is the reusable implementation layer. Protocol DTOs expose its
supported application boundary; the CLI is an adapter over that boundary, and
React does not import core internals directly.

```ts
import { buildMemoModel } from '@memoarchitect/tools';
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
in the sibling `memo` repository within `memo-meta`. Diagram and presentation generators are private
release/documentation machinery maintained in `memo-meta`, not product tools.

## Layout

```
packages/tools/       internal source for the root @memoarchitect/tools package
tools/ontology-tools/ internal repository lint and editor-portability checks
```

The engine resolves ontology content through its exact
`@memoarchitect/ontology` npm dependency. In `memo-meta`, pnpm links that
dependency to the sibling `memo` checkout for iterative development.

## Quickstart

Requires Node ≥ 20 and pnpm.

```bash
git clone https://github.com/memoarchitect/memo-tools.git
cd memo-tools
pnpm install && pnpm run build && pnpm run test

# validate the GPCA reference pump
pnpm run example:validate
```

Memo Tools deliberately exposes no CLI commands that require Architect.
Interactive development and static viewer builds are provided by the separate
`@memoarchitect/architect` command.

## License

MIT © 2026 memoarchitect
