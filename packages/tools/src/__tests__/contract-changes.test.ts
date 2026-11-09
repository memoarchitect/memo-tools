import { describe, expect, it } from 'vitest';
import { computeModelDiff, type DiffElement, type DiffInput, type DiffRelationship } from '../model/model-diff.js';
import { contractChanges } from '../model/contract-changes.js';

const item = (attributes: Record<string, string>): DiffElement => ({ id: 'p::Sig', name: 'Sig', kind: 'ItemDefinition', construct: 'item', isDefinition: true, attributes });
const part = (id: string): DiffElement => ({ id, name: id, kind: 'Part', construct: 'part', attributes: {} });
const carrying = (flowItem: string, fields: Partial<DiffRelationship> = {}): DiffRelationship => ({ id: 'f', type: 'flow', sourceId: 'a', targetId: 'b', flowItem, ...fields });
const input = (elements: DiffElement[], relationships: DiffRelationship[]): DiffInput => ({ elements: Object.fromEntries(elements.map(e => [e.id, e])), relationships });
const judge = (before: DiffInput, after: DiffInput) => contractChanges(computeModelDiff(before, after), before, after);
const a = part('a'); const b = part('b');
const verdicts = (report: ReturnType<typeof judge>) => report.changes.map(c => [c.code, c.verdict, c.breaks]);

describe('contractChanges', () => {
    const withItem = (attributes: Record<string, string>) => input([item(attributes), a, b], [carrying('Sig')]);

    it('a new attribute with no value breaks producers, and lists who uses the item', () => {
        const report = judge(withItem({}), withItem({ v: '<Real>' }));
        expect(verdicts(report)).toEqual([['attribute.added', 'breaking', 'producers']]);
        expect(report.changes[0].parties).toEqual([{ id: 'a', name: 'a', role: 'producer' }, { id: 'b', name: 'b', role: 'consumer' }]);
    });
    it('a new attribute that has a value is compatible', () => {
        expect(verdicts(judge(withItem({}), withItem({ v: '3.0' })))).toEqual([['attribute.added-with-value', 'compatible', undefined]]);
    });
    it('a removed attribute breaks consumers', () => {
        expect(verdicts(judge(withItem({ v: '<Real>' }), withItem({})))).toEqual([['attribute.removed', 'breaking', 'consumers']]);
    });
    it('a retyped attribute breaks both', () => {
        expect(verdicts(judge(withItem({ v: '<Real>' }), withItem({ v: '<String>' })))).toEqual([['attribute.retyped', 'breaking', 'both']]);
    });
    it('a changed value is unknown, and is counted', () => {
        const report = judge(withItem({ v: '1' }), withItem({ v: '2' }));
        expect(verdicts(report)).toEqual([['attribute.value-changed', 'unknown', undefined]]);
        expect(report.summary).toEqual({ breaking: 0, compatible: 0, unknown: 1 });
    });
    it('a flow that carries something else breaks both ends', () => {
        const report = judge(input([a, b], [carrying('X')]), input([a, b], [carrying('Y')]));
        expect(verdicts(report)).toEqual([['link.item-changed', 'breaking', 'both']]);
    });
    it('a removed flow breaks both ends, and a removed succession is not a contract', () => {
        const report = judge(input([a, b], [carrying('X'), { id: 's', type: 'succession', sourceId: 'a', targetId: 'b' }]), input([a, b], []));
        expect(verdicts(report)).toEqual([['link.removed', 'breaking', 'both']]);
    });
    it('a definition removed while in use breaks both; one nobody used is a tidy-up', () => {
        expect(verdicts(judge(withItem({}), input([a, b], [carrying('Sig')])))).toEqual([['definition.removed', 'breaking', 'both']]);
        expect(judge(input([item({}), a], []), input([a], [])).changes).toEqual([]);
    });
    it('finds who uses a port definition through the ports typed by it', () => {
        const portDef: DiffElement = { id: 'p::Pd', name: 'Pd', kind: 'PortDefinition', construct: 'port', isDefinition: true, attributes: {} };
        const port: DiffElement = { id: 'a::p', name: 'p', kind: 'Pd', construct: 'port', owner: 'a', portSpec: { type: 'Pd' }, attributes: {} };
        const report = judge(input([portDef, port, a], []), input([{ ...portDef, attributes: { q: '<Real>' } }, port, a], []));
        expect(report.changes[0].parties).toEqual([{ id: 'a', name: 'a', role: 'user' }]);
    });
    it('reports a port that was conjugated', () => {
        const port = (isConjugated: boolean): DiffElement => ({ id: 'a::p', name: 'p', kind: 'Pd', construct: 'port', owner: 'a', portSpec: { type: 'Pd', isConjugated }, attributes: {} });
        expect(verdicts(judge(input([port(false), a], []), input([port(true), a], [])))).toEqual([['port.conjugation-changed', 'breaking', 'both']]);
    });
    it('ignores what is not a contract', () => {
        expect(judge(input([{ ...a, attributes: { v: '1' } }], []), input([{ ...a, attributes: { v: '2' } }], [])).changes).toEqual([]);
    });
});
