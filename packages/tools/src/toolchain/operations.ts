// ─── Toolchain operations ────────────────────────────────────────────────────
//
// The single implementation behind both `memo <command>` and Architect's
// server protocol. Callers pass settings and a project directory and get
// normalized `Diagnostic`s back. Nothing here branches on a provider name.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuilderRegistries } from '../model/complete-model.js';
import type { MEMOConfig } from '../model/config.js';
import { canonicalPath, discoverLibraryRoots, discoverProjectSources } from '../model/native-project.js';
import { relative } from 'node:path';
import type { Diagnostic } from './diagnostic.js';
import { resolveToolchain, ToolchainNotConfiguredError, type EffectiveToolchain } from './effective.js';
import {
    type CompileModelResult,
    type CompileModelOptions,
    PROVIDER_ROLES,
    ROLE_SETTING,
    type Availability,
    type LoweringRunResult,
    type ProviderContext,
    type ProviderRegistry,
    type ProviderRole,
    type ProviderRunResult,
} from './registry.js';
import { defaultRegistry } from './default-registry.js';

export interface ToolchainRunOptions {
    config: MEMOConfig;
    projectDir: string;
    registry?: ProviderRegistry;
    /** Overrides the include paths derived from the project's library roots. */
    includeDirs?: string[];
    /**
     * The exact sources to analyse, instead of the directory's own discovery.
     * See `ProviderContext.files` — a conformance corpus is a file set, not a
     * project, and every role has to be told the same set or the counts are not
     * comparable.
     */
    files?: readonly string[];
    outputPath?: string;
    /** Ontology registries the caller already loaded. See `ProviderContext`. */
    registries?: BuilderRegistries;
}

function context(options: ToolchainRunOptions): ProviderContext {
    return {
        config: options.config,
        projectDir: options.projectDir,
        includeDirs: options.includeDirs ?? discoverLibraryRoots(options.projectDir).map(r => r.sysmlDir),
        files: options.files,
        outputPath: options.outputPath,
        registries: options.registries,
    };
}

/** Run the selected validator. Diagnostics come back in the `sysml` domain. */
export async function runValidator(options: ToolchainRunOptions): Promise<ProviderRunResult> {
    const registry = options.registry ?? defaultRegistry;
    const effective = resolveToolchain(options.config, registry);
    return registry.resolveValidator(effective.validator, context(options)).run();
}

/** Run the selected lowering provider. Diagnostics are `memo-ingest`. */
export async function runLowering(options: ToolchainRunOptions): Promise<LoweringRunResult> {
    const registry = options.registry ?? defaultRegistry;
    const effective = resolveToolchain(options.config, registry);
    return registry.resolveLowering(effective.lowering, context(options)).run();
}

/**
 * The MEMO model from the selected stage 1 compiler: its check, then stage 2
 * over its API JSON. Every command that needs a model asks here, so
 * `toolchain.compiler` means the same thing to all of them. MEMO has no compiler
 * of its own: a lowering provider that cannot build the model is an error.
 */
export async function compileModelWithSelected(
    options: CompileModelOptions & { registry?: ProviderRegistry },
): Promise<CompileModelResult> {
    const registry = options.registry ?? defaultRegistry;
    const effective = resolveToolchain(options.config, registry);
    const compile = registry.descriptor('lowering', effective.lowering).compileModel;
    if (!compile) {
        throw new Error(`The compiler "${effective.lowering}" does not build a model, so it cannot be selected as \`toolchain.compiler\`.`);
    }
    // The compiler names files by their real paths, so the project and its
    // libraries are given by them: through a symbolic link nothing would match.
    const result = await compile({
        ...options,
        projectDir: canonicalPath(options.projectDir),
        libraryDirs: options.libraryDirs.map(canonicalPath),
    });
    // A compile that accepted the project but found none of its own files
    // resolved nothing. That is not a valid empty model, it is a failure to say so.
    const unresolved = result.resolution?.diagnostics.find(d => d.code === 'entrypoint-not-compiled');
    if (result.accepted && unresolved) {
        const { model: _model, ...rest } = result;
        return {
            ...rest,
            accepted: false,
            diagnostics: [...result.diagnostics, {
                domain: 'sysml', provider: effective.lowering, severity: 'error', message: unresolved.message,
                ...(unresolved.file ? { file: unresolved.file } : {}),
            }],
        };
    }
    return result;
}

/**
 * Stage 1 over every library root a locator offers, with the project resolved
 * from what it compiled (`resolveProject`): what a command loads, so MEMO parses
 * nothing. `projectFiles` defaults to the project's own sources, its library
 * roots excluded.
 */
export async function compileResolvedProject(options: {
    config: MEMOConfig;
    projectDir: string;
    projectFiles?: ReadonlySet<string>;
    cacheDir?: string;
    /** Run stage 1 even when `cacheDir` holds output for these inputs. */
    force?: boolean;
    provenance?: boolean;
    registry?: ProviderRegistry;
}): Promise<CompileModelResult> {
    const registry = options.registry ?? defaultRegistry;
    const projectDir = canonicalPath(options.projectDir);
    const sources = discoverProjectSources(projectDir);
    return compileModelWithSelected({
        config: options.config,
        projectDir,
        libraryDirs: [...new Set(sources.libraryRoots.map(root => root.sysmlDir))],
        projectFiles: options.projectFiles
            ?? new Set(sources.projectFiles.map(file => relative(projectDir, file))),
        resolveProject: true,
        provenance: options.provenance,
        cacheDir: options.cacheDir,
        force: options.force,
        registry,
    });
}

