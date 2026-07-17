// ─── Config Resolver ──────────────────────────────────────────────────────────
//
// Resolves the `extends` chain for MEMO configs.
// Handles: "@memoarchitect/medical-modeling-profile" → find config in node_modules or workspace packages
// Supports both new format (memo.package.yaml) and legacy (memo.config.yaml).
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, dirname } from 'node:path';
import type { MEMOConfig } from '@memoarchitect/tools';
import { loadConfig, resolveConfig, resolvePackageConfig } from '@memoarchitect/tools';

export interface ConfigChainEntry {
    configPath: string;
    config: MEMOConfig;
}

/**
 * Load and fully resolve a config file, following the extends chain.
 */
export function loadAndResolveConfig(configPath: string): MEMOConfig {
    const config = loadConfig(configPath);
    const projectDir = dirname(configPath);

    return resolveConfig(config, (packageName: string) => {
        return resolveParentConfig(packageName, projectDir);
    });
}

/**
 * Load the raw config chain in inheritance order: base parent first, leaf last.
 */
export function loadConfigChain(configPath: string): ConfigChainEntry[] {
    return loadConfigChainInternal(resolve(configPath), new Set<string>());
}

/**
 * Try to find and load a parent config by package name.
 * Searches: node_modules, workspace packages, known paths.
 */
function resolveParentConfig(packageName: string, fromDir: string): MEMOConfig | undefined {
    const configPath = resolveParentConfigPath(packageName, fromDir);
    return configPath ? loadConfig(configPath) : undefined;
}

function loadConfigChainInternal(configPath: string, seen: Set<string>): ConfigChainEntry[] {
    if (seen.has(configPath)) return [];
    seen.add(configPath);

    const config = loadConfig(configPath);
    const chain: ConfigChainEntry[] = [];

    if (config.extends) {
        const extendsArr = Array.isArray(config.extends) ? config.extends : [config.extends];
        for (const parentName of extendsArr) {
            const parentPath = resolveParentConfigPath(parentName, dirname(configPath));
            if (parentPath) {
                chain.push(...loadConfigChainInternal(parentPath, seen));
            }
        }
    }

    chain.push({ configPath, config });
    return chain;
}

function resolveParentConfigPath(packageName: string, fromDir: string): string | undefined {
    return resolvePackageConfig(packageName, fromDir);
}
