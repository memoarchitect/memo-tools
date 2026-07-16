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

## External compiler checks

Projects may select SysIDE in `memo.package.yaml` or
`memo.config.yaml`. With strict diagnostics enabled, `memo validate` runs the
external check before MEMO semantic validation.

```yaml
toolchain:
  compiler: syside
  syside:
    executable: syside
    warningsAsErrors: true
    diagnose: all
```

An external parse check and a MEMO semantic check answer different questions:
the first checks valid/portable language usage; the second checks modeling
meaning and traceability.

!!! warning "Completeness is a signal, not the objective"
    Never create unsupported relationships merely to reach 100%. A documented,
    reviewed gap is safer than a false engineering claim.
