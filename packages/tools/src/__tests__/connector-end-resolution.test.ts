// ─── A connector end is resolved through the part's type ──────────────────────
//
// A dotted end (`device.motor.pIn`) used to be walked by MEMO to the deepest
// element it found, the rest becoming the end label, so a misspelled inner
// segment (`device.motr.pIn`) retargeted to `device` with no diagnostic. The
// compiler resolves every segment of an end through the types it passes
// through, so a misspelling is a stage 1 error and never reaches stage 2, while
// a legitimate tail (a port the part has from its definition, or inherits from
// the definition's supertype, a flow parameter) is resolved by that same walk.
// This pins both, under whichever compiler the run is configured with.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { compileSources, compilerConfigured } from './helpers/compile-source.js';

const source = (connectors: string) => `package P {
    port def PIn;
    item def Dose;
    action def Prescribe { out dose : Dose; }
    action def Give { in dose : Dose; }
    part def Motor { port pIn : PIn; }
    part def Base { port inherited : PIn; }
    part def Device :> Base { port pCmd : PIn; part motor : Motor; }
    part device : Device;
    part other : Device;
    action prescribe : Prescribe;
    action give : Give;
    ${connectors}
}`;

describe.runIf(compilerConfigured)('a connector end with an inner segment', () => {
    it('that names a port of the part, an inherited port or a flow parameter builds the edge', async () => {
        const { model } = await compileSources([{
            filePath: 'p.sysml',
            source: source(`bind device.pCmd = device.motor.pIn;
    bind device.inherited = other.inherited;
    interface i1 connect device.pCmd to other.motor.pIn;
    flow f3 from prescribe.dose to give.dose;`),
        }]);
        const edges = model.relationships.filter(r => r.type !== 'composes')
            .map(r => `${r.type} ${r.sourceId}.${r.sourceEnd} -> ${r.targetId}.${r.targetEnd}`).sort();
        expect(edges).toEqual([
            'bind P::device.inherited -> P::other.inherited',
            'bind P::device.pCmd -> P::device.motor.pIn',
            'flow P::prescribe.dose -> P::give.dose',
            'interface P::device.pCmd -> P::other.motor.pIn',
        ]);
    });

    it.each([
        ['bind', 'bind device.pCmd = device.motr.pIn;'],
        ['bind (last segment)', 'bind device.pCmd = device.motor.pInn;'],
        ['interface', 'interface i1 connect device.pCmd to other.motr.pIn;'],
        ['flow, source', 'flow f1 from prescribe.dsoe to give.dose;'],
        ['flow, target', 'flow f2 from prescribe.dose to give.dsoe;'],
    ])('that is misspelled is refused, not retargeted to its parent: %s', async (_name, connector) => {
        await expect(compileSources([{ filePath: 'p.sysml', source: source(connector) }]))
            .rejects.toThrow(/the compiler rejected the test source/);
    });
});
