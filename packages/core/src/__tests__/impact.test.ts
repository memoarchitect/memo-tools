import { describe, it, expect } from 'vitest';
import { computeImpact } from '../analysis/impact.js';
import type { MemoModelDTO } from '../model/semantic.js';

/** Build a minimal MemoModelDTO for testing */
function makeTestModel(): MemoModelDTO {
    return {
        errors: [],
        elements: {
            'A': { id: 'A', name: 'Actor A', kind: 'Actor', layer: 'stakeholder', construct: 'part', doc: '', attributes: {}, file: 'a.sysml' },
            'B': { id: 'B', name: 'Req B', kind: 'SystemRequirement', layer: 'requirement', construct: 'requirement', doc: '', attributes: {}, file: 'b.sysml' },
            'C': { id: 'C', name: 'Function C', kind: 'Function', layer: 'function', construct: 'action', doc: '', attributes: {}, file: 'c.sysml' },
            'D': { id: 'D', name: 'Component D', kind: 'Component', layer: 'logical', construct: 'part', doc: '', attributes: {}, file: 'd.sysml' },
            'E': { id: 'E', name: 'Risk E', kind: 'Hazard', layer: 'risk', construct: 'part', doc: '', attributes: {}, file: 'e.sysml' },
        },
        relationships: [
            { id: 'r1', type: 'traceTo', sourceId: 'B', targetId: 'A', sourceEnd: '', targetEnd: '', file: '' },
            { id: 'r2', type: 'satisfy', sourceId: 'C', targetId: 'B', sourceEnd: '', targetEnd: '', file: '' },
            { id: 'r3', type: 'allocateTo', sourceId: 'C', targetId: 'D', sourceEnd: '', targetEnd: '', file: '' },
            { id: 'r4', type: 'mitigates', sourceId: 'D', targetId: 'E', sourceEnd: '', targetEnd: '', file: '' },
        ],
    };
}

describe('Impact Analysis', () => {
    it('computes downstream impact', () => {
        const model = makeTestModel();
        const result = computeImpact(model, 'C', 'downstream');

        expect(result.rootId).toBe('C');
        expect(result.rootName).toBe('Function C');
        // C → B (satisfy), C → D (allocateTo), B → A (traceTo), D → E (mitigates)
        expect(result.nodes.map(n => n.elementId).sort()).toEqual(['A', 'B', 'D', 'E']);
        expect(result.nodes.find(n => n.elementId === 'B')!.depth).toBe(1);
        expect(result.nodes.find(n => n.elementId === 'E')!.depth).toBe(2);
        expect(result.nodes.find(n => n.elementId === 'A')!.depth).toBe(2);
    });

    it('computes upstream impact', () => {
        const model = makeTestModel();
        const result = computeImpact(model, 'D', 'upstream');

        // D ← C (allocateTo)
        expect(result.nodes.map(n => n.elementId)).toContain('C');
        // C ← B (satisfy) — B is upstream of C? No, B is a target of C.satisfy
        // Actually: C.satisfy → B, so incoming to B includes C, not incoming to C
        // C.allocateTo → D, so incoming to D includes C. C upstream.
        // Incoming to C: nothing directly
        expect(result.nodes.length).toBe(1);
        expect(result.nodes[0].elementId).toBe('C');
    });

    it('computes both directions', () => {
        const model = makeTestModel();
        const result = computeImpact(model, 'C', 'both');

        // Downstream: B, D, E. Upstream: nothing incoming to C
        // But also from B downstream: A (B.traceTo → A)
        expect(result.nodes.length).toBeGreaterThanOrEqual(3);
        expect(result.nodes.map(n => n.elementId)).toContain('D');
        expect(result.nodes.map(n => n.elementId)).toContain('E');
    });

    it('respects maxDepth', () => {
        const model = makeTestModel();
        const result = computeImpact(model, 'C', 'downstream', 1);

        // Only depth 1: B, D (not E which is depth 2)
        expect(result.nodes.map(n => n.elementId).sort()).toEqual(['B', 'D']);
    });

    it('handles unknown element gracefully', () => {
        const model = makeTestModel();
        const result = computeImpact(model, 'NONEXISTENT', 'both');

        expect(result.nodes).toHaveLength(0);
        expect(result.rootName).toBe('(unknown)');
    });

    it('handles element with no relationships', () => {
        const model = makeTestModel();
        // E has incoming but no outgoing. Downstream from E should be empty.
        const result = computeImpact(model, 'E', 'downstream');

        expect(result.nodes).toHaveLength(0);
    });

    it('includes edges in result', () => {
        const model = makeTestModel();
        const result = computeImpact(model, 'C', 'downstream');

        expect(result.edges.length).toBeGreaterThanOrEqual(3);
        expect(result.edges.some(e => e.relType === 'satisfy')).toBe(true);
        expect(result.edges.some(e => e.relType === 'allocateTo')).toBe(true);
        expect(result.edges.some(e => e.relType === 'mitigates')).toBe(true);
    });
});
