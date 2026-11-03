import { describe, expect, it } from 'vitest';
import { variantOverlay } from '../model/variant-overlay.js';
import type { MemoElement, MemoModelDTO } from '../model/semantic.js';

const el = (id: string, attributes: Record<string, string> = {}): MemoElement =>
    ({ id, name: id, kind: 'X', construct: 'action', layer: 'l', file: 'f', attributes }) as MemoElement;
const rel = (type: string, sourceId: string, targetId: string) => ({ type, sourceId, targetId });

// base step b; variant robot's workflow w owns scenario s owns step t, t realizes b.
function sample(): MemoModelDTO {
    const elements = Object.fromEntries([
        el('b'), el('t', { expectedDuration: '30 [minute]' }), el('s'), el('w'), el('uc'),
        el('robot', { label: 'Our robot', capacityCostRate: '650 [euro/hour]' }),
    ].map(e => [e.id, e]));
    return {
        elements, errors: [],
        relationships: [
            rel('realizes', 't', 'b'), rel('composes', 'w', 's'), rel('composes', 's', 't'),
            rel('realizesUseCase', 'w', 'uc'), rel('hasSubject', 'uc', 'robot'),
        ],
    } as unknown as MemoModelDTO;
}

describe('variantOverlay', () => {
    it('reads a refined step back as a row for the variant its workflow serves', () => {
        const overlay = variantOverlay(sample(), ['b']);
        expect(overlay.variants).toEqual([{ id: 'robot', label: 'Our robot', rate: '650 [euro/hour]' }]);
        expect(overlay.rows.get('b')).toEqual([{ variantId: 'robot', stepId: 't', duration: '30 [minute]' }]);
    });

    it('is empty when no step in the flow is refined', () => {
        const overlay = variantOverlay(sample(), ['elsewhere']);
        expect(overlay.variants).toEqual([]);
        expect(overlay.rows.size).toBe(0);
    });

    it('skips a refinement whose workflow serves no variant', () => {
        const model = sample();
        model.relationships = model.relationships.filter(r => r.type !== 'hasSubject');
        expect(variantOverlay(model, ['b']).rows.size).toBe(0);
    });
});
