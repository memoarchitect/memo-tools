# How Tools Is Built

Memo Tools is one npm package. Its implementation is organized under
`packages/tools`, with the CLI as an adapter over shared model and project
operations. The canonical ontology is the `@memoarchitect/ontology` dependency;
`memo-meta` links it to a sibling source checkout during coordinated development.

## Maintainer checks

```bash
pnpm run ontology:lint
pnpm run ontology:compat
pnpm run build
pnpm run type-check
pnpm run test
```

Reusable Tools services provide model behavior to the CLI and Architect.
Command output is stable at the supported interface boundary, and
machine-readable formats carry version-aware contracts. Task documentation and
interface tests describe the supported behavior.
