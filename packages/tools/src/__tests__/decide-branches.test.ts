import { describe, expect, it } from 'vitest';
import { compilerConfigured, modelFromSources } from './helpers/compile-source.js';

// `decide d; if g then b; else c;` leaves the source of each branch to its position. A branch that names no
// source is still a branch: the decision has to come out with an edge to each target and the guard it is taken under.

describe.skipIf(!compilerConfigured)('the branches of a decision', () => {
    const branches = async (body: string) => {
        const source = `package P {
            private import ScalarValues::*;
            action def Run {
                attribute ok : Boolean;
                action a; action b; action c;
                ${body}
            }
        }`;
        const model = await modelFromSources([{ filePath: 'p.sysml', source }], { asGiven: true });
        return [...model.relationships.values()]
            .filter(r => r.type === 'succession')
            .map(r => `${r.sourceId} ${r.sourceEnd} ${r.targetId}`.replace(/P::Run::/g, '').replace(/ +/g, ' '));
    };

    it('takes the decision as the source of `if … then` and of `else`', async () => {
        expect(await branches('first a then d; decide d; if ok then b; else c;')).toEqual(['a d', 'd [ok] b', 'd [else] c']);
    });

    it('does not take an unguarded transition of a state machine for an else', async () => {
        const model = await modelFromSources([{ filePath: 'p.sysml', source: `package P {
            state def S { entry; then s1; state s1; state s2; transition first s1 then s2; }
        }` }], { asGiven: true });
        expect([...model.relationships.values()].filter(r => r.sourceEnd === '[else]')).toEqual([]);
    });

    it('still reads a guarded succession that names its source', async () => {
        expect(await branches('decide d; succession first d if ok then b; succession first d if not ok then c;'))
            .toEqual(['d [ok] b', 'd [not ok] c']);
    });
});
