// ─── The user's own toolchain settings: what they are, which layer decided ───
//
// One implementation for `memo config` and for Architect's settings panel, so
// the command line and the browser cannot disagree about which settings are
// the user's (the registry says: `scope: 'user'`), what a value may be, or
// which layer decided it.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolchainConfig } from '../model/config.js';
import {
    setUserToolchainSetting,
    unsetUserToolchainSetting,
    USER_COMPILER_ENV,
    userFileToolchain,
    userSettingsPath,
} from '../model/user-settings.js';
import type { ProviderRegistry, ToolchainSchemaLeaf } from './registry.js';

/** A request the settings commands refuse; reported as a message, not a crash. */
export class ConfigSettingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigSettingError';
    }
}

/** The setting a path names, if it is the user's; otherwise the reason it is not settable here. */
export function userLeaf(path: string, registry: ProviderRegistry): ToolchainSchemaLeaf {
    const leaves = registry.schema();
    const leaf = leaves.find(l => l.path === path);
    const userPaths = leaves.filter(l => l.scope === 'user').map(l => l.path);
    if (!leaf) {
        throw new ConfigSettingError(`"${path}" is not a toolchain setting. The settings that are yours to set: ${userPaths.join(', ')}.`);
    }
    if (leaf.scope !== 'user') {
        throw new ConfigSettingError(
            `toolchain.${path} is a project setting: it is checked in with the project, so it is set in the project's settings file, `
            + `not in your own. The settings that are yours to set: ${userPaths.join(', ')}.`,
        );
    }
    return leaf;
}

function valueAt(toolchain: ToolchainConfig, path: string): unknown {
    let value: unknown = toolchain;
    for (const step of path.split('.')) {
        if (!value || typeof value !== 'object') return undefined;
        value = (value as Record<string, unknown>)[step];
    }
    return value;
}

/** One setting and the layers that speak to it, the deciding one first. */
export interface UserSettingReport {
    path: string;
    value?: string;
    /** The layer that decided: `command line`, `environment`, `user settings`, or none. */
    layer?: string;
    layers: { layer: string; value: string }[];
}

export function userSettingReports(
    registry: ProviderRegistry,
    commandLine: ToolchainConfig = {},
    env: NodeJS.ProcessEnv = process.env,
): UserSettingReport[] {
    const file = userFileToolchain(env);
    return registry.schema().filter(leaf => leaf.scope === 'user').map(leaf => {
        const layers: { layer: string; value: string }[] = [];
        const add = (layer: string, value: unknown) => {
            if (typeof value === 'string' && value.length > 0) layers.push({ layer, value });
        };
        add('command line', valueAt(commandLine, leaf.path));
        if (leaf.path === 'compiler') add('environment', env[USER_COMPILER_ENV]?.trim());
        add('user settings', valueAt(file, leaf.path));
        return { path: leaf.path, value: layers[0]?.value, layer: layers[0]?.layer, layers };
    });
}


/** Set (or, with `undefined`, remove) one of the user's settings, validated against the registry. Returns the file. */
export function applyUserSetting(path: string, value: string | undefined, registry: ProviderRegistry): { file: string; changed: boolean } {
    const leaf = userLeaf(path, registry);
    if (value === undefined) {
        return { file: userSettingsPath(), changed: unsetUserToolchainSetting(path) };
    }
    if (leaf.type === 'enum' && leaf.values && !leaf.values.includes(value)) {
        throw new ConfigSettingError(`toolchain.${path} is one of ${leaf.values.join(', ')}, not "${value}".`);
    }
    return { file: setUserToolchainSetting(path, value), changed: true };
}

/** What a browser or a command shows: the user's settings and the choices each may take. */
export interface UserToolchainStatus {
    file: string;
    settings: (UserSettingReport & { description: string; type: ToolchainSchemaLeaf['type']; values?: readonly string[] })[];
    /** True when the environment variable decides the compiler, so a saved choice is not what runs. */
    compilerFromEnvironment: boolean;
}

export function userToolchainStatus(registry: ProviderRegistry, commandLine: ToolchainConfig = {}, env: NodeJS.ProcessEnv = process.env): UserToolchainStatus {
    const leaves = new Map(registry.schema().map(leaf => [leaf.path, leaf]));
    return {
        file: userSettingsPath(env),
        settings: userSettingReports(registry, commandLine, env).map(report => {
            const leaf = leaves.get(report.path)!;
            return { ...report, description: leaf.description, type: leaf.type, ...(leaf.values ? { values: leaf.values } : {}) };
        }),
        compilerFromEnvironment: Boolean(env[USER_COMPILER_ENV]?.trim()),
    };
}
