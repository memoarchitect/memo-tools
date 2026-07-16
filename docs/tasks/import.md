# Import Existing Data

Import is most useful for moving an existing register into a governed model.
Preview the generated SysML before writing files.

## 1. Inspect available kinds

```bash
memo ontology show
memo import template elements --output elements-template.csv
memo import template relationships --output relationships-template.csv
```

## 2. Map source columns

Prepare stable IDs, names, kinds, descriptions, and relevant attributes:

```csv
id,name,kind,statement,priority
NEED-001,Safe therapy,StakeholderNeed,Patient needs safe delivery,high
REQ-001,Flow accuracy,SystemRequirement,The device shall deliver within the specified tolerance,high
```

Kind names must exist in the active profile. Preserve source identifiers when
they are stable and unique.

## 3. Preview

```bash
memo import csv requirements.csv --dry-run
```

Review:

- element kinds;
- sanitized SysML usage names;
- escaped text;
- package name;
- attributes that could not be mapped.

## 4. Generate source

```bash
memo import csv requirements.csv \
  --output model/requirements/imported.sysml \
  --package imported_requirements
```

## 5. Import relationships

```csv
sourceId,targetId,type
NEED-001,REQ-001,DerivesFrom
```

```bash
memo import csv-rel traceability.csv \
  --output model/traceability/imported.sysml \
  --package imported_traceability
```

Validate immediately. Importing rows creates syntax; it does not prove that
the selected kinds and relationships are correct.
