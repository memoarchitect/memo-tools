# Import Existing Data

Import is most useful for moving an existing register into a governed model.
Preview the generated SysML before writing files.

## 1. Inspect available kinds

```bash
memo-architect ontology show
memo-architect import template elements --output elements-template.csv
memo-architect import template relationships --output relationships-template.csv
```

## 2. Map source columns

Prepare stable IDs, names, kinds, descriptions, and relevant attributes:

```csv
id,name,kind,statement,priority
NEED-001,Safe therapy,Need,Patient needs safe delivery,high
REQ-001,Flow accuracy,Requirement,The device shall deliver within the specified tolerance,high
```

Kind names must exist in the active profile. Preserve source identifiers when
they are stable and unique.

## 3. Preview

```bash
memo-architect import csv requirements.csv --dry-run
```

Review:

- element kinds;
- sanitized SysML usage names;
- escaped text;
- package name;
- attributes that could not be mapped.

## 4. Generate source

```bash
memo-architect import csv requirements.csv \
  --output model/requirements/imported.sysml \
  --package imported_requirements
```

## 5. Import relationships

```csv
sourceId,targetId,type
NEED-001,REQ-001,DerivesFrom
```

```bash
memo-architect import csv-rel traceability.csv \
  --output model/traceability/imported.sysml \
  --package imported_traceability
```

Validate immediately. Importing rows creates syntax; it does not prove that
the selected kinds and relationships are correct.

## 6. Keep a model in step with another system

`import csv` writes elements once. When a requirements tool, a PLM or a test
system stays the owner of the records, import them as a **source** instead, so
the next export can be compared with what the model holds:

```bash
memo-architect import source requirements.csv --system reqtool --kind Requirement
memo-architect import source export.reqif --system reqtool --format reqif --kind Requirement
memo-architect import source trace.csv --system reqtool --format trace-matrix
```

A source's records go in one file, `model/imports/<system>.sysml`, that the import
owns and regenerates. Do not edit it; put your own elements and links elsewhere.

- **Source id.** The CSV needs a `sourceId` (or `id`) column and may have
  `revision`; ReqIF uses `IDENTIFIER` and `LAST-CHANGE`. Each record becomes an
  element with a name MEMO derives (`REQ-CS-01` is `reqCs01`) and an
  `@ExternalSource` naming the system, the source id and the revision. A record
  with no revision gets one from its content. A name is kept for as long as the
  source id exists, so links to the element keep working.
- **Re-import.** Run the same command on the new export. It lists what is new,
  what changed and what was deleted, each with the links that touch it, and
  writes the file unless you pass `--dry-run`.
- **Deleted.** A record that left the export is kept and marked
  `sourceWithdrawn`; it is never removed, so the links you wrote to it still
  compile. A record that comes back is no longer withdrawn.
- **Suspect links.** A link you author to an imported element can record the
  revision it was made against, in its body: `satisfy req1 by pump { @TraceBaseline { :>> sourceRevision = "B"; } }`.
  The link is suspect once the element's revision is no longer that one, or the
  element is withdrawn. Nothing stores that status; it is derived each time.
- **Traces from the source.** A trace matrix (`from,to,type`) or a ReqIF
  relation is written inside the source's file, without a baseline, because the
  source owns it. An export of elements alone leaves those traces in place; one
  that carries traces replaces them.

A column the kind does not declare is not written, and the command says which.
