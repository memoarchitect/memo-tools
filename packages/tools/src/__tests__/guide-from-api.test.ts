import { describe, expect, it } from 'vitest';
import { readGuideSources } from '../stage2/guide-from-api.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// The steps of a method are read from the handoff, not from the built model: the default method is library
// content, which is never built, and a family's own method is read by the same reader.

export const FAMILY_METHOD = `package robot_cell_family_method {
    private import memo_methodology_workflow::*;
    private import memo_methodology_core::*;
    private import memo_methodology_profiles::*;
    private import memo_core_enumerations::*;
    private import memo_core_common::*;
    private import memo_viewpoints_stakeholders_concerns::*;
    private import memo_viewpoints_catalog::*;
    private import memo_rules_ontology::*;

    action stepFamilyReview : MethodologyWorkflowStep {
        @MemoIdentity { :>> providedId = "FAM-STEP-1"; :>> label = "FamilyReview"; }
        attribute :>> stage = WorkflowStageKind::release;
        attribute :>> level = MethodLevelKind::system;
        ref :>> role = regulatoryEngineer;
        ref :>> guideViewpoint = vpModelContent;
        attribute :>> outputKinds = ("ReleaseRecord");
        #DoneWhen dependency from stepFamilyReview to NestedPartConnectedRule;
    }
    first memo_methodology_profiles::stepSysRelease then stepFamilyReview;

    part mdFamily : MethodologyDefinition {
        @MemoIdentity { :>> providedId = "FAM-METH-1"; :>> label = "FamilyMethod"; }
        ref :>> baseMethodology = mdDefaultDefinition;
    }
    part rvSafety : RoleView {
        ref :>> forStakeholder = safetyEngineer;
        ref :>> shownViewpoint = (vpRiskChain, vpEvidenceTraceability);
    }
}
`;

describe.runIf(compilerConfigured && examplesPresent)('the steps of a method, from the handoff', () => {
    it('reads the default method\'s steps, their order, roles, viewpoints and done-rules, and a family step that follows one', async () => {
        await withExample({ 'model/sos/family_method.sysml': FAMILY_METHOD }, project => {
            const { steps, roleViews } = readGuideSources(project.api, ['memo_methodology_profiles', 'robot_cell_family_method']);
            const byName = new Map(steps.map(s => [s.name, s]));
            expect(steps.map(s => s.name)).toEqual([
                'stepSosContext', 'stepSosOperational', 'stepSosFunctions', 'stepSosArchitecture', 'stepSosHazards',
                'stepSysOperational', 'stepSysFunctional', 'stepSysLogical', 'stepSysHardware', 'stepSysSoftware', 'stepSysHumanFactors',
                'stepSysRisk', 'stepSysSecurity', 'stepSysVerification', 'stepSysRelease', 'stepFamilyReview',
            ]);
            expect(byName.get('stepSosHazards')).toMatchObject({
                stage: 'risk', level: 'systemOfSystems', role: 'safetyEngineer', guideViewpoint: 'vpRiskChain',
                outputKinds: ['Hazard'], doneWhen: ['HazardMitigationRule'],
                predecessors: ['memo_methodology_profiles::stepSosArchitecture'], methodology: 'memo_methodology_profiles',
            });
            expect(byName.get('stepSysLogical')!.predecessors).toEqual(['memo_methodology_profiles::stepSysFunctional']);
            expect(byName.get('stepSysRisk')!.outputKinds).toEqual(['Hazard', 'Risk']);
            // Two steps follow the logical step, and one has two ancestors only by chain.
            expect(['stepSysHardware', 'stepSysSoftware'].map(n => byName.get(n)!.predecessors)).toEqual([
                ['memo_methodology_profiles::stepSysLogical'], ['memo_methodology_profiles::stepSysLogical']]);
            // A family step added by `first <base step> then <family step>`.
            expect(byName.get('stepFamilyReview')).toMatchObject({
                level: 'system', role: 'regulatoryEngineer', guideViewpoint: 'vpModelContent', outputKinds: ['ReleaseRecord'],
                doneWhen: ['NestedPartConnectedRule'], predecessors: ['memo_methodology_profiles::stepSysRelease'], methodology: 'robot_cell_family_method',
            });
            expect(roleViews).toEqual([{ stakeholder: 'safetyEngineer', viewpoints: ['vpRiskChain', 'vpEvidenceTraceability'], methodology: 'robot_cell_family_method' }]);
        }, 'robot-cell-family');
    }, 120_000);

    it('reads only the packages it is given', async () => {
        await withExample({ 'model/sos/family_method.sysml': FAMILY_METHOD }, project => {
            expect(readGuideSources(project.api, ['robot_cell_family_method']).steps.map(s => s.name)).toEqual(['stepFamilyReview']);
            expect(readGuideSources(project.api, ['no_such_package'])).toEqual({ steps: [], roleViews: [] });
        }, 'robot-cell-family');
    }, 120_000);
});
