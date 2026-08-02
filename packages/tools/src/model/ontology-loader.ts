// ─── Ontology Loader ──────────────────────────────────────────────────────────
//
// Pipeline: parse ontology SysML → populate KindRegistry + RelationshipRegistry.
// Walks the config `extends` chain to find ontology packages, locates their
// `sysml/` directories, parses all SysML files, and populates registries.
//
// Usage:
//   const registries = await loadOntologyRegistries(configPath);
//   const model = buildMemoModel(documents, config, errors, registries);
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
    isConnectionDefinition,
    isDocComment,
    isEndDeclaration,
    isPackageDeclaration,
} from '../language/generated/ast.js';
import { KindRegistry, type KindNameCollision } from './kind-registry.js';
import { RelationshipRegistry } from './relationship-registry.js';
import { parseFiles, parseFileToAstSync } from './parser-utils.js';
import { VENDOR_ONTOLOGY_DIR } from './paths.js';
import { discoverMemoManifests, findMemoManifests, resolveManifestPath } from './manifest.js';
import {
    CONFIG_SEARCH_ORDER,
    readManifest,
    readPackageManifest,
    qualifyPackageName,
    type MemoManifest,
} from './package-manifest.js';
import { ProvenanceTable, type ResolvedRoot } from './source-provenance.js';
import { discoverLibraryRoots, resolveNativeProject, type NativeProjectResolution } from './native-project.js';
import type { BuilderRegistries } from './builder.js';

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
const LAYER_COLORS: Record<string, string> = {
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

/** Parsed kind info from a SysML file */
interface ParsedKindInfo {
    name: string;
    construct: string;
    derivesFrom?: string;
    description?: string;
    isAbstract?: boolean;
}

/** Parsed relationship info from a connection def */
interface ParsedRelationshipInfo {
    name: string;
    sourceKind?: string;
    targetKind?: string;
}

/**
 * AST node `$type` → the `<construct> def` spelling reported in catalog DTOs.
 *
 * Kept separate from kind-registry's own map because that one deliberately
 * omits connection/metadata definitions (they classify relationships and
 * annotations, not model elements) while the catalog view lists them.
 */
const CATALOG_CONSTRUCTS: Record<string, string> = {
    PartDefinition: 'part def',
    RequirementDefinition: 'requirement def',
    VerificationDefinition: 'verification def',
    StateDefinition: 'state def',
    UseCaseDeclaration: 'use case def',
    ActionDefinition: 'action def',
    AttributeDefinition: 'attribute def',
    ItemDefinition: 'item def',
    PortDefinition: 'port def',
    InterfaceDefinition: 'interface def',
    EnumDefinition: 'enum def',
    ConnectionDefinition: 'connection def',
    MetadataDefinition: 'metadata def',
    // ConstraintDefinition is deliberately absent: rules are not catalog kinds,
    // and including them would add 33 entries to the ontology browser that the
    // previous scanner never listed. Session 1 changes no output.
};

/**
 * Read the definitions and connection endpoints declared in one SysML file.
 *
 * This walks the parsed AST. The previous implementation pattern-matched the
 * source text, which meant a definition inside a block comment counted, a
 * `connection def` whose body contained a nested brace truncated at the wrong
 * place, and a qualified supertype (`:> memo::core::MemoPart`) was recorded as
 * the bare last segment only by accident of the character class. Reading the
 * tree removes all three failure modes and costs one parse per file.
 */
function parseConstructsInFile(filePath: string): { kinds: ParsedKindInfo[]; relationships: ParsedRelationshipInfo[] } {
    const kinds: ParsedKindInfo[] = [];
    const relationships: ParsedRelationshipInfo[] = [];

    const model = parseFileToAstSync(filePath);
    if (!model) return { kinds, relationships };

    for (const { node, doc } of walkDefinitions(model)) {
        const construct = CATALOG_CONSTRUCTS[node.$type];
        if (!construct) continue;
        const name = (node as { name?: string }).name;
        if (!name) continue;

        // The catalog reports the bare supertype name, matching how kinds are
        // keyed in the browser DTO; the qualified form is preserved in the
        // registry, which is what conformance walks.
        const superType = (node as { specialization?: { superType?: string } }).specialization?.superType;
        kinds.push({
            name,
            construct,
            derivesFrom: superType ? superType.split('::').pop() : undefined,
            description: doc,
            isAbstract: (node as { isAbstract?: boolean }).isAbstract || undefined,
        });

        if (isConnectionDefinition(node)) {
            const typedEnds: string[] = [];
            for (const member of node.body) {
                if (isEndDeclaration(member) && member.type) {
                    typedEnds.push(member.type.split('::').pop() ?? member.type);
                }
            }
            relationships.push({ name, sourceKind: typedEnds[0], targetKind: typedEnds[1] });
        }
    }
    return { kinds, relationships };
}

/**
 * Yield every definition in a model with the doc comment that precedes it.
 *
 * Packages nest arbitrarily, so this recurses rather than assuming the
 * ontology's current two-level shape.
 */
function* walkDefinitions(
    container: { members?: unknown[]; body?: unknown[] },
): Generator<{ node: { $type: string }; doc?: string }> {
    const members = (container.members ?? container.body ?? []) as Array<Record<string, unknown>>;
    let pendingDoc: string | undefined;
    for (const member of members) {
        if (!member || typeof member !== 'object') continue;
        if (isDocComment(member)) {
            pendingDoc = cleanDoc(String((member as { content?: unknown }).content ?? ''));
            continue;
        }
        if (isPackageDeclaration(member)) {
            yield* walkDefinitions(member as never);
            pendingDoc = undefined;
            continue;
        }
        if (typeof member.$type === 'string' && CATALOG_CONSTRUCTS[member.$type]) {
            yield { node: member as { $type: string }, doc: pendingDoc };
        }
        pendingDoc = undefined;
    }
}

function cleanDoc(content: string): string | undefined {
    return content.replace(/\s+/g, ' ').trim() || undefined;
}

/**
 * Build layer info by scanning the sysml/ directory tree.
 * Apollo-11 convention: sysml/<layer>/<file>.sysml
 *
 * Files under <layer>/ are collected recursively, so both flat
 * (`<layer>/file.sysml`) and nested (`<layer>/<sublayer>/file.sysml`)
 * layouts load. The first directory under sysmlDir is the layer id.
 */
export function buildLayers(sysmlDir: string): OntologyLayerInfo[] {
    const layers: OntologyLayerInfo[] = [];
    if (!existsSync(sysmlDir)) return layers;

    // First pass: collect all kinds across all layers
    const allParsedKinds: Array<ParsedKindInfo & { layer: string }> = [];

    try {
        for (const entry of readdirSync(sysmlDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const layerId = entry.name;
            const layerDir = join(sysmlDir, layerId);
            const layerKinds: OntologyKindInfo[] = [];

            for (const filePath of collectSysmlFiles(layerDir)) {
                const { kinds } = parseConstructsInFile(filePath);
                // The on-disk tree mirrors the memo:: namespace, so the first
                // sub-directory under a layer is the namespace sub-group
                // (e.g. architecture/<context|risk|…>/, compliance/<iso14971|…>/).
                const rel = filePath.replace(/\\/g, '/').substring(layerDir.replace(/\\/g, '/').length + 1);
                const firstSeg = rel.split('/')[0];
                const group = firstSeg && !firstSeg.endsWith('.sysml') ? firstSeg : undefined;
                // A compliance sub-group that names a regulatory standard also
                // surfaces as `standard` (the rest — artifacts, change, … — do not).
                const standard = layerId === 'compliance' && group && /^(iso|iec|fda|en|astm|ul|nist|cfr|mdr)/i.test(group)
                    ? group
                    : undefined;
                for (const k of kinds) {
                    allParsedKinds.push({ ...k, layer: layerId });
                    layerKinds.push({
                        name: k.name,
                        label: k.name.replace(/([A-Z])/g, ' $1').trim(),
                        construct: k.construct,
                        layer: layerId,
                        instanceCount: 0,
                        viewpoints: [],
                        description: k.description,
                        derivesFrom: k.derivesFrom,
                        group,
                        standard,
                        isAbstract: k.isAbstract,
                    });
                }
            }

            layers.push({
                id: layerId,
                label: layerId.charAt(0).toUpperCase() + layerId.slice(1).replace(/-/g, ' '),
                color: LAYER_COLORS[layerId] ?? '#6B7280',
                kindCount: layerKinds.length,
                kinds: layerKinds,
            });
        }
    } catch { /* skip */ }

    // Second pass: compute derivedBy (reverse lookup of derivesFrom)
    const derivedByMap = new Map<string, string[]>();
    for (const k of allParsedKinds) {
        if (k.derivesFrom) {
            if (!derivedByMap.has(k.derivesFrom)) derivedByMap.set(k.derivesFrom, []);
            derivedByMap.get(k.derivesFrom)!.push(k.name);
        }
    }
    for (const layer of layers) {
        for (const kind of layer.kinds) {
            kind.derivedBy = derivedByMap.get(kind.name);
        }
    }

    return layers;
}

/**
 * Collect all connection def relationship types from a sysml/ directory tree.
 * Scans all layers (subdirectories) and collects connection def endpoint info.
 */
function buildRelationshipTypes(sysmlDir: string): OntologyRelationshipInfo[] {
    const result: OntologyRelationshipInfo[] = [];
    if (!existsSync(sysmlDir)) return result;
    try {
        for (const entry of readdirSync(sysmlDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const layerDir = join(sysmlDir, entry.name);
            for (const filePath of collectSysmlFiles(layerDir)) {
                const { relationships } = parseConstructsInFile(filePath);
                for (const r of relationships) result.push(r);
            }
        }
    } catch { /* skip */ }
    return result;
}

/**
 * Build OntologyPackageInfo for a single package directory.
 */
function buildPackageInfo(pkgDir: string, selected: boolean): OntologyPackageInfo | null {
    const { path, manifest } = readPackageManifest(pkgDir);
    if (!path) return null;

    const sysmlDir = manifest.sysmlDir
        ? resolve(pkgDir, manifest.sysmlDir)
        : join(pkgDir, 'sysml');
    // Authority is decided by the resolved root a package sits under, from the
    // native import graph. The manifest `type:` that used to declare it is gone.
    const type: OntologyPackageInfo['type'] = suppliesMethodology(sysmlDir) ? 'methodology' : 'ontology';
    const layers = applyExplorerClassification(buildLayers(sysmlDir), sysmlDir);
    const kindCount = layers.reduce((s, l) => s + l.kindCount, 0);
    const relationshipTypes = buildRelationshipTypes(sysmlDir);

    return {
        name: manifest.name ?? basename(pkgDir),
        version: manifest.version ?? '0.0.0',
        type,
        description: manifest.description ?? '',
        layers,
        kindCount,
        relationshipCount: relationshipTypes.length,
        relationshipTypes,
        selected,
        rootDir: pkgDir,
    };
}

/**
 * Does this source tree supply a methodology?
 *
 * A package that declares a `MethodologyDefinition` usage is a methodology
 * package. This is derived from what the SysML says, because the manifest field
 * that used to declare it selected model content and was removed with the rest.
 */
function suppliesMethodology(sysmlDir: string): boolean {
    for (const file of collectSysmlFiles(sysmlDir)) {
        let content = '';
        try { content = readFileSync(file, 'utf-8'); } catch { continue; }
        if (/:\s*MethodologyDefinition\b/.test(content)) return true;
    }
    return false;
}

/** One `ExplorerClassification` usage, read from ontology SysML. */
interface ExplorerPlacement {
    sourceNamespace: string;
    explorerDomain: string;
    explorerGroup: string;
}

/** One `LayerRendering` usage, read from ontology SysML. */
interface LayerPalette {
    layerId: string;
    layerLabel: string;
    layerColor: string;
}

const USAGE_BLOCK = /part\s+\w+\s*:\s*(ExplorerClassification|LayerRendering)\s*\{([\s\S]*?)\n\s*\}/g;

function readAttr(body: string, name: string): string | undefined {
    const m = new RegExp(`attribute\\s+(?::>>|redefines)\\s+${name}\\s*=\\s*"([^"]*)"`).exec(body);
    return m ? m[1] : undefined;
}

/**
 * Read the ontology's presentation metadata from its own SysML.
 *
 * Both the Explorer taxonomy and the layer palette used to live in
 * `memo.rendering.yaml`. Both decided how MEMO's kinds are grouped and shown,
 * which makes them ontology metadata: a project that resolved the ontology
 * without the sidecar got a different Explorer. They are SysML now, so the
 * ontology carries its own taxonomy wherever it is resolved.
 */
function readRenderingMetadata(sysmlDir: string): { placements: Map<string, ExplorerPlacement>; palette: Map<string, LayerPalette> } {
    const placements = new Map<string, ExplorerPlacement>();
    const palette = new Map<string, LayerPalette>();
    for (const file of collectSysmlFiles(sysmlDir)) {
        let content = '';
        try { content = readFileSync(file, 'utf-8'); } catch { continue; }
        if (!content.includes('ExplorerClassification') && !content.includes('LayerRendering')) continue;
        USAGE_BLOCK.lastIndex = 0;
        for (const m of content.matchAll(USAGE_BLOCK)) {
            const [, type, body] = m;
            if (type === 'ExplorerClassification') {
                const sourceNamespace = readAttr(body, 'sourceNamespace');
                const explorerDomain = readAttr(body, 'explorerDomain');
                const explorerGroup = readAttr(body, 'explorerGroup');
                if (sourceNamespace && explorerDomain && explorerGroup) {
                    placements.set(sourceNamespace, { sourceNamespace, explorerDomain, explorerGroup });
                }
            } else {
                const layerId = readAttr(body, 'layerId');
                const layerLabel = readAttr(body, 'layerLabel');
                const layerColor = readAttr(body, 'layerColor');
                if (layerId && layerLabel && layerColor) {
                    palette.set(layerId, { layerId, layerLabel, layerColor });
                }
            }
        }
    }
    return { placements, palette };
}

/** Apply the ontology-declared Explorer taxonomy to discovered kinds. */
function applyExplorerClassification(layers: OntologyLayerInfo[], sysmlDir: string): OntologyLayerInfo[] {
    const { placements, palette } = readRenderingMetadata(sysmlDir);
    for (const layer of layers) {
        const authored = palette.get(layer.id);
        if (authored) {
            layer.label = authored.layerLabel;
            layer.color = authored.layerColor;
        }
    }
    if (placements.size === 0) return layers;

    const domains = new Map<string, OntologyLayerInfo>();
    for (const layer of layers) for (const kind of layer.kinds) {
        const source = kind.group ?? kind.layer;
        const placement = placements.get(source);
        if (!placement) continue;
        let domain = domains.get(placement.explorerDomain);
        if (!domain) {
            domain = {
                id: placement.explorerDomain,
                label: placement.explorerDomain.charAt(0).toUpperCase() + placement.explorerDomain.slice(1),
                color: '#6B7280',
                kindCount: 0,
                kinds: [],
            };
            domains.set(placement.explorerDomain, domain);
        }
        domain.kinds.push({ ...kind, layer: placement.explorerDomain, group: placement.explorerGroup });
    }
    if (domains.size === 0) return layers;
    for (const domain of domains.values()) domain.kindCount = domain.kinds.length;
    return [...domains.values()];
}

/**
 * Describe every package a project could resolve, marking the ones it does.
 *
 * "Available" comes from locators — distribution manifests, node_modules,
 * workspace package directories. "Selected" comes from the native import
 * closure and nothing else: a package a manifest points at but no import
 * reaches is listed here as available and unselected, which is exactly what it
 * is. Before the flip, selection was read out of `ontologies:`, `modules:`,
 * `methodology:`, and the `extends` chain.
 */
export function getPackageMetadata(
    projectRoot: string,
    selectedRootDirs?: ReadonlySet<string>,
): OntologyPackageInfo[] {
    const result: OntologyPackageInfo[] = [];
    for (const root of discoverLibraryRoots(resolve(projectRoot))) {
        const info = buildPackageInfo(root.dir, selectedRootDirs?.has(root.dir) ?? false);
        if (info) result.push(info);
    }
    result.sort((a, b) => {
        if (a.selected !== b.selected) return a.selected ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return result;
}

/**
 * Result of loading ontology registries, including diagnostic info.
 */
export interface OntologyLoadResult {
    /** Populated registries for the builder */
    registries: BuilderRegistries;
    /** Number of ontology SysML files parsed */
    fileCount: number;
    /** Ontology package directories that were found and parsed */
    ontologyDirs: string[];
    /** Errors encountered during parsing */
    errors: string[];
    /** Parsed ontology documents (for rule registry and other consumers) */
    parsedDocuments: import('./parser-utils.js').ParsedDocument[];
    /**
     * Short names claimed by more than one definition.
     *
     * Reported separately from `errors` because these are ontology defects, not
     * load failures: the model still builds, but which definition a short
     * reference resolves to depends on file order. Session 2 resolves the
     * ontology's own collisions; session 3 makes an ambiguous reference fail.
     */
    kindNameCollisions: KindNameCollision[];
    /** Resolved dependency roots and the provenance they imply. */
    provenance?: ProvenanceTable;
    /** The native resolution this load was driven by. */
    resolution?: NativeProjectResolution;
}

/**
 * Recursively collect all .sysml files under a directory,
 * excluding index.sysml (which is just imports).
 */
function collectSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...collectSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml') && entry.name !== 'index.sysml') {
                files.push(full);
            }
        }
    } catch {
        // skip inaccessible dirs
    }
    return files;
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
 * Load the reusable registries a project actually resolves.
 *
 * Selection is the native import closure. This used to walk the `extends`
 * chain, the `methodology:` field, the `ontologies:` list, and the `modules:`
 * opt-ins; all four are gone, and a package now contributes kinds because the
 * project imports it, not because a settings file named it.
 *
 * Everything in the closure is parsed, including project-owned source, because
 * a project may declare its own definitions and those are project content the
 * builder must see. Provenance keeps the two apart.
 */
export async function loadOntologyRegistries(projectRoot: string): Promise<OntologyLoadResult> {
    const kindRegistry = new KindRegistry();
    const relationshipRegistry = new RelationshipRegistry();
    const errors: string[] = [];

    const resolution = await resolveNativeProject(projectRoot);
    for (const diagnostic of resolution.diagnostics) {
        errors.push(`${diagnostic.code}: ${diagnostic.message}`);
    }

    // Watch both distribution descriptors and their actual SysML source
    // roots. Native packages may publish source outside the descriptor
    // directory (for example ontology/memo.package.yaml -> ../src).
    const ontologyDirs = [...new Set(resolution.selectedRoots.flatMap(r => [r.dir, r.sysmlDir]))];

    // A package is resolved in full or not at all.
    //
    // The closure says which roots the project reaches; everything those roots
    // supply is then loaded, because a methodology that declares
    // `scopeMode = allAvailable` means "everything the resolved packages
    // provide" and cannot mean that only the files some other file happened to
    // import exist. Loading is not selecting: effective scope decides what is
    // active, which keeps one filter rather than two.
    //
    // A root no import reaches supplies nothing — that is what makes this the
    // import graph's answer and not the locator's.
    const selectedSysmlDirs = resolution.selectedRoots.map(r => r.sysmlDir);
    const closureFiles = new Set<string>();
    for (const pkg of resolution.closure.values()) {
        for (const file of pkg.files) closureFiles.add(file);
    }
    const documents = resolution.documents.filter(
        d => closureFiles.has(d.filePath) || selectedSysmlDirs.some(dir => d.filePath.startsWith(dir + sep)),
    );

    if (documents.length === 0) {
        return {
            registries: { kindRegistry, relationshipRegistry },
            fileCount: 0,
            ontologyDirs,
            errors: errors.length > 0 ? errors : [
                'No SysML reachable from the project entrypoint. Check the imports in model/catalog/project.sysml.',
            ],
            parsedDocuments: [],
            kindNameCollisions: [],
            resolution,
        };
    }

    kindRegistry.populateFromDocuments(documents);
    kindRegistry.computeDerivedBy();
    relationshipRegistry.populateFromDocuments(documents);

    return {
        registries: { kindRegistry, relationshipRegistry },
        fileCount: documents.length,
        ontologyDirs,
        errors,
        parsedDocuments: documents,
        kindNameCollisions: kindRegistry.getCollisions(),
        provenance: buildProvenanceTable(resolution),
        resolution,
    };
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
function buildProvenanceTable(resolution: NativeProjectResolution): ProvenanceTable {
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
