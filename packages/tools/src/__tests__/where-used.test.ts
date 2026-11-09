import { describe, expect, it } from 'vitest';
import { whereUsed, flowsOver } from '../analysis/where-used.js';
import { interfacesBetween } from '../analysis/interfaces-between.js';
import type { MemoElement, MemoModelDTO, MemoRelationship } from '../model/semantic.js';

const el = (id: string, fields: Partial<MemoElement> = {}): MemoElement =>
    ({ id, name: id, kind: 'K', layer: 'logical', construct: 'part', doc: '', attributes: {}, file: 'a.sysml', ...fields } as MemoElement);
const rel = (id: string, type: string, sourceId: string, targetId: string, fields: Partial<MemoRelationship> = {}): MemoRelationship =>
    ({ id, type, sourceId, targetId, sourceEnd: '', targetEnd: '', file: '', ...fields });

const model = (): MemoModelDTO => ({
    errors: [],
    elements: {
        Sig: el('Sig', { construct: 'item', isDefinition: true }), a: el('a'), b: el('b'),
        run: el('run', { construct: 'action' }),
        step: el('step', { construct: 'action', parentAction: 'run', parameters: [{ name: 'o', direction: 'out', type: 'P::Sig' }] }),
        next: el('next', { construct: 'action', parentAction: 'run', parameters: [{ name: 'i', direction: 'in', type: 'P::Sig' }] }),
        'a::p': el('a::p', { construct: 'port', owner: 'a', portSpec: { type: 'Sig', isConjugated: false } as MemoElement['portSpec'] }),
    },
    relationships: [
        rel('i', 'interface', 'a', 'b', { sourceEnd: 'p', targetEnd: 'q' }),
        rel('f', 'flow', 'a', 'b', { sourceEnd: 'p.d', targetEnd: 'q.d', flowItem: 'Sig' }),
        rel('g', 'flow', 'step', 'next', { sourceEnd: 'o', targetEnd: 'i' }),
    ],
});

describe('whereUsed', () => {
    it('finds producers, consumers, flows, interfaces, ports and behaviours', () => {
        const used = whereUsed(model(), 'Sig');
        expect(used.producers.map(e => e.id)).toEqual(['a', 'step']);
        expect(used.consumers.map(e => e.id)).toEqual(['b', 'next']);
        expect(used.flows.map(f => [f.id, f.item])).toEqual([['f', 'Sig'], ['g', 'Sig']]);
        expect(used.interfaces.map(i => i.id)).toEqual(['i']);
        expect(used.ports.map(p => p.owner.id)).toEqual(['a']);
        expect(used.behaviours.map(b => b.id)).toEqual(['run']);
    });
    it('is empty for an element that is not a definition', () => {
        expect(whereUsed(model(), 'a').flows).toEqual([]);
    });
});

describe('what crosses an interface', () => {
    it('matches a flow within the interface ends, in the same direction', () => {
        const m = model();
        expect(flowsOver(m.relationships[0], m.relationships).map(f => f.id)).toEqual(['f']);
        expect(flowsOver({ ...m.relationships[0], sourceEnd: 'other' }, m.relationships)).toEqual([]);
    });
    it('reports what an interface carries', () => {
        expect(interfacesBetween(model(), 'a', 'b')[0].carries).toEqual([{ flowId: 'f', item: 'Sig' }]);
    });
});
