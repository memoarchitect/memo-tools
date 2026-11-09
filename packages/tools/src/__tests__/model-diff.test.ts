import { describe, expect, it } from 'vitest';
import { computeModelDiff, type DiffElement, type DiffRelationship } from '../model/model-diff.js';

// A diff of two builds of different commits. Relationship ids are numbered in build order, so the same
// link carries a different id after any file is added; the diff must read links, not their numbers.

const el = (id: string, attributes: Record<string, string> = {}): DiffElement => ({ id, name: id, kind: 'Part', attributes });
const rel = (id: string, type: string, sourceId: string, targetId: string): DiffRelationship => ({ id, type, sourceId, targetId });
const model = (ids: string[], relationships: DiffRelationship[], attributes: Record<string, Record<string, string>> = {}) =>
    ({ elements: Object.fromEntries(ids.map(id => [id, el(id, attributes[id])])), relationships });

describe('computeModelDiff', () => {
    it('reports added, removed and changed elements', () => {
        const diff = computeModelDiff(model(['a', 'b'], [], { a: { v: '1' } }), model(['a', 'c'], [], { a: { v: '2' } }));
        expect(diff.added.map(e => e.id)).toEqual(['c']);
        expect(diff.removed.map(e => e.id)).toEqual(['b']);
        expect(diff.changed.map(c => `${c.element.id}: ${c.changes}`)).toEqual(['a: attributes changed']);
    });

    it('matches a link by its type and ends, not by the id it was numbered with', () => {
        const before = model(['a', 'b', 'c'], [rel('rel-1', 'composes', 'a', 'b')]);
        // A new file ahead of it renumbers the same link and adds one.
        const after = model(['a', 'b', 'c'], [rel('rel-1', 'contains', 'c', 'a'), rel('rel-2', 'composes', 'a', 'b')]);
        const diff = computeModelDiff(before, after);
        expect(diff.addedRels.map(r => `${r.type} ${r.sourceId}>${r.targetId}`)).toEqual(['contains c>a']);
        expect(diff.removedRels).toEqual([]);
    });

    it('counts a link written twice as two', () => {
        const once = model(['a', 'b'], [rel('1', 'flow', 'a', 'b')]);
        const twice = model(['a', 'b'], [rel('1', 'flow', 'a', 'b'), rel('2', 'flow', 'a', 'b')]);
        expect(computeModelDiff(once, twice).addedRels).toHaveLength(1);
        expect(computeModelDiff(twice, once).removedRels).toHaveLength(1);
        expect(computeModelDiff(twice, twice).summary.addedRels).toBe(0);
    });
});

describe('computeModelDiff on what a link carries', () => {
    const flow = (fields: Partial<DiffRelationship>): DiffRelationship => ({ id: 'f', type: 'flow', sourceId: 'a', targetId: 'b', ...fields });
    const diffOf = (before: DiffRelationship[], after: DiffRelationship[]) => computeModelDiff(model(['a', 'b'], before), model(['a', 'b'], after));

    it('reports a flow whose item changed, as a changed link and not a removal plus an addition', () => {
        const diff = diffOf([flow({ flowItem: 'X' })], [flow({ flowItem: 'Y' })]);
        expect(diff.changedRels.map(c => c.changes)).toEqual([['item: X → Y']]);
        expect(diff.addedRels).toEqual([]);
        expect(diff.removedRels).toEqual([]);
    });

    it('reports a changed kind, port and attribute by name', () => {
        const diff = diffOf(
            [flow({ kind: 'K1', sourcePortId: 'a.p', attributes: { latency: '1' } })],
            [flow({ kind: 'K2', sourcePortId: 'a.q', attributes: { latency: '2' } })],
        );
        expect(diff.changedRels[0].changes).toEqual(['kind: K1 → K2', 'source port: a.p → a.q', 'latency: 1 → 2']);
    });

    it('does not pair a changed link with its unchanged twin', () => {
        const diff = diffOf([flow({ flowItem: 'X' }), flow({ id: 'g', flowItem: 'Z' })], [flow({ id: 'h', flowItem: 'Z' }), flow({ id: 'i', flowItem: 'Y' })]);
        expect(diff.changedRels.map(c => c.changes)).toEqual([['item: X → Y']]);
    });

    it('treats a missing attribute map and an empty one as the same', () => {
        expect(diffOf([flow({})], [flow({ attributes: {} })]).summary.changedRels).toBe(0);
    });

    it('reports a parameter whose item type changed', () => {
        const element = (type: string): DiffElement => ({ id: 'a', kind: 'Action', attributes: {}, parameters: [{ name: 'o', direction: 'out', type }] });
        const diff = computeModelDiff({ elements: { a: element('X') }, relationships: [] }, { elements: { a: element('Y') }, relationships: [] });
        expect(diff.changed[0].changes).toEqual(['parameters: out o : X → out o : Y']);
    });
});
