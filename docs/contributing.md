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

Use Node.js 20 or later and pnpm 9 or later. The build runs
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
```

## Boundaries to respect

- **No UI code.** Nothing in this package may import React or DOM APIs.
- **`/browser` stays browser-safe.** No Langium, `node:*`, or server imports
  reachable from `packages/tools/src/browser` — the Architect web bundle
  builds directly against it.
- **No content knowledge in the engine.** Ontology package names, SysML
  namespace strings, archetypes, and templates come from the ontology
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
- Existing user project files (`memo.package.yaml`, `memo.lock.yaml`) must
  keep working without migration.

## Propose the change

Open a pull request that explains the workflow it improves — validate,
import, export, CI, or workbench — and note any output-format changes
explicitly. `@memoarchitect/tools` and `@memoarchitect/architect` release in
lockstep, so protocol changes land together with their Architect counterpart.
