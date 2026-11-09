import { describe, expect, it } from 'vitest';
import { definitionHistory, type HistoryPoint } from '../model/definition-history.js';
import type { DiffElement, DiffRelationship } from '../model/model-diff.js';

const def = (attributes: Record<string, string> = {}): DiffElement => ({ id: 'p::Sig', name: 'Sig', kind: 'ItemDefinition', attributes });
const flow = (flowItem: string, sourceId = 'p::a'): DiffRelationship => ({ id: `${sourceId}-${flowItem}`, type: 'flow', sourceId, targetId: 'p::b', flowItem });
const point = (label: string, element: DiffElement | undefined, relationships: DiffRelationship[] = []): HistoryPoint => ({
    label, commit: label, input: { elements: { ...(element ? { 'p::Sig': element } : {}), 'p::a': { id: 'p::a', name: 'a', kind: 'K', attributes: {} }, 'p::b': { id: 'p::b', name: 'b', kind: 'K', attributes: {} } }, relationships },
});
const statuses = (rows: ReturnType<typeof definitionHistory>) => rows.map(row => `${row.label}:${row.status}`);

describe('one definition across releases', () => {
    it('reads newest first, and says when it appeared, stayed the same and went away', () => {
        const rows = definitionHistory([point('r0', undefined), point('r1', def()), point('r2', def()), point('r3', undefined)], 'p::Sig');
        expect(statuses(rows)).toEqual(['r3:removed', 'r2:unchanged', 'r1:added', 'r0:absent']);
    });
    it('says what changed on the definition', () => {
        const rows = definitionHistory([point('r1', def({ a: '<Real>' })), point('r2', def({ a: '<Integer>' }))], 'p::Sig');
        expect(rows[0]).toMatchObject({ status: 'changed', changes: ['attributes changed'] });
    });
    it('marks a release that could not be read, and compares across it', () => {
        const rows = definitionHistory([point('r1', def({ a: '1' })), { label: 'r2', commit: 'r2' }, point('r3', def({ a: '2' }))], 'p::Sig');
        expect(statuses(rows)).toEqual(['r3:changed', 'r2:unavailable', 'r1:added']);
    });
    it('sees a flow that started carrying it, and ignores other flows', () => {
        const rows = definitionHistory([point('r1', def(), [flow('Other')]), point('r2', def(), [flow('Other'), flow('Sig')])], 'p::Sig');
        expect(rows[0].changes).toEqual(['added flow a → b']);
    });
});
