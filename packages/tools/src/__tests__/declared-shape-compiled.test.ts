import { describe, expect, it } from 'vitest';
import { compilerConfigured, modelFromSources } from './helpers/compile-source.js';
import { interfacesBetween } from '../analysis/interfaces-between.js';
import { modelToDTO } from '../model/semantic.js';

describe.skipIf(!compilerConfigured)('what a compiled definition declares', () => {
    const source = `package P {
        private import ScalarValues::*;
        enum def Mode { enum a; enum b; }
        item def It { attribute one : Real[0..1]; attribute many : Real[2..*]; attribute exact : Real[3]; attribute plain : Real; }
        port def Pd;
        interface def I1 { end x : Pd; end y : ~Pd; }
        part def Ad { port p : ~Pd; }
        part sys { part u { port m : Pd; } part a : Ad; interface link : I1 connect u.m to a.p; }
        part def Bd { part d { port t : Pd; } }
    }`;
    const compile = () => modelFromSources([{ filePath: 'p.sysml', source }], { asGiven: true });

    it('keeps the multiplicity an attribute writes, and only those', async () => {
        const model = await compile();
        expect(model.elements.get('P::It')?.attributeMultiplicity).toEqual({ one: '0..1', many: '2..*', exact: '3..3' });
    });
    it('lists an enumeration\'s members in order', async () => {
        expect((await compile()).elements.get('P::Mode')?.enumMembers).toEqual(['a', 'b']);
    });
    it('builds an untyped part nested in a part or a definition, and its interface', async () => {
        const model = await compile();
        expect(model.elements.has('P::sys::u')).toBe(true);
        expect(model.elements.has('P::Bd::d')).toBe(true);
        expect(interfacesBetween(modelToDTO(model, {}), 'P::sys::u', 'P::sys::a')).toHaveLength(1);
    });
});
