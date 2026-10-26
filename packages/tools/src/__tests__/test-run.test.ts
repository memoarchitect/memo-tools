// A verification case is the plan and a test run is the record: the run is evidence the case produces,
// with a library verdict, a date, the version tested and measured values as quantities.

import { describe, expect, it } from 'vitest';
import { compiledExample, compilerConfigured, examplesPresent } from './helpers/compile-source.js';

describe.runIf(examplesPresent && compilerConfigured)('a test run in the pump example', () => {
    it('is evidence its case produces, and keeps the protocol on the case and the result on the run', async () => {
        const { model } = await compiledExample('embedded-infusion-pump');
        const run = [...model.elements.values()].find(e => e.shortName === 'runControlLoopDeadline1');
        const testCase = [...model.elements.values()].find(e => e.shortName === 'vcControlLoopDeadline');
        expect(run?.kind).toBe('TestRun');
        expect(testCase?.attributes).toMatchObject({ testLevel: expect.stringContaining('unit'), testEnvironment: expect.stringContaining('bench') });
        expect(run?.attributes.verdict).toContain('pass');
        expect(String(run?.attributes.softwareVersion)).toContain('1.4.2');
        const produced = model.relationships.filter(r => r.type === 'producesEvidence' || r.type === 'ProducesEvidence');
        expect(produced.some(r => r.sourceId === testCase?.id && r.targetId === run?.id)).toBe(true);
    });
});
