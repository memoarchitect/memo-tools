import { describe, expect, it } from 'vitest';
import { deriveModelViews, viewpointRoles, viewpointsForRole } from '../model/view-deriver.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// A role picks its viewpoints by the stakeholders each viewpoint is written for
// (ISO/IEC/IEEE 42010: a viewpoint names its stakeholders). The library's
// viewpoints are not project elements, so their `stakeholders` reach the DTO
// through the registry; a project's own viewpoint states them itself.
const SOURCE = `package t {
    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_stakeholders_concerns::*;
    private import memo_viewpoints_risk_risk_viewpoint::*;
    private import memo_viewpoints_usability_usability_viewpoint::*;
    private import memo_viewpoints_ui_layout_ui_layout_viewpoint::*;
    private import memo_viewpoints_software_software_viewpoint::*;
    viewpoint vpReview : MemoViewpoint {
        ref :>> memoStakeholders = (verificationEngineer, projectLead);
    }
    viewpoint vpNobody : MemoViewpoint;
    view vRisk : MemoView { ref :>> viewpointDefinition = riskViewpoint; }
    view vUsability : MemoView { ref :>> viewpointDefinition = usabilityViewpoint; }
    view vScreens : MemoView { ref :>> viewpointDefinition = uiLayoutViewpoint; }
    view vSoftware : MemoView { ref :>> viewpointDefinition = softwareViewpoint; }
    view vReview : MemoView { ref :>> viewpointDefinition = vpReview; }
    view vNobody : MemoView { ref :>> viewpointDefinition = vpNobody; }
}`;

async function viewpoints() {
    return withExample({ 'model/catalog/viewpoint_stakeholders.sysml': SOURCE }, project =>
        deriveModelViews(project.model, project.registries?.kindRegistry).viewpoints);
}

describe.runIf(compilerConfigured && examplesPresent)('the stakeholders a viewpoint is written for', () => {
    it('reach the DTO from a library viewpoint and from a project one', async () => {
        const byId = new Map((await viewpoints()).map(vp => [vp.id, vp]));
        expect(byId.get('riskViewpoint')?.stakeholders).toEqual(['safetyEngineer']);
        expect(byId.get('uiLayoutViewpoint')?.stakeholders)
            .toEqual(['usabilityEngineer', 'softwareArchitect', 'safetyEngineer']);
        expect(byId.get('vpReview')?.stakeholders).toEqual(['verificationEngineer', 'projectLead']);
        expect(byId.get('vpNobody')?.stakeholders).toEqual([]);
    });

    it('resolve a role to exactly the viewpoints that name it', async () => {
        const all = await viewpoints();
        expect(viewpointsForRole(all, 'safetyEngineer').map(vp => vp.id).sort())
            .toEqual(['riskViewpoint', 'uiLayoutViewpoint', 'usabilityViewpoint']);
        expect(viewpointsForRole(all, 'projectLead').map(vp => vp.id)).toEqual(['vpReview']);
        expect(viewpointRoles(all)).toEqual([
            'projectLead', 'safetyEngineer', 'softwareArchitect', 'usabilityEngineer', 'verificationEngineer',
        ]);
    });
});
