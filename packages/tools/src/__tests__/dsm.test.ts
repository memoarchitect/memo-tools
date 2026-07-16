import { describe, it, expect } from 'vitest';
import { computeDSM, reorderDSM } from '../analysis/dsm.js';
import type { MemoModelDTO } from '../model/semantic.js';

/** Minimal functional model for DSM testing */
function makeFunctionalModel(): MemoModelDTO {
    return {
        errors: [],
        elements: {
            'sf1': { id: 'sf1', name: 'Regulate Flow', kind: 'Function', layer: 'functional', construct: 'action', doc: '', attributes: {}, file: 'a.sysml' },
            'sf2': { id: 'sf2', name: 'Detect Occlusion', kind: 'Function', layer: 'functional', construct: 'action', doc: '', attributes: {}, file: 'a.sysml' },
            'sf3': { id: 'sf3', name: 'Manage Alarms', kind: 'Function', layer: 'functional', construct: 'action', doc: '', attributes: {}, file: 'a.sysml' },
            'cf1': { id: 'cf1', name: 'Calc Step Rate', kind: 'Function', layer: 'functional', construct: 'action', doc: '', attributes: {}, file: 'a.sysml' },
            'cf2': { id: 'cf2', name: 'Read Pressure', kind: 'Function', layer: 'functional', construct: 'action', doc: '', attributes: {}, file: 'a.sysml' },
            // Non-functional element — should be excluded by default
            'sys': { id: 'sys', name: 'System', kind: 'System', layer: 'logical', construct: 'part', doc: '', attributes: {}, file: 'a.sysml' },
        },
        relationships: [
            // Decomposition
            { id: 'r1', type: 'decomposedBy', sourceId: 'sf1', targetId: 'cf1', sourceEnd: '', targetEnd: '', file: '' },
            { id: 'r2', type: 'decomposedBy', sourceId: 'sf2', targetId: 'cf2', sourceEnd: '', targetEnd: '', file: '' },
            // Flow: sf2 detects → sf3 manages alarm
            { id: 'r3', type: 'flow', sourceId: 'sf2', targetId: 'sf3', sourceEnd: '', targetEnd: '', file: '', flowItem: 'AlarmSignal' },
            // Allocation (not included in default filter but present)
            { id: 'r4', type: 'allocateTo', sourceId: 'sf1', targetId: 'sys', sourceEnd: '', targetEnd: '', file: '' },
        ],
    };
}

describe('DSM Analysis', () => {
    it('builds matrix from functional elements only', () => {
        const model = makeFunctionalModel();
        const dsm = computeDSM(model);

        // Should include 5 functional elements, exclude System
        expect(dsm.elementIds).toHaveLength(5);
        expect(dsm.elementIds).not.toContain('sys');
        expect(dsm.totalDependencies).toBeGreaterThan(0);
    });

    it('records flow relationships in matrix cells', () => {
        const model = makeFunctionalModel();
        const dsm = computeDSM(model);

        const sf2Idx = dsm.elementIds.indexOf('sf2');
        const sf3Idx = dsm.elementIds.indexOf('sf3');

        const cell = dsm.matrix[sf2Idx][sf3Idx];
        expect(cell).not.toBeNull();
        expect(cell!.count).toBe(1);
        expect(cell!.types).toContain('flow');
        expect(cell!.flowItems).toContain('AlarmSignal');
    });

    it('records decomposedBy relationships', () => {
        const model = makeFunctionalModel();
        const dsm = computeDSM(model);

        const sf1Idx = dsm.elementIds.indexOf('sf1');
        const cf1Idx = dsm.elementIds.indexOf('cf1');

        const cell = dsm.matrix[sf1Idx][cf1Idx];
        expect(cell).not.toBeNull();
        expect(cell!.types).toContain('decomposedBy');
    });

    it('keeps diagonal empty (no self-loops)', () => {
        const model = makeFunctionalModel();
        const dsm = computeDSM(model);

        for (let i = 0; i < dsm.elementIds.length; i++) {
            expect(dsm.matrix[i][i]).toBeNull();
        }
    });

    it('clusters connected components', () => {
        const model = makeFunctionalModel();
        const dsm = computeDSM(model);

        // sf1↔cf1 and sf2↔cf2↔sf3 should form connected groups
        expect(dsm.clusters.size).toBeGreaterThanOrEqual(1);

        // Verify every element is in exactly one cluster
        const allClustered = new Set<string>();
        for (const [, members] of dsm.clusters) {
            for (const id of members) {
                expect(allClustered.has(id)).toBe(false);
                allClustered.add(id);
            }
        }
        expect(allClustered.size).toBe(dsm.elementIds.length);
    });

    it('supports custom kind and relationship filters', () => {
        const model = makeFunctionalModel();
        const dsm = computeDSM(model, {
            kinds: ['Function'],
            relationshipTypes: ['flow'],
        });

        // Filtered to Function kinds (all five functional elements in fixture)
        expect(dsm.elementIds).toHaveLength(5);
        // Only flow relationship
        expect(dsm.totalDependencies).toBe(1);
    });

    it('reorderDSM groups clusters together', () => {
        const model = makeFunctionalModel();
        const dsm = computeDSM(model);
        const reordered = reorderDSM(dsm);

        // Same elements, same total deps
        expect(new Set(reordered.elementIds)).toEqual(new Set(dsm.elementIds));
        expect(reordered.totalDependencies).toBe(dsm.totalDependencies);
        expect(reordered.elementIds).toHaveLength(dsm.elementIds.length);
    });

    it('handles empty model gracefully', () => {
        const model: MemoModelDTO = { errors: [], elements: {}, relationships: [] };
        const dsm = computeDSM(model);

        expect(dsm.elementIds).toHaveLength(0);
        expect(dsm.matrix).toHaveLength(0);
        expect(dsm.totalDependencies).toBe(0);
    });

    it('handles model with no relevant relationships', () => {
        const model = makeFunctionalModel();
        const dsm = computeDSM(model, { relationshipTypes: ['nonexistent'] });

        expect(dsm.elementIds).toHaveLength(5);
        expect(dsm.totalDependencies).toBe(0);
    });
});
