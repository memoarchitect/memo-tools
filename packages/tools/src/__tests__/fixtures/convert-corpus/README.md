# Conversion test corpus

The input side of `memo convert`'s acceptance (design section 18.4, half A
deliverable 1). The conversion command is the only code in MEMO that rewrites a
user's authored model in bulk, so it is tested against real source rather than
only against source written to make it pass.

## `gpca-pre-native/`

A verbatim snapshot of `memo/examples/gpca-pump` at the `pre-native-s3` tag —
the last commit before the semantic flip. Extracted with:

```bash
git -C memo archive pre-native-s3 \
    examples/gpca-pump/model examples/gpca-pump/methodology examples/gpca-pump/memo.config.yaml
```

It is the real pre-conversion project the deliverable calls for, and it carries
every hazard the synthetic fixtures cannot:

- 26 view files in `model/views/`, outside the catalog entirely;
- views whose filename prefix contradicts their governing viewpoint
  (`behavior_action_flow_view.sysml` is governed by `logicalArchitectureViewpoint`,
  and the eight `document_*` views spread across six different viewpoints), so a
  filename-based grouping would misfile a third of them;
- package names carrying the `model_catalog` path segments the catalog layout
  exists to replace;
- a `memo.config.yaml` whose `methodology:` field is a package spec, which the
  flip made a hard load rejection rather than an input;
- a vendored `methodology/` package that is reusable content living inside a
  project directory, which must *not* be swept into the project catalog.

Do not regenerate it against a later tag. Its value is that it is frozen: it is
the state a user's project is actually in when they run the conversion, and a
snapshot that tracks `main` stops testing that.
