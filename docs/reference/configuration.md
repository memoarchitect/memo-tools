# Project Configuration

Projects use `memo.package.yaml` or `memo.config.yaml` to identify
their content package/profile and toolchain.

## Select the modeling profile

```yaml
extends: "@memo/medical-modeling-profile"
```

The lock file records the resolved dependency graph. Commit it when your team
needs repeatable resolution.

## Select external tools

```yaml
toolchain:
  compiler: syside       # internal | syside
  packager: sysand       # internal | sysand
  syside:
    executable: syside
    configFile: ./syside.toml
    warningsAsErrors: true
    diagnose: all
  sysand:
    executable: sysand
    configFile: ./sysand.toml
```

Relative paths resolve from the project directory; bare executable names resolve
through `PATH`.

Use the internal compiler and packager for the simplest local workflow. Select
external tools when their compatibility or packaging behavior is part of the
project's required evidence.
