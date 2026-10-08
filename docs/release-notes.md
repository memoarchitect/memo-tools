# Release notes

Versioned under [semantic versioning](https://semver.org/). Before 1.0 a change that breaks a model, a command or a setting raises the minor number; a fix or addition that breaks nothing raises the patch. Every release is tagged in the repository. The notes for all three packages are also on [memoarchitect.com/releases.html](https://memoarchitect.com/releases.html).

## 0.14.0 (not yet published)

### Breaking

- **`memo` and `memo-architect` are split.** `memo` compiles, validates, packs and checks the toolchain; everything else, including `init`, is `memo-architect`. A retired command exits with an error naming its replacement. `memo package` is replaced by `memo pack` (a SysAnd KPAR) and `memo-architect import kpar`.
- **One verb to create a thing.** `memo-architect new package|requirement|rule|kind|plugin` replaces `create-package`, `req new`, `rules new`, `ontology add-kind` and `plugin create`; the flags are unchanged except `req new --template`, which is `new requirement --pattern`. `memo-architect sysand publish` (a dry run) is `memo publish`. Each old name fails naming its replacement for one release.
- **The project names its compiler** with `toolchain.compiler`. A person overrides it for themselves in their user settings; tool paths are found automatically and are rejected in a checked-in project file.
- **One project skeleton; no `--template`.** `memo-architect init` copies the one skeleton the ontology's manifest names (`init.template`), and `--example <id>` starts from a copy of an example. `--template` and the template list in `init --list` are gone.
- **Rules read the new trace.** The loader reads `#EnforcesClause` dependencies. Ontology 0.13.x and earlier, which use `ref enforces`, no longer show clause traces.

### Added

- `memo validate --rules --rules-obligation <required|recommended|bestPractice>`; `rules new --obligation` and `--enforces` write the new forms.
- Stage 1 converts only the documents an edit reached and stores them compressed. With OpenSysML 0.10.0 or later the compact API JSON format is used where the service offers it.
- `memo pack` builds a SysAnd KPAR from the declared sources only, not from examples or the ontology. A package's `.project.json` lists the packages its sources import as `urn:kpar:<package>` usages with a `^version` constraint (an extension lists the ontology, and any other extension it imports). `memo-architect sysand publish` (a dry run) stages exactly what `memo pack` stages, so it reports the real version and the same file set; before, it reported every version as 0.0.0.
