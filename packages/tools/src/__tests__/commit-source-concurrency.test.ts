import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitSource } from '../server/persistor.js';
import type { OutlineSource } from '../authoring/outline-source.js';

describe('source snapshots survive compiler verification', () => {
    for (const changed of ['parent.sysml', 'component.sysml']) it(`refuses the entire edit when ${changed} is edited during verification`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-source-race-'));
        const parent = join(root, 'parent.sysml'), component = join(root, 'component.sysml');
        const original = 'package Original {}\n', concurrent = 'package Concurrent {}\n';
        writeFileSync(parent, original); writeFileSync(component, original);
        try {
            const verifier = { verify: async () => { writeFileSync(join(root, changed), concurrent); } } as unknown as OutlineSource;
            const result = await commitSource(parent, 'parent.sysml', 'package Proposed {}\n', verifier,
                new Map([[component, 'package ProposedComponent {}\n']]), root, new Map([[parent, original], [component, original]]));
            expect(result).toMatchObject({ success: false, error: expect.stringContaining('no files were written') });
            expect(readFileSync(join(root, changed), 'utf8')).toBe(concurrent);
            expect(readFileSync(changed === 'parent.sysml' ? component : parent, 'utf8')).toBe(original);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
    it('checks a snapshot captured before source outlining, as well as changes during verification', async () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-source-before-'));
        const file = join(root, 'parent.sysml');
        writeFileSync(file, 'concurrent');
        try {
            const result = await commitSource(file, 'parent.sysml', 'proposed', { verify: async () => {} } as unknown as OutlineSource,
                undefined, undefined, new Map([[file, 'original']]));
            expect(result.success).toBe(false);
            expect(readFileSync(file, 'utf8')).toBe('concurrent');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
});
