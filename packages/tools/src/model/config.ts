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

export interface SysideToolConfig {
    /** Executable name or path. Defaults to `syside` on PATH. */
    executable?: string;
    /** Optional syside.toml path, relative to the project directory. */
    configFile?: string;
    /** Treat Syside warnings as compilation errors. Defaults to true. */
    warningsAsErrors?: boolean;
    /** Syside validation scope. Defaults to `all`. Use `none` for syntax-only compilation. */
    diagnose?: 'all' | 'external' | 'project' | 'none';
}

export interface SysandToolConfig {
    /** Executable name or path. Defaults to `sysand` on PATH. */
    executable?: string;
    /** Optional sysand.toml path, relative to the project directory. */
    configFile?: string;
}

/** External tool selection. Defaults preserve MEMO's built-in behavior. */
export interface ToolchainConfig {
    compiler?: 'internal' | 'syside';
    packager?: 'internal' | 'sysand';
    syside?: SysideToolConfig;
    sysand?: SysandToolConfig;
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

    /** Compiler and KPAR packager selection. */
    toolchain?: ToolchainConfig;
}
