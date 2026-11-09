import { describe, expect, it } from 'vitest';
import { evaluateNativeConstraint, parseConstraintExpression } from '../validator/constraint-eval.js';
import { toElementIndex } from '../model/element-index.js';
import type { MemoElement, MemoModel, MemoRelationship } from '../model/semantic.js';

// CR-ONT-104: both ends of a functional exchange are performed or contained by an action.

const P = "upstream(performs)->exists(construct == 'action') or upstream(composes)->exists(construct == 'action')";
const RULE = { id: 'CR-ONT-104', description: 'exchange ends in a behaviour', appliesToKind: 'FunctionalExchange', expression: `sourceEnd->forAll(${P}) and targetEnd->forAll(${P})`, severity: 'warning' as const };

const element = (id: string, construct: string) => ({ id, name: id, kind: 'K', construct, layer: 'functional', file: '', attributes: {} }) as unknown as MemoElement;
const exchange = { id: 'P::x', shortName: 'x', named: true, type: 'flow', kind: 'FunctionalExchange', sourceId: 'f', targetId: 'g', sourceEnd: '', targetEnd: '', file: '' } as MemoRelationship;
const link = (type: string, sourceId: string, targetId: string) => ({ id: `${type}-${sourceId}-${targetId}`, type, sourceId, targetId, sourceEnd: '', targetEnd: '', file: '' }) as MemoRelationship;

function model(links: MemoRelationship[]): MemoModel {
    const elements = [element('f', 'action'), element('g', 'action'), element('run', 'action'), element('pump', 'part')];
    const relationships = [exchange, ...links];
    const relationshipsByType = new Map<string, MemoRelationship[]>();
    for (const r of relationships) relationshipsByType.set(r.type, [...(relationshipsByType.get(r.type) ?? []), r]);
    const group = (key: 'sourceId' | 'targetId') => {
        const index = new Map<string, MemoRelationship[]>();
        for (const r of relationships) index.set(r[key], [...(index.get(r[key]) ?? []), r]);
        return index;
    };
    return { elements: toElementIndex(elements), elementsByKind: new Map([['K', elements]]), relationships, relationshipsByType, incoming: group('targetId'), outgoing: group('sourceId') } as unknown as MemoModel;
}

describe('CR-ONT-104 — both ends of a functional exchange are in a behaviour', () => {
    const fails = (links: MemoRelationship[]) => evaluateNativeConstraint(RULE, model(links)).map(v => v.elementId);
    it('parses', () => { expect(parseConstraintExpression(RULE.expression)).toBeTruthy(); });
    it('accepts an exchange between functions a behaviour performs', () => { expect(fails([link('performs', 'run', 'f'), link('performs', 'run', 'g')])).toEqual([]); });
    it('accepts an exchange between steps a behaviour contains', () => { expect(fails([link('composes', 'run', 'f'), link('composes', 'run', 'g')])).toEqual([]); });
    it('REJECTS an exchange neither end of which is in a behaviour', () => { expect(fails([])).toEqual(['P::x']); });
    it('REJECTS an exchange with only one end in a behaviour', () => { expect(fails([link('performs', 'run', 'f')])).toEqual(['P::x']); });
    it('REJECTS a function only a part performs', () => { expect(fails([link('performs', 'pump', 'f'), link('performs', 'pump', 'g')])).toEqual(['P::x']); });
});
