// ─── Application Settings Loader ──────────────────────────────────────────────
//
// Reads the tool settings for a project. It reads no semantic field, and there
// is no `extends` chain to resolve any more: a settings file inherits nothing,
// because inheritance was how one project's settings selected another package's
// model content.
//
// `findConfigFile` still exists because commands report which settings file
// they loaded, but it is no longer how the project root is found. That is
// `findProjectRoot` in `native-project.ts`, which looks for the native
// entrypoint — a project stays a project when every YAML file beside it is
// deleted.
//
// Design reference: sections 5.3, 5.5, 16.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { readIdentityRegistry } from './identity-registry.js';
import type { MEMOConfig } from './config.js';
import { CONFIG_SEARCH_ORDER, readManifest } from './package-manifest.js';

/** Settings filenames, most product-scoped first. */
const SETTINGS_FILENAMES = ['memo.tools.yaml', 'memo.tools.yml', ...CONFIG_SEARCH_ORDER] as const;

/**
 * Locate the nearest settings file by walking up from `startDir`.
 *
 * Returns undefined when there is none, which is a normal state: a project with
 * no application settings is complete, because settings never carried meaning.
 */
export function findConfigFile(startDir: string): string | undefined {
    let dir = resolve(startDir);
    while (true) {
        for (const name of SETTINGS_FILENAMES) {
            const candidate = resolve(dir, name);
            if (existsSync(candidate)) return candidate;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

/**
 * Load application settings from a file.
 *
 * Unknown fields are ignored here rather than merged: `checkSemanticFields`
 * owns rejecting the ones that used to mean something, and it produces a
 * message naming the native replacement. Silently reading them here would be
 * exactly the dual-read path the flip exists to remove.
 */
export function loadConfig(filePath: string): MEMOConfig {
    const manifest = readManifest(filePath);
    const raw = manifest.raw;
    return {
        projectName: manifest.name ?? basename(dirname(resolve(filePath))),
        relationshipFiles: raw.relationshipFiles as Record<string, string> | undefined,
        canonicalRelationshipFile: raw.canonicalRelationshipFile as string | undefined,
        toolchain: raw.toolchain as MEMOConfig['toolchain'],
    };
}

/** Settings for a project that has none. Every command works from this. */
export function defaultConfig(projectName: string): MEMOConfig {
    return { projectName };
}

/**
 * Load settings for a project directory, or defaults when there are none.
 *
 * This replaces `loadAndResolveConfig`, which walked an `extends` chain and
 * merged kinds, layers, viewpoints, and workflows down it. There is nothing
 * left to merge.
 */
export function loadProjectSettings(projectRoot: string): MEMOConfig {
    const path = findConfigFile(projectRoot);
    const config = path ? loadConfig(path) : defaultConfig(basename(resolve(projectRoot)));
    // Identities assigned on earlier builds. Attached here rather than at each
    // of the eight `buildMemoModel` call sites, so a command cannot forget it
    // and silently re-mint every shortId and uuid.
    config.priorIdentities = readIdentityRegistry(resolve(projectRoot));
    return config;
}
