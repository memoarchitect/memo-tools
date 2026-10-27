import { describe, expect, it } from 'vitest';
import { evaluateGuide } from '../methodology/guide.js';
import type { GuideStep } from '../stage2/guide-from-api.js';
import type { MemoModel } from '../model/semantic.js';

// The Guide's rules on a synthetic model: when a step is done, open, waiting on another team, or states no criterion.

const step = (name: string, over: Partial<GuideStep> = {}): GuideStep => ({
    id: name, name, inputKinds: [], outputKinds: [], doneWhen: [], linkedWhen: [], predecessors: [], methodology: 'm', ...over,
});
const element = (id: string, kind: string, attributes: Record<string, string> = {}) => ({ id, name: id, kind, attributes });
const link = (type: string, sourceId: string, targetId: string) => ({ id: `${type}:${sourceId}:${targetId}`, type, sourceId, targetId });
const KINDS: Record<string, string | undefined> = { UseCase: 'MemoUseCase', MemoUseCase: undefined, SystemFunction: undefined, Workflow: undefined, Hazard: undefined, LogicalComponent: undefined };
const kinds = { getKind: (name: string) => (name in KINDS ? { superType: KINDS[name] } : undefined) } as never;

function model(elements: ReturnType<typeof element>[], links: ReturnType<typeof link>[] = []): MemoModel {
    const outgoing = new Map<string, unknown[]>();
    const incoming = new Map<string, unknown[]>();
    for (const l of links) {
        outgoing.set(l.sourceId, [...(outgoing.get(l.sourceId) ?? []), l]);
        incoming.set(l.targetId, [...(incoming.get(l.targetId) ?? []), l]);
    }
    return { elements: new Map(elements.map(e => [e.id, e])), outgoing, incoming, relationships: links } as unknown as MemoModel;
}
const evaluate = (steps: GuideStep[], m: MemoModel, extra: Partial<Parameters<typeof evaluateGuide>[0]> = {}) =>
    evaluateGuide({ steps, model: m, kinds, violations: [], rules: [], ...extra });
const states = (steps: GuideStep[], m: MemoModel, extra = {}) => Object.fromEntries(evaluate(steps, m, extra).steps.map(s => [s.name, s.state]));

