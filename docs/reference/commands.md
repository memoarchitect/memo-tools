# Command reference

Run `memo --help` for the installed version's authoritative command list and
`memo <command> --help` for every option. Example and template choices are
discovered from the installed ontology content manifest:

```bash
memo examples
memo templates
memo init --list       # packages, templates, and examples together
```

## Top-level commands

| Command | Purpose |
|---|---|
| `memo validate [dir]` | Evaluate closure rules and completeness; supports `text`, `junit`, and `json`. |
| `memo init [name]` | Create a project from the default, a template, or a worked example. |
| `memo convert [dir]` | Plan (default) or apply (`--write`) a one-time conversion to the native `model/catalog/` layout; refuses collisions. |
| `memo examples` | List worked-example IDs accepted by `memo init --example`. |
| `memo templates` | List project-template IDs accepted by `memo init --template`. |
| `memo pack` | Build a Knowledge Package Archive (`.kpar`). |
| `memo export …` | Export JSON, Graphviz DOT, or DHF artifacts. |
| `memo create-package <name>` | Scaffold an ontology, profile, library, or device package. |
| `memo install [source]` | Install locked content or add a Git, npm, or local package. |
| `memo lock` | Regenerate `memo.lock.yaml`. |
| `memo ontology …` | Inspect or export the resolved ontology; add a local kind. |
| `memo import …` | Import CSV, EA, Cameo, SysAnd, or OWL data. |
| `memo ask <question>` | Ask a model-grounded natural-language question. |
| `memo mcp [init]` | Serve MCP or register it with an AI coding tool. |
| `memo generate <description>` | Generate SysML from natural language. |
| `memo req new` | Create an EARS requirement stub. |
| `memo plugin …` | List, create, or run plugins. |
| `memo dhf …` | Initialize, preview, assess, snapshot, diff, redline, or draft DHF content. |
| `memo sysand publish` | Validate and package content for SysAnd publication. |
| `memo check [dir]` | Check SysML v2 tool compatibility. |
| `memo round-trip [dir]` | Predict round-trip conformance for SysON, SysIDE, or Cameo. |
| `memo rules …` | List, check, explain, and report coverage for consistency rules. |
| `memo toolchain probe [dir]` | Resolve each toolchain role to a provider and report its executable and version. |
| `memo toolchain check [paths...]` | Run the selected validator over SysML paths, less the project's `validator-exceptions.json`. |
| `memo config effective [dir]` | Print settings after flags, `toolchain.compiler`, and defaults are applied. |
| `memo conformance run [dir]` | Run the toolchain over the pinned SysML v2 Release corpus and count diagnostics by domain. |
| `memo conformance diff-xmi [dir]` | Compare MEMO's computed semantics for a normative library against the Release `xmi.implied` file. |

## Project creation

```bash
memo init [name] [--template <id> | --example <id>]
```

| Option | Meaning |
|---|---|
| `-t, --template <id>` | Copy a template listed by `memo templates`. |
| `--example <id>` | Copy an example listed by `memo examples`. |
| `--ontology <package>` | Select the logical ontology/profile package. |
| `--list` | List installed packages, templates, and examples, then exit. |
| `--no-install` | Do not run the project dependency installation step. |

Every initialization path, including `--template` and `--example`, creates
`analysis/Samples/README.md` and seven model-independent Jupyter notebooks.
They use Syside to discover and query the project's nearest `model/` or `src/`
tree; existing sample files are never overwritten.

## Command groups

| Group | Subcommands |
|---|---|
| `export` | `json`, `dhf`, `dot` |
| `ontology` | `show`, `export owl`, `export xml`, `export sysand`, `add-kind` |
| `import` | `csv`, `csv-rel`, `template`, `diff`, `ea`, `cameo`, `sysand`, `owl` |
| `plugin` | `list`, `create`, `run` |
| `dhf` | `init`, `preview`, `status`, `snapshot`, `diff`, `redline`, `draft`, `review-packet` |
| `rules` | `list`, `check`, `explain`, `coverage` |
| `toolchain` | `probe`, `check` |
| `config` | `effective` |
| `conformance` | `run`, `diff-xmi` |

