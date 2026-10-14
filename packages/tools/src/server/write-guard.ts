// ─── Files no write may land in ──────────────────────────────────────────────
//
// An element of a dependency (or of the ontology, a methodology, an extension)
// is owned by another package: the model shows it and links to it, and the
// only place to change it is that package. Every writer ends in one of a few
// atomic writes, and each asks here first, so a new handler cannot forget the
// rule. A guard on the element handlers alone left the relationship, package,
// release, import and layout writers free to write into a dependency's files.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, sep } from 'node:path';

let readOnlyRoots: string[] = [];

/** The directories whose files are not this project's to write; replaces the last set. */
export function setReadOnlyRoots(dirs: Iterable<string>): void {
    readOnlyRoots = [...dirs].map(dir => resolve(dir));
}

/** The root that owns `absolutePath` and forbids writing it, if any. */
export function readOnlyRootOf(absolutePath: string): string | undefined {
    const path = resolve(absolutePath);
    return readOnlyRoots.find(root => path === root || path.startsWith(root + sep));
}

/** Throws when the file is under a read-only root. */
export function assertWritable(absolutePath: string): void {
    const root = readOnlyRootOf(absolutePath);
    if (root) {
        throw new Error(`${absolutePath} belongs to a package this model depends on (${root}); change it in that package, not here`);
    }
}
