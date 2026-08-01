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
import { resolve, dirname, join, basename } from 'node:path';
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
import { originForPackageType, ProvenanceTable, type ResolvedRoot } from './source-provenance.js';
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
 * Read the `methodology:` field from a project config.
 * Returns a Set of package names: the methodology pkg + every pkg on its
 * extends chain. Used to mark them as selected in getPackageMetadata.
 */
function readMethodologyChain(configPath: string): Set<string> {
    const out = new Set<string>();
    const declared = readManifest(configPath).methodology;
    if (!declared) return out;

    // Walk the extends chain starting at the methodology pkg.
    const stack: string[] = [qualifyPackageName(declared)];
    const visited = new Set<string>();
    while (stack.length) {
        const pkgName = stack.pop()!;
        if (visited.has(pkgName)) continue;
        visited.add(pkgName);
        out.add(pkgName);
        const pkgCfg = resolvePackageConfig(pkgName, dirname(configPath));
        if (!pkgCfg) continue;
        for (const parent of readManifest(pkgCfg).extends ?? []) {
            stack.push(qualifyPackageName(parent));
        }
    }
    return out;
}

/**
 * Get the list of selected ontology package names from a project config file.
 *
 * Names are recorded as written: this set is compared against manifest `name:`
 * fields, which are already fully scoped.
 */
function readSelectedOntologies(configPath: string): Set<string> {
    return new Set(readManifest(configPath).ontologies ?? []);
}

/**
 * Build OntologyPackageInfo for a single package directory.
 */
function buildPackageInfo(pkgDir: string, selected: boolean): OntologyPackageInfo | null {
    const { path, manifest } = readPackageManifest(pkgDir);
    if (!path) return null;

    const rawType = manifest.type ?? 'ontology';
    const type = (['ontology', 'profile', 'extension', 'methodology'].includes(rawType) ? rawType : 'ontology') as OntologyPackageInfo['type'];
    // `extends` is a list in the manifest but a single name in this DTO; the
    // previous regex could only ever see the first entry, so keep that shape.
    const extendsField = manifest.extends?.[0];

    const sysmlDir = manifest.sysmlDir
        ? resolve(pkgDir, manifest.sysmlDir)
        : join(pkgDir, 'sysml');
    const layers = applyExplorerClassification(buildLayers(sysmlDir), pkgDir);
    const kindCount = layers.reduce((s, l) => s + l.kindCount, 0);
    const relationshipTypes = buildRelationshipTypes(sysmlDir);

    return {
        name: manifest.name ?? basename(pkgDir),
        version: manifest.version ?? '0.0.0',
        type,
        description: manifest.description ?? '',
        extends: extendsField,
        layers,
        kindCount,
        relationshipCount: relationshipTypes.length,
        relationshipTypes,
        selected,
        optionalModules: manifest.optionalModules ?? [],
        rootDir: pkgDir,
    };
}

/** Apply the ontology-declared Explorer taxonomy to discovered kinds. */
function applyExplorerClassification(layers: OntologyLayerInfo[], pkgDir: string): OntologyLayerInfo[] {
    const rendering = join(pkgDir, 'memo.rendering.yaml');
    if (!existsSync(rendering)) return layers;
    try {
        const parsed = parseYaml(readFileSync(rendering, 'utf-8')) as {
            explorer?: { classifications?: Array<{ source: string; domain: string; group: string }> };
        };
        const classifications = parsed.explorer?.classifications ?? [];
        if (classifications.length === 0) return layers;
        const bySource = new Map(classifications.map(c => [c.source, c]));
        const domains = new Map<string, OntologyLayerInfo>();
        for (const layer of layers) for (const kind of layer.kinds) {
            const source = kind.group ?? kind.layer;
            const placement = bySource.get(source);
            if (!placement) continue;
            let domain = domains.get(placement.domain);
            if (!domain) {
                domain = { id: placement.domain, label: placement.domain.charAt(0).toUpperCase() + placement.domain.slice(1), color: '#6B7280', kindCount: 0, kinds: [] };
                domains.set(placement.domain, domain);
            }
            domain.kinds.push({ ...kind, layer: placement.domain, group: placement.group });
        }
        for (const domain of domains.values()) domain.kindCount = domain.kinds.length;
        return [...domains.values()];
    } catch { return layers; }
}


/**
 * Get ontology package metadata for all packages in the project's extends chain
 * plus any available-but-unselected packages under packages/ or node_modules/@memoarchitect/.
 *
 * @param projectRoot - Absolute path to the project root (where memo.package.yaml lives)
 */
