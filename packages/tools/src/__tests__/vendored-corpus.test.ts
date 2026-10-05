import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The SysML v2 Release corpus vendored under `corpus/sysml-v2-release/`: the
// normative BNF and library that clause citations and upstream reports quote.
// It is checked in at a pinned commit, so it must be exactly what its manifest
// records, and out of reach of anything that walks the sources.

const REPO = resolve(__dirname, '../../../..');
const SRC = resolve(__dirname, '..');

describe('the vendored SysML v2 Release corpus', () => {
    it('matches its manifest, file for file', () => {
        const out = execFileSync('node', [join(REPO, 'scripts/vendor-corpus.mjs'), '--verify'], { encoding: 'utf8' });
        expect(out).toMatch(/^OK {2}\d+ files match the manifest/m);
    });

    it('is not reachable from the model file walkers', () => {
        // A directory named `corpus/` next to the sources would be walked into by
        // anything pointed at the package.
        expect(existsSync(join(SRC, 'corpus'))).toBe(false);
        expect(existsSync(join(REPO, 'corpus/sysml-v2-release/manifest.json'))).toBe(true);
    });
});
