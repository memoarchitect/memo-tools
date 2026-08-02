// ─── Effective toolchain selection ───────────────────────────────────────────
//
// Turns a settings file into "which provider fills which role", with the
// deprecated `compiler` alias folded in and defaults taken from the registry
// rather than written here.
// ─────────────────────────────────────────────────────────────────────────────

import type { MEMOConfig, ToolchainConfig } from '../model/config.js';
import {
    DEPRECATED_COMPILER_SETTING,
    PROVIDER_ROLES,
    ROLE_SETTING,
    type ProviderRegistry,
    type ProviderRole,
} from './registry.js';

export interface RoleSelection {
    role: ProviderRole;
    provider: string;
    /** Where the value came from — useful in `memo config effective`. */
    source: 'settings' | 'deprecated-alias' | 'default';
}

export interface EffectiveToolchain {
    validator: string;
    lowering: string;
    packager: string;
    selections: RoleSelection[];
    /** One line per deprecated key that was honoured. */
    deprecations: string[];
}

/**
 * Resolve every role.
 *
 * Precedence is explicit key, then the deprecated alias, then the registry's
 * default.
 *
 * The alias fills both roles that split out of it — but only where the named
 * provider is registered for the role. That caveat is not a hedge, it is the
 * finding that forced the split: the best external validator available cannot
 * emit IR at all, so "one tool does both" was never true of it. An alias that
 * insisted on setting both would fail to resolve for exactly the configuration
 * it exists to keep working. Where the named provider cannot fill a role, that
 * role keeps its default and the deprecation note says which and why — which is
 * what the pre-split code did anyway: run the external check, then lower with
 * MEMO's own parser regardless.
 */
export function resolveToolchain(
    config: MEMOConfig | undefined,
    registry: ProviderRegistry,
): EffectiveToolchain {
    const toolchain: ToolchainConfig = config?.toolchain ?? {};
    const alias = readString(toolchain, DEPRECATED_COMPILER_SETTING);
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
        const fallback = registry.defaultId(role);
        const provider = explicit ?? aliased ?? fallback;
        if (!provider) {
            throw new Error(
                `No provider is registered for the ${role} role and none was configured `
                + `(toolchain.${ROLE_SETTING[role]}).`,
            );
        }
        if (!registry.has(role, provider)) {
            // Resolving through the registry produces the message listing what
            // *is* registered, which is the only correct roster.
            registry.descriptor(role, provider);
        }
        selections.push({
            role,
            provider,
            source: explicit ? 'settings' : aliased ? 'deprecated-alias' : 'default',
        });
    }

    if (alias !== undefined) {
        const overridden = selections
            .filter(s => s.source === 'settings' && s.role !== 'package')
            .map(s => `toolchain.${ROLE_SETTING[s.role]}`);
        deprecations.push(
            `toolchain.${DEPRECATED_COMPILER_SETTING} is deprecated; it sets both `
            + `toolchain.${ROLE_SETTING.validator} and toolchain.${ROLE_SETTING.lowering}.`
            + (overridden.length > 0 ? ` ${overridden.join(' and ')} take precedence.` : ''),
        );
        for (const role of aliasCannotFill) {
            deprecations.push(
                `"${alias}" is not registered for the ${role} role, so `
                + `toolchain.${ROLE_SETTING[role]} keeps its default `
                + `("${byRole(selections, role)}"). Set toolchain.${ROLE_SETTING[role]} explicitly `
                + `to silence this.`,
            );
        }
    }

    return {
        validator: byRole(selections, 'validator'),
        lowering: byRole(selections, 'lowering'),
        packager: byRole(selections, 'package'),
        selections,
        deprecations,
    };
}

function byRole(selections: RoleSelection[], role: ProviderRole): string {
    return selections.find(s => s.role === role)!.provider;
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
