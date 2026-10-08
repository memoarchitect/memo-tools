# Release notes

Versioned under [semantic versioning](https://semver.org/). Before 1.0 a change that breaks a model, a command or a setting raises the minor number; a fix or addition that breaks nothing raises the patch. Every release is tagged in the repository. The notes for all three packages are also on [memoarchitect.com/releases.html](https://memoarchitect.com/releases.html).

## 0.14.0 (not yet published)

### Breaking

- **`memo` and `memo-architect` are split.** `memo` compiles, validates, packs and checks the toolchain; everything else, including `init`, is `memo-architect`. A retired command exits with an error naming its replacement. `memo package` is replaced by `memo pack` (a SysAnd KPAR) and `memo-architect import kpar`.
- **The project names its compiler** with `toolchain.compiler`. A person overrides it for themselves in their user settings; tool paths are found automatically and are rejected in a checked-in project file.
- **Rules read the new trace.** The loader reads `#EnforcesClause` dependencies. Ontology 0.13.x and earlier, which use `ref enforces`, no longer show clause traces.

### Added

- `memo validate --rules --rules-obligation <required|recommended|bestPractice>`; `rules new --obligation` and `--enforces` write the new forms.
- Stage 1 converts only the documents an edit reached and stores them compressed. With OpenSysML 0.9.3 or later the compact API JSON format is used where the service offers it.
- `memo pack` builds a SysAnd KPAR from the declared sources only, not from examples or the ontology.
