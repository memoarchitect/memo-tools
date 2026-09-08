import { describe, expect, it } from 'vitest';
import { selectionQueryLines } from '../server/view-writer.js';
import type { DiagramDTO } from '../model/semantic.js';

const view = (extra: Partial<DiagramDTO>): DiagramDTO => ({
    id: 'V-1', name: 'Trace', diagramType: 'alloc', viewpointId: 'VP-15-TRC', auto: false, ...extra,
});

describe('a view declared from a matrix carries its query', () => {
    // The point of writing the query rather than the ids: a traceability view
    // is defined by what it SELECTS. Freezing the elements that matched at
    // save time would make it stale the moment the model grew, and it would
    // stop being a view at all — it would be a screenshot.
    it('writes both axes and the relations between them', () => {
        expect(selectionQueryLines(view({
            elementKinds: ['Requirement', 'HardwareAssembly'],
            relationshipTypes: ['allocate', 'satisfy'],
        }))).toEqual([
            '    part :>> selectionQuery {',
            '        attribute :>> includeElementKinds = ("Requirement", "HardwareAssembly");',
            '        attribute :>> includeRelationshipKinds = ("allocate", "satisfy");',
            '    }',
        ]);
    });

    it('omits a list the matrix did not constrain', () => {
        // "Any relationship" is a real choice in the tool, and an empty
        // `includeRelationshipKinds = ()` would say something different — that
        // the view admits none.
        expect(selectionQueryLines(view({ elementKinds: ['Hazard'] }))).toEqual([
            '    part :>> selectionQuery {',
            '        attribute :>> includeElementKinds = ("Hazard");',
            '    }',
        ]);
    });

    it('writes no query at all for a view that was not created from one', () => {
        // Every view that existed before this went through the same emitter.
        expect(selectionQueryLines(view({}))).toEqual([]);
        expect(selectionQueryLines(view({ elementKinds: [], relationshipTypes: [] }))).toEqual([]);
    });

    it('escapes a kind name so it cannot break out of the string', () => {
        expect(selectionQueryLines(view({ elementKinds: ['Odd"Kind'] }))[1])
            .toBe('        attribute :>> includeElementKinds = ("Odd\\"Kind");');
    });
});
