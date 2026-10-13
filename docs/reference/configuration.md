# Project Configuration

**Settings, not meaning.** This page covers application settings: which external
tools run, where a package's source sits, how commands behave. None of it
decides what your model contains.

> Delete every YAML file in a project and the model still means exactly what it
> meant before.

What the model contains is decided in SysML — the import graph starting at
`model/catalog/project.sysml`, and the `ModelMethodBinding` there that names
the methodology. That half is documented in the ontology reference:
[Native model format](https://memoarchitect.com/memo/reference/native-model-format/).

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
# the project's settings (checked in): which compiler it uses, how it is packed, how a tool reads it
toolchain:
  compiler: syside
  packager: sysand
  syside:
    configFile: ./syside.toml
    warningsAsErrors: true
    diagnose: all
  sysand:
    configFile: ./sysand.toml
```

**You choose a compiler; MEMO finds its tools.** The project names the compiler it
uses, and `memo-architect init` writes MEMO's recommended compiler into a new project's settings
file. A user who wants another overrides it for themselves, without editing the
project, in Architect (the **Compiler** control, or `memo-architect config set compiler opensysml`), which writes their own settings
file (`~/.config/memo/settings.yaml`) and is never checked in. Where the compiler's
tools are is not something to type: OpenSysML's service comes with its npm package,
`syside` is taken from `PATH`, and SysIDE's Python is the first of these that can
`import syside`: the active virtual environment, the project's `.syside-venv`,
`.venv` or `venv` (and those of the three directories above it), `~/.venvs/syside`,
then `python3` and `python` on `PATH`. When none of them has it, the error lists
what was looked at.

```bash
memo-architect config set compiler syside              # yours alone; the project keeps opensysml
memo-architect config set compiler syside --project    # the whole project, in its checked-in file
memo-architect config get                              # the compiler, and which layer decided it
memo-architect config unset compiler                   # back to the project's
```

For an install somewhere unusual there are low-level overrides
(`toolchain.syside.python`, `syside.executable`, `opensysml.binary`,
`opensysml.service`, `opensysml.client`, `sysand.executable`; `memo-architect config get
--all` lists them). They belong to one machine, so a project's checked-in file may
not carry them: it would be wrong for everyone else, and a project that does is
refused with the setting named. Set them in your own settings, with
`memo-architect config set <setting> <value>`, or with a variable or flag. MEMO Tools
has no settings commands: it compiles and validates, and reads what Architect writes.

Run `memo compile --probe` to see which providers are registered, which binary
each resolved to, and its version. Run `memo compile --effective` to see the whole
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

### `toolchain.compiler`: one setting for the SysML compiler

`compiler` names the SysML compiler, and sets the validator and lowering roles
together:

```yaml
# the project's settings (or yours, to override it: memo-architect config set compiler syside)
toolchain:
  compiler: syside
```

With `compiler: syside`, SysIDE's Python API loads the project and hands MEMO
the model as standard SysML v2 API JSON. MEMO builds its model from that JSON,
not from its own parser. A load that reports an error stops `memo validate`:
the rules never run on a model that isn't valid SysML.

The load reports the same diagnostics as `syside check --diagnose all`, so
`memo validate` runs SysIDE once and takes the validator's findings from it.
It runs `syside check` as well only when `syside.configFile` or a narrower
`syside.diagnose` is set, since only the CLI reads those. `memo toolchain
check` always runs the CLI, because the `validator-exceptions.json` register
applies there.

`compiler: syside` is SysIDE; `compiler: opensysml` is OpenSysML. MEMO has
no compiler of its own: both produce the API JSON stage 2 builds from. There is no default: some setting must name the compiler, and
every command fails with an error saying what to set when none does. The
packager is named the same way (`toolchain.packager`), and only `memo pack`
needs it. An explicit `toolchain.validator` or `toolchain.lowering` overrides
its role.

**The project names the compiler, and you can override it.** The toolchain is read
from three layers, each beating the one before:

1. the project's settings file, which names the compiler it uses;
2. your own settings: `toolchain.compiler` in `~/.config/memo/settings.yaml`
   (`$XDG_CONFIG_HOME/memo/settings.yaml`, or `$MEMO_CONFIG_DIR/settings.yaml`),
   which `MEMO_TOOLCHAIN_COMPILER` overrides for CI and scripts;
3. the command line's `--toolchain.*` flags.

Switching compilers for yourself is one setting and edits no project. A layer that
names a `compiler` decides both roles it fills: it drops the explicit `validator`
and `lowering` the layers below it set, so `--toolchain.compiler=syside` overrides a
project that names both. With every layer silent, nothing is chosen and the command
fails, saying how to choose one.

To try a project against SysIDE without editing its settings:

```bash
memo validate --toolchain.compiler=syside --toolchain.syside.python=/path/to/python
```

The Python interpreter can also come from `MEMO_SYSIDE_PYTHON`. It needs the
same Modeler licence `syside check` does.
