// ─── Ontology packages ───────────────────────────────────────────────────────
//
// Where an ontology package lives (its source directory, and the config a package
// name resolves to), what the ontology browser reports of one, and the authority
// table that says which resolved root a file belongs to. MEMO parses no ontology
// source: a package's kinds and layers come from the compiler's handoff
// (`stage2/package-metadata-from-api.ts`).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDOR_ONTOLOGY_DIR } from './paths.js';
import { discoverMemoManifests, findMemoManifests, resolveManifestPath } from './manifest.js';
import { CONFIG_SEARCH_ORDER, readPackageManifest } from './package-manifest.js';
import { ProvenanceTable, type ResolvedRoot } from './source-provenance.js';
import type { NativeProjectResolution } from './native-project.js';

// ─── Ontology Package Metadata (Phase C2) ────────────────────────────────────

export interface OntologyRelationshipInfo {
    name: string;
    sourceKind?: string;    // from first typed `end` in connection def
    targetKind?: string;    // from second typed `end` in connection def
}

export interface OntologyPackageInfo {
    name: string;
    version: string;
    type: 'ontology' | 'profile' | 'extension' | 'methodology';
    description: string;
    extends?: string;
    layers: OntologyLayerInfo[];
    kindCount: number;
    relationshipCount: number;
    relationshipTypes: OntologyRelationshipInfo[];
    selected: boolean;
    /** Optional modules declared by this package (OWL-style — loadable on demand). */
    optionalModules?: string[];
    /** True when this package is listed in another package's optionalModules. */
    isOptionalModule?: boolean;
    // Absolute path to the package directory. Set by the dev server so the web
    // client can emit `open-file` WS events (N-ONTO §6.5 source-file deep-links).
    rootDir?: string;
    /**
     * The `ExplorerClassification` usages this package declares, verbatim.
     *
     * `layers` already has these APPLIED — its ids are explorerDomains and its
     * kinds carry explorerGroups. That is enough for a kind the ontology
     * declares, and not enough for anything else: the native SysML constructs
     * the builder synthesizes (ActionUsage, ItemDefinition, ForkNode,
     * JoinNode) have no kind entry, and the only thing that places them is
     * their NAMESPACE, which is what these are keyed by. A consumer without
     * them has to hardcode the taxonomy, which is how a `behavior` layer the
     * ontology never declared reached the Model Explorer.
     */
    explorerPlacements?: ExplorerPlacement[];
    /** The `LayerRendering` usages this package declares — labels and colours. */
    layerPalette?: LayerPalette[];
}

export interface OntologyLayerInfo {
    id: string;
    label: string;
    color: string;
    kindCount: number;
    kinds: OntologyKindInfo[];
}

export interface OntologyKindInfo {
    name: string;
    label: string;
    construct: string;
    layer: string;
    instanceCount: number;
    viewpoints: string[];
    description?: string;
    derivesFrom?: string;
    derivedBy?: string[];
    relationships?: Array<{ type: string; targetKind: string; direction: 'outgoing' | 'incoming' }>;
    /** Namespace sub-group: the first directory under the layer (e.g. "context", "risk", "iso14971"). */
    group?: string;
    /** Compliance standard (e.g. "iso14971"), set for kinds under compliance/<standard>/ */
    standard?: string;
    /** Abstract ontology bases organize the type system but are not Explorer folders. */
    isAbstract?: boolean;
}

/** Layer color palette (mirrors web constants) */
export const LAYER_COLORS: Record<string, string> = {
    // ontology-core layers
    purpose: '#6366F1', operational: '#8B5CF6', system: '#7C3AED',
    requirements: '#EC4899', functional: '#F59E0B', logical: '#06B6D4',
    hardware: '#10B981', physical: '#10B981',
    software: '#3B82F6', interfaces: '#14B8A6', analysis: '#F97316',
    verification: '#84CC16', relationships: '#9CA3AF',
    // ontology-medical layers
    risk: '#EF4444', safety: '#F97316', 'design-control': '#8B5CF6',
    operations: '#10B981', ui: '#EC4899', clinical: '#06B6D4',
    // ontology-qms layers
    qms: '#6B7280', 'design-control-qms': '#8B5CF6',
    // ontology-iec62304 layers
    'software-lifecycle': '#3B82F6',
    // ontology-cybersecurity layers
    cybersecurity: '#EF4444', privacy: '#6366F1',
    // ontology-ros layers
    middleware: '#0EA5E9',
    // compliance layer
    compliance: '#7C3AED',
    // artifact dimension
    artifacts: '#D97706',
};

/** One `ExplorerClassification` usage, read from ontology SysML. */
export interface ExplorerPlacement {
    sourceNamespace: string;
    explorerDomain: string;
    explorerGroup: string;
}

/** One `LayerRendering` usage, read from ontology SysML. */
export interface LayerPalette {
    layerId: string;
    layerLabel: string;
    layerColor: string;
}

/**
 * Resolve the SysML root directory for an ontology package.
 * Honors `sysmlDir:` override in the package's manifest; falls back to `<pkgDir>/sysml`.
 */
export function resolvePackageSysmlDir(pkgDir: string): string {
    const override = readPackageManifest(pkgDir).manifest.sysmlDir;
    return override ? resolve(pkgDir, override) : resolve(pkgDir, 'sysml');
}

