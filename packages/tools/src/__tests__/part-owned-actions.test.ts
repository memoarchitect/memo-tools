// ─── The actions a part declares in its own body ─────────────────────────────
//
// A part body takes any OccurrenceUsageElement, ActionUsage among its behaviour usages
// (SysML-textual-bnf.kebnf:241, :358, :378-379). An operational workflow is the analysis of a body of work, a
// part, and owns its scenarios that way: each scenario is an element the workflow composes, with its own steps.
// A `perform` in place is a different statement and is not composed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { compileSources, compilerConfigured } from './helpers/compile-source.js';

const SOURCE = `package P {
    part def Workflow;
    action def Scenario;
    action def Task;
    part wf : Workflow {
        action nominal : Scenario {
            action prepare : Task;
            action treat : Task;
            first prepare then treat;
        }
        action alternate : Scenario;
        perform action inPlace : Task;
    }
}`;

describe.runIf(compilerConfigured)('a part\'s own actions', () => {
    it('are elements the part owns and composes, each with its own steps; a perform in place is not composed', async () => {
        const { model } = await compileSources([{ source: SOURCE, filePath: 'p.sysml' }]);
        expect(model.elements.get('P::wf::nominal')).toMatchObject({ construct: 'action', owner: 'P::wf', kind: 'ActionUsage' });
        expect(model.elements.get('P::wf::nominal')!.parentAction).toBeUndefined();
        expect(model.elements.get('P::wf::alternate')).toMatchObject({ owner: 'P::wf' });
        // The steps are the scenario's.
        expect(['P::wf::nominal::prepare', 'P::wf::nominal::treat'].map(id => model.elements.get(id)?.parentAction)).toEqual(['P::wf::nominal', 'P::wf::nominal']);
        const composes = model.relationships.filter(r => r.type === 'composes').map(r => `${r.sourceId} -> ${r.targetId}`).sort();
        expect(composes).toEqual([
            'P::wf -> P::wf::alternate',
            'P::wf -> P::wf::nominal',
            'P::wf::nominal -> P::wf::nominal::prepare',
            'P::wf::nominal -> P::wf::nominal::treat',
        ]);
        // The perform in place is still the part's, as a performance.
        expect(model.relationships.some(r => r.type === 'performs' && r.sourceId === 'P::wf' && r.targetId === 'P::wf::inPlace')).toBe(true);
    });
});
