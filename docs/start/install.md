# Install and Create a Project

## Prerequisites

- Node.js 20 or later
- npm, pnpm, or another compatible package manager

## Install

Install the command for your project:

```bash
npm install @memo/tools
```

Then run it through your package manager:

```bash
npx memo --help
```

For a source checkout:

```bash
git clone --recurse-submodules https://github.com/memoarchitect/memo-tools.git
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
