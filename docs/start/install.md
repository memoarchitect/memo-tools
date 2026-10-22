# Install and Create a Project

[Check the prerequisites](prerequisites.md), including when SysIDE or `sysand`
is needed, or see [SysIDE](syside.md) and [OpenSysML](opensysml.md).

## Install

Install the command for your project:

```bash
npm install @memoarchitect/tools
```

Then run it through your package manager:

```bash
npx memo --help
```

For a source checkout:

```bash
git clone https://github.com/memoarchitect/memo-tools.git
cd memo-tools
corepack enable
pnpm install
pnpm run build
pnpm run example:validate
```

## Create a model project

```bash
npx memo-architect init my-device
cd my-device
```

The scaffold contains the active MEMO profile and starter SysML source. Keep
project-specific requirements, risks, architecture, and evidence here—not in
the installed ontology package.

It also contains `analysis/Samples/`, with ready-to-run notebooks for model
health, architecture hotspots, change impact, charts, an ownership graph, and
a model inventory table. To use them:

```bash
python -m venv analysis/.venv
source analysis/.venv/bin/activate
python -m pip install jupyterlab
cd analysis
jupyter lab --port 8888
```

The notebooks read the model through `analysis/memo_model.py`, which runs
`memo compile --out` with the compiler the project selects
(`toolchain.compiler`), so they need `memo` on `PATH` (or `MEMO_CLI`) and
whatever that compiler needs. A model loads once the compiler accepts it.

## Upgrade MEMO

A MEMO project depends on three packages that ship together:
`@memoarchitect/architect`, `@memoarchitect/tools` and `@memoarchitect/ontology`.
Pin all three to the same release.

Below 1.0, npm's caret range only lets the leftmost non-zero segment change, so a
plain `npm update` never crosses a minor version:

| Range in `package.json` | Resolves to | Does **not** include |
| --- | --- | --- |
| `^0.11.0` | `>=0.11.0 <0.12.0` | 0.12 and later |
| `^0.16.0` | `>=0.16.0 <0.17.0` | 0.17 and later |

A project pinned at `^0.11.0` therefore keeps installing 0.11.x, however many newer
releases exist. `npm install` also installs what the committed `package-lock.json`
says, and `node_modules` can lag behind `package.json`; check what is installed
rather than what is declared:

```bash
npm ls @memoarchitect/architect @memoarchitect/tools @memoarchitect/ontology
```

To move to a new release, let MEMO do it:

```bash
npx memo-architect upgrade            # the latest on npm
npx memo-architect upgrade 0.16.0     # a named release
npx memo-architect upgrade --dry-run  # show the target, change nothing
npx memo-architect upgrade --sync-only  # align package.json to the Architect already installed
```

It installs `@memoarchitect/architect`, `tools` and `ontology` at that release (or at the
tools and ontology versions Architect declares, when they differ), pins all three in
`package.json`, runs `npm install` and regenerates `memo.lock.yaml` with the new release.
Every `memo` and `memo-architect` command also warns when an installed package falls outside
the range `package.json` pins, and names `npm install` and `memo-architect upgrade` as the
fixes; a linked workspace checkout is not warned about.

Then run `npx memo validate .` and read the [release notes](../release-notes.md) if the
ontology changed. Use `npm ci` in CI so installs match the lock file.

## Check the resolved vocabulary

```bash
npx memo-architect ontology show
```

This is the quickest way to see the layers, element kinds, relationships, and
rules available to the project.

## Validate immediately

```bash
npx memo validate .
```

Commit the project only after the scaffold resolves and validates in the same
environment your team will use.
