# Command reference

MEMO has two command-line programs. **`memo`** (MEMO Tools) compiles, validates and packs.
**`memo-architect`** (MEMO Architect) does everything else a person does with a project:
create it, author it, package and export it, choose its compiler, and the AI and
regulatory helpers. Run `memo --help` or `memo-architect --help` for the installed
version's authoritative list and `<command> --help` for every option. Example and
template choices are discovered from the installed ontology content manifest:

```bash
memo-architect init --list       # packages, templates, and examples
```

A command that moved or only repeated another keeps its old name for one release: it
fails, and names its replacement (`memo init` is `memo-architect init`; `memo rules list`
is `memo validate --rules`; `memo inspect <id>` is `memo compile --inspect <id>`;
`memo toolchain probe` is `memo compile --probe`; `memo config effective` is
`memo compile --effective`; `memo standards check` is `memo validate --standards`;
`memo examples` and `memo templates` are `memo-architect init --list`;
`memo check` and `memo round-trip` are `memo compile`, since the selected compiler is the
authority on whether SysML is valid; `memo conformance` graded MEMO's own compiler, which is gone).

## `memo`: compile, validate and pack

| Command | Purpose |
|---|---|
| `memo compile [dir]` | Check the project is valid SysML with the compiler `toolchain.compiler` selects (stage 1). No MEMO rules. A compiler that builds the model keeps its output in `.memo/stage1/`. `--out <file>` writes the compiled model for the analysis notebooks. |
| `memo compile --inspect <id>` | Show a model element or relationship (`--provenance` for where it is declared). |
| `memo compile --probe [dir]` | Resolve each toolchain role to a provider and report its executable and version. |
| `memo compile --effective [dir]` | Print the settings in effect, after flags and the environment are applied; an unset role is reported as not configured. |
| `memo validate [dir]` | Evaluate closure rules and completeness; supports `text`, `junit`, and `json`. Reuses a fresh `memo compile`; a stage 1 error stops it before any rule runs. |
| `memo validate --rules` | List the consistency rules in effect (`--rules-domain`, `--rules-category`; `--format json`). |
| `memo validate --explain-rule <id>` | Show one rule in detail. |
| `memo validate --standards` | Report clause coverage: required, claimed, evidenced (`--standard`, `--regime`, `--gaps-only`). |
| `memo pack` | Package the project or package you are in with `toolchain.packager`. `internal` writes MEMO's own `.memo-bundle` (not a KPAR). `sysand` writes a real KPAR, `<name>-<version>.kpar`: it stages only the SysML the project or package declares as its own (a package's `sysmlDir`, a project's `include` and `entrypoint`), writes `.project.json` from `memo.package.yaml` and the libraries the project imports, has `sysand include` index and checksum the files, and runs `sysand build`. Nothing is written into the project; examples, templates, other packages and the libraries it imports are not bundled. |
| `memo toolchain check [paths...]` | Run the selected validator over SysML paths, less the project's `validator-exceptions.json`. |
| `memo ship-library [dir]` | Export a package's compiled library set, for the package to carry. |

## `memo-architect`: everything else

| Command | Purpose |
|---|---|
| `memo-architect dev`, `build`, `--example <id>` | Open the workbench, build a static viewer, or open a bundled example. |
| `memo-architect init [name]` | Create a project from the default, a template, or a worked example. It names `opensysml` as the project's compiler. |
| `memo-architect config set\|get\|unset` | Choose the compiler: for yourself, or with `--project` for everyone on the project. |
| `memo-architect element …` | Author one element in source and recompile. |
| `memo-architect convert [dir]` | Plan (default) or apply (`--write`) a one-time conversion to the native `model/catalog/` layout; refuses collisions. |
| `memo-architect export …` | Export JSON, Graphviz DOT, or DHF artifacts. |
| `memo-architect package …`, `create-package <name>`, `install [source]`, `lock` | Inspect or import KPAR libraries; scaffold, install and lock packages. |
| `memo-architect ontology …` | Inspect or export the resolved ontology; add a local kind. |
| `memo-architect import …` | Import CSV, EA, Cameo, SysAnd, or OWL data. |
| `memo-architect ask <question>`, `generate <description>`, `mcp [init]` | The AI helpers: a model-grounded question, SysML from natural language, MCP for coding tools. |
| `memo-architect req new` | Create an EARS requirement stub. |
| `memo-architect plugin …` | List, create, or run plugins. |
| `memo-architect dhf …` | Initialize, preview, assess, snapshot, diff, redline, or draft DHF content. |
| `memo-architect rules new\|tailor\|tailoring` | Write a rule, switch rules off or re-grade them as a recorded policy, or report every tailoring. |
| `memo-architect sysand publish` | Validate and package content for SysAnd publication. |

## Project creation

```bash
memo-architect init [name] [--template <id> | --example <id>]
```

| Option | Meaning |
|---|---|
| `-t, --template <id>` | Copy a template listed by `memo-architect init --list`. |
| `--example <id>` | Copy an example listed by `memo-architect init --list`. |
| `--ontology <package>` | Select the logical ontology/profile package. |
| `--list` | List installed packages, templates, and examples, then exit. |
| `--no-install` | Do not run the project dependency installation step. |

Every initialization path, including `--template` and `--example`, creates
`analysis/Samples/README.md`, seven model-independent Jupyter notebooks, and
`analysis/memo_model.py`, through which they read the model as the project's
selected compiler builds it (`memo compile --out`); existing sample files are
never overwritten.

## Command groups

| Group | Subcommands |
|---|---|
| `export` | `json`, `dhf`, `dot` |
| `ontology` | `show`, `export owl`, `export xml`, `export sysand`, `add-kind` |
| `import` | `csv`, `csv-rel`, `template`, `diff`, `ea`, `cameo`, `sysand`, `owl` |
| `plugin` | `list`, `create`, `run` |
| `dhf` | `init`, `preview`, `status`, `snapshot`, `diff`, `redline`, `draft`, `review-packet` |
| `rules` | `list`, `explain`, `tailoring`, `tailor`, `new` |
| `toolchain` | `probe`, `check` |
| `config` | `effective` |

Every setting under `toolchain` has a generated `--toolchain.<path>` flag on
`memo compile`, `memo validate`, `memo-architect export json`, `memo pack`, `memo compile --probe`, `memo toolchain check`, `memo compile --effective`,
and `memo-architect dev`. `memo compile --probe --help` lists them for the
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

## Rules, standards and tailoring

Every rule states a **domain**: `modelling` (it keeps a model well formed
whatever the product), `medicalDevice` (a medical-device standard or guidance
asks for what it checks) or `organisation` (a rule of your own). A rule names
the clauses it enforces, and the compiler checks each exists, so a clause
that is not in a standards file is an error and not a typo that survives.

```bash
memo validate --rules --domain medicalDevice        # each rule with the clauses it enforces
memo validate --standards                          # clause coverage, then which clauses rules enforce
memo-architect rules tailoring --format markdown        # every rule a policy changed, with who and why
memo-architect rules tailor --standard "ISO 14971" --disable --rationale "not claimed" \
    --authority "QA lead" --approval DHF-12 --file model/catalog/project.sysml --dry-run
memo-architect rules new --id ORG-001 --type TwoControls --applies-to Hazard \
    --predicate "mitigates->size() >= 2" --rationale "SOP 4.1" \
    --enforces "14971 §7" --file model/catalog/project_rules.sysml --dry-run
```

You may switch off, downgrade or replace any rule, a medical-device rule
included. What the project owes is the record: `memo-architect rules tailoring` lists
every rule a policy changed with its rationale, authority and approval
reference, and notes where a medical-device rule's record lacks an authority or
an approval. It lists the policies that target no rule in the project too,
because a decision you wrote down is still yours. Only an `invariant`, a rule
the ontology's own structure depends on, cannot be tailored.

`memo-architect rules tailor` writes one policy that governs a rule (`--rule`, by id or
name), every rule that enforces a clause of a standard (`--standard`), or every
rule on a layer (`--category`). It disables the selection (`--disable`, with a
rationale) or changes its severity; a selection of several rules cannot be
replaced. A bulk policy is still one decision: the record lists it once with the
rules it reached, and a rule added later that the selection matches is covered by
it. A *category* is the layer of the rule's subject kind, spelled as a
methodology's `includedLayer` spells it (`memo_assurance_safety_risk`); that is
a different thing from the tailoring class `memo validate --rules --category` filters
by. An invariant in the selection keeps running and the command says so. A
standard is selected by the clauses its rules enforce, which a stage 1 compiler's handoff
provides. A policy by standard that reaches no rule is reported as such. `--dry-run` lists the rules the policy
would reach and writes nothing; otherwise it writes into the project binding or
methodology in `--file` through the compile-before-commit path. Architect's
Rules view offers the same choice (one rule, a standard, a layer).

`memo-architect rules new` checks a rule (a unique id and name, a kind the project
has, a condition that parses, a rationale, clauses that exist), shows what it
would flag in the model as it stands, and writes it through the same
compile-before-commit path as every authoring write: a rule the compiler
rejects never reaches the file. Write it into a file of a package the project
already includes. A methodology runs only the rules of the packages it includes,
so a rule in a new package is written and never runs. `--enforces` takes a
qualified name or `"<standard> §<number>"` (`"62304 §5.2"`). Clause numbers
and titles come from the standards files in the ontology; a medical-device rule
that traces to no clause yet is listed, not hidden.

## Common examples

```bash
memo-architect init --list
memo-architect init infusion-device --template infusion-pump
memo validate . --format junit --output validation.xml
memo-architect export json --output memo-model.json
memo-architect import csv elements.csv --dry-run
memo-architect ontology show
memo validate --standards
```
