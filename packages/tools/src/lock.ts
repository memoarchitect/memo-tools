// ─── Ontology Lock ────────────────────────────────────────────────────────────
//
// Creates and checks memo.lock.yaml — locks the ontology identity so that
// accidental ontology changes are caught early. Lock file is created at
// `memo init` time and checked on `memo-architect dev` / `memo validate`.
//
// No auto-migration: changing ontology is rare and high-risk in regulated
// medical device development (per platform-strategy.md §8).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';


/** A single package entry in the lock file */
export interface LockPackageEntry {
    name: string;
    version: string;
    type: string;
    checksum: string;
}

/** The full lock file structure */
export interface OntologyLock {
    ontology: string;
    version: string;
    lockedAt: string;
    packages: LockPackageEntry[];
}

/** Result of lock check */
export interface LockCheckResult {
    ok: boolean;
    lockPath: string;
    message?: string;
    locked?: OntologyLock;
    current?: { ontology: string; version: string };
}

const LOCK_FILENAME = 'memo.lock.yaml';

/**
 * Compute a SHA-256 checksum of the memo.package.yaml (or memo.config.yaml)
 * for a given config path. This captures identity + version changes.
 */
function checksumFile(filePath: string): string {
    const content = readFileSync(filePath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Serialize an OntologyLock to YAML (hand-written to avoid yaml dependency).
 */
function serializeLock(lock: OntologyLock): string {
    let out = `# memo.lock.yaml — Ontology lock file (auto-generated)\n`;
    out += `# Do not edit manually. Regenerate with: memo lock\n\n`;
    out += `ontology: "${lock.ontology}"\n`;
    out += `version: "${lock.version}"\n`;
    out += `lockedAt: "${lock.lockedAt}"\n`;
    out += `packages:\n`;
    for (const pkg of lock.packages) {
        out += `  - name: "${pkg.name}"\n`;
        out += `    version: "${pkg.version}"\n`;
        out += `    type: "${pkg.type}"\n`;
        out += `    checksum: "${pkg.checksum}"\n`;
    }
    return out;
}

/**
 * Parse a memo.lock.yaml file (hand-written parser for the simple format).
 */
function parseLock(content: string): OntologyLock {
    const getString = (key: string): string => {
        const m = content.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, 'm'));
        return m ? m[1].trim() : '';
    };

    const packages: LockPackageEntry[] = [];
    // Split on "  - name:" to get each package block
    const blocks = content.split(/\n\s+-\s+name:/);
    for (let i = 1; i < blocks.length; i++) {
        const block = 'name:' + blocks[i];
        const name = block.match(/name:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
        const version = block.match(/version:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
        const type = block.match(/type:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
        const checksum = block.match(/checksum:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
        if (name) packages.push({ name, version, type, checksum });
    }

    return {
        ontology: getString('ontology'),
        version: getString('version'),
        lockedAt: getString('lockedAt'),
        packages,
    };
}

/**
 * Write memo.lock.yaml from what the project's imports actually resolved to.
 *
 * The lock is an application artifact, and section 5.3 is explicit about what
 * it may do: record the package, version, and hash a native import resolved to,
 * so a rebuild is reproducible. It may not introduce a package the import graph
 * never named — which is why it is generated from `selectedRoots` rather than
 * from an `extends` chain that could name packages the model never used.
 */
export function createLockFile(
    projectRoot: string,
    selectedRoots: readonly LockableRoot[],
): { lockPath: string; lock: OntologyLock } {
    const roots = [...selectedRoots].sort((a, b) => a.packageName.localeCompare(b.packageName));
    if (roots.length === 0) {
        throw new Error(
            'This project resolves no reusable packages, so there is nothing to lock. '
            + 'Add an import to model/catalog/project.sysml first.',
        );
    }

    // The primary is the package the project imports most directly. Ties break
    // by name so the lock is byte-stable across runs.
    const primary = [...roots].sort(
        (a, b) => a.importDepth - b.importDepth || a.packageName.localeCompare(b.packageName),
    )[0];

    const lock: OntologyLock = {
        ontology: primary.packageName,
        version: primary.packageVersion ?? '0.0.0',
        lockedAt: new Date().toISOString().split('T')[0],
        packages: roots.map(root => ({
            name: root.packageName,
            version: root.packageVersion ?? '0.0.0',
            type: root.origin,
            checksum: checksumRoot(root),
        })),
    };

    const lockPath = join(resolve(projectRoot), LOCK_FILENAME);
    writeFileSync(lockPath, serializeLock(lock));
    return { lockPath, lock };
}

/** What the lock needs to know about a resolved package. */
export interface LockableRoot {
    dir: string;
    sysmlDir: string;
    packageName: string;
    packageVersion?: string;
    origin: string;
    importDepth: number;
}

/**
 * Hash a resolved package's descriptor.
 *
 * The descriptor carries name and version, which is what the lock asserts. A
 * content hash over every `.sysml` file would be stricter but would also make
 * the lock fail on an unrelated comment change, and "review this ontology
 * change" is a claim that should mean something.
 */
function checksumRoot(root: LockableRoot): string {
    for (const name of ['memo.package.yaml', 'memo.package.yml']) {
        const path = join(root.dir, name);
        if (existsSync(path)) return checksumFile(path);
    }
    return createHash('sha256').update(`${root.packageName}@${root.packageVersion ?? '0.0.0'}`).digest('hex');
}

/**
 * Check the lock against what the project resolves now.
 *
 * Returns ok when there is no lock file: a lock is recommended, not required.
 */
export function checkLockFile(
    projectRoot: string,
    selectedRoots: readonly LockableRoot[],
): LockCheckResult {
    const lockPath = join(resolve(projectRoot), LOCK_FILENAME);
    if (!existsSync(lockPath)) return { ok: true, lockPath, message: undefined };

    const lock = parseLock(readFileSync(lockPath, 'utf-8'));
    const byName = new Map(selectedRoots.map(r => [r.packageName, r]));

    const primary = byName.get(lock.ontology);
    if (!primary) {
        return {
            ok: false,
            lockPath,
            locked: lock,
            message:
                `Locked ontology cannot be resolved!\n\n`
                + `  Locked:  ${lock.ontology} v${lock.version}\n`
                + `  Current: the project's imports do not resolve "${lock.ontology}" from this directory\n\n`
                + `  Install it, or run inside a workspace that contains it, then retry.`,
        };
    }

    const currentVersion = primary.packageVersion ?? '0.0.0';
    const current = { ontology: lock.ontology, version: currentVersion };

    if (lock.version !== currentVersion) {
        return {
            ok: false,
            lockPath,
            locked: lock,
            current,
            message:
                `Ontology version changed!\n\n`
                + `  Locked:  ${lock.ontology} v${lock.version}\n`
                + `  Current: ${lock.ontology} v${currentVersion}\n\n`
                + `  Review the change, then update the lock:\n`
                + `    memo lock`,
        };
    }

    for (const locked of lock.packages) {
        const root = byName.get(locked.name);
        if (!root) continue;
        if (checksumRoot(root) !== locked.checksum) {
            return {
                ok: false,
                lockPath,
                locked: lock,
                current,
                message:
                    `Package "${locked.name}" has changed since the lock was created.\n\n`
                    + `  Review the change, then update the lock:\n`
                    + `    memo lock`,
            };
        }
    }

    return { ok: true, lockPath, locked: lock, current };
}

/**
 * Read an existing lock file. Returns undefined if not found.
 */
export function readLockFile(projectDir: string): OntologyLock | undefined {
    const lockPath = join(projectDir, LOCK_FILENAME);
    if (!existsSync(lockPath)) return undefined;
    return parseLock(readFileSync(lockPath, 'utf-8'));
}
