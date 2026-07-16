# How Tools Is Built

This section follows the user workflows intentionally.

Memo Tools is one npm package. Its implementation is organized under
`packages/tools`, with the CLI as an adapter over shared model and project
operations. The canonical ontology is the nested `memo` submodule.

## Maintainer checks

```bash
pnpm run ontology:lint
pnpm run ontology:compat
pnpm run build
pnpm run type-check
pnpm run test
```

Add behavior in reusable Tools services before exposing it through the CLI.
Keep command output stable and machine-readable formats version-aware. When a
command changes, update its task guide before internal architecture notes.
