# Install and Create a Project

[Check the prerequisites](prerequisites.md), including when SysIDE or `sysand`
is needed.

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
npx memo init my-device
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
python -m pip install jupyterlab syside
cd analysis
jupyter lab --port 8888
```

Syside must be configured with a valid license. The notebooks use its tolerant
loader so diagnostics can be inspected even before the model is fully clean.

## Check the resolved vocabulary

```bash
npx memo ontology show
```

This is the quickest way to see the layers, element kinds, relationships, and
rules available to the project.

## Validate immediately

```bash
npx memo validate .
```

Commit the project only after the scaffold resolves and validates in the same
environment your team will use.
