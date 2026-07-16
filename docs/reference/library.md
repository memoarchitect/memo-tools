# Library API

Use `@memo/tools` when an application needs the same parser, semantic model,
validation, analysis, document, and project operations as the CLI.

```ts
import { buildMemoModel } from '@memo/tools';
```

The API is pre-stable. Pin an exact compatible patch version and wrap calls
behind your own application boundary.

Prefer the CLI when:

- a shell command is sufficient;
- the output feeds CI or another process;
- you want the supported command contract.

Prefer the library when:

- you need an in-process semantic graph;
- you are building a custom analysis or UI;
- repeated parsing or direct typed access matters.

Browser-safe exports are available through `@memo/tools/browser`; inspect the
package exports and generated type declarations for the exact release contract.
