// ─── Source Graph ─────────────────────────────────────────────────────────────
//
// Which files a view actually depends on.
//
// A SysML file rarely stands alone: it declares packages, those packages import
// other packages, and those live in other files. Editing any file in that
// closure can change what a view renders, so "refresh the diagram when its
// source changes" is only correct if "its source" means the transitive closure
// — the file itself, everything it imports, and the files owning the elements
// it displays.
//
// The graph is derived from the same PackageRegistry the builder resolves
// references with, so a file is a dependency here exactly when it can
// contribute a resolvable name there.
// ─────────────────────────────────────────────────────────────────────────────

import { PackageRegistry } from './package-registry.js';
import type { ParsedDocument } from './parser-utils.js';
import type { DiagramDTO, MemoElement, SourceGraphDTO } from './semantic.js';

/** A file and the files it can draw names from. */
export interface SourceGraph {
    /** file → files it depends on, transitively (never includes itself). */
    dependsOn: Map<string, Set<string>>;
    /** file → files that depend on it, transitively. */
    dependents: Map<string, Set<string>>;
}

/**
 * Build the file-level dependency graph from parsed documents.
 *
 * Import paths name packages, not files, so resolution goes
 * package → declaring file. A package declared across several files
 * contributes all of them: any one can supply the imported name.
 */
export function buildSourceGraph(documents: ParsedDocument[]): SourceGraph {
    const registry = new PackageRegistry();
    registry.buildFromDocuments(documents);

    // A package may be declared in more than one file (split packages), so the
    // index is package → files, not package → file.
    const packageFiles = new Map<string, Set<string>>();
    for (const entry of registry.getPackages().values()) {
        addTo(packageFiles, entry.qualifiedName, entry.file);
    }

    // Direct edges: the file declaring a package depends on every file
    // declaring a package it imports.
    const direct = new Map<string, Set<string>>();
    for (const entry of registry.getPackages().values()) {
        const from = entry.file;
        if (!direct.has(from)) direct.set(from, new Set());
        for (const imported of entry.imports) {
            for (const target of resolveImportFiles(imported.packageName, packageFiles)) {
                if (target !== from) direct.get(from)!.add(target);
            }
        }
    }
    // Files with no package declaration at all still belong in the graph.
    for (const { filePath } of documents) {
        if (!direct.has(filePath)) direct.set(filePath, new Set());
    }

    const dependsOn = new Map<string, Set<string>>();
    for (const file of direct.keys()) {
        dependsOn.set(file, transitiveClosure(file, direct));
    }

    const dependents = new Map<string, Set<string>>();
    for (const file of dependsOn.keys()) dependents.set(file, new Set());
    for (const [file, targets] of dependsOn) {
        for (const target of targets) {
            if (!dependents.has(target)) dependents.set(target, new Set());
            dependents.get(target)!.add(file);
        }
    }

    return { dependsOn, dependents };
}

/**
 * Files an import path can be satisfied from.
 *
 * `A::B::*` names package `A::B`, but a nested package is also reachable
 * through its ancestors, so a prefix match keeps the closure complete rather
 * than exact — under-reporting here means a stale diagram, which is the failure
 * this graph exists to prevent.
 */
function resolveImportFiles(
    packageName: string,
    packageFiles: Map<string, Set<string>>,
): Set<string> {
    const files = new Set<string>();
    if (!packageName) return files;
    const exact = packageFiles.get(packageName);
    if (exact) for (const file of exact) files.add(file);

    const prefix = `${packageName}::`;
    for (const [name, owners] of packageFiles) {
        if (name && name.startsWith(prefix)) {
            for (const file of owners) files.add(file);
        }
    }
    return files;
}

/** Every file reachable from `start`, excluding `start` itself. */
function transitiveClosure(start: string, direct: Map<string, Set<string>>): Set<string> {
    const seen = new Set<string>();
    const stack = [...(direct.get(start) ?? [])];
    while (stack.length > 0) {
        const next = stack.pop()!;
        if (next === start || seen.has(next)) continue;   // import cycles terminate here
        seen.add(next);
        for (const onward of direct.get(next) ?? []) {
            if (!seen.has(onward)) stack.push(onward);
        }
    }
    return seen;
}

/**
 * Every file that can change what a view renders.
 *
 * That is the view's own source, the files owning the elements it displays,
 * and the transitive import closure of both. A view with no explicit element
 * selection shows whatever the model gives it, so its own closure is all that
 * can be stated.
 */
export function viewSourceFiles(
    diagram: Pick<DiagramDTO, 'sourceFile' | 'elementIds'>,
    elements: ReadonlyMap<string, MemoElement> | Record<string, MemoElement>,
    graph: SourceGraph,
): string[] {
    const lookup = elements instanceof Map
        ? (id: string) => elements.get(id)
        : (id: string) => (elements as Record<string, MemoElement>)[id];

    const roots = new Set<string>();
    if (diagram.sourceFile) roots.add(diagram.sourceFile);
    for (const id of diagram.elementIds ?? []) {
        const file = lookup(id)?.file;
        if (file) roots.add(file);
    }

    const files = new Set(roots);
    for (const root of roots) {
        for (const dependency of graph.dependsOn.get(root) ?? []) files.add(dependency);
    }
    return [...files].sort();
}

/** Serializable form of the graph, shipped with the model DTO. */
export function sourceGraphToDTO(graph: SourceGraph): SourceGraphDTO {
    const dependsOn: Record<string, string[]> = {};
    for (const [file, targets] of graph.dependsOn) {
        if (targets.size > 0) dependsOn[file] = [...targets].sort();
    }
    return { dependsOn };
}

function addTo(index: Map<string, Set<string>>, key: string, value: string): void {
    if (!key) return;
    let bucket = index.get(key);
    if (!bucket) {
        bucket = new Set();
        index.set(key, bucket);
    }
    bucket.add(value);
}

// Consuming the graph needs no parser, so those helpers live in a
// browser-safe module and are re-exported here for server-side callers.
export { affectedBy, affectingFiles, changeAffects } from './source-affinity.js';
