import { describe, it, expect } from 'vitest';
import { parseConstraintExpression, evaluateNativeConstraint } from '../validator/constraint-eval.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';

function model(rels: MemoRelationship[]): MemoModel {
    const ex = { id: 'ceA', name: 'ceA', kind: 'ComponentExchange', construct: 'part',
                 layer: 'logical', file: '', attributes: {} } as MemoElement;
    return {
        elements: new Map([[ex.id, ex]]),
        elementsByKind: new Map([['ComponentExchange', [ex]]]),
        relationships: rels,
        relationshipsByType: new Map(rels.map(r => [r.type, [r]])),
    } as unknown as MemoModel;
}
const flow = (id: string): MemoRelationship =>
    ({ id, type: 'flow', sourceId: 'p1', targetId: 'p2', file: '' }) as MemoRelationship;

const RULE = {
    id: 'CR-ONT-076', description: 'exchange has a flow', appliesToKind: 'ComponentExchange',
    expression: 'linksOf(flow)->exists(id == subject.id)', severity: 'error' as const,
};

describe('CR-ONT-076 — the flow/part binding', () => {
    it('parses', () => { expect(parseConstraintExpression(RULE.expression)).toBeTruthy(); });

    it('accepts an exchange whose flow shares its name', () => {
        expect(evaluateNativeConstraint(RULE, model([flow('ceA')]))).toEqual([]);
    });

    it('REJECTS an exchange with no flow at all', () => {
        const v = evaluateNativeConstraint(RULE, model([]));
        expect(v.map(x => x.elementId)).toEqual(['ceA']);
    });

    it('REJECTS an exchange whose flow is named something else', () => {
        const v = evaluateNativeConstraint(RULE, model([flow('somethingElse')]));
        expect(v.map(x => x.elementId)).toEqual(['ceA']);
    });
});
