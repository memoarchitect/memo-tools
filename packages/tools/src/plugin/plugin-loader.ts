// ─── MEMO Plugin Loader ──────────────────────────────────────────────────────
//
// Loads plugins from npm packages or local files. Follows EventCatalog's
// convention: plugins are modules that export a default plugin object or
// a factory function.
//
// Module resolution:
//   - Local path (starts with . or /): resolved relative to project dir
//   - npm package: resolved via Node.js module resolution
//
// Plugin module contract:
//   export default: MemoPlugin | ((options?) => MemoPlugin)
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { MemoPlugin, PluginEntry, PluginManifest } from './plugin-types.js';
import { PluginRegistry } from './plugin-registry.js';

/** Result of loading plugins */
export interface PluginLoadResult {
    /** Successfully loaded plugins */
    loaded: MemoPlugin[];
    /** Errors encountered during loading */
    errors: Array<{ module: string; error: string }>;
}

/**
 * Load plugins from an array of plugin entries (from config).
 * Returns loaded plugins and any errors.
 */
export async function loadPlugins(
    entries: PluginEntry[],
    projectDir: string,
    registry?: PluginRegistry,
): Promise<PluginLoadResult> {
    const loaded: MemoPlugin[] = [];
    const errors: Array<{ module: string; error: string }> = [];

    for (const entry of entries) {
        if (entry.enabled === false) continue;

        try {
            const plugin = await loadSinglePlugin(entry, projectDir);
            loaded.push(plugin);
            if (registry) {
                registry.register(plugin);
            }
        } catch (err: any) {
            errors.push({
                module: entry.module,
                error: err.message || String(err),
            });
        }
    }

    return { loaded, errors };
}

/**
 * Load a single plugin from a module path.
 */
async function loadSinglePlugin(entry: PluginEntry, projectDir: string): Promise<MemoPlugin> {
    const modulePath = resolveModulePath(entry.module, projectDir);

    // Dynamic import
    let mod: any;
    try {
        mod = await import(modulePath);
    } catch (err: any) {
        throw new Error(`Failed to import plugin module "${entry.module}": ${err.message}`);
    }

    // Resolve the plugin from the module export
    const exported = mod.default || mod;

    let plugin: MemoPlugin;
    if (typeof exported === 'function') {
        // Factory function: (options?) => MemoPlugin
        plugin = exported(entry.options || {});
    } else if (typeof exported === 'object' && exported.id && exported.type) {
        // Direct plugin object
        plugin = exported;
    } else {
        throw new Error(
            `Plugin module "${entry.module}" must export a MemoPlugin object or a factory function. ` +
            `Got: ${typeof exported}`,
        );
    }

    // Validate minimal shape
    if (!plugin.id || !plugin.type || !plugin.name || !plugin.version) {
        throw new Error(
            `Plugin from "${entry.module}" is missing required fields (id, type, name, version). ` +
            `Got: id=${plugin.id}, type=${plugin.type}, name=${plugin.name}, version=${plugin.version}`,
        );
    }

    return plugin;
}

/**
 * Resolve a module path to an importable URL/path.
 */
function resolveModulePath(moduleName: string, projectDir: string): string {
    // Local path: starts with . or /
    if (moduleName.startsWith('.') || moduleName.startsWith('/')) {
        const absolute = resolve(projectDir, moduleName);
        // Check for .js, .ts, .mjs variants
        for (const ext of ['', '.js', '.mjs', '/index.js', '/index.mjs']) {
            const candidate = absolute + ext;
            if (existsSync(candidate)) return candidate;
        }
        return absolute; // Let import() fail with a clear error
    }

    // npm package — return as-is for Node.js resolution
    return moduleName;
}

/**
 * Load a plugin manifest from a directory.
 */
export function loadPluginManifest(pluginDir: string): PluginManifest | undefined {
    const manifestPath = join(pluginDir, 'memo.plugin.yaml');
    if (!existsSync(manifestPath)) return undefined;

    try {
        // Use dynamic import for yaml to avoid circular deps
        const content = readFileSync(manifestPath, 'utf-8');
        // Simple YAML parsing for manifest (key: value format)
        return parseSimpleYaml(content) as PluginManifest;
    } catch {
        return undefined;
    }
}

/** Parse simple flat YAML (enough for plugin manifests) */
function parseSimpleYaml(content: string): Record<string, any> {
    const result: Record<string, any> = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value: any = trimmed.slice(colonIdx + 1).trim();
        // Remove quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        // Handle arrays (simple inline format: [a, b, c])
        if (value.startsWith('[') && value.endsWith(']')) {
            value = value.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, ''));
        }
        // Handle booleans
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        result[key] = value;
    }
    return result;
}

/**
 * Load plugin entries from a memo.plugins.yaml file.
 */
export function loadPluginConfig(projectDir: string): PluginEntry[] {
    const configPath = join(projectDir, 'memo.plugins.yaml');
    if (!existsSync(configPath)) return [];

    try {
        const content = readFileSync(configPath, 'utf-8');
        // Parse YAML plugin entries
        return parsePluginEntries(content);
    } catch {
        return [];
    }
}

/** Parse plugin entries from YAML content */
function parsePluginEntries(content: string): PluginEntry[] {
    const entries: PluginEntry[] = [];
    const lines = content.split('\n');
    let currentEntry: Partial<PluginEntry> | null = null;
    let inOptions = false;
    let options: Record<string, unknown> = {};

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // New plugin entry (starts with - module:)
        if (trimmed.startsWith('- module:')) {
            if (currentEntry?.module) {
                entries.push({
                    module: currentEntry.module,
                    options: Object.keys(options).length > 0 ? options : undefined,
                    enabled: currentEntry.enabled,
                });
            }
            currentEntry = { module: trimmed.slice('- module:'.length).trim().replace(/^["']|["']$/g, '') };
            inOptions = false;
            options = {};
            continue;
        }

        if (!currentEntry) continue;

        if (trimmed.startsWith('enabled:')) {
            currentEntry.enabled = trimmed.slice('enabled:'.length).trim() !== 'false';
        } else if (trimmed === 'options:') {
            inOptions = true;
        } else if (inOptions && trimmed.includes(':')) {
            const colonIdx = trimmed.indexOf(':');
            const key = trimmed.slice(0, colonIdx).trim();
            let value: any = trimmed.slice(colonIdx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (!isNaN(Number(value)) && value !== '') value = Number(value);
            options[key] = value;
        }
    }

    // Push last entry
    if (currentEntry?.module) {
        entries.push({
            module: currentEntry.module,
            options: Object.keys(options).length > 0 ? options : undefined,
            enabled: currentEntry.enabled,
        });
    }

    return entries;
}
