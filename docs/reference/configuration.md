# Project Configuration

**Settings, not meaning.** This page covers application settings: which external
tools run, where a package's source sits, how commands behave. None of it
decides what your model contains.

> Delete every YAML file in a project and the model still means exactly what it
> meant before.

What the model contains is decided in SysML — the import graph starting at
`model/catalog/project.sysml`, and the `ProjectMethodBinding` there that names
the methodology. That half is documented in the ontology reference:
[Native project format](https://memoarchitect.com/memo/reference/native-project-format/).

`memo.config.yaml` is gone, along with `extends:`, `methodology:`, `ontologies:`
and `modules:`. They selected model content from a file no conformant SysML v2
tool reads. A project that still carries one gets a diagnostic naming the native
construct that replaced the field — it is never read as a fallback:

```text
memo.package.yaml: `extends` is not read.
  Write a native `private import` of the package in model/catalog/project.sysml.
```

## The files MEMO reads

| File | What it is for |
| --- | --- |
| `memo.tools.yaml` | This page: toolchain selection, executable paths, command behaviour |
| `memo.package.yaml` | Locator only — `name`, `version`, `description`, `license`, `tags`, `sysmlDir`. Settings may also be read from here when there is no `memo.tools.yaml` |
| `memo.lock.yaml` | Generated: the packages, versions and hashes the imports resolved to |
| `syside.toml`, `.project.json` | External tool adapters |

A settings file inherits nothing. There is no `extends` chain to resolve, because
inheritance was how one project's settings reached into another package's model.

The lock file records what the import graph resolved to. It cannot introduce a
package no import named. Commit it when your team needs repeatable resolution.

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
