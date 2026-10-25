// ─── Ontology Lock ────────────────────────────────────────────────────────────
//
// Creates and checks memo.lock.yaml — locks the ontology identity so that
// accidental ontology changes are caught early. Lock file is created at
// `memo-architect init` time and checked on `memo-architect dev` / `memo validate`.
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

/** A dependency as a build used it: the range the project accepts, and the version that was found. */
export interface LockDependencyEntry {
    name: string;
    range: string;
    version: string;
    checksum: string;
}

/** The full lock file structure */
export interface OntologyLock {
    ontology: string;
    version: string;
    lockedAt: string;
    packages: LockPackageEntry[];
    /**
     * The project's `dependencies` as resolved when the lock was written. Absent in a lock that
     * predates dependency locking, which is then not checked for them; `memo lock` adds the section.
     */
    dependencies?: LockDependencyEntry[];
}

/** A `dependencies` entry of the manifest and the package it was found as (none: it was not found). */
export interface LockableDependency {
    name: string;
    range: string;
    root?: LockableRoot;
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
    out += `# Do not edit manually. Regenerate with: memo-architect lock\n\n`;
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
    if (lock.dependencies) {
        out += lock.dependencies.length === 0 ? `dependencies: []\n` : `dependencies:\n`;
        for (const dep of lock.dependencies) {
            out += `  - dependency: "${dep.name}"\n`;
            out += `    range: "${dep.range}"\n`;
            out += `    version: "${dep.version}"\n`;
            out += `    checksum: "${dep.checksum}"\n`;
        }
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

    // The dependencies section follows the packages and has its own entry key, so the two are read apart.
    const split = content.search(/^dependencies:/m);
    const packagesText = split === -1 ? content : content.slice(0, split);
    const dependenciesText = split === -1 ? undefined : content.slice(split);

    const packages: LockPackageEntry[] = [];
    // Split on "  - name:" to get each package block
    const blocks = packagesText.split(/\n\s+-\s+name:/);
    for (let i = 1; i < blocks.length; i++) {
        const block = 'name:' + blocks[i];
        const name = block.match(/name:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
        const version = block.match(/version:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
        const type = block.match(/type:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
        const checksum = block.match(/checksum:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
        if (name) packages.push({ name, version, type, checksum });
    }

    let dependencies: LockDependencyEntry[] | undefined;
    if (dependenciesText !== undefined) {
        dependencies = [];
        for (const block of dependenciesText.split(/\n\s+-\s+dependency:/).slice(1)) {
            const field = (key: string) => (key === 'dependency' ? block.match(/^\s*"?([^"\n]+)"?/) : block.match(new RegExp(`${key}:\\s*"?([^"\\n]+)"?`)))?.[1]?.trim() ?? '';
            const name = field('dependency');
            if (name) dependencies.push({ name, range: field('range'), version: field('version'), checksum: field('checksum') });
        }
    }

    return {
        ontology: getString('ontology'),
        version: getString('version'),
        lockedAt: getString('lockedAt'),
        packages,
        ...(dependencies ? { dependencies } : {}),
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
/** Numeric semver comparison; a missing version sorts lowest. */
function compareVersions(a: string | undefined, b: string | undefined): number {
    const parts = (v: string | undefined) => (v ?? '0.0.0').split('.').map(n => Number.parseInt(n, 10) || 0);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

export function createLockFile(
    projectRoot: string,
    allRoots: readonly LockableRoot[],
    dependencies: readonly LockableDependency[] = [],
): { lockPath: string; lock: OntologyLock } {
    // A dependency is a model the project builds on, not the ontology: it has its own section, with the
    // range beside the version, and is never the lock's primary package.
    const dependencyDirs = new Set(dependencies.flatMap(d => d.root ? [d.root.dir] : []));
    const selectedRoots = allRoots.filter(root => !dependencyDirs.has(root.dir));
    // One entry per package NAME, not per resolved directory.
    //
    // A workspace can offer the same package from two roots — an installed
    // `node_modules/@memoarchitect/ontology` beside a linked source checkout of
    // the same package at a different version. Recording both wrote a lock that
    // pinned `version: 0.6.4` while the loader resolved 0.6.5 through the
    // import graph, so every freshly initialized project failed its own
    // ontology-version check on the first `memo validate`.
    //
    // The winner is the root the import graph actually resolves through: lowest
    // importDepth, ties broken by the higher version so a rebuild is
    // reproducible rather than dependent on directory scan order.
    const byName = new Map<string, LockableRoot>();
    for (const root of selectedRoots) {
        const existing = byName.get(root.packageName);
        if (!existing
            || root.importDepth < existing.importDepth
            || (root.importDepth === existing.importDepth
                && compareVersions(root.packageVersion, existing.packageVersion) > 0)) {
            byName.set(root.packageName, root);
        }
    }
    const roots = [...byName.values()].sort((a, b) => a.packageName.localeCompare(b.packageName));
    if (roots.length === 0) {
        throw new Error(
            'This project resolves no reusable packages, so there is nothing to lock. '
            + 'Add an import to model/methodology/project.sysml first.',
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
        dependencies: dependencies.flatMap(dep => dep.root ? [{
            name: dep.name,
            range: dep.range,
            version: dep.root.packageVersion ?? '0.0.0',
            checksum: checksumRoot(dep.root),
        }] : []).sort((a, b) => a.name.localeCompare(b.name)),
    };

    const lockPath = join(resolve(projectRoot), LOCK_FILENAME);
    writeFileSync(lockPath, serializeLock(lock));
    return { lockPath, lock };
}

/** The lock's view of the `dependencies` a resolution found (origin and depth do not matter to it). */
export function lockableDependencies(
    resolved: readonly { name: string; range: string; root?: { dir: string; sysmlDir: string; packageName: string; packageVersion?: string } }[],
): LockableDependency[] {
    return resolved.map(dep => ({
        name: dep.name,
        range: dep.range,
        root: dep.root ? { ...dep.root, origin: 'dependency', importDepth: 1 } : undefined,
    }));
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
    dependencies: readonly LockableDependency[] = [],
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
                + `    memo-architect lock`,
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
                    + `    memo-architect lock`,
            };
        }
    }

    const dependencyProblem = checkDependencies(lock, dependencies);
    if (dependencyProblem) return { ok: false, lockPath, locked: lock, current, message: dependencyProblem };

    return { ok: true, lockPath, locked: lock, current };
}

/**
 * Check only the dependencies against the lock. A pinned build resolves them from the commit's own
 * `memo_packages/`, so a mismatch is the commit disagreeing with its own lock; the ontology is not
 * compared here because a pinned build installs the commit's own into its worktree (`installLockedPackages`), and `ontologyDrift` reports where that did not happen.
 */
export function checkDependencyLock(projectRoot: string, dependencies: readonly LockableDependency[]): LockCheckResult {
    const lockPath = join(resolve(projectRoot), LOCK_FILENAME);
    if (!existsSync(lockPath)) return { ok: true, lockPath };
    const locked = parseLock(readFileSync(lockPath, 'utf-8'));
    const message = checkDependencies(locked, dependencies);
    return message ? { ok: false, lockPath, locked, message } : { ok: true, lockPath, locked };
}

/**
 * Compare the dependencies a build resolves with the ones the lock recorded. A dependency that was not
 * found is the resolver's `dependency-missing`, not this check's. A lock with no dependencies section
 * predates dependency locking and says nothing about them.
 */
function checkDependencies(lock: OntologyLock, dependencies: readonly LockableDependency[]): string | undefined {
    if (!lock.dependencies) return undefined;
    const locked = new Map(lock.dependencies.map(d => [d.name, d]));
    for (const dep of dependencies) {
        if (!dep.root) continue;
        const entry = locked.get(dep.name);
        const found = dep.root.packageVersion ?? '0.0.0';
        const update = `\n\n  Review the change, then update the lock:\n    memo-architect lock`;
        if (!entry) {
            return `Dependency "${dep.name}" (${dep.range}) is not in the lock.\n\n  Found: v${found}${update}`;
        }
        if (entry.version !== found) {
            return `Dependency "${dep.name}" changed version!\n\n  Locked: v${entry.version}\n  Found:  v${found} (the project accepts ${dep.range})${update}`;
        }
        if (entry.checksum !== checksumRoot(dep.root)) {
            return `Dependency "${dep.name}" v${found} has changed since the lock was created.${update}`;
        }
    }
    return undefined;
}

/**
 * Read an existing lock file. Returns undefined if not found.
 */
export function readLockFile(projectDir: string): OntologyLock | undefined {
    const lockPath = join(projectDir, LOCK_FILENAME);
    if (!existsSync(lockPath)) return undefined;
    return parseLock(readFileSync(lockPath, 'utf-8'));
}
