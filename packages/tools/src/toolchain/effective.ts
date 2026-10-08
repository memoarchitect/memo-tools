// ─── Effective toolchain selection ───────────────────────────────────────────
//
// Turns a settings file into "which provider fills which role", with the
// `compiler` setting folded in and defaults taken from the registry
// rather than written here.
// ─────────────────────────────────────────────────────────────────────────────

import type { MEMOConfig, ToolchainConfig } from '../model/config.js';
import { userSettingsPath } from '../model/user-settings.js';
import { rejectUserSettingsInProject } from './ownership.js';
import {
    COMPILER_SETTING,
    PROVIDER_ROLES,
    ROLE_SETTING,
    type ProviderRegistry,
    type ProviderRole,
} from './registry.js';

export interface RoleSelection {
    role: ProviderRole;
    provider: string;
    /** Where the value came from — useful in `memo compile --effective`. */
    source: 'settings' | 'compiler';
}

export interface EffectiveToolchain {
    /**
     * The provider of each role, as the settings name it. Reading a role the
     * settings leave unset throws `ToolchainNotConfiguredError`: there is no
     * default to fall back on.
     */
    readonly validator: string;
    readonly lowering: string;
    readonly packager: string;
    /** The roles the settings fill. */
    selections: RoleSelection[];
    /** One line per setting that could not mean all it says (a compiler missing a role). */
    deprecations: string[];
}

/**
 * A role the settings do not fill. Nothing is chosen for a project that did
 * not choose: the settings file states the compiler, or the command fails.
 */
export class ToolchainNotConfiguredError extends Error {
    constructor(readonly role: ProviderRole, registry: ProviderRegistry) {
        const key = role === 'package' ? ROLE_SETTING[role] : COMPILER_SETTING;
        const choices = registry.descriptors(role).map(d => d.id).join(', ');
        super(
            role === 'package'
                ? `No packager is configured. Set toolchain.${key} (${choices}) in the project's settings file `
                    + `(memo.tools.yaml or memo.package.yaml), or pass --toolchain.${key}.`
                // The project names it; a user may choose another for themselves.
                : `No SysML compiler is configured. The project names one with toolchain.${key} (${choices}) in its settings file `
                    + `(memo.tools.yaml or memo.package.yaml), or you choose one for yourself in Architect (the Compiler control, or `
                    + `\`memo-architect config set ${key} <${choices.replace(/, /g, '|')}>\`, saved in ${userSettingsPath()}), or set MEMO_TOOLCHAIN_COMPILER, or pass --toolchain.${key}.`,
        );
        this.name = 'ToolchainNotConfiguredError';
    }
}

/**
 * Resolve every role from the settings.
 *
 * Precedence is the role's own key, then `toolchain.compiler`. There is no
 * default: a role neither names is unconfigured, and reading it is an error.
 *
 * The alias fills both roles that split out of it — but only where the named
 * provider is registered for the role. A role the named compiler cannot fill
 * is unconfigured unless its own key is set, and the deprecation note says so.
 */
export function resolveToolchain(
    config: MEMOConfig | undefined,
    registry: ProviderRegistry,
): EffectiveToolchain {
    rejectUserSettingsInProject(config, registry);
    const toolchain: ToolchainConfig = config?.toolchain ?? {};
    const alias = readString(toolchain, COMPILER_SETTING);
    const deprecations: string[] = [];
    const selections: RoleSelection[] = [];
    const aliasCannotFill: ProviderRole[] = [];

    for (const role of PROVIDER_ROLES) {
        const explicit = readString(toolchain, ROLE_SETTING[role]);
        // The alias only ever meant "the thing that compiles", so it is offered
        // to the two roles that split out of it and never to packaging — and
        // only where the registry says that provider can fill the role.
        const offered = role === 'package' ? undefined : alias;
        const aliased = offered !== undefined && registry.has(role, offered) ? offered : undefined;
        if (offered !== undefined && aliased === undefined && explicit === undefined) {
            aliasCannotFill.push(role);
        }
        const provider = explicit ?? aliased;
        if (!provider) continue;
        if (!registry.has(role, provider)) {
            // Resolving through the registry produces the message listing what
            // *is* registered, which is the only correct roster.
            registry.descriptor(role, provider);
        }
        selections.push({ role, provider, source: explicit ? 'settings' : 'compiler' });
    }

    if (alias !== undefined) {
        for (const role of aliasCannotFill) {
            deprecations.push(
                `"${alias}" is not registered for the ${role} role, so `
                + `toolchain.${ROLE_SETTING[role]} is unset. Set it explicitly.`,
            );
        }
    }

    const provider = (role: ProviderRole): string => {
        const found = selections.find(s => s.role === role);
        if (!found) throw new ToolchainNotConfiguredError(role, registry);
        return found.provider;
    };
    return {
        get validator() { return provider('validator'); },
        get lowering() { return provider('lowering'); },
        get packager() { return provider('package'); },
        selections,
        deprecations,
    };
}

function readString(toolchain: ToolchainConfig, key: string): string | undefined {
    const value = toolchain[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Per-provider settings block, as that provider's adapter should read it. */
export function providerSettings<T>(config: MEMOConfig | undefined, providerId: string): T | undefined {
    const value = config?.toolchain?.[providerId];
    return value && typeof value === 'object' ? value as T : undefined;
}
