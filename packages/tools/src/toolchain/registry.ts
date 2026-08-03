// ─── Provider descriptors, factory and registry ──────────────────────────────
//
// Every tool MEMO runs is a plugin, including MEMO's own. There is no branch on
// a provider name anywhere in this file, and no union type enumerating the
// roster: a provider ID is a plain string, and the set of legal values is
// whatever has been registered.
//
// The rule that keeps it honest: *nothing outside an adapter module knows a
// provider's name.* Defaults are declared by the adapter (`isDefault`), not
// hardcoded here — otherwise `?? 'internal'` reintroduces the special case this
// module exists to remove. A grep test enforces the rule.
//
// Adding a provider is one new file plus one `register(...)` line.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuilderRegistries } from '../model/builder.js';
import type { MEMOConfig } from '../model/config.js';
import type { Diagnostic } from './diagnostic.js';
import type { MemoIr } from './protocol.js';

/**
 * What question a provider answers.
 *
 *   validator  "Is this valid SysML/KerML?"
 *   lowering   "What can MEMO ingest from this revision?"
 *   package    "How is this project packed and published?"
 *
 * One provider per role per revision. Two roles may be filled by the same tool.
 * Running two validators, or two lowerers, is never a thing MEMO does.
 */
export type ProviderRole = 'validator' | 'lowering' | 'package';

export const PROVIDER_ROLES: readonly ProviderRole[] = ['validator', 'lowering', 'package'];

/**
 * What a provider can actually do.
 *
 * `check` and `parse-only` are deliberately distinct: a tool that accepts
 * `part w : NoSuchType;` is a syntax gate, not a validator, and it has to say
 * so rather than be registered on the strength of its README.
 */
export type Capability = 'check' | 'parse-only' | 'emit-ir' | 'format' | 'pack' | 'lower';

/** How a provider is reached. Callers branch on this, never on an ID. */
export type Transport = 'in-process' | 'process';

export interface ToolInvocation {
    command: string;
    args: string[];
    provider: string;
}

/** Result of asking whether a provider can run here, without running it. */
export interface Availability {
    available: boolean;
    transport: Transport;
    /** Absolute path of the resolved executable, for `process` transports. */
    executable?: string;
    /** Whatever the tool printed for `--version`, trimmed. */
    version?: string;
    /** Why it is unavailable, when it is. */
    detail?: string;
}

/** Everything a provider needs to build and run one invocation. */
export interface ProviderContext {
    config: MEMOConfig;
    projectDir: string;
    /** Resolved library roots offered to the tool as include paths. */
    includeDirs?: string[];
    /**
     * The exact sources to analyse, instead of the directory's own discovery.
     *
     * Not an optimisation. A provider discovers a *project*, and a conformance
     * corpus is not one: its Kernel libraries are `.kerml`, which no project
     * walker collects, and a run that quietly analysed none of them would
     * report a clean pass on files it never opened. Every adapter must honour
     * it or say what it did instead — silently widening the set back to the
     * directory is the failure this field exists to prevent.
     */
    files?: readonly string[];
    /** Destination artifact, for the `package` role. */
    outputPath?: string;
    /**
     * Ontology registries the caller has already loaded.
     *
     * An offer, not an input: an in-process provider may use them instead of
     * loading the same closure a second time, and a process provider ignores
     * them and loads its own. Either way the value is the project's, so which
     * one ran is not observable in the result.
     */
    registries?: BuilderRegistries;
}

export interface ProviderRunResult {
    provider: string;
    providerVersion?: string;
    transport: Transport;
    /**
     * True when the provider itself accepted the input.
     *
     * For an `in-process` provider this says only "the external step raised
     * nothing" — the caller still does the in-process work and reports on it.
     */
    accepted: boolean;
    diagnostics: Diagnostic[];
    /** Process exit status, when there was a process. */
    exitCode?: number;
}

/**
 * What the lowering role returns beyond diagnostics: the IR. This is the one
 * role whose output is not just complaints.
 *
 * It used to be Langium documents, which is a shape only an in-process provider
 * can return — an AST does not cross a pipe. Making it IR is what turned the
 * lowering contract into something a separate process can honour, and therefore
 * into something a third party could implement.
 */
export interface LoweringRunResult extends ProviderRunResult {
    ir: MemoIr;
}

/**
 * A provider instance, created by its descriptor's factory.
 *
 * One verb — `run` — in every role. `R` differs only because lowering has to
 * hand back documents; validator and packaging report diagnostics and nothing
 * else.
 */
export interface Provider<R extends ProviderRunResult = ProviderRunResult> {
    readonly id: string;
    readonly role: ProviderRole;
    readonly transport: Transport;
    /** The command line this provider would run, or undefined when in-process. */
    invocation(): ToolInvocation | undefined;
    run(): Promise<R>;
}

export type ValidatorProvider = Provider<ProviderRunResult>;
export type LoweringProvider = Provider<LoweringRunResult>;
export type PackageProvider = Provider<ProviderRunResult>;

/**
 * One configurable leaf under `toolchain.*`.
 *
 * Adapters contribute their own leaves, so `--toolchain.syside.executable`
 * exists because the syside adapter says so, not because the CLI knows about
 * syside. The CLI and `memo config effective` both read this.
 */
export interface ToolchainSchemaLeaf {
    /** Dotted path under `toolchain`, e.g. `validator` or `syside.executable`. */
    path: string;
    type: 'string' | 'boolean' | 'enum';
    /** Legal values for `enum`, or for a `string` leaf with a known roster. */
    values?: readonly string[];
    description: string;
    /** Provider that owns this leaf; absent for role-selection leaves. */
    provider?: string;
    /** Present on leaves kept only for backwards compatibility. */
    deprecated?: string;
}

