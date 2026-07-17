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
import { KindRegistry } from './kind-registry.js';
import { RelationshipRegistry } from './relationship-registry.js';
import { parseFiles } from './parser-utils.js';
import { VENDOR_ONTOLOGY_DIR, VENDOR_ONTOLOGY_PACKAGES_DIR } from './paths.js';
import { discoverMemoManifests, findMemoManifests, resolveManifestPath } from './manifest.js';
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
}

/** Parsed relationship info from a connection def */
interface ParsedRelationshipInfo {
    name: string;
    sourceKind?: string;
    targetKind?: string;
}

/**
 * Parse SysML constructs (part def, requirement def, action def, connection def)
 * from a single SysML file, extracting specialization and doc comments.
 */
function parseConstructsInFile(filePath: string): { kinds: ParsedKindInfo[]; relationships: ParsedRelationshipInfo[] } {
    const kinds: ParsedKindInfo[] = [];
    const relationships: ParsedRelationshipInfo[] = [];
    try {
        const content = readFileSync(filePath, 'utf-8');

        // Match kind definitions with optional :> (specializes) and preceding doc comments
        // Pattern: [doc /* ... */] <construct> def Name [:> SuperType] { ... }
        const kindRegex = /(?:doc\s+\/\*\s*([\s\S]*?)\s*\*\/\s*)?^\s*(?:part|requirement|action|attribute|item|abstract part)\s+def\s+(\w+)(?:\s*(?::>|specializes)\s+(\w+))?/gm;
        for (const m of content.matchAll(kindRegex)) {
            const construct = m[0].match(/(?:abstract\s+)?(part|requirement|action|attribute|item)\s+def/)?.[0]?.trim() ?? 'part def';
            kinds.push({
                name: m[2],
                construct,
                derivesFrom: m[3] || undefined,
                description: m[1]?.replace(/\s+/g, ' ').trim() || undefined,
            });
        }

        // Match connection defs with endpoint type annotations
        // Pattern: connection def Name { end name : TypeName [mult]; end name : TypeName [mult]; }
        const connBlockRegex = /(?:connection|binding|allocation)\s+def\s+(\w+)\s*\{([^}]*)\}/g;
        for (const m of content.matchAll(connBlockRegex)) {
            const name = m[1];
            const body = m[2];
            // Extract typed ends: `end <name> : <TypeName> [` — ignore untyped ends like `end subject[1]`
            const endRegex = /end\s+\w+\s*:\s*(\w+)\s*\[/g;
            const typedEnds: string[] = [];
            for (const em of body.matchAll(endRegex)) typedEnds.push(em[1]);
            relationships.push({
                name,
                sourceKind: typedEnds[0],
                targetKind: typedEnds[1],
            });
        }
    } catch { /* skip */ }
    return { kinds, relationships };
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
 * Read a YAML file and extract a simple string field.
 */
function readYamlField(content: string, field: string): string {
    const m = content.match(new RegExp(`^${field}:\\s*["']?([^"'\\n]+)["']?`, 'm'));
    return m ? m[1].trim() : '';
}

/**
 * Read the `methodology:` field from a project config.
 * Returns a Set of package names: the methodology pkg + every pkg on its
 * extends chain. Used to mark them as selected in getPackageMetadata.
 */
function readMethodologyChain(configPath: string): Set<string> {
    const out = new Set<string>();
    let methodologyName: string | undefined;
    try {
        const content = readFileSync(configPath, 'utf-8');
        const m = content.match(/^methodology:\s*"?([^"\s#]+)"?/m);
        if (!m) return out;
        const raw = m[1];
        const lastAt = raw.lastIndexOf('@');
        methodologyName = lastAt > 0 ? raw.slice(0, lastAt) : raw;
        if (!methodologyName.startsWith('@memoarchitect/')) methodologyName = `@memoarchitect/${methodologyName}`;
    } catch { return out; }
    if (!methodologyName) return out;

    // Walk the extends chain starting at the methodology pkg.
    const stack: string[] = [methodologyName];
    const visited = new Set<string>();
    while (stack.length) {
        const pkgName = stack.pop()!;
        if (visited.has(pkgName)) continue;
        visited.add(pkgName);
        out.add(pkgName);
        const pkgCfg = resolvePackageConfig(pkgName, dirname(configPath));
        if (!pkgCfg) continue;
        let content = '';
        try { content = readFileSync(pkgCfg, 'utf-8'); } catch { continue; }
        const single = content.match(/^extends:\s*"?(@memo\/[\w-]+)"?/m);
        if (single) { stack.push(single[1]); continue; }
        const arr = content.match(/^extends:\s*\n((?:\s+-\s+.+\n?)+)/m);
        if (arr) {
            for (const em of arr[1].matchAll(/^\s+-\s+"?(@memo\/[\w-]+)"?/gm)) stack.push(em[1]);
        }
    }
    return out;
}

/**
 * Get the list of selected ontology package names from a project config file.
 */
function readSelectedOntologies(configPath: string): Set<string> {
    const selected = new Set<string>();
    try {
        const content = readFileSync(configPath, 'utf-8');
        const section = content.split(/^ontologies:/m)[1];
        if (section) {
            const matches = section.matchAll(/^\s*-\s*name:\s*["']?([\w@\/-]+)["']?/gm);
            for (const m of matches) selected.add(m[1]);
        }
    } catch { /* skip */ }
    return selected;
}

/**
 * Build OntologyPackageInfo for a single package directory.
 */
function buildPackageInfo(pkgDir: string, selected: boolean): OntologyPackageInfo | null {
    const configCandidates = ['memo.package.yaml', 'memo.package.yml', 'memo.config.yaml', 'memo.config.yml'];
    let configContent = '';
    for (const name of configCandidates) {
        const p = join(pkgDir, name);
        if (existsSync(p)) { configContent = readFileSync(p, 'utf-8'); break; }
    }
    if (!configContent) return null;

    const name = readYamlField(configContent, 'name') || basename(pkgDir);
    const version = readYamlField(configContent, 'version') || '0.0.0';
    const rawType = readYamlField(configContent, 'type') || 'ontology';
    const type = (['ontology', 'profile', 'extension', 'methodology'].includes(rawType) ? rawType : 'ontology') as OntologyPackageInfo['type'];
    const description = readYamlField(configContent, 'description') || '';
    const extendsField = readYamlField(configContent, 'extends') || undefined;

    const sysmlDirOverride = readYamlField(configContent, 'sysmlDir');
    const sysmlDir = sysmlDirOverride
        ? resolve(pkgDir, sysmlDirOverride)
        : join(pkgDir, 'sysml');
    const layers = buildLayers(sysmlDir);
    const kindCount = layers.reduce((s, l) => s + l.kindCount, 0);
    const relationshipTypes = buildRelationshipTypes(sysmlDir);
    const optionalModules = readOptionalModulesList(configContent);

    return {
        name, version, type, description, extends: extendsField, layers, kindCount,
        relationshipCount: relationshipTypes.length, relationshipTypes, selected,
        optionalModules,
        rootDir: pkgDir,
    };
}

/** Parse `optionalModules:` list from a manifest file content. */
function readOptionalModulesList(content: string): string[] {
    const out: string[] = [];
    const section = content.split(/^optionalModules:/m)[1];
    if (!section) return out;
    for (const m of section.matchAll(/^\s*-\s*"?([@\w/-]+)"?/gm)) {
        out.push(m[1]);
        // Guard: stop if we leave the list (no leading `-`)
        if (!m[0].match(/^\s*-/)) break;
    }
    return out;
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

    // Gather package directories from the tools repo and its memo submodule.
    const candidates: string[] = [];
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

            const vendorPkgsDir = join(searchDir, VENDOR_ONTOLOGY_PACKAGES_DIR);
            if (existsSync(vendorPkgsDir)) {
                try {
                    for (const entry of readdirSync(vendorPkgsDir, { withFileTypes: true })) {
                        if (!entry.isDirectory()) continue;
                        candidates.push(join(vendorPkgsDir, entry.name));
                    }
                } catch { /* skip */ }
            }

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

    // Collect which packages are declared as optionalModules by any base pkg.
    const optionalModuleNames = new Set<string>();
    for (const pkgDir of candidates) {
        for (const cfg of configCandidates) {
            const manifestPath = join(pkgDir, cfg);
            if (!existsSync(manifestPath)) continue;
            try {
                const content = readFileSync(manifestPath, 'utf-8');
                for (const m of readOptionalModulesList(content)) optionalModuleNames.add(m);
            } catch { /* skip */ }
            break;
        }
    }

    // Also collect project-declared modules so they get selected=true.
    const projectModules = new Set(readDeclaredModules(primaryConfig));

    // Phase C: methodology field also marks packages selected — methodology
    // pkg itself plus everything on its extends chain.
    const methodologySelected = readMethodologyChain(primaryConfig);

    for (const pkgDir of candidates) {
        let sysmlPath = join(pkgDir, 'sysml');
        for (const cfg of CONFIG_SEARCH_ORDER) {
            const cp = join(pkgDir, cfg);
            if (existsSync(cp)) {
                const ov = readYamlField(readFileSync(cp, 'utf-8'), 'sysmlDir');
                if (ov) sysmlPath = resolve(pkgDir, ov);
                break;
            }
        }
        const hasSysml = existsSync(sysmlPath);
        if (!hasSysml) continue;
        if (seen.has(pkgDir)) continue;
        seen.add(pkgDir);

        const info = buildPackageInfo(pkgDir, false);
        if (!info) continue;
        // Mark as selected if name is in project's ontologies list, or inferred heuristic
        info.selected = selectedNames.has(info.name)
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

    // 0. (Phase C) If project pins a `methodology:`, resolve it and walk its
    // extends chain. The methodology package brings in its own SysML and
    // chain-pulls the kinds ontology (e.g. @memoarchitect/ontology).
    try {
        const content = readFileSync(configPath, 'utf-8');
        const methodologyMatch = content.match(/^methodology:\s*"?([^"\s#]+)"?/m);
        if (methodologyMatch) {
            // Strip optional version range "@^1.0" → just the package name.
            // The leading @memoarchitect/ scope must be preserved, so only strip the LAST `@`.
            const raw = methodologyMatch[1];
            const lastAt = raw.lastIndexOf('@');
            const methodologyName = lastAt > 0 ? raw.slice(0, lastAt) : raw;
            const fullName = methodologyName.startsWith('@memoarchitect/')
                ? methodologyName
                : `@memoarchitect/${methodologyName}`;
            const pkgConfig = resolvePackageConfig(fullName, dirname(configPath));
            if (pkgConfig) walkExtendsChain(pkgConfig, dirs, seen);
        }
    } catch { /* skip */ }

    // 1. Walk the primary extends chain
    walkExtendsChain(configPath, dirs, seen);

    // 2. Load additional ontologies from the config file's `ontologies` array.
    // This allows for a "Base + Plugin" model where users can add multiple domain-specific ontologies.
    try {
        const content = readFileSync(configPath, 'utf-8');
        // Lightweight YAML parsing for ontologies:
        const ontologySection = content.split(/^ontologies:/m)[1];
        if (ontologySection) {
            const matches = ontologySection.matchAll(/^\s*-\s*name:\s*"?([\w@\/-]+)"?/gm);
            for (const match of matches) {
                let ontologyName = match[1];
                // Ensure name has @memoarchitect/ prefix for resolution if missing
                if (!ontologyName.startsWith('@memoarchitect/')) {
                    ontologyName = `@memoarchitect/${ontologyName}`;
                }
                const pkgConfig = resolvePackageConfig(ontologyName, dirname(configPath));
                if (pkgConfig) {
                    walkExtendsChain(pkgConfig, dirs, seen);
                }
            }
        }
    } catch {
        // Skip inaccessible configs
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
    let rawModules: string[] = [];
    try {
        const content = readFileSync(configPath, 'utf-8');
        // Match `modules:\n  - foo\n  - "@memoarchitect/bar"`
        const section = content.split(/^modules:/m)[1];
        if (section) {
            const matches = section.matchAll(/^\s*-\s*"?([@\w/-]+)"?/gm);
            // Stop at the first non-list YAML key
            for (const m of matches) {
                const line = m[0];
                if (!line.match(/^\s*-/)) break;
                rawModules.push(m[1]);
            }
        }
    } catch { return out; }
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
        let content = '';
        try { content = readFileSync(p, 'utf-8'); } catch { continue; }

        const section = content.split(/^optionalModules:/m)[1];
        if (section) {
            for (const m of section.matchAll(/^\s*-\s*"?([@\w/-]+)"?/gm)) {
                const line = m[0];
                if (!line.match(/^\s*-/)) break;
                modules.add(m[1]);
            }
        }

        // Handle both single and array extends forms
        const singleExt = content.match(/^extends:\s*"?(@memo\/[\w-]+)"?/m);
        if (singleExt) {
            const parent = resolvePackageConfig(singleExt[1], dirname(p));
            if (parent) stack.push(parent);
        } else {
            const arraySection = content.match(/^extends:\s*\n((?:\s+-\s+.+\n?)+)/m);
            if (arraySection) {
                for (const m of arraySection[1].matchAll(/^\s+-\s+"?(@memo\/[\w-]+)"?/gm)) {
                    const parent = resolvePackageConfig(m[1], dirname(p));
                    if (parent) stack.push(parent);
                }
            }
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

    // Read the YAML to find extends (lightweight — just look for extends line)
    let extendsPackages: string[] = [];
    let projectType: string | undefined;
    try {
        const content = readFileSync(resolvedPath, 'utf-8');
        // Handle both single-string extends and array extends in YAML:
        //   extends: "@memoarchitect/ontology"
        //   extends:
        //     - "@memoarchitect/ontology"
        const singleMatch = content.match(/^extends:\s*"?(@memo\/[\w-]+)"?/m);
        if (singleMatch) {
            extendsPackages = [singleMatch[1]];
        } else {
            // Array form: collect all list entries under `extends:`
            const arraySection = content.match(/^extends:\s*\n((?:\s+-\s+.+\n?)+)/m);
            if (arraySection) {
                const entries = [...arraySection[1].matchAll(/^\s+-\s+"?(@memo\/[\w-]+)"?/gm)];
                extendsPackages = entries.map(m => m[1]);
            }
        }
        // Match both legacy (projectType:) and new format (type:)
        const typeMatch = content.match(/^(?:projectType|type):\s*(\w+)/m);
        if (typeMatch) {
            projectType = typeMatch[1];
        }
    } catch {
        return;
    }

    const packageDir = dirname(resolvedPath);

    // Honor `sysmlDir:` override (points outside package, e.g. ../../ontology)
    let sysmlDir: string;
    try {
        const content = readFileSync(resolvedPath, 'utf-8');
        const override = readYamlField(content, 'sysmlDir');
        sysmlDir = override ? resolve(packageDir, override) : resolve(packageDir, 'sysml');
    } catch {
        sysmlDir = resolve(packageDir, 'sysml');
    }
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
    for (const cfg of CONFIG_SEARCH_ORDER) {
        const cp = resolve(pkgDir, cfg);
        if (existsSync(cp)) {
            try {
                const ov = readYamlField(readFileSync(cp, 'utf-8'), 'sysmlDir');
                if (ov) return resolve(pkgDir, ov);
            } catch { /* skip */ }
            break;
        }
    }
    return resolve(pkgDir, 'sysml');
}

/** Ordered list of config filenames to search for (new format first, then legacy) */
const CONFIG_SEARCH_ORDER = [
    'memo.package.yaml',
    'memo.package.yml',
    'memo.config.yaml',
    'memo.config.yml',
];

/**
 * Resolve a @memoarchitect/package-name to its config file path.
 * Prefers memo.package.yaml (new format), falls back to memo.config.yaml (legacy).
 * Searches: workspace packages (monorepo), then node_modules.
 */
export function resolvePackageConfig(packageName: string, fromDir: string): string | undefined {
    const shortName = packageName.replace(/^@memo\//, '');
    const startDir = resolve(fromDir);
    const projectConfig = findNearestProjectConfig(startDir);
    const boundary = projectConfig ? dirname(projectConfig) : undefined;

    // A logical package config is itself inside the physical content package.
    // It is not a user-project boundary: allow sibling logical packages to be
    // resolved through the nearest enclosing manifest.
    if (projectConfig) {
        const type = readYamlField(readFileSync(projectConfig, 'utf-8'), 'type')
            || readYamlField(readFileSync(projectConfig, 'utf-8'), 'projectType');
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
            const vendorCandidate = resolve(dir, VENDOR_ONTOLOGY_PACKAGES_DIR, shortName, configName);
            if (existsSync(vendorCandidate)) return vendorCandidate;
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
        };
    }

    // Collect all SysML files from all ontology packages (honor sysmlDir override).
    // Dedupe by absolute path — methodology and base ontology pkgs may have
    // overlapping sysmlDirs (e.g. methodology points at ontology/methodology/memo
    // while @memoarchitect/ontology points at src/).
    const sysmlSet = new Set<string>();
    for (const pkgDir of ontologyDirs) {
        let sysmlDir = resolve(pkgDir, 'sysml');
        for (const cfg of CONFIG_SEARCH_ORDER) {
            const cp = resolve(pkgDir, cfg);
            if (existsSync(cp)) {
                const ov = readYamlField(readFileSync(cp, 'utf-8'), 'sysmlDir');
                if (ov) sysmlDir = resolve(pkgDir, ov);
                break;
            }
        }
        for (const f of collectSysmlFiles(sysmlDir)) sysmlSet.add(f);
    }
    const allSysmlFiles = [...sysmlSet];

    if (allSysmlFiles.length === 0) {
        return {
            registries: { kindRegistry, relationshipRegistry },
            fileCount: 0,
            ontologyDirs,
            errors: ['Ontology packages found but no .sysml files in sysml/ directories'],
            parsedDocuments: [],
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
    };
}
