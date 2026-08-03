// ─── Toolchain operations ────────────────────────────────────────────────────
//
// The single implementation behind both `memo <command>` and Architect's
// server protocol. Callers pass settings and a project directory and get
// normalized `Diagnostic`s back. Nothing here branches on a provider name.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuilderRegistries } from '../model/builder.js';
import type { MEMOConfig } from '../model/config.js';
import { discoverLibraryRoots } from '../model/native-project.js';
import type { Diagnostic } from './diagnostic.js';
import { resolveToolchain, type EffectiveToolchain } from './effective.js';
import {
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
    outputPath?: string;
    /** Ontology registries the caller already loaded. See `ProviderContext`. */
    registries?: BuilderRegistries;
}

function context(options: ToolchainRunOptions): ProviderContext {
    return {
        config: options.config,
        projectDir: options.projectDir,
        includeDirs: options.includeDirs ?? discoverLibraryRoots(options.projectDir).map(r => r.sysmlDir),
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
    provider: string;
    source: 'settings' | 'deprecated-alias' | 'default';
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
 * This is what answers "which `syside` am I actually using?" — a question that
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
        const selection = effective.selections.find(s => s.role === role)!;
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
    toolchain: {
        validator: string;
        lowering: string;
        packager: string;
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
            validator: effective.validator,
            lowering: effective.lowering,
            packager: effective.packager,
            selections: effective.selections,
            providers,
        },
        deprecations: effective.deprecations,
    };
}
