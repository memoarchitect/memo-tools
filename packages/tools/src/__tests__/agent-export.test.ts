// The model as text for an agent: an llms.txt index and the elements by kind, from the snapshot.

import { describe, it, expect } from 'vitest';
import { agentIndex, agentModelMarkdown } from '../operations/agent-export.js';

const input = {
    name: 'Pump',
    model: {
        elements: {
            'p::h1': { id: 'p::h1', shortId: 'HZD-1', name: 'Over\ninfusion', kind: 'Hazard', layer: 'risk', file: 'risk.sysml', attributes: { severity: 'S4' }, doc: 'Too much drug.' },
            'p::c1': { id: 'p::c1', shortId: 'RC-1', name: 'Limit', kind: 'RiskControl', layer: 'risk', attributes: {} },
        },
        relationships: [{ id: 'r1', type: 'mitigates', sourceId: 'p::c1', targetId: 'p::h1' }],
        errors: [],
        registries: { kinds: [{ name: 'Hazard', label: 'Hazard' }, { name: 'RiskControl', label: 'Risk control' }], relationships: [] },
    },
    validation: { violations: [{ severity: 'warning', ruleId: 'R-1', elementId: 'p::h1', description: 'needs a test' }] },
    completeness: { overall: 80 },
} as any;

describe('the agent export', () => {
    it('indexes the model and points at the text and the viewer', () => {
        const index = agentIndex(input);
        expect(index).toMatch(/^# Pump\n\n> .*2 elements and 1 relationships/);
        expect(index).toContain('[Model as text](model.md)');
        expect(index).toContain('- `Hazard`: 1');
        expect(index).toContain('- Risk control (`RiskControl`): 1');
    });

    it('writes each element with its relationships, findings and documentation, one value per line', () => {
        const text = agentModelMarkdown(input);
        expect(text).toContain('#### Over infusion (HZD-1)');
        expect(text).toContain('- severity: S4');
        expect(text).toContain('- ← mitigates from Limit (RC-1)');
        expect(text).toContain('- mitigates → Over infusion (HZD-1)');
        expect(text).toContain('- Finding (warning, R-1): needs a test');
        expect(text).toContain('Too much drug.');
        expect(text).toContain('Validation: 0 errors, 1 warnings');
    });
});
