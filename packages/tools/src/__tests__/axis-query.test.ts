import { describe, expect, it } from 'vitest';
import { runAxisQuery } from '../server/axis-query.js';
import { readMatrixDefinition } from '../model/view-deriver.js';
import type { QueryContext } from '../dhf/query-engine.js';

const elements = ['a', 'b', 'c'].map((name, index) => ({
    id: `pkg::${name}`, name, kind: index < 2 ? 'Requirement' : 'Hazard', package: 'pkg',
}));
const ctx = {
    allElements: () => elements,
    elementsByKind: (kind: string) => elements.filter(e => e.kind === kind),
    elementsByKinds: (kinds: string[]) => elements.filter(e => kinds.includes(e.kind)),
} as unknown as QueryContext;

describe('runAxisQuery', () => {
    it('counts, previews and returns the ids when they fit', () => {
        const result = runAxisQuery('kind: Requirement', ctx, { preview: 1 });
        expect(result.count).toBe(2);
        expect(result.ids).toEqual(['pkg::a', 'pkg::b']);
        expect(result.preview).toHaveLength(1);
    });

    it('withholds the ids of an axis larger than the limit, and still counts it', () => {
        const result = runAxisQuery('kind: Requirement', ctx, { ids: 1 });
        expect(result.count).toBe(2);
        expect(result.ids).toBeUndefined();
    });

    it('reports a query it cannot run rather than selecting everything', () => {
        expect(runAxisQuery('', ctx).error).toMatch(/empty/);
        expect(runAxisQuery('bogus: 1', ctx).error).toMatch(/unknown directive/);
        expect(runAxisQuery('select: relationships\nkind: verifiedBy', ctx).error).toMatch(/lists elements/);
    });
});

describe('readMatrixDefinition', () => {
    it('reads axes, lists and options off the flattened attributes', () => {
        const matrix = readMatrixDefinition({
            'rowAxis.query': 'kind: Requirement',
            'columnAxis.includeElementIds': 'pkg::a,pkg::b',
            linkTypes: 'verifiedBy,satisfiedBy',
            symmetric: 'true',
            ordering: 'MatrixOrderingKind::cluster',
        });
        expect(matrix).toEqual({
            rowAxis: { query: 'kind: Requirement' },
            columnAxis: { elementIds: ['pkg::a', 'pkg::b'] },
            linkTypes: ['verifiedBy', 'satisfiedBy'],
            symmetric: true,
            ordering: 'cluster',
        });
    });

    it('leaves a view that declares no matrix without one', () => {
        expect(readMatrixDefinition({ 'selectionQuery.includeElementKinds': 'Requirement' })).toBeUndefined();
    });
});
