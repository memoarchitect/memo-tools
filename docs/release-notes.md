# Release notes

Versioned under [semantic versioning](https://semver.org/). Before 1.0 a change that breaks a model, a command or a setting raises the minor number; a fix or addition that breaks nothing raises the patch. Every release is tagged in the repository. The notes for all three packages are also on [memoarchitect.com/releases.html](https://memoarchitect.com/releases.html).

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
