import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// A measurable value is an ISQ quantity (`20 [milli*s]`), so the builder has to carry it: the stage 1
// handoff holds it as an `[` operator expression over a number and a unit expression, which the attribute
// map used to drop to an empty string. The unit is spelled by the name its reference resolves to (`s` is `second`, `Hz` is `hertz`), which is
// the same unit and as valid in SysML; the handoff holds a library unit by name only, so a short name is not
// available to write back.
const SOURCE = `package quantity_probe {
    private import ISQ::*;
    private import SI::*;
    private import SIPrefixes::*;
    part def ProbeTask { attribute period : DurationValue; attribute rate : FrequencyValue; attribute memory : StorageCapacityValue; }
    part probeTask : ProbeTask { :>> period = 20 [milli*s]; :>> rate = 50 [Hz]; :>> memory = 512 [kibi*B]; }
}`;

describe.runIf(compilerConfigured && examplesPresent)('a quantity value reaches the model', () => {
    it('keeps the number and its unit, for a prefixed unit and a plain one', async () => {
        const attributes = await withExample({ 'model/catalog/quantity_probe.sysml': SOURCE }, project => {
            const usage = [...project.model.elements.values()].find(element => element.name === 'probeTask');
            return usage?.attributes;
        });
        expect(attributes).toMatchObject({ period: '20 [milli*second]', rate: '50 [hertz]', memory: '512 [kibi*byte]' });
    });
});
