import { describe, expect, it } from 'vitest';
import { compilerConfigured, modelFromSources } from './helpers/compile-source.js';
import { interfacesBetween } from '../analysis/interfaces-between.js';
import { modelToDTO } from '../model/semantic.js';

// A compiled interface names a part and the port as an end on it (`b` and `q`), and a port lives on the part's
// definition, so the lookup has to work on that shape and not only on ids that are already ports.

describe.skipIf(!compilerConfigured)('interfaces of a compiled model', () => {
    const source = `package P {
        port def Pd;
        part def C { port r : Pd; }
        part def Bd { port q : Pd; part c : C; bind q = c.r; }
        part def Ad { port p : ~Pd; }
        interface def I1 { end x : Pd; end y : ~Pd; }
        part sys { part a : Ad; part b : Bd; interface link : I1 connect a.p to b.q; }
    }`;

    it('names the port on each part, and reaches a nested part through bind', async () => {
        const model = modelToDTO(await modelFromSources([{ filePath: 'p.sysml', source }], { asGiven: true }), {});
        const direct = interfacesBetween(model, 'P::sys::a', 'P::sys::b');
        expect(direct.map(f => [f.from.portId, f.to.portId])).toEqual([['P::Ad::p', 'P::Bd::q']]);
        const nested = interfacesBetween(model, 'P::sys::a', 'P::Bd::c');
        expect(nested.map(f => f.to)).toEqual([{ portId: 'P::C::r', ownerId: 'P::Bd::c', viaPortId: 'P::Bd::q' }]);
    });
});
