// ─── `perform action n : T;` ──────────────────────────────────────────────────
//
// A perform that names no action to reference declares the action in place
// (SysML-textual-bnf.kebnf:952-955, the second alternative of
// PerformActionUsageDeclaration), and that usage is the action performed. It
// used to reach the model as no element and no edge.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { compileSources, compilerConfigured } from './helpers/compile-source.js';

const SOURCE = `package P {
    action def Clean;
    action clean : Clean;
    part def Device {
        perform action n : Clean;
        perform clean;
        perform action m;
        perform action :>> clean;
    }
    action def Wash {
        perform action rinse : Clean;
    }
}`;

describe.runIf(compilerConfigured)('a perform that declares its action in place', () => {
    it('is an element the performer performs, whether or not it is typed', async () => {
        const { model } = await compileSources([{ source: SOURCE, filePath: 'p.sysml' }]);
        const performs = model.relationships.filter(r => r.type === 'performs').map(r => `${r.sourceId} -> ${r.targetId}`).sort();
        expect(performs).toEqual([
            'P::Device -> P::Device::m',
            'P::Device -> P::Device::n',
            'P::Device -> P::clean',
            'P::Wash -> P::Wash::rinse',
        ]);
        const n = model.elements.get('P::Device::n')!;
        expect(n).toMatchObject({ construct: 'action', owner: 'P::Device', shortName: 'n' });
        expect(n.parentAction).toBeUndefined();
        expect(n.attributes.actionType).toBe('Clean');
        expect(model.elements.get('P::Device::m')).toBeDefined();
        // Inside an action, the performed action is a step of it.
        expect(model.elements.get('P::Wash::rinse')!.parentAction).toBe('P::Wash');
    });
});
