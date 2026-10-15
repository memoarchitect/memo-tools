// A path through a usage typed by a definition ends on the nested part the definition owns.
//
// `pump.motor` names `P::Pump::motor`: the nested part is owned by the definition `Pump`, not by
// the usage `pump` that is typed by it. Before, the path stopped on `pump`.
import { describe, expect, it } from 'vitest';
import { compilerConfigured, modelFromSources } from './helpers/compile-source.js';

const SOURCE = `package P {
    part def Motor;
    part def Pump { part motor : Motor; }
    part pump : Pump;
    part sensor : Motor;
    action def Drive;
    action drive : Drive;
    allocate drive to pump.motor;
    connect pump.motor to sensor;
}
`;

describe.runIf(compilerConfigured)('a path through a usage typed by a definition', () => {
    it('allocates to the nested part, not to the usage that is typed by its owner', async () => {
        const model = await modelFromSources([{ source: SOURCE, filePath: 'typed.sysml' }]);
        expect(model.elements.get('P::drive')?.allocatedTo).toBe('P::Pump::motor');
    });

    it('leaves a connector end on the slot it names', async () => {
        const model = await modelFromSources([{ source: SOURCE, filePath: 'typed.sysml' }]);
        const connector = model.relationships.find(r => r.targetId === 'P::sensor' || r.sourceId === 'P::sensor');
        expect(connector).toBeDefined();
        expect([connector?.sourceId, connector?.targetId]).not.toContain('P::Pump::motor');
    });
});
