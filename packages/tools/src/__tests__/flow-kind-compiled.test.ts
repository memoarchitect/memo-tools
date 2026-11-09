import { describe, expect, it } from 'vitest';
import { compilerConfigured, modelFromSources } from './helpers/compile-source.js';

// Views colour a flow by the kind it declares, so the compiled relationship has to carry it, spelled as written.

describe.skipIf(!compilerConfigured)('the kind a flow declares', () => {
    it('reaches the relationship as an attribute', async () => {
        const source = `package P {
            enum def Kind { enum power; enum command; }
            flow def Tr { attribute flowKind : Kind; end source; end target; }
            item def Sig;
            action def Run {
                action a { out o : Sig; }
                action b { in i : Sig; }
                flow x : Tr from a.o to b.i { attribute :>> flowKind = Kind::power; }
            }
        }`;
        const model = await modelFromSources([{ filePath: 'p.sysml', source }], { asGiven: true });
        const flow = [...model.relationships.values()].find(r => r.type === 'flow');
        expect(flow?.attributes?.flowKind).toBe('Kind::power');
    });
});
