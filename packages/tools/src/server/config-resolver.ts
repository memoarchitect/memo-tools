import { readIdentityRegistry } from '../model/identity-registry.js';
// ─── Settings Resolution ──────────────────────────────────────────────────────
//
// There is nothing left to resolve.
//
// This module used to walk a settings file's `extends` chain and merge kinds,
// layers, viewpoints, workflows, and ontology references down it — which meant
// a project's model content was assembled from a chain of YAML files. The chain
// is gone: the project's SysML imports are the dependency graph, and settings
// carry only how the tools run.
//
// The function survives with its old name so callers read the same, and returns
// the settings for the file's own directory with no inheritance.
// ─────────────────────────────────────────────────────────────────────────────

import { dirname, resolve } from 'node:path';
import type { MEMOConfig } from '@memoarchitect/tools';
import { loadConfig } from '@memoarchitect/tools';

export interface ConfigChainEntry {
    configPath: string;
    config: MEMOConfig;
}

/** Load application settings from a file. No inheritance is applied. */
export function loadAndResolveConfig(configPath: string): MEMOConfig {
    const config = loadConfig(configPath);
    // Same reason as loadProjectSettings: the registry is loaded once, where
    // the project root is known, not per call site.
    config.priorIdentities = readIdentityRegistry(dirname(resolve(configPath)));
    return config;
}

/**
 * The settings "chain", which is now always a single entry.
 *
 * Kept so the lock generator's shape is unchanged while it moves to the native
 * resolution: what a project depends on is decided by its imports, and a lock
 * records the artifacts those imports resolved to.
 */
export function loadConfigChain(configPath: string): ConfigChainEntry[] {
    const path = resolve(configPath);
    return [{ configPath: path, config: loadConfig(path) }];
}

/** The directory a settings file governs. */
export function configDir(configPath: string): string {
    return dirname(resolve(configPath));
}
