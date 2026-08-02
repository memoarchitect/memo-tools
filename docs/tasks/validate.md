# Validate a Model

Use validation during authoring, review, and CI.

```bash
memo validate [project-directory]
```

## Interactive use

```bash
memo validate .
```

Start with errors, then review warnings. For each finding:

1. locate the element and rule;
2. decide whether the engineering information is missing or modeled with the
   wrong type or relationship;
3. correct the source;
4. rerun validation.

## Machine-readable results

```bash
memo validate . --format json --output validation.json
memo validate . --format junit --output validation.xml
```

Use JSON for custom reporting and JUnit for CI test reports.

## External validator checks

Projects may select SysIDE as the validator in `memo.package.yaml` or
`memo.config.yaml`. `memo validate` runs it before MEMO semantic validation and
reports its diagnostics as GNU one-liners, carrying SysIDE's own rule codes
through unchanged.

```yaml
toolchain:
  validator: syside
  syside:
    executable: syside
    warningsAsErrors: true
    diagnose: all
```

Or without editing the project, for one run:

```bash
memo validate --toolchain.validator syside
```

An external validator check and a MEMO semantic check answer different
questions: the first checks valid and portable language usage; the second checks
modelling meaning and traceability.

Diagnostics say which question they answer, in a `domain` field:

| Domain | Meaning |
|---|---|
| `sysml` | The selected validator rejected the source. |
| `memo-ingest` | The validator accepted it; MEMO could not read all of it. |
| `memo-methodology` | Valid SysML, MEMO rule violated. |

The distinction matters because MEMO's own grammar covers a subset of SysML. A
file SysIDE accepts that MEMO cannot fully read is an ingest gap, reported as
`memo-ingest` — never as a SysML error, and never as a reason to show you
nothing.

Suppress and configure by a diagnostic's `code`, never by matching its message
text. Codes are stable across releases; messages are not.

!!! warning "Completeness is a signal, not the objective"
    Never create unsupported relationships merely to reach 100%. A documented,
    reviewed gap is safer than a false engineering claim.
