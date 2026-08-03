import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importKpar, inspectKpar } from '../commands/package.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });
function temp(): string { const dir = mkdtempSync(join(tmpdir(), 'memo-kpar-')); roots.push(dir); return dir; }

describe('KPAR package boundary', () => {
    it('rejects a non-ZIP archive before it can enter the cache', () => {
        const project = temp(); const archive = join(project, 'bad.kpar');
        writeFileSync(archive, 'not a zip');
        expect(() => inspectKpar(archive)).toThrow('not a ZIP archive');
        expect(() => importKpar(project, archive)).toThrow('not a ZIP archive');
    });

    it('does not silently accept a missing archive', () => {
        expect(() => importKpar(temp(), 'missing.kpar')).toThrow('KPAR not found');
    });
});
