# Prerequisites

## Use MEMO Tools

| Required | Purpose |
| --- | --- |
| Node.js 26 or later | Run the `memo` command |
| npm, pnpm, or Yarn | Install `@memoarchitect/tools` |

`@memoarchitect/tools` installs the compatible MEMO Ontology package. A
separate ontology checkout is not required.

The default parser and validator are included in MEMO Tools. SysIDE and
`sysand` are optional:

| Optional tool | Needed when |
| --- | --- |
| SysIDE | A project selects `syside` as its external compiler |
| [`sysand`](https://docs.sysand.org/) | A project selects `sysand` for package creation or SysAnd-specific exchange |

When selected, the executable must be available on `PATH` or configured in the
project's `memo.package.yaml`.

## Build or contribute to MEMO Tools

| Required | Purpose |
| --- | --- |
| Git | Clone the repository |
| Node.js 26 or later | Build and test Tools |
| pnpm 9.15 | Install the locked development dependencies |
| Python 3 | Build the documentation |

Install the documentation dependencies with:

```bash
python3 -m pip install "mkdocs>=1.6" "mkdocs-material>=9.5" "pymdown-extensions>=10.0"
```

Continue to [Install and Create a Project](install.md).
