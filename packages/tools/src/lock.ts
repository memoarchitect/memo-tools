// ─── Ontology Lock ────────────────────────────────────────────────────────────
//
// Creates and checks memo.lock.yaml — locks the ontology identity so that
// accidental ontology changes are caught early. Lock file is created at
// `memo init` time and checked on `memo dev` / `memo validate`.
//
// No auto-migration: changing ontology is rare and high-risk in regulated
// medical device development (per platform-strategy.md §8).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from '@memo/tools';
import { loadConfigChain, type ConfigChainEntry } from './server/config-resolver.js';

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
 * Create a memo.lock.yaml from the resolved config chain.
 * Called by `memo init` and `memo lock`.
 */
export function createLockFile(configPath: string): { lockPath: string; lock: OntologyLock } {
    const chain = loadConfigChain(configPath);

    // The root ontology is the first package in the chain that is ontology or profile type
    // For a device project, the direct extends target is the "ontology" identity
    const leafConfig = chain[chain.length - 1]?.config;
    const ontologyEntry = findOntologyRoot(chain);

    const leafExtends = leafConfig?.extends;
    const leafExtendsStr = Array.isArray(leafExtends) ? leafExtends.join('+') : leafExtends;

    // Never lock a project against itself: if the extends chain did not resolve
    // to an ontology/profile package, the lock would record a meaningless identity.
    if (!ontologyEntry) {
        if (leafExtendsStr) {
            throw new Error(
                `ontology package "${leafExtendsStr}" could not be resolved from this directory. ` +
                `Install it (or run inside a workspace that contains it), then run \`memo lock\`.`
            );
        }
        throw new Error(
            `this project declares no \`extends\` ontology in its config, so there is nothing to lock.`
        );
    }

    const lock: OntologyLock = {
        ontology: ontologyEntry.config.ontologyMetadata?.id
            || ontologyEntry.config.projectName
            || leafExtendsStr
            || 'unknown',
        version: ontologyEntry.config.ontologyMetadata?.version || '0.0.0',
        lockedAt: new Date().toISOString().split('T')[0],
        packages: chain
            .filter(e => e.config.projectType !== 'device')
            .map(e => ({
                name: e.config.ontologyMetadata?.id || e.config.projectName,
                version: e.config.ontologyMetadata?.version || '0.0.0',
                type: e.config.projectType || 'unknown',
                checksum: checksumFile(e.configPath),
            })),
    };

    const lockPath = join(dirname(configPath), LOCK_FILENAME);
    writeFileSync(lockPath, serializeLock(lock));
    return { lockPath, lock };
}

/**
 * Find the ontology root in the config chain — the highest-level
 * ontology or profile package that the project extends.
 * Returns undefined when the chain contains no ontology/profile package
 * (e.g. the extends target could not be resolved from this directory).
 */
function findOntologyRoot(chain: ConfigChainEntry[]): ConfigChainEntry | undefined {
    // Walk from leaf toward root, find the direct extends target (profile or ontology)
    // The last entry before the device project is the ontology root
    for (let i = chain.length - 1; i >= 0; i--) {
        const type = chain[i].config.projectType;
        if (type === 'profile' || type === 'ontology') {
            return chain[i];
        }
    }
    return undefined;
}

/**
 * Check the lock file against the current config state.
 * Returns ok=true if the ontology matches, or if no lock file exists.
 */
export function checkLockFile(configPath: string): LockCheckResult {
    const lockPath = join(dirname(configPath), LOCK_FILENAME);

    if (!existsSync(lockPath)) {
        return { ok: true, lockPath, message: undefined };
    }

    const lockContent = readFileSync(lockPath, 'utf-8');
    const lock = parseLock(lockContent);

    // Get current ontology identity from config chain
    const chain = loadConfigChain(configPath);
    const ontologyEntry = findOntologyRoot(chain);
    const tailExtends = chain[chain.length - 1]?.config.extends;
    const tailExtendsStr = Array.isArray(tailExtends) ? tailExtends.join('+') : tailExtends;

    if (!ontologyEntry) {
        return {
            ok: false,
            lockPath,
            locked: lock,
            message:
                `Locked ontology cannot be resolved!\n\n` +
                `  Locked:  ${lock.ontology} v${lock.version}\n` +
                `  Current: package "${tailExtendsStr ?? lock.ontology}" not found from this directory\n\n` +
                `  The ontology this project was locked against is not installed here.\n` +
                `  Install it (or run inside a workspace that contains it), then retry.`,
        };
    }

    const currentOntology = ontologyEntry.config.ontologyMetadata?.id
        || ontologyEntry.config.projectName
        || tailExtendsStr
        || 'unknown';
    const currentVersion = ontologyEntry.config.ontologyMetadata?.version || '0.0.0';

    const current = { ontology: currentOntology, version: currentVersion };

    // Check ontology ID match
    if (lock.ontology !== currentOntology) {
        return {
            ok: false,
            lockPath,
            locked: lock,
            current,
            message:
                `Ontology mismatch!\n\n` +
                `  Locked:  ${lock.ontology} v${lock.version}\n` +
                `  Current: ${currentOntology} v${currentVersion}\n\n` +
                `  The ontology used by this project has changed since it was initialized.\n` +
                `  In regulated medical device development, ontology changes require\n` +
                `  explicit review — there is no auto-migration.\n\n` +
                `  To update the lock file after reviewing the change:\n` +
                `    memo lock\n\n` +
                `  Or restore the original ontology if this was unintended.`,
        };
    }

    // Check version match
    if (lock.version !== currentVersion) {
        return {
            ok: false,
            lockPath,
            locked: lock,
            current,
            message:
                `Ontology version changed!\n\n` +
                `  Locked:  ${lock.ontology} v${lock.version}\n` +
                `  Current: ${currentOntology} v${currentVersion}\n\n` +
                `  The ontology version has been updated since this project was initialized.\n` +
                `  Review the changes and update the lock file:\n` +
                `    memo lock`,
        };
    }

    // Check package checksums for content changes
    const currentPackages = chain
        .filter(e => e.config.projectType !== 'device')
        .map(e => ({
            name: e.config.ontologyMetadata?.id || e.config.projectName,
            checksum: checksumFile(e.configPath),
        }));

    for (const locked of lock.packages) {
        const current = currentPackages.find(p => p.name === locked.name);
        if (current && current.checksum !== locked.checksum) {
            return {
                ok: false,
                lockPath,
                locked: lock,
                current: { ontology: currentOntology, version: currentVersion },
                message:
                    `Ontology package "${locked.name}" has been modified since lock was created.\n\n` +
                    `  To update the lock file after reviewing the change:\n` +
                    `    memo lock`,
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
