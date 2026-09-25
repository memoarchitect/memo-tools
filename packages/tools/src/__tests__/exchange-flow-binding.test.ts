import { describe, it, expect } from 'vitest';
import { parseConstraintExpression, evaluateNativeConstraint } from '../validator/constraint-eval.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';
import { toElementIndex } from '../model/element-index.js';

// ─── CR-ONT-076 — a component exchange carries a flow ────────────────────────
//
// A ComponentExchange is an interface: the connection between two ports. The
// rule asks that something crosses it — a `flow` whose ends are the
// exchange's own two ports. It used to tie a ComponentExchange PART to a flow
// of the same NAME, which no compiling model could satisfy.
//
// The ends are compared as ELEMENTS (`intersects` matches exact ids). A string
// comparison would have dropped everything up to the last `::` and matched two
// different ports that share a short name, which is the case below that
// would otherwise pass for the wrong reason.
// ─────────────────────────────────────────────────────────────────────────────

const port = (id: string) =>
    ({ id, name: id, kind: 'SoftwarePort', construct: 'port', layer: 'logical', file: '', attributes: {} }) as MemoElement;

const PORTS = [port('A::tlm::out'), port('A::bus::in'), port('B::tlm::out'), port('B::bus::in')];

const exchange: MemoRelationship = {
    id: 'P::ceA', shortName: 'ceA', named: true, type: 'interface', kind: 'ComponentExchange',
    sourceId: 'A::tlm::out', targetId: 'A::bus::in', file: '',
} as MemoRelationship;

const flow = (id: string, sourceId: string, targetId: string): MemoRelationship =>
    ({ id, type: 'flow', sourceId, targetId, file: '' }) as MemoRelationship;

function model(flows: MemoRelationship[]): MemoModel {
    const relationships = [exchange, ...flows];
    const relationshipsByType = new Map<string, MemoRelationship[]>();
    for (const r of relationships) relationshipsByType.set(r.type, [...(relationshipsByType.get(r.type) ?? []), r]);
    return {
        elements: toElementIndex(PORTS),
        elementsByKind: new Map([['SoftwarePort', PORTS]]),
        relationships,
        relationshipsByType,
    } as unknown as MemoModel;
}

const RULE = {
    id: 'CR-ONT-076', description: 'exchange carries a flow', appliesToKind: 'ComponentExchange',
    expression: 'linksOf(flow)->exists(sourceEnd->intersects(subject.sourceEnd) and targetEnd->intersects(subject.targetEnd))',
    severity: 'error' as const,
};

describe('CR-ONT-076 — a component exchange carries a flow between its ports', () => {
    it('parses', () => { expect(parseConstraintExpression(RULE.expression)).toBeTruthy(); });

    it('accepts an exchange with a flow between its two ports, whatever the flow is called', () => {
        expect(evaluateNativeConstraint(RULE, model([flow('ceAFlow', 'A::tlm::out', 'A::bus::in')]))).toEqual([]);
    });

    it('REJECTS an exchange with no flow at all', () => {
        expect(evaluateNativeConstraint(RULE, model([])).map(v => v.elementId)).toEqual(['P::ceA']);
    });

    it('REJECTS a flow the other way round', () => {
        const v = evaluateNativeConstraint(RULE, model([flow('back', 'A::bus::in', 'A::tlm::out')]));
        expect(v.map(x => x.elementId)).toEqual(['P::ceA']);
    });

    it('REJECTS a flow between different ports that share the short names', () => {
        const v = evaluateNativeConstraint(RULE, model([flow('elsewhere', 'B::tlm::out', 'B::bus::in')]));
        expect(v.map(x => x.elementId)).toEqual(['P::ceA']);
    });

    it('reports the exchange BY NAME', () => {
        const [v] = evaluateNativeConstraint(RULE, model([]));
        expect(v).toMatchObject({ elementName: 'ceA', elementKind: 'ComponentExchange' });
    });
});
