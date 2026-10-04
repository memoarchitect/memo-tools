// ─── The example's analysis samples are the ones memo init writes ────────────
//
// Each project keeps its own copy of the analysis samples and of
// `analysis/memo_model.py`, as `memo init` writes them. The gpca example's
// copy is checked in, so it is compared with a fresh scaffold here: a change
// to the starters or the model module that is not carried to the example fails.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffoldAnalysisSamples } from '../analysis-starters.js';

const example = resolve(__dirname, '../../../../../memo/examples/gpca-pump');

describe.runIf(existsSync(join(example, 'analysis')))('the gpca example\'s analysis samples', () => {
    it('equal a fresh memo init scaffold, model module included', () => {
        const fresh = mkdtempSync(join(tmpdir(), 'memo-samples-'));
        try {
            scaffoldAnalysisSamples(fresh);
            const files = ['analysis/memo_model.py', ...readdirSync(join(fresh, 'analysis', 'Samples')).map(name => `analysis/Samples/${name}`)];
            for (const file of files) {
                expect(readFileSync(join(example, file), 'utf8'), file).toBe(readFileSync(join(fresh, file), 'utf8'));
            }
        } finally {
            rmSync(fresh, { recursive: true, force: true });
        }
    });
});
