import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ontologyDrift } from '../model/pinned.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function project(lockedVersion: string, installedVersion: string) {
    const root = mkdtempSync(join(tmpdir(), 'memo-drift-')); dirs.push(root);
    mkdirSync(join(root, 'memo_packages/the-ontology/model'), { recursive: true });
    writeFileSync(join(root, 'memo.package.yaml'), 'name: m\n');
    writeFileSync(join(root, 'memo_packages/the-ontology/memo.package.yaml'), `name: the-ontology\nversion: ${installedVersion}\nsysmlDir: model\n`);
    writeFileSync(join(root, 'memo.lock.yaml'),
        `ontology: the-ontology\nversion: "${lockedVersion}"\nlockedAt: "2026-01-01"\npackages:\n  - name: the-ontology\n    version: "${lockedVersion}"\n    type: ontology\n    checksum: "x"\n`);
    return root;
}

describe('a pinned commit made with another version of the ontology', () => {
    it('names the package, the version the commit locked and the one this run uses', () => {
        expect(ontologyDrift(project('0.13.0', '0.14.0'))).toEqual([{ name: 'the-ontology', locked: '0.13.0', used: '0.14.0' }]);
    });
    it('says nothing when they agree, or when the commit locked nothing', () => {
        expect(ontologyDrift(project('0.14.0', '0.14.0'))).toEqual([]);
        const bare = mkdtempSync(join(tmpdir(), 'memo-drift-')); dirs.push(bare);
        expect(ontologyDrift(bare)).toEqual([]);
    });
});
