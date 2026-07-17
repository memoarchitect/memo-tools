# Run in CI

CI should install locked dependencies, build Tools, validate the model, and
publish a machine-readable report.

## GitHub Actions

```yaml
name: Model validation
on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - run: pnpm memo -- validate . --format junit --output validation.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: model-validation
          path: validation.xml
```

## GitLab CI

```yaml
model-validation:
  image: node:22
  script:
    - corepack enable
    - pnpm install --frozen-lockfile
    - pnpm run build
    - pnpm memo -- validate . --format junit --output validation.xml
  artifacts:
    when: always
    reports:
      junit: validation.xml
```

Adjust the validation directory when the product model is not at repository
root. Pin external compiler and packager versions where reproducibility matters.
