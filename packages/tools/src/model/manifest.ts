import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { VENDOR_ONTOLOGY_DIR } from './paths.js';

export interface MemoManifest {
    manifest: number;
    packages: Record<string, string>;
    init: {
        defaultExtends: string;
        rootImport: string;
        template: string;
        archetypes: string;
    };
    examples: Record<string, string>;
}

export interface LoadedMemoManifest {
    path: string;
    rootDir: string;
    manifest: MemoManifest;
}

const MANIFEST_FILENAME = 'memo.manifest.yaml';

function isStringRecord(value: unknown): value is Record<string, string> {
    return Boolean(value) && typeof value === 'object'
        && Object.values(value as Record<string, unknown>).every(entry => typeof entry === 'string');
}

export function loadMemoManifest(manifestPath: string): LoadedMemoManifest {
    const path = resolve(manifestPath);
    const parsed = parseYaml(readFileSync(path, 'utf-8')) as Partial<MemoManifest> | undefined;
    if (parsed?.manifest !== 1 || !isStringRecord(parsed.packages) || !isStringRecord(parsed.examples)) {
        throw new Error(`Unsupported or malformed MEMO manifest: ${path}`);
    }
    const init = parsed.init;
    if (!init || typeof init.defaultExtends !== 'string' || typeof init.rootImport !== 'string'
        || typeof init.template !== 'string' || typeof init.archetypes !== 'string') {
        throw new Error(`MEMO manifest has an invalid init section: ${path}`);
    }
    return { path, rootDir: dirname(path), manifest: parsed as MemoManifest };
}

export function resolveManifestPath(loaded: LoadedMemoManifest, subpath: string): string {
    const candidate = resolve(loaded.rootDir, subpath);
    const rel = relative(loaded.rootDir, candidate);
    if (rel.startsWith('..') || rel === '') {
        if (rel === '') return candidate;
        throw new Error(`MEMO manifest path escapes its package root: ${subpath}`);
    }
    return candidate;
}

function addManifestAt(root: string, results: LoadedMemoManifest[], seen: Set<string>): void {
    const path = resolve(root, MANIFEST_FILENAME);
    if (!existsSync(path) || seen.has(path)) return;
    try {
        results.push(loadMemoManifest(path));
        seen.add(path);
    } catch {
        // Ignore unrelated or malformed packages while searching. Direct loads remain strict.
    }
}

function scanPackageContainer(container: string, results: LoadedMemoManifest[], seen: Set<string>): void {
    if (!existsSync(container)) return;
    let entries;
    try { entries = readdirSync(container, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const child = resolve(container, entry.name);
        if (entry.name.startsWith('@')) {
            let scoped;
            try { scoped = readdirSync(child, { withFileTypes: true }); } catch { continue; }
            for (const pkg of scoped) if (pkg.isDirectory()) addManifestAt(resolve(child, pkg.name), results, seen);
        } else {
            addManifestAt(child, results, seen);
        }
    }
}

/** Find installed content manifests at explicit roots without crossing project boundaries. */
export function discoverMemoManifests(searchRoots: string[]): LoadedMemoManifest[] {
    const results: LoadedMemoManifest[] = [];
    const seen = new Set<string>();
    for (const root of searchRoots) {
        addManifestAt(root, results, seen);
        scanPackageContainer(resolve(root, 'node_modules'), results, seen);
        scanPackageContainer(resolve(root, '.memo', 'content', 'node_modules'), results, seen);
        scanPackageContainer(resolve(root, 'memo_packages'), results, seen);
        scanPackageContainer(resolve(root, 'memo_packages', 'node_modules'), results, seen);
    }
    return results;
}

/** Discover content manifests available to a project or this development workspace. */
export function findMemoManifests(fromDir: string): LoadedMemoManifest[] {
    const roots: string[] = [];
    let dir = resolve(fromDir);
    while (true) {
        roots.push(dir);
        if (existsSync(resolve(dir, '.git'))) break;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    if (process.env.MEMO_ONTOLOGY_PATH) roots.push(resolve(process.env.MEMO_ONTOLOGY_PATH));
    try {
        const require = createRequire(import.meta.url);
        roots.push(dirname(require.resolve('@memoarchitect/ontology/package.json')));
    } catch {
        // Development checkouts may provide the ontology through the nested repo.
    }
    const toolsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    roots.push(resolve(toolsRoot, VENDOR_ONTOLOGY_DIR));
    return discoverMemoManifests(roots);
}
