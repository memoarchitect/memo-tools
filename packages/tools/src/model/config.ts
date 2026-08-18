// ─── MEMO Application Settings ────────────────────────────────────────────────
//
// How the tools operate on a project — never what the project's model contains.
//
// `MEMOConfig` used to be the project's semantic description: it selected the
// methodology, the ontologies, the modules, the viewpoints, the layers, the
// kinds, and the relationship types. None of that is here now. Those facts are
// SysML, resolved by `native-project.ts` and `methodology-resolver.ts`, and a
// settings file that still declares them is rejected by `settings-boundary.ts`.
//
// What remains is the section 5.3 list: which external compiler and packager to
// run, and where their executables and config files are. Changing any of it
// changes how a command behaves, not what the model means.
// ─────────────────────────────────────────────────────────────────────────────

/** SysML v2 constructs supported as entity base types */
export type SysMLConstruct =
    | 'part def'
    | 'requirement def'
    | 'verification def'
    | 'state def'
    | 'use case def'
    | 'action def'
    | 'action usage'
    | 'item def'
    | 'port def'
    | 'interface def'
    | 'connection def'
    | 'attribute def'
    | 'enum def';

/** Legacy diagram type keys — each maps to exactly one SysML v2 view kind (see view-kinds.ts) */
export type DiagramType =
    | 'bdd' | 'ibd' | 'req' | 'ucd' | 'act' | 'afd' | 'pkg' | 'par' | 'risk'
    | 'stm' | 'seq' | 'fmea' | 'alloc' | 'threat-model';

/**
 * Tool selection, one provider per role.
 *
 * Every value here is a plain `string`. A union type would re-hardcode the
 * roster the provider registry exists to keep open: the legal values are
 * whatever is registered, checked at resolution time against the registry, and
 * a third-party adapter must be selectable without editing this file.
 *
 * Per-provider settings live under the provider's own ID (`syside`, `sysand`,
 * …). They are typed as `unknown` here and read by that provider's adapter,
 * which is the only module that knows the shape — see the index signature.
 */
export interface ToolchainConfig {
    /** "Is this valid SysML/KerML?" */
    validator?: string;
    /** "What can MEMO ingest from this revision?" */
    lowering?: string;
    /** How the project is packed and published. */
    packager?: string;
    /**
     * @deprecated Alias that sets both `validator` and `lowering`.
     *
     * It predates the split of the two roles, which answer different questions
     * and produce diagnostics in different domains. Kept so existing settings
     * files keep working; `validator`/`lowering` win when both are present.
     */
    compiler?: string;
    /** Per-provider settings, keyed by provider ID. Read only by that adapter. */
    [providerId: string]: unknown;
}

/**
 * MEMOConfig — application settings for one project.
 *
 * Everything here changes how a command runs. Nothing here changes what the
 * model means: no field selects a methodology, enables or disables a rule,
 * defines a kind or relationship, or chooses the content of a portable view.
 * `warningsAsErrors` may change a command's exit policy; it does not change the
 * severity the model authored.
 */
export interface MEMOConfig {
    /**
     * Display name for CLI output.
     *
     * The project's real name is `projectName` on its `ProjectMethodBinding`.
     * This is a convenience copy for log lines, resolved from the binding when
     * one is available and falling back to the directory name when it is not.
     */
    projectName: string;

    /**
     * Where authored relationships are written, per model package.
     * Keyed by package qualified name, valued by a project-relative .sysml
     * path. This is an editor placement preference — it decides which file a
     * new relationship lands in, not whether the relationship is legal.
     */
    relationshipFiles?: Record<string, string>;

    /** Project-relative .sysml file that owns relationships with no better home. */
    canonicalRelationshipFile?: string;

    /** Validator, lowering and packager provider selection. */
    toolchain?: ToolchainConfig;

    /**
     * Identities assigned on earlier builds, from `memo.identity.yaml`.
     *
     * The builder is pure — it has no project root and does no file access — so
     * the caller loads this and persists what comes back. Absent, every element
     * is treated as new: correct for a first build, and the reason a lost
     * registry re-mints identities rather than reproducing them.
     */
    priorIdentities?: import('./identity-registry.js').IdentityRegistry;
}
