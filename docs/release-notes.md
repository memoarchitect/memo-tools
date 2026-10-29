# Release notes

Versioned under [semantic versioning](https://semver.org/). Before 1.0 a change that breaks a model, a command or a setting raises the minor number; a fix or addition that breaks nothing raises the patch. Every release is tagged in the repository. The notes for all three packages are also on [memoarchitect.com/releases.html](https://memoarchitect.com/releases.html).

## 0.16.4

- **`memo evaluate`.** Evaluates a project's calculations and scores its trade studies. The calculations are the ontology's own roll-ups of time, cost and success, read from their bodies: the SysML standard library's functions and operators are implemented, and one that is not fails with its name. Units follow the library's own conversions (`scripts/generate-si-units.mjs`), so minutes and hours add and a rate times a duration is an amount.
- **Builder.** A package-level unit declaration (`attribute <EUR> euro : CurrencyUnit;`) and an analysis case (a `TradeStudy`, its alternatives as `hasSubject` edges) are elements. An untyped `variant part` is an element of its variation's kind. A `perform` of an untyped functional-chain step is no longer an end-kind finding.
- **Validator.** `AR-IBD-001` does not judge the variants of a variation.
- **Gates.** The SysIDE gate and the import check include an example's own generated library.

## 0.16.2

- **Views and viewpoints.** `convert` files a view under the one viewpoint it traces to. It now reads every `viewpointDefinition` in a file, not the first, so a file of views for different viewpoints is no longer misplaced. A view that traces to several viewpoints, or to none, goes under `viewpoints/shared/` (it was `unassigned/`); a view that traces to none still warns (`unclassified-view`). `convert` carries `memo.identity.yaml` with the packages it renames, so a moved element keeps its short id and uuid, and a package outside the project's namespace keeps its name.
- **Pinned builds.** A family whose `systems/` folder sits under `catalog/` (the layout `convert` produces) is found by the build that pins its systems.
- **Validator.** `memo toolchain check` prints OpenSysML warnings without failing on them; SysIDE warnings still fail it.
- **Screen captures.** The dev server serves captures kept under `model/catalog/artifacts/assets/`. An authored id is written as `@MemoIdentity { :>> providedId }`, and a create can name the part it belongs inside, so a region is declared inside its screen.
- **Constraints and quantities.** A model's own constraints are evaluated (`MC-001`); a quantity is read as a number from the library's unit source and keeps its units and its rational point.
- **Export.** The Word export is a real `.docx` with the diagram pictures embedded, and the HTML export carries them too.
- **Build.** The repository's own scripts run as Node, so they work on macOS, Linux and Windows.

## 0.16.0

- **SysIDE 1.0.** `compiler: syside` works with SysIDE 1.0.0 as well as 0.10.x. Stage 1 reads both Python APIs (1.0 renamed `user_docs` and `stdlib_docs` and dropped `Diagnostic.full_message`), and the validator's default `diagnose` scope is `project` on 1.0, because 1.0's `all` also fails SysIDE's own bundled standard library. An explicit `toolchain.syside.diagnose` still wins. With 1.0, a diagnostic from stage 1 has no source snippet.
- **Finding SysIDE's Python.** The interpreter that `uv tool install syside` creates is now one of the places MEMO looks.
- **Docs.** New pages: Install and Configure SysIDE, Install and Configure OpenSysML.

## 0.15.3

- **Ids.** A usage's id is its definition's id plus a number of its own, and every element carries `displayId` and `idFamily`; ids rebase renumbers usages, and opening a project under a new version migrates its ids.
- **Matrix views.** Derive, declare, update and size traceability and DSM matrices, scoped to a system, with named groups in DSM views.
- **User preferences.** The experimental features a person switched on, and `packageFolders`, are kept per person (the latter only when off).

## 0.15.2

- **A display id's family belongs to the ontology.** A project definition is registered as a kind, so an element typed by one used to mint a family from the first word of the definition's own name (`HospitalEpRecordingSystemExternal` gave HSP). The family is now the ontology kind the element descends from. A definition that declares `@MemoKind { :>> idPrefix = "…"; }` (ontology 0.15.1) extends the ontology with a family of its own, and so does what is typed by it. Elements that were in the old families get new ids in the new ones, so review the `memo.identity.yaml` diff after `memo validate`.

## 0.15.0 (experimental release)

This release adds support for the OpenSysML compiler alongside SysIDE. The OpenSysML path is new and has had less use. The next version will be more stable.

### Breaking

- **`memo` and `memo-architect` are split.** `memo` compiles, validates, packs and checks the toolchain; everything else, including `init`, is `memo-architect`. A retired command exits with an error naming its replacement. `memo package` is replaced by `memo pack` (a SysAnd KPAR) and `memo-architect import kpar`.
- **One verb to create a thing.** `memo-architect new package|requirement|rule|kind|plugin` replaces `create-package`, `req new`, `rules new`, `ontology add-kind` and `plugin create`; the flags are unchanged except `req new --template`, which is `new requirement --pattern`. `memo-architect sysand publish` (a dry run) is `memo publish`. Each old name fails naming its replacement for one release.
- **The project names its compiler** with `toolchain.compiler`. A person overrides it for themselves in their user settings; tool paths are found automatically and are rejected in a checked-in project file.
- **One project skeleton; no `--template`.** `memo-architect init` copies the one skeleton the ontology's manifest names (`init.template`), and `--example <id>` starts from a copy of an example. `--template` and the template list in `init --list` are gone.
- **A methodology's selection is its package's public imports.** The resolver reads which imports are public from the stage 1 handoff and selects the public-import closure of the packages declaring the methodology chain, plus what the binding's package publicly imports; the ontology's `includedLayer`, `includedModule` and `includedExtension` are no longer read. The `unavailable-module`, `unavailable-layer` and `missing-extension` diagnostics are gone (a misspelled import fails stage 1 instead), and `shared-methodology-package` is new. For library callers: `resolveEffectiveMethodology` takes the package → public-imports map (`NativeProjectResolution.publicImports`) in place of the available-package set; `EffectiveMethodology.selectedPackages` and `EffectiveScope.packages` replace the layer and module lists; `isKindInScope` and `filterKindsInScope` are removed.
- **Rules read the new trace.** The loader reads `#EnforcesClause` dependencies. Ontology 0.13.x and earlier, which use `ref enforces`, no longer show clause traces.

### Added

- `memo validate --rules --rules-obligation <required|recommended|bestPractice>`; `new rule --obligation` and `--enforces` write the new forms. A new-rule request from Architect may carry an `obligation`.
- Stage 1 converts only the documents an edit reached and stores them compressed. With OpenSysML 0.10.0 or later the compact API JSON format is used where the service offers it.
- `memo-architect convert` also writes the `memo.package.yaml` a converted project needs to load, and its warning names the methodology the old `memo.config.yaml` pinned. A new guide, [Convert an Old Project](tasks/convert.md), documents what it changes and what it leaves to you.
- `memo pack` builds a SysAnd KPAR from the declared sources only, not from examples or the ontology. A package's `.project.json` lists the packages its sources import as `urn:kpar:<package>` usages with a `^version` constraint (an extension lists the ontology, and any other extension it imports). `memo-architect sysand publish` (a dry run) stages exactly what `memo pack` stages, so it reports the real version and the same file set; before, it reported every version as 0.0.0.

- `memo prune` removes the cached pinned worktrees (`.memo/pinned/`) and assemblies (`.memo/assembled/`) not used lately: `--keep <n>` (default 5 of each) and `--dry-run`.
- `memo.lock.yaml` records the dependencies a build used: the range, the version found and a checksum of the package. `memo lock` writes the section; `memo validate`, `memo dev` and `memo compile` (including `--at`, against that commit's own lock) refuse a build that resolves another version, a changed package or a dependency the lock never saw. A lock without the section is not checked for dependencies.
- `memo-architect ids rebase` renumbers two sibling branches' duplicate short ids, tells an authored `providedId` the branch added from the target's by a diff, and follows a mention of a renumbered id in a new file that declares the element.

### Fixed

- `memo --version` reports the installed version (it printed 0.6.7).
- A view's display statements are written beside its other `attribute :>>` statements, not at the top of the body.
- `allocate`, `satisfy` and `verify` through a usage typed by a definition (`allocate fn to pump.motor`) end on the nested part the definition owns, not on `pump`. Connector ends are unchanged.
- Each dev server takes its own HMR port. A second server found 24678 taken, logged a port error, and its page kept failing to connect.
