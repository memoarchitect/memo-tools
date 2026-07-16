# Command Map

Use `memo <command> --help` as the authoritative option reference.

| Goal | Command |
|---|---|
| Create a project | `memo init` |
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

Examples:

```bash
memo --help
memo validate --help
memo export dhf --help
memo ontology export --help
```
