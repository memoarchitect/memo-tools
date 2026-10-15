// A dependency's version is a range in memo.package.yaml; the lock records the version a build used.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLockFile, createLockFile, readLockFile, type LockableDependency, type LockableRoot } from '../lock.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function project() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-deplock-'))); dirs.push(root);
    return root;
}

function pkg(base: string, name: string, version: string): LockableRoot {
    const dir = join(base, 'memo_packages', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'memo.package.yaml'), `name: ${name}\nversion: ${version}\n`);
    return { dir, sysmlDir: dir, packageName: name, packageVersion: version, origin: 'ontology', importDepth: 1 };
}

const ontology = (base: string) => pkg(base, '@memoarchitect/ontology', '0.14.0');
const dependency = (root: LockableRoot, range = '^1.0.0'): LockableDependency => ({ name: root.packageName, range, root });

describe('the lock records the dependencies a build used', () => {
    it('writes the found version beside the range, outside the ontology packages', () => {
        const base = project();
        const platform = pkg(base, 'robot-platform', '1.2.0');
        const { lock } = createLockFile(base, [ontology(base), platform], [dependency(platform)]);
        expect(lock.packages.map(p => p.name)).toEqual(['@memoarchitect/ontology']);
        expect(lock.dependencies).toMatchObject([{ name: 'robot-platform', range: '^1.0.0', version: '1.2.0' }]);
        expect(readLockFile(base)?.dependencies).toEqual(lock.dependencies);
        expect(readLockFile(base)?.packages).toHaveLength(1);
    });

    it('passes while the version and package are what the lock saw', () => {
        const base = project();
        const platform = pkg(base, 'robot-platform', '1.2.0');
        createLockFile(base, [ontology(base), platform], [dependency(platform)]);
        expect(checkLockFile(base, [ontology(base), platform], [dependency(platform)]).ok).toBe(true);
    });

    it('refuses a build that resolves another version inside the same range', () => {
        const base = project();
        const platform = pkg(base, 'robot-platform', '1.2.0');
        createLockFile(base, [ontology(base), platform], [dependency(platform)]);
        const bumped = pkg(base, 'robot-platform', '1.3.0');
        const result = checkLockFile(base, [ontology(base), bumped], [dependency(bumped)]);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/Locked: v1\.2\.0[\s\S]*Found:\s+v1\.3\.0[\s\S]*\^1\.0\.0/);
    });

    it('refuses a changed package at the same version, and a dependency the lock never saw', () => {
        const base = project();
        const platform = pkg(base, 'robot-platform', '1.2.0');
        createLockFile(base, [ontology(base)], []);
        expect(checkLockFile(base, [ontology(base), platform], [dependency(platform)]).message).toMatch(/not in the lock/);

        createLockFile(base, [ontology(base), platform], [dependency(platform)]);
        writeFileSync(join(platform.dir, 'memo.package.yaml'), 'name: robot-platform\nversion: 1.2.0\ndescription: edited\n');
        expect(checkLockFile(base, [ontology(base), platform], [dependency(platform)]).message).toMatch(/has changed since the lock/);
    });

    it('says nothing of dependencies in a lock that predates the section', () => {
        const base = project();
        const platform = pkg(base, 'robot-platform', '1.2.0');
        const { lockPath } = createLockFile(base, [ontology(base)]);
        writeFileSync(lockPath, readFileSync(lockPath, 'utf8').replace(/^dependencies: \[\]\n/m, ''));
        expect(readLockFile(base)?.dependencies).toBeUndefined();
        expect(checkLockFile(base, [ontology(base), platform], [dependency(platform)]).ok).toBe(true);
    });
});
