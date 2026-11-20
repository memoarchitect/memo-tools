// The instructions for a method step come from what the method says about the step, and end by
// checking the work; a tool that may propose proposes, one that may not edits the source.

import { describe, it, expect } from 'vitest';
import { stepInstructions, listResources, listResourceTemplates } from '../mcp/prompts-and-resources.js';
import type { StepStatus } from '../methodology/guide.js';

const step = {
    id: 'm::stepRisk', name: 'stepRisk', label: 'Decide the controls', stage: 'risk', level: 'system',
    objective: 'Control every hazard.', entryCriteria: 'Hazards are known.', exitCriteria: 'Each hazard has a control.',
    inputKinds: ['Hazard'], outputKinds: ['RiskControl'], doneWhen: ['EveryHazardControlled'], linkedWhen: [],
    predecessors: [], state: 'open', outputs: [], rules: [{ rule: 'EveryHazardControlled', known: true, subjects: 3, violations: 1 }],
    links: [], reasons: ['1 hazard has no control'], waiting: [],
} as unknown as StepStatus;

describe('method step prompts', () => {
    it('are written from the step and end by checking the work', () => {
        const text = stepInstructions(step, 'Pump', true);
        for (const fact of ['Decide the controls', 'risk stage', 'for the system Pump', 'Control every hazard.', 'Hazards are known.',
            'Each hazard has a control.', 'Hazard', 'RiskControl', 'EveryHazardControlled', '1 hazard has no control', 'memo_select_system with "Pump"']) {
            expect(text).toContain(fact);
        }
        expect(text).toContain('propose_*');
        expect(text).toMatch(/memo_validate and memo_guide again/);
    });

    it('send a tool that may not propose to the source', () => {
        const text = stepInstructions(step, undefined, false);
        expect(text).not.toContain('propose_*');
        expect(text).toContain('Edit the .sysml source');
    });

    it('offer the model as resources, an element by template', () => {
        expect(listResources().map(r => r.uri)).toEqual(['memo://ontology', 'memo://guide', 'memo://systems', 'memo://summary']);
        expect(listResourceTemplates()[0].uriTemplate).toBe('memo://element/{id}');
    });
});
