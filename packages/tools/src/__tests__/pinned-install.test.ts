import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installLockedPackages, ontologyDrift } from '../model/pinned.js';
import { discoverLibraryRoots } from '../model/native-project.js';

// ─── A pinned build reads its commit's ontology ──────────────────────────────
//
// The commit's `memo.lock.yaml` names the ontology version it was made with. That release is installed into the
// worktree's own `node_modules`, which the locator reads before anything above it; if the install cannot happen,
// today's copy stays in use and `ontologyDrift` says so.
// ─────────────────────────────────────────────────────────────────────────────

let dir: string;

const LOCK = (version: string) => `ontology: "@memoarchitect/ontology"
version: "${version}"
lockedAt: "2026-10-25"
packages:
  - name: "@memoarchitect/ontology"
    version: "${version}"
    type: "ontology"
    checksum: "x"
dependencies: []
`;

/** An installed ontology as npm lays it out: a distribution manifest that maps the package to `./ontology`. */
function writePackage(into: string, version: string): void {
    mkdirSync(join(into, 'ontology', 'src'), { recursive: true });
    writeFileSync(join(into, 'package.json'), JSON.stringify({ name: '@memoarchitect/ontology', version }));
    writeFileSync(join(into, 'memo.manifest.yaml'), 'manifest: 1\npackages:\n  "@memoarchitect/ontology": ./ontology\nexamples: {}\ninit:\n  defaultExtends: x\n  rootImport: memo\n  template: ./t\n');
    writeFileSync(join(into, 'ontology', 'memo.package.yaml'), `name: "@memoarchitect/ontology"\nversion: ${version}\nsysmlDir: src\n`);
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pinned-install-'));
    writeFileSync(join(dir, '.git'), 'gitdir: elsewhere\n');
    writeFileSync(join(dir, 'memo.lock.yaml'), LOCK('0.15.0'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('installLockedPackages', () => {
    it('installs the locked version into the worktree, where the locator finds it first', async () => {
        const calls: string[] = [];
        const result = await installLockedPackages(dir, async (name, version, into) => {
            calls.push(`${name}@${version}`);
            writePackage(join(into, 'node_modules', '@memoarchitect', 'ontology'), version);
        });
        expect(result).toEqual({ installed: ['@memoarchitect/ontology@0.15.0'], failed: [] });
        expect(calls).toEqual(['@memoarchitect/ontology@0.15.0']);
        expect(discoverLibraryRoots(dir).find(root => root.packageName === '@memoarchitect/ontology')?.packageVersion).toBe('0.15.0');
        expect(ontologyDrift(dir)).toEqual([]);
    });

    it('installs nothing when the worktree already holds that version', async () => {
        writePackage(join(dir, 'node_modules', '@memoarchitect', 'ontology'), '0.15.0');
        const result = await installLockedPackages(dir, async () => { throw new Error('should not run'); });
        expect(result).toEqual({ installed: [], failed: [] });
    });

    it('keeps today\'s copy and reports it when the install fails', async () => {
        writePackage(join(dir, 'node_modules', '@memoarchitect', 'ontology'), '0.16.1');
        const result = await installLockedPackages(dir, async () => { throw new Error('offline'); });
        expect(result).toEqual({ installed: [], failed: ['@memoarchitect/ontology@0.15.0'] });
        expect(ontologyDrift(dir)).toEqual([{ name: '@memoarchitect/ontology', locked: '0.15.0', used: '0.16.1' }]);
    });

    it('does nothing without a lock', async () => {
        rmSync(join(dir, 'memo.lock.yaml'));
        const result = await installLockedPackages(dir, async () => { throw new Error('should not run'); });
        expect(result).toEqual({ installed: [], failed: [] });
    });
});
