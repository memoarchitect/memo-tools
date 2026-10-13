// ─── `port p : ~Sig;` is typed by Sig ─────────────────────────────────────────
//
// A conjugated port is typed through ConjugatedPortTyping (SysML-textual-bnf.kebnf,
// ConjugatedPortTyping), whose `type` is the implicit conjugated port definition
// `~Sig` that Sig owns. Reading only FeatureTyping lost the type: the usage came out
// as kind `Unknown` with no type, so nothing that follows typing (workspace
// membership, an element's classifier) could reach the port definition.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { compileSources, compilerConfigured } from './helpers/compile-source.js';

const SOURCE = `package P {
    port def Sig;
    part def Device {
        port pOut : Sig;
        port pIn : ~Sig;
    }
}`;

describe.runIf(compilerConfigured)('a conjugated port', () => {
    it('is typed by the port definition it conjugates', async () => {
        const { model } = await compileSources([{ source: SOURCE, filePath: 'p.sysml' }]);
        const direct = model.elements.get('P::Device::pOut')!;
        const conjugated = model.elements.get('P::Device::pIn')!;
        expect(direct.portSpec).toMatchObject({ type: 'Sig', isConjugated: false });
        expect(conjugated.portSpec).toMatchObject({ type: 'Sig', isConjugated: true });
        expect(conjugated.attributes.usageType).toBe('Sig');
    });
});