/**
 * Whether the selected compiler's stage 1 diagnostics stand in for the
 * validator: one provider fills both roles and says its compile is the check
 * its validator would run. A command that compiles then runs that provider
 * once, not twice.
 */
export function compileServesValidator(config: MEMOConfig, registry: ProviderRegistry = defaultRegistry): boolean {
    const effective = resolveToolchain(config, registry);
    if (effective.validator !== effective.lowering) return false;
    const descriptor = registry.descriptor('lowering', effective.lowering);
    return Boolean(descriptor.compileModel && descriptor.compileServesValidator?.(config));
}

/** Run the selected packager against `outputPath`. */
export async function runPackager(options: ToolchainRunOptions): Promise<ProviderRunResult> {
    const registry = options.registry ?? defaultRegistry;
    const effective = resolveToolchain(options.config, registry);
    return registry.resolvePackager(effective.packager, context(options)).run();
}

/**
 * Collapse an ingest failure that the validator already reported.
 *
 * When one provider fills both roles it sees the same defect twice, once per
 * role. Reporting it twice, in two domains, would make the domain split look
 * like noise. A failure is reported once, in the domain with the most
 * authority — `sysml` outranks `memo-ingest`, because a source the validator
 * rejected is not a story about MEMO's ingest.
 */
export function mergeDiagnostics(
    validatorDiagnostics: readonly Diagnostic[],
    ingestDiagnostics: readonly Diagnostic[],
): Diagnostic[] {
    const seen = new Set(validatorDiagnostics.map(fingerprint));
    return [...validatorDiagnostics, ...ingestDiagnostics.filter(d => !seen.has(fingerprint(d)))];
}

function fingerprint(diagnostic: Diagnostic): string {
    const { line = 0, column = 0 } = diagnostic.range?.start ?? {};
    return `${diagnostic.file ?? ''}:${line}:${column}:${diagnostic.message}`;
}

export interface RoleProbe {
    role: ProviderRole;
    /** The settings key that selects this role, e.g. `validator`. */
    setting: string;
    /** The provider the settings name, or `(not configured)`. */
    provider: string;
    /** Where the setting came from; `unset` when the settings name none. */
    source: 'settings' | 'compiler' | 'unset';
    availability: Availability;
}

export interface ToolchainProbe {
    projectDir: string;
    effective: EffectiveToolchain;
    roles: RoleProbe[];
}

/**
 * Resolve every role and ask each selected provider whether it can run here,
 * without running it.
 *
 * This is what answers "which compiler am I actually using?" — a question that
 * costs an afternoon when the only way to ask it is to run a build and read
 * the errors.
 */
export function probeToolchain(options: {
    config: MEMOConfig;
    projectDir: string;
    registry?: ProviderRegistry;
}): ToolchainProbe {
    const registry = options.registry ?? defaultRegistry;
    const effective = resolveToolchain(options.config, registry);
    const providerContext: ProviderContext = { config: options.config, projectDir: options.projectDir };
    const roles: RoleProbe[] = PROVIDER_ROLES.map(role => {
        const selection = effective.selections.find(s => s.role === role);
        // A role the settings leave unset is reported, not given a provider.
        if (!selection) {
            return {
                role,
                setting: ROLE_SETTING[role],
                provider: '(not configured)',
                source: 'unset',
                availability: {
                    available: false,
                    transport: 'in-process',
                    detail: new ToolchainNotConfiguredError(role, registry).message,
                },
            };
        }
        return {
            role,
            setting: ROLE_SETTING[role],
            provider: selection.provider,
            source: selection.source,
            availability: registry.descriptor(role, selection.provider).probe(providerContext),
        };
    });
    return { projectDir: options.projectDir, effective, roles };
}

/** One `role  provider  path  version` line per role, for `memo toolchain probe`. */
export function formatProbeLine(probe: RoleProbe): string {
    const { availability } = probe;
    const where = availability.executable ?? `(${availability.transport})`;
    const version = availability.version ? ` ${availability.version}` : '';
    const status = availability.available ? `${where}${version}` : `unavailable — ${availability.detail}`;
    return `${probe.role.padEnd(10)} ${probe.provider.padEnd(12)} ${status}`;
}

/** The full resolved picture, for `memo config effective`. */
export interface EffectiveConfigReport {
    projectName: string;
    projectRoot: string;
    settingsFile?: string;
    /** The provider of each role the settings fill; a role they leave unset is absent. */
    toolchain: {
        validator?: string;
        lowering?: string;
        packager?: string;
        selections: EffectiveToolchain['selections'];
        providers: Record<string, unknown>;
    };
    deprecations: string[];
}

export function effectiveConfigReport(options: {
    config: MEMOConfig;
    projectDir: string;
    settingsFile?: string;
    registry?: ProviderRegistry;
}): EffectiveConfigReport {
    const registry = options.registry ?? defaultRegistry;
    const effective = resolveToolchain(options.config, registry);
    const providers: Record<string, unknown> = {};
    for (const id of registry.allIds()) {
        const settings = options.config.toolchain?.[id];
        if (settings !== undefined) providers[id] = settings;
    }
    return {
        projectName: options.config.projectName,
        projectRoot: options.projectDir,
        settingsFile: options.settingsFile,
        toolchain: {
            ...Object.fromEntries(effective.selections.map(s => [s.role === 'package' ? 'packager' : s.role, s.provider])),
            selections: effective.selections,
            providers,
        },
        deprecations: effective.deprecations,
    };
}