Every setting under `toolchain` has a generated `--toolchain.<path>` flag on
`memo validate`, `memo pack`, `memo toolchain probe`, `memo toolchain check`, `memo config effective`,
and `memo-architect dev`. `memo toolchain probe --help` lists them for the
installed provider set.

## Validator check

```bash
memo toolchain check src extensions examples               # the configured validator
memo toolchain check --toolchain.validator=syside src      # choose the engine for this run
memo toolchain check --project ../memo --exceptions other.json src
```

Runs only the selected validator — no MEMO rule — over the named files and
directories, and fails on any error or warning. It is how scripts ask whether
SysML passes the validator, so switching engines is one flag rather than an
edit to each script.

| Option | Meaning |
|---|---|
| `-p, --project <dir>` | Directory whose settings select the provider; paths and the register are relative to it. Default `.`. |
| `--exceptions <file>` | Exceptions register. Default `validator-exceptions.json` in the project. |

**Exceptions.** The OMG SysML v2 specification defines valid SysML; a validator
checks compatibility with it. Where a provider rejects what the specification
admits, the source keeps the specification's form and the case is listed in
`validator-exceptions.json`:

```json
{ "exceptions": [ {
  "id": "conjugated-port-typing",
  "provider": "syside",
  "file": "src/ports.sysml",
  "code": "syntax-error",
  "spec": "SysML-textual-bnf.kebnf:652 ConjugatedPortTyping",
  "providerVersion": "0.10.2",
  "board": "the KANBAN row tracking it",
  "note": "what the provider reports, in words"
} ] }
```

An entry excuses one provider's diagnostic code in one file, matched by code
rather than message so it survives a provider upgrade. Entries for another
provider are ignored, and an entry for the provider that ran which matched
nothing fails the check as stale, so the register cannot outlive the gap.

## Conformance

Both subcommands read the corpus vendored at `corpus/sysml-v2-release/` — a
pinned, checksummed copy of the OMG's published libraries, XMI serializations,
grammars, and example models. Every result carries the pinned Release commit and
the corpus digest.

```bash
memo conformance run                                  # every unit
memo conformance run --unit library/systems-library   # one unit; a prefix selects a group
memo conformance diff-xmi --library Parts.sysml
memo conformance run --baseline                       # fail on any count that moved
memo conformance run --update-baseline                # re-freeze after a deliberate change
```

| Option | Meaning |
|---|---|
| `--corpus <dir>` | Use a corpus other than the vendored one. |
| `--unit <id...>` | Corpus units to run. A prefix such as `library` selects the group. |
| `--library <path...>` | Library sources to compare, by corpus-relative path or bare filename. |
| `--verify <scope>` | Checksum scope before running: `sources`, `full`, `skipped`. |
| `--baseline [file]` | Compare against a frozen baseline and exit non-zero on any change. |
| `--update-baseline` | Re-freeze the baseline from this run. |
| `--format <format>` | `text` or `json`. |

`run` exercises both the validator and the lowering role over the same file set,
which is what makes the `sysml` and `memo-ingest` counts a measurement rather
than a label. When one provider fills both roles, an ingest failure the
validator already reported is counted once, under `sysml`.

A baseline is refused rather than compared when the corpus pin differs, so
moving the pin never reads as a regression. A count that *improved* also fails
the gate: re-freezing is deliberate and reviewable.

Neither subcommand is reachable from `validate`, `dev`, `build`, or an Architect
refresh — they grade MEMO against the OMG's files, not against your project.

## Common examples

```bash
memo templates
memo init infusion-device --template infusion-pump
memo validate . --format junit --output validation.xml
memo export json --output memo-model.json
memo import csv elements.csv --dry-run
memo ontology show
memo rules coverage
memo check . --sysml-compat
```
