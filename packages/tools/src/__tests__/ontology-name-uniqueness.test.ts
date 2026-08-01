import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOntologyRegistries } from '../model/ontology-loader.js';

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

const GPCA_CONFIG = resolve(
    __dirname, '../../../../../memo/examples/gpca-pump/memo.config.yaml');

describe('ontology definition names are unique', () => {
    it('no short name is claimed by two definitions', async () => {
        if (!existsSync(GPCA_CONFIG)) {
            // The sibling ontology checkout is not present in every consumer
            // install; skipping is correct there, failing would be noise.
            return;
        }
        const result = await loadOntologyRegistries(GPCA_CONFIG);
        const collisions = result.kindNameCollisions;

        // Report the whole conflict, not just a count: whoever breaks this
        // needs to see which two definitions collided and where they live.
        const detail = collisions
            .map(c => `\n  ${c.shortName}\n${c.qualifiedNames
                .map((q, i) => `    ${q}  (${c.sourceFiles[i]})`).join('\n')}`)
            .join('');
        expect(collisions, `Overloaded definition names:${detail}\n`).toEqual([]);
    });
});
