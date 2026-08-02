# Project Configuration

Projects use `memo.package.yaml` or `memo.config.yaml` to identify
their content package/profile and toolchain.

## Select the methodology

```yaml
extends: "@memoarchitect/methodology-default"
```

The lock file records the resolved dependency graph. Commit it when your team
needs repeatable resolution.

## Select external tools

Each **role** is filled by one provider. The roles answer different questions,
so they are selected separately:

| Role | Question it answers | Setting |
|---|---|---|
| Validator | "Is this valid SysML/KerML?" | `toolchain.validator` |
| Lowering | "What can MEMO ingest from this revision?" | `toolchain.lowering` |
| Packaging | "How is this project packed?" | `toolchain.packager` |

```yaml
toolchain:
  validator: syside
  lowering: internal
  packager: sysand
  syside:
    executable: syside
    configFile: ./syside.toml
    warningsAsErrors: true
    diagnose: all
  sysand:
    executable: sysand
    configFile: ./sysand.toml
```

Run `memo toolchain probe` to see which providers are registered, which binary
each resolved to, and its version. Run `memo config effective` to see the whole
resolved picture, including which settings came from the file, which from a
flag, and which from a default.

Relative paths resolve from the project directory; bare executable names resolve
through `PATH`. A selected tool that is not installed is a clear error — MEMO
never silently falls back to a different provider.

Every setting under `toolchain` also has a command-line flag, so any project can
be checked against a different toolchain without editing its settings:

```bash
memo validate --toolchain.validator syside --toolchain.syside.diagnose all
```

Use the built-in providers for the simplest local workflow; they need nothing
installed. Select external tools when their compatibility or packaging
behaviour is part of the project's required evidence.

### `toolchain.compiler` is deprecated

`compiler` predates the split between validating and lowering. It still works
and sets both roles — but only where the named provider can fill them. SysIDE
validates and cannot emit an ingestible model, so `compiler: syside` selects it
as the validator and leaves lowering with MEMO's own parser, which is what it
always did in practice. `memo validate` prints a note saying so. Prefer the
explicit keys.
