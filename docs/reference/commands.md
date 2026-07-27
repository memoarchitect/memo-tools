# Command Map

Use `memo <command> --help` as the authoritative option reference.

| Goal | Command |
|---|---|
| List ontology templates and examples | `memo init --list` |
| Create the default starter project | `memo init <name>` |
| Create from an ontology template | `memo init <name> --template <id>` |
| Copy a worked example | `memo init <name> --example <id>` |
| Resolve/install ontology dependencies | `memo install` |
| Refresh dependency lock | `memo lock` |
| Inspect active ontology | `memo ontology show` |
| Validate model semantics and closure | `memo validate` |
| Import element rows | `memo import csv` |
| Import relationship rows | `memo import csv-rel` |
| Generate CSV templates | `memo import template` |
| Export semantic model | `memo export json` |
| Export a graph | `memo export dot` |
| Generate DHF artifacts | `memo export dhf` |
| Review DHF readiness | `memo dhf status` |
| Create a KPAR | `memo pack` |
| Inspect rule coverage | `memo rules coverage` |

The default starter includes `package.json`, `syside.toml`, and the
architecture, assurance, and artifacts source folders. `memo init` installs the
ontology into the new project's `node_modules`; use `--no-install` only when a
separate package-install step is required.

Examples:

```bash
memo --help
memo init --list
memo validate --help
memo export dhf --help
memo ontology export --help
```
