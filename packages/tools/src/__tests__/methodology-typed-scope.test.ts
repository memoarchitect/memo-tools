import { describe, expect, it } from 'vitest';
import { compiledExample, examplesPresent } from './helpers/compile-source.js';

// A methodology's standards and viewpoints are references to the elements
// that declare them, so naming one that does not exist is a reference error
// from a compiler that resolves names (SysIDE, in `memo build`), not a
// selection that silently matches nothing.

describe.runIf(examplesPresent)('a methodology selects standards and viewpoints by reference', () => {
    it('reads them as the elements they name', async () => {
        const project = await compiledExample('gpca-pump');
        const gpca = [...(project.resolution?.methodologies.values() ?? [])]
            .find(m => m.includedStandards.length > 0);
        expect(gpca).toBeDefined();
        expect(gpca!.includedStandards.map(s => s.split('::').pop())).toEqual(
            ['iso14971', 'iec62304', 'cfr21Part820', 'iso13485']);
        expect(gpca!.includedViewpoints.map(v => v.split('::').pop())).toEqual(
            ['contextViewpoint', 'logicalArchitectureViewpoint', 'riskViewpoint']);
    }, 120_000);
});