export function getPackageMetadata(projectRoot: string): OntologyPackageInfo[] {
    const configCandidates = ['memo.package.yaml', 'memo.package.yml', 'memo.config.yaml', 'memo.config.yml'];
    let primaryConfig = '';
    for (const name of configCandidates) {
        const p = join(projectRoot, name);
        if (existsSync(p)) { primaryConfig = p; break; }
    }
    if (!primaryConfig) return [];

    const selectedNames = readSelectedOntologies(primaryConfig);
    const result: OntologyPackageInfo[] = [];
    const seen = new Set<string>();

    // The active ontology often lives behind a logical package manifest. For
    // example, the medical profile resolves to MEMO's `ontology/` directory
    // rather than a sibling `packages/` directory. Follow the actual extends
    // chain first, so the Explorer receives the same canonical types that the
    // model builder uses to resolve usages.
    const inheritedDirs = new Set<string>();
    const visitExtends = (configPath: string, visited = new Set<string>()) => {
        const normalized = resolve(configPath);
        if (visited.has(normalized)) return;
        visited.add(normalized);
        let content = '';
        try { content = readFileSync(normalized, 'utf-8'); } catch { return; }
        const parentNames: string[] = [];
        const single = content.match(/^extends:\s*"?(@[\w-]+\/[\w-]+)"?/m);
        if (single) parentNames.push(single[1]);
        const array = content.match(/^extends:\s*\n((?:\s+-\s+.+\n?)+)/m);
        if (array) for (const entry of array[1].matchAll(/^\s+-\s+"?(@[\w-]+\/[\w-]+)"?/gm)) parentNames.push(entry[1]);
        for (const parentName of parentNames) {
            const parentConfig = resolvePackageConfig(parentName, dirname(normalized));
            if (!parentConfig) continue;
            inheritedDirs.add(dirname(parentConfig));
            visitExtends(parentConfig, visited);
        }
    };
    visitExtends(primaryConfig);

    // Gather package directories from the tools repo and its memo submodule.
    const candidates: string[] = [];
    candidates.push(...inheritedDirs);
    let searchDir = resolve(projectRoot);
    while (true) {
        const pkgsDir = join(searchDir, 'packages');
        if (existsSync(pkgsDir)) {
            try {
                for (const entry of readdirSync(pkgsDir, { withFileTypes: true })) {
                    if (!entry.isDirectory()) continue;
                    candidates.push(join(pkgsDir, entry.name));
                }
            } catch { /* skip */ }

            break;
        }
        const parent = dirname(searchDir);
        if (parent === searchDir) break;
        searchDir = parent;
    }

    // Scan memo_packages/ for locally installed packages
    const memoPkgsDir = join(projectRoot, 'memo_packages');
    if (existsSync(memoPkgsDir)) {
        try {
            for (const entry of readdirSync(memoPkgsDir, { withFileTypes: true })) {
                if (entry.isDirectory()) candidates.push(join(memoPkgsDir, entry.name));
            }
        } catch { /* skip */ }
    }

    // Also scan node_modules/@memoarchitect/ for installed packages
    const nmMemo = join(projectRoot, 'node_modules', '@memoarchitect');
    if (existsSync(nmMemo)) {
        try {
            for (const entry of readdirSync(nmMemo, { withFileTypes: true })) {
                if (entry.isDirectory()) candidates.push(join(nmMemo, entry.name));
            }
        } catch { /* skip */ }
    }

    // A bundled example runs from a disposable directory and intentionally has
    // no node_modules of its own. Its packages are nevertheless resolvable via
    // its methodology/extends chain, so use that same authoritative resolution
    // path when publishing metadata to clients such as Memo Architect.
    for (const packageDir of findOntologyPackageDirs(primaryConfig)) {
        candidates.push(packageDir);
    }

    // Collect which packages are declared as optionalModules by any base pkg.
    const optionalModuleNames = new Set<string>();
    for (const pkgDir of candidates) {
        for (const m of readPackageManifest(pkgDir).manifest.optionalModules ?? []) {
            optionalModuleNames.add(m);
        }
    }

    // Also collect project-declared modules so they get selected=true.
    const projectModules = new Set(readDeclaredModules(primaryConfig));

    // Phase C: methodology field also marks packages selected — methodology
    // pkg itself plus everything on its extends chain.
    const methodologySelected = readMethodologyChain(primaryConfig);

    for (const pkgDir of candidates) {
        const hasSysml = existsSync(resolvePackageSysmlDir(pkgDir));
        if (!hasSysml) continue;
        if (seen.has(pkgDir)) continue;
        seen.add(pkgDir);

        const info = buildPackageInfo(pkgDir, false);
        if (!info) continue;
        // Mark as selected if name is in project's ontologies list, or inferred heuristic
        info.selected = inheritedDirs.has(pkgDir)
            || selectedNames.has(info.name)
            || selectedNames.has(info.name.replace('@memoarchitect/', ''))
            || projectModules.has(info.name)
            || methodologySelected.has(info.name);
        info.isOptionalModule = optionalModuleNames.has(info.name);
        result.push(info);
    }

    // Sort: selected first, then by name
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
 * Walk the config `extends` chain to find ontology package directories.
 * Returns absolute paths to directories containing `sysml/` subdirectories.
 *
 * Strategy:
 * 1. Start from the config file's directory
 * 2. Follow `extends` references (@memoarchitect/package-name → packages/package-name)
 * 3. For each package in the chain, check if it has a sysml/ directory
 * 4. Also check for ontology-core (may not be in extends chain directly)
 */
export function findOntologyPackageDirs(configPath: string): string[] {
    const dirs: string[] = [];
    const seen = new Set<string>();

    const projectManifest = readManifest(configPath);

    // 0. (Phase C) If project pins a `methodology:`, resolve it and walk its
    // extends chain. The methodology package brings in its own SysML and
    // chain-pulls the kinds ontology (e.g. @memoarchitect/ontology).
    if (projectManifest.methodology) {
        const pkgConfig = resolvePackageConfig(
            qualifyPackageName(projectManifest.methodology), dirname(configPath));
        if (pkgConfig) walkExtendsChain(pkgConfig, dirs, seen);
    }

    // 1. Walk the primary extends chain
    walkExtendsChain(configPath, dirs, seen);

    // 2. Load additional ontologies from the config file's `ontologies` array.
    // This allows for a "Base + Plugin" model where users can add multiple domain-specific ontologies.
    for (const ontologyName of projectManifest.ontologies ?? []) {
        const pkgConfig = resolvePackageConfig(qualifyPackageName(ontologyName), dirname(configPath));
        if (pkgConfig) walkExtendsChain(pkgConfig, dirs, seen);
    }

    // 3. Resolve optional modules declared under `modules:` in the project config.
    // Modules follow OWL import semantics — declared in the base ontology's
    // `optionalModules:` list, loaded only when the project opts in.
    for (const moduleName of readDeclaredModules(configPath)) {
        const pkgConfig = resolvePackageConfig(moduleName, dirname(configPath));
        if (pkgConfig) walkExtendsChain(pkgConfig, dirs, seen);
    }

    return dirs;
}

/**
 * Read the `modules:` array from a project config, resolving short aliases
 * (e.g. "ros") against the base ontology's `optionalModules:` list.
 * Returns fully-qualified @memoarchitect/... package names.
 */
function readDeclaredModules(configPath: string): string[] {
    const out: string[] = [];
    const rawModules = readManifest(configPath).modules ?? [];
    if (rawModules.length === 0) return out;

    // Gather optional-module allowlist from the extends chain
    const allowlist = collectOptionalModules(configPath);
    const byShort = new Map<string, string>(); // short → full name
    for (const full of allowlist) {
        const short = full.split('/').pop() ?? full;
        byShort.set(short, full);
    }

    for (const entry of rawModules) {
        if (entry.startsWith('@')) {
            out.push(entry);
        } else {
            out.push(byShort.get(entry) ?? entry);
        }
    }
    return out;
}

/**
 * Walk the extends chain of a config and collect all `optionalModules:` entries.
 */
function collectOptionalModules(configPath: string): string[] {
    const modules = new Set<string>();
    const visited = new Set<string>();
    const stack = [resolve(configPath)];
    while (stack.length) {
        const p = stack.pop()!;
        if (visited.has(p)) continue;
        visited.add(p);
        const manifest = readManifest(p);

        for (const m of manifest.optionalModules ?? []) modules.add(m);
        for (const parentName of manifest.extends ?? []) {
            const parent = resolvePackageConfig(qualifyPackageName(parentName), dirname(p));
            if (parent) stack.push(parent);
        }
    }
    return [...modules];
}

/**
 * Recursively walk the extends chain, collecting ontology package dirs.
 */
function walkExtendsChain(configPath: string, dirs: string[], seen: Set<string>): void {
    const resolvedPath = resolve(configPath);
    if (seen.has(resolvedPath)) return;
    seen.add(resolvedPath);

    const manifest = readManifest(resolvedPath);
    // Both forms are handled by the parser: `extends:` as a scalar and as a
    // sequence arrive here as the same list.
    const extendsPackages = manifest.extends ?? [];

    const packageDir = dirname(resolvedPath);

    // Honor `sysmlDir:` override (points outside package, e.g. ../../ontology)
    const sysmlDir = manifest.sysmlDir
        ? resolve(packageDir, manifest.sysmlDir)
        : resolve(packageDir, 'sysml');
    if (existsSync(sysmlDir)) {
        dirs.push(packageDir);
    }

    // Follow extends chain (handles both single and array extends)
    for (const extendsPackage of extendsPackages) {
        const parentConfigPath = resolvePackageConfig(extendsPackage, packageDir);
        if (parentConfigPath) {
            walkExtendsChain(parentConfigPath, dirs, seen);
        }
    }

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
    if (projectConfig) {
        const projectManifest = readManifest(projectConfig);
        const type = projectManifest.type || projectManifest.projectType;
        if (type && type !== 'device') {
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
 * Load ontology registries by walking the config extends chain,
 * finding ontology SysML files, parsing them, and populating
 * KindRegistry + RelationshipRegistry.
 *
 * @param configPath - Path to the project's memo.config.yaml
 * @returns Populated registries and diagnostic info
 */
export async function loadOntologyRegistries(configPath: string): Promise<OntologyLoadResult> {
    const kindRegistry = new KindRegistry();
    const relationshipRegistry = new RelationshipRegistry();
    const errors: string[] = [];

    // Find ontology package directories
    const ontologyDirs = findOntologyPackageDirs(configPath);

    if (ontologyDirs.length === 0) {
        return {
            registries: { kindRegistry, relationshipRegistry },
            fileCount: 0,
            ontologyDirs: [],
            errors: ['No ontology packages with sysml/ directories found in extends chain'],
            parsedDocuments: [],
            kindNameCollisions: [],
        };
    }

    // Collect all SysML files from all ontology packages (honor sysmlDir override).
    // Dedupe by absolute path — methodology and base ontology pkgs may have
    // overlapping sysmlDirs (e.g. methodology points at ontology/methodology/memo
    // while @memoarchitect/ontology points at src/).
    const sysmlSet = new Set<string>();
    for (const pkgDir of ontologyDirs) {
        for (const f of collectSysmlFiles(resolvePackageSysmlDir(pkgDir))) sysmlSet.add(f);
    }
    const allSysmlFiles = [...sysmlSet];

    if (allSysmlFiles.length === 0) {
        return {
            registries: { kindRegistry, relationshipRegistry },
            fileCount: 0,
            ontologyDirs,
            errors: ['Ontology packages found but no .sysml files in sysml/ directories'],
            parsedDocuments: [],
            kindNameCollisions: [],
        };
    }

    // Parse all ontology SysML files
    const parseResult = await parseFiles(allSysmlFiles, '');

    for (const err of parseResult.errors) {
        errors.push(`${err.file}${err.line ? `:${err.line}` : ''}: ${err.message}`);
    }

    // Populate registries from parsed documents
    kindRegistry.populateFromDocuments(parseResult.documents);
    kindRegistry.computeDerivedBy();
    relationshipRegistry.populateFromDocuments(parseResult.documents);

    return {
        registries: { kindRegistry, relationshipRegistry },
        fileCount: allSysmlFiles.length,
        ontologyDirs,
        errors,
        parsedDocuments: parseResult.documents,
        kindNameCollisions: kindRegistry.getCollisions(),
        provenance: buildProvenanceTable(configPath, ontologyDirs),
    };
}

/**
 * Classify each resolved package directory into an authority category.
 *
 * Origin comes from the package manifest's declared `type:` — that is, from
 * what the resolved dependency says it is — not from where its files happen to
 * sit. Import depth is the position in the resolution order, which approximates
 * distance from the project closely enough for provenance display; the exact
 * graph distance arrives with the native import closure in session 3.
 */
function buildProvenanceTable(configPath: string, ontologyDirs: string[]): ProvenanceTable {
    const projectRoot = dirname(resolve(configPath));
    const roots: ResolvedRoot[] = ontologyDirs.map((dir, index) => {
        const { manifest } = readPackageManifest(dir);
        return {
            dir,
            origin: originForPackageType(manifest.type),
            packageName: manifest.name ?? basename(dir),
            packageVersion: manifest.version,
            importDepth: index + 1,
        };
    });
    return new ProvenanceTable(projectRoot, roots);
}
