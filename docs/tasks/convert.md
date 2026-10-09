# Convert an Old Project to the Native Layout

`memo-architect convert` upgrades a project written in MEMO's old layout (before
the August 2026 switch to native SysML) to the current one. It changes **where
files live, what their packages are called, and how the project is described**.
It does not change what the model says. Read [What it does not do](#what-it-does-not-do)
before you start: a converted project can still need edits to match the current
ontology.

It is a one-time migration. Run it once per old project.

## Do you need it?

Run it in the project directory without `--write`:

```bash
memo-architect convert .
```

If it prints `Already in the native catalog layout. Nothing to convert.`, you are
done. Your project is old if any of these is true:

| Sign | Meaning |
|---|---|
| a `memo.config.yaml` (or `memo.rules.yaml`, `memo.viewpoints.yaml`, `memo.rendering.yaml`) beside the model | the old description of the project; current MEMO rejects semantic fields in these files |
| `.sysml` files in `model/views/`, or any `model/*.sysml` outside `model/catalog/` | views and content lived outside the catalog |
| package names containing path segments such as `model_catalog_` or `model_views_` | names spelled out the old directories |
| no `model/catalog/project.sysml` | the project had no native entrypoint or method binding |
| no `memo.package.yaml` | the project was described by `memo.config.yaml` instead |

## Before and after

```text
BEFORE                                         AFTER
memo.config.yaml                               memo.package.yaml                  (created)
methodology/gpca_scope.sysml                   methodology/gpca_scope.sysml       (left in place)
model/                                         model/catalog/
  catalog/gpca_risk.sysml                        gpca_risk.sysml                  (stays; references rewritten)
  views/risk_fmea_view.sysml                     project.sysml                    (created: entrypoint + binding)
  views/logical_mode_state_view.sysml            viewpoints/risk/viewpoint.sysml  (created)
                                                 viewpoints/risk/views/risk_fmea_view.sysml
                                                 viewpoints/logical/viewpoint.sysml (created)
                                                 viewpoints/logical/views/logical_mode_state_view.sysml
```

Package names follow the new location, with the project's own prefix in front:

```text
memo_examples_gpca_pump_model_views_logical_mode_state_view
  → memo_examples_gpca_pump_viewpoints_logical_views_logical_mode_state_view
```

## Steps

1. **Commit or copy the project first.** `convert --write` moves and rewrites
   files in place. Version control is the undo; there is no `--undo`.

2. **Plan it. Nothing is written.**

   ```bash
   memo-architect convert .
   ```

   The plan lists *Moves*, *Rewritten in place*, *Created*, *Removed* and *Warnings*.
   Add `--diff` to see the changed lines of every rewritten file and the full text
   of every file it would create:

   ```bash
   memo-architect convert . --diff
   ```

   `--json` prints the same plan for scripts (`changes`, `newFiles`, `removals`,
   `packageRenames`, `collisions`, `warnings`).

3. **Resolve any `REFUSED` result.** If the plan reports collisions it prints all
   of them at once, writes nothing and exits 1. See [Collisions](#collisions-the-plan-is-refused).

4. **Decide about `--normalize-names`.** Files that stay where they are keep the
   package name you gave them, even if it still spells an old directory
   (`..._model_catalog_gpca_risk`). The plan warns `package-not-mirroring` for each.
   Add `--normalize-names` to rename them too (every import follows). Leave it off
   if you would rather rename by hand; it changes names you chose.

5. **Apply.**

   ```bash
   memo-architect convert . --write
   ```

   It prints `Converted: N moved, N rewritten in place, N created, N removed.`
   Running it again prints `Already in the native catalog layout`.

6. **Pick the methodology.** The old `methodology:` pin in `memo.config.yaml` is
   not carried over, because it named a package and the new binding names a
   definition inside the model. The generated `model/catalog/project.sysml` selects
   the default methodology:

   ```sysml
   part projectBinding : ProjectMethodBinding {
       ...
       ref :>> selectedMethodology = mdDefaultDefinition;
   }
   ```

   The warning for `memo.config.yaml` names the methodology it pinned. Change
   `mdDefaultDefinition` to the definition you meant (for a vendored methodology,
   one declared under `methodology/`).

7. **Choose a compiler, then compile and validate.**

   ```bash
   memo-architect config set compiler opensysml --project
   memo compile .
   memo validate .
   ```

   If errors remain, see [what it does not do](#what-it-does-not-do): they are
   likely content the current ontology no longer accepts, not layout.

## What it does

| Change | Detail |
|---|---|
| Moves files into `model/catalog/` | `model/x.sysml` → `model/catalog/x.sysml`; assets in `model/assets/` → `model/catalog/artifacts/assets/`. Files already in the catalog stay. |
| Files views by their viewpoint | A view goes to `viewpoints/<group>/views/` where `<group>` is the viewpoint its `viewpointDefinition` names, not a guess from the file name (a file called `behavior_…_view` may be governed by the logical viewpoint). |
| Creates a binding file per viewpoint | `viewpoints/<group>/viewpoint.sysml` imports the reusable viewpoint that frames the views beneath it. If the reusable package cannot be resolved, the file says so in a comment. |
| Renames packages to mirror location | Prefix, then the directory chain, then the file name (`viewpoint`, `catalog`, `index`, or a name equal to its folder add nothing). The prefix is the longest shared start of your package names. |
| Rewrites references | Every `import`, `expose` and qualified name that mentions a renamed package, in all project files, comments and doc strings included, longest name first. |
| Rewrites artifact URIs | `imageUri`, `uri`, `payloadUri`, `sourceUri` strings follow their files, written either from the project root or relative to `model/`. |
| Creates `model/catalog/project.sysml` | When the project has none: imports the project's packages and a `ProjectMethodBinding` with a placeholder id derived from the name. |
| Creates `memo.package.yaml` | When the project has none: `name` (from `projectName` in the old file, else the directory), `entrypoint`, `include` (`model` plus any vendored `methodology`, `extensions`, `profile` or `profiles` folder that holds SysML) and `version: 0.1.0`. It sets no compiler or packager: those are settings. |
| Removes superseded files | `memo.config.yaml`, `memo.rules.yaml`, `memo.viewpoints.yaml`, `memo.rendering.yaml`; and a re-export wrapper directly under `model/` that nothing imports (its job is `project.sysml`'s now). |
| Removes emptied folders | Old `model/views/` and similar, once empty. |

## What it does not do

* **It does not update model content to the current ontology.** A project written
  against an older ontology can compile with errors after conversion: attributes
  and enumerations the ontology has since renamed or removed (for example a
  requirement status enumeration that is now the element status, relationships
  that moved, `attribute :>> name` that became `@MemoIdentity`). Those are edits to
  your model, listed by `memo compile`. Convert first, so the errors you fix are
  about content and not layout.
* **It does not choose your methodology** (step 6).
* **It does not move vendored reusable packages.** Folders such as `methodology/`,
  `extensions/`, `profile/` stay where they are and are added to `include`
  (warning `vendored-reusable-package`). Moving them into the catalog would claim
  they belong to the project.
* **It does not invent viewpoints.** A view naming no viewpoint is filed under
  `viewpoints/unassigned/` with a warning (`unclassified-view`); give it a
  `viewpointDefinition` and move it.
* **It is not a general reformatter.** It reads files with simple patterns, not a
  full parse, so it works on files that no longer compile. Only the declaration of
  a package, references to renamed packages and artifact URIs are rewritten.

## Collisions: the plan is refused

A refused plan changes nothing. Fix the cause and plan again.

| Code | Cause | Fix |
|---|---|---|
| `no-project-prefix` | no `.sysml` file declares a package, so there is no namespace to derive names from | add a `package` declaration to the files |
| `unparsed-package` | a file declares no package | declare one (or delete the file) |
| `destination-conflict` | two files would be written to the same path | rename one of them |
| `package-name-conflict` | two files would declare the same package | rename a package; names must be unique |
| `destination-occupied` | the target path already exists and is not itself moving | move or merge the existing file |
| `referenced-superseded-entrypoint` | a re-export wrapper that the conversion would remove is still imported by other files | change those imports to the packages they need, then convert |

## Warnings

A warning does not stop the conversion.

| Code | Meaning | What to do |
|---|---|---|
| `legacy-settings-file` | an old settings file is being removed | check the methodology it pinned (step 6) |
| `superseded-entrypoint` | a re-export wrapper is being removed | nothing; `project.sysml` replaces it |
| `vendored-reusable-package` | a vendored methodology or extension is left in place | nothing |
| `package-not-mirroring` | a file that does not move declares a package named after an old location | rename by hand or re-run with `--normalize-names` |
| `unclassified-view` | a view names no viewpoint | give it one and move it |

## Options

| Option | Effect |
|---|---|
| `[dir]` | project directory (default `.`) |
| `--write` | apply the plan; without it the command only reports |
| `--diff` | include changed lines and the text of created files |
| `--json` | print the plan as JSON (exit 1 when it has collisions) |
| `--normalize-names` | also rename packages of files that do not move |

Exit code 1 means the plan was refused or the directory does not exist.

## A worked example

The repository keeps a frozen copy of a real pre-native model (the GPCA infusion
pump as of the commit before the switch) to test against. Converting it plans:

```text
project namespace: memo_examples_gpca_pump

Moves (26):   model/views/*.sysml → model/catalog/viewpoints/<viewpoint>/views/*.sysml
Rewritten in place (1):   model/catalog/gpca_trace.sysml — references to renamed packages rewritten
Created (13): 11 × viewpoints/<viewpoint>/viewpoint.sysml, model/catalog/project.sysml, memo.package.yaml
Removed (1):  memo.config.yaml
Warnings (20): 3 vendored-reusable-package, 16 package-not-mirroring, 1 legacy-settings-file
```

After `--write` the project loads (`memo compile` resolves every package and import
the conversion touched). The errors it then reports are content the newer ontology
no longer accepts, as described above; none comes from a moved file or a renamed
package.

## Related

* [Command map](../reference/commands.md)
* [Import existing data](import.md): bringing in another tool's model is a different job from upgrading a MEMO project.
