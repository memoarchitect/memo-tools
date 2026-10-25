import { describe, expect, it } from 'vitest';
import { compilerConfigured, modelFromSources } from './helpers/compile-source.js';

// ─── Native constraints are elements ─────────────────────────────────────────
//
// "Every constraint of the system" must be a query over the model. The builder emitted none: not a
// range on an action's parameter, not a range on a value type, not a `constraint def`, not the
// `assume`/`require constraint` of a requirement. Each is an element now, owned by what holds it,
// carrying its expression as text. A MEMO rule (`MemoConsistencyRule`) is not one.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = `package P {
    private import ScalarValues::*;
    abstract constraint def MemoConsistencyRule;
    constraint def NoNegative :> MemoConsistencyRule { in x : Real; x >= 0 }
    action def Dose {
        in rate : Real;
        assert constraint rateRange { rate >= 0 and rate <= 10 }
        assert constraint { rate != 5 }
        constraint { rate != 6 }
    }
    attribute def Percentage :> Real { assert constraint { self >= 0.0 and self <= 1.0 } }
    requirement def Limit { subject d : Dose; require constraint { d.rate <= 10 } assume constraint lim { d.rate >= 0 } }
    constraint def Range { in x : Real; x >= 0 }
}`;

const constraints = async () => {
    const model = await modelFromSources([{ source: SRC, filePath: 'p.sysml' }], { asGiven: true });
    return [...model.elements.values()].filter(e => e.construct === 'constraint');
};

describe.runIf(compilerConfigured)('native constraints', () => {
    it('are elements, owned by what holds them, each with its expression', async () => {
        const byId = Object.fromEntries((await constraints()).map(c => [c.id, c]));
        expect(byId['P::Dose::rateRange']).toMatchObject({ owner: 'P::Dose', attributes: { constraintRole: 'assert', expression: 'rate >= 0 and rate <= 10' } });
        expect(byId['P::Percentage::constraint1']).toMatchObject({ owner: 'P::Percentage', attributes: { constraintRole: 'assert' } });
        expect(byId['P::Limit::lim']).toMatchObject({ owner: 'P::Limit', attributes: { constraintRole: 'assume', expression: 'd.rate >= 0' } });
        expect(byId['P::Limit::constraint1']).toMatchObject({ attributes: { constraintRole: 'require', expression: 'd.rate <= 10' } });
        expect(byId['P::Range']).toMatchObject({ isDefinition: true, owner: undefined, attributes: { expression: 'x >= 0' } });
    }, 120_000);

    it('number an owner\'s anonymous constraints in declaration order, and say they are positional', async () => {
        const byId = Object.fromEntries((await constraints()).map(c => [c.id, c]));
        expect(byId['P::Dose::constraint1']).toMatchObject({ kind: 'AssertConstraintUsage', attributes: { expression: 'rate != 5', positional: 'true' } });
        expect(byId['P::Dose::constraint2']).toMatchObject({ kind: 'ConstraintUsage', attributes: { expression: 'rate != 6', positional: 'true' } });
        expect(byId['P::Dose::rateRange'].attributes.positional).toBeUndefined();
    }, 120_000);

    it('leave a MEMO rule to the rule loader', async () => {
        const ids = (await constraints()).map(c => c.id);
        expect(ids).not.toContain('P::NoNegative');
        expect(ids).toContain('P::Range');
    }, 120_000);
});