/**
 * Resolve a @memoarchitect/package-name to its config file path.
 * Prefers memo.package.yaml (new format), falls back to memo.config.yaml (legacy).
 * Searches: workspace packages (monorepo), then node_modules.
 */
export function resolvePackageConfig(packageName: string, fromDir: string): string | undefined {
    const shortName = packageName.replace(/^@[^/]+\//, '');
    const startDir = resolve(fromDir);
    const projectConfig = findNearestProjectConfig(startDir);
    const boundary = projectConfig ? dirname(projectConfig) : undefined;

    // A logical package config is itself inside the physical content package.
    // It is not a user-project boundary: allow sibling logical packages to be
    // resolved through the nearest enclosing manifest.
    // A logical package descriptor sits inside the physical content package, so
    // it is not a user-project boundary. Sibling logical packages resolve
    // through the nearest enclosing distribution manifest.
    if (projectConfig) {
        {
            let manifestDir = dirname(projectConfig);
            while (true) {
                for (const manifest of discoverMemoManifests([manifestDir])) {
                    const subpath = manifest.manifest.packages[packageName];
                    if (!subpath) continue;
                    const packageDir = resolveManifestPath(manifest, subpath);
                    for (const configName of CONFIG_SEARCH_ORDER) {
                        const candidate = resolve(packageDir, configName);
                        if (existsSync(candidate)) return candidate;
                    }
                }
                if (existsSync(resolve(manifestDir, '.git'))) break;
                const parent = dirname(manifestDir);
                if (parent === manifestDir) break;
                manifestDir = parent;
            }
        }
    }

    let dir = startDir;
    while (true) {
        for (const manifest of discoverMemoManifests([dir])) {
            const subpath = manifest.manifest.packages[packageName];
            if (!subpath) continue;
            const packageDir = resolveManifestPath(manifest, subpath);
            for (const configName of CONFIG_SEARCH_ORDER) {
                const candidate = resolve(packageDir, configName);
                if (existsSync(candidate)) return candidate;
            }
        }

        for (const configName of CONFIG_SEARCH_ORDER) {
            const candidate = resolve(dir, 'packages', shortName, configName);
            if (existsSync(candidate)) return candidate;
        }

        for (const configName of CONFIG_SEARCH_ORDER) {
            const localCandidate = resolve(dir, 'memo_packages', shortName, configName);
            if (existsSync(localCandidate)) return localCandidate;
        }

        for (const configName of CONFIG_SEARCH_ORDER) {
            const nmCandidate = resolve(dir, 'node_modules', packageName, configName);
            if (existsSync(nmCandidate)) return nmCandidate;
        }

        if (dir === boundary || existsSync(resolve(dir, '.git'))) break;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    // Workspace convenience is explicit and manifest-driven; published project
    // resolution never relies on walking above its own root.
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const devManifestRoot = resolve(packageRoot, VENDOR_ONTOLOGY_DIR);
    for (const manifest of [
        ...findMemoManifests(fromDir),
        ...discoverMemoManifests([devManifestRoot]),
    ]) {
        const subpath = manifest.manifest.packages[packageName];
        if (!subpath) continue;
        const packageDir = resolveManifestPath(manifest, subpath);
        for (const configName of CONFIG_SEARCH_ORDER) {
            const candidate = resolve(packageDir, configName);
            if (existsSync(candidate)) return candidate;
        }
    }
    return undefined;
}

function findNearestProjectConfig(startDir: string): string | undefined {
    let dir = resolve(startDir);
    while (true) {
        for (const name of CONFIG_SEARCH_ORDER) {
            const candidate = resolve(dir, name);
            if (existsSync(candidate)) return candidate;
        }
        if (existsSync(resolve(dir, '.git'))) return undefined;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/**
 * Classify each resolved package into an authority category.
 *
 * Origin comes from the resolved root a file sits under — never from what the
 * file declares, what it is called, or where it sits in a directory tree.
 * Import depth is now the real graph distance from the project entrypoint,
 * which is what session 1 left this function waiting for; before, it was the
 * package's position in an ordered walk.
 */
export function buildProvenanceTable(resolution: NativeProjectResolution): ProvenanceTable {
    const byDir = new Map<string, ResolvedRoot>();
    for (const pkg of resolution.closure.values()) {
        if (!pkg.root) continue;
        const existing = byDir.get(pkg.root.dir);
        if (existing && existing.importDepth <= pkg.importDepth) continue;
        byDir.set(pkg.root.dir, {
            dir: pkg.root.dir,
            origin: pkg.origin,
            packageName: pkg.root.packageName,
            packageVersion: pkg.root.packageVersion,
            importDepth: pkg.importDepth,
        });
    }
    const roots: ResolvedRoot[] = [];
    for (const root of byDir.values()) {
        roots.push(root);
        // A package may publish its SysML from a directory outside its own
        // descriptor directory. Both physical roots are the same authority.
        const lib = resolution.selectedRoots.find(r => r.dir === root.dir);
        if (lib && lib.sysmlDir !== root.dir) roots.push({ ...root, dir: lib.sysmlDir });
    }
    return new ProvenanceTable(resolution.projectRoot, roots);
}
