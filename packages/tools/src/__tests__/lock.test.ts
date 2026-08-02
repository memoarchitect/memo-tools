// The ontology lock (design section 5.3).
//
// The lock is an application artifact: it records what the native import graph
// resolved to, so a rebuild is reproducible. It may not introduce a package the
// imports never named, and it may not disagree with the loader about which
// version is in use — a lock that pins a version the runtime does not resolve
// turns every `memo validate` into a version-mismatch error on a project the
// user has not touched.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLockFile } from '../lock.js';

const TMP = resolve(__dirname, '__tmp_lock__');

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function root(packageName: string, version: string, importDepth: number) {
    const dir = join(TMP, `${packageName.replace(/[@/]/g, '_')}-${version}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'content.sysml'), `package p_${version.replace(/\./g, '_')} { }`);
    return { dir, sysmlDir: dir, packageName, packageVersion: version, origin: 'ontology' as const, importDepth };
}

describe('createLockFile', () => {
    it('records one entry per package name when a workspace offers two copies', () => {
        // A linked source checkout beside an installed copy of the same package
        // is the normal state of the memo-meta workspace. Recording both wrote
        // a lock that pinned 0.6.4 while the loader resolved 0.6.5, so a
        // freshly initialized project failed its own version check before the
        // user had edited anything.
        mkdirSync(TMP, { recursive: true });
        const { lock } = createLockFile(TMP, [
            root('@memoarchitect/ontology', '0.6.4', 1),
            root('@memoarchitect/ontology', '0.6.5', 1),
        ]);

        expect(lock.packages).toHaveLength(1);
        expect(lock.version).toBe('0.6.5');
        expect(lock.packages[0].version).toBe('0.6.5');
    });

    it('prefers the root the import graph resolves through over a higher version', () => {
        // Depth wins over version: the lock records what is actually used, not
        // the newest thing on disk.
        mkdirSync(TMP, { recursive: true });
        const { lock } = createLockFile(TMP, [
            root('@memoarchitect/ontology', '0.9.0', 3),
            root('@memoarchitect/ontology', '0.6.5', 1),
        ]);

        expect(lock.packages).toHaveLength(1);
        expect(lock.version).toBe('0.6.5');
    });

    it('compares versions numerically, not as strings', () => {
        mkdirSync(TMP, { recursive: true });
        const { lock } = createLockFile(TMP, [
            root('@memoarchitect/ontology', '0.9.0', 1),
            root('@memoarchitect/ontology', '0.10.0', 1),
        ]);

        expect(lock.version).toBe('0.10.0');
    });

    it('keeps distinct packages side by side', () => {
        mkdirSync(TMP, { recursive: true });
        const { lock } = createLockFile(TMP, [
            root('@memoarchitect/ontology', '0.6.5', 1),
            root('@memoarchitect/methodology-gpca', '0.6.5', 2),
        ]);

        expect(lock.packages.map(p => p.name).sort())
            .toEqual(['@memoarchitect/methodology-gpca', '@memoarchitect/ontology']);
    });

    it('refuses to write a lock for a project that resolves nothing', () => {
        mkdirSync(TMP, { recursive: true });
        expect(() => createLockFile(TMP, [])).toThrow(/resolves no reusable packages/);
    });
});
