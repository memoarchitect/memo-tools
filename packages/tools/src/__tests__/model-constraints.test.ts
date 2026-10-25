// A `require constraint` and an `assert constraint` the model declares are evaluated, with quantities
// compared as quantities. A constraint that names something unresolvable is reported, never passed.

import { describe, expect, it } from 'vitest';
import type { MemoElement, MemoModel } from '../model/semantic.js';
import { toElementIndex } from '../model/element-index.js';
import { validateModelConstraints, MODEL_CONSTRAINT_RULE_ID } from '../validator/model-constraints.js';
import { validateModel } from '../validator/rule-engine.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';
import { compiledExample, examplesPresent } from './helpers/compile-source.js';

const element = (over: Partial<MemoElement>): MemoElement =>
    ({ id: 'x', name: 'x', kind: 'Thing', construct: 'part', layer: 'implementation', file: 'f.sysml', attributes: {}, ...over }) as MemoElement;

function model(elements: MemoElement[]): MemoModel {
    return { elements: toElementIndex(new Map(elements.map(e => [e.id, e]))), relationships: [], errors: [], packages: [],
        elementsByKind: new Map(), elementsByLayer: new Map(), relationshipsByType: new Map(), outgoing: new Map(), incoming: new Map() } as unknown as MemoModel;
}

const loop = element({ id: 'p::loop', shortName: 'loop', name: 'loop', package: 'p', attributes: { wcetMs: '1 [s]', deadlineMs: '500 [milli*second]' } });
const requirement = element({ id: 'p::req', shortName: 'req', name: 'req', kind: 'Requirement', package: 'p' });
const constraint = (expression: string, role = 'require') => element({
    id: `p::req::c`, shortName: 'c', name: 'c', kind: 'ConstraintUsage', construct: 'constraint', package: 'p', owner: 'p::req',
    attributes: { constraintRole: role, expression },
});

describe('model constraints', () => {
    it('compares two quantities in one unit, whatever each was written in', () => {
        expect(validateModelConstraints(model([loop, requirement, constraint('loop.wcetMs <= loop.deadlineMs')]))).toHaveLength(1);
        expect(validateModelConstraints(model([loop, requirement, constraint('loop.deadlineMs <= loop.wcetMs')]))).toEqual([]);
        expect(validateModelConstraints(model([loop, requirement, constraint('loop.wcetMs <= 2000 [milli * second]')]))).toEqual([]);
    });

    it('reports a violated constraint against the element that owns it', () => {
        const [v] = validateModelConstraints(model([loop, requirement, constraint('loop.wcetMs <= 10 [milli * second]')]));
        expect(v).toMatchObject({ ruleId: MODEL_CONSTRAINT_RULE_ID, severity: 'error', elementId: 'p::req' });
        expect(v.description).toContain('does not hold');
    });

    it('says a constraint was not evaluated when a name resolves to nothing, rather than passing it', () => {
        const [v] = validateModelConstraints(model([loop, requirement, constraint('loop.missing <= 10 [milli * second]')]));
        expect(v).toMatchObject({ severity: 'info' });
        expect(v.description).toMatch(/not evaluated.*names nothing/);
    });

    it('refuses to compare a duration with a mass', () => {
        const [v] = validateModelConstraints(model([loop, requirement, constraint('loop.wcetMs <= 3 [kilo*g]')]));
        expect(v.description).toMatch(/not evaluated.*Cannot compare/);
    });

    it('reads an attribute of the owning element before an element of the package', () => {
        const owner = element({ id: 'p::req', shortName: 'req', name: 'req', kind: 'Requirement', package: 'p', attributes: { limit: '1 [s]' } });
        expect(validateModelConstraints(model([loop, owner, constraint('limit == 1000 [milli*second]')]))).toEqual([]);
    });
});

// MC-001 is a rule the ontology declares, so a methodology that disables it loses it and one that changes its
// severity changes the finding's; a caller that loaded no rules still gets the evaluation.
describe('MC-001 is tailorable', () => {
    const failing = model([loop, requirement, constraint('loop.wcetMs <= 10 [milli * second]')]);
    const rule = (over: Partial<CompiledConstraint> = {}): CompiledConstraint => ({
        id: 'MC-001', description: 'd', appliesToKind: 'Model', severity: 'error', evaluator: 'constraints',
        ast: { kind: 'bool', value: true } as never, ...over,
    });
    const other = (): CompiledConstraint => rule({ id: 'XX-001', evaluator: undefined, appliesToKind: 'Nothing' });
    const mc = (nativeConstraints?: CompiledConstraint[]) =>
        validateModel(failing, nativeConstraints).violations.filter(v => v.ruleId === MODEL_CONSTRAINT_RULE_ID);

    it('reports under the rule\'s severity, and counts the rule', () => {
        expect(mc([rule({ severity: 'warning' })]).map(v => v.severity)).toEqual(['warning']);
        expect(validateModel(failing, [rule()]).rulesEvaluated).toBeGreaterThan(0);
    });

    it('reports nothing when the methodology left the rule out, and everything when no rules were loaded', () => {
        expect(mc([other()])).toEqual([]);
        expect(mc()).toHaveLength(1);
    });
});

// The example's own constraints, through the compiler the suite runs under: the text the builder records
// reads the same under both compilers, and the constraints hold.
describe.runIf(examplesPresent)('the pump example constraints', () => {
    it('are elements with readable text, and hold', async () => {
        const project = await compiledExample('embedded-infusion-pump');
        const text = (id: string) => project.model.elements.get(`memo_examples_embedded_infusion_pump::${id}`)?.attributes.expression;
        expect(text('reqControlLoopDeadline::withinDeadline')).toBe('rtControlLoop.wcetMs <= 10 [milli * second]');
        expect(text('vcControlLoopDeadline::wcetWithinBudget')).toBe('rtControlLoop.wcetMs <= rtControlLoop.deadlineMs');
        expect(validateModelConstraints(project.model)).toEqual([]);
    }, 120_000);
});
