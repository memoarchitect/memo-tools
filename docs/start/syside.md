# Install and Configure SysIDE

SysIDE is Sensmetry's SysML v2 compiler. A project that sets
`toolchain.compiler: syside` uses it for both roles MEMO needs a compiler for:

| Role | What MEMO runs | Needs |
| --- | --- |---|
| Validator | the `syside check` command | `syside` on `PATH`, or `toolchain.syside.executable` |
| Lowering (stage 1) | SysIDE's Python API, which loads the project and exports it as SysML v2 API JSON | a Python that can `import syside` |

SysIDE is licensed. MEMO does not install it, and `npm install` does not provide
it. If you would rather start without it, [OpenSysML](opensysml.md) is the other
compiler MEMO supports.

## Versions

MEMO is tested against SysIDE **0.10.3** and **1.0.0**. Pin the version you
verified: 1.0 is a major release that changed the Python API, the CLI's
`--diagnose all` scope and some configuration, and Sensmetry's own notes say it
breaks models, settings and scripts written for 0.x.

| | 0.10.x | 1.0.x |
| --- | --- | --- |
| Where it comes from | the Syside desktop install, or the Modeler/CLI packages | the `syside` Python package, which includes the `syside` command |
| Python API (`import syside`) | `Model.user_docs`, `Model.stdlib_docs` | `Model.documents`, `Model.environment.documents` |
| `syside check --diagnose all` on MEMO's own sources | clean | 32 diagnostics, all in SysIDE's own bundled standard library |

MEMO reads both shapes, so a project does not change when you move between them.

## Install SysIDE 1.0

You need 64-bit Python 3.12.4 or later, `glibc` 2.31 or later on Linux, and a
SysIDE licence key. Follow Sensmetry's
[install guide](https://docs.sensmetry.com/latest/python-lib/install/) for the
package index address; its shape is:

```bash
uv auth login <index-url> --username license      # the password is your licence key
uv tool install syside --index syside=<index-url>
uv tool update-shell                              # puts ~/.local/bin on PATH
```

`uv tool install` puts the `syside` command in `~/.local/bin` and keeps its
Python in `~/.local/share/uv/tools/syside`. MEMO looks there for the interpreter
(see [Where MEMO looks for Python](#where-memo-looks-for-python)). SysIDE 1.0 is
only on Sensmetry's licensed index. The 0.x releases are on public PyPI, so
`uv tool install 'syside==0.10.3'` needs no index or licence to install (the licence is still checked when
it runs).

To try 1.0 without touching an existing install, give uv its own directories:

```bash
UV_TOOL_DIR=/tmp/syside1/tools UV_TOOL_BIN_DIR=/tmp/syside1/bin \
  uv tool install syside --index syside=<index-url>
PATH=/tmp/syside1/bin:$PATH syside version
```

### The licence key

SysIDE checks the licence each time `syside` runs or `import syside` executes.
Give it the key in one of these ways, never in a checked-in file:

```bash
export SYSIDE_LICENSE_KEY_FILE="$HOME/.config/syside/license.key"   # a file readable only by you
export SYSIDE_LICENSE_KEY=<key>                                      # or the key itself
```

Sensmetry's guide also covers the system keyring and an offline licence file for
machines that cannot reach its servers. Put the `export` in your shell profile
(`~/.bashrc` or `~/.zshrc`) so every terminal, and every tool started from one,
has it.

### Check the install

```bash
syside version                 # syside 1.0.0 <commit>
python -c "import syside; print(syside.__version__)"    # with the interpreter MEMO will use
memo compile --probe           # which compilers MEMO sees, where, and their versions
```

If `syside` is "not found", the directory holding it is not on `PATH` in that
shell. That is a shell setting, not a project one. Either fix `PATH` or name the
executable in your own settings (below).

## Configure a project

Name the compiler in the project's checked-in `memo.package.yaml` (or
`memo.tools.yaml`):

```yaml
toolchain:
  compiler: syside
  syside:
    configFile: ./syside.toml     # SysIDE's own project file; resolved from the project directory
    warningsAsErrors: true
    diagnose: all                 # all | project | external | none
```

Or switch for yourself, without editing the project:

```bash
memo-architect config set compiler syside            # yours alone
memo-architect config set compiler syside --project  # the whole project
memo-architect config get                            # which layer decided it
```

`diagnose` is SysIDE's validation scope. When you leave it out, MEMO uses `all`
with SysIDE 0.10.x and `project` with 1.0 and later: `all` adds the provider's
bundled standard library to the scope, and 1.0.0 reports diagnostics there that are
not yours to fix. `project` still checks every file in the project, including
namespace shadowing and reserved-keyword misuse. Set `diagnose` yourself to override.

Settings that belong to one machine may not be in a checked-in file. Set them in
your own settings with `memo-architect config set <setting> <value>`, with a flag,
or with a variable:

| Setting | Flag / variable | Use |
| --- | --- | --- |
| `toolchain.syside.executable` | `--toolchain.syside.executable` | the `syside` command, when it is not on `PATH` |
| `toolchain.syside.python` | `MEMO_SYSIDE_PYTHON` | the Python that can `import syside` |

### Where MEMO looks for Python

When nothing names an interpreter, MEMO takes the first of these that can
`import syside`:

1. the active virtual environment;
2. `.syside-venv`, `.venv` or `venv` in the project, then in the three directories above it;
3. `~/.venvs/syside`;
4. the `syside` tool installed with `uv tool install` (`$UV_TOOL_DIR`, else `~/.local/share/uv/tools`);
5. `python3`, then `python`, on `PATH`.

When none has it, the error lists every place that was looked at.

### `syside.toml`

SysIDE finds a project's files through `syside.toml`:

```toml
include = [
    "model",
    "node_modules/@memoarchitect/ontology/src",
]
exclude = [".memo", ".sysand", "dist", "output"]
```

A project that imports an extension (ROS, messaging and the like) also needs
`node_modules/@memoarchitect/ontology/extensions` in `include`.

!!! warning "Check that SysIDE found your files"
    With SysIDE 1.0.0 a command such as `syside check --config syside.toml model`
    printed `No files found under the given path(s)` and then `All checks passed!`
    in one project. A check that finds nothing passes. Read the output, or run
    `memo toolchain check`, which reports how many files it checked.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `syside: command not found` | The command's directory is not on `PATH` in this shell. Fix `PATH`, or set `toolchain.syside.executable`. |
| `No SysML compiler is configured` | Neither the project nor your settings name one. Set `toolchain.compiler`. |
| `SysIDE stage 1 could not run with "python3"` | That interpreter cannot `import syside`. Set `MEMO_SYSIDE_PYTHON`, or install into one of the places listed above. |
| `AttributeError: … 'stdlib_docs'`, `'user_docs'` or `'full_message'` | An older MEMO against SysIDE 1.0. Update `@memoarchitect/tools`. |
| A licence error on `import syside` | No valid key reached the process. Check `SYSIDE_LICENSE_KEY_FILE` in the shell that started MEMO. |
| Errors that mention `@MemoIdentity` or other MEMO names | The ontology was not loaded. Check `include` in `syside.toml`, and restart the SysIDE language server after editing it. |
| Errors in the SysIDE standard library under `--diagnose all` | SysIDE 1.0.0's own library. MEMO checks `project` by default on 1.0; remove an explicit `diagnose: all`. |
