import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { MEMOConfig, ArchLayer, ViewpointDefinition } from './config.js';

const CONFIG_FILENAMES = ['memo.config.yaml', 'memo.config.yml'];
const PACKAGE_FILENAMES = ['memo.package.yaml', 'memo.package.yml'];
const RENDERING_FILENAMES = ['memo.rendering.yaml', 'memo.rendering.yml'];
const VIEWPOINTS_FILENAMES = ['memo.viewpoints.yaml', 'memo.viewpoints.yml'];

/**
 * Locate the nearest config file by walking up from `startDir`.
 * Prefers memo.package.yaml (new format), falls back to memo.config.yaml (legacy).
 * Returns the resolved path or undefined if not found.
 */
export function findConfigFile(startDir: string): string | undefined {
    let dir = resolve(startDir);
    while (true) {
        // Prefer new package format
        for (const name of PACKAGE_FILENAMES) {
            const candidate = resolve(dir, name);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        // Fall back to legacy config
        for (const name of CONFIG_FILENAMES) {
            const candidate = resolve(dir, name);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break; // reached filesystem root
        dir = parent;
    }
    return undefined;
}

/**
 * Load rendering layers from a memo.rendering.yaml file.
 * Returns the layers array, or empty array if file not found.
 */
export function loadRenderingLayers(configDir: string): ArchLayer[] {
    for (const name of RENDERING_FILENAMES) {
        const candidate = resolve(configDir, name);
        if (existsSync(candidate)) {
            try {
                const raw = readFileSync(candidate, 'utf-8');
                const parsed = parseYaml(raw);
                return parsed?.layers ?? [];
            } catch {
                // skip malformed file
            }
        }
    }
    return [];
}

/**
 * Load viewpoints from a memo.viewpoints.yaml file.
 * Returns the viewpoints array, or undefined if file not found.
 */
export function loadViewpoints(configDir: string): { viewpoints?: ViewpointDefinition[]; firstRun?: MEMOConfig['firstRun'] } {
    for (const name of VIEWPOINTS_FILENAMES) {
        const candidate = resolve(configDir, name);
        if (existsSync(candidate)) {
            try {
                const raw = readFileSync(candidate, 'utf-8');
                const parsed = parseYaml(raw);
                return {
                    viewpoints: parsed?.viewpoints,
                    firstRun: parsed?.firstRun,
                };
            } catch {
                // skip malformed file
            }
        }
    }
    return {};
}

/**
 * Check if a file path is a new-format package file (memo.package.yaml).
 */
function isPackageFile(filePath: string): boolean {
    const name = filePath.split('/').pop() ?? '';
    return PACKAGE_FILENAMES.includes(name);
}

/**
 * Load and parse a MEMOConfig from a YAML file.
 * Supports both new format (memo.package.yaml) and legacy format (memo.config.yaml).
 * Also loads memo.rendering.yaml, memo.rules.yaml, and memo.viewpoints.yaml if present.
 * Does NOT resolve `extends` — call `resolveConfig` for that.
 */
export function loadConfig(filePath: string): MEMOConfig {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = parseYaml(raw);
    const configDir = dirname(filePath);

    // Load rendering layers from memo.rendering.yaml (new format)
    const renderingLayers = loadRenderingLayers(configDir);

    // Load viewpoints from memo.viewpoints.yaml (new format)
    const viewpointsData = loadViewpoints(configDir);

    if (isPackageFile(filePath)) {
        // New format: memo.package.yaml — identity only, combine with companion files
        return {
            projectName: parsed.name ?? 'untitled',
            projectType: parsed.type ?? 'device',
            extends: parsed.extends,
            ontologies: parsed.ontologies,
            ontologyMetadata: parsed.name ? {
                id: parsed.name,
                version: parsed.version ?? '0.0.0',
                description: parsed.description ?? '',
                author: parsed.author,
                license: parsed.license,
                tags: parsed.tags,
            } : undefined,
            architectureLayers: renderingLayers,
            viewpoints: viewpointsData.viewpoints,
            firstRun: viewpointsData.firstRun,
        };
    }

    // Legacy format: memo.config.yaml
    // Merge: memo.rendering.yaml layers take precedence, then architectureLayers from config
    // Support both old (cosmaLayers) and new (architectureLayers) config key names
    const archLayersFromConfig: ArchLayer[] = (parsed as any).architectureLayers ?? (parsed as any).cosmaLayers ?? [];
    const mergedLayers = renderingLayers.length > 0
        ? dedup([...archLayersFromConfig, ...renderingLayers], l => l.id)
        : archLayersFromConfig;

    // Merge viewpoints from file if present
    const viewpointsFromConfig = parsed.viewpoints;
    const mergedViewpoints = viewpointsData.viewpoints ?? viewpointsFromConfig;

    // Apply defaults
    return {
        projectName: parsed.projectName ?? 'untitled',
        projectType: parsed.projectType ?? 'device',
        extends: parsed.extends,
        ontologies: parsed.ontologies,
        ontologyMetadata: parsed.ontologyMetadata,
        externalOntologies: parsed.externalOntologies,
        libraries: parsed.libraries,
        architectureLayers: mergedLayers,
        kinds: parsed.kinds,
        relationshipTypes: parsed.relationshipTypes,
        viewpoints: mergedViewpoints,
        workflows: parsed.workflows,
        firstRun: viewpointsData.firstRun ?? parsed.firstRun,
    };
}

/**
 * Resolve the `extends` chain by merging configs.
 * Child properties override parent properties; arrays are concatenated.
 * `extends` may be a single package name or an array of names.
 */
export function resolveConfig(
    config: MEMOConfig,
    loader: (packageName: string) => MEMOConfig | undefined
): MEMOConfig {
    if (!config.extends) return config;

    const extendsArr = Array.isArray(config.extends) ? config.extends : [config.extends];

    let base: MEMOConfig | undefined;
    for (const parentName of extendsArr) {
        const parent = loader(parentName);
        if (!parent) {
            console.warn(`Warning: Could not resolve parent config "${parentName}"`);
            continue;
        }
        const resolvedParent = resolveConfig(parent, loader);
        base = base ? mergeConfigs(base, resolvedParent) : resolvedParent;
    }

    if (!base) return config;
    return mergeConfigs(base, config);
}

/** Deduplicate an array by a key function. Last occurrence wins. */
function dedup<T>(arr: T[], key: (item: T) => string): T[] {
    const seen = new Map<string, T>();
    for (const item of arr) {
        seen.set(key(item), item);
    }
    return Array.from(seen.values());
}

/** Merge viewpoints: deduplicate by id, and merge diagrams within shared viewpoints */
function mergeViewpoints(
    parentVps: ViewpointDefinition[] | undefined,
    childVps: ViewpointDefinition[] | undefined
): ViewpointDefinition[] | undefined {
    if (!parentVps && !childVps) return undefined;
    if (!parentVps) return childVps;
    if (!childVps) return parentVps;

    const merged = new Map<string, ViewpointDefinition>();
    for (const vp of parentVps) {
        merged.set(vp.id, { ...vp });
    }
    for (const vp of childVps) {
        if (merged.has(vp.id)) {
            // Child overrides parent viewpoint, but merge diagrams
            const parent = merged.get(vp.id)!;
            const parentDiagrams = parent.diagrams ?? [];
            const childDiagrams = vp.diagrams ?? [];
            const mergedDiagrams = dedup(
                [...parentDiagrams, ...childDiagrams],
                d => d.id
            );
            merged.set(vp.id, {
                ...vp,
                diagrams: mergedDiagrams.length > 0 ? mergedDiagrams : undefined,
                supportedDiagramTypes: vp.supportedDiagramTypes ?? parent.supportedDiagramTypes,
            });
        } else {
            merged.set(vp.id, { ...vp });
        }
    }
    return Array.from(merged.values());
}

/** Deep-merge parent into child. Child takes precedence. Arrays are deduped. */
function mergeConfigs(parent: MEMOConfig, child: MEMOConfig): MEMOConfig {
    return {
        projectName: child.projectName,
        projectType: child.projectType,
        extends: child.extends,
        ontologies: child.ontologies ?? parent.ontologies,
        ontologyMetadata: child.ontologyMetadata ?? parent.ontologyMetadata,
        externalOntologies: [
            ...(parent.externalOntologies ?? []),
            ...(child.externalOntologies ?? []),
        ].length > 0 ? [
            ...(parent.externalOntologies ?? []),
            ...(child.externalOntologies ?? []),
        ] : undefined,
        libraries: [
            ...(parent.libraries ?? []),
            ...(child.libraries ?? []),
        ].length > 0 ? [
            ...(parent.libraries ?? []),
            ...(child.libraries ?? []),
        ] : undefined,
        architectureLayers: dedup(
            [...(parent.architectureLayers ?? []), ...(child.architectureLayers ?? [])],
            l => l.id
        ),
        kinds: {
            ...(parent.kinds ?? {}),
            ...(child.kinds ?? {}),
        },
        relationshipTypes: dedup(
            [...(parent.relationshipTypes ?? []), ...(child.relationshipTypes ?? [])],
            r => r.name
        ),
        viewpoints: mergeViewpoints(parent.viewpoints, child.viewpoints),
        workflows: child.workflows ?? parent.workflows,
        firstRun: child.firstRun ?? parent.firstRun,
    };
}