export interface ProviderDescriptor<R extends ProviderRunResult = ProviderRunResult> {
    /** Plain string. Never widened into a union type anywhere. */
    id: string;
    role: ProviderRole;
    capabilities: readonly Capability[];
    /**
     * Selected for this role when the project configures nothing.
     *
     * At most one descriptor per role may claim it. This is how `internal`
     * stays the default without core code naming it.
     */
    isDefault?: boolean;
    /** Config leaves this provider understands, relative to `toolchain`. */
    settingsSchema?: readonly ToolchainSchemaLeaf[];
    probe(context: ProviderContext): Availability;
    create(context: ProviderContext): Provider<R>;
}

export type ValidatorDescriptor = ProviderDescriptor<ProviderRunResult>;
export type LoweringDescriptor = ProviderDescriptor<LoweringRunResult>;
export type PackageDescriptor = ProviderDescriptor<ProviderRunResult>;

export class MissingToolError extends Error {
    constructor(readonly provider: string, readonly command: string, detail: string) {
        super(
            `Provider "${provider}" is selected but its executable could not be run: ${detail}. `
            + `Configure toolchain.${provider}.executable or put "${command}" on PATH. `
            + `MEMO does not silently fall back to another provider.`,
        );
        this.name = 'MissingToolError';
    }
}

export class UnknownProviderError extends Error {
    constructor(role: ProviderRole, id: string, registered: readonly string[]) {
        super(
            `Unknown ${role} provider "${id}". Registered ${role} providers: `
            + `${registered.length > 0 ? registered.join(', ') : '(none)'}.`,
        );
        this.name = 'UnknownProviderError';
    }
}

export class ProviderRegistry {
    private readonly byRole = new Map<ProviderRole, Map<string, ProviderDescriptor<any>>>();

    register(descriptor: ProviderDescriptor<any>): this {
        const role = this.byRole.get(descriptor.role) ?? new Map<string, ProviderDescriptor<any>>();
        const existing = role.get(descriptor.id);
        if (existing) {
            throw new Error(`Provider "${descriptor.id}" is already registered for role "${descriptor.role}".`);
        }
        if (descriptor.isDefault) {
            const claimed = [...role.values()].find(d => d.isDefault);
            if (claimed) {
                throw new Error(
                    `Role "${descriptor.role}" already has a default provider ("${claimed.id}"); `
                    + `"${descriptor.id}" cannot also claim it.`,
                );
            }
        }
        role.set(descriptor.id, descriptor);
        this.byRole.set(descriptor.role, role);
        return this;
    }

    descriptors(role: ProviderRole): ProviderDescriptor<any>[] {
        return [...(this.byRole.get(role)?.values() ?? [])];
    }

    /** Every descriptor, in registration order, across all roles. */
    all(): ProviderDescriptor<any>[] {
        return PROVIDER_ROLES.flatMap(role => this.descriptors(role));
    }

    ids(role: ProviderRole): string[] {
        return this.descriptors(role).map(d => d.id);
    }

    /** Distinct provider IDs across every role. */
    allIds(): string[] {
        return [...new Set(this.all().map(d => d.id))];
    }

    /**
     * The ID used when the project selects nothing for this role.
     *
     * Comes from whichever adapter declared `isDefault`, so core code never
     * writes a provider name.
     */
    defaultId(role: ProviderRole): string | undefined {
        return this.descriptors(role).find(d => d.isDefault)?.id;
    }

    descriptor(role: ProviderRole, id: string): ProviderDescriptor<any> {
        const found = this.byRole.get(role)?.get(id);
        if (!found) throw new UnknownProviderError(role, id, this.ids(role));
        return found;
    }

    has(role: ProviderRole, id: string): boolean {
        return this.byRole.get(role)?.has(id) === true;
    }

    resolveValidator(id: string, context: ProviderContext): ValidatorProvider {
        return this.descriptor('validator', id).create(context) as ValidatorProvider;
    }

    resolveLowering(id: string, context: ProviderContext): LoweringProvider {
        return this.descriptor('lowering', id).create(context) as LoweringProvider;
    }

    resolvePackager(id: string, context: ProviderContext): PackageProvider {
        return this.descriptor('package', id).create(context) as PackageProvider;
    }

    /** Every configurable leaf, role selection first, then per-provider settings. */
    schema(): ToolchainSchemaLeaf[] {
        const leaves: ToolchainSchemaLeaf[] = PROVIDER_ROLES.map(role => ({
            path: ROLE_SETTING[role],
            type: 'enum' as const,
            values: this.ids(role),
            description: `Provider for the ${role} role.`,
        }));
        leaves.push({
            path: DEPRECATED_COMPILER_SETTING,
            type: 'enum',
            values: this.ids('validator'),
            description:
                'Deprecated alias. Sets both toolchain.validator and toolchain.lowering.',
            deprecated: `Use toolchain.${ROLE_SETTING.validator} and toolchain.${ROLE_SETTING.lowering}.`,
        });
        const seen = new Set<string>();
        for (const descriptor of this.all()) {
            for (const leaf of descriptor.settingsSchema ?? []) {
                if (seen.has(leaf.path)) continue;
                seen.add(leaf.path);
                leaves.push({ ...leaf, provider: leaf.provider ?? descriptor.id });
            }
        }
        return leaves;
    }
}

/** Settings key naming each role. Roles are MEMO's own vocabulary, not a tool's. */
export const ROLE_SETTING: Record<ProviderRole, string> = {
    validator: 'validator',
    lowering: 'lowering',
    package: 'packager',
};

/** Kept readable by every command that reports the deprecation. */
export const DEPRECATED_COMPILER_SETTING = 'compiler';
