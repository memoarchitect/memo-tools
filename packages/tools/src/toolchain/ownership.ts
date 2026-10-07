// ─── Whose setting it is ─────────────────────────────────────────────────────
//
// Which compiler runs, and where its binary or interpreter is on this
// machine, belong to whoever runs the tool: two people on one project have
// different machines, licences and preferences. A project's settings file is
// checked in and shared, so it may not carry them. They are set in the user's
// own settings, the environment or on the command line (`model/user-settings.ts`),
// and the registry says which settings these are (`scope: 'user'`), so a
// provider that adds one gets the rule without anyone remembering to.
//
// A rejected setting is rejected, never read as a fallback or compared against
// the user's: the same rule `model/settings-boundary.ts` holds for semantic fields.
// ─────────────────────────────────────────────────────────────────────────────

import type { MEMOConfig, ToolchainConfig } from '../model/config.js';
import { userSettingsPath } from '../model/user-settings.js';
import type { ProviderRegistry } from './registry.js';

/** The user-scoped settings a project's own settings file wrote, by dotted path. */
export function userSettingsInProject(toolchain: ToolchainConfig | undefined, registry: ProviderRegistry): string[] {
    if (!toolchain || typeof toolchain !== 'object') return [];
    return registry.schema()
        .filter(leaf => leaf.scope === 'user' && valueAt(toolchain, leaf.path) !== undefined)
        .map(leaf => leaf.path);
}

function valueAt(toolchain: ToolchainConfig, path: string): unknown {
    let value: unknown = toolchain;
    for (const step of path.split('.')) {
        if (!value || typeof value !== 'object') return undefined;
        value = (value as Record<string, unknown>)[step];
    }
    return value;
}

/** A project's settings file names a setting that is the user's. */
export class ProjectNamesUserSettingError extends Error {
    constructor(readonly file: string | undefined, readonly paths: readonly string[]) {
        const where = file ?? "the project's settings file";
        const names = paths.map(path => `toolchain.${path}`).join(', ');
        super(
            `${where} sets ${names}. Which compiler runs, and where its tools are on this machine, belong to the person running MEMO, `
            + `so a project's checked-in settings do not carry them. Remove ${paths.length === 1 ? 'it' : 'them'} from the file `
            + `and set ${paths.length === 1 ? 'it' : 'each'} for yourself: ${paths.map(path => `\`memo config set ${path} <value>\``).join(', ')} `
            + `(your settings: ${userSettingsPath()}). A script or CI job uses MEMO_TOOLCHAIN_COMPILER `
            + `or the matching --toolchain.<setting> flag.`,
        );
        this.name = 'ProjectNamesUserSettingError';
    }
}

/** Refuse a project whose settings file names a user's setting. */
export function rejectUserSettingsInProject(config: MEMOConfig | undefined, registry: ProviderRegistry): void {
    const paths = userSettingsInProject(config?.projectToolchain, registry);
    if (paths.length > 0) throw new ProjectNamesUserSettingError(config?.projectSettingsFile, paths);
}
