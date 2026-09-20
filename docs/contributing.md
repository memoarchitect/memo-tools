# Contributing

Memo Tools contains reusable non-UI libraries, project operations, and the
`memo` CLI. Ontology and methodology content belongs in
[memo](https://github.com/memoarchitect/memo); React presentation code belongs
in [memo-architect](https://github.com/memoarchitect/memo-architect).

## Set up

```bash
git clone https://github.com/memoarchitect/memo-tools.git
cd memo-tools
corepack enable
pnpm install
pnpm run build
pnpm run test
```

Use Node.js 26 or later and pnpm 9 or later. The build runs
`langium generate` before `tsc`, so grammar changes under
`packages/tools/src/grammar` are picked up automatically.

## Maintainer checks

Run the full set before opening a pull request:

```bash
pnpm run ontology:lint     # ontology content conventions
pnpm run ontology:compat   # compatibility against the pinned ontology
pnpm run build
pnpm run type-check
pnpm run test              # vitest: parser, validation, commands, E2E
pnpm run example:validate  # the GPCA example must still validate
pnpm run check:baselines   # the reference projects' frozen semantic output
```

## The element census

`pnpm run test` counts every shipped example — elements per file and per kind,
relationships per type, packages, parse errors — and compares the result against
the frozen counts in `packages/tools/src/__tests__/fixtures/census/`. A count
that goes **down** fails the run.

It is there because nothing else notices content leaving the model. Violations
fall when the elements carrying them disappear and completeness rises when the
incomplete ones do, so a silent drop reads as progress: measured 2026-09-19, a
file that built 2 elements instead of 124 was reported as "92% complete, 1583
violations, 32 rules passed", down from 1595.

A count going **up** is printed and passes — adding content to an example is
ordinary work. Re-freeze after it, so the baseline does not sit stale-low:

```bash
pnpm run build && pnpm run census:capture
```

Re-freeze only when the difference is understood, and say in the commit message
what moved and why. The census cannot tell content you removed on purpose from
content that vanished; that judgement is the whole of what a re-freeze records.

`pnpm run check:baselines` is the finer, slower oracle beside it: it freezes
element ids and relationship endpoints for four reference projects and answers
"did anything move?", where the census answers "did anything leave?".

## Boundaries to respect

- **No UI code.** Nothing in this package may import React or DOM APIs.
- **`/browser` stays browser-safe.** No Langium, `node:*`, or server imports
  reachable from `packages/tools/src/browser` — the Architect web bundle
  builds directly against it.
- **No content knowledge in the engine.** Ontology package names, SysML
  namespace strings, templates, and examples come from the ontology
  package's manifest, never from TypeScript literals.
- **Operations first, commands second.** New behavior goes into
  `operations/` so the CLI, the dev server, and tests share one
  implementation; a command is only an adapter.
- **Errors over guesses.** Unresolvable ontology content is a loud,
  actionable error; never write a lock file whose ontology identity is the
  project itself.

See [How Tools Is Organized](architecture/index.md) for the source map these
rules protect.

## Testing expectations

- Add or update a Vitest case for every behavior change; interface tests
  define the supported contract.
- Machine-readable output (JSON, protocol events) is versioned — extending it
  is fine, breaking it needs a coordinated release.
- Pre-1.0, formats and names may break between releases without migration
  support; projects pin exact versions. Compatibility guarantees start at
  the 1.0 baseline.

## Propose the change

Open a pull request that explains the workflow it improves — validate,
import, export, CI, or workbench — and note any output-format changes
explicitly. `@memoarchitect/tools` and `@memoarchitect/architect` release in
lockstep, so protocol changes land together with their Architect counterpart.
