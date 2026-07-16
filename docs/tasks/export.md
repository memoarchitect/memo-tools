# Export and Share

Choose an output based on the consumer.

| Consumer | Command | Output |
|---|---|---|
| Script or data pipeline | `memo export json` | Semantic model JSON |
| Graph tooling | `memo export dot` | Graphviz DOT |
| Design-history review | `memo export dhf` | HTML, Markdown, or DOCX documents |
| SysML package consumer | `memo pack` | KPAR archive |
| Ontology consumer | `memo ontology export` | OWL or SysAnd-oriented output |

## Model exports

```bash
memo export json --output build/model.json
memo export dot --output build/model.dot
```

## Design History File outputs

Check readiness before generation:

```bash
memo dhf status
memo export dhf --format html --output build/dhf
memo export dhf --format docx --output build/dhf-docx
```

Generated documents reflect model content. Review and approve them through your
quality process; generation is not approval.

## Package the model

```bash
memo pack --output build/my-device.kpar
```

If `toolchain.packager` is `sysand`, packaging delegates to SysAnd. Keep the
toolchain version and project configuration with release evidence so the
artifact can be reproduced.
