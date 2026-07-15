// ─── Config Resolver ──────────────────────────────────────────────────────────
//
// Resolves the `extends` chain for MEMO configs.
// Handles: "@memo/medical-modeling-profile" → find config in node_modules or workspace packages
// Supports both new format (memo.package.yaml) and legacy (memo.config.yaml).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { MEMOConfig } from '@memo/core';
import { loadConfig, resolveConfig, VENDOR_ONTOLOGY_PACKAGES_DIR } from '@memo/core';

/** Ordered list of config filenames to search for (new format first, then legacy) */
const CONFIG_SEARCH_ORDER = [
    'memo.package.yaml',
    'memo.package.yml',
    'memo.config.yaml',
    'memo.config.yml',
];

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
    // Resolution order (per platform-strategy.md §6):
    // 1. memo/packages/<name>/ (git submodule)
    // 2. packages/<name>/          (workspace)
    // 3. memo_packages/<name>/     (local installs via `memo install`)
    // 4. node_modules/<name>/      (npm installs)

    // Strategy 1: vendor submodule (memo-sysmlv2)
    const vendorPath = resolveFromVendor(packageName, fromDir);
    if (vendorPath) return vendorPath;

    // Strategy 2: workspace packages (monorepo packages/)
    const wsPath = resolveFromWorkspace(packageName, fromDir);
    if (wsPath) return wsPath;

    // Strategy 3: memo_packages/ (local installs)
    const localPath = resolveFromMemoPackages(packageName, fromDir);
    if (localPath) return localPath;

    // Strategy 4: node_modules resolution
    const nmPath = resolveFromNodeModules(packageName, fromDir);
    if (nmPath) return nmPath;

    return undefined;
}

function resolveFromNodeModules(packageName: string, fromDir: string): string | undefined {
    let dir = resolve(fromDir);
    while (true) {
        for (const configName of CONFIG_SEARCH_ORDER) {
            const candidate = resolve(dir, 'node_modules', packageName, configName);
            if (existsSync(candidate)) return candidate;
        }

        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

function resolveFromVendor(packageName: string, fromDir: string): string | undefined {
    const shortName = packageName.replace(/^@[^/]+\//, '');

    let dir = resolve(fromDir);
    while (true) {
        const vendorDir = resolve(dir, VENDOR_ONTOLOGY_PACKAGES_DIR, shortName);
        for (const configName of CONFIG_SEARCH_ORDER) {
            const candidate = resolve(vendorDir, configName);
            if (existsSync(candidate)) return candidate;
        }

        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

function resolveFromWorkspace(packageName: string, fromDir: string): string | undefined {
    const shortName = packageName.replace(/^@[^/]+\//, '');

    let dir = resolve(fromDir);
    while (true) {
        const packagesDir = resolve(dir, 'packages', shortName);
        for (const configName of CONFIG_SEARCH_ORDER) {
            const candidate = resolve(packagesDir, configName);
            if (existsSync(candidate)) return candidate;
        }

        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

function resolveFromMemoPackages(packageName: string, fromDir: string): string | undefined {
    const shortName = packageName.replace(/^@[^/]+\//, '');

    let dir = resolve(fromDir);
    while (true) {
        // Try both the short name and the full scoped name path
        for (const dirName of [shortName, packageName]) {
            const pkgDir = resolve(dir, 'memo_packages', dirName);
            for (const configName of CONFIG_SEARCH_ORDER) {
                const candidate = resolve(pkgDir, configName);
                if (existsSync(candidate)) return candidate;
            }
        }

        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}
