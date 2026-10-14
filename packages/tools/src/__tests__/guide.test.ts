import { describe, expect, it } from 'vitest';
import { evaluateGuide } from '../methodology/guide.js';
import type { GuideStep } from '../stage2/guide-from-api.js';
import type { MemoModel } from '../model/semantic.js';

// The Guide's rules on a synthetic model: when a step is done, open, blocked, or states no criterion.

const step = (name: string, over: Partial<GuideStep> = {}): GuideStep => ({
    id: name, name, inputKinds: [], outputKinds: [], doneWhen: [], predecessors: [], methodology: 'm', ...over,
});
const element = (id: string, kind: string, attributes: Record<string, string> = {}) => ({ id, name: id, kind, attributes });
const link = (type: string, sourceId: string, targetId: string) => ({ id: `${type}:${sourceId}:${targetId}`, type, sourceId, targetId });
const KINDS: Record<string, string | undefined> = { UseCase: 'MemoUseCase', MemoUseCase: undefined, SystemFunction: undefined, Workflow: undefined, Hazard: undefined };
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

    it('has every step open or blocked on a model with nothing in it, and the first is next', () => {
        const result = evaluate(chain, model([]));
        expect(result.steps.map(s => s.state)).toEqual(['open', 'blocked', 'blocked']);
        expect(result.next).toBe('operational');
        expect(result.steps[2].blockedBy).toEqual(['functional']);
    });

    it('marks a step done once every output kind has an element, and the next step opens', () => {
        const m = model([element('uc', 'UseCase'), element('wf', 'Workflow')]);
        expect(states(chain, m)).toEqual({ operational: 'done', functional: 'open', risk: 'blocked' });
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
        // A step with no criterion does not block what follows it.
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

    it('does not let a step in another level block a step', () => {
        const steps = [step('sos', { level: 'systemOfSystems', outputKinds: ['Hazard'] }), step('sys', { level: 'system', outputKinds: ['UseCase'], predecessors: ['sos'] })];
        expect(states(steps, model([element('uc', 'UseCase')]), { workspace: { subjects: new Set(['uc']), scope: 'system' } })).toEqual({ sys: 'done' });
    });
});
