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
    it('reads the default method\'s steps, their order, roles, viewpoints, done- and link-rules, and a family step that follows one', async () => {
        await withExample({ 'model/catalog/sos/family_method.sysml': FAMILY_METHOD }, project => {
            const { steps, layers, roleViews } = readGuideSources(project.api, ['memo_methodology_profiles', 'robot_cell_family_method']);
            const byName = new Map(steps.map(s => [s.name, s]));
            expect(steps.map(s => s.name).slice(0, 7)).toEqual([
                'stepSosContext', 'stepSosUsers', 'stepSosUseCases', 'stepSosOperational', 'stepSosFunctions', 'stepSosArchitecture', 'stepSosHazards',
            ]);
            expect(steps.at(-1)!.name).toBe('stepFamilyReview');
            expect(byName.get('stepSosHazards')).toMatchObject({
                label: 'Identify the hazards of the systems together',
                stage: 'risk', level: 'systemOfSystems', role: 'safetyEngineer', guideViewpoint: 'vpRiskChain',
                outputKinds: ['Hazard'], doneWhen: [], linkedWhen: ['HazardMitigationRule'],
                predecessors: ['memo_methodology_profiles::stepSosArchitecture'], methodology: 'memo_methodology_profiles',
            });
            // A step is read by its label, a verb phrase; one that has none falls back to its name in words.
            expect(byName.get('stepSysLogicalInterfaces')).toMatchObject({ label: 'Connect the components', stage: 'logical', outputKinds: ['LogicalPort'] });
            expect(byName.get('stepSysLogicalAllocation')).toMatchObject({ linkedWhen: ['LogicalFunctionAllocationRule'], outputKinds: [] });
            // Two steps follow the logical step.
            expect(['stepSysHardware', 'stepSysSoftware'].map(n => byName.get(n)!.predecessors)).toEqual([
                ['memo_methodology_profiles::stepSysLogical'], ['memo_methodology_profiles::stepSysLogical']]);
            // The rows of the method map, each side in declaration order; a row names stages, never steps.
            expect(layers.map(l => `${l.axis}:${l.label}`)).toEqual([
                'architecture:Context', 'architecture:Operational', 'architecture:Functional', 'architecture:Logical',
                'architecture:Implementation', 'architecture:Realization',
                'assurance:Requirements', 'assurance:Safety and risk', 'assurance:Cybersecurity', 'assurance:Human factors',
                'assurance:Verification and validation',
            ]);
            expect(layers.find(l => l.name === 'layerLogical')).toMatchObject({
                purpose: 'How the system will work.', stages: ['logical'],
            });
            expect(layers.find(l => l.name === 'layerLogical')!.viewpoints).toEqual([
                { id: 'memo_viewpoints_catalog::vpLogicalArchitecture', name: 'vpLogicalArchitecture', label: 'Logical architecture', viewKind: 'general' },
                { id: 'memo_viewpoints_catalog::vpInternalInterconnection', name: 'vpInternalInterconnection', label: 'Internal interconnection', viewKind: 'interconnection' },
                { id: 'memo_viewpoints_catalog::vpSequenceInteraction', name: 'vpSequenceInteraction', label: 'Sequence interaction', viewKind: 'sequence' },
                { id: 'memo_viewpoints_catalog::vpStateMode', name: 'vpStateMode', label: 'State and mode', viewKind: 'statetransition' },
                { id: 'memo_viewpoints_logical_logical_viewpoint::logicalArchitectureViewpoint', name: 'logicalArchitectureViewpoint', label: 'Logical architecture views', viewKind: undefined },
            ]);
            expect(layers.find(l => l.name === 'disciplineSafetyRisk')).toMatchObject({ standardReference: 'ISO 14971', stages: ['risk'], importable: true });
            expect(layers.find(l => l.name === 'disciplineCybersecurity')!.importable).toBe(false);
            // Every step but the release is held by a row: the release belongs to the design history.
            const held = new Set(layers.flatMap(l => l.stages));
            expect(steps.filter(s => s.methodology === 'memo_methodology_profiles' && !held.has(s.stage!)).map(s => s.name)).toEqual(['stepSysRelease']);
            // A family step added by `first <base step> then <family step>`.
            expect(byName.get('stepFamilyReview')).toMatchObject({
                level: 'system', role: 'regulatoryEngineer', guideViewpoint: 'vpModelContent', outputKinds: ['ReleaseRecord'],
                doneWhen: ['NestedPartConnectedRule'], linkedWhen: [], predecessors: ['memo_methodology_profiles::stepSysRelease'], methodology: 'robot_cell_family_method',
            });
            expect(roleViews).toEqual([{ stakeholder: 'safetyEngineer', viewpoints: ['vpRiskChain', 'vpEvidenceTraceability'], methodology: 'robot_cell_family_method' }]);
        }, 'robot-cell-family');
    }, 120_000);

    it('reads only the packages it is given', async () => {
        await withExample({ 'model/catalog/sos/family_method.sysml': FAMILY_METHOD }, project => {
            expect(readGuideSources(project.api, ['robot_cell_family_method']).steps.map(s => s.name)).toEqual(['stepFamilyReview']);
            expect(readGuideSources(project.api, ['no_such_package'])).toEqual({ steps: [], layers: [], roleViews: [] });
        }, 'robot-cell-family');
    }, 120_000);
});
