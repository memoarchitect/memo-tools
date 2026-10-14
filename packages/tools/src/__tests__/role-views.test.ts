import { describe, expect, it } from 'vitest';
import type { ViewpointDTO } from '../model/semantic.js';
import { viewpointsForRole } from '../model/view-deriver.js';

// O12: a viewpoint names the stakeholders it is written for, and that is what a role sees; a method's
// role view says otherwise for a role, and then that is what the role sees (an override, not an addition).

const vp = (id: string, name: string, stakeholders: string[]): ViewpointDTO =>
    ({ id, name, label: name, stakeholders, visibleKinds: [], visibleRelationships: [], visibleLayers: [] });
const viewpoints = [
    vp('VP-1', 'vpRiskChain', ['safetyEngineer']), vp('VP-2', 'vpUseCase', ['systemArchitect']),
    vp('VP-3', 'vpEvidenceTraceability', ['verificationEngineer']), vp('VP-4', 'vpLogicalArchitecture', ['systemArchitect', 'safetyEngineer']),
];
const names = (list: ViewpointDTO[]) => list.map(v => v.name);

describe('role views', () => {
    it('shows a role the viewpoints written for it when no method says otherwise', () => {
        expect(names(viewpointsForRole(viewpoints, 'safetyEngineer'))).toEqual(['vpRiskChain', 'vpLogicalArchitecture']);
        expect(names(viewpointsForRole(viewpoints, 'safetyEngineer', []))).toEqual(['vpRiskChain', 'vpLogicalArchitecture']);
    });

    it('shows a role exactly the viewpoints its role view names, replacing what the stakeholders implied', () => {
        const roleViews = [{ stakeholder: 'safetyEngineer', viewpoints: ['vpEvidenceTraceability', 'vpUseCase'] }];
        expect(names(viewpointsForRole(viewpoints, 'safetyEngineer', roleViews))).toEqual(['vpUseCase', 'vpEvidenceTraceability']);
        // One role is remapped; the others are as they were.
        expect(names(viewpointsForRole(viewpoints, 'systemArchitect', roleViews))).toEqual(['vpUseCase', 'vpLogicalArchitecture']);
    });

    it('lets a later role view for the same stakeholder replace an earlier one (the family over the default)', () => {
        const roleViews = [
            { stakeholder: 'safetyEngineer', viewpoints: ['vpUseCase'] },
            { stakeholder: 'safetyEngineer', viewpoints: ['vpRiskChain'] },
        ];
        expect(names(viewpointsForRole(viewpoints, 'safetyEngineer', roleViews))).toEqual(['vpRiskChain']);
    });

    it('matches a viewpoint by the name it is written with or by its id', () => {
        expect(names(viewpointsForRole(viewpoints, 'x', [{ stakeholder: 'x', viewpoints: ['VP-3', 'vpUseCase'] }]))).toEqual(['vpUseCase', 'vpEvidenceTraceability']);
    });

    it('shows a remapped role nothing when none of the viewpoints it names exists', () => {
        expect(viewpointsForRole(viewpoints, 'safetyEngineer', [{ stakeholder: 'safetyEngineer', viewpoints: ['vpGone'] }])).toEqual([]);
    });
});