describe('the Guide', () => {
    const chain = [
        step('operational', { outputKinds: ['UseCase', 'Workflow'] }),
        step('functional', { outputKinds: ['SystemFunction'], predecessors: ['operational'] }),
        step('risk', { outputKinds: ['Hazard'], predecessors: ['functional'] }),
    ];

    it('has every step open on a model with nothing in it: a step is never held back by the one before it', () => {
        const result = evaluate(chain, model([]));
        expect(result.steps.map(s => s.state)).toEqual(['open', 'open', 'open']);
        expect(result.next).toBe('operational');
        // The order is still reported, as which step feeds which.
        expect(result.steps[2].predecessors).toEqual(['functional']);
    });

    it('judges a step by its own work even while the step before it is open', () => {
        // The risk team has hazards before anyone has written a function.
        expect(states(chain, model([element('h', 'Hazard')]))).toEqual({ operational: 'open', functional: 'open', risk: 'done' });
    });

    it('marks a step done once every output kind has an element, and the next open step is next', () => {
        const m = model([element('uc', 'UseCase'), element('wf', 'Workflow')]);
        expect(states(chain, m)).toEqual({ operational: 'done', functional: 'open', risk: 'open' });
        expect(evaluate(chain, m).next).toBe('functional');
        // Only one of the two kinds: still open, and it says what is missing.
        const partial = evaluate(chain, model([element('uc', 'UseCase')]));
        expect(partial.steps[0]).toMatchObject({ state: 'open', reasons: ['no Workflow yet'] });
    });

    it('counts an element of a specialization of the output kind', () => {
        const specialized = { getKind: (name: string) => (name === 'SafetyHazard' ? { superType: 'Hazard' } : name === 'Hazard' ? {} : undefined) } as never;
        expect(states([step('s', { outputKinds: ['Hazard'] })], model([element('h', 'SafetyHazard')]), { kinds: specialized })).toEqual({ s: 'done' });
        expect(states([step('s', { outputKinds: ['Hazard'] })], model([element('h', 'SafetyHazard')]), { kinds: undefined })).toEqual({ s: 'open' });
    });

    it('does not take a rule with nothing to judge for done', () => {
        const s = step('verify', { outputKinds: ['UseCase'], doneWhen: ['SomeRule'] });
        const rules = [{ id: 'CR-X', typeName: 'SomeRule', appliesToKind: 'SystemFunction' }];
        const none = evaluate([s], model([element('uc', 'UseCase')]), { rules });
        expect(none.steps[0]).toMatchObject({ state: 'open', rules: [{ rule: 'SomeRule', known: true, subjects: 0, violations: 0 }] });
        expect(none.steps[0].reasons).toEqual(['SomeRule has nothing to judge yet']);
        // With a subject and no finding it is done.
        expect(states([s], model([element('uc', 'UseCase'), element('f', 'SystemFunction')]), { rules })).toEqual({ verify: 'done' });
    });

    it('is not done while a rule has a finding on a member of the workspace, and ignores one elsewhere', () => {
        const s = step('verify', { doneWhen: ['SomeRule'] });
        const rules = [{ id: 'CR-X', typeName: 'SomeRule', appliesToKind: 'SystemFunction' }];
        const m = model([element('f', 'SystemFunction'), element('g', 'SystemFunction')]);
        const violations = [{ ruleId: 'CR-X', elementId: 'g' }] as never;
        expect(states([s], m, { rules, violations })).toEqual({ verify: 'open' });
        // Workspace of `f` alone: `g` is not a member, so its finding is not this workspace's.
        const workspace = { subjects: new Set(['f']), scope: 'system' as const };
        expect(states([s], m, { rules, violations, workspace })).toEqual({ verify: 'done' });
    });

    it('says a rule it cannot find is missing, rather than passing it', () => {
        const result = evaluate([step('s', { doneWhen: ['NoSuchRule'] })], model([]));
        expect(result.steps[0]).toMatchObject({ state: 'open', reasons: ['the rule NoSuchRule is not in the rule set'] });
    });

    it('counts an imported element only when something other than its own containment relates it', () => {
        const imported = element('req', 'Hazard', { 'externalReference.identifier': 'SRC-1' });
        const s = step('s', { outputKinds: ['Hazard'] });
        expect(states([s], model([imported]))).toEqual({ s: 'open' });
        expect(evaluate([s], model([imported])).steps[0].outputs).toEqual([{ kind: 'Hazard', count: 0, untracedImports: 1 }]);
        expect(evaluate([s], model([imported])).steps[0].reasons).toEqual(['1 imported Hazard element(s) are not traced to anything']);
        // A package's own containment is not a trace.
        expect(states([s], model([imported, element('p', 'Package')], [link('composes', 'p', 'req')]))).toEqual({ s: 'open' });
        expect(states([s], model([imported, element('f', 'SystemFunction')], [link('satisfiedBy', 'req', 'f')]))).toEqual({ s: 'done' });
        // Authored elements need no trace.
        expect(states([s], model([element('h', 'Hazard')]))).toEqual({ s: 'done' });
    });

    it('reports a step that names no output and no rule as having no criterion, never as done', () => {
        const result = evaluate([step('a'), step('b', { outputKinds: ['UseCase'], predecessors: ['a'] })], model([]));
        expect(result.steps.map(s => s.state)).toEqual(['no-criterion', 'open']);
        expect(result.next).toBe('b');
    });

    it('works a workspace at its own level: the system of systems\' steps, or one system\'s', () => {
        const steps = [step('sos', { level: 'systemOfSystems', outputKinds: ['UseCase'] }), step('sys', { level: 'system', outputKinds: ['UseCase'] })];
        const m = model([element('uc', 'UseCase')]);
        const sos = evaluate(steps, m, { workspace: { subjects: new Set(['uc']), scope: 'sos' } });
        const sys = evaluate(steps, m, { workspace: { subjects: new Set(['uc']), scope: 'system' } });
        expect(sos.steps.map(s => s.name)).toEqual(['sos']);
        expect(sys.steps.map(s => s.name)).toEqual(['sys']);
        expect(evaluate(steps, m).steps.map(s => s.name)).toEqual(['sos', 'sys']);
    });

    it('leaves a step in another level out of a workspace\'s steps', () => {
        const steps = [step('sos', { level: 'systemOfSystems', outputKinds: ['Hazard'] }), step('sys', { level: 'system', outputKinds: ['UseCase'], predecessors: ['sos'] })];
        expect(states(steps, model([element('uc', 'UseCase')]), { workspace: { subjects: new Set(['uc']), scope: 'system' } })).toEqual({ sys: 'done' });
    });
});

