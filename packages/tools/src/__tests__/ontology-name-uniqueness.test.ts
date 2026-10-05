import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compiledExample, compilerConfigured, examplesPresent } from './helpers/compile-source.js';

// A definition name is what a modeller types. If two definitions share one,
// the reference resolves by load order and the usage is silently validated
// against whichever definition happened to load last — so the model says one
// thing and the tool checks another. Overloaded names are a defect, not a
// style preference, and this test is the guard that keeps them out.
//
// Found and fixed one real instance: `WorkflowStep` was declared both in
// memo_methodology_workflow (stage/entryCriteria/exitCriteria) and in
// memo_architecture_operational_workflows (entryCondition/performedActivity/…).
// The methodology one is now MethodologyWorkflowStep.

describe.runIf(compilerConfigured && examplesPresent)('ontology definition names are unique', () => {
    it('no short name is claimed by two definitions', async () => {
        // The compiled project's handoff holds the ontology and every extension a
        // locator offers; its kind registry records each short name claimed twice.
        const project = await compiledExample('gpca-pump');
        const collisions = project.registries?.kindRegistry?.getCollisions() ?? [];

        // Report the whole conflict, not just a count: whoever breaks this
        // needs to see which two definitions collided and where they live.
        const detail = collisions
            .map(c => `\n  ${c.shortName}\n${c.qualifiedNames
                .map((q, i) => `    ${q}  (${c.sourceFiles[i]})`).join('\n')}`)
            .join('');
        expect(collisions, `Overloaded definition names:${detail}\n`).toEqual([]);
    }, 120_000);
});
