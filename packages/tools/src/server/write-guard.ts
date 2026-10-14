// ─── Files no write may land in ──────────────────────────────────────────────
//
// An element of a dependency (or of the ontology, a methodology, an extension)
// is owned by another package: the model shows it and links to it, and the
// only place to change it is that package. Every writer ends in one of a few
// atomic writes, and each asks here first, so a new handler cannot forget the
// rule. A guard on the element handlers alone left the relationship, package,
// release, import and layout writers free to write into a dependency's files.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

let readOnlyRoots: string[] = [];

/** The directories whose files are not this project's to write; replaces the last set. */
export function setReadOnlyRoots(dirs: Iterable<string>): void {
    readOnlyRoots = [...dirs].map(dir => resolve(dir));
}

const DESCRIPTORS = ['memo.package.yaml', 'memo.package.yml'];

function descriptorIn(dir: string): Record<string, unknown> | undefined {
    for (const name of DESCRIPTORS) {
        const path = resolve(dir, name);
        if (!existsSync(path)) continue;
        try {
            const parsed = parseYaml(readFileSync(path, 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
        } catch { return {}; }
    }
    return undefined;
}

/**
 * A package the file's project depends on, found from the file alone: the nearest package descriptor
 * above it names the package, and a descriptor further up that lists that name under `dependencies`
 * is the project that builds on it. This is what lets a writer that was never told which roots are
 * read-only (the CLI's, a script's) still refuse a dependency's file.
 */
function dependencyRootOf(path: string): string | undefined {
    let dir = dirname(path);
    let owner: { dir: string; name: string } | undefined;
    while (true) {
        const descriptor = descriptorIn(dir);
        if (descriptor) {
            if (!owner) {
                if (typeof descriptor.name === 'string') owner = { dir, name: descriptor.name };
            } else {
                const dependencies = descriptor.dependencies;
                const bare = (name: string) => name.replace(/^@[^/]+\//, '');
                if (dependencies && typeof dependencies === 'object'
                    && Object.keys(dependencies).some(name => name === owner!.name || bare(name) === bare(owner!.name))) {
                    return owner.dir;
                }
            }
        }
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/** The root that owns `absolutePath` and forbids writing it, if any. */
export function readOnlyRootOf(absolutePath: string): string | undefined {
    const path = resolve(absolutePath);
    return readOnlyRoots.find(root => path === root || path.startsWith(root + sep)) ?? dependencyRootOf(path);
}

/** Throws when the file is under a read-only root. */
export function assertWritable(absolutePath: string): void {
    const root = readOnlyRootOf(absolutePath);
    if (root) {
        throw new Error(`${absolutePath} belongs to a package this model depends on (${root}); change it in that package, not here`);
    }
}