describe('links between layers', () => {
    // The logical team allocates the functional team's functions to its components.
    const rules = [{ id: 'CR-ALLOC', typeName: 'AllocationRule', appliesToKind: 'SystemFunction' }];
    const functional = step('functional', { label: 'Functional', outputKinds: ['SystemFunction'] });
    const logical = step('logical', { label: 'Logical', outputKinds: ['LogicalComponent'], linkedWhen: ['AllocationRule'], predecessors: ['functional'] });
    const steps = [functional, logical];
    const run = (elements: ReturnType<typeof element>[], violations: { ruleId: string; elementId: string }[] = []) =>
        evaluate(steps, model(elements), { rules, violations: violations as never });

    it('waits for the step that produces the link\'s subjects, and is not the next step', () => {
        const result = run([element('c', 'LogicalComponent')]);
        expect(result.steps[1]).toMatchObject({
            state: 'waiting', reasons: [], waiting: ['AllocationRule waits for Functional'],
            links: [{ rule: 'AllocationRule', state: 'waiting', waitingFor: ['functional'], unlinked: [] }],
        });
        // The functional team has work to do; the logical team has none it can do.
        expect(result.next).toBe('functional');
    });

    it('is ready to link once both sides exist and a subject is not linked, and names the unlinked elements', () => {
        const result = run([element('f', 'SystemFunction'), element('g', 'SystemFunction'), element('c', 'LogicalComponent')],
            [{ ruleId: 'CR-ALLOC', elementId: 'g' }]);
        expect(result.steps[1]).toMatchObject({
            state: 'open', reasons: ['AllocationRule: 1 not linked yet'], waiting: [],
            links: [{ state: 'ready', subjects: 2, violations: 1, unlinked: ['g'] }],
        });
        expect(result.next).toBe('logical');
    });

    it('is done when its own work is there and every link is made', () => {
        expect(states(steps, model([element('f', 'SystemFunction'), element('c', 'LogicalComponent')]), { rules })).toEqual({ functional: 'done', logical: 'done' });
    });

    it('is open while its own work is missing, whatever its links', () => {
        expect(run([]).steps[1]).toMatchObject({ state: 'open', reasons: ['no LogicalComponent yet'], waiting: ['AllocationRule waits for Functional'] });
    });

    it('says a link rule it cannot find is missing: that is work, not waiting', () => {
        const result = evaluate([step('s', { linkedWhen: ['NoSuchRule'] })], model([]));
        expect(result.steps[0]).toMatchObject({ state: 'open', reasons: ['the rule NoSuchRule is not in the rule set'], links: [{ state: 'unknown' }] });
    });

    it('waits on nobody when the step produces the link\'s subjects itself: its own output is the work', () => {
        // The risk team's hazards are its own output, and the mitigation link is judged on them.
        const risk = step('risk', { outputKinds: ['Hazard'], linkedWhen: ['MitigationRule'] });
        const other = step('sosRisk', { outputKinds: ['Hazard'] });
        const result = evaluate([other, risk], model([]), { rules: [{ id: 'CR-M', typeName: 'MitigationRule', appliesToKind: 'Hazard' }] });
        expect(result.steps[1]).toMatchObject({ state: 'open', reasons: ['no Hazard yet'], waiting: [], links: [{ state: 'waiting', waitingFor: [] }] });
    });

    it('waits on nothing in particular when no step produces the subjects, and says so', () => {
        const result = evaluate([step('s', { linkedWhen: ['AllocationRule'] })], model([]), { rules });
        expect(result.steps[0]).toMatchObject({ state: 'waiting', waiting: ['AllocationRule has nothing to judge yet'] });
    });
});
